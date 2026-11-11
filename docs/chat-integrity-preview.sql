-- Read-only preview for migration 20261111130000_chat_origin_and_system_messages:
-- how many rows each step would change. Run it BEFORE the migration (it only
-- uses columns that exist before and after). SELECTs only. Run with psql:
--   docker exec -i gloo-db psql -U party_admin -d gloo_db < docs/chat-integrity-preview.sql
WITH pair AS (
  SELECT c.*,
         LEAST(c."hostAId" COLLATE "C", c."hostBId" COLLATE "C") AS lo,
         GREATEST(c."hostAId" COLLATE "C", c."hostBId" COLLATE "C") AS hi,
         row_number() OVER (
           PARTITION BY LEAST(c."hostAId" COLLATE "C", c."hostBId" COLLATE "C"),
                        GREATEST(c."hostAId" COLLATE "C", c."hostBId" COLLATE "C")
           ORDER BY c."createdAt", c."id" COLLATE "C"
         ) AS rn
  FROM "Chat" c
),
mutual AS (
  SELECT p."id"
  FROM pair p
  WHERE EXISTS (
    SELECT 1
    FROM "Group" ga
    JOIN "Group" gb ON gb."userId" = p."hostBId" AND gb."id" <> ga."id"
    JOIN "GroupLike" l1 ON l1."fromGroupId" = ga."id" AND l1."toGroupId" = gb."id"
    JOIN "GroupLike" l2 ON l2."fromGroupId" = gb."id" AND l2."toGroupId" = ga."id"
    WHERE ga."userId" = p."hostAId"
  )
)
SELECT '0. chats total' AS step, count(*) AS n FROM pair
UNION ALL SELECT '1. classified MATCH (mutual like)', count(*) FROM mutual
UNION ALL SELECT '1. classified LEGACY', (SELECT count(*) FROM pair) - (SELECT count(*) FROM mutual)
UNION ALL SELECT '2. duplicate pairs (unordered) with >1 chat', count(*) FROM (SELECT lo, hi FROM pair GROUP BY lo, hi HAVING count(*) > 1) d
UNION ALL SELECT '2. duplicate chats to empty + DELETE', count(*) FROM pair WHERE rn > 1
UNION ALL SELECT '2. messages to move into the oldest chat', count(*) FROM "Message" m JOIN pair p ON p."id" = m."chatId" WHERE p.rn > 1
UNION ALL SELECT '3. chats to reorder (hostAId > hostBId)', count(*) FROM pair WHERE "hostAId" COLLATE "C" > "hostBId" COLLATE "C"
UNION ALL SELECT '   self-chats kept as LEGACY (hostAId = hostBId)', count(*) FROM pair WHERE "hostAId" = "hostBId"
UNION ALL SELECT '5. old English match messages (total)', count(*) FROM "Message" WHERE "text" = 'Your groups matched! Start chatting now.'
UNION ALL SELECT '5. ... converted to SYSTEM notice (1 per chat after merge)', count(DISTINCT p.lo || ':' || p.hi)
  FROM "Message" m JOIN pair p ON p."id" = m."chatId" WHERE m."text" = 'Your groups matched! Start chatting now.'
UNION ALL SELECT '5. ... extra copies to DELETE', (
    SELECT count(*) FROM "Message" WHERE "text" = 'Your groups matched! Start chatting now.'
  ) - (
    SELECT count(DISTINCT p.lo || ':' || p.hi)
    FROM "Message" m JOIN pair p ON p."id" = m."chatId" WHERE m."text" = 'Your groups matched! Start chatting now.'
  )
UNION ALL SELECT '   self-likes (not changed; reported only)', count(*) FROM "GroupLike" WHERE "fromGroupId" = "toGroupId";
