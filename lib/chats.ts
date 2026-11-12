import "server-only";

import type { ChatOrigin, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isBlockedPair } from "@/lib/blocks";

/**
 * The ONLY place that creates Chat rows.
 *
 * With CHAT_CREATION = match-only, ensureChat() is called from toggleLike()
 * on a mutual like ("MATCH"). "EVENT_ACCESS" is reserved for accepted
 * pre-party attendance (not implemented yet). Server actions must never
 * create chats on request of a user (no "get or create chat with X").
 */

type Db = Prisma.TransactionClient;

export type ChatCreationOrigin = Extract<ChatOrigin, "MATCH" | "EVENT_ACCESS">;

export type ChatCreationErrorReason = "SELF_CHAT" | "GROUP_NOT_FOUND" | "BLOCKED";

export class ChatCreationError extends Error {
  constructor(readonly reason: ChatCreationErrorReason) {
    super(`Chat creation refused: ${reason}`);
    this.name = "ChatCreationError";
  }
}

/** An origin is only ever upgraded (e.g. LEGACY -> MATCH), never downgraded. */
const ORIGIN_RANK: Record<ChatOrigin, number> = { LEGACY: 1, EVENT_ACCESS: 2, MATCH: 3 };

/**
 * Canonical storage order of a host pair: hostAId < hostBId by UTF-16 code
 * unit, which equals the database's COLLATE "C" order for the ASCII ids we
 * use (see the Chat_canonical_pair_check constraint).
 */
export function canonicalPair(userAId: string, userBId: string): [string, string] {
  return userAId < userBId ? [userAId, userBId] : [userBId, userAId];
}

/**
 * Serialises concurrent like/chat operations on the same pair of hosts until
 * the surrounding transaction ends. Re-entrant within one transaction.
 */
export async function lockPair(tx: Db, userAId: string, userBId: string): Promise<void> {
  const [lo, hi] = canonicalPair(userAId, userBId);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`chat-pair:${lo}:${hi}`}, 0))`;
}

/** The chat between two hosts, if one exists (no access checks). */
export async function findChatBetween(
  userAId: string,
  userBId: string,
  db: Db | typeof prisma = prisma,
): Promise<{ id: string; origin: ChatOrigin } | null> {
  const [hostAId, hostBId] = canonicalPair(userAId, userBId);
  return db.chat.findUnique({
    where: { hostAId_hostBId: { hostAId, hostBId } },
    select: { id: true, origin: true },
  });
}

/**
 * Returns the id of the chat between the hosts of two groups, creating it if
 * needed. Refuses self-chats, unknown groups and blocked pairs
 * (ChatCreationError). Idempotent and safe under concurrency: the pair is
 * locked, stored in canonical order and unique.
 *
 * Pass `tx` to run inside the caller's transaction (toggleLike does, so the
 * like, the chat and the match notice commit together).
 */
export async function ensureChat(
  groupAId: string,
  groupBId: string,
  origin: ChatCreationOrigin,
  tx?: Db,
): Promise<string> {
  if (!tx) return prisma.$transaction((t) => ensureChat(groupAId, groupBId, origin, t));

  if (groupAId === groupBId) throw new ChatCreationError("SELF_CHAT");

  const groups = await tx.group.findMany({
    where: { id: { in: [groupAId, groupBId] } },
    select: { userId: true },
  });
  if (groups.length !== 2) throw new ChatCreationError("GROUP_NOT_FOUND");

  const [hostAId, hostBId] = canonicalPair(groups[0].userId, groups[1].userId);
  if (hostAId === hostBId) throw new ChatCreationError("SELF_CHAT");

  await lockPair(tx, hostAId, hostBId);

  if (await isBlockedPair(hostAId, hostBId, tx)) throw new ChatCreationError("BLOCKED");

  const existing = await tx.chat.findUnique({
    where: { hostAId_hostBId: { hostAId, hostBId } },
    select: { id: true, origin: true },
  });

  if (existing) {
    if (ORIGIN_RANK[origin] > ORIGIN_RANK[existing.origin]) {
      await tx.chat.update({ where: { id: existing.id }, data: { origin } });
    }
    return existing.id;
  }

  const created = await tx.chat.create({
    data: { hostAId, hostBId, origin },
    select: { id: true },
  });
  return created.id;
}

/**
 * Loads a chat for `userId`, or null if it does not exist, the user is not a
 * participant, or either side blocked the other (BLOCKED_CHAT =
 * hidden-for-both). Callers answer all three the same way (NOT_FOUND), so a
 * blocked user cannot tell a block from a missing chat.
 */
export async function getAccessibleChat(
  chatId: string,
  userId: string,
): Promise<{ id: string; origin: ChatOrigin; partnerId: string; isHostA: boolean } | null> {
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    select: { id: true, origin: true, hostAId: true, hostBId: true },
  });
  if (!chat || (chat.hostAId !== userId && chat.hostBId !== userId)) return null;

  const partnerId = chat.hostAId === userId ? chat.hostBId : chat.hostAId;
  if (await isBlockedPair(userId, partnerId)) return null;

  return { id: chat.id, origin: chat.origin, partnerId, isHostA: chat.hostAId === userId };
}

/**
 * Maps each of `otherUserIds` to the id of the chat `userId` has with them
 * (only chats that exist; blocked counterparts are filtered out by callers).
 * Lets cards show "go to chat" without exposing anything new.
 */
export async function getChatIdsWith(userId: string, otherUserIds: string[]): Promise<Map<string, string>> {
  if (otherUserIds.length === 0) return new Map();
  const chats = await prisma.chat.findMany({
    where: {
      OR: [
        { hostAId: userId, hostBId: { in: otherUserIds } },
        { hostBId: userId, hostAId: { in: otherUserIds } },
      ],
    },
    select: { id: true, hostAId: true, hostBId: true },
  });
  return new Map(chats.map((c) => [c.hostAId === userId ? c.hostBId : c.hostAId, c.id]));
}
