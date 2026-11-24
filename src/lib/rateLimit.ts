/**
 * Distributed-ready fixed-window per-IP rate limiter for /api/extract-transcript.
 *
 * - Production (Vercel): Uses Upstash Redis REST API automatically whenever
 *   UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (or Vercel's KV_REST_API_*)
 *   are set in environment variables — persists across serverless cold starts.
 * - Local / Offline: Falls back cleanly to an in-memory FixedWindowRateLimiter.
 */
export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAtMs: number;
  retryAfterSeconds: number;
  store: "upstash" | "memory";
}

interface BucketEntry {
  count: number;
  resetAtMs: number;
}

export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, BucketEntry>();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = Math.max(1, maxRequests);
    this.windowMs = Math.max(1000, windowMs);
  }

  check(key: string, nowMs: number = Date.now()): RateLimitDecision {
    if (this.buckets.size > 2000) {
      for (const [k, entry] of this.buckets) {
        if (entry.resetAtMs <= nowMs) {
          this.buckets.delete(k);
        }
      }
    }

    const existing = this.buckets.get(key);
    if (!existing || existing.resetAtMs <= nowMs) {
      const resetAtMs = nowMs + this.windowMs;
      this.buckets.set(key, { count: 1, resetAtMs });
      return {
        allowed: true,
        limit: this.maxRequests,
        remaining: Math.max(0, this.maxRequests - 1),
        resetAtMs,
        retryAfterSeconds: Math.ceil(this.windowMs / 1000),
        store: "memory",
      };
    }

    if (existing.count >= this.maxRequests) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((existing.resetAtMs - nowMs) / 1000)
      );
      return {
        allowed: false,
        limit: this.maxRequests,
        remaining: 0,
        resetAtMs: existing.resetAtMs,
        retryAfterSeconds,
        store: "memory",
      };
    }

    existing.count += 1;
    return {
      allowed: true,
      limit: this.maxRequests,
      remaining: Math.max(0, this.maxRequests - existing.count),
      resetAtMs: existing.resetAtMs,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((existing.resetAtMs - nowMs) / 1000)
      ),
      store: "memory",
    };
  }
}

export interface UpstashRateLimiterOptions {
  url: string;
  token: string;
  maxRequests: number;
  windowMs: number;
  prefix?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Serverless Upstash Redis fixed-window limiter using the Upstash REST pipeline endpoint.
 * Zero external runtime dependencies; safe for Vercel Node.js and Edge runtimes.
 */
export function createUpstashRateLimiter(opts: UpstashRateLimiterOptions) {
  const baseUrl = opts.url.replace(/\/+$/, "");
  const prefix = opts.prefix ?? "zugang:rl:extract";
  const maxRequests = Math.max(1, opts.maxRequests);
  const windowMs = Math.max(1000, opts.windowMs);
  const fetchFn = opts.fetchImpl ?? fetch;

  async function pipeline(
    commands: Array<Array<string | number>>
  ): Promise<Array<{ result?: unknown; error?: string }>> {
    const res = await fetchFn(`${baseUrl}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(commands),
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`Upstash Redis HTTP ${res.status}`);
    }
    return (await res.json()) as Array<{ result?: unknown; error?: string }>;
  }

  return {
    async check(
      key: string,
      nowMs: number = Date.now()
    ): Promise<RateLimitDecision> {
      const redisKey = `${prefix}:${key}`;
      const [incrRes, ttlRes] = await pipeline([
        ["INCR", redisKey],
        ["PTTL", redisKey],
      ]);

      const count = Number(incrRes?.result ?? 1);
      let ttlMs = Number(ttlRes?.result ?? -1);

      if (count === 1 || ttlMs < 0) {
        await pipeline([["PEXPIRE", redisKey, windowMs]]);
        ttlMs = windowMs;
      }

      const resetAtMs = nowMs + Math.max(1000, ttlMs);
      const retryAfterSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
      const allowed = count <= maxRequests;

      return {
        allowed,
        limit: maxRequests,
        remaining: allowed ? Math.max(0, maxRequests - count) : 0,
        resetAtMs,
        retryAfterSeconds,
        store: "upstash",
      };
    },
  };
}

const DEFAULT_DAILY_LIMIT = Number(process.env.EXTRACT_DAILY_LIMIT_PER_IP) || 5;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export const transcriptExtractLimiter = new FixedWindowRateLimiter(
  DEFAULT_DAILY_LIMIT,
  ONE_DAY_MS
);

/**
 * Checks per-IP daily transcript extraction quota.
 * Uses Upstash Redis when UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
 * (or KV_REST_API_URL + KV_REST_API_TOKEN) are configured; otherwise uses in-memory store.
 */
export async function checkTranscriptRateLimit(
  clientIp: string
): Promise<RateLimitDecision> {
  const url =
    process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (url && token) {
    try {
      const upstash = createUpstashRateLimiter({
        url,
        token,
        maxRequests: DEFAULT_DAILY_LIMIT,
        windowMs: ONE_DAY_MS,
      });
      return await upstash.check(clientIp);
    } catch {
      // Fall back gracefully to in-memory limiter if Redis is transiently unreachable
      return transcriptExtractLimiter.check(clientIp);
    }
  }

  return transcriptExtractLimiter.check(clientIp);
}

export function extractClientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return "local-dev";
}
