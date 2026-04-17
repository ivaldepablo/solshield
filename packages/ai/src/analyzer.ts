import Anthropic from '@anthropic-ai/sdk';
import type { DecodedTransaction, Finding, ThreatReport, Verdict } from '@solshield/core';
import { encodePubkey, programIdOf } from '@solshield/core';
import { DEEP_SYSTEM, TRIAGE_SYSTEM } from './prompts';

export type ModelTier = 'triage' | 'deep';

const MODEL_IDS: Record<ModelTier, string> = {
  triage: 'claude-haiku-4-5',
  deep: 'claude-opus-4-7',
};

export interface AnalyzerOptions {
  apiKey: string;
  triageModel?: string;
  deepModel?: string;
}

export interface TriageResult {
  verdict: Verdict;
  confidence: number;
  reason: string;
  needsDeepReview: boolean;
}

export class Analyzer {
  private readonly client: Anthropic;
  private readonly triageModel: string;
  private readonly deepModel: string;

  constructor(opts: AnalyzerOptions) {
    this.client = new Anthropic({ apiKey: opts.apiKey });
    this.triageModel = opts.triageModel ?? MODEL_IDS.triage;
    this.deepModel = opts.deepModel ?? MODEL_IDS.deep;
  }

  async triage(tx: DecodedTransaction): Promise<TriageResult> {
    const response = await this.client.messages.create({
      model: this.triageModel,
      max_tokens: 512,
      system: [
        {
          type: 'text',
          text: TRIAGE_SYSTEM,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: summarizeTransaction(tx) }],
    });

    const text = firstTextBlock(response);
    return parseJson<TriageResult>(text, {
      verdict: 'suspicious',
      confidence: 0.5,
      reason: 'Triage model returned unparseable output; treating as suspicious.',
      needsDeepReview: true,
    });
  }

  async deepAnalyze(
    tx: DecodedTransaction,
    priorFindings: Finding[],
  ): Promise<ThreatReport> {
    const response = await this.client.messages.create({
      model: this.deepModel,
      max_tokens: 2048,
      system: [
        {
          type: 'text',
          text: DEEP_SYSTEM,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: `${summarizeTransaction(tx)}\n\nPrior findings from the static pass:\n${JSON.stringify(priorFindings, null, 2)}`,
        },
      ],
    });

    const text = firstTextBlock(response);
    return parseJson<ThreatReport>(text, {
      verdict: 'suspicious',
      score: 50,
      findings: priorFindings,
      summary: 'Deep model returned unparseable output; returning the static findings conservatively.',
    });
  }
}

function firstTextBlock(response: Anthropic.Messages.Message): string {
  for (const block of response.content) {
    if (block.type === 'text') return block.text;
  }
  return '';
}

function parseJson<T>(raw: string, fallback: T): T {
  if (!raw) return fallback;
  const trimmed = raw.trim().replace(/^```(?:json)?/u, '').replace(/```$/u, '').trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return fallback;
  }
}

function summarizeTransaction(tx: DecodedTransaction): string {
  const accounts = tx.message.accountKeys.map((k, i) => `  [${i}] ${encodePubkey(k)}`);
  const instructions = tx.message.instructions.map((ix, i) => {
    const pid = programIdOf(tx, ix);
    const accountList = ix.accounts.join(',');
    const dataHex = Buffer.from(ix.data).toString('hex');
    return `  [${i}] program=${pid} accounts=[${accountList}] data=${dataHex}`;
  });
  return [
    `version: ${tx.message.version}`,
    `required signatures: ${tx.message.header.numRequiredSignatures}`,
    `accounts (${tx.message.accountKeys.length}):`,
    ...accounts,
    `instructions (${tx.message.instructions.length}):`,
    ...instructions,
  ].join('\n');
}
