import type { ThreatReport } from '@solshield/core';

export interface AnalyzerOptions {
  apiKey: string;
  model?: 'haiku' | 'sonnet';
}

export interface Analyzer {
  analyze(txBase64: string): Promise<ThreatReport>;
}

export function createAnalyzer(_opts: AnalyzerOptions): Analyzer {
  throw new Error('not implemented yet');
}
