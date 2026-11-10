import { describe, it, expect, vi, beforeEach } from 'vitest';
import { verifyAccountAction } from '@/app/actions/verify';
import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createSession } from '@/lib/session';

// --- MOCKS ---
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

vi.mock('@/lib/session', () => ({
  createSession: vi.fn(),
}));

describe('Verify Server Actions (Unit Tests)', () => {

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('verifyAccountAction', () => {
    it('should return invalidTokenError if no token is provided', async () => {
      const result = await verifyAccountAction('', 'en');
      expect(result).toEqual({ ok: false, code: 'VALIDATION', messageKey: 'invalidTokenError' });
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('should return invalidTokenError if the token does not match any user', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
      const result = await verifyAccountAction('fake-token', 'en');
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: {
          verificationToken: 'fake-token',
          verificationTokenExpiry: {
            gt: expect.any(Date),
          },
        },
        select: { id: true },
      });
      expect(result).toEqual({ ok: false, code: 'NOT_FOUND', messageKey: 'invalidTokenError' });
      expect(createSession).not.toHaveBeenCalled();
    });

    it('should verify the user, create a session, and redirect to profile/create-group on success', async () => {
      // Mock the user being found
      vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ id: 'user-123' } as never);

      const mockSet = vi.fn();
      const mockDelete = vi.fn();
      vi.mocked(cookies).mockResolvedValue({ set: mockSet, delete: mockDelete } as never);

      await verifyAccountAction('valid-token', 'en');

      // Verify Prisma Update was called to clear the token and set isVerified
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: { isVerified: true, verificationToken: null, verificationTokenExpiry: null },
      });

      // Server-side session (the user id is never put in a cookie)
      expect(createSession).toHaveBeenCalledWith('user-123');
      expect(mockSet).not.toHaveBeenCalled();
      expect(mockDelete).toHaveBeenCalledWith('gloo_is_guest');

      // Verify Redirect
      expect(redirect).toHaveBeenCalledWith('/en/profile/create-group');
    });

    it('should return a typed INTERNAL error instead of throwing when the DB fails (D12)', async () => {
      vi.mocked(prisma.user.findUnique).mockRejectedValueOnce(new Error('DB down'));

      const result = await verifyAccountAction('valid-token', 'en');

      expect(result).toEqual({ ok: false, code: 'INTERNAL', messageKey: 'invalidTokenError' });
      expect(console.error).toHaveBeenCalled();
      expect(redirect).not.toHaveBeenCalled();
    });
  });
});
