import bs58 from 'bs58';
import type {
  DecodedInstruction,
  DecodedTransaction,
  Finding,
  InspectionContext,
  Rule,
  ThreatReport,
  Verdict,
} from './types';

// -------- program ids --------

export const SPL_TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const SPL_TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const SYSTEM_PROGRAM = '11111111111111111111111111111111';
export const BPF_LOADER_UPGRADEABLE = 'BPFLoaderUpgradeab1e11111111111111111111111';
export const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111';
export const MEMO = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
export const ASSOCIATED_TOKEN = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
export const STAKE = 'Stake11111111111111111111111111111111111111';

// -------- spl token instruction layout --------

const SPL_IX = {
  TRANSFER: 3,
  APPROVE: 4,
  SET_AUTHORITY: 6,
  CLOSE_ACCOUNT: 9,
  TRANSFER_CHECKED: 12,
  APPROVE_CHECKED: 13,
} as const;

const BPF_UPGRADEABLE_IX = {
  SET_AUTHORITY: 4,
  SET_AUTHORITY_CHECKED: 7,
} as const;

const SYSTEM_IX = {
  TRANSFER: 2,
} as const;

const STAKE_IX = {
  AUTHORIZE: 1,
  AUTHORIZE_CHECKED: 10,
} as const;

const COMPUTE_BUDGET_IX = {
  SET_COMPUTE_UNIT_LIMIT: 2,
  SET_COMPUTE_UNIT_PRICE: 3,
} as const;

const SPL_AUTHORITY = {
  MINT_TOKENS: 0,
  FREEZE_ACCOUNT: 1,
  ACCOUNT_OWNER: 2,
  CLOSE_ACCOUNT: 3,
} as const;

// -------- helpers --------

export function encodePubkey(bytes: Uint8Array): string {
  return bs58.encode(bytes);
}

export function programIdOf(tx: DecodedTransaction, ix: DecodedInstruction): string {
  const key = tx.message.accountKeys[ix.programIdIndex];
  if (!key) throw new Error(`invalid programIdIndex ${ix.programIdIndex}`);
  return bs58.encode(key);
}

export function accountAt(tx: DecodedTransaction, ix: DecodedInstruction, i: number): string | null {
  const idx = ix.accounts[i];
  if (idx === undefined) return null;
  const key = tx.message.accountKeys[idx];
  if (!key) return null;
  return bs58.encode(key);
}

function readU64LE(bytes: Uint8Array, offset = 0): bigint {
  let v = 0n;
  for (let i = 7; i >= 0; i--) {
    const byte = bytes[offset + i];
    if (byte === undefined) throw new Error('readU64LE: out of range');
    v = (v << 8n) | BigInt(byte);
  }
  return v;
}

function readU32LE(bytes: Uint8Array, offset = 0): number {
  const b0 = bytes[offset];
  const b1 = bytes[offset + 1];
  const b2 = bytes[offset + 2];
  const b3 = bytes[offset + 3];
  if (b0 === undefined || b1 === undefined || b2 === undefined || b3 === undefined) {
    throw new Error('readU32LE: out of range');
  }
  return (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0;
}

function isSplToken(pid: string): boolean {
  return pid === SPL_TOKEN || pid === SPL_TOKEN_2022;
}

// -------- rule 1: unlimited-spl-approval --------

const UNLIMITED_THRESHOLD = 10n ** 18n;

export const unlimitedSplApproval: Rule = {
  id: 'unlimited-spl-approval',
  severity: 'high',
  description: 'SPL token Approve with amount approaching u64::MAX.',

  evaluate(ctx) {
    const findings: Finding[] = [];
    ctx.tx.message.instructions.forEach((ix, i) => {
      const pid = programIdOf(ctx.tx, ix);
      if (!isSplToken(pid)) return;
      if (ix.data.length < 9) return;
      const disc = ix.data[0];
      if (disc !== SPL_IX.APPROVE && disc !== SPL_IX.APPROVE_CHECKED) return;
      const amount = readU64LE(ix.data, 1);
      if (amount < UNLIMITED_THRESHOLD) return;
      findings.push({
        ruleId: 'unlimited-spl-approval',
        severity: 'high',
        instructionIndex: i,
        message: `Unlimited SPL token approval (${amount.toString()}) granted to delegate.`,
        details: { amount: amount.toString(), programId: pid },
      });
    });
    return findings;
  },
};

// -------- rule 2: mint-authority-transfer --------

export const mintAuthorityTransfer: Rule = {
  id: 'mint-authority-transfer',
  severity: 'critical',
  description: 'SetAuthority reassigning the mint authority to a new key.',

  evaluate(ctx) {
    const findings: Finding[] = [];
    ctx.tx.message.instructions.forEach((ix, i) => {
      const pid = programIdOf(ctx.tx, ix);
      if (!isSplToken(pid)) return;
      if (ix.data.length < 3) return;
      if (ix.data[0] !== SPL_IX.SET_AUTHORITY) return;
      if (ix.data[1] !== SPL_AUTHORITY.MINT_TOKENS) return;
      if (ix.data[2] !== 1) return;
      findings.push({
        ruleId: 'mint-authority-transfer',
        severity: 'critical',
        instructionIndex: i,
        message: 'mint authority is being reassigned to a new key.',
        details: { authorityType: 'mint' },
      });
    });
    return findings;
  },
};

// -------- rule 3: mass-token-drain --------

const DRAIN_MIN_TRANSFERS = 3;

export const massTokenDrain: Rule = {
  id: 'mass-token-drain',
  severity: 'critical',
  description: 'Multiple SPL transfers converging on a single destination account.',

  evaluate(ctx) {
    const destinations = new Map<string, number[]>();
    ctx.tx.message.instructions.forEach((ix, i) => {
      const pid = programIdOf(ctx.tx, ix);
      if (!isSplToken(pid)) return;
      if (ix.data.length < 1) return;
      const disc = ix.data[0];
      if (disc !== SPL_IX.TRANSFER && disc !== SPL_IX.TRANSFER_CHECKED) return;
      const destPos = disc === SPL_IX.TRANSFER_CHECKED ? 2 : 1;
      const dest = accountAt(ctx.tx, ix, destPos);
      if (!dest) return;
      const indexes = destinations.get(dest) ?? [];
      indexes.push(i);
      destinations.set(dest, indexes);
    });

    const findings: Finding[] = [];
    for (const [destination, instructionIndexes] of destinations) {
      if (instructionIndexes.length < DRAIN_MIN_TRANSFERS) continue;
      findings.push({
        ruleId: 'mass-token-drain',
        severity: 'critical',
        message: `${instructionIndexes.length} SPL transfers converge on ${destination.slice(0, 8)}… in a single transaction.`,
        details: { destination, instructionIndexes },
      });
    }
    return findings;
  },
};

// -------- rule 4: upgrade-authority-set --------

export const upgradeAuthoritySet: Rule = {
  id: 'upgrade-authority-set',
  severity: 'critical',
  description: 'BPF Loader Upgradeable SetAuthority reassigning a program upgrade authority.',

  evaluate(ctx) {
    const findings: Finding[] = [];
    ctx.tx.message.instructions.forEach((ix, i) => {
      const pid = programIdOf(ctx.tx, ix);
      if (pid !== BPF_LOADER_UPGRADEABLE) return;
      if (ix.data.length < 4) return;
      const disc = readU32LE(ix.data, 0);
      if (
        disc !== BPF_UPGRADEABLE_IX.SET_AUTHORITY &&
        disc !== BPF_UPGRADEABLE_IX.SET_AUTHORITY_CHECKED
      ) {
        return;
      }
      // accounts: [programData, currentAuthority, newAuthority?]. No new authority => cleared.
      if (ix.accounts.length < 3) return;
      const newAuthority = accountAt(ctx.tx, ix, 2);
      const programData = accountAt(ctx.tx, ix, 0);
      findings.push({
        ruleId: 'upgrade-authority-set',
        severity: 'critical',
        instructionIndex: i,
        message: 'Program upgrade authority is being reassigned.',
        details: {
          programData,
          newAuthority,
          variant: disc === BPF_UPGRADEABLE_IX.SET_AUTHORITY_CHECKED ? 'checked' : 'unchecked',
        },
      });
    });
    return findings;
  },
};

// -------- rule 5: hidden-sol-transfer --------

const SYSTEM_TRANSFER_ALLOWLIST: ReadonlySet<string> = new Set([
  SYSTEM_PROGRAM,
  SPL_TOKEN,
  SPL_TOKEN_2022,
  COMPUTE_BUDGET,
  MEMO,
  ASSOCIATED_TOKEN,
  STAKE,
]);

export const hiddenSolTransfer: Rule = {
  id: 'hidden-sol-transfer',
  severity: 'high',
  description:
    'System Program transfer from the fee payer while the tx also touches a non-allowlisted program.',

  evaluate(ctx) {
    const feePayerBytes = ctx.tx.message.accountKeys[0];
    if (!feePayerBytes) return [];
    const feePayer = encodePubkey(feePayerBytes);

    const unknownPrograms = new Set<string>();
    for (const ix of ctx.tx.message.instructions) {
      const pid = programIdOf(ctx.tx, ix);
      if (!SYSTEM_TRANSFER_ALLOWLIST.has(pid)) unknownPrograms.add(pid);
    }
    if (unknownPrograms.size === 0) return [];

    const findings: Finding[] = [];
    ctx.tx.message.instructions.forEach((ix, i) => {
      const pid = programIdOf(ctx.tx, ix);
      if (pid !== SYSTEM_PROGRAM) return;
      // System transfer: [disc:u32 LE = 2, lamports:u64 LE]
      if (ix.data.length < 12) return;
      if (readU32LE(ix.data, 0) !== SYSTEM_IX.TRANSFER) return;
      const from = accountAt(ctx.tx, ix, 0);
      if (from !== feePayer) return;
      const to = accountAt(ctx.tx, ix, 1);
      const lamports = readU64LE(ix.data, 4).toString();
      findings.push({
        ruleId: 'hidden-sol-transfer',
        severity: 'high',
        instructionIndex: i,
        message: 'Fee payer is sending SOL while the transaction invokes an unrecognized program.',
        details: {
          from,
          to,
          lamports,
          unknownPrograms: [...unknownPrograms],
        },
      });
    });
    return findings;
  },
};

// -------- rule 6: spl-account-owner-change --------

export const splAccountOwnerChange: Rule = {
  id: 'spl-account-owner-change',
  severity: 'critical',
  description: 'SPL Token SetAuthority transferring AccountOwner to a new key.',

  evaluate(ctx) {
    const findings: Finding[] = [];
    ctx.tx.message.instructions.forEach((ix, i) => {
      const pid = programIdOf(ctx.tx, ix);
      if (!isSplToken(pid)) return;
      if (ix.data.length < 3) return;
      if (ix.data[0] !== SPL_IX.SET_AUTHORITY) return;
      if (ix.data[1] !== SPL_AUTHORITY.ACCOUNT_OWNER) return;
      if (ix.data[2] !== 1) return;
      const account = accountAt(ctx.tx, ix, 0);
      findings.push({
        ruleId: 'spl-account-owner-change',
        severity: 'critical',
        instructionIndex: i,
        message: 'Token account ownership is being transferred to a new key.',
        details: { account, programId: pid },
      });
    });
    return findings;
  },
};

// -------- rule 7: close-token-account-to-attacker --------

export const closeTokenAccountToAttacker: Rule = {
  id: 'close-token-account-to-attacker',
  severity: 'high',
  description: 'SPL CloseAccount routing rent lamports to a non-signer address.',

  evaluate(ctx) {
    const feePayerBytes = ctx.tx.message.accountKeys[0];
    if (!feePayerBytes) return [];
    const signer = encodePubkey(feePayerBytes);

    const findings: Finding[] = [];
    ctx.tx.message.instructions.forEach((ix, i) => {
      const pid = programIdOf(ctx.tx, ix);
      if (!isSplToken(pid)) return;
      if (ix.data.length < 1) return;
      if (ix.data[0] !== SPL_IX.CLOSE_ACCOUNT) return;
      // accounts: [accountToClose, destination, owner]
      const accountToClose = accountAt(ctx.tx, ix, 0);
      const destination = accountAt(ctx.tx, ix, 1);
      if (!destination) return;
      if (destination === signer) return;
      findings.push({
        ruleId: 'close-token-account-to-attacker',
        severity: 'high',
        instructionIndex: i,
        message: 'Token account being closed with rent redirected to a non-signer address.',
        details: { accountToClose, destination, signer },
      });
    });
    return findings;
  },
};

// -------- rule 8: token-freeze-abuse --------

export const tokenFreezeAbuse: Rule = {
  id: 'token-freeze-abuse',
  severity: 'high',
  description: 'SPL Token SetAuthority transferring FreezeAccount to a new key.',

  evaluate(ctx) {
    const findings: Finding[] = [];
    ctx.tx.message.instructions.forEach((ix, i) => {
      const pid = programIdOf(ctx.tx, ix);
      if (!isSplToken(pid)) return;
      if (ix.data.length < 3) return;
      if (ix.data[0] !== SPL_IX.SET_AUTHORITY) return;
      if (ix.data[1] !== SPL_AUTHORITY.FREEZE_ACCOUNT) return;
      if (ix.data[2] !== 1) return;
      findings.push({
        ruleId: 'token-freeze-abuse',
        severity: 'high',
        instructionIndex: i,
        message: 'Token freeze authority is being transferred — new holder can freeze any holder account.',
        details: { authorityType: 'freeze', programId: pid },
      });
    });
    return findings;
  },
};

// -------- rule 9: stake-authority-hijack --------

export const stakeAuthorityHijack: Rule = {
  id: 'stake-authority-hijack',
  severity: 'critical',
  description: 'Stake program Authorize reassigning staker or withdrawer authority.',

  evaluate(ctx) {
    const findings: Finding[] = [];
    ctx.tx.message.instructions.forEach((ix, i) => {
      const pid = programIdOf(ctx.tx, ix);
      if (pid !== STAKE) return;
      if (ix.data.length < 4) return;
      const disc = readU32LE(ix.data, 0);
      // Authorize data: [disc:u32 LE, newAuthority:Pubkey(32), stakeAuthorize:u32 LE]
      // AuthorizeChecked data: [disc:u32 LE, stakeAuthorize:u32 LE]
      let stakeAuthorize: number | null = null;
      if (disc === STAKE_IX.AUTHORIZE) {
        if (ix.data.length < 40) return;
        stakeAuthorize = readU32LE(ix.data, 36);
      } else if (disc === STAKE_IX.AUTHORIZE_CHECKED) {
        if (ix.data.length < 8) return;
        stakeAuthorize = readU32LE(ix.data, 4);
      } else {
        return;
      }
      const isWithdrawer = stakeAuthorize === 1;
      findings.push({
        ruleId: 'stake-authority-hijack',
        severity: isWithdrawer ? 'critical' : 'high',
        instructionIndex: i,
        message: isWithdrawer
          ? 'Stake withdrawer authority is being reassigned.'
          : 'Stake staker authority is being reassigned.',
        details: {
          stakeAuthorize: isWithdrawer ? 'withdrawer' : 'staker',
          variant: disc === STAKE_IX.AUTHORIZE_CHECKED ? 'checked' : 'unchecked',
        },
      });
    });
    return findings;
  },
};

// -------- rule 10: memo-exfiltration --------

const MEMO_MAX_LEN = 400;
const MEMO_NONPRINTABLE_RATIO = 0.5;

export const memoExfiltration: Rule = {
  id: 'memo-exfiltration',
  severity: 'low',
  description: 'Memo instruction carrying oversized or binary payload suggestive of data exfiltration.',

  evaluate(ctx) {
    const findings: Finding[] = [];
    ctx.tx.message.instructions.forEach((ix, i) => {
      const pid = programIdOf(ctx.tx, ix);
      if (pid !== MEMO) return;
      const len = ix.data.length;
      if (len === 0) return;
      let nonPrintable = 0;
      for (let k = 0; k < len; k++) {
        const b = ix.data[k]!;
        const printable = (b >= 0x20 && b <= 0x7e) || b === 0x09 || b === 0x0a || b === 0x0d;
        if (!printable) nonPrintable++;
      }
      const ratio = nonPrintable / len;
      if (len <= MEMO_MAX_LEN && ratio <= MEMO_NONPRINTABLE_RATIO) return;
      findings.push({
        ruleId: 'memo-exfiltration',
        severity: 'low',
        instructionIndex: i,
        message: 'Memo instruction carries a suspicious binary payload (possible data exfiltration).',
        details: { length: len, nonPrintableRatio: ratio },
      });
    });
    return findings;
  },
};

// -------- rule 11: compute-budget-anomaly --------

const CU_LIMIT_THRESHOLD = 1_200_000;

export const computeBudgetAnomaly: Rule = {
  id: 'compute-budget-anomaly',
  severity: 'low',
  description: 'Near-max compute unit limit paired with zero priority fee in the same transaction.',

  evaluate(ctx) {
    let limitIndex = -1;
    let limitValue = 0;
    let priceIndex = -1;
    ctx.tx.message.instructions.forEach((ix, i) => {
      const pid = programIdOf(ctx.tx, ix);
      if (pid !== COMPUTE_BUDGET) return;
      if (ix.data.length < 1) return;
      const disc = ix.data[0];
      // SetComputeUnitLimit: [disc:u8, limit:u32 LE]
      if (disc === COMPUTE_BUDGET_IX.SET_COMPUTE_UNIT_LIMIT) {
        if (ix.data.length < 5) return;
        const limit = readU32LE(ix.data, 1);
        if (limit > CU_LIMIT_THRESHOLD && limitIndex === -1) {
          limitIndex = i;
          limitValue = limit;
        }
        return;
      }
      // SetComputeUnitPrice: [disc:u8, microLamports:u64 LE]
      if (disc === COMPUTE_BUDGET_IX.SET_COMPUTE_UNIT_PRICE) {
        if (ix.data.length < 9) return;
        const micro = readU64LE(ix.data, 1);
        if (micro === 0n && priceIndex === -1) {
          priceIndex = i;
        }
      }
    });

    if (limitIndex === -1 || priceIndex === -1) return [];
    return [
      {
        ruleId: 'compute-budget-anomaly',
        severity: 'low',
        message: 'Unusual compute budget: near-maximum CU limit combined with zero priority fee.',
        details: {
          limit: limitValue,
          microLamports: '0',
          instructionIndexes: [limitIndex, priceIndex],
        },
      },
    ];
  },
};

// -------- rule 12: multisig-cosigner-manipulation --------

const MULTISIG_MIN_ACCOUNTS = 4;

export const multisigCosignerManipulation: Rule = {
  id: 'multisig-cosigner-manipulation',
  severity: 'critical',
  description:
    'SPL Token SetAuthority on an AccountOwner with a multisig-shaped account list (cosigner manipulation).',

  evaluate(ctx) {
    const findings: Finding[] = [];
    ctx.tx.message.instructions.forEach((ix, i) => {
      const pid = programIdOf(ctx.tx, ix);
      if (!isSplToken(pid)) return;
      if (ix.data.length < 3) return;
      if (ix.data[0] !== SPL_IX.SET_AUTHORITY) return;
      if (ix.data[1] !== SPL_AUTHORITY.ACCOUNT_OWNER) return;
      if (ix.accounts.length < MULTISIG_MIN_ACCOUNTS) return;
      findings.push({
        ruleId: 'multisig-cosigner-manipulation',
        severity: 'critical',
        instructionIndex: i,
        message: 'Account-owner change on a multisig-like account (likely cosigner manipulation).',
        details: { accountCount: ix.accounts.length, programId: pid },
      });
    });
    return findings;
  },
};

// -------- runner --------

export const BUILTIN_RULES: Rule[] = [
  unlimitedSplApproval,
  mintAuthorityTransfer,
  massTokenDrain,
  upgradeAuthoritySet,
  hiddenSolTransfer,
  splAccountOwnerChange,
  closeTokenAccountToAttacker,
  tokenFreezeAbuse,
  stakeAuthorityHijack,
  memoExfiltration,
  computeBudgetAnomaly,
  multisigCosignerManipulation,
];

const SEVERITY_WEIGHT: Record<Finding['severity'], number> = {
  low: 10,
  medium: 25,
  high: 55,
  critical: 90,
};

function verdictFrom(score: number): Verdict {
  if (score >= 60) return 'danger';
  if (score >= 25) return 'suspicious';
  return 'safe';
}

export async function runRules(
  ctx: InspectionContext,
  rules: Rule[] = BUILTIN_RULES,
): Promise<ThreatReport> {
  const started = Date.now();
  const findings: Finding[] = [];
  for (const rule of rules) {
    const out = await rule.evaluate(ctx);
    findings.push(...out);
  }

  let score = 0;
  for (const f of findings) score = Math.max(score, SEVERITY_WEIGHT[f.severity]);
  const verdict = verdictFrom(score);
  const summary =
    findings.length === 0
      ? 'No static rules matched. The transaction looks routine from a rules-only perspective.'
      : `${findings.length} finding${findings.length === 1 ? '' : 's'}: ${findings
          .map((f) => f.ruleId)
          .join(', ')}.`;

  return {
    verdict,
    score,
    findings,
    summary,
    elapsedMs: Date.now() - started,
  };
}
