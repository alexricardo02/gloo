import type { PrismaClient } from "@prisma/client";

/**
 * EXPIRED_EVENT_RETENTION_HOURS = 24: pre-parties (and, by ON DELETE CASCADE,
 * their attendance requests) are deleted once they ended more than 24 hours
 * ago. Events without an end time count as ended MAX_EVENT_HOURS after
 * creation. Chats created via EVENT_ACCESS are not related to events and are
 * never touched.
 *
 * Venue marks ("going here tonight") are a history of where groups went:
 * VENUE_ATTENDANCE_RETENTION_DAYS = 30, marks whose night is more than 30
 * days before today (UTC date) are deleted by the same routine.
 *
 * No scheduler exists, so the app runs this opportunistically
 * (maybeCleanupExpiredEvents: at most once per CLEANUP_INTERVAL_MS per server
 * process, fire-and-forget, when GET /api/map is served or a pre-party is
 * created). scripts/cleanup-expired-events.mjs runs it manually.
 *
 * No path aliases here: the script imports this file directly with Node.
 */

export const EXPIRED_EVENT_RETENTION_HOURS = 24;
/** Same as PREPARTY_MAX_HOURS in lib/mapConfig.ts (no alias imports in this file). */
export const MAX_EVENT_HOURS = 8;
export const VENUE_ATTENDANCE_RETENTION_DAYS = 30;
export const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

const HOUR_MS = 60 * 60 * 1000;

type Db = Pick<PrismaClient, "event" | "venueAttendance">;

export async function cleanupExpiredEvents(
  db: Db,
  now: Date = new Date(),
  retentionHours: number = EXPIRED_EVENT_RETENTION_HOURS,
): Promise<number> {
  const endedBefore = new Date(now.getTime() - retentionHours * HOUR_MS);
  const createdBefore = new Date(endedBefore.getTime() - MAX_EVENT_HOURS * HOUR_MS);
  const { count } = await db.event.deleteMany({
    where: {
      OR: [{ endTime: { lt: endedBefore } }, { endTime: null, createdAt: { lt: createdBefore } }],
    },
  });
  return count;
}

/** First night that is still kept: today's UTC date minus `retentionDays`. */
export function venueAttendanceCutoff(now: Date = new Date(), retentionDays: number = VENUE_ATTENDANCE_RETENTION_DAYS): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - retentionDays));
}

export async function cleanupOldVenueAttendance(
  db: Pick<PrismaClient, "venueAttendance">,
  now: Date = new Date(),
  retentionDays: number = VENUE_ATTENDANCE_RETENTION_DAYS,
): Promise<number> {
  const { count } = await db.venueAttendance.deleteMany({
    where: { night: { lt: venueAttendanceCutoff(now, retentionDays) } },
  });
  return count;
}

let lastRunAt = 0;

/** Runs both cleanups in the background at most once per CLEANUP_INTERVAL_MS. Never throws, never awaits. */
export function maybeCleanupExpiredEvents(db: Db, now: Date = new Date()): void {
  if (now.getTime() - lastRunAt < CLEANUP_INTERVAL_MS) return;
  lastRunAt = now.getTime();
  cleanupExpiredEvents(db, now).catch((error) => {
    console.error("[retention] Expired event cleanup failed:", error);
  });
  cleanupOldVenueAttendance(db, now).catch((error) => {
    console.error("[retention] Venue attendance cleanup failed:", error);
  });
}

/** Test helper. */
export function resetEventCleanupForTests(): void {
  lastRunAt = 0;
}
