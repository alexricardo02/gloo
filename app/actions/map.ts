"use server";

/**
 * Map writes (Pack 7). Reads are served by GET /api/map (lib/mapData.ts).
 *
 * Every action returns an ActionResult; the client maps `messageKey ?? code`
 * to Map.errors.* (lib/actionErrors.ts). messageKeys used here:
 *   groupRequired, activePartyExists, partyNotFound, partyEnded, ownParty,
 *   alreadyRequested, requestRejected, requestNotPending.
 */

import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/session";
import { type ActionResult, fail, ok } from "@/lib/actionResult";
import { checkRateLimit } from "@/lib/rateLimit";
import { isBlockedPair } from "@/lib/blocks";
import { ChatCreationError, ensureChat } from "@/lib/chats";
import { maskedCenter } from "@/lib/eventMask";
import { nightOf } from "@/lib/venueNight";
import { maybeCleanupExpiredEvents } from "@/lib/eventRetention";
import { PREPARTY_MAX_HOURS } from "@/lib/mapConfig";

const idSchema = z.string().min(1).max(64);
const HOUR_MS = 60 * 60 * 1000;

/** DURATION_INPUT = hour-chips (1, 2, 3, 4, 6, 8); the server accepts any whole hour 1..8. */
export type PrePartyDurationHours = number;

const startPrePartyInput = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  description: z.string().trim().max(280).optional().default(""),
  durationHours: z.number().int().min(1).max(PREPARTY_MAX_HOURS),
});

async function sessionUserId(): Promise<string | null> {
  try {
    return await requireUserId();
  } catch {
    return null;
  }
}

async function myGroupId(userId: string): Promise<string | null> {
  const group = await prisma.group.findUnique({ where: { userId }, select: { id: true } });
  return group?.id ?? null;
}

// ── Venues (B10) ───────────────────────────────────────────────────────────

/**
 * Marks / unmarks "we're going here tonight". One venue per group per night
 * (unique groupId + night): choosing another venue moves the mark. Read and
 * write happen in one transaction.
 */
export async function toggleVenueAttendance(venueId: string): Promise<ActionResult<{ attending: boolean }>> {
  const userId = await sessionUserId();
  if (!userId) return fail("UNAUTHORIZED");
  if (!idSchema.safeParse(venueId).success) return fail("VALIDATION");

  try {
    const groupId = await myGroupId(userId);
    if (!groupId) return fail("NOT_FOUND", "groupRequired");

    const night = nightOf();
    return await prisma.$transaction(async (tx): Promise<ActionResult<{ attending: boolean }>> => {
      const existing = await tx.venueAttendance.findUnique({
        where: { groupId_night: { groupId, night } },
        select: { id: true, venueId: true },
      });
      if (existing?.venueId === venueId) {
        await tx.venueAttendance.delete({ where: { id: existing.id } });
        return ok({ attending: false });
      }

      const venue = await tx.venue.findUnique({ where: { id: venueId }, select: { id: true } });
      if (!venue) return fail("NOT_FOUND");

      await tx.venueAttendance.upsert({
        where: { groupId_night: { groupId, night } },
        create: { groupId, venueId, night },
        update: { venueId, createdAt: new Date() },
      });
      return ok({ attending: true });
    });
  } catch (error) {
    console.error("Error toggling venue attendance:", error);
    return fail("INTERNAL");
  }
}

// ── Pre-parties (S3, D7) ───────────────────────────────────────────────────

/**
 * Starts a pre-party at the given point for `durationHours` (1..8).
 * MAX_ACTIVE_PREPARTIES_PER_GROUP = 1 (per host, serialized with an advisory
 * lock). The exact point is stored for the host and accepted groups; the
 * masked center is computed once here (lib/eventMask.ts).
 */
export async function startPreParty(input: {
  latitude: number;
  longitude: number;
  description?: string;
  durationHours: PrePartyDurationHours;
}): Promise<ActionResult<{ id: string; endTime: string }>> {
  const userId = await sessionUserId();
  if (!userId) return fail("UNAUTHORIZED");

  const parsed = startPrePartyInput.safeParse(input);
  if (!parsed.success) return fail("VALIDATION");
  const { latitude, longitude, description, durationHours } = parsed.data;

  try {
    if (!(await myGroupId(userId))) return fail("NOT_FOUND", "groupRequired");
    maybeCleanupExpiredEvents(prisma);

    return await prisma.$transaction(async (tx): Promise<ActionResult<{ id: string; endTime: string }>> => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`event-owner:${userId}`}, 0))`;

      const now = new Date();
      const active = await tx.event.findFirst({
        where: { ownerId: userId, endTime: { gt: now } },
        select: { id: true },
      });
      if (active) return fail("FORBIDDEN", "activePartyExists");

      const [maskedLatitude, maskedLongitude] = maskedCenter(latitude, longitude);
      const event = await tx.event.create({
        data: {
          description: description || null,
          latitude,
          longitude,
          maskedLatitude,
          maskedLongitude,
          startTime: now,
          endTime: new Date(now.getTime() + durationHours * HOUR_MS),
          ownerId: userId,
        },
        select: { id: true, endTime: true },
      });
      return ok({ id: event.id, endTime: event.endTime!.toISOString() });
    });
  } catch (error) {
    console.error("Error starting pre-party:", error);
    return fail("INTERNAL");
  }
}

/**
 * HOST_CAN_END_EARLY = yes: "end now". Sets the end time of the caller's
 * active pre-party to now; it leaves the map on the next refresh and its
 * pending requests can no longer be answered. Only ever touches the caller's
 * own events.
 */
export async function stopPreParty(): Promise<ActionResult> {
  const userId = await sessionUserId();
  if (!userId) return fail("UNAUTHORIZED");

  try {
    const now = new Date();
    const { count } = await prisma.event.updateMany({
      where: { ownerId: userId, endTime: { gt: now } },
      data: { endTime: now },
    });
    return count > 0 ? ok() : fail("NOT_FOUND", "partyEnded");
  } catch (error) {
    console.error("Error ending pre-party:", error);
    return fail("INTERNAL");
  }
}

// ── Access requests (B8, B9) ───────────────────────────────────────────────

type EventCheck = { ok: true; ownerId: string } | { ok: false; result: ActionResult<never> };

/** The event must exist, be active, not be mine and not involve a blocked pair. */
async function checkRequestableEvent(tx: Prisma.TransactionClient, eventId: string, userId: string): Promise<EventCheck> {
  const event = await tx.event.findUnique({ where: { id: eventId }, select: { ownerId: true, endTime: true } });
  if (!event) return { ok: false, result: fail("NOT_FOUND", "partyNotFound") };
  if (!event.endTime || event.endTime <= new Date()) return { ok: false, result: fail("NOT_FOUND", "partyEnded") };
  if (event.ownerId === userId) return { ok: false, result: fail("FORBIDDEN", "ownParty") };
  // A block is indistinguishable from a missing event.
  if (await isBlockedPair(userId, event.ownerId, tx)) return { ok: false, result: fail("NOT_FOUND", "partyNotFound") };
  return { ok: true, ownerId: event.ownerId };
}

/**
 * Asks the host for access. Allowed once per group and event: an existing
 * PENDING/ACCEPTED request is "alreadyRequested", a REJECTED one stays
 * rejected (the host decided), a CANCELLED one is reopened. Rate limited per
 * group.
 */
export async function requestEventAttendance(eventId: string): Promise<ActionResult<{ status: "PENDING" }>> {
  const userId = await sessionUserId();
  if (!userId) return fail("UNAUTHORIZED");
  if (!idSchema.safeParse(eventId).success) return fail("VALIDATION");

  try {
    const groupId = await myGroupId(userId);
    if (!groupId) return fail("NOT_FOUND", "groupRequired");
    if (!(await checkRateLimit("eventRequest", { identifier: groupId }))) return fail("RATE_LIMITED");

    return await prisma.$transaction(async (tx): Promise<ActionResult<{ status: "PENDING" }>> => {
      const check = await checkRequestableEvent(tx, eventId, userId);
      if (!check.ok) return check.result;

      const existing = await tx.eventAttendance.findUnique({
        where: { groupId_eventId: { groupId, eventId } },
        select: { id: true, status: true },
      });
      if (existing?.status === "PENDING" || existing?.status === "ACCEPTED") {
        return fail("FORBIDDEN", "alreadyRequested");
      }
      if (existing?.status === "REJECTED") return fail("FORBIDDEN", "requestRejected");

      if (existing) {
        await tx.eventAttendance.update({
          where: { id: existing.id },
          data: { status: "PENDING", createdAt: new Date() },
        });
      } else {
        await tx.eventAttendance.create({ data: { groupId, eventId, status: "PENDING" } });
      }
      return ok({ status: "PENDING" as const });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return fail("FORBIDDEN", "alreadyRequested"); // concurrent duplicate request
    }
    console.error("Error requesting event access:", error);
    return fail("INTERNAL");
  }
}

/** REQUESTER_CAN_CANCEL = yes: withdraws my group's PENDING request. */
export async function cancelEventRequest(eventId: string): Promise<ActionResult> {
  const userId = await sessionUserId();
  if (!userId) return fail("UNAUTHORIZED");
  if (!idSchema.safeParse(eventId).success) return fail("VALIDATION");

  try {
    const groupId = await myGroupId(userId);
    if (!groupId) return fail("NOT_FOUND", "groupRequired");
    const { count } = await prisma.eventAttendance.updateMany({
      where: { groupId, eventId, status: "PENDING" },
      data: { status: "CANCELLED" },
    });
    return count > 0 ? ok() : fail("NOT_FOUND", "requestNotPending");
  } catch (error) {
    console.error("Error cancelling event request:", error);
    return fail("INTERNAL");
  }
}

/**
 * The host accepts or rejects a PENDING request of an active event.
 *
 * ON_ACCEPT = open-chat: the status change and ensureChat(host group,
 * requester group, "EVENT_ACCESS") commit in ONE transaction; the accepted
 * group then gets the exact location from GET /api/map. Two concurrent
 * accepts: the second finds the request no longer PENDING (row lock), and the
 * chat is unique per host pair, so exactly one chat exists.
 * ON_REJECT = show-not-accepted: status REJECTED, shown to the requester.
 */
export async function respondToEventRequest(
  attendanceId: string,
  accept: boolean,
): Promise<ActionResult<{ status: "ACCEPTED" | "REJECTED"; chatId: string | null }>> {
  const userId = await sessionUserId();
  if (!userId) return fail("UNAUTHORIZED");
  if (!idSchema.safeParse(attendanceId).success || typeof accept !== "boolean") return fail("VALIDATION");

  type Result = ActionResult<{ status: "ACCEPTED" | "REJECTED"; chatId: string | null }>;
  try {
    return await prisma.$transaction(async (tx): Promise<Result> => {
      const attendance = await tx.eventAttendance.findUnique({
        where: { id: attendanceId },
        select: {
          status: true,
          groupId: true,
          group: { select: { userId: true } },
          event: { select: { ownerId: true, endTime: true } },
        },
      });
      // Only the host may see that the request exists.
      if (!attendance || attendance.event.ownerId !== userId) return fail("NOT_FOUND");
      if (!attendance.event.endTime || attendance.event.endTime <= new Date()) return fail("FORBIDDEN", "partyEnded");
      if (attendance.status !== "PENDING") return fail("FORBIDDEN", "requestNotPending");
      if (await isBlockedPair(userId, attendance.group.userId, tx)) return fail("NOT_FOUND");

      const status = accept ? "ACCEPTED" : "REJECTED";
      const { count } = await tx.eventAttendance.updateMany({
        where: { id: attendanceId, status: "PENDING" },
        data: { status },
      });
      if (count === 0) return fail("FORBIDDEN", "requestNotPending");
      if (!accept) return ok({ status: "REJECTED" as const, chatId: null });

      const hostGroup = await tx.group.findUnique({ where: { userId }, select: { id: true } });
      if (!hostGroup) throw new ChatCreationError("GROUP_NOT_FOUND");
      const chatId = await ensureChat(hostGroup.id, attendance.groupId, "EVENT_ACCESS", tx);
      return ok({ status: "ACCEPTED" as const, chatId });
    });
  } catch (error) {
    if (error instanceof ChatCreationError) {
      return fail("NOT_FOUND", error.reason === "GROUP_NOT_FOUND" ? "groupRequired" : undefined);
    }
    console.error("Error responding to event request:", error);
    return fail("INTERNAL");
  }
}
