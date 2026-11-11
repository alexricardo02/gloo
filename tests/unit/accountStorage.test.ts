import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deleteAccountAction, updateProfileImage } from '@/app/actions/auth';
import { prisma } from '@/lib/prisma';
import { requireUserId } from '@/lib/session';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { remove, removePrefix, upload } from '@/lib/storage';
import { StorageError } from '@/lib/storageKeys';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
  },
}));

vi.mock('@/lib/storage', async () => {
  const { isStorageKey } = await import('@/lib/storageKeys');
  return {
    upload: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    removePrefix: vi.fn().mockResolvedValue([]),
    withImageUrl: (u: { image: string | null }) => ({
      ...u,
      image: u.image && isStorageKey(u.image) ? `https://cdn.test/${u.image}` : u.image,
    }),
  };
});

vi.mock('@/lib/imageProcessing', () => ({
  processImage: vi.fn().mockResolvedValue({ buffer: Buffer.from('webp'), contentType: 'image/webp', extension: 'webp' }),
}));

vi.mock('@/lib/session', () => ({
  SESSION_COOKIE: 'gloo_session',
  createSession: vi.fn(),
  destroyCurrentSession: vi.fn(),
  getOptionalUserId: vi.fn(),
  requireUserId: vi.fn(),
  getCurrentSessionTokenHash: vi.fn(),
}));

vi.mock('@/lib/rateLimit', () => ({ checkRateLimit: vi.fn(), getClientIp: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

const USER = 'usr_1';
const GROUP = 'grp_1';

const jpegForm = () => {
  const formData = new FormData();
  formData.append('image', new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(60).fill(0)])], 'me.jpg'));
  return formData;
};

describe('Account storage cleanup (B15)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(requireUserId).mockResolvedValue(USER);
    vi.mocked(cookies).mockResolvedValue({ set: vi.fn(), delete: vi.fn(), get: vi.fn() } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: USER,
      image: 'profiles/usr_1-1700000000000.jpg',
      group: {
        id: GROUP,
        photos: [
          `groups/${GROUP}/11111111-1111-4111-8111-111111111111.webp`,
          'groups/usr_1-group-legacy.jpg',
          'groups/usr_2-group-foreign.jpg',
          'https://images.unsplash.com/photo-1',
        ],
      },
    } as never);
  });

  it('awaits cleanup of the user and group prefixes plus owned legacy keys after the DB delete', async () => {
    let cleanupFinished = false;
    vi.mocked(remove).mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      cleanupFinished = true;
    });

    await deleteAccountAction('en');

    // Awaited: finished before the action returned (no fire-and-forget).
    expect(cleanupFinished).toBe(true);
    expect(removePrefix).toHaveBeenCalledWith(`users/${USER}/`);
    expect(removePrefix).toHaveBeenCalledWith(`groups/${GROUP}/`);
    expect(remove).toHaveBeenCalledWith(['profiles/usr_1-1700000000000.jpg', 'groups/usr_1-group-legacy.jpg']);
    expect(vi.mocked(removePrefix).mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(prisma.user.delete).mock.invocationCallOrder[0],
    );
    expect(redirect).toHaveBeenCalledWith('/en/search-groups');
  });

  it('logs the exact remaining paths and still completes when storage fails', async () => {
    vi.mocked(removePrefix).mockImplementation(async (prefix: string) => {
      throw new StorageError('Listing failed', [`${prefix}*`]);
    });
    vi.mocked(remove).mockRejectedValue(
      new StorageError('Delete failed', ['profiles/usr_1-1700000000000.jpg', 'groups/usr_1-group-legacy.jpg']),
    );

    await expect(deleteAccountAction('en')).resolves.toBeUndefined();

    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: USER } });
    expect(redirect).toHaveBeenCalledWith('/en/search-groups');
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining(`deleted account ${USER}`),
      [`users/${USER}/*`, `groups/${GROUP}/*`, 'profiles/usr_1-1700000000000.jpg', 'groups/usr_1-group-legacy.jpg'],
      expect.any(Array),
    );
  });

  it('rejects callers without a session', async () => {
    vi.mocked(requireUserId).mockRejectedValue(new Error('Unauthorized'));
    await expect(deleteAccountAction('en')).resolves.toEqual({ error: 'Unauthorized' });
    expect(prisma.user.delete).not.toHaveBeenCalled();
    expect(removePrefix).not.toHaveBeenCalled();
  });
});

describe('updateProfileImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(requireUserId).mockResolvedValue(USER);
  });

  it('uploads to users/{userId}/, stores the key and deletes the replaced image afterwards', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ image: 'profiles/usr_1-1700000000000.jpg' } as never);

    const result = await updateProfileImage(jpegForm());

    const key = vi.mocked(upload).mock.calls[0][0];
    expect(key).toMatch(new RegExp(`^users/${USER}/[0-9a-f-]{36}\\.webp$`));
    expect(upload).toHaveBeenCalledWith(key, Buffer.from('webp'), 'image/webp');
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: USER }, data: { image: key } });
    expect(result).toEqual({ success: true, image: `https://cdn.test/${key}` });
    expect(remove).toHaveBeenCalledWith(['profiles/usr_1-1700000000000.jpg']);
    expect(vi.mocked(remove).mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(prisma.user.update).mock.invocationCallOrder[0],
    );
  });

  it('never deletes a previous image it does not own', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ image: 'https://images.unsplash.com/x' } as never);
    await updateProfileImage(jpegForm());
    expect(remove).not.toHaveBeenCalled();
  });

  it('rejects unsupported types with the typed, localized error', async () => {
    const formData = new FormData();
    formData.append(
      'image',
      new File([new Uint8Array([0, 0, 0, 0x18, ...Buffer.from('ftypheicmif1heic'), ...new Array(40).fill(0)])], 'me.heic'),
    );

    const result = await updateProfileImage(formData);

    expect(result).toEqual({ error: expect.any(String), messageKey: 'unsupportedType' });
    expect(upload).not.toHaveBeenCalled();
  });
});
