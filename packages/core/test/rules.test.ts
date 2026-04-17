import { describe, it, expect } from 'vitest';
import type { InspectionContext } from '../src/types';
import {
  ASSOCIATED_TOKEN,
  BPF_LOADER_UPGRADEABLE,
  BUILTIN_RULES,
  COMPUTE_BUDGET,
  MEMO,
  SPL_TOKEN,
  SPL_TOKEN_2022,
  STAKE,
  SYSTEM_PROGRAM,
  closeTokenAccountToAttacker,
  computeBudgetAnomaly,
  hiddenSolTransfer,
  massTokenDrain,
  memoExfiltration,
  mintAuthorityTransfer,
  multisigCosignerManipulation,
  runRules,
  splAccountOwnerChange,
  stakeAuthorityHijack,
  tokenFreezeAbuse,
  unlimitedSplApproval,
  upgradeAuthoritySet,
} from '../src/rules';
import { concat, key, mockTx, u32LE, u64LE, u8Data } from './fixtures';

function ctx(tx: ReturnType<typeof mockTx>): InspectionContext {
  return { tx, network: 'mainnet', now: new Date('2026-01-01T00:00:00Z') };
}

// SPL Approve layout: [disc:u8, amount:u64 LE]
function splApproveData(amount: bigint, checked = false): Uint8Array {
  const disc = checked ? 13 : 4;
  // Approve-checked also carries a decimals byte after the amount, which the
  // rule ignores; tacking on a trailing zero keeps the data realistic.
  const tail = checked ? u8Data(0) : new Uint8Array(0);
  return concat(u8Data(disc), u64LE(amount), tail);
}

// SPL SetAuthority layout: [disc:u8, authorityType:u8, option:u8, newAuthority?:Pubkey]
function splSetAuthorityData(authorityType: number, newAuthoritySet: boolean): Uint8Array {
  const option = newAuthoritySet ? 1 : 0;
  const newAuthority = newAuthoritySet ? new Uint8Array(32) : new Uint8Array(0);
  return concat(u8Data(6, authorityType, option), newAuthority);
}

// SPL Transfer layout: [disc:u8, amount:u64 LE]
function splTransferData(amount: bigint): Uint8Array {
  return concat(u8Data(3), u64LE(amount));
}

// BPF Loader Upgradeable SetAuthority: [disc:u32 LE]
function bpfSetAuthorityData(disc = 4): Uint8Array {
  return u32LE(disc);
}

// System transfer: [disc:u32 LE = 2, lamports:u64 LE]
function systemTransferData(lamports: bigint): Uint8Array {
  return concat(u32LE(2), u64LE(lamports));
}

describe('unlimitedSplApproval', () => {
  it('flags an approve with an unlimited amount', async () => {
    const tx = mockTx({
      accountKeys: [key('fee-payer'), key('source'), key('delegate'), SPL_TOKEN],
      instructions: [
        {
          programId: SPL_TOKEN,
          accountIndexes: [1, 2, 0],
          data: splApproveData(2n ** 63n),
        },
      ],
    });
    const findings = await unlimitedSplApproval.evaluate(ctx(tx));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: 'unlimited-spl-approval',
      severity: 'high',
      instructionIndex: 0,
    });
  });

  it('does not flag an approve under the threshold', async () => {
    const tx = mockTx({
      accountKeys: [key('fee-payer'), key('source'), key('delegate'), SPL_TOKEN],
      instructions: [
        {
          programId: SPL_TOKEN,
          accountIndexes: [1, 2, 0],
          data: splApproveData(1_000_000n),
        },
      ],
    });
    const findings = await unlimitedSplApproval.evaluate(ctx(tx));
    expect(findings).toHaveLength(0);
  });
});

describe('mintAuthorityTransfer', () => {
  it('flags a mint authority reassignment', async () => {
    const tx = mockTx({
      accountKeys: [key('fee-payer'), key('mint'), key('current-auth'), SPL_TOKEN],
      instructions: [
        {
          programId: SPL_TOKEN,
          accountIndexes: [1, 2],
          data: splSetAuthorityData(0, true),
        },
      ],
    });
    const findings = await mintAuthorityTransfer.evaluate(ctx(tx));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: 'mint-authority-transfer',
      severity: 'critical',
      instructionIndex: 0,
    });
  });

  it('does not flag clearing an account-owner authority', async () => {
    const tx = mockTx({
      accountKeys: [key('fee-payer'), key('acct'), key('current-auth'), SPL_TOKEN],
      instructions: [
        {
          programId: SPL_TOKEN,
          accountIndexes: [1, 2],
          data: splSetAuthorityData(2, false),
        },
      ],
    });
    const findings = await mintAuthorityTransfer.evaluate(ctx(tx));
    expect(findings).toHaveLength(0);
  });

  it('does not flag a freeze authority reassignment (covered by tokenFreezeAbuse)', async () => {
    const tx = mockTx({
      accountKeys: [key('fee-payer'), key('mint'), key('current-auth'), SPL_TOKEN],
      instructions: [
        {
          programId: SPL_TOKEN,
          accountIndexes: [1, 2],
          data: splSetAuthorityData(1, true),
        },
      ],
    });
    const findings = await mintAuthorityTransfer.evaluate(ctx(tx));
    expect(findings).toHaveLength(0);
  });
});

describe('massTokenDrain', () => {
  it('flags three or more transfers converging on one destination', async () => {
    const tx = mockTx({
      accountKeys: [
        key('fee-payer'),
        key('source-a'),
        key('source-b'),
        key('source-c'),
        key('attacker'),
        key('authority'),
        SPL_TOKEN,
      ],
      instructions: [
        { programId: SPL_TOKEN, accountIndexes: [1, 4, 5], data: splTransferData(1n) },
        { programId: SPL_TOKEN, accountIndexes: [2, 4, 5], data: splTransferData(1n) },
        { programId: SPL_TOKEN, accountIndexes: [3, 4, 5], data: splTransferData(1n) },
      ],
    });
    const findings = await massTokenDrain.evaluate(ctx(tx));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: 'mass-token-drain',
      severity: 'critical',
    });
    const details = findings[0]?.details as { instructionIndexes: number[] };
    expect(details.instructionIndexes).toEqual([0, 1, 2]);
  });

  it('does not flag two transfers to the same destination', async () => {
    const tx = mockTx({
      accountKeys: [
        key('fee-payer'),
        key('source-a'),
        key('source-b'),
        key('recipient'),
        key('authority'),
        SPL_TOKEN,
      ],
      instructions: [
        { programId: SPL_TOKEN, accountIndexes: [1, 3, 4], data: splTransferData(1n) },
        { programId: SPL_TOKEN, accountIndexes: [2, 3, 4], data: splTransferData(1n) },
      ],
    });
    const findings = await massTokenDrain.evaluate(ctx(tx));
    expect(findings).toHaveLength(0);
  });
});

describe('upgradeAuthoritySet', () => {
  it('flags a BPF Loader Upgradeable SetAuthority with a new authority', async () => {
    const tx = mockTx({
      accountKeys: [
        key('fee-payer'),
        key('program-data'),
        key('current-authority'),
        key('new-authority'),
        BPF_LOADER_UPGRADEABLE,
      ],
      instructions: [
        {
          programId: BPF_LOADER_UPGRADEABLE,
          accountIndexes: [1, 2, 3],
          data: bpfSetAuthorityData(4),
        },
      ],
    });
    const findings = await upgradeAuthoritySet.evaluate(ctx(tx));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: 'upgrade-authority-set',
      severity: 'critical',
      instructionIndex: 0,
    });
  });

  it('also flags SetAuthorityChecked (disc 7)', async () => {
    const tx = mockTx({
      accountKeys: [
        key('fee-payer'),
        key('program-data'),
        key('current-authority'),
        key('new-authority'),
        BPF_LOADER_UPGRADEABLE,
      ],
      instructions: [
        {
          programId: BPF_LOADER_UPGRADEABLE,
          accountIndexes: [1, 2, 3],
          data: bpfSetAuthorityData(7),
        },
      ],
    });
    const findings = await upgradeAuthoritySet.evaluate(ctx(tx));
    expect(findings).toHaveLength(1);
    const details = findings[0]?.details as { variant: string };
    expect(details.variant).toBe('checked');
  });

  it('does not flag when the authority is being cleared (only 2 accounts)', async () => {
    const tx = mockTx({
      accountKeys: [
        key('fee-payer'),
        key('program-data'),
        key('current-authority'),
        BPF_LOADER_UPGRADEABLE,
      ],
      instructions: [
        {
          programId: BPF_LOADER_UPGRADEABLE,
          accountIndexes: [1, 2],
          data: bpfSetAuthorityData(4),
        },
      ],
    });
    const findings = await upgradeAuthoritySet.evaluate(ctx(tx));
    expect(findings).toHaveLength(0);
  });
});

describe('hiddenSolTransfer', () => {
  it('flags a fee-payer SOL transfer alongside an unrecognized program', async () => {
    const unknownProgram = key('unknown-program');
    const tx = mockTx({
      accountKeys: [
        key('fee-payer'),
        key('recipient'),
        SYSTEM_PROGRAM,
        unknownProgram,
      ],
      instructions: [
        {
          programId: SYSTEM_PROGRAM,
          accountIndexes: [0, 1],
          data: systemTransferData(1_000_000_000n),
        },
        {
          programId: unknownProgram,
          accountIndexes: [0],
          data: u8Data(0, 1, 2, 3),
        },
      ],
    });
    const findings = await hiddenSolTransfer.evaluate(ctx(tx));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: 'hidden-sol-transfer',
      severity: 'high',
      instructionIndex: 0,
    });
    const details = findings[0]?.details as { unknownPrograms: string[] };
    expect(details.unknownPrograms).toContain(unknownProgram);
  });

  it('does not flag when every other program is on the allowlist', async () => {
    const tx = mockTx({
      accountKeys: [
        key('fee-payer'),
        key('recipient'),
        key('mint'),
        SYSTEM_PROGRAM,
        SPL_TOKEN,
        COMPUTE_BUDGET,
        MEMO,
        ASSOCIATED_TOKEN,
        STAKE,
        SPL_TOKEN_2022,
      ],
      instructions: [
        { programId: SYSTEM_PROGRAM, accountIndexes: [0, 1], data: systemTransferData(500n) },
        { programId: SPL_TOKEN, accountIndexes: [1, 2, 0], data: splTransferData(1n) },
        { programId: COMPUTE_BUDGET, accountIndexes: [], data: u8Data(0) },
        { programId: MEMO, accountIndexes: [], data: u8Data(1) },
        { programId: ASSOCIATED_TOKEN, accountIndexes: [], data: u8Data(0) },
        { programId: STAKE, accountIndexes: [], data: u8Data(0) },
        { programId: SPL_TOKEN_2022, accountIndexes: [1, 2, 0], data: splTransferData(1n) },
      ],
    });
    const findings = await hiddenSolTransfer.evaluate(ctx(tx));
    expect(findings).toHaveLength(0);
  });

  it('does not flag when the SOL transfer is not from the fee payer', async () => {
    const unknownProgram = key('mystery');
    const tx = mockTx({
      accountKeys: [
        key('fee-payer'),
        key('other-source'),
        key('recipient'),
        SYSTEM_PROGRAM,
        unknownProgram,
      ],
      instructions: [
        {
          programId: SYSTEM_PROGRAM,
          accountIndexes: [1, 2],
          data: systemTransferData(1_000n),
        },
        { programId: unknownProgram, accountIndexes: [], data: u8Data(9) },
      ],
    });
    const findings = await hiddenSolTransfer.evaluate(ctx(tx));
    expect(findings).toHaveLength(0);
  });
});

describe('splAccountOwnerChange', () => {
  it('flags a SetAuthority on AccountOwner with a new authority', async () => {
    const tx = mockTx({
      accountKeys: [key('fee-payer'), key('token-account'), key('current-owner'), SPL_TOKEN],
      instructions: [
        {
          programId: SPL_TOKEN,
          accountIndexes: [1, 2],
          data: splSetAuthorityData(2, true),
        },
      ],
    });
    const findings = await splAccountOwnerChange.evaluate(ctx(tx));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: 'spl-account-owner-change',
      severity: 'critical',
      instructionIndex: 0,
    });
  });

  it('does not flag a mint authority reassignment', async () => {
    const tx = mockTx({
      accountKeys: [key('fee-payer'), key('mint'), key('current-auth'), SPL_TOKEN],
      instructions: [
        {
          programId: SPL_TOKEN,
          accountIndexes: [1, 2],
          data: splSetAuthorityData(0, true),
        },
      ],
    });
    const findings = await splAccountOwnerChange.evaluate(ctx(tx));
    expect(findings).toHaveLength(0);
  });

  it('does not flag when the AccountOwner authority is being cleared', async () => {
    const tx = mockTx({
      accountKeys: [key('fee-payer'), key('token-account'), key('current-owner'), SPL_TOKEN],
      instructions: [
        {
          programId: SPL_TOKEN,
          accountIndexes: [1, 2],
          data: splSetAuthorityData(2, false),
        },
      ],
    });
    const findings = await splAccountOwnerChange.evaluate(ctx(tx));
    expect(findings).toHaveLength(0);
  });
});

describe('closeTokenAccountToAttacker', () => {
  it('flags CloseAccount when rent destination is not the signer', async () => {
    const tx = mockTx({
      accountKeys: [
        key('fee-payer'),
        key('token-account'),
        key('attacker-wallet'),
        key('owner'),
        SPL_TOKEN,
      ],
      instructions: [
        {
          programId: SPL_TOKEN,
          accountIndexes: [1, 2, 3],
          data: u8Data(9),
        },
      ],
    });
    const findings = await closeTokenAccountToAttacker.evaluate(ctx(tx));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: 'close-token-account-to-attacker',
      severity: 'high',
      instructionIndex: 0,
    });
  });

  it('does not flag CloseAccount when rent returns to the signer', async () => {
    const feePayer = key('fee-payer');
    const tx = mockTx({
      accountKeys: [feePayer, key('token-account'), key('owner'), SPL_TOKEN],
      instructions: [
        {
          programId: SPL_TOKEN,
          accountIndexes: [1, 0, 2],
          data: u8Data(9),
        },
      ],
    });
    const findings = await closeTokenAccountToAttacker.evaluate(ctx(tx));
    expect(findings).toHaveLength(0);
  });
});

describe('tokenFreezeAbuse', () => {
  it('flags a SetAuthority on FreezeAccount with a new authority', async () => {
    const tx = mockTx({
      accountKeys: [key('fee-payer'), key('mint'), key('current-auth'), SPL_TOKEN],
      instructions: [
        {
          programId: SPL_TOKEN,
          accountIndexes: [1, 2],
          data: splSetAuthorityData(1, true),
        },
      ],
    });
    const findings = await tokenFreezeAbuse.evaluate(ctx(tx));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: 'token-freeze-abuse',
      severity: 'high',
      instructionIndex: 0,
    });
  });

  it('does not flag clearing the freeze authority', async () => {
    const tx = mockTx({
      accountKeys: [key('fee-payer'), key('mint'), key('current-auth'), SPL_TOKEN],
      instructions: [
        {
          programId: SPL_TOKEN,
          accountIndexes: [1, 2],
          data: splSetAuthorityData(1, false),
        },
      ],
    });
    const findings = await tokenFreezeAbuse.evaluate(ctx(tx));
    expect(findings).toHaveLength(0);
  });

  it('does not flag a mint authority change', async () => {
    const tx = mockTx({
      accountKeys: [key('fee-payer'), key('mint'), key('current-auth'), SPL_TOKEN],
      instructions: [
        {
          programId: SPL_TOKEN,
          accountIndexes: [1, 2],
          data: splSetAuthorityData(0, true),
        },
      ],
    });
    const findings = await tokenFreezeAbuse.evaluate(ctx(tx));
    expect(findings).toHaveLength(0);
  });
});

// Stake Authorize layout: [disc:u32 LE, newAuthority:Pubkey(32), stakeAuthorize:u32 LE]
function stakeAuthorizeData(stakeAuthorize: number): Uint8Array {
  return concat(u32LE(1), new Uint8Array(32), u32LE(stakeAuthorize));
}

// Stake AuthorizeChecked layout: [disc:u32 LE, stakeAuthorize:u32 LE]
function stakeAuthorizeCheckedData(stakeAuthorize: number): Uint8Array {
  return concat(u32LE(10), u32LE(stakeAuthorize));
}

describe('stakeAuthorityHijack', () => {
  it('marks a withdrawer reassignment as critical', async () => {
    const tx = mockTx({
      accountKeys: [key('fee-payer'), key('stake-account'), key('current-auth'), STAKE],
      instructions: [
        {
          programId: STAKE,
          accountIndexes: [1, 2],
          data: stakeAuthorizeData(1),
        },
      ],
    });
    const findings = await stakeAuthorityHijack.evaluate(ctx(tx));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: 'stake-authority-hijack',
      severity: 'critical',
      instructionIndex: 0,
    });
  });

  it('marks a staker reassignment as high', async () => {
    const tx = mockTx({
      accountKeys: [key('fee-payer'), key('stake-account'), key('current-auth'), STAKE],
      instructions: [
        {
          programId: STAKE,
          accountIndexes: [1, 2],
          data: stakeAuthorizeData(0),
        },
      ],
    });
    const findings = await stakeAuthorityHijack.evaluate(ctx(tx));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: 'stake-authority-hijack',
      severity: 'high',
    });
  });

  it('also flags AuthorizeChecked variant', async () => {
    const tx = mockTx({
      accountKeys: [key('fee-payer'), key('stake-account'), key('current-auth'), STAKE],
      instructions: [
        {
          programId: STAKE,
          accountIndexes: [1, 2],
          data: stakeAuthorizeCheckedData(1),
        },
      ],
    });
    const findings = await stakeAuthorityHijack.evaluate(ctx(tx));
    expect(findings).toHaveLength(1);
    const details = findings[0]?.details as { variant: string };
    expect(details.variant).toBe('checked');
  });

  it('does not flag unrelated stake instructions', async () => {
    // disc 3 = Withdraw, not Authorize.
    const tx = mockTx({
      accountKeys: [key('fee-payer'), key('stake-account'), STAKE],
      instructions: [
        {
          programId: STAKE,
          accountIndexes: [1],
          data: concat(u32LE(3), u64LE(1_000n)),
        },
      ],
    });
    const findings = await stakeAuthorityHijack.evaluate(ctx(tx));
    expect(findings).toHaveLength(0);
  });
});

describe('memoExfiltration', () => {
  it('flags a memo payload above the size threshold', async () => {
    const tx = mockTx({
      accountKeys: [key('fee-payer'), MEMO],
      instructions: [
        {
          programId: MEMO,
          accountIndexes: [],
          // 500 printable 'a' characters.
          data: Uint8Array.from({ length: 500 }, () => 0x61),
        },
      ],
    });
    const findings = await memoExfiltration.evaluate(ctx(tx));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: 'memo-exfiltration',
      severity: 'low',
      instructionIndex: 0,
    });
    const details = findings[0]?.details as { length: number };
    expect(details.length).toBe(500);
  });

  it('flags a memo payload with high non-printable ratio', async () => {
    // 100 bytes, 80 of which are 0x00 (non-printable).
    const bytes = new Uint8Array(100);
    for (let i = 80; i < 100; i++) bytes[i] = 0x41;
    const tx = mockTx({
      accountKeys: [key('fee-payer'), MEMO],
      instructions: [{ programId: MEMO, accountIndexes: [], data: bytes }],
    });
    const findings = await memoExfiltration.evaluate(ctx(tx));
    expect(findings).toHaveLength(1);
    const details = findings[0]?.details as { nonPrintableRatio: number };
    expect(details.nonPrintableRatio).toBeCloseTo(0.8, 5);
  });

  it('does not flag a short, human-readable memo', async () => {
    const tx = mockTx({
      accountKeys: [key('fee-payer'), MEMO],
      instructions: [
        {
          programId: MEMO,
          accountIndexes: [],
          data: new TextEncoder().encode('Order #1234 — thanks!'),
        },
      ],
    });
    const findings = await memoExfiltration.evaluate(ctx(tx));
    expect(findings).toHaveLength(0);
  });
});

// SetComputeUnitLimit: [disc:u8=2, limit:u32 LE]
function cuLimitData(limit: number): Uint8Array {
  return concat(u8Data(2), u32LE(limit));
}

// SetComputeUnitPrice: [disc:u8=3, microLamports:u64 LE]
function cuPriceData(microLamports: bigint): Uint8Array {
  return concat(u8Data(3), u64LE(microLamports));
}

describe('computeBudgetAnomaly', () => {
  it('flags a near-max CU limit paired with zero priority fee', async () => {
    const tx = mockTx({
      accountKeys: [key('fee-payer'), COMPUTE_BUDGET],
      instructions: [
        { programId: COMPUTE_BUDGET, accountIndexes: [], data: cuLimitData(1_400_000) },
        { programId: COMPUTE_BUDGET, accountIndexes: [], data: cuPriceData(0n) },
      ],
    });
    const findings = await computeBudgetAnomaly.evaluate(ctx(tx));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: 'compute-budget-anomaly',
      severity: 'low',
    });
    const details = findings[0]?.details as { instructionIndexes: number[]; limit: number };
    expect(details.instructionIndexes).toEqual([0, 1]);
    expect(details.limit).toBe(1_400_000);
  });

  it('does not flag a high CU limit when the priority fee is non-zero', async () => {
    const tx = mockTx({
      accountKeys: [key('fee-payer'), COMPUTE_BUDGET],
      instructions: [
        { programId: COMPUTE_BUDGET, accountIndexes: [], data: cuLimitData(1_400_000) },
        { programId: COMPUTE_BUDGET, accountIndexes: [], data: cuPriceData(1_000n) },
      ],
    });
    const findings = await computeBudgetAnomaly.evaluate(ctx(tx));
    expect(findings).toHaveLength(0);
  });

  it('does not flag a modest CU limit even with zero priority fee', async () => {
    const tx = mockTx({
      accountKeys: [key('fee-payer'), COMPUTE_BUDGET],
      instructions: [
        { programId: COMPUTE_BUDGET, accountIndexes: [], data: cuLimitData(200_000) },
        { programId: COMPUTE_BUDGET, accountIndexes: [], data: cuPriceData(0n) },
      ],
    });
    const findings = await computeBudgetAnomaly.evaluate(ctx(tx));
    expect(findings).toHaveLength(0);
  });
});

describe('multisigCosignerManipulation', () => {
  it('flags an account-owner change with four or more accounts (multisig-like)', async () => {
    const tx = mockTx({
      accountKeys: [
        key('fee-payer'),
        key('token-account'),
        key('multisig-owner'),
        key('signer-a'),
        key('signer-b'),
        key('signer-c'),
        SPL_TOKEN,
      ],
      instructions: [
        {
          programId: SPL_TOKEN,
          accountIndexes: [1, 2, 3, 4, 5],
          data: splSetAuthorityData(2, true),
        },
      ],
    });
    const findings = await multisigCosignerManipulation.evaluate(ctx(tx));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: 'multisig-cosigner-manipulation',
      severity: 'critical',
      instructionIndex: 0,
    });
    const details = findings[0]?.details as { accountCount: number };
    expect(details.accountCount).toBe(5);
  });

  it('does not flag a plain two-account SetAuthority on AccountOwner', async () => {
    const tx = mockTx({
      accountKeys: [key('fee-payer'), key('token-account'), key('current-owner'), SPL_TOKEN],
      instructions: [
        {
          programId: SPL_TOKEN,
          accountIndexes: [1, 2],
          data: splSetAuthorityData(2, true),
        },
      ],
    });
    const findings = await multisigCosignerManipulation.evaluate(ctx(tx));
    expect(findings).toHaveLength(0);
  });

  it('does not flag a multisig-shaped mint authority change', async () => {
    const tx = mockTx({
      accountKeys: [
        key('fee-payer'),
        key('mint'),
        key('ms-owner'),
        key('signer-a'),
        key('signer-b'),
        SPL_TOKEN,
      ],
      instructions: [
        {
          programId: SPL_TOKEN,
          accountIndexes: [1, 2, 3, 4],
          data: splSetAuthorityData(0, true),
        },
      ],
    });
    const findings = await multisigCosignerManipulation.evaluate(ctx(tx));
    expect(findings).toHaveLength(0);
  });
});

describe('runRules', () => {
  it('returns a safe verdict on a benign transaction', async () => {
    const tx = mockTx({
      accountKeys: [key('fee-payer'), key('recipient'), SYSTEM_PROGRAM],
      instructions: [
        {
          programId: SYSTEM_PROGRAM,
          accountIndexes: [0, 1],
          data: systemTransferData(1_000n),
        },
      ],
    });
    const report = await runRules(ctx(tx), BUILTIN_RULES);
    expect(report.verdict).toBe('safe');
    expect(report.score).toBe(0);
    expect(report.findings).toHaveLength(0);
  });

  it('rolls up to the worst severity when multiple findings fire', async () => {
    // High: unlimited approve. Critical: mint-authority transfer.
    const tx = mockTx({
      accountKeys: [key('fee-payer'), key('mint'), key('delegate'), key('auth'), SPL_TOKEN],
      instructions: [
        {
          programId: SPL_TOKEN,
          accountIndexes: [1, 2, 0],
          data: splApproveData(2n ** 63n),
        },
        {
          programId: SPL_TOKEN,
          accountIndexes: [1, 3],
          data: splSetAuthorityData(0, true),
        },
      ],
    });
    const report = await runRules(ctx(tx), BUILTIN_RULES);
    expect(report.findings.length).toBeGreaterThanOrEqual(2);
    expect(report.verdict).toBe('danger');
    expect(report.score).toBe(90);
    const severities = report.findings.map((f) => f.severity);
    expect(severities).toContain('critical');
    expect(severities).toContain('high');
  });
});

describe('runRules (multiple findings)', () => {
  it('aggregates several distinct rule hits in one transaction', async () => {
    // Critical: multisig cosigner manipulation + spl-account-owner-change
    //           on a 5-account SetAuthority(AccountOwner).
    // High:     token freeze authority transfer.
    // Low:      compute-budget anomaly (near-max CU + zero price).
    const tx = mockTx({
      accountKeys: [
        key('fee-payer'),
        key('token-account'),
        key('multisig-owner'),
        key('signer-a'),
        key('signer-b'),
        key('signer-c'),
        key('mint'),
        key('freeze-auth'),
        SPL_TOKEN,
        COMPUTE_BUDGET,
      ],
      instructions: [
        { programId: COMPUTE_BUDGET, accountIndexes: [], data: cuLimitData(1_400_000) },
        { programId: COMPUTE_BUDGET, accountIndexes: [], data: cuPriceData(0n) },
        {
          programId: SPL_TOKEN,
          accountIndexes: [1, 2, 3, 4, 5],
          data: splSetAuthorityData(2, true),
        },
        {
          programId: SPL_TOKEN,
          accountIndexes: [6, 7],
          data: splSetAuthorityData(1, true),
        },
      ],
    });
    const report = await runRules(ctx(tx), BUILTIN_RULES);
    const ruleIds = new Set(report.findings.map((f) => f.ruleId));
    expect(report.findings.length).toBeGreaterThanOrEqual(3);
    expect(ruleIds.size).toBeGreaterThanOrEqual(3);
    expect(report.verdict).toBe('danger');
    expect(report.score).toBeGreaterThanOrEqual(90);
  });
});
