/**
 * Lightweight in-memory fixed-window per-IP rate limiter for /api/extract-transcript.
 * Protects OpenRouter / Gemini API spend from accidental loops or abuse on single-node
 * or warm serverless instances. Swap backing store to Redis/Upstash for multi-region scale.
 */
export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAtMs: number;
  retryAfterSeconds: number;
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
    // Periodic opportunistic cleanup to keep memory bounded
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
    };
  }
}

const DEFAULT_DAILY_LIMIT = Number(process.env.EXTRACT_DAILY_LIMIT_PER_IP) || 5;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export const transcriptExtractLimiter = new FixedWindowRateLimiter(
  DEFAULT_DAILY_LIMIT,
  ONE_DAY_MS
);

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
