import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getActiveChats } from '@/app/actions/chat';
import { prisma } from '@/lib/prisma';
import { requireUserId, UnauthorizedError } from '@/lib/session';
import { getBlockSet } from '@/lib/blocks';

// --- MOCKS ---
vi.mock('@/lib/prisma', () => ({
  prisma: {
    chat: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('@/lib/session', () => ({
  requireUserId: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));

vi.mock('@/lib/blocks', () => ({
  getBlockSet: vi.fn(),
  isBlockedPair: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

const host = (name: string, image: string | null = null, photos: string[] | null = null) => ({
  name,
  image,
  group: photos ? { photos } : null,
});

describe('Chat Server Actions (Unit Tests)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(requireUserId).mockResolvedValue('user-1');
    vi.mocked(getBlockSet).mockResolvedValue({ groupIds: new Set(), userIds: new Set() });
  });

  describe('getActiveChats', () => {
    it('returns UNAUTHORIZED without a session', async () => {
      vi.mocked(requireUserId).mockRejectedValue(new UnauthorizedError());

      expect(await getActiveChats()).toEqual({ ok: false, code: 'UNAUTHORIZED' });
    });

    it('formats chats: matches (by origin) first, then newest first; system notices are previewed by key', async () => {
      const mockChats = [
        {
          id: 'chat-1',
          origin: 'LEGACY',
          createdAt: new Date('2026-05-20T10:00:00Z'),
          hostAId: 'user-1', // Current user is Host A
          hostA: host('Me'),
          hostB: host('Alice', null, ['alice-group.jpg']),
          messages: [{ text: 'Hello Alice! Great match', type: 'USER', systemKey: null, createdAt: new Date('2026-05-20T11:00:00Z') }],
        },
        {
          id: 'chat-2',
          origin: 'LEGACY',
          createdAt: new Date('2026-05-21T10:00:00Z'),
          hostAId: 'user-0', // Current user is Host B
          hostA: host('Bob', 'bob.jpg'),
          hostB: host('Me'),
          messages: [{ text: 'Hey there!', type: 'USER', systemKey: null, createdAt: new Date('2026-05-22T09:00:00Z') }],
        },
        {
          id: 'chat-3',
          origin: 'MATCH',
          createdAt: new Date('2026-05-19T08:00:00Z'),
          hostAId: 'user-1',
          hostA: host('Me'),
          hostB: host('Charlie'),
          messages: [{ text: '', type: 'SYSTEM', systemKey: 'MATCH_CREATED', createdAt: new Date('2026-05-19T08:00:00Z') }],
        },
        {
          id: 'chat-4',
          origin: 'LEGACY',
          createdAt: new Date('2026-05-18T08:00:00Z'),
          hostAId: 'user-1',
          hostA: host('Me'),
          hostB: host('Dana'),
          messages: [], // No messages, fallback to chat creation time
        },
      ];
      vi.mocked(prisma.chat.findMany).mockResolvedValueOnce(mockChats as never);

      const result = await getActiveChats();
      if (!result.ok) throw new Error('expected ok');
      const chats = result.data.chats;

      // chat-3 is the only MATCH (origin, not message text: chat-1 mentions "match").
      expect(chats.map((c) => [c.id, c.isMatch])).toEqual([
        ['chat-3', true],
        ['chat-2', false],
        ['chat-1', false],
        ['chat-4', false],
      ]);

      expect(chats[0]).toMatchObject({ name: 'Charlie', lastMessage: null, lastMessageSystemKey: 'MATCH_CREATED' });
      expect(chats[1]).toMatchObject({ name: 'Bob', lastMessage: 'Hey there!', lastMessageSystemKey: null, image: 'bob.jpg' });
      expect(chats[2]).toMatchObject({ name: 'Alice', image: 'alice-group.jpg' });
      expect(chats[3]).toMatchObject({
        name: 'Dana',
        lastMessage: null,
        lastMessageSystemKey: null,
        image: '/images/bg-fallback.jpg',
        time: new Date('2026-05-18T08:00:00Z'),
      });
    });

    it('excludes chats with blocked counterparts in the query (hidden for both)', async () => {
      vi.mocked(getBlockSet).mockResolvedValue({ groupIds: new Set(['g-9']), userIds: new Set(['user-9']) });
      vi.mocked(prisma.chat.findMany).mockResolvedValueOnce([]);

      await getActiveChats();

      expect(getBlockSet).toHaveBeenCalledWith('user-1');
      expect(vi.mocked(prisma.chat.findMany).mock.calls[0][0]?.where).toEqual({
        OR: [{ hostAId: 'user-1' }, { hostBId: 'user-1' }],
        NOT: [{ hostAId: { in: ['user-9'] } }, { hostBId: { in: ['user-9'] } }],
      });
    });

    it('returns INTERNAL when the database fails', async () => {
      vi.mocked(prisma.chat.findMany).mockRejectedValueOnce(new Error('Database Timeout'));

      expect(await getActiveChats()).toEqual({ ok: false, code: 'INTERNAL' });
    });
  });
});
