import { NextResponse } from 'next/server';
import { checkDomain } from '@solshield/core';
import { getClientIp, hashIp } from '@/lib/ip';
import { checkRateLimit, rateLimitHeaders } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CheckDomainBody {
  url?: unknown;
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
      },
    );
  }
  const rlHeaders = rateLimitHeaders(rl);

  let body: CheckDomainBody;
  try {
    body = (await req.json()) as CheckDomainBody;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400, headers: rlHeaders });
  }

  const { url } = body;
  if (typeof url !== 'string' || !url) {
    return NextResponse.json({ error: 'url required' }, { status: 400, headers: rlHeaders });
  }

  try {
    const result = checkDomain(url);
    return NextResponse.json(result, { headers: rlHeaders });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400, headers: rlHeaders },
    );
  }
}
