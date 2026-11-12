-- Pack 5: per-participant read tracking on Chat (READ_TRACKING = columns-on-chat).
--
-- A message is unread for a host when it was not sent by that host and was
-- created after that host's "*LastReadAt". The columns are only ever exposed
-- to their own host (READ_RECEIPTS = no).
--
-- NOTE: `prisma migrate dev` also proposed unrelated statements for
-- pre-existing drift between the migration history and schema.prisma
-- ("User"."verificationTokenExpiry", the "GameScore_userId_fkey" ON DELETE
-- rule). They were removed on purpose; see the Pack 5 notes.

ALTER TABLE "Chat" ADD COLUMN IF NOT EXISTS "hostALastReadAt" TIMESTAMP(3),
                   ADD COLUMN IF NOT EXISTS "hostBLastReadAt" TIMESTAMP(3);

-- Baseline: there was no read tracking before, so everything that already
-- exists counts as read. Without this, every existing chat would show as
-- unread right after the deploy. Only the two new columns are written.
UPDATE "Chat"
   SET "hostALastReadAt" = COALESCE("hostALastReadAt", CURRENT_TIMESTAMP),
       "hostBLastReadAt" = COALESCE("hostBLastReadAt", CURRENT_TIMESTAMP)
 WHERE "hostALastReadAt" IS NULL OR "hostBLastReadAt" IS NULL;
