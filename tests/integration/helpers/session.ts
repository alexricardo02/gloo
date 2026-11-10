import { randomBytes } from "node:crypto";
import { vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE, SESSION_TTL_MS, hashSessionToken } from "@/lib/session";

/** Inserts a real Session row for `userId` and returns the raw cookie token. */
export async function createTestSession(
  userId: string,
  expiresAt: Date = new Date(Date.now() + SESSION_TTL_MS),
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await prisma.session.create({
    data: { tokenHash: hashSessionToken(token), userId, expiresAt },
  });
  return token;
}

/** Minimal stand-in for the store returned by next/headers `cookies()`. */
export function fakeCookieStore(initial: Record<string, string> = {}) {
  const jar = new Map(Object.entries(initial));
  return {
    jar,
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    has: (name: string) => jar.has(name),
    set: vi.fn((name: string, value: string) => {
      jar.set(name, value);
    }),
    delete: vi.fn((name: string) => {
      jar.delete(name);
    }),
  };
}

/** A cookie store carrying a valid, freshly created session for `userId`. */
export async function sessionCookiesFor(userId: string) {
  return fakeCookieStore({ [SESSION_COOKIE]: await createTestSession(userId) });
}
