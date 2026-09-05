import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getGroupByUser, createGroupAction } from '@/app/actions/group';
import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

//  MOCKS 
vi.mock('@/lib/prisma', () => ({
  prisma: {
    group: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    storage: {
      from: () => ({
        upload: vi.fn().mockResolvedValue({ data: { path: "groups/fake-id.png" }, error: null }),
        getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: "https://dummy-project.supabase.co/storage/v1/object/public/gloo-images/groups/fake-image.png" } })
      })
    }
  }
}));

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

const mockDate = new Date('2026-06-07T12:00:00Z');

describe('Group Server Actions (Unit Tests)', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. GET GROUP BY USER TESTS

  describe('getGroupByUser', () => {
    
    it('should return null if user is not authenticated (no gloo_user_id cookie)', async () => {
      vi.mocked(cookies).mockResolvedValue({ get: vi.fn().mockReturnValue(undefined) } as any);
      
      const result = await getGroupByUser();
      
      expect(result).toBeNull();
      expect(prisma.group.findUnique).not.toHaveBeenCalled();
    });

    it('should return the group object if the user has a group', async () => {
      vi.mocked(cookies).mockResolvedValue({ get: vi.fn().mockReturnValue({ value: 'user-123' }) } as any);

      
      const mockGroup = { 
        id: 'group-1', 
        userId: 'user-123', 
        membersCount: 4,
        createdAt: mockDate,
        updatedAt: mockDate
      };
      vi.mocked(prisma.group.findUnique).mockResolvedValueOnce(mockGroup as any);

      const result = await getGroupByUser();

      expect(prisma.group.findUnique).toHaveBeenCalledWith({ where: { userId: 'user-123' } });
      expect(result).toEqual({
        ...mockGroup,
        createdAt: mockDate.toISOString(),
        updatedAt: mockDate.toISOString()
      });
    });

    it('should return null if the user does not have a group yet', async () => {
      vi.mocked(cookies).mockResolvedValue({ get: vi.fn().mockReturnValue({ value: 'user-123' }) } as any);
      vi.mocked(prisma.group.findUnique).mockResolvedValueOnce(null);

      const result = await getGroupByUser();

      expect(result).toBeNull();
    });
  });

  // 2. CREATE / UPDATE GROUP ACTION TESTS

  describe('createGroupAction', () => {
    
    it('should throw an error if the user is not authenticated', async () => {
      vi.mocked(cookies).mockResolvedValue({ get: vi.fn().mockReturnValue(undefined) } as any);
      const formData = new FormData();

      await expect(createGroupAction(formData, 'en')).rejects.toThrow("User not found or unauthorized");
    });

    it('should upsert the group with default values if formData is mostly empty', async () => {
      vi.mocked(cookies).mockResolvedValue({ get: vi.fn().mockReturnValue({ value: 'user-123' }) } as any);
      
      // Simulate empty form submission
      const formData = new FormData();

      formData.append('existingPhotos', 'https://dummy-project.supabase.co/foto.jpg');
      
      await createGroupAction(formData, 'en');

      // Check if prisma.upsert was called with the correct default fallback values
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
            photos: ["https://dummy-project.supabase.co/foto.jpg"]
          }),
        })
      );

      expect(redirect).toHaveBeenCalledWith('/en/search-groups');
    });

    it('should correctly parse and save all provided form data', async () => {
      vi.mocked(cookies).mockResolvedValue({ get: vi.fn().mockReturnValue({ value: 'user-123' }) } as any);
      
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

      // Add existing photos
      formData.append('existingPhotos', 'https://example.com/photo1.jpg');

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
            photos: ['https://example.com/photo1.jpg']
          }),
        })
      );
    });

    it('should process new uploaded files and upload them to Supabase Storage', async () => {
      vi.mocked(cookies).mockResolvedValue({ get: vi.fn().mockReturnValue({ value: 'user-123' }) } as any);
      
      const formData = new FormData();
      
      // Mock a fake image file
      const fileContent = 'fake-image-content';
      const file = new File([fileContent], 'test.png', { type: 'image/png' });
      formData.append('photos', file);

      await createGroupAction(formData, 'en');

      expect(prisma.group.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            photos: ["https://dummy-project.supabase.co/storage/v1/object/public/gloo-images/groups/fake-image.png"]
          })
        })
      );
    });

    it('should ignore empty file uploads (size 0)', async () => {
      vi.mocked(cookies).mockResolvedValue({ get: vi.fn().mockReturnValue({ value: 'user-123' }) } as any);
      
      const formData = new FormData();

      formData.append('existingPhotos', 'https://dummy-project.supabase.co/foto.jpg');
      
      // Mock an empty file (e.g., when the user didn't select anything but the browser sends an empty file object)
      const emptyFile = new File([''], 'empty.png', { type: 'image/png' });
      formData.append('photos', emptyFile);

      await createGroupAction(formData, 'en');

      expect(prisma.group.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            photos: ["https://dummy-project.supabase.co/foto.jpg"]
          })
        })
      );
    });

    it('should throw an error if no photos are provided', async () => {
      vi.mocked(cookies).mockResolvedValue({ get: vi.fn().mockReturnValue({ value: 'user-123' }) } as any);
      
      const formData = new FormData(); 

      await expect(createGroupAction(formData, 'en')).rejects.toThrow(
        "At least one photo is required."
      );
    });
  });

  it('should reject group creation if the user is a Guest', async () => {
      // Mock the cookie to simulate a GUEST session
      vi.mocked(cookies).mockResolvedValue({ 
        get: vi.fn().mockImplementation((name) => {
          if (name === "gloo_is_guest") return { value: "true" };
          return undefined; // No real user ID provided
        })
      } as any);
      
      const formData = new FormData();
      formData.append('existingPhotos', 'https://dummy.co/foto.jpg');

      // Security Requirement: Action must throw an error before calling Prisma
      await expect(createGroupAction(formData, 'en')).rejects.toThrow("User not found or unauthorized");
      expect(prisma.group.upsert).not.toHaveBeenCalled();
    });
});