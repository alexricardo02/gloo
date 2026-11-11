import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getGroupByUser, createGroupAction, deleteGroupAction } from '@/app/actions/group';
import { prisma } from '@/lib/prisma';
import { getOptionalUserId, requireUserId, UnauthorizedError } from '@/lib/session';
import { redirect } from 'next/navigation';
import { remove, removePrefix, upload } from '@/lib/storage';
import { processImage } from '@/lib/imageProcessing';

//  MOCKS
vi.mock('@/lib/prisma', () => ({
  prisma: {
    group: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

const BUCKET_BASE = 'https://dummy-project.supabase.co/storage/v1/object/public/gloo-images-test/';

// lib/storage.ts is the only module that talks to Supabase; mock it entirely.
// The URL helpers mirror the real ones (keys -> URL, everything else unchanged).
vi.mock('@/lib/storage', async () => {
  const { isStorageKey } = await import('@/lib/storageKeys');
  const toPublicUrl = (v: string) => (isStorageKey(v) ? `${BUCKET_BASE}${v}` : v);
  return {
    upload: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    removePrefix: vi.fn().mockResolvedValue([]),
    toPublicUrl,
    withPhotoUrls: (g: { photos: string[] } | null) => (g ? { ...g, photos: g.photos.map(toPublicUrl) } : null),
  };
});

// sharp re-encoding is covered by tests/unit/imageProcessing.test.ts.
vi.mock('@/lib/imageProcessing', () => ({
  processImage: vi.fn().mockResolvedValue({
    buffer: Buffer.from('webp-bytes'),
    contentType: 'image/webp',
    extension: 'webp',
  }),
}));

vi.mock('@/lib/session', async () => {
  const actual = await vi.importActual<typeof import('@/lib/session')>('@/lib/session');
  return {
    UnauthorizedError: actual.UnauthorizedError,
    getOptionalUserId: vi.fn(),
    requireUserId: vi.fn(),
  };
});

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

// HELPERS
const createFormData = (data: Record<string, string | Blob>) => {
  const formData = new FormData();
  Object.entries(data).forEach(([key, value]) => {
    formData.append(key, value);
  });
  return formData;
};

const jpegFile = (name = 'photo.jpg') =>
  new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(60).fill(0)])], name, { type: 'image/jpeg' });

const heicFile = () =>
  new File(
    [new Uint8Array([0, 0, 0, 0x18, ...Buffer.from('ftypheicmif1heic'), ...new Array(40).fill(0)])],
    'IMG_0001.jpg',
    { type: 'image/jpeg' },
  );

const asUser = (userId: string | null) => {
  vi.mocked(getOptionalUserId).mockResolvedValue(userId);
  if (userId) vi.mocked(requireUserId).mockResolvedValue(userId);
  else vi.mocked(requireUserId).mockRejectedValue(new UnauthorizedError());
};

const OWN_GROUP = 'grp_own';
const OTHER_GROUP = 'grp_other';
const KEY_A = `groups/${OWN_GROUP}/11111111-1111-4111-8111-111111111111.webp`;
const KEY_B = `groups/${OWN_GROUP}/22222222-2222-4222-8222-222222222222.webp`;
const FOREIGN_KEY = `groups/${OTHER_GROUP}/33333333-3333-4333-8333-333333333333.webp`;
const url = (key: string) => `${BUCKET_BASE}${key}`;

const storedGroup = (photos: string[], id = OWN_GROUP) =>
  vi.mocked(prisma.group.findUnique).mockResolvedValueOnce({ id, photos } as never);

const upsertArgs = () => vi.mocked(prisma.group.upsert).mock.calls[0][0];

const mockDate = new Date('2026-06-07T12:00:00Z');

describe('Group Server Actions (Unit Tests)', () => {

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  // 1. GET GROUP BY USER TESTS

  describe('getGroupByUser', () => {

    it('should return null if user is not authenticated (no valid session)', async () => {
      asUser(null);

      const result = await getGroupByUser();

      expect(result).toBeNull();
      expect(prisma.group.findUnique).not.toHaveBeenCalled();
    });

    it('should return the group object with photo keys turned into URLs', async () => {
      asUser('user-123');

      const mockGroup = {
        id: 'group-1',
        userId: 'user-123',
        membersCount: 4,
        photos: [KEY_A, '/images/bg-fallback.jpg'],
        createdAt: mockDate,
        updatedAt: mockDate
      };
      vi.mocked(prisma.group.findUnique).mockResolvedValueOnce(mockGroup as any);

      const result = await getGroupByUser();

      expect(prisma.group.findUnique).toHaveBeenCalledWith({ where: { userId: 'user-123' } });
      expect(result).toEqual({
        ...mockGroup,
        photos: [url(KEY_A), '/images/bg-fallback.jpg'],
        createdAt: mockDate.toISOString(),
        updatedAt: mockDate.toISOString()
      });
    });

    it('should return null if the user does not have a group yet', async () => {
      asUser('user-123');
      vi.mocked(prisma.group.findUnique).mockResolvedValueOnce(null);

      const result = await getGroupByUser();

      expect(result).toBeNull();
    });
  });

  // 2. CREATE / UPDATE GROUP ACTION TESTS

  describe('createGroupAction', () => {

    it('should return UNAUTHORIZED without a session and never touch DB or storage', async () => {
      asUser(null);
      const formData = new FormData();
      formData.append('existingPhotos', 'https://dummy.co/foto.jpg');

      await expect(createGroupAction(formData, 'en')).resolves.toEqual({ ok: false, code: 'UNAUTHORIZED' });
      expect(prisma.group.upsert).not.toHaveBeenCalled();
      expect(upload).not.toHaveBeenCalled();
    });

    it('should upsert the group with default values if formData is mostly empty', async () => {
      asUser('user-123');
      storedGroup([KEY_A]);

      const formData = new FormData();
      formData.append('existingPhotos', url(KEY_A));

      await createGroupAction(formData, 'en');

      expect(prisma.group.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-123' },
          update: expect.objectContaining({
            membersCount: 1,
            gender: 'MIXED',
            ageMin: 18,
            ageMax: 30,
            searchGender: 'MIXED',
            searchAgeMin: 18,
            searchAgeMax: 35,
            maxDistance: 10,
            publicProfile: false,
            description: '',
            latitude: null,
            longitude: null,
            instagram: [],
            photos: [KEY_A]
          }),
        })
      );

      expect(redirect).toHaveBeenCalledWith('/en/search-groups');
    });

    it('should correctly parse and save all provided form data', async () => {
      asUser('user-123');
      storedGroup([KEY_A]);

      const formData = createFormData({
        membersCount: '5',
        groupGender: 'MIXED',
        ageMin: '22',
        ageMax: '28',
        searchGender: 'FEMALE',
        searchAgeMin: '20',
        searchAgeMax: '30',
        maxDistance: '25',
        latitude: '50.123',
        longitude: '8.456',
        publicProfile: 'true',
        description: 'We are a cool crew!',
        instagram_0: '@cooluser',
        instagram_1: 'anotheruser'
      });

      // The stored key itself is accepted as well as its URL.
      formData.append('existingPhotos', KEY_A);

      await createGroupAction(formData, 'en');

      expect(prisma.group.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            membersCount: 5,
            gender: 'MIXED',
            ageMin: 22,
            ageMax: 28,
            searchGender: 'FEMALE',
            searchAgeMin: 20,
            searchAgeMax: 30,
            maxDistance: 25,
            latitude: 50.123,
            longitude: 8.456,
            publicProfile: true,
            description: 'We are a cool crew!',
            instagram: ['cooluser', 'anotheruser'],
            photos: [KEY_A]
          }),
        })
      );
    });

    it('should re-encode new files and upload them under groups/{groupId}/ as WebP', async () => {
      asUser('user-123');
      storedGroup([]);

      const formData = new FormData();
      formData.append('photos', jpegFile());

      await createGroupAction(formData, 'en');

      expect(processImage).toHaveBeenCalledTimes(1);
      expect(upload).toHaveBeenCalledWith(
        expect.stringMatching(new RegExp(`^groups/${OWN_GROUP}/[0-9a-f-]{36}\\.webp$`)),
        Buffer.from('webp-bytes'),
        'image/webp',
      );
      const uploadedKey = vi.mocked(upload).mock.calls[0][0];
      expect(upsertArgs().update.photos).toEqual([uploadedKey]);
    });

    it('should give a new group its id up front so photos land under its prefix', async () => {
      asUser('user-123');
      vi.mocked(prisma.group.findUnique).mockResolvedValueOnce(null);

      const formData = new FormData();
      formData.append('photos', jpegFile());

      await createGroupAction(formData, 'en');

      const { create } = upsertArgs();
      const uploadedKey = vi.mocked(upload).mock.calls[0][0];
      expect(uploadedKey.startsWith(`groups/${create.id}/`)).toBe(true);
      expect(create.photos).toEqual([uploadedKey]);
    });

    it('should ignore empty file uploads (size 0)', async () => {
      asUser('user-123');
      storedGroup([KEY_A]);

      const formData = new FormData();
      formData.append('existingPhotos', url(KEY_A));
      formData.append('photos', new File([''], 'empty.png', { type: 'image/png' }));

      await createGroupAction(formData, 'en');

      expect(upload).not.toHaveBeenCalled();
      expect(upsertArgs().update.photos).toEqual([KEY_A]);
    });

    it('should return a typed VALIDATION error if no photos are provided', async () => {
      asUser('user-123');
      storedGroup([]);

      await expect(createGroupAction(new FormData(), 'en')).resolves.toEqual({
        ok: false,
        code: 'VALIDATION',
        messageKey: 'photoRequired',
      });
      expect(prisma.group.upsert).not.toHaveBeenCalled();
    });

    it('should reject more than 6 photos', async () => {
      asUser('user-123');
      storedGroup([KEY_A, KEY_B]);

      const formData = new FormData();
      formData.append('existingPhotos', url(KEY_A));
      formData.append('existingPhotos', url(KEY_B));
      for (let i = 0; i < 5; i++) formData.append('photos', jpegFile(`p${i}.jpg`));

      await expect(createGroupAction(formData, 'en')).resolves.toEqual({
        ok: false,
        code: 'VALIDATION',
        messageKey: 'tooManyPhotos',
      });
      expect(upload).not.toHaveBeenCalled();
    });

    it('should reject unsupported types (HEIC) with the typed error and upload nothing', async () => {
      asUser('user-123');
      storedGroup([KEY_A]);

      const formData = new FormData();
      formData.append('existingPhotos', url(KEY_A));
      formData.append('photos', heicFile());

      await expect(createGroupAction(formData, 'en')).resolves.toEqual({
        ok: false,
        code: 'VALIDATION',
        messageKey: 'unsupportedType',
      });
      expect(upload).not.toHaveBeenCalled();
      expect(prisma.group.upsert).not.toHaveBeenCalled();
    });

    // S6
    it('should ignore existingPhotos values that are not stored on the caller\'s group', async () => {
      asUser('user-123');
      storedGroup([KEY_A]);

      const formData = new FormData();
      formData.append('existingPhotos', url(KEY_A));
      formData.append('existingPhotos', url(FOREIGN_KEY)); // another group's photo (URL)
      formData.append('existingPhotos', FOREIGN_KEY); // ... and as a raw key
      formData.append('existingPhotos', 'https://evil.example/tracker.jpg'); // external URL

      await createGroupAction(formData, 'en');

      expect(upsertArgs().update.photos).toEqual([KEY_A]);
      expect(remove).not.toHaveBeenCalled();
    });

    it('should not let a user adopt or delete another group\'s photos', async () => {
      // User B owns OTHER_GROUP and submits only group A's photos.
      asUser('user-b');
      storedGroup([`groups/${OTHER_GROUP}/44444444-4444-4444-8444-444444444444.webp`], OTHER_GROUP);

      const formData = new FormData();
      formData.append('existingPhotos', url(KEY_A));
      formData.append('existingPhotos', url(KEY_B));

      const result = await createGroupAction(formData, 'en');

      // Nothing of A's is kept, so B's edit has no photos and is rejected.
      expect(result).toEqual({ ok: false, code: 'VALIDATION', messageKey: 'photoRequired' });
      expect(prisma.group.upsert).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      expect(removePrefix).not.toHaveBeenCalled();
      // The lookup is always by the caller's own userId.
      expect(prisma.group.findUnique).toHaveBeenCalledWith({ where: { userId: 'user-b' }, select: { id: true, photos: true } });
    });

    // B15
    it('should delete removed and replaced photos from storage after the DB update', async () => {
      asUser('user-123');
      storedGroup([KEY_A, KEY_B]);

      const formData = new FormData();
      formData.append('existingPhotos', url(KEY_A)); // KEY_B removed ...
      formData.append('photos', jpegFile()); // ... and replaced by a new photo

      await createGroupAction(formData, 'en');

      const uploadedKey = vi.mocked(upload).mock.calls[0][0];
      expect(upsertArgs().update.photos).toEqual([KEY_A, uploadedKey]);
      expect(remove).toHaveBeenCalledTimes(1);
      expect(remove).toHaveBeenCalledWith([KEY_B]);
      expect(vi.mocked(remove).mock.invocationCallOrder[0]).toBeGreaterThan(
        vi.mocked(prisma.group.upsert).mock.invocationCallOrder[0],
      );
    });

    it('should drop but never delete a foreign key that was stored on the group before the fix', async () => {
      asUser('user-123');
      storedGroup([KEY_A, FOREIGN_KEY, 'groups/user-999-group-legacy.jpg', 'groups/user-123-group-legacy.jpg']);

      const formData = new FormData();
      formData.append('existingPhotos', url(KEY_A));

      await createGroupAction(formData, 'en');

      expect(upsertArgs().update.photos).toEqual([KEY_A]);
      // Only the caller's own legacy key is deleted.
      expect(remove).toHaveBeenCalledWith(['groups/user-123-group-legacy.jpg']);
    });

    it('should still succeed when deleting replaced photos fails, and log the remaining keys', async () => {
      asUser('user-123');
      storedGroup([KEY_A, KEY_B]);
      vi.mocked(remove).mockRejectedValueOnce(new Error('storage down'));

      const formData = new FormData();
      formData.append('existingPhotos', url(KEY_A));

      await createGroupAction(formData, 'en');

      expect(redirect).toHaveBeenCalledWith('/en/search-groups');
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('could not be deleted'), [KEY_B], expect.any(Array));
    });

    it('should roll back uploaded objects and not save when an upload fails', async () => {
      asUser('user-123');
      storedGroup([]);
      vi.mocked(upload).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('network'));

      const formData = new FormData();
      formData.append('photos', jpegFile('a.jpg'));
      formData.append('photos', jpegFile('b.jpg'));

      const result = await createGroupAction(formData, 'en');

      expect(result).toEqual({ ok: false, code: 'INTERNAL', messageKey: 'uploadFailed' });
      expect(prisma.group.upsert).not.toHaveBeenCalled();
      expect(remove).toHaveBeenCalledWith([vi.mocked(upload).mock.calls[0][0]]);
    });

    it('should remove the new objects again when the DB write fails', async () => {
      asUser('user-123');
      storedGroup([KEY_A]);
      vi.mocked(prisma.group.upsert).mockRejectedValueOnce(new Error('db down'));

      const formData = new FormData();
      formData.append('existingPhotos', url(KEY_A));
      formData.append('photos', jpegFile());

      const result = await createGroupAction(formData, 'en');

      expect(result).toEqual({ ok: false, code: 'INTERNAL' });
      expect(remove).toHaveBeenCalledWith([vi.mocked(upload).mock.calls[0][0]]);
      expect(remove).not.toHaveBeenCalledWith(expect.arrayContaining([KEY_A]));
    });
  });

  // 3. DELETE GROUP ACTION TESTS

  describe('deleteGroupAction', () => {
    it('should reject callers without a session', async () => {
      asUser(null);
      await expect(deleteGroupAction()).resolves.toEqual({ error: 'Unauthorized' });
      expect(prisma.group.delete).not.toHaveBeenCalled();
      expect(removePrefix).not.toHaveBeenCalled();
    });

    it('should remove only its own prefix and its own legacy keys, after the DB delete', async () => {
      asUser('user-123');
      storedGroup([
        KEY_A,
        'groups/user-123-group-legacy.jpg', // own legacy key
        'groups/user-999-group-legacy.jpg', // someone else's legacy key
        FOREIGN_KEY, // another group's key
        'https://images.unsplash.com/photo-1', // external
      ]);

      const result = await deleteGroupAction();

      expect(result).toEqual({ success: true });
      expect(removePrefix).toHaveBeenCalledTimes(1);
      expect(removePrefix).toHaveBeenCalledWith(`groups/${OWN_GROUP}/`);
      expect(remove).toHaveBeenCalledTimes(1);
      expect(remove).toHaveBeenCalledWith(['groups/user-123-group-legacy.jpg']);
      expect(vi.mocked(removePrefix).mock.invocationCallOrder[0]).toBeGreaterThan(
        vi.mocked(prisma.group.delete).mock.invocationCallOrder[0],
      );
    });

    it('should still report success when storage cleanup fails', async () => {
      asUser('user-123');
      storedGroup([KEY_A]);
      vi.mocked(removePrefix).mockRejectedValueOnce(new Error('storage down'));

      await expect(deleteGroupAction()).resolves.toEqual({ success: true });
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining(`deleted group ${OWN_GROUP}`),
        [`groups/${OWN_GROUP}/*`],
        expect.any(Array),
      );
    });

    it('should not touch storage if the DB delete fails', async () => {
      asUser('user-123');
      storedGroup([KEY_A]);
      vi.mocked(prisma.group.delete).mockRejectedValueOnce(new Error('db down'));

      await expect(deleteGroupAction()).resolves.toEqual({ error: 'Failed to delete group' });
      expect(removePrefix).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
    });
  });
});
