import type { ThreatReport } from '@solshield/core';

export type Model = 'haiku-4-5' | 'sonnet-4-6' | 'opus-4-7';

export interface AnalyzerOptions {
  apiKey: string;
  fastModel?: Model;
  deepModel?: Model;
}

export interface Analyzer {
  analyze(txBase64: string): Promise<ThreatReport>;
}

export function createAnalyzer(_opts: AnalyzerOptions): Analyzer {
  throw new Error('not implemented yet');
}
