"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/session";
import { isBlockedPair } from "@/lib/blocks";
import { findChatBetween, getAccessibleChat } from "@/lib/chats";
import { markChatRead as markChatReadUpTo, messageRowSelect, toMessageDTO } from "@/lib/chatData";
import type { ChatMessageDTO } from "@/lib/apiTypes";
import { type ActionResult, fail, ok } from "@/lib/actionResult";

/**
 * Chat server actions (writes). They never create chats: chats only come
 * from a mutual like (lib/chats.ts ensureChat, called by toggleLike).
 *
 * Reads go through the authenticated GET route handlers in app/api/chats/**
 * and app/api/unread (LIVE_UPDATES = smart-polling), see lib/chatData.ts.
 *
 * A chat that does not exist, that the caller is not part of, or whose
 * participants blocked each other (BLOCKED_CHAT = hidden-for-both) all answer
 * NOT_FOUND with messageKey "blockedChatError" (Chat namespace), so a blocked
 * user cannot tell a block from a missing chat. Messages stay in the DB.
 */

const MAX_MESSAGE_LENGTH = 2000;
const idSchema = z.string().min(1).max(64);

const chatUnavailable = () => fail("NOT_FOUND", "blockedChatError");

/**
 * Sends a message. Only participants of a chat that is not blocked can send
 * (LEGACY chats keep working: EXISTING_UNMATCHED_CHATS = keep-as-legacy); the
 * participant + block check is getAccessibleChat (one block query).
 * On VALIDATION, messageKey is "messageEmpty" or "messageTooLong".
 * Returns the stored message in the same shape as GET .../messages, so the
 * client can reconcile its optimistic copy (dedupe by id).
 */
export async function sendMessage(
  chatId: string,
  text: string,
): Promise<ActionResult<{ message: ChatMessageDTO }>> {
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
      select: messageRowSelect,
    });

    return ok({ message: toMessageDTO(message, userId) });
  } catch (error) {
    console.error("Error sending message:", error);
    return fail("INTERNAL", "sendFailed");
  }
}

/**
 * Marks the chat as read for the caller up to (and including) message
 * `upToMessageId`, which must be in that chat. Called when the chat is opened
 * and whenever new messages arrive while it is open and visible. The marker
 * only moves forward and is never shown to the other participant.
 */
export async function markChatRead(chatId: string, upToMessageId: string): Promise<ActionResult> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return fail("UNAUTHORIZED");
  }

  if (!idSchema.safeParse(chatId).success || !idSchema.safeParse(upToMessageId).success) {
    return fail("VALIDATION");
  }

  try {
    return (await markChatReadUpTo(chatId, userId, upToMessageId)) ? ok() : chatUnavailable();
  } catch (error) {
    console.error("Error marking chat as read:", error);
    return fail("INTERNAL");
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
