import { NextResponse } from 'next/server';
import { decodeBase64, runRules, simulate, type ThreatReport, type Finding } from '@solshield/core';
import { Analyzer } from '@solshield/ai';
import { getClientIp, hashIp } from '@/lib/ip';
import { checkRateLimit, rateLimitHeaders } from '@/lib/rate-limit';
import { getHeliusRpc } from '@/lib/helius';
import { resolveAddressTableLookups, withResolvedAccountKeys } from '@/lib/atl-resolver';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface InspectBody {
  tx: string;
  encoding?: 'base64';
  network?: 'mainnet' | 'devnet';
}

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const id = hashIp(ip);
  const rl = await checkRateLimit(id);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'rate limit exceeded', resetAt: rl.resetAt },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))),
          'X-RateLimit-Limit': String(rl.limit),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.floor(rl.resetAt / 1000)),
        },
      }
    );
  }
  const rlHeaders = rateLimitHeaders(rl);

  let body: InspectBody;
  try {
    body = (await req.json()) as InspectBody;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400, headers: rlHeaders });
  }
  if (!body.tx || typeof body.tx !== 'string') {
    return NextResponse.json({ error: 'missing tx' }, { status: 400, headers: rlHeaders });
  }

  let decoded;
  try {
    decoded = decodeBase64(body.tx);
  } catch (err) {
    return NextResponse.json(
      { error: `failed to decode transaction: ${(err as Error).message}` },
      { status: 400, headers: rlHeaders }
    );
  }

  const rpc = getHeliusRpc();

  // Resolve V0 Address Lookup Tables BEFORE running rules. Otherwise a
  // drainer can publish their attacker address inside an ALT and reference
  // it via writableIndexes — every rule that calls accountAt(...) gets null
  // for that index and the threat is invisible. Static rules then return
  // verdict: "safe" and the user signs.
  let txForRules = decoded;
  let atlFindings: Finding[] = [];
  if (rpc && decoded.message.addressTableLookups.length > 0) {
    try {
      const resolution = await resolveAddressTableLookups(decoded, rpc);
      txForRules = withResolvedAccountKeys(decoded, resolution);
      if (resolution.failedTables.length > 0) {
        atlFindings.push({
          ruleId: 'atl-lookup-failed',
          severity: 'medium',
          message: `Could not resolve ${resolution.failedTables.length} address lookup table(s); some accounts in this transaction are opaque to analysis.`,
          details: { failedTables: resolution.failedTables.slice(0, 5) },
        });
      }
      if (resolution.unresolvableIndexes.length > 0) {
        atlFindings.push({
          ruleId: 'unresolvable-account-index',
          severity: 'medium',
          message: `${resolution.unresolvableIndexes.length} instruction account(s) reference unresolvable lookup-table positions — the destinations are opaque.`,
          details: { count: resolution.unresolvableIndexes.length },
        });
      }
    } catch (err) {
      console.warn('[inspect] ATL resolution failed:', (err as Error).message);
      atlFindings.push({
        ruleId: 'atl-lookup-failed',
        severity: 'medium',
        message: `Address-lookup-table resolution errored: ${(err as Error).message}.`,
        details: {},
      });
    }
  }

  const simulation = rpc
    ? await simulate(txForRules, body.tx.trim(), rpc).catch((err) => {
        console.warn('[inspect] simulation failed:', (err as Error).message);
        return undefined;
      })
    : undefined;

  const ctx = {
    tx: txForRules,
    network: body.network ?? 'mainnet',
    now: new Date(),
    simulation,
  } as const;
  const baseReport = await runRules(ctx);
  const rulesReport = atlFindings.length > 0
    ? mergeFindings(baseReport, atlFindings)
    : baseReport;

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey || rulesReport.verdict === 'safe') {
    return NextResponse.json(rulesReport, { headers: rlHeaders });
  }

  try {
    const analyzer = new Analyzer({
      apiKey: anthropicKey,
      triageModel: process.env.SOLSHIELD_TRIAGE_MODEL,
      deepModel: process.env.SOLSHIELD_DEEP_MODEL,
    });
    const triage = await analyzer.triage(decoded);
    if (!triage.needsDeepReview) {
      return NextResponse.json(
        {
          ...rulesReport,
          verdict: mostSevere(rulesReport.verdict, triage.verdict),
          summary: `${rulesReport.summary} ${triage.reason}`.trim(),
        },
        { headers: rlHeaders }
      );
    }
    const deep = await analyzer.deepAnalyze(decoded, rulesReport.findings);
    // mostSevere prevents an AI parse-failure from DOWNGRADING the verdict
    // below what static rules already proved. Same for score. Findings are
    // deduped by ruleId so the priorFindings re-passed to deepAnalyze don't
    // appear twice in the response.
    const seen = new Set<string>();
    const mergedFindings = [...rulesReport.findings, ...deep.findings].filter((f) => {
      if (seen.has(f.ruleId)) return false;
      seen.add(f.ruleId);
      return true;
    });
    return NextResponse.json(
      {
        ...deep,
        verdict: mostSevere(rulesReport.verdict, deep.verdict),
        score: Math.max(rulesReport.score, deep.score),
        findings: mergedFindings,
      },
      { headers: rlHeaders }
    );
  } catch (err) {
    return NextResponse.json(
      {
        ...rulesReport,
        summary: `${rulesReport.summary} AI layer unavailable: ${(err as Error).message}.`,
      },
      { headers: rlHeaders }
    );
  }
}

function mostSevere(a: ThreatReport['verdict'], b: ThreatReport['verdict']): ThreatReport['verdict'] {
  const order = { safe: 0, suspicious: 1, danger: 2 } as const;
  return order[a] >= order[b] ? a : b;
}

const SEVERITY_WEIGHT = { low: 10, medium: 25, high: 55, critical: 90 } as const;

function verdictFromScore(score: number): ThreatReport['verdict'] {
  if (score >= 60) return 'danger';
  if (score >= 25) return 'suspicious';
  return 'safe';
}

/** Append findings to a report and recompute verdict/score so a higher
 *  severity in the new findings actually elevates the report. */
function mergeFindings(report: ThreatReport, extra: Finding[]): ThreatReport {
  const findings = [...extra, ...report.findings];
  let score = report.score;
  for (const f of extra) {
    const w = SEVERITY_WEIGHT[f.severity];
    if (w > score) score = w;
  }
  return {
    ...report,
    findings,
    score,
    verdict: verdictFromScore(score),
  };
}
