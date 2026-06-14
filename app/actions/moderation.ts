"use server";

import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";

export async function blockGroupAction(chatId: string) {
  const cookieStore = await cookies();
  const userId = cookieStore.get("gloo_user_id")?.value;

  if (!userId) return { error: "Unauthorized" };

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

    const otherGroup = await prisma.group.findUnique({
      where: { userId: otherUserId },
      select: { id: true },
    });

    if (!otherGroup) return { error: "Group not found" };

    const existing = await prisma.groupBlock.findUnique({
      where: {
        blockerId_blockedGroupId: {
          blockerId: userId,
          blockedGroupId: otherGroup.id,
        },
      },
    });

    // Returning success instead of an error on a duplicate block prevents the
    // caller from detecting that they had already blocked this group — which
    // could otherwise be exploited to probe moderation state.
    if (existing) return { success: true, alreadyBlocked: true };

    await prisma.groupBlock.create({
      data: {
        blockerId: userId,
        blockedGroupId: otherGroup.id,
      },
    });

    return { success: true };
  } catch (error) {
    console.error("Error blocking group:", error);
    return { error: "Failed to block group. Please try again." };
  }
}

export async function reportGroupAction(chatId: string, reason?: string) {
  const cookieStore = await cookies();
  const userId = cookieStore.get("gloo_user_id")?.value;

  if (!userId) return { error: "Unauthorized" };

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

    const otherGroup = await prisma.group.findUnique({
      where: { userId: otherUserId },
      select: { id: true },
    });

    if (!otherGroup) return { error: "Group not found" };

    const existing = await prisma.groupReport.findUnique({
      where: {
        reporterId_reportedGroupId: {
          reporterId: userId,
          reportedGroupId: otherGroup.id,
        },
      },
    });

    // Silent success on duplicate reports keeps report history opaque to the
    // reporter. A bad actor should not be able to tell whether their account
    // has already been flagged by someone else.
    if (existing) return { success: true, alreadyReported: true };

    await prisma.groupReport.create({
      data: {
        reporterId: userId,
        reportedGroupId: otherGroup.id,
        reason: reason || null,
      },
    });

    return { success: true };
  } catch (error) {
    console.error("Error reporting group:", error);
    return { error: "Failed to report group. Please try again." };
  }
}

export async function reportGroupByGroupIdAction(
  groupId: string,
  reason?: string,
) {
  const cookieStore = await cookies();
  const userId = cookieStore.get("gloo_user_id")?.value;

  if (!userId) return { error: "Unauthorized" };

  try {
    const group = await prisma.group.findUnique({
      where: { id: groupId },
      select: { id: true },
    });

    if (!group) return { error: "Group not found" };

    const existing = await prisma.groupReport.findUnique({
      where: {
        reporterId_reportedGroupId: {
          reporterId: userId,
          reportedGroupId: groupId,
        },
      },
    });

    if (existing) return { success: true, alreadyReported: true };

    await prisma.groupReport.create({
      data: {
        reporterId: userId,
        reportedGroupId: groupId,
        reason: reason || null,
      },
    });

    return { success: true };
  } catch (error) {
    console.error("Error reporting group by ID:", error);
    return { error: "Failed to report group. Please try again." };
  }
}

export async function unblockGroupAction(blockedGroupId: string) {
  const cookieStore = await cookies();
  const userId = cookieStore.get("gloo_user_id")?.value;

  if (!userId) return { error: "Unauthorized" };

  try {
    await prisma.groupBlock.deleteMany({
      where: {
        blockerId: userId,
        blockedGroupId,
      },
    });

    return { success: true };
  } catch (error) {
    console.error("Error unblocking group:", error);
    return { error: "Failed to unblock group. Please try again." };
  }
}

export async function getBlockedGroupsAction() {
  const cookieStore = await cookies();
  const userId = cookieStore.get("gloo_user_id")?.value;

  if (!userId) return { error: "Unauthorized" };

  try {
    const blocks = await prisma.groupBlock.findMany({
      where: { blockerId: userId },
      include: {
        blockedGroup: {
          include: {
            user: {
              select: { id: true, name: true, image: true, username: true },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const groups = blocks.map((block) => ({
      blockId: block.id,
      blockedGroupId: block.blockedGroup.id,
      userId: block.blockedGroup.userId,
      user: block.blockedGroup.user,
      photos: block.blockedGroup.photos,
      description: block.blockedGroup.description,
      membersCount: block.blockedGroup.membersCount,
      gender: block.blockedGroup.gender,
      ageMin: block.blockedGroup.ageMin,
      ageMax: block.blockedGroup.ageMax,
      blockedAt: block.createdAt.toISOString(),
    }));

    return { groups };
  } catch (error) {
    console.error("Error fetching blocked groups:", error);
    return { error: "Failed to fetch blocked groups" };
  }
}
