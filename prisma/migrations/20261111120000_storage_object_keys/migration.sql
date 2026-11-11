-- Storage object keys (Pack 3, DB_STORES=object-keys).
--
-- Data-only migration: no schema change. "Group"."photos" and "User"."image"
-- switch from full public URLs to object keys inside the bucket, e.g.
--   https://<ref>.supabase.co/storage/v1/object/public/gloo-images/groups/<file>
--   -> groups/<file>
-- The app builds URLs on read (lib/storage.ts toPublicUrl).
--
-- Only values that are public URLs of OUR bucket ("gloo-images") with a
-- server-generated filename are converted. Everything else (external URLs
-- such as images.unsplash.com, local "/images/..." assets, other buckets,
-- URLs with query strings) is left untouched. Objects are not moved.
-- Idempotent: converted keys no longer match the pattern.
-- Keep the pattern in sync with keyFromBucketPublicUrl() in lib/storageKeys.ts.

UPDATE "Group" AS g
SET "photos" = converted.photos
FROM (
  SELECT g2."id",
         array_agg(
           regexp_replace(
             t.photo,
             '^https://[a-z0-9]+[.]supabase[.]co/storage/v1/object/public/gloo-images/((?:groups|profiles)/[A-Za-z0-9_-]+[.](?:webp|jpe?g|png|gif))$',
             '\1'
           )
           ORDER BY t.ord
         ) AS photos
  FROM "Group" AS g2
  CROSS JOIN LATERAL unnest(g2."photos") WITH ORDINALITY AS t(photo, ord)
  GROUP BY g2."id"
) AS converted
WHERE g."id" = converted."id"
  AND g."photos" IS DISTINCT FROM converted.photos;

UPDATE "User"
SET "image" = regexp_replace(
  "image",
  '^https://[a-z0-9]+[.]supabase[.]co/storage/v1/object/public/gloo-images/((?:groups|profiles)/[A-Za-z0-9_-]+[.](?:webp|jpe?g|png|gif))$',
  '\1'
)
WHERE "image" ~ '^https://[a-z0-9]+[.]supabase[.]co/storage/v1/object/public/gloo-images/((?:groups|profiles)/[A-Za-z0-9_-]+[.](?:webp|jpe?g|png|gif))$';
