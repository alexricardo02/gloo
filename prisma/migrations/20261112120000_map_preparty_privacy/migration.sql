-- Pack 7: map and pre-parties (S3, B8, B10).
--
-- Data-preserving version of the generated diff (Prisma would DROP the status
-- column and add NOT NULL columns without values). Unrelated schema drift
-- (User.verificationTokenExpiry, GameScore_userId_fkey) is intentionally left out.

-- ── 1. Event: masked center (S3) ────────────────────────────────────────────
-- latitude/longitude stay the EXACT point (host + accepted groups only). The
-- masked center is the exact point moved in a random direction by a random
-- 0..500 m (MASK_RADIUS_METERS), computed ONCE. New events get it from
-- lib/eventMask.ts (node:crypto); existing rows are backfilled here from
-- gen_random_uuid() (pg_strong_random, a CSPRNG): the first 32 bits of a v4
-- UUID are random, giving u in [0, 1).
ALTER TABLE "Event" ADD COLUMN "maskedLatitude" DOUBLE PRECISION,
                    ADD COLUMN "maskedLongitude" DOUBLE PRECISION;

WITH r AS (
  SELECT "id",
         radians("latitude") AS phi1,
         radians("longitude") AS lambda1,
         2 * pi() * (('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint::float8 / 4294967296.0) AS theta,
         (500.0 * (('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint::float8 / 4294967296.0)) / 6371000.0 AS delta
    FROM "Event"
), p AS (
  SELECT "id", lambda1, theta, delta, phi1,
         asin(sin(phi1) * cos(delta) + cos(phi1) * sin(delta) * cos(theta)) AS phi2
    FROM r
)
UPDATE "Event" e
   SET "maskedLatitude" = degrees(p.phi2),
       "maskedLongitude" = ((degrees(p.lambda1 + atan2(sin(p.theta) * sin(p.delta) * cos(p.phi1),
                                                       cos(p.delta) - sin(p.phi1) * sin(p.phi2))) + 540)::numeric % 360 - 180)::double precision
  FROM p
 WHERE e."id" = p."id";

ALTER TABLE "Event" ALTER COLUMN "maskedLatitude" SET NOT NULL,
                    ALTER COLUMN "maskedLongitude" SET NOT NULL;

-- Labels are no longer written as hard-coded German text ("Vorglühen",
-- "Versteckt (Genauer Ort im Chat)"); the UI renders localized labels.
ALTER TABLE "Event" ALTER COLUMN "title" DROP NOT NULL,
                    ALTER COLUMN "locationName" DROP NOT NULL;

CREATE INDEX "Event_endTime_idx" ON "Event"("endTime");
CREATE INDEX "Event_ownerId_idx" ON "Event"("ownerId");

-- ── 2. EventAttendance.status: free text -> enum (B8) ──────────────────────
-- Case-insensitive: "Pending"/"PENDING" -> PENDING, etc. Anything unknown
-- becomes CANCELLED (grants no access).
CREATE TYPE "AttendanceStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED');

ALTER TABLE "EventAttendance" ADD COLUMN "status_new" "AttendanceStatus";

UPDATE "EventAttendance"
   SET "status_new" = CASE upper(btrim("status"))
                        WHEN 'PENDING'   THEN 'PENDING'::"AttendanceStatus"
                        WHEN 'ACCEPTED'  THEN 'ACCEPTED'::"AttendanceStatus"
                        WHEN 'REJECTED'  THEN 'REJECTED'::"AttendanceStatus"
                        WHEN 'CANCELLED' THEN 'CANCELLED'::"AttendanceStatus"
                        WHEN 'CANCELED'  THEN 'CANCELLED'::"AttendanceStatus"
                        ELSE 'CANCELLED'::"AttendanceStatus"
                      END;

ALTER TABLE "EventAttendance" DROP COLUMN "status";
ALTER TABLE "EventAttendance" RENAME COLUMN "status_new" TO "status";
ALTER TABLE "EventAttendance" ALTER COLUMN "status" SET NOT NULL,
                              ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- ── 3. VenueAttendance: per night (B10) ────────────────────────────────────
-- night = the date the night started on: a night runs from 06:00 to 06:00
-- Europe/Berlin (lib/venueNight.ts). "createdAt" is stored as UTC.
ALTER TABLE "VenueAttendance" ADD COLUMN "night" DATE;

UPDATE "VenueAttendance"
   SET "night" = ((("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Berlin') - interval '6 hours')::date;

-- One venue per group per night: keep only the newest mark if a group had
-- several in the same night (the old code allowed this only under races).
DELETE FROM "VenueAttendance" v
 USING "VenueAttendance" newer
 WHERE v."groupId" = newer."groupId"
   AND v."night" = newer."night"
   AND (v."createdAt", v."id") < (newer."createdAt", newer."id");

ALTER TABLE "VenueAttendance" ALTER COLUMN "night" SET NOT NULL;

DROP INDEX "VenueAttendance_groupId_venueId_key";
CREATE UNIQUE INDEX "VenueAttendance_groupId_night_key" ON "VenueAttendance"("groupId", "night");
CREATE INDEX "VenueAttendance_venueId_night_idx" ON "VenueAttendance"("venueId", "night");
