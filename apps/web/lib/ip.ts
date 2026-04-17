import { createHash } from 'node:crypto';

export function getClientIp(req: Request): string {
  const h = req.headers;
  const cf = h.get('cf-connecting-ip');
  if (cf) return cf.trim();
  const real = h.get('x-real-ip');
  if (real) return real.trim();
  const xff = h.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0];
    if (first && first.trim()) return first.trim();
  }
  return '0.0.0.0';
}

export function hashIp(ip: string): string {
  const salt = process.env.IP_HASH_SALT ?? 'solshield-dev-salt';
  return createHash('sha256').update(ip + salt).digest('hex');
}
