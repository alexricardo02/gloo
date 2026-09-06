import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loginAsGuest, clearGuestSession, checkIsGuest } from '../../app/actions/guest';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

describe('Guest Actions', () => {
  // Store the original environment state to restore it later
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore environment variables after each test to prevent test pollution
    vi.unstubAllEnvs();
  });

  it('loginAsGuest: should set the cookies and redirect to the search group page', async () => {
    const mockSet = vi.fn();
    vi.mocked(cookies).mockResolvedValue({ set: mockSet } as any);

    await loginAsGuest('en');

    expect(mockSet).toHaveBeenCalledWith(
      'gloo_is_guest',
      'true',
      expect.objectContaining({ path: '/', httpOnly: true })
    );

    expect(mockSet).toHaveBeenCalledWith(
      'gloo_guest_id',
      expect.any(String),
      expect.any(Object)
    );

    expect(redirect).toHaveBeenCalledWith('/en/search-groups');
  });

  it('loginAsGuest: should set secure cookies when in a production environment', async () => {
    // Why: Ensures that cookies are properly secured against man-in-the-middle attacks over HTTPS when deployed to a production environment.
    vi.stubEnv('NODE_ENV', 'production');
    const mockSet = vi.fn();
    vi.mocked(cookies).mockResolvedValue({ set: mockSet } as any);

    await loginAsGuest('en');

    expect(mockSet).toHaveBeenCalledWith(
      'gloo_is_guest',
      'true',
      expect.objectContaining({ secure: true })
    );
  });

  it('loginAsGuest: should set insecure cookies when in a development environment', async () => {
    // Why: Ensures that local development is not broken by strict HTTPS requirements for cookies on localhost.
    vi.stubEnv('NODE_ENV', 'development');
    const mockSet = vi.fn();
    vi.mocked(cookies).mockResolvedValue({ set: mockSet } as any);

    await loginAsGuest('en');

    expect(mockSet).toHaveBeenCalledWith(
      'gloo_is_guest',
      'true',
      expect.objectContaining({ secure: false })
    );
  });

  it('clearGuestSession: should delete guest cookies', async () => {
    const mockDelete = vi.fn();
    vi.mocked(cookies).mockResolvedValue({ delete: mockDelete } as any);

    await clearGuestSession();

    expect(mockDelete).toHaveBeenCalledWith('gloo_is_guest');
    expect(mockDelete).toHaveBeenCalledWith('gloo_guest_id');
  });

  it('checkIsGuest: should return true if the guest cookie is present', async () => {
    // Why: Confirms that the system correctly identifies active guest users so the UI can adapt properly.
    const mockGet = vi.fn().mockReturnValue({ name: 'gloo_is_guest', value: 'true' });
    
    vi.mocked(cookies).mockResolvedValue({ get: mockGet } as any);

    const result = await checkIsGuest();

    expect(mockGet).toHaveBeenCalledWith('gloo_is_guest');
    expect(result).toBe(true);
  });

  it('checkIsGuest: should return false if the guest cookie is not present', async () => {
    // Why: Confirms that fully registered users or unauthenticated visitors are not incorrectly flagged as guests by the system.
    const mockGet = vi.fn().mockReturnValue(undefined);
    
    vi.mocked(cookies).mockResolvedValue({ get: mockGet } as any);

    const result = await checkIsGuest();

    expect(mockGet).toHaveBeenCalledWith('gloo_is_guest');
    expect(result).toBe(false);
  });


});