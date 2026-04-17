import { NextResponse } from 'next/server';
import { decodeBase64, runRules, type ThreatReport } from '@solshield/core';
import { Analyzer } from '@solshield/ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface InspectBody {
  tx: string;
  encoding?: 'base64';
  network?: 'mainnet' | 'devnet';
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(req: Request) {
  let body: InspectBody;
  try {
    body = (await req.json()) as InspectBody;
  } catch {
    return badRequest('invalid JSON body');
  }
  if (!body.tx || typeof body.tx !== 'string') return badRequest('missing tx');

  let decoded;
  try {
    decoded = decodeBase64(body.tx);
  } catch (err) {
    return badRequest(`failed to decode transaction: ${(err as Error).message}`);
  }

  const ctx = { tx: decoded, network: body.network ?? 'mainnet', now: new Date() } as const;
  const rulesReport = await runRules(ctx);

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey || rulesReport.verdict === 'safe') {
    return NextResponse.json(rulesReport);
  }

  try {
    const analyzer = new Analyzer({
      apiKey: anthropicKey,
      triageModel: process.env.SOLSHIELD_TRIAGE_MODEL,
      deepModel: process.env.SOLSHIELD_DEEP_MODEL,
    });
    const triage = await analyzer.triage(decoded);
    if (!triage.needsDeepReview) {
      return NextResponse.json({
        ...rulesReport,
        verdict: mostSevere(rulesReport.verdict, triage.verdict),
        summary: `${rulesReport.summary} ${triage.reason}`.trim(),
      });
    }
    const deep = await analyzer.deepAnalyze(decoded, rulesReport.findings);
    return NextResponse.json({
      ...deep,
      findings: [...rulesReport.findings, ...deep.findings],
    });
  } catch (err) {
    return NextResponse.json({
      ...rulesReport,
      summary: `${rulesReport.summary} AI layer unavailable: ${(err as Error).message}.`,
    });
  }
}

function mostSevere(a: ThreatReport['verdict'], b: ThreatReport['verdict']): ThreatReport['verdict'] {
  const order = { safe: 0, suspicious: 1, danger: 2 } as const;
  return order[a] >= order[b] ? a : b;
}
