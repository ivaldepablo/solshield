import Redis, { type RedisOptions } from 'ioredis';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
}

interface RateLimitOpts {
  windowSeconds?: number;
  max?: number;
}

const DEFAULT_WINDOW_SECONDS = 60;
const DEFAULT_MAX = 10;

type GlobalWithRedis = typeof globalThis & {
  __solshieldRedis?: Redis | null;
  __solshieldRedisUnavailable?: boolean;
  __solshieldRedisWarned?: boolean;
};

const g = globalThis as GlobalWithRedis;

function getRedis(): Redis | null {
  if (g.__solshieldRedisUnavailable) return null;
  if (g.__solshieldRedis) return g.__solshieldRedis;

  const url = process.env.REDIS_URL;
  if (!url) {
    if (!g.__solshieldRedisWarned) {
      console.warn('[rate-limit] REDIS_URL not set; rate limiting disabled (fail-open)');
      g.__solshieldRedisWarned = true;
    }
    g.__solshieldRedisUnavailable = true;
    return null;
  }

  const opts: RedisOptions = {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 1000,
    commandTimeout: 1000,
    retryStrategy: () => null,
  };

  const client = new Redis(url, opts);
  client.on('error', (err) => {
    if (!g.__solshieldRedisWarned) {
      console.warn(`[rate-limit] redis error: ${(err as Error).message} — failing open`);
      g.__solshieldRedisWarned = true;
    }
  });

  g.__solshieldRedis = client;
  return client;
}

export async function checkRateLimit(
  identifier: string,
  opts: RateLimitOpts = {}
): Promise<RateLimitResult> {
  const windowSeconds = opts.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
  const max = opts.max ?? DEFAULT_MAX;
  const windowMs = windowSeconds * 1000;
  const now = Date.now();
  const bucket = Math.floor(now / windowMs);
  const resetAt = (bucket + 1) * windowMs;

  const client = getRedis();
  if (!client) {
    // fail-open if redis is down — we'd rather serve than 503
    return { allowed: true, remaining: Infinity, resetAt: now, limit: max };
  }

  const key = `ratelimit:inspect:${identifier}:${bucket}`;
  try {
    const count = await raceWithTimeout(client.incr(key), 1000);
    if (count === 1) {
      void raceWithTimeout(client.expire(key, windowSeconds), 1000).catch(() => {
        // best-effort — if expire times out the bucket key just lingers a bit
      });
    }
    const remaining = Math.max(0, max - count);
    return {
      allowed: count <= max,
      remaining,
      resetAt,
      limit: max,
    };
  } catch (err) {
    if (!g.__solshieldRedisWarned) {
      console.warn(`[rate-limit] redis call failed: ${(err as Error).message} — failing open`);
      g.__solshieldRedisWarned = true;
    }
    return { allowed: true, remaining: Infinity, resetAt: now, limit: max };
  }
}

function raceWithTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`redis op timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export function rateLimitHeaders(rl: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(rl.limit),
    'X-RateLimit-Remaining': Number.isFinite(rl.remaining) ? String(rl.remaining) : String(rl.limit),
    'X-RateLimit-Reset': String(Math.floor(rl.resetAt / 1000)),
  };
}
