import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  registerUser,
  loginUser,
  checkUsernameAvailability,
  requestPasswordReset,
  resetPassword,
  deleteAccountAction,
} from "@/app/actions/auth";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";

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

  afterAll(async () => {
    // Clean up every user created during this test run
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

      expect(result).toEqual({ success: true, needsVerification: true });

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

    it("should return emailExistsError when the same email is registered twice", async () => {
      const email = testEmail("dup");

      // First registration succeeds
      await registerUser(
        createFormData({
          name: "First",
          email,
          username: testUsername("dup1"),
          password: "ValidPass123!",
          birthDate: adultBirthDate(),
        }),
        "en"
      );

      // Second registration with same email must fail
      const result = await registerUser(
        createFormData({
          name: "Second",
          email,
          username: testUsername("dup2"),
          password: "ValidPass123!",
          birthDate: adultBirthDate(),
        }),
        "en"
      );

      expect(result).toEqual({ error: "emailExistsError" });
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

      expect(result).toEqual({ error: "usernameTakenError" });
    });

    it("should reject registration for a user under 18", async () => {
      const underageDate = new Date();
      underageDate.setFullYear(underageDate.getFullYear() - 15);

      const result = await registerUser(
        createFormData({
          name: "Minor User",
          email: testEmail("minor"),
          username: testUsername("minor"),
          password: "ValidPass123!",
          birthDate: underageDate.toISOString().split("T")[0],
        }),
        "en"
      );

      expect(result).toEqual({
        error: "ageMinError",
      });

      const stored = await prisma.user.findUnique({
        where: { email: `minor${TEST_EMAIL_DOMAIN}` },
      });
      expect(stored).toBeNull();
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

      expect(result).toEqual({ error: "passwordWeakError" });
    });
  });

  // ── loginUser ─────────────────────────────────────────────────────────────────

  describe("loginUser", () => {
    it("should set gloo_user_id cookie and redirect on successful login by email", async () => {
      const email = testEmail("loginbyemail");
      const user = await createVerifiedUser({ email });

      const mockSet = vi.fn();
      const mockDelete = vi.fn();
      vi.mocked(cookies).mockResolvedValue({
        set: mockSet,
        delete: mockDelete,
        get: vi.fn(),
      } as any);

      try {
        await loginUser(createFormData({ identifier: email, password: "ValidPass123!" }), "en");
      } catch (e: any) {
        expect(e.message).toContain("NEXT_REDIRECT:/en/search-groups");
      }

      expect(mockSet).toHaveBeenCalledWith("gloo_user_id", user.id, expect.any(Object));
      expect(mockDelete).toHaveBeenCalledWith("gloo_is_guest");
    });

    it("should set gloo_user_id cookie and redirect on successful login by username", async () => {
      const username = testUsername("loginbyusr");
      const user = await createVerifiedUser({ username });

      const mockSet = vi.fn();
      vi.mocked(cookies).mockResolvedValue({
        set: mockSet,
        delete: vi.fn(),
        get: vi.fn(),
      } as any);

      try {
        await loginUser(
          createFormData({ identifier: username, password: "ValidPass123!" }),
          "en"
        );
      } catch (e: any) {
        expect(e.message).toContain("NEXT_REDIRECT");
      }

      expect(mockSet).toHaveBeenCalledWith("gloo_user_id", user.id, expect.any(Object));
    });

    it("should return invalidCredentialsError for a wrong password", async () => {
      const email = testEmail("wrongpw");
      await createVerifiedUser({ email });

      vi.mocked(cookies).mockResolvedValue({
        set: vi.fn(),
        delete: vi.fn(),
        get: vi.fn(),
      } as any);

      const result = await loginUser(
        createFormData({ identifier: email, password: "WrongPassword1!" }),
        "en"
      );

      expect(result).toEqual({ error: "invalidCredentialsError" });
    });

    it("should return invalidCredentialsError for a non-existent email", async () => {
      vi.mocked(cookies).mockResolvedValue({
        set: vi.fn(),
        delete: vi.fn(),
        get: vi.fn(),
      } as any);

      const result = await loginUser(
        createFormData({
          identifier: `nobody-${uid()}@nonexistent.test`,
          password: "ValidPass123!",
        }),
        "en"
      );

      expect(result).toEqual({ error: "invalidCredentialsError" });
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
          verificationToken: "pending-token",
        },
      });

      vi.mocked(cookies).mockResolvedValue({
        set: vi.fn(),
        delete: vi.fn(),
        get: vi.fn(),
      } as any);

      const result = await loginUser(
        createFormData({ identifier: email, password: "ValidPass123!" }),
        "en"
      );

      expect(result).toEqual({ error: "emailNotVerifiedError" });
    });

    it("should NOT set a session cookie when login fails", async () => {
      const mockSet = vi.fn();
      vi.mocked(cookies).mockResolvedValue({
        set: mockSet,
        delete: vi.fn(),
        get: vi.fn(),
      } as any);

      await loginUser(
        createFormData({ identifier: "ghost@nowhere.test", password: "Whatever1!" }),
        "en"
      );

      expect(mockSet).not.toHaveBeenCalled();
    });
  });

  // ── checkUsernameAvailability ──────────────────────────────────────────────

  describe("checkUsernameAvailability", () => {
    it("should return available: true for a username that does not exist in the DB", async () => {
      const result = await checkUsernameAvailability(`free_${uid()}`);
      expect(result).toEqual({ available: true });
    });

    it("should return available: false for a username that already exists in the DB", async () => {
      const username = testUsername("existscheck");
      await createVerifiedUser({ username });

      const result = await checkUsernameAvailability(username);
      expect(result).toEqual({ available: false });
    });

    it("should return available: false without querying the DB for usernames shorter than 3 chars", async () => {
      const result = await checkUsernameAvailability("ab");
      expect(result).toEqual({ available: false });
    });
  });

  // ── Password Reset Flow ───────────────────────────────────────────────────

  describe("Password Reset Flow", () => {
    it("should write a reset token and expiry to the DB when a valid email is submitted", async () => {
      const email = testEmail("resetreq");
      await createVerifiedUser({ email });

      const result = await requestPasswordReset(email, "en");
      expect(result).toEqual({ success: true });

      const stored = await prisma.user.findUnique({ where: { email } });
      expect(stored!.resetPasswordToken).not.toBeNull();
      expect(stored!.resetPasswordExpiry).not.toBeNull();

      // Expiry must be in the future
      expect(new Date(stored!.resetPasswordExpiry!).getTime()).toBeGreaterThan(Date.now());
    });

    it("should return success even when the email does not exist (prevents user enumeration)", async () => {
      const result = await requestPasswordReset(
        `nobody-${uid()}@never-registered.test`,
        "en"
      );
      expect(result).toEqual({ success: true });
    });

    it("should update the password and clear the token when a valid, non-expired token is submitted", async () => {
      const email = testEmail("resetpw");
      const resetToken = `valid-token-${uid()}`;
      const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
      const oldPassword = "OldValidPass123!";

      await prisma.user.create({
        data: {
          email,
          name: "Reset PW User",
          username: testUsername("resetpw"),
          password: await bcrypt.hash(oldPassword, 10),
          birthDate: new Date("2000-01-01"),
          isVerified: true,
          verificationToken: null,
          resetPasswordToken: resetToken,
          resetPasswordExpiry: expiry,
        },
      });

      const result = await resetPassword(resetToken, "NewSecurePass456!");
      expect(result).toEqual({ success: true });

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
          resetPasswordToken: resetToken,
          resetPasswordExpiry: expiredAt,
        },
      });

      const result = await resetPassword(resetToken, "NewSecurePass456!");
      expect(result).toEqual({ error: "tokenInvalidOrExpired" });

      // Password must remain unchanged
      const unchanged = await prisma.user.findUnique({ where: { email } });
      const oldPasswordStillWorks = await bcrypt.compare(oldPassword, unchanged!.password);
      expect(oldPasswordStillWorks).toBe(true);
    });

    it("should reject a completely fake reset token", async () => {
      const result = await resetPassword(`fake-token-${uid()}`, "NewSecurePass456!");
      expect(result).toEqual({ error: "tokenInvalidOrExpired" });
    });

    it("should reject a weak new password even with a valid token", async () => {
      const result = await resetPassword("any-token", "weak");
      expect(result).toEqual({ error: "passwordWeakError" });
    });
  });

  // ── deleteAccountAction ───────────────────────────────────────────────────

  describe("deleteAccountAction", () => {
    it("should permanently delete the user row from the database", async () => {
      const email = testEmail("delete");
      const user = await createVerifiedUser({ email });

      vi.mocked(cookies).mockResolvedValue({
        get: vi.fn().mockReturnValue({ value: user.id }),
        set: vi.fn(),
        delete: vi.fn(),
      } as any);

      try {
        await deleteAccountAction("en");
      } catch (e: any) {
        expect(e.message).toContain("NEXT_REDIRECT");
      }

      const deletedUser = await prisma.user.findUnique({ where: { id: user.id } });
      expect(deletedUser).toBeNull();
    });

    it("should cascade-delete the user's group when the account is deleted", async () => {
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

      vi.mocked(cookies).mockResolvedValue({
        get: vi.fn().mockReturnValue({ value: user.id }),
        set: vi.fn(),
        delete: vi.fn(),
      } as any);

      try {
        await deleteAccountAction("en");
      } catch (_) {
        // redirect expected
      }

      const deletedUser = await prisma.user.findUnique({ where: { id: user.id } });
      const deletedGroup = await prisma.group.findUnique({ where: { id: groupId } });

      expect(deletedUser).toBeNull();
      expect(deletedGroup).toBeNull();
    });

    it("should set guest cookies after the account is deleted", async () => {
      const email = testEmail("delcookie");
      const user = await createVerifiedUser({ email });

      const mockSet = vi.fn();
      const mockDelete = vi.fn();

      vi.mocked(cookies).mockResolvedValue({
        get: vi.fn().mockReturnValue({ value: user.id }),
        set: mockSet,
        delete: mockDelete,
      } as any);

      try {
        await deleteAccountAction("en");
      } catch (_) {
        // redirect expected
      }

      expect(mockDelete).toHaveBeenCalledWith("gloo_user_id");
      expect(mockSet).toHaveBeenCalledWith(
        "gloo_is_guest",
        "true",
        expect.objectContaining({ httpOnly: true })
      );
    });

    it("should return Unauthorized and not touch the DB if no session cookie is present", async () => {
      vi.mocked(cookies).mockResolvedValue({
        get: vi.fn().mockReturnValue(undefined),
        set: vi.fn(),
        delete: vi.fn(),
      } as any);

      const result = await deleteAccountAction("en");
      expect(result).toEqual({ error: "Unauthorized" });
    });
  });
});