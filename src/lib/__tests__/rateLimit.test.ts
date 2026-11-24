import { describe, it, expect, vi } from "vitest";
import {
  FixedWindowRateLimiter,
  createUpstashRateLimiter,
  extractClientIp,
} from "@/lib/rateLimit";

describe("FixedWindowRateLimiter", () => {
  it("allows up to maxRequests per IP and blocks subsequent requests with retryAfterSeconds", () => {
    const limiter = new FixedWindowRateLimiter(3, 60_000);
    const t0 = 1_000_000;

    const r1 = limiter.check("203.0.113.10", t0);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);

    const r2 = limiter.check("203.0.113.10", t0 + 1000);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = limiter.check("203.0.113.10", t0 + 2000);
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);

    const r4 = limiter.check("203.0.113.10", t0 + 3000);
    expect(r4.allowed).toBe(false);
    expect(r4.remaining).toBe(0);
    expect(r4.retryAfterSeconds).toBe(57);

    // Different IP is isolated
    const otherIp = limiter.check("198.51.100.22", t0 + 3000);
    expect(otherIp.allowed).toBe(true);
    expect(otherIp.remaining).toBe(2);

    // Original IP resets cleanly after window expires
    const afterReset = limiter.check("203.0.113.10", t0 + 60_001);
    expect(afterReset.allowed).toBe(true);
    expect(afterReset.remaining).toBe(2);
  });

  it("extracts client IP from x-forwarded-for or x-real-ip with local fallback", () => {
    const h1 = new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" });
    expect(extractClientIp(h1)).toBe("1.2.3.4");

    const h2 = new Headers({ "x-real-ip": "5.6.7.8" });
    expect(extractClientIp(h2)).toBe("5.6.7.8");

    expect(extractClientIp(new Headers())).toBe("local-dev");
  });
});

describe("Upstash Redis REST Rate Limiter", () => {
  it("sets PEXPIRE on first request and blocks once count exceeds maxRequests", async () => {
    let counter = 0;
    let ttl = -1;

    const mockFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const commands = JSON.parse(String(init?.body)) as Array<Array<string | number>>;
      const results = commands.map((cmd) => {
        if (cmd[0] === "INCR") {
          counter += 1;
          return { result: counter };
        }
        if (cmd[0] === "PTTL") {
          return { result: ttl };
        }
        if (cmd[0] === "PEXPIRE") {
          ttl = Number(cmd[2]);
          return { result: 1 };
        }
        return { result: null };
      });
      return new Response(JSON.stringify(results), { status: 200 });
    });

    const limiter = createUpstashRateLimiter({
      url: "https://example.upstash.io",
      token: "test-token",
      maxRequests: 2,
      windowMs: 60_000,
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    const r1 = await limiter.check("203.0.113.5", 1_000_000);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(1);
    expect(r1.store).toBe("upstash");

    const r2 = await limiter.check("203.0.113.5", 1_001_000);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(0);

    const r3 = await limiter.check("203.0.113.5", 1_002_000);
    expect(r3.allowed).toBe(false);
    expect(r3.remaining).toBe(0);
    expect(r3.retryAfterSeconds).toBe(60);
    expect(r3.store).toBe("upstash");
  });
});
