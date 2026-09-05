import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getActiveChats } from '@/app/actions/chat';
import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';

// --- MOCKS ---
vi.mock('@/lib/prisma', () => ({
  prisma: {
    chat: {
      findMany: vi.fn(),
    },
    group: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    groupBlock: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

describe('Chat Server Actions (Unit Tests)', () => {

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('getActiveChats', () => {
    it('should return Unauthorized error if user cookie is missing', async () => {
      vi.mocked(cookies).mockResolvedValue({ get: vi.fn().mockReturnValue(undefined) } as any);
      
      const result = await getActiveChats();
      expect(result).toEqual({ error: 'Unauthorized' });
    });

    it('should correctly format chats and sort them newest first', async () => {
      vi.mocked(cookies).mockResolvedValue({ get: vi.fn().mockReturnValue({ value: 'user-1' }) } as any);
      
      // Mock raw data returned from Prisma
      const mockChats = [
        {
          id: 'chat-1',
          createdAt: new Date('2026-05-20T10:00:00Z'),
          hostAId: 'user-1', // Current user is Host A
          hostBId: 'user-2',
          hostA: { id: 'user-1', name: 'Me', image: null, group: null },
          hostB: { id: 'user-2', name: 'Alice', image: null, group: { photos: ['alice-group.jpg'] } },
          messages: [{ text: 'Hello Alice!', createdAt: new Date('2026-05-20T11:00:00Z') }] // Older message
        },
        {
          id: 'chat-2',
          createdAt: new Date('2026-05-21T10:00:00Z'),
          hostAId: 'user-3',
          hostBId: 'user-1', // Current user is Host B
          hostA: { id: 'user-3', name: 'Bob', image: 'bob.jpg', group: null },
          hostB: { id: 'user-1', name: 'Me', image: null, group: null },
          messages: [{ text: 'Hey there!', createdAt: new Date('2026-05-22T09:00:00Z') }] // Newer message
        },
        {
          id: 'chat-3',
          createdAt: new Date('2026-05-20T08:00:00Z'),
          hostAId: 'user-1',
          hostBId: 'user-4',
          hostA: { id: 'user-1', name: 'Me', image: null, group: null },
          hostB: { id: 'user-4', name: 'Charlie', image: null, group: null },
          messages: [] // No messages, fallback to chat creation time
        }
      ];

      vi.mocked(prisma.chat.findMany).mockResolvedValueOnce(mockChats as any);

      // ST0-88: Mock block-related calls – no blocks so results are unchanged
      vi.mocked(prisma.group.findUnique).mockResolvedValueOnce({ id: 'group-1' } as any);
      vi.mocked(prisma.groupBlock.findMany).mockResolvedValue([]);
      vi.mocked(prisma.groupBlock.findMany).mockResolvedValue([]);

      const result = await getActiveChats();

      expect(result.success).toBe(true);
      expect(result.chats).toBeDefined();
      expect(result.chats!.length).toBe(3);

      // Check sorting: chat-2 should be first (2026-05-22), then chat-1 (2026-05-20T11), then chat-3 (2026-05-20T08)
      expect(result.chats![0].id).toBe('chat-2');
      expect(result.chats![1].id).toBe('chat-1');
      expect(result.chats![2].id).toBe('chat-3');
      // Check formatting logic (Host identity and image fallback)
      // Chat 2 (Bob): Fallback to user image because group has no photos
      expect(result.chats![0].name).toBe('Bob');
      expect(result.chats![0].lastMessage).toBe('Hey there!');
      expect(result.chats![0].image).toBe('bob.jpg');

      // Chat 1 (Alice): Prioritize group photo
      expect(result.chats![1].name).toBe('Alice');
      expect(result.chats![1].image).toBe('alice-group.jpg');

      // Chat 3 (Charlie): Fallback to static generic image
      expect(result.chats![2].name).toBe('Charlie');
      expect(result.chats![2].lastMessage).toBe('No messages yet');
      expect(result.chats![2].image).toBe('/images/bg-fallback.jpg');
    });

    it('should catch errors and return Failed to fetch chats', async () => {
      vi.mocked(cookies).mockResolvedValue({ get: vi.fn().mockReturnValue({ value: 'user-1' }) } as any);
      vi.mocked(prisma.group.findUnique).mockResolvedValueOnce({ id: 'group-1' } as any);
      vi.mocked(prisma.groupBlock.findMany).mockResolvedValue([]);
      vi.mocked(prisma.groupBlock.findMany).mockResolvedValue([]);
      vi.mocked(prisma.chat.findMany).mockRejectedValueOnce(new Error('Database Timeout'));

      const result = await getActiveChats();
      
      expect(result).toEqual({ error: 'Failed to fetch chats' });
    });
  });
});