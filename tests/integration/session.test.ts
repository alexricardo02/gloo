/**
 * S1 + S13: real server-side sessions, exercised against the local test DB.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import {
  SESSION_COOKIE,
  createSession,
  destroyCurrentSession,
  getOptionalUserId,
  hashSessionToken,
  requireUserId,
  revokeAllSessions,
  UnauthorizedError,
} from "@/lib/session";
import { logOutAction } from "@/app/actions/auth";
import { getMapSession } from "@/app/actions/map";
import { createTestSession, fakeCookieStore } from "./helpers/session";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn().mockImplementation((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: { storage: { from: vi.fn() } } }));

const DOMAIN = "@session-integration.test";
let userId: string;
let otherUserId: string;

function setCookies(initial: Record<string, string> = {}) {
  const store = fakeCookieStore(initial);
  vi.mocked(cookies).mockResolvedValue(store as never);
  return store;
}

async function makeUser(prefix: string) {
  const suffix = Math.random().toString(36).slice(2, 9);
  const user = await prisma.user.create({
    data: {
      email: `${prefix}-${suffix}${DOMAIN}`,
      username: `${prefix}_${suffix}`,
      name: "Session Test",
      password: await bcrypt.hash("ValidPass123!", 4),
      birthDate: new Date("2000-01-01"),
      isVerified: true,
    },
  });
  return user.id;
}

describe("Server-side sessions (integration)", () => {
  beforeAll(async () => {
    userId = await makeUser("sess");
    otherUserId = await makeUser("sessother");
  });

  beforeEach(() => {
    setCookies();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: DOMAIN } } });
  });

  it("accepts a valid session and resolves the user id", async () => {
    setCookies({ [SESSION_COOKIE]: await createTestSession(userId) });
    expect(await getOptionalUserId()).toBe(userId);
    expect(await requireUserId()).toBe(userId);
  });

  it("returns null / throws UnauthorizedError when there is no cookie", async () => {
    expect(await getOptionalUserId()).toBeNull();
    await expect(requireUserId()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rejects a random, well-formed token that has no session row (forged cookie)", async () => {
    setCookies({ [SESSION_COOKIE]: randomBytes(32).toString("base64url") });
    expect(await getOptionalUserId()).toBeNull();
  });

  it.each([
    ["a raw user id", () => userId],
    ["garbage", () => "not-a-token"],
    ["an over-long value", () => "A".repeat(500)],
    ["the stored hash instead of the token", () => "HASH"],
  ])("rejects a forged cookie containing %s", async (_label, value) => {
    const token = await createTestSession(userId);
    const forged = value() === "HASH" ? hashSessionToken(token) : value();
    setCookies({ [SESSION_COOKIE]: forged });
    expect(await getOptionalUserId()).toBeNull();
  });

  it("gives NO access with the old gloo_user_id cookie, even with a real user id", async () => {
    setCookies({ gloo_user_id: userId });
    expect(await getOptionalUserId()).toBeNull();
    // A real action behind the boundary sees an anonymous caller.
    expect(await getMapSession()).toBeNull();
  });

  it("rejects and deletes an expired session", async () => {
    const token = await createTestSession(userId, new Date(Date.now() - 1000));
    setCookies({ [SESSION_COOKIE]: token });

    expect(await getOptionalUserId()).toBeNull();
    expect(await prisma.session.findUnique({ where: { tokenHash: hashSessionToken(token) } })).toBeNull();
  });

  it("createSession sets a secure-by-default cookie and replaces the previous session (no fixation)", async () => {
    const oldToken = await createTestSession(userId);
    const store = setCookies({ [SESSION_COOKIE]: oldToken });

    await createSession(userId);

    const newToken = store.jar.get(SESSION_COOKIE)!;
    expect(newToken).not.toBe(oldToken);
    expect(store.set).toHaveBeenCalledWith(
      SESSION_COOKIE,
      newToken,
      expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/", secure: false, expires: expect.any(Date) })
    );
    expect(await prisma.session.findUnique({ where: { tokenHash: hashSessionToken(oldToken) } })).toBeNull();
    expect(await prisma.session.findUnique({ where: { tokenHash: hashSessionToken(newToken) } })).not.toBeNull();
  });

  it("sets secure cookies in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const store = setCookies();
      await createSession(userId);
      expect(store.set).toHaveBeenCalledWith(SESSION_COOKIE, expect.any(String), expect.objectContaining({ secure: true }));
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("logout deletes the current session server-side (a copied cookie stops working)", async () => {
    const token = await createTestSession(userId);
    const otherDevice = await createTestSession(userId);
    const store = setCookies({ [SESSION_COOKIE]: token });

    await expect(logOutAction("en")).rejects.toThrow("NEXT_REDIRECT:/en/search-groups");

    expect(store.jar.has(SESSION_COOKIE)).toBe(false);
    expect(store.jar.get("gloo_is_guest")).toBe("true");
    // Replaying the stolen/copied cookie value no longer authenticates.
    setCookies({ [SESSION_COOKIE]: token });
    expect(await getOptionalUserId()).toBeNull();
    // Other devices are not affected by a normal logout.
    setCookies({ [SESSION_COOKIE]: otherDevice });
    expect(await getOptionalUserId()).toBe(userId);
  });

  it("destroyCurrentSession only touches the caller's own session", async () => {
    const mine = await createTestSession(userId);
    const theirs = await createTestSession(otherUserId);
    setCookies({ [SESSION_COOKIE]: mine });

    await destroyCurrentSession();

    setCookies({ [SESSION_COOKIE]: theirs });
    expect(await getOptionalUserId()).toBe(otherUserId);
  });

  it("revokeAllSessions removes every session of that user only", async () => {
    const a = await createTestSession(userId);
    const b = await createTestSession(userId);
    const other = await createTestSession(otherUserId);

    await revokeAllSessions(userId);

    for (const t of [a, b]) {
      setCookies({ [SESSION_COOKIE]: t });
      expect(await getOptionalUserId()).toBeNull();
    }
    setCookies({ [SESSION_COOKIE]: other });
    expect(await getOptionalUserId()).toBe(otherUserId);
  });
});
