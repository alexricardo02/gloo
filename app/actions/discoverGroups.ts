"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getOptionalUserId, requireUserId } from "@/lib/session";
import { revalidatePath } from "next/cache";

/**
 * H-4 / S8: likes are rate limited through the shared limiter in lib/rateLimit.ts
 * (Upstash sliding window when configured; in-memory fallback with a warning in
 * development; refuses to run in production without Upstash).
 */
import { checkRateLimit } from "@/lib/rateLimit";
import { toPublicUrls, withImageUrl, withPhotoUrls } from "@/lib/storage";
import { getBlockSet, isBlockedPair } from "@/lib/blocks";
import { ensureChat, findChatBetween, lockPair } from "@/lib/chats";
import { type ActionResult, fail, ok } from "@/lib/actionResult";

/**
 * Maps each of `otherUserIds` to the id of the chat the caller has with them
 * (only chats that exist; blocked counterparts are filtered out by callers).
 * Lets cards show "go to chat" without exposing anything new.
 */
async function getChatIdsWith(userId: string, otherUserIds: string[]): Promise<Map<string, string>> {
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

/**
 * Core matching algorithm for the discovery feed.
 * Retrieves nearby groups based on the user's set preferences (age, gender, distance constraint).
 * Utilizes the Haversine formula directly within PostgreSQL via Prisma $queryRaw for highly performant geofencing.
 * Strictly enforces data isolation by excluding the user's own group and all mutually blocked groups.
 * * @param filters - An object containing 'page' (for pagination offset) and 'distance' (search radius in km).
 * @returns A structured array of group profiles authorized for the current user's feed.
 */
export async function getDiscoveryGroups({
  cursor,
  distance,
  isPartyMode = false,
}: {
  cursor?: string;
  distance: number;
  isPartyMode?: boolean;
}) {
  const userId = await getOptionalUserId();

  if (!userId) return { error: "Unauthorized" };

  try {
    const userGroup = await prisma.group.findUnique({ where: { userId } });
    if (!userGroup || userGroup.latitude === null || userGroup.longitude === null) {
      return { groups: [] };
    }

    function getDistanceKm(
      lat1: number,
      lon1: number,
      lat2: number,
      lon2: number,
    ) {
      const toRad = (deg: number) => (deg * Math.PI) / 180;
      const R = 6371;
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    }

    const rawGroups = await prisma.group.findMany({
      where: {
        userId: { not: userId },
        isPartyMode: isPartyMode,
        publicProfile: true,
        gender:
          userGroup.searchGender === "MIXED"
            ? undefined
            : userGroup.searchGender,

        OR: [{ searchGender: "MIXED" }, { searchGender: userGroup.gender }],
        latitude: {
          gte: userGroup.latitude - distance / 111,
          lte: userGroup.latitude + distance / 111,
        },
        longitude: {
          gte: userGroup.longitude - distance / 111,
          lte: userGroup.longitude + distance / 111,
        },
      },
      // Prisma's where clause applies a rectangular bounding box (lat/lon range),
      // not a true circular radius. We overfetch up to 100 candidates, then apply
      // precise Haversine filtering in JS below. 100 balances coverage vs. memory.
      take: 100,
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: { id: true, name: true, image: true },
        },
      },
    });

    const filteredGroups = rawGroups
      .map((group) => ({
        ...group,
        distance: getDistanceKm(
          userGroup.latitude ?? 0,
          userGroup.longitude ?? 0,
          group.latitude ?? 0,
          group.longitude ?? 0,
        ),
      }))
      .filter((group) => {
        if (group.distance > distance) return false;

        // Both age preferences must overlap for matching to make sense.
        // Showing a group that doesn't want to meet your age range would cause
        // rejected interactions — the filter must be enforced in both directions.
        const matchesYourAgePref =
          userGroup.searchAgeMin == null || userGroup.searchAgeMax == null
            ? true
            : group.ageMax >= userGroup.searchAgeMin &&
              group.ageMin <= userGroup.searchAgeMax;

        const matchesTheirAgePref =
          group.searchAgeMin == null || group.searchAgeMax == null
            ? true
            : userGroup.ageMax >= group.searchAgeMin &&
              userGroup.ageMin <= group.searchAgeMax;

        return matchesYourAgePref && matchesTheirAgePref;
      });

    const likedGroupRecords = await prisma.groupLike.findMany({
      where: { fromGroupId: userGroup.id },
      select: { toGroupId: true },
    });

    const likedGroupIds = new Set(
      likedGroupRecords.map((like) => like.toGroupId),
    );

    const { groupIds: allBlockedGroupIds } = await getBlockSet(userId);

    const mutualLikeRecords = await prisma.groupLike.findMany({
      where: {
        fromGroupId: { in: filteredGroups.map((group) => group.id) },
        toGroupId: userGroup.id,
      },
      select: { fromGroupId: true },
    });
    const mutualLikeGroupIds = new Set(
      mutualLikeRecords.map((like) => like.fromGroupId),
    );

    const startIndex = cursor
    ? filteredGroups.findIndex((g) => g.id === cursor) + 1
    : 0;

    const limit = 10;

    const pageSlice = filteredGroups
    .filter((group) => !allBlockedGroupIds.has(group.id))
    .slice(startIndex, startIndex + limit);

    const nextCursor = pageSlice.length === limit ? pageSlice[pageSlice.length - 1].id : null;

    const chatIds = await getChatIdsWith(userId, pageSlice.map((group) => group.userId));

    const groups = pageSlice.map((group) => ({
      ...withPhotoUrls(group),
      user: withImageUrl(group.user),
      createdAt: group.createdAt.toISOString(),
      updatedAt: group.updatedAt.toISOString(),
      likedByCurrentUser: likedGroupIds.has(group.id),
      isMutualLike: mutualLikeGroupIds.has(group.id),
      // CARD_MESSAGE_BUTTON = only-if-chat-exists: the card shows "go to chat" only when set.
      chatId: chatIds.get(group.userId) ?? null,
    }));

    return { groups, nextCursor };
  } catch (error) {
    console.error("Critical error in getDiscoveryGroups:", error);
    return { error: "Failed to fetch groups" };
  }
}

const toggleLikeInput = z.object({
  toGroupId: z.string().min(1).max(64),
  liked: z.boolean().optional(),
});

export type ToggleLikeResult = ActionResult<{
  liked: boolean;
  matched: boolean;
  /** The chat with the target group's host, if one exists after this call. */
  chatId: string | null;
}>;

/**
 * Likes or unlikes a group.
 *
 * `liked` is the desired state (the UI always sends it), which makes double
 * clicks and retries idempotent; without it the current state is toggled.
 *
 * Like: refused for the caller's own group (FORBIDDEN) and when either side
 * blocked the other (NOT_FOUND, so a block is indistinguishable from a missing
 * group). Inside ONE transaction, holding a per-pair lock: create the like
 * (no-op if it exists) -> check the reciprocal like -> ensureChat(MATCH) ->
 * create the match notice (SYSTEM message, at most one per chat). The lock
 * makes simultaneous A->B and B->A likes produce exactly one chat and notice.
 *
 * Unlike: removes the like only. UNLIKE_AFTER_MATCH = keep-chat: an existing
 * chat stays untouched and fully usable.
 */
export async function toggleLike(toGroupId: string, liked?: boolean): Promise<ToggleLikeResult> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return fail("UNAUTHORIZED");
  }

  const input = toggleLikeInput.safeParse({ toGroupId, liked });
  if (!input.success) return fail("VALIDATION");

  // H-4 / S8: 10 likes per 60 s per user via the shared limiter (lib/rateLimit.ts).
  if (!(await checkRateLimit("like", { identifier: userId }))) {
    return fail("RATE_LIMITED");
  }

  try {
    const result = await prisma.$transaction(async (tx): Promise<ToggleLikeResult> => {
      const fromGroup = await tx.group.findUnique({ where: { userId }, select: { id: true } });
      if (!fromGroup) return fail("NOT_FOUND");
      if (fromGroup.id === toGroupId) return fail("FORBIDDEN");

      const toGroup = await tx.group.findUnique({
        where: { id: toGroupId },
        select: { id: true, userId: true },
      });
      if (!toGroup) return fail("NOT_FOUND");

      await lockPair(tx, userId, toGroup.userId);

      const blocked = await isBlockedPair(userId, toGroup.userId, tx);
      const likeKey = { fromGroupId: fromGroup.id, toGroupId: toGroup.id };
      const wantLiked =
        liked ??
        !(await tx.groupLike.findUnique({ where: { fromGroupId_toGroupId: likeKey }, select: { id: true } }));

      if (!wantLiked) {
        await tx.groupLike.deleteMany({ where: likeKey });
        const chat = blocked ? null : await findChatBetween(userId, toGroup.userId, tx);
        return ok({ liked: false, matched: false, chatId: chat?.id ?? null });
      }

      if (blocked) return fail("NOT_FOUND");

      await tx.groupLike.createMany({ data: [likeKey], skipDuplicates: true });

      const reciprocal = await tx.groupLike.findUnique({
        where: { fromGroupId_toGroupId: { fromGroupId: toGroup.id, toGroupId: fromGroup.id } },
        select: { id: true },
      });

      if (!reciprocal) {
        const chat = await findChatBetween(userId, toGroup.userId, tx);
        return ok({ liked: true, matched: false, chatId: chat?.id ?? null });
      }

      const chatId = await ensureChat(fromGroup.id, toGroup.id, "MATCH", tx);
      // MATCH_NOTICE = system-message: no sender, rendered via i18n. Skipped if
      // the chat already has one (unique chatId + systemKey).
      await tx.message.createMany({
        data: [{ chatId, senderId: null, type: "SYSTEM", systemKey: "MATCH_CREATED", text: "" }],
        skipDuplicates: true,
      });

      return ok({ liked: true, matched: true, chatId });
    });

    if (result.ok) revalidatePath("/");
    return result;
  } catch (error) {
    console.error("Error toggling like:", error);
    return fail("INTERNAL");
  }
}

/**
 * Retrieves all groups that have liked the current user's group.
 * Returns group details including user info, photos, and mutual like status.
 * Used by the "Gruppen, die dich suchen" / "Groups that like you" feature (ST0-87).
 */
export async function getGroupsThatLikedMe() {
  const userId = await getOptionalUserId();

  if (!userId) return { error: "Unauthorized" };

  try {
    const myGroup = await prisma.group.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!myGroup) return { groups: [] };

    const { groupIds: allBlockedGroupIds } = await getBlockSet(userId);

    const incomingLikes = await prisma.groupLike.findMany({
      where: { toGroupId: myGroup.id },
      include: {
        fromGroup: {
          include: {
            user: {
              select: { id: true, name: true, image: true, username: true },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    if (incomingLikes.length === 0) return { groups: [] };

    const fromGroupIds = incomingLikes.map((like) => like.fromGroup.id);

    const outgoingLikes = await prisma.groupLike.findMany({
      where: {
        fromGroupId: myGroup.id,
        toGroupId: { in: fromGroupIds },
      },
      select: { toGroupId: true },
    });

    const likedBackIds = new Set(outgoingLikes.map((l) => l.toGroupId));

    const visibleLikes = incomingLikes.filter((like) => !allBlockedGroupIds.has(like.fromGroup.id));
    const chatIds = await getChatIdsWith(userId, visibleLikes.map((like) => like.fromGroup.userId));

    const groups = visibleLikes
      .map((like) => ({
        id: like.fromGroup.id,
        userId: like.fromGroup.userId,
        user: withImageUrl(like.fromGroup.user),
        photos: toPublicUrls(like.fromGroup.photos),
        description: like.fromGroup.description,
        membersCount: like.fromGroup.membersCount,
        gender: like.fromGroup.gender,
        ageMin: like.fromGroup.ageMin,
        ageMax: like.fromGroup.ageMax,
        latitude: like.fromGroup.latitude,
        longitude: like.fromGroup.longitude,
        createdAt: like.fromGroup.createdAt.toISOString(),
        likedByCurrentUser: likedBackIds.has(like.fromGroup.id),
        isMutualLike: likedBackIds.has(like.fromGroup.id),
        chatId: chatIds.get(like.fromGroup.userId) ?? null,
      }));

    return { groups };
  } catch (error) {
    console.error("Error fetching groups that liked me:", error);
    return { error: "Failed to fetch groups" };
  }
}
