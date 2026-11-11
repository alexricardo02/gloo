import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  registerUser,
  loginUser,
  checkUsernameAvailability,
  requestPasswordReset,
  resetPassword,
  deleteAccountAction,
  changePassword,
} from "@/app/actions/auth";
import { verifyAccountAction } from "@/app/actions/verify";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { SESSION_COOKIE, hashSessionToken } from "@/lib/session";
import { resetRateLimiterForTests } from "@/lib/rateLimit";
import { createTestSession, fakeCookieStore, sessionCookiesFor } from "./helpers/session";

const sha256Hex = (value: string) => createHash("sha256").update(value).digest("hex");

// ── Mocks ─────────────────────────────────────────────────────────────────────

// redirect() in Next.js throws to stop execution — we simulate that here
vi.mock("next/navigation", () => ({
  redirect: vi.fn().mockImplementation((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

// Supabase is only used for image uploads, not relevant to these flows
vi.mock("@/lib/supabase", () => ({
  supabase: {
    storage: {
      from: vi.fn().mockReturnValue({
        upload: vi.fn().mockResolvedValue({ data: null, error: null }),
        getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: "" } }),
        remove: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    },
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Creates a FormData object from a plain key/value record */
const createFormData = (data: Record<string, string>): FormData => {
  const formData = new FormData();
  Object.entries(data).forEach(([key, value]) => formData.append(key, value));
  return formData;
};

/** Returns a birth date string for a 20-year-old (always legally adult) */
const adultBirthDate = (): string => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 20);
  return d.toISOString().split("T")[0];
};

/** Generates a short random suffix to keep emails/usernames unique per run */
const uid = () => Math.random().toString(36).substring(2, 9);

/** Marker embedded in every test email so afterAll can clean them all at once */
const TEST_EMAIL_DOMAIN = "@auth-integration.test";
const testEmail = (prefix = "user") => `${prefix}-${uid()}${TEST_EMAIL_DOMAIN}`;
const testUsername = (prefix = "user") => `${prefix}_${uid()}`;

/** Awaits an action that is expected to redirect (our redirect mock throws). */
async function expectRedirect(action: Promise<unknown>, target: string) {
  await expect(action).rejects.toThrow(`NEXT_REDIRECT:${target}`);
}

/** Installs a fresh fake cookie store for the next action call. */
function setCookies(initial: Record<string, string> = {}) {
  const store = fakeCookieStore(initial);
  vi.mocked(cookies).mockResolvedValue(store as never);
  return store;
}

/** Creates a fully verified user directly in the DB, bypassing registerUser */
const createVerifiedUser = async (overrides: {
  email?: string;
  username?: string;
  plainPassword?: string;
}) => {
  const email = overrides.email ?? testEmail("verified");
  const username = overrides.username ?? testUsername("verified");
  const password = overrides.plainPassword ?? "ValidPass123!";
  const hashedPassword = await bcrypt.hash(password, 10);

  return prisma.user.create({
    data: {
      email,
      name: "Integration Test User",
      username,
      password: hashedPassword,
      birthDate: new Date("2000-01-01"),
      isVerified: true,
      verificationToken: null,
    },
  });
};

// ── Test Suite ────────────────────────────────────────────────────────────────

describe("Auth Actions (Integration)", () => {

  beforeEach(() => {
    // Each test starts with empty in-memory rate-limit buckets.
    resetRateLimiterForTests();
    setCookies();
    // The suites below cover the behaviour WITH email flows (verification,
    // password reset). Flag-off behaviour has its own describe at the end.
    vi.stubEnv("EMAIL_FLOWS_ENABLED", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    // Clean up every user created during this test run (sessions cascade)
    await prisma.user.deleteMany({
      where: { email: { contains: TEST_EMAIL_DOMAIN } },
    });
  });

  // ── registerUser ─────────────────────────────────────────────────────────────

  describe("registerUser", () => {
    it("should persist a new user to the DB with isVerified=false and a verificationToken", async () => {
      const email = testEmail("reg");
      const username = testUsername("reg");

      const result = await registerUser(
        createFormData({
          name: "Registration Test",
          email,
          username,
          password: "ValidPass123!",
          birthDate: adultBirthDate(),
        }),
        "en"
      );

      expect(result).toEqual({ ok: true, data: { needsVerification: true } });

      const stored = await prisma.user.findUnique({ where: { email } });
      expect(stored).not.toBeNull();
      expect(stored!.isVerified).toBe(false);
      expect(stored!.verificationToken).not.toBeNull();
    });

    it("should store a bcrypt hash — not the plain-text password", async () => {
      const email = testEmail("hashcheck");
      const plainPassword = "ValidPass123!";

      await registerUser(
        createFormData({
          name: "Hash Check",
          email,
          username: testUsername("hashcheck"),
          password: plainPassword,
          birthDate: adultBirthDate(),
        }),
        "en"
      );

      const stored = await prisma.user.findUnique({ where: { email } });
      expect(stored!.password).not.toBe(plainPassword);

      const hashIsValid = await bcrypt.compare(plainPassword, stored!.password);
      expect(hashIsValid).toBe(true);
    });

    it("should return the SAME result for a new and an already registered email (S14)", async () => {
      const email = testEmail("dup");

      const first = await registerUser(
        createFormData({
          name: "First",
          email,
          username: testUsername("dup1"),
          password: "ValidPass123!",
          birthDate: adultBirthDate(),
        }),
        "en"
      );

      const second = await registerUser(
        createFormData({
          name: "Second",
          email,
          username: testUsername("dup2"),
          password: "OtherValidPass1!",
          birthDate: adultBirthDate(),
        }),
        "en"
      );

      expect(second).toEqual(first);
      expect(second).toEqual({ ok: true, data: { needsVerification: true } });

      // The original account is untouched and no second row exists.
      const rows = await prisma.user.findMany({ where: { email } });
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe("First");
    });

    it("should return usernameTakenError when the same username is registered twice", async () => {
      const username = testUsername("taken");

      await registerUser(
        createFormData({
          name: "First",
          email: testEmail("first"),
          username,
          password: "ValidPass123!",
          birthDate: adultBirthDate(),
        }),
        "en"
      );

      const result = await registerUser(
        createFormData({
          name: "Second",
          email: testEmail("second"),
          username,
          password: "ValidPass123!",
          birthDate: adultBirthDate(),
        }),
        "en"
      );

      expect(result).toEqual({ ok: false, code: "VALIDATION", messageKey: "usernameTakenError" });
    });

    it("should reject registration for a user under 18", async () => {
      const underageDate = new Date();
      underageDate.setFullYear(underageDate.getFullYear() - 15);
      const email = testEmail("minor");

      const result = await registerUser(
        createFormData({
          name: "Minor User",
          email,
          username: testUsername("minor"),
          password: "ValidPass123!",
          birthDate: underageDate.toISOString().split("T")[0],
        }),
        "en"
      );

      expect(result).toEqual({ ok: false, code: "VALIDATION", messageKey: "ageMinError" });

      const stored = await prisma.user.findUnique({ where: { email } });
      expect(stored).toBeNull();
    });

    it("should store the birthdate as the exact calendar day (S10)", async () => {
      const email = testEmail("bday");
      await registerUser(
        createFormData({
          name: "Birthday",
          email,
          username: testUsername("bday"),
          password: "ValidPass123!",
          birthDate: "1999-12-31",
        }),
        "en"
      );

      const stored = await prisma.user.findUnique({ where: { email } });
      expect(stored!.birthDate.toISOString().slice(0, 10)).toBe("1999-12-31");
    });

    it("should reject a weak password", async () => {
      const result = await registerUser(
        createFormData({
          name: "Weak PW",
          email: testEmail("weakpw"),
          username: testUsername("weakpw"),
          password: "weak",
          birthDate: adultBirthDate(),
        }),
        "en"
      );

      expect(result).toEqual({ ok: false, code: "VALIDATION", messageKey: "passwordWeakError" });
    });
  });

  // ── loginUser ─────────────────────────────────────────────────────────────────

  describe("loginUser", () => {
    it("should create a hashed session row + random token cookie and redirect (login by email)", async () => {
      const email = testEmail("loginbyemail");
      const user = await createVerifiedUser({ email });
      const store = setCookies({ gloo_is_guest: "true" });

      await expectRedirect(
        loginUser(createFormData({ identifier: email, password: "ValidPass123!" }), "en"),
        "/en/search-groups"
      );

      const token = store.jar.get(SESSION_COOKIE)!;
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(token).not.toContain(user.id);
      expect(store.set).toHaveBeenCalledWith(
        SESSION_COOKIE,
        token,
        expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" })
      );
      expect(store.jar.has("gloo_is_guest")).toBe(false);

      // Only the SHA-256 hash is stored, never the raw token.
      const sessions = await prisma.session.findMany({ where: { userId: user.id } });
      expect(sessions).toHaveLength(1);
      expect(sessions[0].tokenHash).toBe(hashSessionToken(token));
      expect(sessions[0].tokenHash).not.toBe(token);
      const ttlDays = (sessions[0].expiresAt.getTime() - Date.now()) / 86_400_000;
      expect(ttlDays).toBeGreaterThan(29.9);
      expect(ttlDays).toBeLessThanOrEqual(30);
    });

    it("should log in by username", async () => {
      const username = testUsername("loginbyusr");
      const user = await createVerifiedUser({ username });

      await expectRedirect(
        loginUser(createFormData({ identifier: username, password: "ValidPass123!" }), "en"),
        "/en/search-groups"
      );

      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(1);
    });

    it("should return invalidCredentialsError for a wrong password", async () => {
      const email = testEmail("wrongpw");
      await createVerifiedUser({ email });

      const result = await loginUser(
        createFormData({ identifier: email, password: "WrongPassword1!" }),
        "en"
      );

      expect(result).toEqual({ ok: false, code: "UNAUTHORIZED", messageKey: "invalidCredentialsError" });
    });

    it("should return invalidCredentialsError for a non-existent email", async () => {
      const result = await loginUser(
        createFormData({
          identifier: `nobody-${uid()}@nonexistent.test`,
          password: "ValidPass123!",
        }),
        "en"
      );

      expect(result).toEqual({ ok: false, code: "UNAUTHORIZED", messageKey: "invalidCredentialsError" });
    });

    it("should return emailNotVerifiedError when the account has not been verified", async () => {
      const email = testEmail("unverified");
      const hashedPassword = await bcrypt.hash("ValidPass123!", 10);

      // Create user directly — unverified
      await prisma.user.create({
        data: {
          email,
          name: "Unverified User",
          username: testUsername("unverified"),
          password: hashedPassword,
          birthDate: new Date("2000-01-01"),
          isVerified: false,
          verificationToken: `pending-token-${uid()}`,
        },
      });

      const result = await loginUser(
        createFormData({ identifier: email, password: "ValidPass123!" }),
        "en"
      );

      expect(result).toEqual({ ok: false, code: "FORBIDDEN", messageKey: "emailNotVerifiedError" });
    });

    it("should NOT set a session cookie when login fails", async () => {
      const store = setCookies();

      await loginUser(
        createFormData({ identifier: "ghost@nowhere.test", password: "Whatever1!" }),
        "en"
      );

      expect(store.set).not.toHaveBeenCalled();
    });

    it("should rate limit repeated attempts for the same identifier (S8)", async () => {
      const email = testEmail("bruteforce");
      await createVerifiedUser({ email });

      const results = [];
      for (let i = 0; i < 11; i++) {
        results.push(
          await loginUser(createFormData({ identifier: email, password: `Wrong${i}Pass!` }), "en")
        );
      }

      expect(results.slice(0, 10).every((r) => r.ok === false && r.code === "UNAUTHORIZED")).toBe(true);
      expect(results[10]).toEqual({ ok: false, code: "RATE_LIMITED", messageKey: "tooManyAttemptsError" });

      // Even the correct password is refused while the identifier is limited.
      const blocked = await loginUser(createFormData({ identifier: email, password: "ValidPass123!" }), "en");
      expect(blocked).toEqual({ ok: false, code: "RATE_LIMITED", messageKey: "tooManyAttemptsError" });
    });
  });

  // ── checkUsernameAvailability ──────────────────────────────────────────────

  describe("checkUsernameAvailability", () => {
    it("should return available: true for a username that does not exist in the DB", async () => {
      const result = await checkUsernameAvailability(`free_${uid()}`);
      expect(result).toEqual({ ok: true, data: { available: true } });
    });

    it("should return available: false for a username that already exists in the DB", async () => {
      const username = testUsername("existscheck");
      await createVerifiedUser({ username });

      const result = await checkUsernameAvailability(username);
      expect(result).toEqual({ ok: true, data: { available: false } });
    });

    it("should return available: false without querying the DB for usernames shorter than 3 chars", async () => {
      const result = await checkUsernameAvailability("ab");
      expect(result).toEqual({ ok: true, data: { available: false } });
    });
  });

  // ── Password Reset Flow ───────────────────────────────────────────────────

  describe("Password Reset Flow", () => {
    it("should write a reset token and expiry to the DB when a valid email is submitted", async () => {
      const email = testEmail("resetreq");
      await createVerifiedUser({ email });

      const result = await requestPasswordReset(email, "en");
      expect(result).toEqual({ ok: true, data: undefined });

      const stored = await prisma.user.findUnique({ where: { email } });
      expect(stored!.resetPasswordToken).not.toBeNull();
      // Only a SHA-256 hash is stored, never the raw token from the link.
      expect(stored!.resetPasswordToken).toMatch(/^[0-9a-f]{64}$/);
      expect(stored!.resetPasswordExpiry).not.toBeNull();

      // Expiry must be in the future
      expect(new Date(stored!.resetPasswordExpiry!).getTime()).toBeGreaterThan(Date.now());
    });

    it("should return success even when the email does not exist (prevents user enumeration)", async () => {
      const result = await requestPasswordReset(
        `nobody-${uid()}@never-registered.test`,
        "en"
      );
      expect(result).toEqual({ ok: true, data: undefined });
    });

    it("should update the password, clear the token and revoke ALL sessions", async () => {
      const email = testEmail("resetpw");
      const resetToken = `valid-token-${uid()}`;
      const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
      const oldPassword = "OldValidPass123!";

      const user = await prisma.user.create({
        data: {
          email,
          name: "Reset PW User",
          username: testUsername("resetpw"),
          password: await bcrypt.hash(oldPassword, 10),
          birthDate: new Date("2000-01-01"),
          isVerified: true,
          verificationToken: null,
          resetPasswordToken: sha256Hex(resetToken),
          resetPasswordExpiry: expiry,
        },
      });
      // Two devices logged in (e.g. one of them an attacker's).
      await sessionCookiesFor(user.id);
      await sessionCookiesFor(user.id);
      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(2);

      const result = await resetPassword(resetToken, "NewSecurePass456!");
      expect(result).toEqual({ ok: true, data: undefined });

      const updated = await prisma.user.findUnique({ where: { email } });

      // Token must be cleared
      expect(updated!.resetPasswordToken).toBeNull();
      expect(updated!.resetPasswordExpiry).toBeNull();

      // New password must be valid
      const newPasswordWorks = await bcrypt.compare("NewSecurePass456!", updated!.password);
      expect(newPasswordWorks).toBe(true);

      // Old password must no longer work
      const oldPasswordWorks = await bcrypt.compare(oldPassword, updated!.password);
      expect(oldPasswordWorks).toBe(false);

      // Every session is gone
      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
    });

    it("should reject an expired reset token and leave the password unchanged", async () => {
      const email = testEmail("expiredtok");
      const resetToken = `expired-token-${uid()}`;
      const expiredAt = new Date(Date.now() - 60 * 1000); // 1 minute in the past
      const oldPassword = "OldValidPass123!";

      await prisma.user.create({
        data: {
          email,
          name: "Expired Token User",
          username: testUsername("expiredtok"),
          password: await bcrypt.hash(oldPassword, 10),
          birthDate: new Date("2000-01-01"),
          isVerified: true,
          verificationToken: null,
          resetPasswordToken: sha256Hex(resetToken),
          resetPasswordExpiry: expiredAt,
        },
      });

      const result = await resetPassword(resetToken, "NewSecurePass456!");
      expect(result).toEqual({ ok: false, code: "NOT_FOUND", messageKey: "tokenInvalidOrExpired" });

      // Password must remain unchanged
      const unchanged = await prisma.user.findUnique({ where: { email } });
      const oldPasswordStillWorks = await bcrypt.compare(oldPassword, unchanged!.password);
      expect(oldPasswordStillWorks).toBe(true);
    });

    it("should reject the stored hash used as a token (a leaked DB value is not a working link)", async () => {
      const email = testEmail("hashastok");
      const resetToken = `valid-token-${uid()}`;
      const oldPassword = "OldValidPass123!";
      await prisma.user.create({
        data: {
          email,
          name: "Hash As Token User",
          username: testUsername("hashastok"),
          password: await bcrypt.hash(oldPassword, 10),
          birthDate: new Date("2000-01-01"),
          isVerified: true,
          verificationToken: null,
          resetPasswordToken: sha256Hex(resetToken),
          resetPasswordExpiry: new Date(Date.now() + 60 * 60 * 1000),
        },
      });

      const result = await resetPassword(sha256Hex(resetToken), "NewSecurePass456!");
      expect(result).toEqual({ ok: false, code: "NOT_FOUND", messageKey: "tokenInvalidOrExpired" });

      const unchanged = await prisma.user.findUnique({ where: { email } });
      expect(await bcrypt.compare(oldPassword, unchanged!.password)).toBe(true);
      expect(unchanged!.resetPasswordToken).toBe(sha256Hex(resetToken));
    });

    it("should reject a completely fake reset token", async () => {
      const result = await resetPassword(`fake-token-${uid()}`, "NewSecurePass456!");
      expect(result).toEqual({ ok: false, code: "NOT_FOUND", messageKey: "tokenInvalidOrExpired" });
    });

    it("should reject a weak new password even with a valid token", async () => {
      const result = await resetPassword("any-token", "weak");
      expect(result).toEqual({ ok: false, code: "VALIDATION", messageKey: "passwordWeakError" });
    });
  });

  // ── deleteAccountAction ───────────────────────────────────────────────────

  describe("deleteAccountAction", () => {
    it("should permanently delete the user row from the database", async () => {
      const email = testEmail("delete");
      const user = await createVerifiedUser({ email });
      vi.mocked(cookies).mockResolvedValue((await sessionCookiesFor(user.id)) as never);

      await expectRedirect(deleteAccountAction("en"), "/en/search-groups");

      const deletedUser = await prisma.user.findUnique({ where: { id: user.id } });
      expect(deletedUser).toBeNull();
    });

    it("should cascade-delete the user's group and sessions when the account is deleted", async () => {
      const email = testEmail("cascade");
      const hashedPassword = await bcrypt.hash("ValidPass123!", 10);

      const user = await prisma.user.create({
        data: {
          email,
          name: "Cascade Delete User",
          username: testUsername("cascade"),
          password: hashedPassword,
          birthDate: new Date("2000-01-01"),
          isVerified: true,
          verificationToken: null,
          group: {
            create: {
              membersCount: 3,
              gender: "MIXED",
              latitude: 50.0,
              longitude: 8.0,
              publicProfile: true,
            },
          },
        },
        include: { group: true },
      });

      const groupId = user.group!.id;
      vi.mocked(cookies).mockResolvedValue((await sessionCookiesFor(user.id)) as never);
      await sessionCookiesFor(user.id); // a second device

      await expectRedirect(deleteAccountAction("en"), "/en/search-groups");

      const deletedUser = await prisma.user.findUnique({ where: { id: user.id } });
      const deletedGroup = await prisma.group.findUnique({ where: { id: groupId } });

      expect(deletedUser).toBeNull();
      expect(deletedGroup).toBeNull();
      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
    });

    it("should clear the session cookie and set guest cookies after the account is deleted", async () => {
      const email = testEmail("delcookie");
      const user = await createVerifiedUser({ email });
      const store = await sessionCookiesFor(user.id);
      vi.mocked(cookies).mockResolvedValue(store as never);

      await expectRedirect(deleteAccountAction("en"), "/en/search-groups");

      expect(store.delete).toHaveBeenCalledWith(SESSION_COOKIE);
      expect(store.set).toHaveBeenCalledWith(
        "gloo_is_guest",
        "true",
        expect.objectContaining({ httpOnly: true })
      );
    });

    it("should return Unauthorized and not touch the DB if no session cookie is present", async () => {
      setCookies();

      const result = await deleteAccountAction("en");
      expect(result).toEqual({ error: "Unauthorized" });
    });
  });

  // ── Registration Redirection & Session Creation ──────────────────────────────

  describe("Registration Redirection & Activation", () => {
    it("should redirect user to /profile/create-group upon email verification activation", async () => {
      const email = testEmail("regredirect");
      const username = testUsername("regredirect");

      // 1. User registers
      const regResult = await registerUser(
        createFormData({
          name: "Redirect Integration",
          email,
          username,
          password: "ValidPass123!",
          birthDate: adultBirthDate(),
        }),
        "en"
      );

      expect(regResult).toEqual({ ok: true, data: { needsVerification: true } });

      // 2. Query user to get generated verificationToken
      const user = await prisma.user.findUnique({ where: { email } });
      expect(user).not.toBeNull();
      expect(user!.isVerified).toBe(false);
      expect(user!.verificationToken).not.toBeNull();

      const token = user!.verificationToken!;

      // 3. Simulate email confirmation link click
      const store = setCookies({ gloo_is_guest: "true" });

      await expectRedirect(verifyAccountAction(token, "en"), "/en/profile/create-group");

      // 4. Assert user is now verified in database
      const activatedUser = await prisma.user.findUnique({ where: { email } });
      expect(activatedUser!.isVerified).toBe(true);
      expect(activatedUser!.verificationToken).toBeNull();

      // 5. Assert a real session was created
      const sessionToken = store.jar.get(SESSION_COOKIE)!;
      const session = await prisma.session.findUnique({ where: { tokenHash: hashSessionToken(sessionToken) } });
      expect(session?.userId).toBe(user!.id);
      expect(store.jar.has("gloo_is_guest")).toBe(false);
    });

    it("should preserve dynamic locale in redirection target (de locale)", async () => {
      const email = testEmail("delocale");
      const user = await prisma.user.create({
        data: {
          email,
          name: "German User",
          username: testUsername("delocale"),
          password: await bcrypt.hash("ValidPass123!", 10),
          birthDate: new Date("2000-01-01"),
          isVerified: false,
          verificationToken: `token-${uid()}`,
          verificationTokenExpiry: new Date(Date.now() + 1000 * 60 * 60),
        },
      });

      await expectRedirect(verifyAccountAction(user.verificationToken!, "de"), "/de/profile/create-group");
    });
  });

  // ── EMAIL_FLOWS_ENABLED off (the default) ──────────────────────────────────

  describe("with EMAIL_FLOWS_ENABLED off", () => {
    beforeEach(() => {
      vi.stubEnv("EMAIL_FLOWS_ENABLED", "false");
    });

    const register = (email: string, username: string, locale = "en") =>
      registerUser(
        createFormData({
          name: "No Email User",
          email,
          username,
          password: "ValidPass123!",
          birthDate: adultBirthDate(),
        }),
        locale
      );

    it("register creates an UNVERIFIED user without a token and signs them in (session + redirect)", async () => {
      const email = testEmail("noemail");
      const store = setCookies({ gloo_is_guest: "true" });

      await expectRedirect(register(email, testUsername("noemail")), "/en/search-groups");

      const stored = await prisma.user.findUnique({ where: { email } });
      expect(stored!.isVerified).toBe(false);
      expect(stored!.verificationToken).toBeNull();
      expect(stored!.verificationTokenExpiry).toBeNull();

      const token = store.jar.get(SESSION_COOKIE)!;
      const session = await prisma.session.findUnique({ where: { tokenHash: hashSessionToken(token) } });
      expect(session?.userId).toBe(stored!.id);
      expect(store.jar.has("gloo_is_guest")).toBe(false);
    });

    it("register keeps the locale prefix in the redirect", async () => {
      await expectRedirect(register(testEmail("noemailde"), testUsername("noemailde"), "de"), "/de/search-groups");
    });

    it("an unverified user can log in", async () => {
      const email = testEmail("unverifiedok");
      const user = await prisma.user.create({
        data: {
          email,
          name: "Unverified OK",
          username: testUsername("unverifiedok"),
          password: await bcrypt.hash("ValidPass123!", 10),
          birthDate: new Date("2000-01-01"),
          isVerified: false,
        },
      });

      await expectRedirect(
        loginUser(createFormData({ identifier: email, password: "ValidPass123!" }), "en"),
        "/en/search-groups"
      );
      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(1);
    });

    it("login still rejects a wrong password for an unverified user", async () => {
      const email = testEmail("unverifiedbad");
      await prisma.user.create({
        data: {
          email,
          name: "Unverified Bad",
          username: testUsername("unverifiedbad"),
          password: await bcrypt.hash("ValidPass123!", 10),
          birthDate: new Date("2000-01-01"),
          isVerified: false,
        },
      });

      const result = await loginUser(createFormData({ identifier: email, password: "WrongPass123!" }), "en");
      expect(result).toEqual({ ok: false, code: "UNAUTHORIZED", messageKey: "invalidCredentialsError" });
    });

    it("a duplicate email returns the localized 'already registered' error and creates nothing", async () => {
      const email = testEmail("dupoff");
      await expectRedirect(register(email, testUsername("dupoff1")), "/en/search-groups");

      setCookies();
      const second = await register(email, testUsername("dupoff2"));

      expect(second).toEqual({ ok: false, code: "VALIDATION", messageKey: "emailExistsError" });
      expect(await prisma.user.count({ where: { email } })).toBe(1);

      // The key is translated in every locale the register page uses.
      for (const locale of ["en", "de", "es", "fr", "it"]) {
        const file = path.join(process.cwd(), "messages", `${locale}.json`);
        const messages = JSON.parse(fs.readFileSync(file, "utf8"));
        expect(typeof messages.Register.emailExistsError, locale).toBe("string");
      }
    });

    it("a duplicate username still returns usernameTakenError", async () => {
      const username = testUsername("dupuseroff");
      await expectRedirect(register(testEmail("dupuseroff1"), username), "/en/search-groups");

      setCookies();
      const second = await register(testEmail("dupuseroff2"), username);
      expect(second).toEqual({ ok: false, code: "VALIDATION", messageKey: "usernameTakenError" });
    });

    it("requestPasswordReset returns FEATURE_DISABLED and stores no token", async () => {
      const email = testEmail("resetoff");
      await createVerifiedUser({ email });

      const result = await requestPasswordReset(email, "en");

      expect(result).toEqual({ ok: false, code: "FEATURE_DISABLED" });
      const stored = await prisma.user.findUnique({ where: { email } });
      expect(stored!.resetPasswordToken).toBeNull();
      expect(stored!.resetPasswordExpiry).toBeNull();
    });

    it("resetPassword returns FEATURE_DISABLED and changes nothing, even with a valid stored token", async () => {
      const email = testEmail("resetsubmitoff");
      const resetToken = `valid-token-${uid()}`;
      const oldPassword = "OldValidPass123!";
      await prisma.user.create({
        data: {
          email,
          name: "Reset Off",
          username: testUsername("resetsubmitoff"),
          password: await bcrypt.hash(oldPassword, 10),
          birthDate: new Date("2000-01-01"),
          isVerified: true,
          resetPasswordToken: sha256Hex(resetToken),
          resetPasswordExpiry: new Date(Date.now() + 60 * 60 * 1000),
        },
      });

      const result = await resetPassword(resetToken, "NewSecurePass456!");

      expect(result).toEqual({ ok: false, code: "FEATURE_DISABLED" });
      const unchanged = await prisma.user.findUnique({ where: { email } });
      expect(await bcrypt.compare(oldPassword, unchanged!.password)).toBe(true);
      expect(unchanged!.resetPasswordToken).toBe(sha256Hex(resetToken));
    });

    it("verifyAccountAction returns FEATURE_DISABLED and leaves the account untouched", async () => {
      const email = testEmail("verifyoff");
      const user = await prisma.user.create({
        data: {
          email,
          name: "Verify Off",
          username: testUsername("verifyoff"),
          password: await bcrypt.hash("ValidPass123!", 10),
          birthDate: new Date("2000-01-01"),
          isVerified: false,
          verificationToken: `token-${uid()}`,
          verificationTokenExpiry: new Date(Date.now() + 60 * 60 * 1000),
        },
      });

      const result = await verifyAccountAction(user.verificationToken!, "en");

      expect(result).toEqual({ ok: false, code: "FEATURE_DISABLED" });
      const after = await prisma.user.findUnique({ where: { id: user.id } });
      expect(after!.isVerified).toBe(false);
      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
    });

    it("logs no tokens, links or email addresses (even in development)", async () => {
      vi.stubEnv("NODE_ENV", "development");
      const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
        vi.spyOn(console, m).mockImplementation(() => {})
      );
      try {
        const email = testEmail("nolog");
        await expectRedirect(register(email, testUsername("nolog")), "/en/search-groups");
        setCookies();
        await register(email, testUsername("nolog2")); // duplicate email
        await requestPasswordReset(email, "en");
        await resetPassword(`some-token-${uid()}`, "NewSecurePass456!");

        const output = spies.flatMap((s) => s.mock.calls).map((args) => args.map(String).join(" ")).join("\n");
        expect(output).not.toContain(email);
        // No token-bearing links (the rate limiter's config warning names an env var, which is fine).
        expect(output).not.toMatch(/token=|\/verify|\/resetPassword/i);
        expect(output).not.toContain("EMAIL SIMULATION");
      } finally {
        spies.forEach((s) => s.mockRestore());
      }
    });
  });

  // ── changePassword (signed in; independent of EMAIL_FLOWS_ENABLED) ──────────

  describe("changePassword", () => {
    const OLD = "OldValidPass123!";
    const NEW = "NewValidPass456!";

    /** A user signed in on this "device" plus `otherDevices` extra sessions. */
    async function signedInUser(otherDevices = 0) {
      const user = await createVerifiedUser({ plainPassword: OLD });
      const store = await sessionCookiesFor(user.id);
      vi.mocked(cookies).mockResolvedValue(store as never);
      for (let i = 0; i < otherDevices; i++) await createTestSession(user.id);
      return { user, currentTokenHash: hashSessionToken(store.jar.get(SESSION_COOKIE)!) };
    }

    const passwordOf = async (id: string) => (await prisma.user.findUnique({ where: { id } }))!.password;

    for (const flag of ["false", "true"]) {
      it(`changes the password, revokes OTHER sessions and keeps the current one (EMAIL_FLOWS_ENABLED=${flag})`, async () => {
        vi.stubEnv("EMAIL_FLOWS_ENABLED", flag);
        const { user, currentTokenHash } = await signedInUser(2);
        expect(await prisma.session.count({ where: { userId: user.id } })).toBe(3);

        const result = await changePassword(OLD, NEW, NEW);

        expect(result).toEqual({ ok: true, data: undefined });
        const hash = await passwordOf(user.id);
        expect(await bcrypt.compare(NEW, hash)).toBe(true);
        expect(await bcrypt.compare(OLD, hash)).toBe(false);

        const sessions = await prisma.session.findMany({ where: { userId: user.id } });
        expect(sessions).toHaveLength(1);
        expect(sessions[0].tokenHash).toBe(currentTokenHash);
      });
    }

    it("the new password works for login afterwards (and the old one does not)", async () => {
      vi.stubEnv("EMAIL_FLOWS_ENABLED", "false");
      const { user } = await signedInUser();
      expect(await changePassword(OLD, NEW, NEW)).toEqual({ ok: true, data: undefined });

      setCookies();
      const withOld = await loginUser(createFormData({ identifier: user.email, password: OLD }), "en");
      expect(withOld).toEqual({ ok: false, code: "UNAUTHORIZED", messageKey: "invalidCredentialsError" });

      setCookies();
      await expectRedirect(
        loginUser(createFormData({ identifier: user.email, password: NEW }), "en"),
        "/en/search-groups"
      );
    });

    it("rejects a wrong current password and changes nothing", async () => {
      const { user } = await signedInUser(1);
      const before = await passwordOf(user.id);

      const result = await changePassword("WrongCurrent123!", NEW, NEW);

      expect(result).toEqual({ ok: false, code: "VALIDATION", messageKey: "currentPasswordIncorrect" });
      expect(await passwordOf(user.id)).toBe(before);
      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(2);
    });

    it("rejects reusing the current password", async () => {
      const { user } = await signedInUser(1);
      const before = await passwordOf(user.id);

      const result = await changePassword(OLD, OLD, OLD);

      expect(result).toEqual({ ok: false, code: "VALIDATION", messageKey: "passwordSameAsCurrent" });
      expect(await passwordOf(user.id)).toBe(before);
      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(2);
    });

    it("rejects a mismatched confirmation and a weak new password (shared validator)", async () => {
      await signedInUser();
      expect(await changePassword(OLD, NEW, NEW + "x")).toEqual({
        ok: false,
        code: "VALIDATION",
        messageKey: "passwordMismatch",
      });
      expect(await changePassword(OLD, "weak", "weak")).toEqual({
        ok: false,
        code: "VALIDATION",
        messageKey: "passwordWeakError",
      });
    });

    it("requires a valid session", async () => {
      setCookies();
      expect(await changePassword(OLD, NEW, NEW)).toEqual({
        ok: false,
        code: "UNAUTHORIZED",
        messageKey: "sessionExpiredError",
      });
    });

    it("is rate limited per user, even for the correct current password", async () => {
      const { user } = await signedInUser();
      const before = await passwordOf(user.id);

      for (let i = 0; i < 5; i++) {
        const r = await changePassword(`Wrong${i}Current!`, NEW, NEW);
        expect(r).toEqual({ ok: false, code: "VALIDATION", messageKey: "currentPasswordIncorrect" });
      }
      const blocked = await changePassword(OLD, NEW, NEW);

      expect(blocked).toEqual({ ok: false, code: "RATE_LIMITED", messageKey: "tooManyAttemptsError" });
      expect(await passwordOf(user.id)).toBe(before);
    });
  });
});
