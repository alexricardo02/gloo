import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { toggleLike } from '@/app/actions/discoverGroups';
import { prisma } from '@/lib/prisma';
import { requireUserId, UnauthorizedError } from '@/lib/session';
import { isBlockedPair } from '@/lib/blocks';
import { ensureChat, findChatBetween, lockPair } from '@/lib/chats';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

// The transaction client is the same mock object, so assertions can use `prisma.*`.
vi.mock('@/lib/prisma', () => {
  const client = {
    group: { findUnique: vi.fn() },
    groupLike: { findUnique: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
    message: { createMany: vi.fn() },
    $transaction: vi.fn(),
  };
  return { prisma: client };
});

vi.mock('@/lib/session', () => ({
  requireUserId: vi.fn(),
  getOptionalUserId: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));

vi.mock('@/lib/blocks', () => ({
  getBlockSet: vi.fn(),
  isBlockedPair: vi.fn(),
}));

vi.mock('@/lib/chats', () => ({
  ensureChat: vi.fn(),
  findChatBetween: vi.fn(),
  lockPair: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock Upstash so rate-limiting is testable without real Redis credentials.
// A per-user counter mirrors the sliding-window(10) config in production.
// ---------------------------------------------------------------------------
const rateLimitCounters = new Map<string, number>();
const RATE_LIMIT = 10;

vi.mock('@upstash/redis', () => ({
  Redis: class Redis {},
}));

vi.mock('@upstash/ratelimit', () => {
  const slidingWindow = vi.fn().mockReturnValue('sliding-window-limiter');
  class Ratelimit {
    // Plain async function — NOT vi.fn() — so vi.clearAllMocks() cannot wipe it.
    async limit(key: string) {
      const count = (rateLimitCounters.get(key) ?? 0) + 1;
      rateLimitCounters.set(key, count);
      return { success: count <= RATE_LIMIT };
    }
    static slidingWindow = slidingWindow;
  }
  return { Ratelimit };
});

const ME = { id: 'from-group' };
const TARGET = { id: 'target-group', userId: 'user-2' };

/** Group lookups: own group by userId, target group by id. */
function mockGroups(own: { id: string } | null = ME, target: { id: string; userId: string } | null = TARGET) {
  vi.mocked(prisma.group.findUnique).mockImplementation((async (args: { where: { userId?: string; id?: string } }) => {
    if (args.where.userId) return own;
    if (args.where.id === target?.id) return target;
    return null;
  }) as never);
}

/** groupLike.findUnique: `existing` for my like, `reciprocal` for theirs. */
function mockLikes({ existing = false, reciprocal = false } = {}) {
  vi.mocked(prisma.groupLike.findUnique).mockImplementation((async (args: {
    where: { fromGroupId_toGroupId: { fromGroupId: string } };
  }) => {
    const mine = args.where.fromGroupId_toGroupId.fromGroupId === ME.id;
    return (mine ? existing : reciprocal) ? { id: mine ? 'my-like' : 'their-like' } : null;
  }) as never);
}

describe('toggleLike', () => {
  beforeAll(() => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://test.upstash.io');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-token');
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    rateLimitCounters.clear();
    vi.mocked(requireUserId).mockResolvedValue('user-1');
    vi.mocked(prisma.$transaction).mockImplementation((async (fn: (tx: typeof prisma) => unknown) => fn(prisma)) as never);
    vi.mocked(isBlockedPair).mockResolvedValue(false);
    vi.mocked(findChatBetween).mockResolvedValue(null);
    vi.mocked(ensureChat).mockResolvedValue('match-chat');
    mockGroups();
    mockLikes();
  });

  it('returns UNAUTHORIZED without a session', async () => {
    vi.mocked(requireUserId).mockRejectedValue(new UnauthorizedError());

    expect(await toggleLike('target-group')).toEqual({ ok: false, code: 'UNAUTHORIZED' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('returns VALIDATION for a malformed group id', async () => {
    expect(await toggleLike('')).toEqual({ ok: false, code: 'VALIDATION' });
    expect(await toggleLike('x'.repeat(65))).toEqual({ ok: false, code: 'VALIDATION' });
  });

  it('returns NOT_FOUND when the caller has no group', async () => {
    mockGroups(null);

    expect(await toggleLike('target-group')).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(prisma.groupLike.createMany).not.toHaveBeenCalled();
  });

  it('rejects liking your own group (FORBIDDEN) without writing anything', async () => {
    const result = await toggleLike(ME.id, true);

    expect(result).toEqual({ ok: false, code: 'FORBIDDEN' });
    expect(prisma.groupLike.createMany).not.toHaveBeenCalled();
    expect(ensureChat).not.toHaveBeenCalled();
  });

  it('rejects liking a blocked group with NOT_FOUND (block stays invisible)', async () => {
    vi.mocked(isBlockedPair).mockResolvedValue(true);

    const result = await toggleLike('target-group', true);

    expect(result).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(isBlockedPair).toHaveBeenCalledWith('user-1', 'user-2', prisma);
    expect(prisma.groupLike.createMany).not.toHaveBeenCalled();
    expect(ensureChat).not.toHaveBeenCalled();
  });

  it('creates the like idempotently (skipDuplicates) and does not match without a reciprocal like', async () => {
    const result = await toggleLike('target-group', true);

    expect(result).toEqual({ ok: true, data: { liked: true, matched: false, chatId: null } });
    expect(lockPair).toHaveBeenCalledWith(prisma, 'user-1', 'user-2');
    expect(prisma.groupLike.createMany).toHaveBeenCalledWith({
      data: [{ fromGroupId: 'from-group', toGroupId: 'target-group' }],
      skipDuplicates: true,
    });
    expect(ensureChat).not.toHaveBeenCalled();
    expect(prisma.message.createMany).not.toHaveBeenCalled();
  });

  it('liking an already liked group (double click / retry) stays liked and does not throw', async () => {
    mockLikes({ existing: true });

    const result = await toggleLike('target-group', true);

    expect(result).toEqual({ ok: true, data: { liked: true, matched: false, chatId: null } });
    expect(prisma.groupLike.deleteMany).not.toHaveBeenCalled();
  });

  it('on a mutual like: ensureChat(MATCH) and one SYSTEM match notice with a null sender, in the same transaction', async () => {
    mockLikes({ reciprocal: true });

    const result = await toggleLike('target-group', true);

    expect(result).toEqual({ ok: true, data: { liked: true, matched: true, chatId: 'match-chat' } });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(ensureChat).toHaveBeenCalledWith('from-group', 'target-group', 'MATCH', prisma);
    expect(prisma.message.createMany).toHaveBeenCalledWith({
      data: [{ chatId: 'match-chat', senderId: null, type: 'SYSTEM', systemKey: 'MATCH_CREATED', text: '' }],
      skipDuplicates: true,
    });
  });

  it('unlike removes only the like and keeps an existing chat (UNLIKE_AFTER_MATCH = keep-chat)', async () => {
    mockLikes({ existing: true, reciprocal: true });
    vi.mocked(findChatBetween).mockResolvedValue({ id: 'match-chat', origin: 'MATCH' });

    const result = await toggleLike('target-group', false);

    expect(result).toEqual({ ok: true, data: { liked: false, matched: false, chatId: 'match-chat' } });
    expect(prisma.groupLike.deleteMany).toHaveBeenCalledWith({
      where: { fromGroupId: 'from-group', toGroupId: 'target-group' },
    });
    expect(ensureChat).not.toHaveBeenCalled();
  });

  it('without a desired state it unlikes an existing like', async () => {
    mockLikes({ existing: true });

    const result = await toggleLike('target-group');

    expect(result).toEqual({ ok: true, data: { liked: false, matched: false, chatId: null } });
    expect(prisma.groupLike.deleteMany).toHaveBeenCalled();
    expect(prisma.groupLike.createMany).not.toHaveBeenCalled();
  });

  it('without a desired state it likes when there is no like yet', async () => {
    const result = await toggleLike('target-group');

    expect(result).toEqual({ ok: true, data: { liked: true, matched: false, chatId: null } });
    expect(prisma.groupLike.createMany).toHaveBeenCalled();
  });

  it('returns INTERNAL instead of throwing when the database fails', async () => {
    vi.mocked(prisma.$transaction).mockRejectedValue(new Error('P2002 or connection lost'));

    expect(await toggleLike('target-group', true)).toEqual({ ok: false, code: 'INTERNAL' });
  });

  it('rejects likes after the rate limit is exceeded', async () => {
    for (let i = 0; i < 10; i += 1) {
      await toggleLike('target-group', true);
    }

    expect(await toggleLike('target-group', true)).toEqual({ ok: false, code: 'RATE_LIMITED' });
  });
});
