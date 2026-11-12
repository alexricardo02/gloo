#!/usr/bin/env node
/**
 * Manually deletes pre-parties that ended more than
 * EXPIRED_EVENT_RETENTION_HOURS ago (and their attendance requests), and
 * venue marks older than VENUE_ATTENDANCE_RETENTION_DAYS. EVENT_ACCESS chats
 * are kept. The app also does this opportunistically.
 *
 *   node scripts/cleanup-expired-events.mjs            # uses DATABASE_URL (.env)
 *   node scripts/cleanup-expired-events.mjs --dry-run  # only counts
 *
 * Requires Node >= 22.18 (imports the TypeScript helper via type stripping).
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const {
  cleanupExpiredEvents,
  cleanupOldVenueAttendance,
  venueAttendanceCutoff,
  EXPIRED_EVENT_RETENTION_HOURS,
  MAX_EVENT_HOURS,
  VENUE_ATTENDANCE_RETENTION_DAYS,
} = await import(
  "../lib/eventRetention.ts"
);

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[retention] DATABASE_URL is not set.");
  process.exit(1);
}
const { host, pathname } = new URL(url);
console.log(
  `[retention] Target: ${host}${pathname} (events: ${EXPIRED_EVENT_RETENTION_HOURS} h, venue marks: ${VENUE_ATTENDANCE_RETENTION_DAYS} days)`,
);

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
try {
  if (process.argv.includes("--dry-run")) {
    const now = Date.now();
    const endedBefore = new Date(now - EXPIRED_EVENT_RETENTION_HOURS * 3600_000);
    const count = await prisma.event.count({
      where: {
        OR: [
          { endTime: { lt: endedBefore } },
          { endTime: null, createdAt: { lt: new Date(endedBefore.getTime() - MAX_EVENT_HOURS * 3600_000) } },
        ],
      },
    });
    const marks = await prisma.venueAttendance.count({ where: { night: { lt: venueAttendanceCutoff() } } });
    console.log(`[retention] Dry run: ${count} event(s) and ${marks} venue mark(s) would be deleted.`);
  } else {
    const count = await cleanupExpiredEvents(prisma);
    const marks = await cleanupOldVenueAttendance(prisma);
    console.log(`[retention] Deleted ${count} expired event(s) and ${marks} old venue mark(s).`);
  }
} finally {
  await prisma.$disconnect();
}
