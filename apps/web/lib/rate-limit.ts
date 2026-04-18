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
// 120 req/min/IP (~2/sec average). The previous 10/min cap caused fail-open
// on real wallets like Phantom, which retry SIWS multiple times during a
// single signature flow and would burn through the quota in seconds. The
// extension treats 429 as "offline" and lets the signature pass without an
// overlay, so a too-tight limit is actively a security regression. 120 leaves
// plenty of room for SIWS retries + dev testing while still blocking abuse.
const DEFAULT_MAX = 120;

type GlobalWithRedis = typeof globalThis & {
  __solshieldRedis?: Redis | null;
  __solshieldRedisUnavailable?: boolean;
  __solshieldRedisLastWarnAt?: number;
  __solshieldFailOpenCount?: number;
};

const g = globalThis as GlobalWithRedis;
const WARN_INTERVAL_MS = 60_000;

function maybeWarn(msg: string): void {
  const now = Date.now();
  if (!g.__solshieldRedisLastWarnAt || now - g.__solshieldRedisLastWarnAt > WARN_INTERVAL_MS) {
    g.__solshieldRedisLastWarnAt = now;
    const failedSince = g.__solshieldFailOpenCount ?? 0;
    console.warn(
      `[rate-limit] ${msg} (fail-open requests since last warn: ${failedSince})`,
    );
    g.__solshieldFailOpenCount = 0;
  }
}

function recordFailOpen(): void {
  g.__solshieldFailOpenCount = (g.__solshieldFailOpenCount ?? 0) + 1;
}

function getRedis(): Redis | null {
  if (g.__solshieldRedisUnavailable) return null;
  if (g.__solshieldRedis) return g.__solshieldRedis;

  const url = process.env.REDIS_URL;
  if (!url) {
    maybeWarn('REDIS_URL not set; rate limiting disabled');
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
    maybeWarn(`redis error: ${(err as Error).message}`);
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
    recordFailOpen();
    return { allowed: true, remaining: Infinity, resetAt: now, limit: max };
  }

  const key = `ratelimit:inspect:${identifier}:${bucket}`;
  try {
    const incrPromise = client.incr(key);
    const count = await raceWithTimeout(incrPromise, 1000);
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
    // If we lost the race to the timer but the underlying incr eventually
    // resolves with 1, set the TTL defensively so we don't orphan a
    // never-expiring bucket key.
    void (async () => {
      try {
        await client.expire(key, windowSeconds);
      } catch {
        /* ignore */
      }
    })();
    maybeWarn(`redis call failed: ${(err as Error).message}`);
    recordFailOpen();
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
