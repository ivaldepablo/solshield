/**
 * Resolve a V0 transaction's Address Lookup Tables.
 *
 * Solana V0 transactions can reference accounts via on-chain lookup tables
 * (`addressTableLookups`). Static rules that only inspect
 * `tx.message.accountKeys` miss those — a drainer can publish their attacker
 * address inside a lookup table, reference it via `writableIndexes[0]`, and
 * every rule that calls `accountAt(...)` returns `null` for that index, so
 * the threat is invisible. Verdict: "safe". User signs.
 *
 * This module fetches each lookup table account, parses its data structure,
 * and returns the resolved keys in the order Solana itself resolves them
 * (per-table writable lookups first, then per-table readonly lookups, after
 * all static keys).
 */

import { encodePubkey, type DecodedTransaction, type RpcClient } from '@solshield/core';

const MAX_LOOKUP_TABLE_ADDRESSES = 256; // hard cap per Solana spec

/**
 * Layout of an on-chain AddressLookupTable account (from solana-program docs):
 *   offset 0..3   ALT discriminator (uint32 LE) — value 1 for V0 ALT
 *   offset 4..11  deactivation slot (u64 LE)
 *   offset 12..19 last extended slot (u64 LE)
 *   offset 20     last extended slot start index (u8)
 *   offset 21     authority option (1 byte) + 32 byte authority if option=1
 *   offset 56..   pre-padding to 56 (some impls), then 32-byte addresses
 *
 * In practice, the addresses array starts at offset 56 (after the
 * fixed-size meta block). Each address is 32 bytes. The number of
 * addresses is `(data.length - 56) / 32`.
 */
const ALT_HEADER_SIZE = 56;
const ALT_ADDR_SIZE = 32;

/** Decoded ALT addresses, indexable by the position the tx references. */
interface ResolvedTable {
  /** All extended addresses in this table, in extension order. */
  addresses: Uint8Array[];
}

/** Result of resolving every ATL referenced by a tx. */
export interface AtlResolution {
  /** Static accountKeys + per-ATL writable lookups + per-ATL readonly lookups,
   *  in the canonical Solana order. */
  resolvedAccountKeys: Uint8Array[];
  /** Indexes that referenced an ATL but couldn't be resolved (table missing,
   *  index out of range, etc). The rule set should treat any ix using these
   *  indexes as opaque/unknown. */
  unresolvableIndexes: number[];
  /** Tables that we tried to fetch but couldn't (RPC failure, account
   *  missing, parse error). Keyed by base58 lookup-table account. */
  failedTables: string[];
}

function parseAltAddresses(data: Uint8Array): Uint8Array[] {
  if (data.length <= ALT_HEADER_SIZE) return [];
  const usable = data.length - ALT_HEADER_SIZE;
  const count = Math.min(Math.floor(usable / ALT_ADDR_SIZE), MAX_LOOKUP_TABLE_ADDRESSES);
  const out: Uint8Array[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const off = ALT_HEADER_SIZE + i * ALT_ADDR_SIZE;
    out[i] = data.slice(off, off + ALT_ADDR_SIZE);
  }
  return out;
}

export async function resolveAddressTableLookups(
  tx: DecodedTransaction,
  rpc: RpcClient,
): Promise<AtlResolution> {
  const lookups = tx.message.addressTableLookups;
  if (!lookups || lookups.length === 0) {
    return {
      resolvedAccountKeys: tx.message.accountKeys.slice(),
      unresolvableIndexes: [],
      failedTables: [],
    };
  }

  const tableKeys = lookups.map((l) => encodePubkey(l.accountKey));
  let accounts: Array<{ data: Uint8Array } | null> = [];
  try {
    accounts = await rpc.getMultipleAccounts(tableKeys);
  } catch {
    return {
      resolvedAccountKeys: tx.message.accountKeys.slice(),
      unresolvableIndexes: [],
      failedTables: tableKeys.slice(),
    };
  }

  const tables: Array<ResolvedTable | null> = accounts.map((a) => {
    if (!a) return null;
    try {
      return { addresses: parseAltAddresses(a.data) };
    } catch {
      return null;
    }
  });

  const failedTables: string[] = [];
  const writableResolved: Uint8Array[] = [];
  const readonlyResolved: Uint8Array[] = [];
  const unresolvableIndexes: number[] = [];
  // Solana resolves ATL indexes per-lookup, writable first then readonly,
  // appended in lookups[] order after the static keys.
  const baseStatic = tx.message.accountKeys.length;
  let cursor = baseStatic;

  for (let li = 0; li < lookups.length; li++) {
    const lookup = lookups[li]!;
    const table = tables[li];
    if (!table) {
      failedTables.push(tableKeys[li] ?? '');
      // Any indexes that would have come from this table are unresolvable.
      // We still advance the cursor so subsequent tables' resolved keys land
      // at the correct positions in the final accountKeys array.
      cursor += lookup.writableIndexes.length + lookup.readonlyIndexes.length;
      // Track the positions occupied by this failed table's writable +
      // readonly slots — any ix.account[i] pointing here is unresolvable.
      const startOfFailed = baseStatic + writableResolved.length;
      for (let k = 0; k < lookup.writableIndexes.length + lookup.readonlyIndexes.length; k++) {
        unresolvableIndexes.push(startOfFailed + k);
      }
      // Reserve null slots in writableResolved / readonlyResolved? We need
      // the resolvedAccountKeys to have correct positions, so push zero-byte
      // placeholders that downstream code can recognize as "unresolved".
      for (let k = 0; k < lookup.writableIndexes.length; k++) {
        writableResolved.push(new Uint8Array(32));
      }
      for (let k = 0; k < lookup.readonlyIndexes.length; k++) {
        readonlyResolved.push(new Uint8Array(32));
      }
      continue;
    }
    for (const wi of lookup.writableIndexes) {
      const addr = table.addresses[wi];
      if (!addr) {
        unresolvableIndexes.push(cursor);
        writableResolved.push(new Uint8Array(32));
      } else {
        writableResolved.push(addr);
      }
      cursor++;
    }
    for (const ri of lookup.readonlyIndexes) {
      const addr = table.addresses[ri];
      if (!addr) {
        unresolvableIndexes.push(cursor);
        readonlyResolved.push(new Uint8Array(32));
      } else {
        readonlyResolved.push(addr);
      }
      cursor++;
    }
  }

  // Final ordering: static accountKeys, then ALL writable-resolved, then ALL
  // readonly-resolved. This matches the Solana runtime's address resolution
  // order so existing rules indexing into `accountKeys[idx]` see the same
  // address the runtime would see when the tx executes.
  const resolvedAccountKeys = [
    ...tx.message.accountKeys,
    ...writableResolved,
    ...readonlyResolved,
  ];

  return { resolvedAccountKeys, unresolvableIndexes, failedTables };
}

/** Return a shallow-cloned tx with `accountKeys` replaced by the resolved
 *  set so downstream rules see ATL-derived addresses. */
export function withResolvedAccountKeys(
  tx: DecodedTransaction,
  resolution: AtlResolution,
): DecodedTransaction {
  return {
    ...tx,
    message: {
      ...tx.message,
      accountKeys: resolution.resolvedAccountKeys,
    },
  };
}
