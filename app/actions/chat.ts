"use server";

import { z } from "zod";
import type { ChatOrigin, MessageType, SystemMessageKey } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/session";
import { toPublicUrl, withImageUrl } from "@/lib/storage";
import { getBlockSet, isBlockedPair } from "@/lib/blocks";
import { findChatBetween, getAccessibleChat } from "@/lib/chats";
import { type ActionResult, fail, ok } from "@/lib/actionResult";

/**
 * Chat server actions. They never create chats: chats only come from a
 * mutual like (lib/chats.ts ensureChat, called by toggleLike).
 *
 * A chat that does not exist, that the caller is not part of, or whose
 * participants blocked each other (BLOCKED_CHAT = hidden-for-both) all answer
 * NOT_FOUND with messageKey "blockedChatError" (Chat namespace), so a blocked
 * user cannot tell a block from a missing chat. Messages stay in the DB.
 */

const MAX_MESSAGE_LENGTH = 2000;
const idSchema = z.string().min(1).max(64);

export type ChatMessage = {
  id: string;
  text: string;
  /** null for SYSTEM messages and for messages of deleted accounts. */
  senderId: string | null;
  type: MessageType;
  /** Set for SYSTEM messages; rendered via Chat.systemMessages.<key>. */
  systemKey: SystemMessageKey | null;
  createdAt: Date;
  sender: { id: string; name: string; image: string | null } | null;
};

export type ChatPreview = {
  id: string;
  name: string;
  /** null when the chat has no messages or the last one is a SYSTEM message. */
  lastMessage: string | null;
  lastMessageSystemKey: SystemMessageKey | null;
  time: Date;
  unread: number;
  isMatch: boolean;
  image: string;
};

const messageSelect = {
  id: true,
  text: true,
  senderId: true,
  type: true,
  systemKey: true,
  createdAt: true,
  sender: { select: { id: true, name: true, image: true } },
} as const;

const chatUnavailable = () => fail("NOT_FOUND", "blockedChatError");

/**
 * Sends a message. Only participants of a chat that is not blocked can send
 * (LEGACY chats keep working: EXISTING_UNMATCHED_CHATS = keep-as-legacy).
 * On VALIDATION, messageKey is "messageEmpty" or "messageTooLong".
 */
export async function sendMessage(
  chatId: string,
  text: string,
): Promise<ActionResult<{ message: ChatMessage }>> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return fail("UNAUTHORIZED");
  }

  if (!idSchema.safeParse(chatId).success || typeof text !== "string") return fail("VALIDATION");
  const trimmed = text.trim();
  if (!trimmed) return fail("VALIDATION", "messageEmpty");
  // Hard cap to prevent oversized DB writes and payloads on every fetch.
  if (trimmed.length > MAX_MESSAGE_LENGTH) return fail("VALIDATION", "messageTooLong");

  try {
    const chat = await getAccessibleChat(chatId, userId);
    if (!chat) return chatUnavailable();

    const message = await prisma.message.create({
      data: { chatId: chat.id, senderId: userId, text: trimmed, type: "USER" },
      select: messageSelect,
    });

    return ok({ message: { ...message, sender: message.sender ? withImageUrl(message.sender) : null } });
  } catch (error) {
    console.error("Error sending message:", error);
    return fail("INTERNAL", "sendFailed");
  }
}

/**
 * Loads all messages of a chat (oldest first) plus the chat partner's info.
 * NOT_FOUND for missing, foreign or blocked chats; the page redirects.
 */
export async function getChatMessages(chatId: string): Promise<
  ActionResult<{
    messages: ChatMessage[];
    userId: string;
    origin: ChatOrigin;
    partner: { id: string; name: string; image: string };
  }>
> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return fail("UNAUTHORIZED");
  }

  if (!idSchema.safeParse(chatId).success) return chatUnavailable();

  try {
    const chat = await getAccessibleChat(chatId, userId);
    if (!chat) return chatUnavailable();

    const [messages, partner] = await Promise.all([
      prisma.message.findMany({
        where: { chatId: chat.id },
        orderBy: { createdAt: "asc" },
        select: messageSelect,
      }),
      prisma.user.findUnique({
        where: { id: chat.partnerId },
        select: { id: true, name: true, image: true, group: { select: { photos: true } } },
      }),
    ]);

    return ok({
      messages: messages.map((m) => ({ ...m, sender: m.sender ? withImageUrl(m.sender) : null })),
      userId,
      origin: chat.origin,
      partner: {
        id: chat.partnerId,
        name: partner?.name || "Unknown User",
        image: toPublicUrl(partner?.group?.photos?.[0] || partner?.image || "/images/bg-fallback.jpg"),
      },
    });
  } catch (error) {
    console.error("Error fetching messages:", error);
    return fail("INTERNAL", "loadFailed");
  }
}

/**
 * Returns the id of an EXISTING chat with `targetUserId`. Never creates one
 * (CHAT_CREATION = match-only): NOT_FOUND if there is no chat, it is blocked,
 * or the target is the caller.
 */
export async function openExistingChat(targetUserId: string): Promise<ActionResult<{ chatId: string }>> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return fail("UNAUTHORIZED");
  }

  if (!idSchema.safeParse(targetUserId).success || targetUserId === userId) return chatUnavailable();

  try {
    const chat = await findChatBetween(userId, targetUserId);
    if (!chat || (await isBlockedPair(userId, targetUserId))) return chatUnavailable();
    return ok({ chatId: chat.id });
  } catch (error) {
    console.error("Error opening chat:", error);
    return fail("INTERNAL");
  }
}

/**
 * The caller's chats, matches first, then newest activity first. Chats with
 * blocked counterparts are hidden for both sides.
 */
export async function getActiveChats(): Promise<ActionResult<{ chats: ChatPreview[] }>> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return fail("UNAUTHORIZED");
  }

  try {
    const { userIds } = await getBlockSet(userId);
    userIds.delete(userId);
    const blockedUserIds = [...userIds];

    const chats = await prisma.chat.findMany({
      where: {
        OR: [{ hostAId: userId }, { hostBId: userId }],
        ...(blockedUserIds.length > 0
          ? { NOT: [{ hostAId: { in: blockedUserIds } }, { hostBId: { in: blockedUserIds } }] }
          : {}),
      },
      select: {
        id: true,
        origin: true,
        createdAt: true,
        hostAId: true,
        hostA: { select: { name: true, image: true, group: { select: { photos: true } } } },
        hostB: { select: { name: true, image: true, group: { select: { photos: true } } } },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { text: true, type: true, systemKey: true, createdAt: true },
        },
      },
    });

    const formattedChats: ChatPreview[] = chats.map((chat) => {
      const otherHost = chat.hostAId === userId ? chat.hostB : chat.hostA;
      const lastMsg = chat.messages[0];
      const isSystem = lastMsg?.type === "SYSTEM";

      return {
        id: chat.id,
        name: otherHost.name || "Unknown User",
        lastMessage: lastMsg && !isSystem ? lastMsg.text : null,
        lastMessageSystemKey: isSystem ? lastMsg.systemKey : null,
        time: lastMsg?.createdAt || chat.createdAt,
        unread: 0,
        isMatch: chat.origin === "MATCH",
        image: toPublicUrl(otherHost.group?.photos?.[0] || otherHost.image || "/images/bg-fallback.jpg"),
      };
    });

    // Matches first, then newest activity first (two-level sort in JS).
    formattedChats.sort((a, b) => {
      if (a.isMatch !== b.isMatch) return a.isMatch ? -1 : 1;
      return new Date(b.time).getTime() - new Date(a.time).getTime();
    });

    return ok({ chats: formattedChats });
  } catch (error) {
    console.error("Error fetching chats:", error);
    return fail("INTERNAL");
  }
}
