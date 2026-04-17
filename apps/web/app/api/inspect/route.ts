import { NextResponse } from 'next/server';
import { decodeBase64, runRules, type ThreatReport } from '@solshield/core';
import { Analyzer } from '@solshield/ai';
import { getClientIp, hashIp } from '@/lib/ip';
import { checkRateLimit, rateLimitHeaders } from '@/lib/rate-limit';

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

  const ctx = { tx: decoded, network: body.network ?? 'mainnet', now: new Date() } as const;
  const rulesReport = await runRules(ctx);

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
    return NextResponse.json(
      {
        ...deep,
        findings: [...rulesReport.findings, ...deep.findings],
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
