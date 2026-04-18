import { createHash } from 'node:crypto';

/**
 * Resolve the client IP from request headers.
 *
 * Trust order:
 *   1. cf-connecting-ip — ONLY if the request also carries a `cdn-loop:
 *      cloudflare` header (Cloudflare always sets cdn-loop on requests it
 *      proxies). Without that gate, an attacker could spoof their IP by
 *      sending `cf-connecting-ip: $randomvalue` directly to the origin and
 *      bypass IP-based rate limiting completely.
 *   2. x-real-ip / x-forwarded-for — only when behind a known reverse proxy
 *      (controlled by TRUSTED_PROXY=true env). Otherwise an attacker can
 *      forge these headers too.
 *   3. fallback `0.0.0.0` — every unidentified request shares one bucket so
 *      they collectively rate-limit each other instead of getting unlimited
 *      free passes.
 */
export function getClientIp(req: Request): string {
  const h = req.headers;
  const cdnLoop = h.get('cdn-loop')?.toLowerCase() ?? '';
  const cf = h.get('cf-connecting-ip');
  if (cf && cdnLoop.includes('cloudflare')) return cf.trim();

  const trustedProxy = process.env.TRUSTED_PROXY === 'true';
  if (trustedProxy) {
    const real = h.get('x-real-ip');
    if (real) return real.trim();
    const xff = h.get('x-forwarded-for');
    if (xff) {
      const first = xff.split(',')[0];
      if (first && first.trim()) return first.trim();
    }
  }
  return '0.0.0.0';
}

export function hashIp(ip: string): string {
  const salt = process.env.IP_HASH_SALT ?? 'solshield-dev-salt';
  return createHash('sha256').update(ip + salt).digest('hex');
}
