import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * CORS for /api/* so the SolShield browser extension (and any other
 * client) can call the API directly from any origin. Public verdict
 * endpoints — no credentials, no cookies.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

export function middleware(req: NextRequest) {
  if (req.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
  }
  const res = NextResponse.next();
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
  return res;
}

export const config = {
  matcher: '/api/:path*',
};
