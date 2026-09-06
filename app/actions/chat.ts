"use server";

import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";

/**
 * Checks both directions of the block relationship before allowing chat access.
 * A block must be invisible to both parties — the blocked user should not know
 * they are blocked, and the blocker should not see the conversation either.
 */
async function isChatBlocked(userId: string, otherUserId: string) {
  const [myGroup, otherGroup] = await Promise.all([
    prisma.group.findUnique({ where: { userId }, select: { id: true } }),
    prisma.group.findUnique({
      where: { userId: otherUserId },
      select: { id: true },
    }),
  ]);

  if (!myGroup || !otherGroup) return false;

  const block = await prisma.groupBlock.findFirst({
    where: {
      OR: [
        { blockerId: userId, blockedGroupId: otherGroup.id },
        { blockerId: otherUserId, blockedGroupId: myGroup.id },
      ],
    },
  });

  return block !== null;
}

/**
 * Handles outgoing chat messages securely.
 * Enforces Horizontal Privilege Escalation prevention by verifying the sender is an active participant in the specific chat.
 * Checks the moderation ledger to silently abort if either user has blocked the other.
 * * @param chatId - The unique identifier of the target conversation.
 * @param text - The raw message content payload.
 * @returns The newly created message object for optimistic UI updates, or an error state.
 */
export async function sendMessage(chatId: string, text: string) {
  const cookieStore = await cookies();
  const userId = cookieStore.get("gloo_user_id")?.value;

  if (!userId) return { error: "Unauthorized" };

  const trimmed = text.trim();
  if (!trimmed) return { error: "Message cannot be empty" };

  // Hard cap at 2000 characters to prevent oversized DB writes and
  // large payloads being returned to all participants on every fetch.
  const MAX_MESSAGE_LENGTH = 2000;
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    return { error: "Message is too long. Maximum length is 2000 characters." };
  }

  try {
    const chat = await prisma.chat.findUnique({
      where: { id: chatId },
      select: { hostAId: true, hostBId: true },
    });

    if (!chat) return { error: "Chat not found" };
    if (chat.hostAId !== userId && chat.hostBId !== userId) {
      return { error: "Forbidden" };
    }

    const otherUserId = chat.hostAId === userId ? chat.hostBId : chat.hostAId;

    const blocked = await isChatBlocked(userId, otherUserId);
    if (blocked) return { error: "This conversation is no longer available." };

    const message = await prisma.message.create({
      data: {
        chatId,
        senderId: userId,
        text: trimmed,
      },
      include: {
        sender: { select: { id: true, name: true, image: true } },
      },
    });

    return { success: true, message };
  } catch (error) {
    console.error("Error sending message:", error);
    return {
      error:
        "Failed to send message. Please check your connection and try again.",
    };
  }
}

/**
 * Loads all messages for a specific chat, ordered chronologically,
 * along with the chat partner's info.
 * Only returns data if the current user is a participant.
 */
export async function getChatMessages(chatId: string) {
  const cookieStore = await cookies();
  const userId = cookieStore.get("gloo_user_id")?.value;

  if (!userId) return { error: "Unauthorized" };

  try {
    const chat = await prisma.chat.findUnique({
      where: { id: chatId },
      include: {
        hostA: { include: { group: true } },
        hostB: { include: { group: true } },
      },
    });

    if (!chat) return { error: "Chat not found" };
    if (chat.hostAId !== userId && chat.hostBId !== userId) {
      return { error: "Forbidden" };
    }

    const otherUserId = chat.hostAId === userId ? chat.hostBId : chat.hostAId;

    const blocked = await isChatBlocked(userId, otherUserId);
    if (blocked) return { error: "This conversation is no longer available." };

    const messages = await prisma.message.findMany({
      where: { chatId },
      orderBy: { createdAt: "asc" },
      include: {
        sender: { select: { id: true, name: true, image: true } },
      },
    });

    const partner = chat.hostAId === userId ? chat.hostB : chat.hostA;
    const partnerGroup = partner.group;

    return {
      success: true,
      messages,
      userId,
      partner: {
        id: partner.id,
        name: partner.name || "Unknown User",
        image:
          partnerGroup?.photos?.[0] ||
          partner.image ||
          "/images/bg-fallback.jpg",
      },
    };
  } catch (error) {
    console.error("Error fetching messages:", error);
    return { error: "Failed to load messages" };
  }
}

/**
 * Finds an existing chat between the current user and the target group's
 * host, or creates a new one. Returns the chatId for navigation.
 */
export async function getOrCreateChat(targetUserId: string) {
  const cookieStore = await cookies();
  const userId = cookieStore.get("gloo_user_id")?.value;

  if (!userId) return { error: "Unauthorized" };

  if (targetUserId === userId) return { error: "Cannot chat with yourself" };

  try {
    const existing = await prisma.chat.findFirst({
      where: {
        OR: [
          { hostAId: userId, hostBId: targetUserId },
          { hostAId: targetUserId, hostBId: userId },
        ],
      },
      select: { id: true },
    });

    if (existing) return { success: true, chatId: existing.id };

    const chat = await prisma.chat.create({
      data: { hostAId: userId, hostBId: targetUserId },
      select: { id: true },
    });

    return { success: true, chatId: chat.id };
  } catch (error) {
    console.error("Error getting or creating chat:", error);
    return { error: "Failed to open chat" };
  }
}

export async function getActiveChats() {
  const cookieStore = await cookies();
  const userId = cookieStore.get("gloo_user_id")?.value;

  if (!userId) return { error: "Unauthorized" };

  try {
    const myGroup = await prisma.group.findUnique({
      where: { userId },
      select: { id: true },
    });

    let blockedGroupIds: string[] = [];
    let blockedByUserIds: string[] = [];

    if (myGroup) {
      const blocksByMe = await prisma.groupBlock.findMany({
        where: { blockerId: userId },
        select: { blockedGroupId: true },
      });
      blockedGroupIds = blocksByMe.map((b) => b.blockedGroupId);

      const blocksOnMe = await prisma.groupBlock.findMany({
        where: { blockedGroupId: myGroup.id },
        select: { blockerId: true },
      });
      blockedByUserIds = blocksOnMe.map((b) => b.blockerId);
    }

    let blockedUserIds: string[] = [];
    if (blockedGroupIds.length > 0) {
      const blockedGroups = await prisma.group.findMany({
        where: { id: { in: blockedGroupIds } },
        select: { userId: true },
      });
      blockedUserIds = blockedGroups.map((g) => g.userId);
    }

    const allBlockedUserIds = [
      ...new Set([...blockedUserIds, ...blockedByUserIds]),
    ];

    const chats = await prisma.chat.findMany({
      where: {
        OR: [{ hostAId: userId }, { hostBId: userId }],
        ...(allBlockedUserIds.length > 0
          ? {
              NOT: [
                { hostAId: { in: allBlockedUserIds }, hostBId: userId },
                { hostAId: userId, hostBId: { in: allBlockedUserIds } },
              ],
            }
          : {}),
      },
      include: {
        hostA: {
          include: { group: true },
        },
        hostB: {
          include: { group: true },
        },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    const formattedChats = chats.map((chat) => {
      const isUserHostA = chat.hostAId === userId;
      const otherHost = isUserHostA ? chat.hostB : chat.hostA;

      const otherGroup = otherHost.group;
      const lastMsg = chat.messages[0];
      const lastMessageText = lastMsg?.text || "No messages yet";
      // There is no dedicated isMatch column in the schema. When two groups
      // mutually like each other, the system creates a first message with a
      // known text. Detecting that text here is the cheapest way to flag
      // matched chats without an extra DB query per chat.
      const isMatch = lastMessageText.toLowerCase().includes("match");

      return {
        id: chat.id,
        name: otherHost.name || "Unknown User",
        lastMessage: lastMessageText,
        time: lastMsg?.createdAt || chat.createdAt,
        unread: 0,
        isMatch,
        image:
          otherGroup?.photos?.[0] ||
          otherHost.image ||
          "/images/bg-fallback.jpg",
      };
    });

    // Prisma's orderBy supports a single sort dimension. Matches must appear
    // first regardless of time, so a two-level sort is applied in JS instead
    // of SQL — it cannot be expressed in a single ORDER BY clause without a subquery.
    formattedChats.sort((a, b) => {
      if (a.isMatch !== b.isMatch) {
        return a.isMatch ? -1 : 1;
      }
      const timeA = new Date(a.time).getTime();
      const timeB = new Date(b.time).getTime();
      return timeB - timeA;
    });

    return { success: true, chats: formattedChats };
  } catch (error) {
    console.error("Error fetching chats:", error);
    return { error: "Failed to fetch chats" };
  }
}
