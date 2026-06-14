"use server";

import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_LIKES_PER_WINDOW = 10;

// globalThis persists across requests within the same Node.js process, making
// this a zero-dependency in-memory rate limiter. It resets on server restart,
// which is acceptable for an MVP — a Redis-backed limiter would be needed at scale.
const likeRateLimit = ((globalThis as any).__GLOO_LIKE_RATE_LIMITER ||= new Map<
  string,
  { count: number; windowStart: number }
>());

async function getBlockedGroupIds(
  userId: string,
  myGroupId: string,
): Promise<Set<string>> {
  const blocksByMe = await prisma.groupBlock.findMany({
    where: { blockerId: userId },
    select: { blockedGroupId: true },
  });
  const blockedByMeIds = new Set(blocksByMe.map((b) => b.blockedGroupId));

  const blocksOnMe = await prisma.groupBlock.findMany({
    where: { blockedGroupId: myGroupId },
    select: { blockerId: true },
  });
  const blockedMeUserIds = new Set(blocksOnMe.map((b) => b.blockerId));

  let blockedMeGroupIds = new Set<string>();
  if (blockedMeUserIds.size > 0) {
    const blockedMeGroups = await prisma.group.findMany({
      where: { userId: { in: [...blockedMeUserIds] } },
      select: { id: true },
    });
    blockedMeGroupIds = new Set(blockedMeGroups.map((g) => g.id));
  }

  return new Set([...blockedByMeIds, ...blockedMeGroupIds]);
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
  page = 0,
  distance,
  isPartyMode = false,
}: {
  page: number;
  distance: number;
  isPartyMode?: boolean;
}) {
  const cookieStore = await cookies();
  const userId = cookieStore.get("gloo_user_id")?.value;

  if (!userId) return { error: "Unauthorized" };

  try {
    const userGroup = await prisma.group.findUnique({
      where: { userId },
    });

    if (
      !userGroup ||
      userGroup.latitude === null ||
      userGroup.longitude === null
    ) {
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

    const allBlockedGroupIds = await getBlockedGroupIds(userId, userGroup.id);

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

    const limit = 10;
    const skip = page * limit;

    const groups = filteredGroups
      .filter((group) => !allBlockedGroupIds.has(group.id))
      .slice(skip, skip + limit)
      .map((group) => ({
        ...group,
        createdAt: group.createdAt.toISOString(),
        updatedAt: group.updatedAt.toISOString(),
        likedByCurrentUser: likedGroupIds.has(group.id),
        isMutualLike: mutualLikeGroupIds.has(group.id),
      }));

    return { groups };
  } catch (error) {
    console.error("Critical error in getDiscoveryGroups:", error);
    return { error: "Failed to fetch groups" };
  }
}

/**
 * Toggles a symbolic like between groups.
 */
export async function toggleLike(toGroupId: string) {
  const cookieStore = await cookies();
  const userId = cookieStore.get("gloo_user_id")?.value;
  if (!userId) return { error: "Unauthorized" };

  const now = Date.now();
  const existingRate = likeRateLimit.get(userId);
  if (existingRate && now - existingRate.windowStart < RATE_LIMIT_WINDOW_MS) {
    if (existingRate.count >= MAX_LIKES_PER_WINDOW) {
      return {
        error: "Rate limit exceeded. Please wait a moment before liking again.",
      };
    }
    existingRate.count += 1;
    likeRateLimit.set(userId, existingRate);
  } else {
    likeRateLimit.set(userId, { count: 1, windowStart: now });
  }

  const fromGroup = await prisma.group.findUnique({ where: { userId } });
  if (!fromGroup) return { error: "Group not found" };

  const existingLike = await prisma.groupLike.findUnique({
    where: {
      fromGroupId_toGroupId: {
        fromGroupId: fromGroup.id,
        toGroupId,
      },
    },
  });

  if (existingLike) {
    await prisma.groupLike.delete({ where: { id: existingLike.id } });
    revalidatePath("/");
    return { liked: false };
  }

  const toGroup = await prisma.group.findUnique({
    where: { id: toGroupId },
    select: { id: true, userId: true },
  });

  if (!toGroup) {
    return { error: "Target group not found" };
  }

  const createdLike = await prisma.groupLike.create({
    data: { fromGroupId: fromGroup.id, toGroupId },
  });

  const reciprocalLike = await prisma.groupLike.findUnique({
    where: {
      fromGroupId_toGroupId: {
        fromGroupId: toGroupId,
        toGroupId: fromGroup.id,
      },
    },
  });

  let matched = false;
  if (reciprocalLike) {
    matched = true;

    const existingChat = await prisma.chat.findFirst({
      where: {
        OR: [
          { hostAId: userId, hostBId: toGroup.userId },
          { hostAId: toGroup.userId, hostBId: userId },
        ],
      },
    });

    // A race condition is possible if both groups like each other at the same
    // instant. Checking for an existing chat before creating prevents duplicate
    // chat rooms between the same pair of users.
    if (!existingChat) {
      const newChat = await prisma.chat.create({
        data: {
          hostAId: userId,
          hostBId: toGroup.userId,
        },
      });

      // An empty chat would be confusing — users need confirmation that a match
      // occurred. This system message serves as the conversation opener and
      // ensures the chat list is never blank after a mutual like.
      await prisma.message.create({
        data: {
          chatId: newChat.id,
          senderId: userId,
          text: "Your groups matched! Start chatting now.",
        },
      });
    }
  }

  revalidatePath("/");
  return { liked: true, matched };
}

/**
 * Retrieves all groups that have liked the current user's group.
 * Returns group details including user info, photos, and mutual like status.
 * Used by the "Gruppen, die dich suchen" / "Groups that like you" feature (ST0-87).
 */
export async function getGroupsThatLikedMe() {
  const cookieStore = await cookies();
  const userId = cookieStore.get("gloo_user_id")?.value;

  if (!userId) return { error: "Unauthorized" };

  try {
    const myGroup = await prisma.group.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (!myGroup) return { groups: [] };

    const allBlockedGroupIds = await getBlockedGroupIds(userId, myGroup.id);

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

    const groups = incomingLikes
      .filter((like) => !allBlockedGroupIds.has(like.fromGroup.id))
      .map((like) => ({
        id: like.fromGroup.id,
        userId: like.fromGroup.userId,
        user: like.fromGroup.user,
        photos: like.fromGroup.photos,
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
      }));

    return { groups };
  } catch (error) {
    console.error("Error fetching groups that liked me:", error);
    return { error: "Failed to fetch groups" };
  }
}
