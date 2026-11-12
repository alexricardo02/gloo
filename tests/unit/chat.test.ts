import { describe, it, expect, vi, beforeEach } from 'vitest';
import { markChatRead, sendMessage } from '@/app/actions/chat';
import { toMessageDTO, type MessageRow } from '@/lib/chatData';
import { prisma } from '@/lib/prisma';
import { requireUserId, UnauthorizedError } from '@/lib/session';
import { getAccessibleChat } from '@/lib/chats';

// --- MOCKS ---
vi.mock('@/lib/prisma', () => ({
  prisma: {
    message: { create: vi.fn(), findFirst: vi.fn() },
    chat: { updateMany: vi.fn() },
  },
}));

vi.mock('@/lib/session', () => ({
  requireUserId: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));

vi.mock('@/lib/chats', () => ({
  getAccessibleChat: vi.fn(),
  findChatBetween: vi.fn(),
}));

vi.mock('@/lib/blocks', () => ({
  getBlockSet: vi.fn(),
  isBlockedPair: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

const row = (overrides: Partial<MessageRow> = {}): MessageRow => ({
  id: 'm-1',
  text: 'hello',
  senderId: 'user-1',
  type: 'USER',
  systemKey: null,
  createdAt: new Date('2026-05-20T10:00:00Z'),
  ...overrides,
});

const accessible = { id: 'chat-1', origin: 'MATCH' as const, partnerId: 'user-2', isHostA: true };

describe('Chat messages: wire format (B13)', () => {
  it('own message: isOwn, no sender id', () => {
    const dto = toMessageDTO(row(), 'user-1');
    expect(dto).toEqual({
      id: 'm-1',
      type: 'USER',
      text: 'hello',
      systemKey: null,
      createdAt: '2026-05-20T10:00:00.000Z',
      isOwn: true,
    });
    expect(dto).not.toHaveProperty('senderId');
  });

  it("the partner's message and a deleted account's message (senderId null) are not own", () => {
    expect(toMessageDTO(row({ senderId: 'user-2' }), 'user-1').isOwn).toBe(false);
    expect(toMessageDTO(row({ senderId: null }), 'user-1').isOwn).toBe(false);
  });

  it('system notice: no text, no sender, the key for the UI', () => {
    expect(toMessageDTO(row({ type: 'SYSTEM', senderId: null, systemKey: 'MATCH_CREATED', text: '' }), 'user-1')).toEqual({
      id: 'm-1',
      type: 'SYSTEM',
      text: null,
      systemKey: 'MATCH_CREATED',
      createdAt: '2026-05-20T10:00:00.000Z',
      isOwn: false,
    });
  });
});

describe('Chat server actions (unit)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(requireUserId).mockResolvedValue('user-1');
    vi.mocked(getAccessibleChat).mockResolvedValue(accessible);
  });

  describe('sendMessage', () => {
    it('returns UNAUTHORIZED without a session', async () => {
      vi.mocked(requireUserId).mockRejectedValue(new UnauthorizedError());
      expect(await sendMessage('chat-1', 'hi')).toEqual({ ok: false, code: 'UNAUTHORIZED' });
    });

    it('returns the stored message in the wire format (for optimistic reconciliation)', async () => {
      vi.mocked(prisma.message.create).mockResolvedValue(row({ text: 'hi' }) as never);
      expect(await sendMessage('chat-1', '  hi  ')).toEqual({
        ok: true,
        data: { message: expect.objectContaining({ id: 'm-1', text: 'hi', isOwn: true, type: 'USER' }) },
      });
      expect(vi.mocked(prisma.message.create).mock.calls[0][0].data).toEqual({
        chatId: 'chat-1',
        senderId: 'user-1',
        text: 'hi',
        type: 'USER',
      });
    });

    it('refuses chats that are missing, foreign or blocked (one access check)', async () => {
      vi.mocked(getAccessibleChat).mockResolvedValue(null);
      expect(await sendMessage('chat-1', 'hi')).toEqual({ ok: false, code: 'NOT_FOUND', messageKey: 'blockedChatError' });
      expect(prisma.message.create).not.toHaveBeenCalled();
    });

    it('validates the text', async () => {
      expect(await sendMessage('chat-1', '   ')).toEqual({ ok: false, code: 'VALIDATION', messageKey: 'messageEmpty' });
      expect(await sendMessage('chat-1', 'x'.repeat(2001))).toEqual({
        ok: false,
        code: 'VALIDATION',
        messageKey: 'messageTooLong',
      });
    });
  });

  describe('markChatRead', () => {
    it('returns UNAUTHORIZED without a session', async () => {
      vi.mocked(requireUserId).mockRejectedValue(new UnauthorizedError());
      expect(await markChatRead('chat-1', 'm-1')).toEqual({ ok: false, code: 'UNAUTHORIZED' });
    });

    it('rejects malformed ids', async () => {
      expect(await markChatRead('', 'm-1')).toEqual({ ok: false, code: 'VALIDATION' });
      expect(await markChatRead('chat-1', 'x'.repeat(65))).toEqual({ ok: false, code: 'VALIDATION' });
    });

    it('moves only my own marker forward, up to the given message', async () => {
      const createdAt = new Date('2026-05-20T10:00:00Z');
      vi.mocked(prisma.message.findFirst).mockResolvedValue({ createdAt } as never);

      expect(await markChatRead('chat-1', 'm-1')).toEqual({ ok: true, data: undefined });
      expect(vi.mocked(prisma.message.findFirst).mock.calls[0][0]?.where).toEqual({ id: 'm-1', chatId: 'chat-1' });
      expect(vi.mocked(prisma.chat.updateMany).mock.calls[0][0]).toEqual({
        where: { id: 'chat-1', OR: [{ hostALastReadAt: null }, { hostALastReadAt: { lt: createdAt } }] },
        data: { hostALastReadAt: createdAt },
      });

      vi.mocked(getAccessibleChat).mockResolvedValue({ ...accessible, isHostA: false });
      await markChatRead('chat-1', 'm-1');
      expect(vi.mocked(prisma.chat.updateMany).mock.calls[1][0]?.data).toEqual({ hostBLastReadAt: createdAt });
    });

    it('answers NOT_FOUND for inaccessible chats and messages from other chats', async () => {
      vi.mocked(prisma.message.findFirst).mockResolvedValue(null);
      expect(await markChatRead('chat-1', 'other-chat-message')).toEqual({
        ok: false,
        code: 'NOT_FOUND',
        messageKey: 'blockedChatError',
      });

      vi.mocked(getAccessibleChat).mockResolvedValue(null);
      expect(await markChatRead('chat-1', 'm-1')).toEqual({ ok: false, code: 'NOT_FOUND', messageKey: 'blockedChatError' });
      expect(prisma.chat.updateMany).not.toHaveBeenCalled();
    });
  });
});
