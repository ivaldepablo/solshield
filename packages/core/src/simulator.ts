import type { DecodedTransaction } from './types';
import { encodePubkey } from './rules';

// -------- account state --------

export interface AccountState {
  lamports: number;
  owner: string;
  data: Uint8Array;
  executable: boolean;
}

export interface RawRpcAccount {
  lamports: number;
  owner: string;
  data: [string, string]; // [base64 string, encoding]
  executable: boolean;
  rentEpoch?: number | string;
}

export interface RawSimulateValue {
  err: unknown | null;
  logs: string[] | null;
  accounts?: Array<RawRpcAccount | null>;
  unitsConsumed?: number;
  returnData?: unknown;
  innerInstructions?: unknown;
}

// -------- diffs --------

export interface BalanceDiff {
  accountIndex: number;
  account: string;
  preLamports: number;
  postLamports: number;
  deltaLamports: number;
  isSigner: boolean;
  isWritable: boolean;
}

export interface TokenDiff {
  accountIndex: number;
  account: string;
  mint: string;
  owner: string;
  preAmount: bigint;
  postAmount: bigint;
  deltaAmount: bigint;
}

export interface SimulationResult {
  success: boolean;
  error?: string;
  logs: string[];
  unitsConsumed?: number;
  balanceDiffs: BalanceDiff[];
  tokenDiffs: TokenDiff[];
  signerSolDrainRatio: number; // 0..1, fraction of signer lamports lost
}

// -------- RPC interface (DI so core has no network dep) --------

export interface RpcClient {
  getMultipleAccounts(addresses: string[]): Promise<Array<AccountState | null>>;
  simulateTransaction(
    txBase64: string,
    accountsToReturn: string[],
  ): Promise<RawSimulateValue>;
}

// -------- SPL Token account parsing --------

const SPL_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const SPL_TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const TOKEN_ACCOUNT_LEN = 165;

// SPL Token account layout:
// 0..32   mint     : Pubkey
// 32..64  owner    : Pubkey
// 64..72  amount   : u64 LE
// remaining fields omitted (delegate, state, delegated_amount, close_authority, is_native)
function isTokenAccount(data: Uint8Array, owner: string): boolean {
  if (owner !== SPL_TOKEN_PROGRAM && owner !== SPL_TOKEN_2022_PROGRAM) return false;
  return data.length >= TOKEN_ACCOUNT_LEN;
}

function parseTokenAccount(data: Uint8Array): { mint: string; owner: string; amount: bigint } {
  const mint = encodePubkey(data.slice(0, 32));
  const owner = encodePubkey(data.slice(32, 64));
  let amount = 0n;
  for (let i = 71; i >= 64; i--) {
    const byte = data[i];
    amount = (amount << 8n) | BigInt(byte ?? 0);
  }
  return { mint, owner, amount };
}

// -------- account writability per message header --------

function accountFlags(tx: DecodedTransaction, index: number): { isSigner: boolean; isWritable: boolean } {
  const { numRequiredSignatures, numReadonlySignedAccounts, numReadonlyUnsignedAccounts } = tx.message.header;
  const total = tx.message.accountKeys.length;
  const numWritableSigned = numRequiredSignatures - numReadonlySignedAccounts;
  const numWritableUnsigned = total - numRequiredSignatures - numReadonlyUnsignedAccounts;

  const isSigner = index < numRequiredSignatures;
  let isWritable = false;
  if (index < numWritableSigned) isWritable = true;
  else if (index >= numRequiredSignatures && index < numRequiredSignatures + numWritableUnsigned) isWritable = true;
  return { isSigner, isWritable };
}

// -------- main --------

export async function simulate(
  tx: DecodedTransaction,
  txBase64: string,
  rpc: RpcClient,
): Promise<SimulationResult> {
  const accountKeys = tx.message.accountKeys.map(encodePubkey);

  const [preState, rawSim] = await Promise.all([
    rpc.getMultipleAccounts(accountKeys).catch((): Array<null> => accountKeys.map(() => null)),
    rpc.simulateTransaction(txBase64, accountKeys),
  ]);

  const logs = rawSim.logs ?? [];

  if (rawSim.err !== null) {
    return {
      success: false,
      error: typeof rawSim.err === 'string' ? rawSim.err : JSON.stringify(rawSim.err),
      logs,
      unitsConsumed: rawSim.unitsConsumed,
      balanceDiffs: [],
      tokenDiffs: [],
      signerSolDrainRatio: 0,
    };
  }

  const postState: Array<AccountState | null> = (rawSim.accounts ?? []).map((a) => {
    if (!a) return null;
    const [b64] = a.data;
    return {
      lamports: a.lamports,
      owner: a.owner,
      data: Uint8Array.from(Buffer.from(b64 ?? '', 'base64')),
      executable: a.executable,
    };
  });

  const balanceDiffs: BalanceDiff[] = [];
  const tokenDiffs: TokenDiff[] = [];

  for (let i = 0; i < accountKeys.length; i++) {
    const pre = preState[i];
    const post = postState[i];
    const account = accountKeys[i]!;
    const flags = accountFlags(tx, i);

    if (pre && post && pre.lamports !== post.lamports) {
      balanceDiffs.push({
        accountIndex: i,
        account,
        preLamports: pre.lamports,
        postLamports: post.lamports,
        deltaLamports: post.lamports - pre.lamports,
        ...flags,
      });
    }

    if (pre && post && isTokenAccount(pre.data, pre.owner) && isTokenAccount(post.data, post.owner)) {
      const preTok = parseTokenAccount(pre.data);
      const postTok = parseTokenAccount(post.data);
      if (preTok.amount !== postTok.amount) {
        tokenDiffs.push({
          accountIndex: i,
          account,
          mint: preTok.mint,
          owner: preTok.owner,
          preAmount: preTok.amount,
          postAmount: postTok.amount,
          deltaAmount: postTok.amount - preTok.amount,
        });
      }
    }
  }

  // signer = first account key. Compute fraction of SOL lost.
  let signerSolDrainRatio = 0;
  const signerDiff = balanceDiffs.find((d) => d.accountIndex === 0);
  if (signerDiff && signerDiff.preLamports > 0 && signerDiff.deltaLamports < 0) {
    signerSolDrainRatio = Math.min(1, -signerDiff.deltaLamports / signerDiff.preLamports);
  }

  return {
    success: true,
    logs,
    unitsConsumed: rawSim.unitsConsumed,
    balanceDiffs,
    tokenDiffs,
    signerSolDrainRatio,
  };
}
