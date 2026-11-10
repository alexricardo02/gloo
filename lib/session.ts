/**
 * Centralised session handling: the single auth boundary (S1 + S13).
 *
 * The `gloo_session` cookie holds only a random 32-byte token. The database
 * stores the SHA-256 hash of that token in `Session.tokenHash`, so:
 *  - a cookie value cannot be forged or guessed (unlike the old cookie, which
 *    held the raw user id),
 *  - a database leak does not reveal usable tokens,
 *  - sessions can be revoked server-side (logout, password reset, deletion).
 *
 * Every server action / route handler that needs the current user must call
 * `getOptionalUserId()` or `requireUserId()`. Nothing else reads the cookie
 * for authentication (proxy.ts only checks presence for UX redirects).
 *
 * CSRF note: Next.js Server Actions automatically compare the `Origin` header
 * to the `Host` / `X-Forwarded-Host` header and abort mismatching requests
 * before they reach application code. The `SameSite=lax` cookie attribute
 * provides a second line of defence for older clients.
 */

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

export const SESSION_COOKIE = "gloo_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
// Only write lastUsedAt when it is older than this, to avoid a DB write per request.
const LAST_USED_UPDATE_INTERVAL_MS = 60 * 60 * 1000;
// 32 random bytes encoded as base64url → always 43 chars from [A-Za-z0-9_-].
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

export class UnauthorizedError extends Error {
  readonly code = "UNAUTHORIZED" as const;
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function sessionCookieOptions(expires: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  };
}

async function readSessionToken(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  // Reject malformed values before touching the database.
  return token && TOKEN_FORMAT.test(token) ? token : null;
}

/**
 * Creates a session for `userId` and sets the session cookie. Any session the
 * browser already had is revoked first (prevents session fixation).
 */
export async function createSession(userId: string): Promise<void> {
  const previous = await readSessionToken();
  if (previous) {
    await prisma.session.deleteMany({ where: { tokenHash: hashSessionToken(previous) } });
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: { tokenHash: hashSessionToken(token), userId, expiresAt },
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
}

/**
 * Returns the authenticated user's id, or null when there is no valid,
 * unexpired session. Never throws: infrastructure errors are logged and
 * treated as "not authenticated" (fail closed).
 */
export async function getOptionalUserId(): Promise<string | null> {
  try {
    const token = await readSessionToken();
    if (!token) return null;

    const tokenHash = hashSessionToken(token);
    const session = await prisma.session.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, expiresAt: true, lastUsedAt: true },
    });
    if (!session) return null;

    const now = Date.now();
    if (session.expiresAt.getTime() <= now) {
      await prisma.session.deleteMany({ where: { id: session.id } }).catch(() => {});
      return null;
    }

    if (now - session.lastUsedAt.getTime() > LAST_USED_UPDATE_INTERVAL_MS) {
      // Best effort; a failed bookkeeping write must not log the user out.
      await prisma.session
        .update({ where: { id: session.id }, data: { lastUsedAt: new Date(now) } })
        .catch(() => {});
    }

    return session.userId;
  } catch (error) {
    console.error("[session] Failed to resolve session:", error);
    return null;
  }
}

/** Returns the authenticated user's id or throws `UnauthorizedError`. */
export async function requireUserId(): Promise<string> {
  const userId = await getOptionalUserId();
  if (!userId) throw new UnauthorizedError();
  return userId;
}

/** Deletes the current browser's session (logout) and clears the cookie. */
export async function destroyCurrentSession(): Promise<void> {
  const token = await readSessionToken();
  try {
    if (token) {
      await prisma.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
    }
  } finally {
    // Always clear the cookie, even if the DB delete failed.
    const cookieStore = await cookies();
    cookieStore.delete(SESSION_COOKIE);
  }
}

/** Revokes every session of a user (password reset / password change). */
export async function revokeAllSessions(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}
