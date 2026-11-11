-- Read-only preview for the storage_object_keys migration: how many rows and
-- values it would convert, and which stored values it leaves untouched.
-- Read-only (SELECTs only). Run with psql so the results are printed:
--   docker exec -i gloo-db psql -U party_admin -d gloo_db < docs/storage-object-keys-preview.sql
\set re '''^https://[a-z0-9]+[.]supabase[.]co/storage/v1/object/public/gloo-images/((?:groups|profiles)/[A-Za-z0-9_-]+[.](?:webp|jpe?g|png|gif))$'''
SELECT 'Group rows to update' AS what, count(DISTINCT g."id") AS n
  FROM "Group" g, unnest(g."photos") p WHERE p ~ :re
UNION ALL
SELECT 'Group photo values to convert', count(*) FROM "Group" g, unnest(g."photos") p WHERE p ~ :re
UNION ALL
SELECT 'User rows to update', count(*) FROM "User" WHERE "image" ~ :re;

SELECT 'Group.photos' AS source, p AS untouched_value, count(*) AS n
  FROM "Group" g, unnest(g."photos") p
 WHERE p !~ :re AND p !~ '^(groups|users|profiles)/'
 GROUP BY p
UNION ALL
SELECT 'User.image', "image", count(*) FROM "User"
 WHERE "image" IS NOT NULL AND "image" !~ :re AND "image" !~ '^(groups|users|profiles)/'
 GROUP BY "image"
ORDER BY 1, 3 DESC;
