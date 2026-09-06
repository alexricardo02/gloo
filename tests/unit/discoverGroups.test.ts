import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toggleLike } from '@/app/actions/discoverGroups';
import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    group: { findUnique: vi.fn() },
    groupLike: { findUnique: vi.fn(), create: vi.fn(), delete: vi.fn() },
    chat: { findFirst: vi.fn(), create: vi.fn() },
    message: { create: vi.fn() },
  },
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

describe('DiscoverGroups Server Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    if ((globalThis as any).__GLOO_LIKE_RATE_LIMITER) {
      (globalThis as any).__GLOO_LIKE_RATE_LIMITER.clear();
    }
  });

  it('should return Unauthorized if user cookie is missing', async () => {
    vi.mocked(cookies).mockResolvedValue({ get: vi.fn().mockReturnValue(undefined) } as any);

    const result = await toggleLike('group-1');

    expect(result).toEqual({ error: 'Unauthorized' });
  });

  it('should return Group not found if current user has no group', async () => {
    vi.mocked(cookies).mockResolvedValue({ get: vi.fn().mockReturnValue({ value: 'user-1' }) } as any);
    vi.mocked(prisma.group.findUnique).mockResolvedValueOnce(null as any);

    const result = await toggleLike('group-1');

    expect(result).toEqual({ error: 'Group not found' });
  });

  it('should remove an existing like and return liked false', async () => {
    vi.mocked(cookies).mockResolvedValue({ get: vi.fn().mockReturnValue({ value: 'user-1' }) } as any);
    vi.mocked(prisma.group.findUnique).mockResolvedValueOnce({ id: 'from-group', userId: 'user-1' } as any);
    vi.mocked(prisma.groupLike.findUnique).mockResolvedValueOnce({ id: 'like-1' } as any);

    const result = await toggleLike('target-group');

    expect(result).toEqual({ liked: false });
    expect(prisma.groupLike.delete).toHaveBeenCalledWith({ where: { id: 'like-1' } });
    expect(prisma.groupLike.create).not.toHaveBeenCalled();
  });

  it('should create a like and return matched false when no reciprocal like exists', async () => {
    vi.mocked(cookies).mockResolvedValue({ get: vi.fn().mockReturnValue({ value: 'user-1' }) } as any);
    vi.mocked(prisma.group.findUnique)
      .mockResolvedValueOnce({ id: 'from-group', userId: 'user-1' } as any)
      .mockResolvedValueOnce({ id: 'target-group', userId: 'user-2' } as any);
    vi.mocked(prisma.groupLike.findUnique)
      .mockResolvedValueOnce(null as any) // existingLike
      .mockResolvedValueOnce(null as any); // reciprocalLike
    vi.mocked(prisma.groupLike.create).mockResolvedValueOnce({ id: 'new-like' } as any);

    const result = await toggleLike('target-group');

    expect(result).toEqual({ liked: true, matched: false });
    expect(prisma.groupLike.create).toHaveBeenCalledWith({ data: { fromGroupId: 'from-group', toGroupId: 'target-group' } });
    expect(prisma.chat.create).not.toHaveBeenCalled();
  });

  it('should create a mutual match chat when a reciprocal like already exists', async () => {
    vi.mocked(cookies).mockResolvedValue({ get: vi.fn().mockReturnValue({ value: 'user-1' }) } as any);

    vi.mocked(prisma.group.findUnique)
      .mockResolvedValueOnce({ id: 'from-group', userId: 'user-1' } as any)
      .mockResolvedValueOnce({ id: 'target-group', userId: 'user-2' } as any);

    vi.mocked(prisma.groupLike.findUnique)
      .mockResolvedValueOnce(null as any) // existingLike
      .mockResolvedValueOnce({ id: 'reciprocal-like' } as any); // reciprocalLike

    vi.mocked(prisma.groupLike.create).mockResolvedValueOnce({ id: 'new-like' } as any);
    vi.mocked(prisma.chat.findFirst).mockResolvedValueOnce(null as any);
    vi.mocked(prisma.chat.create).mockResolvedValueOnce({ id: 'new-chat' } as any);
    vi.mocked(prisma.message.create).mockResolvedValueOnce({ id: 'msg-1' } as any);

    const result = await toggleLike('target-group');

    expect(result).toEqual({ liked: true, matched: true });
    expect(prisma.chat.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { hostAId: 'user-1', hostBId: 'user-2' },
          { hostAId: 'user-2', hostBId: 'user-1' },
        ],
      },
    });
    expect(prisma.chat.create).toHaveBeenCalledWith({ data: { hostAId: 'user-1', hostBId: 'user-2' } });
    expect(prisma.message.create).toHaveBeenCalledWith({
      data: {
        chatId: 'new-chat',
        senderId: 'user-1',
        text: 'Your groups matched! Start chatting now.',
      },
    });
  });

  it('should not create a new chat when one already exists', async () => {
    vi.mocked(cookies).mockResolvedValue({ get: vi.fn().mockReturnValue({ value: 'user-1' }) } as any);

    vi.mocked(prisma.group.findUnique)
      .mockResolvedValueOnce({ id: 'from-group', userId: 'user-1' } as any)
      .mockResolvedValueOnce({ id: 'target-group', userId: 'user-2' } as any);

    vi.mocked(prisma.groupLike.findUnique)
      .mockResolvedValueOnce(null as any)
      .mockResolvedValueOnce({ id: 'reciprocal-like' } as any);

    vi.mocked(prisma.groupLike.create).mockResolvedValueOnce({ id: 'new-like' } as any);
    vi.mocked(prisma.chat.findFirst).mockResolvedValueOnce({ id: 'existing-chat' } as any);

    const result = await toggleLike('target-group');

    expect(result).toEqual({ liked: true, matched: true });
    expect(prisma.chat.create).not.toHaveBeenCalled();
  });

  it('should reject likes after rate limit is exceeded', async () => {
    vi.mocked(cookies).mockResolvedValue({ get: vi.fn().mockReturnValue({ value: 'user-1' }) } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.group.findUnique as any).mockImplementation(async (args: any) => {
      if (args?.where?.userId === 'user-1') {
        return { id: 'from-group', userId: 'user-1' };
      }
      if (typeof args?.where?.id === 'string') {
        return { id: args.where.id, userId: 'user-2' };
      }
      return null;
    });
    vi.mocked(prisma.groupLike.findUnique).mockResolvedValue(null as any);
    vi.mocked(prisma.groupLike.create).mockResolvedValue({ id: 'new-like' } as any);

    for (let i = 0; i < 10; i += 1) {
      await toggleLike(`target-group-${i}`);
    }

    const result = await toggleLike('target-group-final');

    expect(result).toEqual({ error: 'Rate limit exceeded. Please wait a moment before liking again.' });
  });
});
