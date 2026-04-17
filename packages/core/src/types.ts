export type RiskLevel = 'safe' | 'suspicious' | 'danger';

export interface ThreatReport {
  level: RiskLevel;
  score: number;
  reasons: string[];
  raw?: unknown;
}

export interface RuleContext {
  tx: Uint8Array;
  network: 'mainnet' | 'devnet';
}

export interface Rule {
  id: string;
  description: string;
  evaluate(ctx: RuleContext): Promise<ThreatReport | null>;
}
