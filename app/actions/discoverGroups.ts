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
import { isBlockedPair } from "@/lib/blocks";
import { ensureChat, findChatBetween, lockPair } from "@/lib/chats";
import { type ActionResult, fail, ok } from "@/lib/actionResult";
import { clampDistanceKm } from "@/lib/geo";
import { InvalidDiscoveryCursorError, queryDiscoveryPage } from "@/lib/discovery";
import { DISCOVERY_TEASER } from "@/lib/discoveryTeaser";
import type { DiscoveryFeedPage } from "@/lib/apiTypes";

const discoveryInput = z.object({
  cursor: z.string().min(1).max(512).optional(),
  // Clamped, not rejected: getDiscoveryGroups({ distance: 20000 }) searches MAX_DISTANCE_KM.
  distance: z.number().finite().transform(clampDistanceKm),
});

export type DiscoveryResult = ActionResult<DiscoveryFeedPage>;

/**
 * Discovery feed (see lib/discovery.ts for the query).
 *
 * All filtering runs in one parameterized PostgreSQL query: bounding box,
 * exact haversine distance (lib/geo.ts), age and gender preferences in both
 * directions, publicProfile, own group and blocked pairs excluded. Results
 * are ordered nearest first with keyset pagination; groups I already liked
 * stay in the feed with `likedByMe: true`.
 *
 * Privacy (S4): cards carry a distance rounded to whole km, never
 * coordinates or user ids. Guests and signed-in users without a group get
 * `{ hasNoGroup: true, teaser }` with static placeholder cards only (D5).
 *
 * @param input.distance - search radius in km, clamped to 1..MAX_DISTANCE_KM.
 * @param input.cursor - opaque `nextCursor` of the previous page.
 * @returns VALIDATION for a malformed distance or an invalid/stale cursor.
 */
export async function getDiscoveryGroups(input: { cursor?: string; distance: number }): Promise<DiscoveryResult> {
  const parsed = discoveryInput.safeParse(input);
  if (!parsed.success) return fail("VALIDATION");
  const { cursor, distance } = parsed.data;

  const teaser = () => ok<DiscoveryFeedPage>({ hasNoGroup: true, teaser: [...DISCOVERY_TEASER] });

  try {
    const userId = await getOptionalUserId();
    if (!userId) return teaser();

    const myGroup = await prisma.group.findUnique({
      where: { userId },
      select: {
        id: true,
        latitude: true,
        longitude: true,
        gender: true,
        searchGender: true,
        ageMin: true,
        ageMax: true,
        searchAgeMin: true,
        searchAgeMax: true,
      },
    });
    if (!myGroup) return teaser();
    if (myGroup.latitude === null || myGroup.longitude === null) {
      return ok<DiscoveryFeedPage>({ hasNoGroup: false, groups: [], nextCursor: null });
    }

    const page = await queryDiscoveryPage(
      {
        userId,
        groupId: myGroup.id,
        latitude: myGroup.latitude,
        longitude: myGroup.longitude,
        gender: myGroup.gender,
        searchGender: myGroup.searchGender,
        ageMin: myGroup.ageMin,
        ageMax: myGroup.ageMax,
        searchAgeMin: myGroup.searchAgeMin,
        searchAgeMax: myGroup.searchAgeMax,
      },
      distance,
      cursor,
    );
    return ok<DiscoveryFeedPage>({ hasNoGroup: false, ...page });
  } catch (error) {
    if (error instanceof InvalidDiscoveryCursorError) return fail("VALIDATION", "staleCursor");
    console.error("Critical error in getDiscoveryGroups:", error);
    return fail("INTERNAL");
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

