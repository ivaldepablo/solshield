/**
 * Thin fetch wrapper for SolShield API at solshield.dev.
 * Normalizes all endpoints to VerdictView shape with 5s timeout.
 */

import type { VerdictView, Finding } from './messaging';

const API_BASE = 'https://solshield.dev/api';
const TIMEOUT_MS = 5000;

interface ApiTxResponse {
  verdict: 'safe' | 'suspicious' | 'danger';
  score: number;
  summary: string;
  findings: Array<{ severity: 'low' | 'medium' | 'high' | 'critical'; ruleId: string; message: string }>;
  elapsedMs: number;
}

interface ApiMessageResponse {
  verdict: 'safe' | 'suspicious' | 'danger';
  score: number;
  summary: string;
  findings: Array<{ severity: 'low' | 'medium' | 'high' | 'critical'; ruleId: string; message: string }>;
  elapsedMs: number;
}

interface ApiDomainResponse {
  verdict: 'safe' | 'suspicious' | 'danger';
  score: number;
  url: string;
  hostname: string;
  reasons: Array<{ severity: 'low' | 'medium' | 'high' | 'critical'; code: string; message: string }>;
}

async function fetchWithTimeout(url: string, opts: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timeout);
  }
}

export async function inspectTx(txBase64: string): Promise<VerdictView> {
  const startedAt = Date.now();

  try {
    const res = await fetchWithTimeout(`${API_BASE}/inspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tx: txBase64, encoding: 'base64' }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as ApiTxResponse;

    const isSafe = data.verdict === 'safe';
    return {
      kind: 'tx',
      verdict: data.verdict,
      score: data.score,
      summary: data.summary,
      findings: data.findings,
      elapsedMs: data.elapsedMs,
      models: isSafe ? ['haiku 4.5'] : ['haiku 4.5', 'opus 4.7'],
      startedAt,
    };
  } catch (err) {
    throw new Error(`inspect-tx failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function inspectMessage(messageUtf8: string): Promise<VerdictView> {
  const startedAt = Date.now();

  try {
    const res = await fetchWithTimeout(`${API_BASE}/inspect-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: messageUtf8, encoding: 'utf8' }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as ApiMessageResponse;

    const isSafe = data.verdict === 'safe';
    return {
      kind: 'msg',
      verdict: data.verdict,
      score: data.score,
      summary: data.summary,
      findings: data.findings,
      elapsedMs: data.elapsedMs,
      models: isSafe ? ['haiku 4.5'] : ['haiku 4.5', 'opus 4.7'],
      startedAt,
    };
  } catch (err) {
    throw new Error(`inspect-message failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function checkDomain(url: string): Promise<VerdictView> {
  const startedAt = Date.now();

  try {
    const res = await fetchWithTimeout(`${API_BASE}/check-domain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as ApiDomainResponse;

    // Map domain reasons[] to findings[] with ruleId from code
    const findings: Finding[] = data.reasons.map((r) => ({
      severity: r.severity,
      ruleId: r.code,
      message: r.message,
    }));

    return {
      kind: 'domain',
      verdict: data.verdict,
      score: data.score,
      summary: data.verdict === 'danger'
        ? `${data.hostname} matched scam blocklist`
        : `${data.hostname} appears safe`,
      findings,
      elapsedMs: Date.now() - startedAt,
      models: [],
      startedAt,
    };
  } catch (err) {
    throw new Error(`check-domain failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
