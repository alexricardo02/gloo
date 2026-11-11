-- Chat integrity (Pack 4): chat origin, canonical host pairs, system messages.
--
-- Schema: enums ChatOrigin / MessageType / SystemMessageKey, "Chat"."origin",
-- "Message"."type" / "Message"."systemKey", one notice of each kind per chat.
--
-- Data, in this order:
--   1. Classify chats: MATCH if the two hosts' groups like each other, else LEGACY.
--   2. Merge duplicate pairs ((A,B) + (B,A)) into the OLDEST chat: messages are
--      moved, then the emptied duplicate chat rows are deleted.
--   3. Store every pair canonically: "hostAId" < "hostBId" (byte order).
--   4. Enforce it with a CHECK; the existing unique index on
--      ("hostAId", "hostBId") then makes each unordered pair unique.
--   5. Convert the old hard-coded English match message into a SYSTEM notice
--      (senderId NULL, systemKey MATCH_CREATED). If a chat has several copies
--      (merged duplicates), the earliest is converted and the extra copies are
--      deleted. Their text is left as is; the UI renders the systemKey.
--
-- Only rows the steps describe are touched; no user-written message is deleted.
-- Self-chats (hostAId = hostBId, from the old self-like bug) are kept as LEGACY.
--
-- Idempotent: types/columns/indexes/constraints are created only if missing,
-- step 1 only upgrades LEGACY -> MATCH, and steps 2/3/5 find nothing to do on
-- a second run. All comparisons of ids use COLLATE "C" so the database and
-- lib/chats.ts (JavaScript string comparison) agree on the canonical order.
-- Preview the affected rows read-only with docs/chat-integrity-preview.sql.

-- ── Types ────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "ChatOrigin" AS ENUM ('MATCH', 'EVENT_ACCESS', 'LEGACY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "MessageType" AS ENUM ('USER', 'SYSTEM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SystemMessageKey" AS ENUM ('MATCH_CREATED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Columns ──────────────────────────────────────────────────────────────
-- Temporary default so existing chats start as LEGACY; dropped at the end
-- (the app must always state the origin explicitly).
ALTER TABLE "Chat" ADD COLUMN IF NOT EXISTS "origin" "ChatOrigin" NOT NULL DEFAULT 'LEGACY';
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "type" "MessageType" NOT NULL DEFAULT 'USER';
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "systemKey" "SystemMessageKey";

-- ── 1. Classify ──────────────────────────────────────────────────────────
UPDATE "Chat" AS c
SET "origin" = 'MATCH'
WHERE c."origin" = 'LEGACY'
  AND EXISTS (
    SELECT 1
    FROM "Group" AS ga
    JOIN "Group" AS gb ON gb."userId" = c."hostBId" AND gb."id" <> ga."id"
    JOIN "GroupLike" AS l1 ON l1."fromGroupId" = ga."id" AND l1."toGroupId" = gb."id"
    JOIN "GroupLike" AS l2 ON l2."fromGroupId" = gb."id" AND l2."toGroupId" = ga."id"
    WHERE ga."userId" = c."hostAId"
  );

-- ── 2. Merge duplicate pairs into the oldest chat ────────────────────────
WITH ranked AS (
  SELECT "id",
         first_value("id") OVER w AS keeper_id,
         row_number() OVER w AS rn
  FROM "Chat"
  WINDOW w AS (
    PARTITION BY LEAST("hostAId" COLLATE "C", "hostBId" COLLATE "C"),
                 GREATEST("hostAId" COLLATE "C", "hostBId" COLLATE "C")
    ORDER BY "createdAt", "id" COLLATE "C"
  )
)
UPDATE "Message" AS m
SET "chatId" = r.keeper_id
FROM ranked AS r
WHERE m."chatId" = r."id" AND r.rn > 1;

-- The keeper inherits the strongest origin of its pair (MATCH > EVENT_ACCESS > LEGACY).
WITH pairs AS (
  SELECT "id",
         first_value("id") OVER w AS keeper_id,
         CASE "origin" WHEN 'MATCH' THEN 3 WHEN 'EVENT_ACCESS' THEN 2 ELSE 1 END AS prio,
         "origin"
  FROM "Chat"
  WINDOW w AS (
    PARTITION BY LEAST("hostAId" COLLATE "C", "hostBId" COLLATE "C"),
                 GREATEST("hostAId" COLLATE "C", "hostBId" COLLATE "C")
    ORDER BY "createdAt", "id" COLLATE "C"
  )
),
best AS (
  SELECT DISTINCT ON (keeper_id) keeper_id, "origin"
  FROM pairs
  ORDER BY keeper_id, prio DESC
)
UPDATE "Chat" AS c
SET "origin" = b."origin"
FROM best AS b
WHERE c."id" = b.keeper_id AND c."origin" <> b."origin";

-- Delete the duplicates, which are empty now (guarded: never a chat that still has messages).
WITH ranked AS (
  SELECT "id",
         row_number() OVER (
           PARTITION BY LEAST("hostAId" COLLATE "C", "hostBId" COLLATE "C"),
                        GREATEST("hostAId" COLLATE "C", "hostBId" COLLATE "C")
           ORDER BY "createdAt", "id" COLLATE "C"
         ) AS rn
  FROM "Chat"
)
DELETE FROM "Chat" AS c
USING ranked AS r
WHERE c."id" = r."id"
  AND r.rn > 1
  AND NOT EXISTS (SELECT 1 FROM "Message" AS m WHERE m."chatId" = c."id");

-- ── 3. Canonical order ───────────────────────────────────────────────────
UPDATE "Chat"
SET "hostAId" = "hostBId", "hostBId" = "hostAId"
WHERE "hostAId" COLLATE "C" > "hostBId" COLLATE "C";

-- ── 4. Enforce the canonical, unique pair ────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "Chat_hostAId_hostBId_key" ON "Chat"("hostAId", "hostBId");

DO $$ BEGIN
  ALTER TABLE "Chat" ADD CONSTRAINT "Chat_canonical_pair_check"
    CHECK ("hostAId" COLLATE "C" <= "hostBId" COLLATE "C");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 5. Old English match messages -> SYSTEM notices ──────────────────────
WITH notices AS (
  SELECT m."id",
         row_number() OVER (PARTITION BY m."chatId" ORDER BY m."createdAt", m."id" COLLATE "C") AS rn
  FROM "Message" AS m
  WHERE m."type" = 'USER'
    AND m."text" = 'Your groups matched! Start chatting now.'
    AND NOT EXISTS (
      SELECT 1 FROM "Message" AS s
      WHERE s."chatId" = m."chatId" AND s."systemKey" = 'MATCH_CREATED'
    )
)
UPDATE "Message" AS m
SET "type" = 'SYSTEM', "systemKey" = 'MATCH_CREATED', "senderId" = NULL
FROM notices AS n
WHERE m."id" = n."id" AND n.rn = 1;

-- Extra copies of the same notice in a chat that now has its SYSTEM notice.
DELETE FROM "Message" AS m
WHERE m."type" = 'USER'
  AND m."text" = 'Your groups matched! Start chatting now.'
  AND EXISTS (
    SELECT 1 FROM "Message" AS s
    WHERE s."chatId" = m."chatId" AND s."systemKey" = 'MATCH_CREATED'
  );

CREATE UNIQUE INDEX IF NOT EXISTS "Message_chatId_systemKey_key" ON "Message"("chatId", "systemKey");

DO $$ BEGIN
  ALTER TABLE "Message" ADD CONSTRAINT "Message_system_shape_check" CHECK (
    ("type" = 'USER' AND "systemKey" IS NULL)
    OR ("type" = 'SYSTEM' AND "systemKey" IS NOT NULL AND "senderId" IS NULL)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Done: origin must be explicit from now on ────────────────────────────
ALTER TABLE "Chat" ALTER COLUMN "origin" DROP DEFAULT;
