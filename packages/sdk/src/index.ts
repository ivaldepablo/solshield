import type { ThreatReport } from '@solshield/core';

export interface SolShieldClientOptions {
  endpoint: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface InspectRequest {
  tx: string;
  encoding?: 'base64';
  network?: 'mainnet' | 'devnet';
}

export class SolShieldClient {
  private readonly endpoint: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: SolShieldClientOptions) {
    this.endpoint = opts.endpoint.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  async inspect(req: InspectRequest): Promise<ThreatReport> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.endpoint}/api/inspect`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({ encoding: 'base64', network: 'mainnet', ...req }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new SolShieldError(`inspect failed: ${res.status} ${body}`.trim(), res.status);
      }
      return (await res.json()) as ThreatReport;
    } finally {
      clearTimeout(timer);
    }
  }
}

export class SolShieldError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'SolShieldError';
  }
}
