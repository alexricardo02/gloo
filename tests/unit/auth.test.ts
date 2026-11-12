import { createHash } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  registerUser,
  loginUser,
  getCurrentUser,
  logOutAction,
  checkUsernameAvailability,
  resetPassword,
  requestPasswordReset,
} from '@/app/actions/auth';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyAccountAction } from "@/app/actions/verify";
import { createSession, destroyCurrentSession, getOptionalUserId } from '@/lib/session';
import { checkRateLimit } from '@/lib/rateLimit';

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://dummy.supabase.co";

// MOCKS
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    session: {
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn(),
    compare: vi.fn(),
  },
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

// The session layer has its own tests (tests/unit/session.test.ts and
// tests/integration/session.test.ts); here we only check that the actions use it.
vi.mock('@/lib/session', () => ({
  SESSION_COOKIE: 'gloo_session',
  createSession: vi.fn(),
  destroyCurrentSession: vi.fn(),
  getOptionalUserId: vi.fn(),
  requireUserId: vi.fn(),
  getCurrentSessionTokenHash: vi.fn(),
}));

vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: vi.fn(),
  getClientIp: vi.fn().mockResolvedValue('203.0.113.1'),
}));

// --- HELPERS ---
const sha256Hex = (value: string) => createHash('sha256').update(value).digest('hex');

const createFormData = (data: Record<string, string>) => {
  const formData = new FormData();
  Object.entries(data).forEach(([key, value]) => formData.append(key, value));
  return formData;
};

// Calculate dynamic dates to avoid hardcoded dates expiring
const getAdultDate = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 20); // 20 years old
  return d.toISOString().split('T')[0];
};

const getMinorDate = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 15); // 15 years old
  return d.toISOString().split('T')[0];
};

const validRegistration = (overrides: Record<string, string> = {}) =>
  createFormData({
    email: 'new@test.com',
    password: 'ValidPassword123!',
    username: 'newuser',
    name: 'John Doe',
    birthDate: getAdultDate(),
    ...overrides,
  });

const mockCookieStore = () => {
  const store = { set: vi.fn(), delete: vi.fn(), get: vi.fn() };
  vi.mocked(cookies).mockResolvedValue(store as never);
  return store;
};

describe('Auth Server Actions (Unit Tests)', () => {

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockResolvedValue(true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // The suites below describe the behaviour WITH email flows (verification,
    // password reset). The flag-off behaviour has its own describe at the end.
    vi.stubEnv('EMAIL_FLOWS_ENABLED', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // 1. REGISTER USER TESTS
  describe('registerUser', () => {
    it('should return dobInvalidError if birthDate is missing', async () => {
      const formData = createFormData({ email: 'test@test.com', password: 'Password123!', username: 'testuser', name: 'T' });
      const result = await registerUser(formData, 'en');
      expect(result).toEqual({ ok: false, code: 'VALIDATION', messageKey: 'dobInvalidError' });
    });

    it('should return an ageMinError if user is under 18', async () => {
      const result = await registerUser(validRegistration({ birthDate: getMinorDate() }), 'en');
      expect(result).toEqual({ ok: false, code: 'VALIDATION', messageKey: 'ageMinError' });
    });

    it('should return passwordWeakError if password is not strong enough', async () => {
      const result = await registerUser(validRegistration({ password: 'weak' }), 'en');
      expect(result).toEqual({ ok: false, code: 'VALIDATION', messageKey: 'passwordWeakError' });
    });

    it('should return passwordTooLongError for passwords over 72 UTF-8 bytes', async () => {
      const result = await registerUser(validRegistration({ password: 'Aa1!' + 'x'.repeat(69) }), 'en');
      expect(result).toEqual({ ok: false, code: 'VALIDATION', messageKey: 'passwordTooLongError' });
    });

    it('should return usernameSpaceError for usernames with whitespace', async () => {
      const result = await registerUser(validRegistration({ username: 'has space' }), 'en');
      expect(result).toEqual({ ok: false, code: 'VALIDATION', messageKey: 'usernameSpaceError' });
    });

    it('should return usernameTakenError if username is already in the database', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ id: '2' } as never);

      const result = await registerUser(validRegistration({ username: 'taken_user' }), 'en');
      expect(result).toEqual({ ok: false, code: 'VALIDATION', messageKey: 'usernameTakenError' });
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('should successfully create an unverified user and return success', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
      vi.mocked(bcrypt.hash).mockResolvedValue('hashed_password' as never);

      const result = await registerUser(validRegistration(), 'en');

      // Verify Prisma create was called with correct data
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: 'new@test.com',
          username: 'newuser',
          name: 'John Doe',
          password: 'hashed_password',
          isVerified: false,
          birthDate: expect.any(Date),
          verificationToken: expect.any(String),
        })
      });

      expect(result).toEqual({ ok: true, data: { needsVerification: true } });
    });

    it('should store the birthdate as the exact calendar date (S10, no timezone shift)', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
      vi.mocked(bcrypt.hash).mockResolvedValue('hashed_password' as never);

      await registerUser(validRegistration({ birthDate: '2000-03-15' }), 'en');

      const data = vi.mocked(prisma.user.create).mock.calls[0][0].data;
      expect((data.birthDate as Date).toISOString()).toBe('2000-03-15T00:00:00.000Z');
    });

    it('should catch critical errors and return registrationGenericError', async () => {
      vi.mocked(prisma.user.findUnique).mockRejectedValueOnce(new Error('DB Down'));

      const result = await registerUser(validRegistration(), 'en');
      expect(result).toEqual({ ok: false, code: 'INTERNAL', messageKey: 'registrationGenericError' });
    });

    it('should return RATE_LIMITED and do no DB work when the limiter blocks', async () => {
      vi.mocked(checkRateLimit).mockResolvedValueOnce(false);

      const result = await registerUser(validRegistration(), 'en');
      expect(result).toEqual({ ok: false, code: 'RATE_LIMITED', messageKey: 'tooManyAttemptsError' });
      expect(checkRateLimit).toHaveBeenCalledWith('register', { ip: '203.0.113.1', identifier: 'new@test.com' });
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
  });

  // 2. LOGIN USER TESTS

  describe('loginUser', () => {
    it('should return an error if credentials are missing', async () => {
      const formData = createFormData({});
      const result = await loginUser(formData, 'en');
      expect(result).toEqual({ ok: false, code: 'VALIDATION', messageKey: 'invalidCredentialsError' });
    });

    it('should return invalidCredentialsError if user is not found', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValue(null);

      const formData = createFormData({ identifier: 'wrong@user.com', password: 'pw' });
      const result = await loginUser(formData, 'en');

      expect(result).toEqual({ ok: false, code: 'UNAUTHORIZED', messageKey: 'invalidCredentialsError' });
    });

    it('should return invalidCredentialsError if password does not match', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValue({ password: 'hashed_pw' } as never);
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

      const formData = createFormData({ identifier: 'user@test.com', password: 'wrongpw' });
      const result = await loginUser(formData, 'en');

      expect(result).toEqual({ ok: false, code: 'UNAUTHORIZED', messageKey: 'invalidCredentialsError' });
      expect(createSession).not.toHaveBeenCalled();
    });

    it('should return emailNotVerifiedError if user account is not activated', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValue({ password: 'hashed_pw', isVerified: false } as never);
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);

      const formData = createFormData({ identifier: 'user@test.com', password: 'correctpw' });
      const result = await loginUser(formData, 'en');

      expect(result).toEqual({ ok: false, code: 'FORBIDDEN', messageKey: 'emailNotVerifiedError' });
      expect(createSession).not.toHaveBeenCalled();
    });

    it('should create a server-side session and redirect upon successful login', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: 'user-123', password: 'hashed_pw', isVerified: true } as never);
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
      const store = mockCookieStore();

      const formData = createFormData({ identifier: 'user@test.com', password: 'correctpw' });
      await loginUser(formData, 'en');

      expect(createSession).toHaveBeenCalledWith('user-123');
      // The user id itself is never written into a cookie anymore.
      expect(store.set).not.toHaveBeenCalledWith(expect.anything(), 'user-123', expect.anything());
      expect(store.delete).toHaveBeenCalledWith('gloo_is_guest');
      expect(redirect).toHaveBeenCalledWith('/en/search-groups');
    });

    it('should return RATE_LIMITED before touching the database', async () => {
      vi.mocked(checkRateLimit).mockResolvedValueOnce(false);

      const formData = createFormData({ identifier: 'user@test.com', password: 'pw' });
      const result = await loginUser(formData, 'en');

      expect(result).toEqual({ ok: false, code: 'RATE_LIMITED', messageKey: 'tooManyAttemptsError' });
      expect(checkRateLimit).toHaveBeenCalledWith('login', { ip: '203.0.113.1', identifier: 'user@test.com' });
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('should return a typed INTERNAL error instead of throwing when the DB fails (D12)', async () => {
      vi.mocked(prisma.user.findFirst).mockRejectedValue(new Error('DB down'));

      const formData = createFormData({ identifier: 'user@test.com', password: 'pw' });
      const result = await loginUser(formData, 'en');

      expect(result).toEqual({ ok: false, code: 'INTERNAL', messageKey: 'error' });
      expect(console.error).toHaveBeenCalled();
      expect(redirect).not.toHaveBeenCalled();
    });
  });

  // 3. GET CURRENT USER TESTS

  describe('getCurrentUser', () => {
    it('should return null if there is no valid session', async () => {
      vi.mocked(getOptionalUserId).mockResolvedValue(null);
      const user = await getCurrentUser();
      expect(user).toBeNull();
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('should return user object for a valid session', async () => {
      vi.mocked(getOptionalUserId).mockResolvedValue('user-123');
      const mockUser = { name: 'John', username: 'johndoe', image: 'avatar.png' };
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as never);

      const user = await getCurrentUser();

      expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'user-123' } }));
      expect(user).toEqual(mockUser);
    });
  });

  // 4. LOGOUT TESTS

  describe('logOutAction', () => {
    it('should revoke the session, set guest cookies and redirect', async () => {
      const store = mockCookieStore();

      await logOutAction('en');

      expect(destroyCurrentSession).toHaveBeenCalled();
      expect(store.set).toHaveBeenCalledWith('gloo_is_guest', 'true', expect.any(Object));
      expect(store.set).toHaveBeenCalledWith('gloo_guest_id', expect.any(String), expect.any(Object));
      expect(redirect).toHaveBeenCalledWith('/en/search-groups');
    });
  });

  // 5. REAL-TIME VALIDATION TESTS

  describe('checkUsernameAvailability', () => {
    it('should instantly return false if username is less than 3 characters', async () => {
      const result = await checkUsernameAvailability('ab');
      expect(result).toEqual({ ok: true, data: { available: false } });
      expect(prisma.user.findUnique).not.toHaveBeenCalled(); // Ensures DB is not queried
    });

    it('should return available: false if username exists', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'existing-user' } as never);
      const result = await checkUsernameAvailability('takenUser');
      expect(result).toEqual({ ok: true, data: { available: false } });
    });

    it('should return available: true if username does not exist', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
      const result = await checkUsernameAvailability('freeUser');
      expect(result).toEqual({ ok: true, data: { available: true } });
    });

    it('should catch exceptions and return a typed error', async () => {
      vi.mocked(prisma.user.findUnique).mockRejectedValue(new Error('Network error'));
      const result = await checkUsernameAvailability('errorUser');
      expect(result).toEqual({ ok: false, code: 'INTERNAL' });
    });

    it('should be rate limited per IP and per username', async () => {
      vi.mocked(checkRateLimit).mockResolvedValueOnce(false);
      const result = await checkUsernameAvailability('someone');
      expect(result).toEqual({ ok: false, code: 'RATE_LIMITED', messageKey: 'tooManyAttemptsError' });
      expect(checkRateLimit).toHaveBeenCalledWith('usernameCheck', { ip: '203.0.113.1', identifier: 'someone' });
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
  });

  describe("Security Boundaries: Password Reset", () => {
    it("should reject a password reset if the token has expired", async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValue(null);

      const result = await resetPassword("expired-token", "NewSecurePass123!");

      // Based on standard security requirements, this MUST fail
      expect(result).toEqual({ ok: false, code: 'NOT_FOUND', messageKey: 'tokenInvalidOrExpired' });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("should reject a password reset if no valid token is provided", async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValue(null);

      const result = await resetPassword("fake-token", "NewSecurePass123!");

      expect(result).toEqual({ ok: false, code: 'NOT_FOUND', messageKey: 'tokenInvalidOrExpired' });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("should look the token up by its SHA-256 hash, never the raw value, and keep the expiry check", async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValue(null);

      await resetPassword("raw-reset-token", "NewSecurePass123!");

      const where = vi.mocked(prisma.user.findFirst).mock.calls[0][0]!.where!;
      expect(where.resetPasswordToken).toBe(sha256Hex("raw-reset-token"));
      expect(where.resetPasswordExpiry).toEqual({ gt: expect.any(Date) });
    });

    it("should store only the hash of a new reset token; the raw token goes only into the link", async () => {
      vi.stubEnv('NODE_ENV', 'development');
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'user-5' } as never);

        const result = await requestPasswordReset("someone@test.com", "en");
        expect(result).toEqual({ ok: true, data: undefined });

        const linkLine = log.mock.calls.map((c) => String(c[0])).find((l) => l.includes('token='));
        const rawToken = new URL(linkLine!.split('→ ')[1].trim()).searchParams.get('token')!;
        expect(rawToken.length).toBeGreaterThan(0);

        const data = vi.mocked(prisma.user.update).mock.calls[0][0].data;
        expect(data.resetPasswordToken).toBe(sha256Hex(rawToken));
        expect(data.resetPasswordToken).not.toBe(rawToken);
        expect(data.resetPasswordToken).toMatch(/^[0-9a-f]{64}$/);
      } finally {
        vi.unstubAllEnvs();
        log.mockRestore();
      }
    });

    it("should update the password AND revoke all sessions in one transaction", async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: 'user-9' } as never);
      vi.mocked(bcrypt.hash).mockResolvedValue('new-hash' as never);
      vi.mocked(prisma.user.update).mockReturnValue('update-op' as never);
      vi.mocked(prisma.session.deleteMany).mockReturnValue('revoke-op' as never);

      const result = await resetPassword("good-token", "NewSecurePass123!");

      expect(result).toEqual({ ok: true, data: undefined });
      expect(vi.mocked(prisma.user.findFirst).mock.calls[0][0]!.where!.resetPasswordToken).toBe(sha256Hex("good-token"));
      expect(prisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-9' } });
      expect(prisma.$transaction).toHaveBeenCalledWith(['update-op', 'revoke-op']);
    });

    it("should rate limit reset submissions per IP only (the token is attacker-chosen)", async () => {
      vi.mocked(checkRateLimit).mockResolvedValueOnce(false);
      const result = await resetPassword("any-token", "NewSecurePass123!");
      expect(result).toEqual({ ok: false, code: 'RATE_LIMITED', messageKey: 'tooManyAttemptsError' });
      expect(checkRateLimit).toHaveBeenCalledWith('passwordResetSubmit', { ip: '203.0.113.1' });
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });

    it("should rate limit reset requests per IP and email", async () => {
      vi.mocked(checkRateLimit).mockResolvedValueOnce(false);
      const result = await requestPasswordReset("victim@test.com", "en");
      expect(result).toEqual({ ok: false, code: 'RATE_LIMITED', messageKey: 'tooManyAttemptsError' });
      expect(checkRateLimit).toHaveBeenCalledWith('passwordResetRequest', { ip: '203.0.113.1', identifier: 'victim@test.com' });
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('should NOT reveal that an email already exists when registering (S14)', async () => {
      vi.mocked(bcrypt.hash).mockResolvedValue('hashed_pw' as never);

      // New email: username free, email free.
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      const forNewEmail = await registerUser(validRegistration({ email: 'fresh@example.com' }), 'en');

      // Existing email: username free, email taken.
      vi.mocked(prisma.user.findUnique)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: "existing-id" } as never);
      const forExistingEmail = await registerUser(validRegistration({ email: 'alreadyused@example.com' }), 'en');

      expect(forExistingEmail).toEqual(forNewEmail);
      expect(forExistingEmail).toEqual({ ok: true, data: { needsVerification: true } });
      // Only the new email created a row; both paths ran the same bcrypt work.
      expect(prisma.user.create).toHaveBeenCalledTimes(1);
      expect(bcrypt.hash).toHaveBeenCalledTimes(2);
    });
  });

  describe("Registration Redirection Flow", () => {
    it("should preserve email verification requirement and return needsVerification", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
      vi.mocked(bcrypt.hash).mockResolvedValue('hashed_pw' as never);

      const result = await registerUser(
        validRegistration({ email: 'redirect-test@test.com', username: 'redirect_user', name: 'Redirect User' }),
        'en',
      );

      expect(result).toEqual({ ok: true, data: { needsVerification: true } });
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: 'redirect-test@test.com',
          isVerified: false,
        }),
      });
    });

    it("should redirect newly verified user to /profile/create-group upon activation", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: 'user-post-reg-123',
        isVerified: false,
      } as never);
      const store = mockCookieStore();

      await verifyAccountAction('valid-activation-token', 'en');

      // User activation
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-post-reg-123' },
        data: { isVerified: true, verificationToken: null, verificationTokenExpiry: null },
      });

      // Session established
      expect(createSession).toHaveBeenCalledWith('user-post-reg-123');
      expect(store.delete).toHaveBeenCalledWith('gloo_is_guest');

      // Critical requirement: must redirect directly to /en/profile/create-group
      expect(redirect).toHaveBeenCalledWith('/en/profile/create-group');
    });

    it("should redirect with dynamic locale to /{locale}/profile/create-group (es locale)", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
        id: 'user-es-456',
        isVerified: false,
      } as never);
      mockCookieStore();

      await verifyAccountAction('valid-token-es', 'es');

      expect(redirect).toHaveBeenCalledWith('/es/profile/create-group');
    });
  });

  // EMAIL_FLOWS_ENABLED off (the default while there is no email provider)
  describe('with EMAIL_FLOWS_ENABLED off', () => {
    beforeEach(() => {
      vi.stubEnv('EMAIL_FLOWS_ENABLED', 'false');
    });

    it('register: creates an unverified user WITHOUT a token, signs in and redirects like a login', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
      vi.mocked(bcrypt.hash).mockResolvedValue('hashed_password' as never);
      vi.mocked(prisma.user.create).mockResolvedValue({ id: 'new-user-1' } as never);
      const store = mockCookieStore();
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.stubEnv('NODE_ENV', 'development');

      const result = await registerUser(validRegistration(), 'en');

      expect(result).toBeUndefined(); // success redirects instead of returning
      const data = vi.mocked(prisma.user.create).mock.calls[0][0].data;
      expect(data).toMatchObject({ email: 'new@test.com', username: 'newuser', isVerified: false, password: 'hashed_password' });
      expect(data).not.toHaveProperty('verificationToken');
      expect(data).not.toHaveProperty('verificationTokenExpiry');
      expect(createSession).toHaveBeenCalledWith('new-user-1');
      expect(store.delete).toHaveBeenCalledWith('gloo_is_guest');
      expect(redirect).toHaveBeenCalledWith('/en/search-groups');
      expect(log).not.toHaveBeenCalled();
      log.mockRestore();
    });

    it('register: keeps the locale prefix in the redirect', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
      vi.mocked(bcrypt.hash).mockResolvedValue('hashed_password' as never);
      vi.mocked(prisma.user.create).mockResolvedValue({ id: 'new-user-2' } as never);
      mockCookieStore();

      await registerUser(validRegistration(), 'de');
      expect(redirect).toHaveBeenCalledWith('/de/search-groups');
    });

    it('register: an existing email returns emailExistsError, creates nothing and logs nothing', async () => {
      vi.mocked(bcrypt.hash).mockResolvedValue('hashed_password' as never);
      vi.mocked(prisma.user.findUnique)
        .mockResolvedValueOnce(null) // username free
        .mockResolvedValueOnce({ id: 'existing-id' } as never); // email taken
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.stubEnv('NODE_ENV', 'development');

      const result = await registerUser(validRegistration({ email: 'taken@example.com' }), 'en');

      expect(result).toEqual({ ok: false, code: 'VALIDATION', messageKey: 'emailExistsError' });
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(createSession).not.toHaveBeenCalled();
      expect(redirect).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
      log.mockRestore();
    });

    it('register: an email unique-constraint race also returns emailExistsError', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
      vi.mocked(bcrypt.hash).mockResolvedValue('hashed_password' as never);
      vi.mocked(prisma.user.create).mockRejectedValue({ code: 'P2002', meta: { target: ['email'] } });

      const result = await registerUser(validRegistration(), 'en');
      expect(result).toEqual({ ok: false, code: 'VALIDATION', messageKey: 'emailExistsError' });
      expect(createSession).not.toHaveBeenCalled();
    });

    it('register: is still rate limited', async () => {
      vi.mocked(checkRateLimit).mockResolvedValueOnce(false);
      const result = await registerUser(validRegistration(), 'en');
      expect(result).toEqual({ ok: false, code: 'RATE_LIMITED', messageKey: 'tooManyAttemptsError' });
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('login: an unverified account can log in', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: 'unverified-1', password: 'hashed_pw', isVerified: false } as never);
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
      mockCookieStore();

      await loginUser(createFormData({ identifier: 'user@test.com', password: 'correctpw' }), 'en');

      expect(createSession).toHaveBeenCalledWith('unverified-1');
      expect(redirect).toHaveBeenCalledWith('/en/search-groups');
    });

    it('login: a wrong password is still rejected', async () => {
      vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: 'u', password: 'hashed_pw', isVerified: false } as never);
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

      const result = await loginUser(createFormData({ identifier: 'user@test.com', password: 'wrong' }), 'en');
      expect(result).toEqual({ ok: false, code: 'UNAUTHORIZED', messageKey: 'invalidCredentialsError' });
      expect(createSession).not.toHaveBeenCalled();
    });

    it('requestPasswordReset: returns FEATURE_DISABLED without rate limiting, DB work or logging', async () => {
      vi.stubEnv('NODE_ENV', 'development');
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});

      const result = await requestPasswordReset('someone@test.com', 'en');

      expect(result).toEqual({ ok: false, code: 'FEATURE_DISABLED' });
      expect(checkRateLimit).not.toHaveBeenCalled();
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
      log.mockRestore();
    });

    it('resetPassword: returns FEATURE_DISABLED without touching the DB', async () => {
      const result = await resetPassword('some-token', 'NewSecurePass123!');

      expect(result).toEqual({ ok: false, code: 'FEATURE_DISABLED' });
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('verifyAccountAction: returns FEATURE_DISABLED without touching the DB', async () => {
      const result = await verifyAccountAction('some-token', 'en');

      expect(result).toEqual({ ok: false, code: 'FEATURE_DISABLED' });
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(createSession).not.toHaveBeenCalled();
    });
  });

});
