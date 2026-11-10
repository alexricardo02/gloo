import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const upstashHits = new Map<string, number>();

vi.mock("@upstash/redis", () => ({ Redis: class Redis {} }));
vi.mock("@upstash/ratelimit", () => {
  class Ratelimit {
    private max: number;
    constructor(opts: { limiter: { max: number } }) {
      this.max = opts.limiter.max;
    }
    async limit(key: string) {
      const n = (upstashHits.get(key) ?? 0) + 1;
      upstashHits.set(key, n);
      return { success: n <= this.max };
    }
    static slidingWindow = (max: number) => ({ max });
  }
  return { Ratelimit };
});

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": "198.51.100.7, 10.0.0.1" })),
}));

import {
  RATE_LIMIT_RULES,
  RateLimitConfigError,
  assertRateLimitConfig,
  checkRateLimit,
  getClientIp,
  resetRateLimiterForTests,
} from "@/lib/rateLimit";

describe("rate limiter (S8)", () => {
  beforeEach(() => {
    resetRateLimiterForTests();
    upstashHits.clear();
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("blocks an identifier after its limit, independently of the IP", async () => {
    const { limit } = RATE_LIMIT_RULES.login.identifier;
    for (let i = 0; i < limit; i++) {
      // A different IP each time: per-IP buckets never fill up.
      expect(await checkRateLimit("login", { ip: `10.0.0.${i}`, identifier: "victim@test.com" })).toBe(true);
    }
    expect(await checkRateLimit("login", { ip: "10.0.1.1", identifier: "victim@test.com" })).toBe(false);
    // Identifiers are normalised (case / whitespace) before hashing.
    expect(await checkRateLimit("login", { ip: "10.0.1.2", identifier: "  VICTIM@test.com " })).toBe(false);
    // Another account is unaffected.
    expect(await checkRateLimit("login", { ip: "10.0.1.3", identifier: "other@test.com" })).toBe(true);
  });

  it("blocks an IP after its limit, independently of the identifier", async () => {
    const { limit } = RATE_LIMIT_RULES.login.ip;
    for (let i = 0; i < limit; i++) {
      expect(await checkRateLimit("login", { ip: "203.0.113.9", identifier: `user${i}@test.com` })).toBe(true);
    }
    expect(await checkRateLimit("login", { ip: "203.0.113.9", identifier: "fresh@test.com" })).toBe(false);
    expect(await checkRateLimit("login", { ip: "203.0.113.10", identifier: "fresh2@test.com" })).toBe(true);
  });

  it("keeps separate buckets per action", async () => {
    const { limit } = RATE_LIMIT_RULES.passwordResetRequest.identifier;
    for (let i = 0; i < limit; i++) await checkRateLimit("passwordResetRequest", { identifier: "a@test.com" });
    expect(await checkRateLimit("passwordResetRequest", { identifier: "a@test.com" })).toBe(false);
    expect(await checkRateLimit("login", { identifier: "a@test.com" })).toBe(true);
  });

  it("resets after the window", async () => {
    vi.useFakeTimers();
    try {
      const { limit, windowSec } = RATE_LIMIT_RULES.like.identifier;
      for (let i = 0; i < limit; i++) await checkRateLimit("like", { identifier: "user-1" });
      expect(await checkRateLimit("like", { identifier: "user-1" })).toBe(false);
      vi.advanceTimersByTime(windowSec * 1000 + 1);
      expect(await checkRateLimit("like", { identifier: "user-1" })).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("warns once in development when falling back to memory", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await checkRateLimit("login", { identifier: "x" });
    await checkRateLimit("login", { identifier: "y" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/in-memory rate limiter/);
  });

  it("refuses to run in production without Upstash (never silently disabled)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(checkRateLimit("login", { identifier: "x" })).rejects.toBeInstanceOf(RateLimitConfigError);
    expect(() => assertRateLimitConfig()).toThrow(/must be set in production/);
  });

  it("startup check passes in production when Upstash is configured, and in dev without it", () => {
    expect(() =>
      assertRateLimitConfig({ NODE_ENV: "production", UPSTASH_REDIS_REST_URL: "https://x", UPSTASH_REDIS_REST_TOKEN: "t" }),
    ).not.toThrow();
    expect(() => assertRateLimitConfig({ NODE_ENV: "development" })).not.toThrow();
  });

  it("uses Upstash when configured, with hashed identifiers as keys", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token");

    const { limit } = RATE_LIMIT_RULES.register.identifier;
    for (let i = 0; i < limit; i++) {
      expect(await checkRateLimit("register", { identifier: "someone@test.com" })).toBe(true);
    }
    expect(await checkRateLimit("register", { identifier: "someone@test.com" })).toBe(false);

    const keys = [...upstashHits.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^register:id:[0-9a-f]{32}$/);
    expect(keys[0]).not.toContain("someone");
  });

  it("reads the client IP from the first x-forwarded-for entry", async () => {
    expect(await getClientIp()).toBe("198.51.100.7");
  });
});
