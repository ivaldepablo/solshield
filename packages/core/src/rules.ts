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

// -------- spl token instruction layout --------

const SPL_IX = {
  TRANSFER: 3,
  APPROVE: 4,
  SET_AUTHORITY: 6,
  TRANSFER_CHECKED: 12,
  APPROVE_CHECKED: 13,
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
  description: 'SetAuthority reassigning mint or freeze authority to a new key.',

  evaluate(ctx) {
    const findings: Finding[] = [];
    ctx.tx.message.instructions.forEach((ix, i) => {
      const pid = programIdOf(ctx.tx, ix);
      if (!isSplToken(pid)) return;
      if (ix.data.length < 3) return;
      if (ix.data[0] !== SPL_IX.SET_AUTHORITY) return;
      const authorityType = ix.data[1]!;
      const isSensitive =
        authorityType === SPL_AUTHORITY.MINT_TOKENS ||
        authorityType === SPL_AUTHORITY.FREEZE_ACCOUNT;
      if (!isSensitive) return;
      const isSetNotClear = ix.data[2] === 1;
      if (!isSetNotClear) return;
      const label = authorityType === SPL_AUTHORITY.MINT_TOKENS ? 'mint' : 'freeze';
      findings.push({
        ruleId: 'mint-authority-transfer',
        severity: 'critical',
        instructionIndex: i,
        message: `${label} authority is being reassigned to a new key.`,
        details: { authorityType: label },
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

// -------- runner --------

export const BUILTIN_RULES: Rule[] = [
  unlimitedSplApproval,
  mintAuthorityTransfer,
  massTokenDrain,
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
