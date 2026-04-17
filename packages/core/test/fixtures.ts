import bs58 from 'bs58';
import type { DecodedTransaction } from '../src/types';

export interface MockInstruction {
  programId: string;
  accountIndexes?: number[];
  data: Uint8Array;
}

export interface MockTxInput {
  accountKeys: string[];
  instructions: MockInstruction[];
}

export function mockTx(input: MockTxInput): DecodedTransaction {
  const accountKeys = input.accountKeys.map((k) => {
    const bytes = bs58.decode(k);
    if (bytes.length !== 32) {
      throw new Error(`pubkey ${k} decoded to ${bytes.length} bytes, expected 32`);
    }
    return bytes;
  });

  const instructions = input.instructions.map((ix) => {
    const programIdIndex = input.accountKeys.indexOf(ix.programId);
    if (programIdIndex === -1) {
      throw new Error(`program ${ix.programId} not present in accountKeys`);
    }
    return {
      programIdIndex,
      accounts: ix.accountIndexes ?? [],
      data: ix.data,
    };
  });

  return {
    signatures: [],
    message: {
      version: 'legacy',
      header: {
        numRequiredSignatures: 1,
        numReadonlySignedAccounts: 0,
        numReadonlyUnsignedAccounts: 0,
      },
      accountKeys,
      recentBlockhash: new Uint8Array(32),
      instructions,
      addressTableLookups: [],
    },
  };
}

export function u8Data(...bytes: number[]): Uint8Array {
  return Uint8Array.from(bytes);
}

export function u32LE(n: number): Uint8Array {
  const out = new Uint8Array(4);
  out[0] = n & 0xff;
  out[1] = (n >>> 8) & 0xff;
  out[2] = (n >>> 16) & 0xff;
  out[3] = (n >>> 24) & 0xff;
  return out;
}

export function u64LE(n: bigint): Uint8Array {
  const out = new Uint8Array(8);
  let v = n;
  for (let i = 0; i < 8; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// Deterministic 32-byte pubkey built from a seed label. Lets tests use readable
// names like `key('wallet')` without hand-writing base58.
export function key(seed: string): string {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < seed.length && i < 32; i++) {
    bytes[i] = seed.charCodeAt(i) & 0xff;
  }
  // Pad remaining bytes with a deterministic pattern so different seeds diverge.
  for (let i = seed.length; i < 32; i++) {
    bytes[i] = (i * 7 + seed.length) & 0xff;
  }
  return bs58.encode(bytes);
}
