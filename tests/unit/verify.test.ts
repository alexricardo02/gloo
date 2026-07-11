import { describe, it, expect, vi, beforeEach } from 'vitest';
import { verifyAccountAction } from '@/app/actions/verify';
import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

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

describe('Verify Server Actions (Unit Tests)', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('verifyAccountAction', () => {
    it('should return invalidTokenError if no token is provided', async () => {
      const result = await verifyAccountAction('', 'en');
      expect(result).toEqual({ error: 'invalidTokenError' });
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
});
  expect(result).toEqual({ error: 'invalidTokenError' });
});

    it('should verify the user, set cookies, and redirect to search-groups on success', async () => {
      // Mock the user being found
  vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ id: 'user-123' } as any);
      
      const mockSet = vi.fn();
      const mockDelete = vi.fn();
      vi.mocked(cookies).mockResolvedValue({ set: mockSet, delete: mockDelete } as any);

      await verifyAccountAction('valid-token', 'en');

      // Verify Prisma Update was called to clear the token and set isVerified
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: { isVerified: true, verificationToken: null, verificationTokenExpiry: null },
      });

      // Verify Session Cookies
      expect(mockSet).toHaveBeenCalledWith('gloo_user_id', 'user-123', expect.any(Object));
      expect(mockDelete).toHaveBeenCalledWith('gloo_is_guest');
      
      // Verify Redirect
      expect(redirect).toHaveBeenCalledWith('/en/search-groups');
    });
  });
});