/**
 * Shared rate limiting (S8).
 *
 * Backend selection (decided once, on first use):
 *  - UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN set → Upstash sliding
 *    window (shared across serverless instances).
 *  - not set, NODE_ENV === "production" → throws RateLimitConfigError. Rate
 *    limiting is never silently disabled in production. instrumentation.ts
 *    also runs assertRateLimitConfig() so the server refuses to start.
 *  - not set, any other NODE_ENV → per-process in-memory fixed window, with a
 *    one-time console warning. Fine for local dev / tests, useless at scale.
 *
 * Every rule is checked per IP and per identifier (email, username, user id,
 * reset token…). Identifiers are SHA-256 hashed before being used as keys so
 * no emails end up in Redis. Passwords are NEVER a rate-limit input: they are
 * only ever hashed/verified with bcryptjs (app/actions/auth.ts).
 */
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

interface Window {
  limit: number;
  windowSec: number;
}

interface RateLimitRule {
  ip?: Window;
  identifier?: Window;
}

export const RATE_LIMIT_RULES = {
  login: { ip: { limit: 20, windowSec: 15 * 60 }, identifier: { limit: 10, windowSec: 15 * 60 } },
  register: { ip: { limit: 10, windowSec: 60 * 60 }, identifier: { limit: 5, windowSec: 60 * 60 } },
  passwordResetRequest: { ip: { limit: 10, windowSec: 60 * 60 }, identifier: { limit: 3, windowSec: 60 * 60 } },
  // IP only: the reset token is attacker-chosen, so a per-token bucket is useless.
  passwordResetSubmit: { ip: { limit: 10, windowSec: 15 * 60 } },
  // Per signed-in user (identifier = user id): limits guessing the current password.
  passwordChange: { identifier: { limit: 5, windowSec: 15 * 60 } },
  usernameCheck: { ip: { limit: 60, windowSec: 60 }, identifier: { limit: 30, windowSec: 60 } },
  // Unchanged from the original like limiter: 10 likes / 60 s per user.
  like: { identifier: { limit: 10, windowSec: 60 } },
} satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMIT_RULES;

export class RateLimitConfigError extends Error {
  constructor() {
    super(
      "[rate-limit] UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set in production. " +
        "Refusing to run without rate limiting.",
    );
    this.name = "RateLimitConfigError";
  }
}

type Env = Record<string, string | undefined>;

function hasUpstash(env: Env): boolean {
  return Boolean(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN);
}

/** Throws in production when Upstash is not configured. Called at startup (instrumentation.ts). */
export function assertRateLimitConfig(env: Env = process.env): void {
  if (env.NODE_ENV === "production" && !hasUpstash(env)) {
    throw new RateLimitConfigError();
  }
}

// ── Backends ───────────────────────────────────────────────────────────────

interface Backend {
  hit(key: string, window: Window): Promise<boolean>;
}

class MemoryBackend implements Backend {
  private buckets = new Map<string, { count: number; resetAt: number }>();

  async hit(key: string, { limit, windowSec }: Window): Promise<boolean> {
    const now = Date.now();
    if (this.buckets.size > 10_000) {
      for (const [k, b] of this.buckets) if (b.resetAt <= now) this.buckets.delete(k);
    }
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowSec * 1000 });
      return true;
    }
    bucket.count++;
    return bucket.count <= limit;
  }
}

class UpstashBackend implements Backend {
  private limiters = new Map<string, Ratelimit>();
  constructor(private redis: Redis) {}

  async hit(key: string, { limit, windowSec }: Window): Promise<boolean> {
    const id = `${limit}/${windowSec}`;
    let limiter = this.limiters.get(id);
    if (!limiter) {
      limiter = new Ratelimit({
        redis: this.redis,
        limiter: Ratelimit.slidingWindow(limit, `${windowSec} s`),
        // Prefix keeps gloo keys isolated if the Redis instance is shared.
        prefix: "gloo:rl",
      });
      this.limiters.set(id, limiter);
    }
    const { success } = await limiter.limit(key);
    return success;
  }
}

let backend: Backend | null = null;

function getBackend(): Backend {
  if (backend) return backend;
  const env = process.env;
  if (hasUpstash(env)) {
    backend = new UpstashBackend(
      new Redis({ url: env.UPSTASH_REDIS_REST_URL!, token: env.UPSTASH_REDIS_REST_TOKEN! }),
    );
  } else {
    assertRateLimitConfig(env); // throws in production
    if (env.NODE_ENV !== "test") {
      console.warn(
        "[rate-limit] Upstash env vars not set: using an in-memory rate limiter (dev only). " +
          "Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN to use Redis.",
      );
    }
    backend = new MemoryBackend();
  }
  return backend;
}

/** Test helper: forget the chosen backend and all in-memory counters. */
export function resetRateLimiterForTests(): void {
  backend = null;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Hashes a NON-SECRET rate-limit identifier (email, username, user id) or a
 * high-entropy random token so raw values never end up in Redis. This is a
 * privacy measure for bucket keys, NOT password storage: never pass a
 * password (or anything containing one) here. Passwords are hashed only with
 * bcryptjs where they are stored or verified.
 */
function hashRateLimitKey(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex").slice(0, 32);
}

/**
 * Best-effort client IP. On Vercel / behind a trusted proxy the first
 * x-forwarded-for entry is the client. Falls back to "unknown" (which then
 * acts as one shared bucket) outside a request context.
 */
export async function getClientIp(): Promise<string> {
  try {
    const h = await headers();
    const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
    return forwarded || h.get("x-real-ip")?.trim() || "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Keys for one rate-limit check: the client IP and a single non-secret
 * identifier string. `password?: never` makes passing a credentials object
 * (e.g. `{ identifier, password }`) a type error.
 */
export interface RateLimitKeys {
  ip?: string;
  identifier?: string | null;
  password?: never;
}

/**
 * Consumes one attempt for `name` from both the IP bucket and the identifier
 * bucket. Returns true if the request is allowed.
 *
 * Throws RateLimitConfigError in production without Upstash (never fails open
 * on misconfiguration). A transient Redis error is logged and the request is
 * allowed, so a Redis outage does not lock every user out of login.
 */
export async function checkRateLimit(
  name: RateLimitName,
  keys: RateLimitKeys,
): Promise<boolean> {
  const rule: RateLimitRule = RATE_LIMIT_RULES[name];
  const store = getBackend();

  const checks: Promise<boolean>[] = [];
  if (rule.ip && keys.ip) {
    checks.push(store.hit(`${name}:ip:${keys.ip}`, rule.ip));
  }
  if (rule.identifier && keys.identifier) {
    checks.push(store.hit(`${name}:id:${hashRateLimitKey(keys.identifier)}`, rule.identifier));
  }

  try {
    const results = await Promise.all(checks);
    return results.every(Boolean);
  } catch (error) {
    console.error(`[rate-limit] Backend error for "${name}", allowing request:`, error);
    return true;
  }
}
