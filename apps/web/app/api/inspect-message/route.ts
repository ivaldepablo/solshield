import { NextResponse } from 'next/server';
import {
  runMessageRules,
  scoreFromFindings,
  verdictFromScore,
  type ThreatReport,
} from '@solshield/core';
import { getClientIp, hashIp } from '@/lib/ip';
import { checkRateLimit, rateLimitHeaders } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface InspectMessageBody {
  message: string;
  encoding?: 'base64' | 'hex' | 'utf8';
  origin?: string;
  claimedPurpose?: string;
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
          ...rateLimitHeaders(rl),
        },
      }
    );
  }
  const rlHeaders = rateLimitHeaders(rl);

  let body: InspectMessageBody;
  try {
    body = (await req.json()) as InspectMessageBody;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400, headers: rlHeaders });
  }

  if (!body.message || typeof body.message !== 'string') {
    return NextResponse.json({ error: 'missing message' }, { status: 400, headers: rlHeaders });
  }

  const encoding = body.encoding ?? 'utf8';

  // Decode message bytes based on encoding.
  let rawBytes: Uint8Array;
  try {
    if (encoding === 'base64') {
      rawBytes = new Uint8Array(Buffer.from(body.message, 'base64'));
    } else if (encoding === 'hex') {
      const stripped = body.message.replace(/^0x/i, '');
      rawBytes = new Uint8Array(Buffer.from(stripped, 'hex'));
    } else if (encoding === 'utf8') {
      rawBytes = new Uint8Array(Buffer.from(body.message, 'utf8'));
    } else {
      return NextResponse.json(
        { error: `unsupported encoding: ${encoding}` },
        { status: 400, headers: rlHeaders }
      );
    }
  } catch (err) {
    return NextResponse.json(
      { error: `failed to decode message: ${(err as Error).message}` },
      { status: 400, headers: rlHeaders }
    );
  }

  // Try to decode as strict UTF-8 so binary payloads surface as `undefined`.
  let decodedText: string | undefined;
  try {
    decodedText = new TextDecoder('utf-8', { fatal: true }).decode(rawBytes);
  } catch {
    decodedText = undefined;
  }

  try {
    const started = Date.now();
    const findings = await runMessageRules({
      rawBytes,
      decodedText,
      claimedPurpose: body.claimedPurpose,
      origin: body.origin,
      now: new Date(),
    });
    const score = scoreFromFindings(findings);
    const verdict = verdictFromScore(score);

    const report: ThreatReport = {
      verdict,
      score,
      findings,
      summary:
        verdict === 'safe'
          ? 'No suspicious patterns found in message.'
          : findings[0]?.message ?? 'Review before signing.',
      elapsedMs: Date.now() - started,
    };

    return NextResponse.json(report, { headers: rlHeaders });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400, headers: rlHeaders }
    );
  }
}
