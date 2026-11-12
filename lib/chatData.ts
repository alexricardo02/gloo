import "server-only";

import { Prisma, type MessageType, type SystemMessageKey } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getBlockSet } from "@/lib/blocks";
import { getAccessibleChat } from "@/lib/chats";
import { toPublicUrl } from "@/lib/storage";
import { CHAT_LIST_MAX_LIMIT, CHAT_LIST_PAGE_SIZE, MESSAGE_PAGE_SIZE } from "@/lib/liveUpdates";
import type {
  ChatHeaderDTO,
  ChatListItemDTO,
  ChatListPage,
  ChatMessageDTO,
  MessagePage,
} from "@/lib/apiTypes";

/**
 * Chat reads for the route handlers in app/api/chats/** and app/api/unread,
 * plus read tracking (READ_TRACKING = columns-on-chat).
 *
 * Access rules (Pack 4): a chat that does not exist, that the caller is not
 * part of, or whose participants blocked each other is "not accessible" and
 * all three answer the same way (null here, 404 in the routes).
 *
 * Unread rule: a message is unread for me when it is in one of my
 * non-blocked chats, was NOT sent by me (senderId IS DISTINCT FROM me, so
 * system notices and messages of deleted accounts count), and was created
 * after my "*LastReadAt" (NULL = never read).
 */

const FALLBACK_IMAGE = "/images/bg-fallback.jpg";

export class InvalidCursorError extends Error {
  constructor() {
    super("Invalid cursor");
    this.name = "InvalidCursorError";
  }
}

// ── Messages ────────────────────────────────────────────────────────────

/** A message row as stored. `senderId` is null for SYSTEM messages and deleted accounts. */
export type MessageRow = {
  id: string;
  text: string;
  senderId: string | null;
  type: MessageType;
  systemKey: SystemMessageKey | null;
  createdAt: Date;
};

export const messageRowSelect = {
  id: true,
  text: true,
  senderId: true,
  type: true,
  systemKey: true,
  createdAt: true,
} as const;

/** Wire format: no user ids, `isOwn` instead of `senderId`; system notices carry no text. */
export function toMessageDTO(row: MessageRow, viewerId: string): ChatMessageDTO {
  const createdAt = row.createdAt.toISOString();
  if (row.type === "SYSTEM") {
    return { id: row.id, type: "SYSTEM", text: null, systemKey: row.systemKey, createdAt, isOwn: false };
  }
  return {
    id: row.id,
    type: "USER",
    text: row.text,
    systemKey: null,
    createdAt,
    isOwn: row.senderId !== null && row.senderId === viewerId,
  };
}

/** Header info for an open chat, or null if not accessible. */
export async function getChatHeader(chatId: string, userId: string): Promise<ChatHeaderDTO | null> {
  const chat = await getAccessibleChat(chatId, userId);
  if (!chat) return null;

  const partner = await prisma.user.findUnique({
    where: { id: chat.partnerId },
    select: { name: true, image: true, group: { select: { photos: true } } },
  });

  return {
    id: chat.id,
    isMatch: chat.origin === "MATCH",
    partner: {
      name: partner?.name || "Unknown User",
      image: toPublicUrl(partner?.group?.photos?.[0] || partner?.image || FALLBACK_IMAGE),
    },
  };
}

export type MessagePageOptions = {
  /** Only messages newer than this message id (oldest first, up to `limit`). */
  after?: string | null;
  /** The page of messages directly older than this message id. */
  before?: string | null;
  limit?: number;
};

/**
 * Keyset pagination over (createdAt, id), served by the
 * Message(chatId, createdAt DESC) index; `id` breaks ties between equal
 * timestamps, so pages never overlap or skip rows.
 *
 * Without a cursor: the newest `limit` messages. Returns null if the chat is
 * not accessible; throws InvalidCursorError for an unknown/foreign cursor or
 * when both cursors are given.
 */
export async function getMessagesPage(
  chatId: string,
  userId: string,
  { after = null, before = null, limit = MESSAGE_PAGE_SIZE }: MessagePageOptions = {},
): Promise<MessagePage | null> {
  if (after && before) throw new InvalidCursorError();

  const chat = await getAccessibleChat(chatId, userId);
  if (!chat) return null;

  const take = Math.max(1, Math.min(limit, MESSAGE_PAGE_SIZE));
  const cursorId = after ?? before;
  let cursor: { id: string; createdAt: Date } | null = null;
  if (cursorId) {
    cursor = await prisma.message.findFirst({
      where: { id: cursorId, chatId: chat.id },
      select: { id: true, createdAt: true },
    });
    if (!cursor) throw new InvalidCursorError();
  }

  if (after && cursor) {
    const rows = await prisma.message.findMany({
      where: {
        chatId: chat.id,
        OR: [
          { createdAt: { gt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { gt: cursor.id } },
        ],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: take + 1,
      select: messageRowSelect,
    });
    return {
      messages: rows.slice(0, take).map((r) => toMessageDTO(r, userId)),
      hasMore: rows.length > take,
    };
  }

  const rows = await prisma.message.findMany({
    where: {
      chatId: chat.id,
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    select: messageRowSelect,
  });
  return {
    messages: rows
      .slice(0, take)
      .reverse()
      .map((r) => toMessageDTO(r, userId)),
    hasMore: rows.length > take,
  };
}

/**
 * Marks the chat as read for `userId` up to (and including) the message
 * `upToMessageId`. The read marker only moves forward. Returns false if the
 * chat is not accessible or the message is not in it.
 */
export async function markChatRead(chatId: string, userId: string, upToMessageId: string): Promise<boolean> {
  const chat = await getAccessibleChat(chatId, userId);
  if (!chat) return false;

  const message = await prisma.message.findFirst({
    where: { id: upToMessageId, chatId: chat.id },
    select: { createdAt: true },
  });
  if (!message) return false;

  const readAt = message.createdAt;
  if (chat.isHostA) {
    await prisma.chat.updateMany({
      where: { id: chat.id, OR: [{ hostALastReadAt: null }, { hostALastReadAt: { lt: readAt } }] },
      data: { hostALastReadAt: readAt },
    });
  } else {
    await prisma.chat.updateMany({
      where: { id: chat.id, OR: [{ hostBLastReadAt: null }, { hostBLastReadAt: { lt: readAt } }] },
      data: { hostBLastReadAt: readAt },
    });
  }
  return true;
}

// ── Chat list and badge ─────────────────────────────────────────────────

/** SQL: the other participant of chat `c` for `userId`. */
const partnerIdSql = (userId: string) =>
  Prisma.sql`CASE WHEN c."hostAId" = ${userId} THEN c."hostBId" ELSE c."hostAId" END`;

/** SQL: message `m` of chat `c` is unread for `userId`. */
const unreadMessageSql = (userId: string) => Prisma.sql`
  m."chatId" = c."id"
  AND m."senderId" IS DISTINCT FROM ${userId}
  AND m."createdAt" > COALESCE(
    CASE WHEN c."hostAId" = ${userId} THEN c."hostALastReadAt" ELSE c."hostBLastReadAt" END,
    '-infinity'::timestamp
  )`;

/** Chats of `userId` whose other participant is not blocked either way. */
async function visibleChatsWhere(userId: string): Promise<Prisma.Sql> {
  const { userIds } = await getBlockSet(userId);
  userIds.delete(userId);
  const blocked = [...userIds];
  return Prisma.sql`(c."hostAId" = ${userId} OR c."hostBId" = ${userId})
    ${blocked.length > 0 ? Prisma.sql`AND NOT (${partnerIdSql(userId)} = ANY(${blocked}::text[]))` : Prisma.empty}`;
}

type ChatCursor = { m: 0 | 1; t: string; id: string };

function encodeCursor(cursor: ChatCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(raw: string): ChatCursor {
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<ChatCursor>;
    if (
      (value.m === 0 || value.m === 1) &&
      typeof value.t === "string" &&
      !Number.isNaN(Date.parse(value.t)) &&
      typeof value.id === "string" &&
      value.id.length > 0 &&
      value.id.length <= 64
    ) {
      return { m: value.m, t: value.t, id: value.id };
    }
  } catch {
    // fall through
  }
  throw new InvalidCursorError();
}

type ChatListRow = {
  id: string;
  isMatch: number;
  activity: Date;
  partnerName: string | null;
  partnerImage: string | null;
  partnerPhoto: string | null;
  lastText: string | null;
  lastType: MessageType | null;
  lastSystemKey: SystemMessageKey | null;
  unread: number;
};

/**
 * The caller's chats: matches first, then newest activity (last message, else
 * chat creation), keyset-paginated on (isMatch, activity, id). Only the
 * fields the list shows are selected.
 */
export async function listChats(
  userId: string,
  { cursor = null, limit = CHAT_LIST_PAGE_SIZE }: { cursor?: string | null; limit?: number } = {},
): Promise<ChatListPage> {
  const take = Math.max(1, Math.min(limit, CHAT_LIST_MAX_LIMIT));
  const after = cursor ? decodeCursor(cursor) : null;
  const where = await visibleChatsWhere(userId);

  const rows = await prisma.$queryRaw<ChatListRow[]>`
    WITH chats AS (
      SELECT c."id",
             CASE WHEN c."origin" = 'MATCH' THEN 1 ELSE 0 END AS "isMatch",
             COALESCE(lm."createdAt", c."createdAt") AS "activity",
             ${partnerIdSql(userId)} AS "partnerId",
             lm."text" AS "lastText",
             lm."type" AS "lastType",
             lm."systemKey" AS "lastSystemKey"
        FROM "Chat" c
        LEFT JOIN LATERAL (
          SELECT "text", "type", "systemKey", "createdAt"
            FROM "Message"
           WHERE "chatId" = c."id"
           ORDER BY "createdAt" DESC, "id" DESC
           LIMIT 1
        ) lm ON TRUE
       WHERE ${where}
    ), page AS (
      SELECT * FROM chats
       ${after
         ? Prisma.sql`WHERE ("isMatch", "activity", "id") < (${after.m}, ${after.t}::timestamp, ${after.id})`
         : Prisma.empty}
       ORDER BY "isMatch" DESC, "activity" DESC, "id" DESC
       LIMIT ${take + 1}
    )
    SELECT page."id", page."isMatch", page."activity",
           page."lastText", page."lastType"::text AS "lastType", page."lastSystemKey"::text AS "lastSystemKey",
           u."name" AS "partnerName", u."image" AS "partnerImage", g."photos"[1] AS "partnerPhoto",
           (SELECT COUNT(*)::int FROM "Message" m, "Chat" c
             WHERE c."id" = page."id" AND ${unreadMessageSql(userId)}) AS "unread"
      FROM page
      LEFT JOIN "User" u ON u."id" = page."partnerId"
      LEFT JOIN "Group" g ON g."userId" = page."partnerId"
     ORDER BY page."isMatch" DESC, page."activity" DESC, page."id" DESC
  `;

  const pageRows = rows.slice(0, take);
  const items: ChatListItemDTO[] = pageRows.map((row) => {
    const isSystem = row.lastType === "SYSTEM";
    return {
      id: row.id,
      name: row.partnerName || "Unknown User",
      image: toPublicUrl(row.partnerPhoto || row.partnerImage || FALLBACK_IMAGE),
      isMatch: row.isMatch === 1,
      lastMessage: row.lastType && !isSystem ? row.lastText : null,
      lastMessageSystemKey: isSystem ? row.lastSystemKey : null,
      time: row.activity.toISOString(),
      unread: row.unread,
    };
  });

  const last = pageRows[pageRows.length - 1];
  return {
    items,
    nextCursor:
      rows.length > take && last
        ? encodeCursor({ m: last.isMatch === 1 ? 1 : 0, t: last.activity.toISOString(), id: last.id })
        : null,
  };
}

/** BADGE_COUNTS = chats-with-unread: number of my visible chats with at least one unread message. */
export async function countChatsWithUnread(userId: string): Promise<number> {
  const where = await visibleChatsWhere(userId);
  const rows = await prisma.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*)::int AS "n"
      FROM "Chat" c
     WHERE ${where}
       AND EXISTS (SELECT 1 FROM "Message" m WHERE ${unreadMessageSql(userId)})
  `;
  return rows[0]?.n ?? 0;
}
