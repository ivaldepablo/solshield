import type { ThreatReport } from '@solshield/core';

export interface SolShieldClientOptions {
  endpoint: string;
  apiKey?: string;
}

export class SolShieldClient {
  constructor(private opts: SolShieldClientOptions) {}

  async inspect(_txBase64: string): Promise<ThreatReport> {
    throw new Error('not implemented yet');
  }
}
