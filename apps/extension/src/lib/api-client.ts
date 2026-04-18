/**
 * Thin fetch wrapper for SolShield API at solshield.dev.
 * Normalizes all endpoints to VerdictView shape with 5s timeout.
 */

import type { VerdictView, Finding } from './messaging';

const API_BASE = 'https://solshield.dev/api';
// Server can be slow on cold start: first Anthropic call can blow past 8s
// (DNS + TLS + service-worker startup + Haiku inference + occasional Opus
// follow-up). 12s gives enough headroom that we don't time out mid-flight on
// a legit request — better to keep the user waiting than to fail-open silently.
const TIMEOUT_MS = 12000;

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

/**
 * Build a synthetic "suspicious" verdict so the overlay still fires when the
 * server is reachable but refuses to give us a verdict (HTTP 429, 5xx). We
 * MUST NOT silently fail-open here — that's the magiceden.io regression where
 * Phantom's SIWS retries burned through the rate-limit and the extension
 * decided the request was "offline" and let the signature pass.
 *
 * Network/timeout errors are different: those legitimately could be the user's
 * connection, so we let those bubble up and fall through to the existing
 * fail-open path in overlay-mount.ts.
 */
function syntheticSuspiciousVerdict(
  kind: 'tx' | 'msg' | 'domain',
  startedAt: number,
  status: number,
  reason: 'rate-limit' | 'server-error',
): VerdictView {
  const summary =
    reason === 'rate-limit'
      ? 'Rate limit hit — try again in a moment. SolShield could not verify this signature.'
      : `SolShield server returned ${status}. We could not verify this signature — proceed with caution.`;
  const ruleId = reason === 'rate-limit' ? 'CLIENT_RATE_LIMITED' : 'CLIENT_SERVER_ERROR';
  return {
    kind,
    verdict: 'suspicious',
    score: 50,
    summary,
    findings: [
      {
        severity: 'medium',
        ruleId,
        message: summary,
      },
    ],
    elapsedMs: Date.now() - startedAt,
    models: [],
    startedAt,
  };
}

export async function inspectTx(txBase64: string): Promise<VerdictView> {
  const startedAt = Date.now();

  try {
    const res = await fetchWithTimeout(`${API_BASE}/inspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tx: txBase64, encoding: 'base64' }),
    });

    // Fail-CLOSED on 429 (rate limited) and 5xx (server broken). Returning a
    // synthetic suspicious verdict forces the overlay to render so the user
    // makes the call instead of us silently letting it through.
    if (res.status === 429) {
      return syntheticSuspiciousVerdict('tx', startedAt, 429, 'rate-limit');
    }
    if (res.status >= 500 && res.status <= 599) {
      return syntheticSuspiciousVerdict('tx', startedAt, res.status, 'server-error');
    }
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

    if (res.status === 429) {
      return syntheticSuspiciousVerdict('msg', startedAt, 429, 'rate-limit');
    }
    if (res.status >= 500 && res.status <= 599) {
      return syntheticSuspiciousVerdict('msg', startedAt, res.status, 'server-error');
    }
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

    if (res.status === 429) {
      return syntheticSuspiciousVerdict('domain', startedAt, 429, 'rate-limit');
    }
    if (res.status >= 500 && res.status <= 599) {
      return syntheticSuspiciousVerdict('domain', startedAt, res.status, 'server-error');
    }
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
