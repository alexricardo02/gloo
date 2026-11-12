import "server-only";

import { prisma } from "@/lib/prisma";
import { getBlockSet } from "@/lib/blocks";
import { getChatIdsWith } from "@/lib/chats";
import { toPublicUrl, toPublicUrls } from "@/lib/storage";
import type { LikedMeGroupDTO } from "@/lib/apiTypes";

/**
 * The "liked me" tab (ST0-87), served by GET /api/likes.
 *
 * Explicit selects only: the group id (needed to like back) but no user ids.
 * Groups blocked in either direction are hidden. Location masking is a
 * separate pack; coordinates are returned as before.
 */

export async function getGroupsThatLikedMe(userId: string): Promise<LikedMeGroupDTO[]> {
  const myGroup = await prisma.group.findUnique({ where: { userId }, select: { id: true } });
  if (!myGroup) return [];

  const [{ groupIds: blockedGroupIds }, incomingLikes] = await Promise.all([
    getBlockSet(userId),
    prisma.groupLike.findMany({
      where: { toGroupId: myGroup.id },
      orderBy: { createdAt: "desc" },
      select: {
        fromGroup: {
          select: {
            id: true,
            userId: true,
            photos: true,
            description: true,
            membersCount: true,
            gender: true,
            ageMin: true,
            ageMax: true,
            latitude: true,
            longitude: true,
            createdAt: true,
            user: { select: { name: true, image: true, username: true } },
          },
        },
      },
    }),
  ]);

  const visible = incomingLikes.map((like) => like.fromGroup).filter((group) => !blockedGroupIds.has(group.id));
  if (visible.length === 0) return [];

  const [outgoingLikes, chatIds] = await Promise.all([
    prisma.groupLike.findMany({
      where: { fromGroupId: myGroup.id, toGroupId: { in: visible.map((g) => g.id) } },
      select: { toGroupId: true },
    }),
    getChatIdsWith(userId, visible.map((g) => g.userId)),
  ]);
  const likedBack = new Set(outgoingLikes.map((l) => l.toGroupId));

  return visible.map((group) => ({
    id: group.id,
    user: { ...group.user, image: toPublicUrl(group.user.image) },
    photos: toPublicUrls(group.photos),
    description: group.description,
    membersCount: group.membersCount,
    gender: group.gender,
    ageMin: group.ageMin,
    ageMax: group.ageMax,
    latitude: group.latitude,
    longitude: group.longitude,
    createdAt: group.createdAt.toISOString(),
    likedByCurrentUser: likedBack.has(group.id),
    isMutualLike: likedBack.has(group.id),
    chatId: chatIds.get(group.userId) ?? null,
  }));
}
