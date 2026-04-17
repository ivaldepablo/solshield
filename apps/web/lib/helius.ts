import type { AccountState, RawSimulateValue, RpcClient } from '@solshield/core';

const DEFAULT_TIMEOUT_MS = 12_000;

export class HeliusRpc implements RpcClient {
  private readonly endpoint: string;
  private readonly timeoutMs: number;

  constructor(endpoint: string, timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    this.endpoint = endpoint;
    this.timeoutMs = timeoutMs;
  }

  async getMultipleAccounts(addresses: string[]): Promise<Array<AccountState | null>> {
    if (addresses.length === 0) return [];
    const result = await this.call<{
      value: Array<{
        lamports: number;
        owner: string;
        data: [string, string];
        executable: boolean;
      } | null>;
    }>('getMultipleAccounts', [
      addresses,
      { commitment: 'confirmed', encoding: 'base64' },
    ]);

    return result.value.map((a) => {
      if (!a) return null;
      const [b64] = a.data;
      return {
        lamports: a.lamports,
        owner: a.owner,
        data: Uint8Array.from(Buffer.from(b64 ?? '', 'base64')),
        executable: a.executable,
      };
    });
  }

  async simulateTransaction(
    txBase64: string,
    accountsToReturn: string[],
  ): Promise<RawSimulateValue> {
    const result = await this.call<{ value: RawSimulateValue }>('simulateTransaction', [
      txBase64,
      {
        commitment: 'confirmed',
        sigVerify: false,
        replaceRecentBlockhash: true,
        encoding: 'base64',
        ...(accountsToReturn.length > 0
          ? { accounts: { encoding: 'base64', addresses: accountsToReturn } }
          : {}),
      },
    ]);
    return result.value;
  }

  private async call<T>(method: string, params: unknown[]): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`RPC ${method} HTTP ${res.status}`);
      }
      const body = (await res.json()) as { result?: T; error?: { message?: string } };
      if (body.error) {
        throw new Error(`RPC ${method}: ${body.error.message ?? JSON.stringify(body.error)}`);
      }
      if (!body.result) {
        throw new Error(`RPC ${method}: empty result`);
      }
      return body.result;
    } finally {
      clearTimeout(timer);
    }
  }
}

let cached: HeliusRpc | null = null;

export function getHeliusRpc(): HeliusRpc | null {
  if (cached) return cached;
  const endpoint = process.env.SOLANA_RPC_URL;
  if (!endpoint) return null;
  cached = new HeliusRpc(endpoint);
  return cached;
}
