-- Supabase Storage lockdown for Gloo (Pack 3: WRITER=server-service-role,
-- BUCKET_ACCESS=public).
--
-- DO NOT RUN THIS UNTIL the version of the app that uploads/deletes with
-- SUPABASE_SERVICE_ROLE_KEY (lib/storage.ts) is deployed. The old app writes
-- with the anon key, so applying this first breaks photo uploads for users.
--
-- Target state:
--   * Objects are publicly READABLE through the public URL endpoint
--     (/storage/v1/object/public/...), because the bucket is public.
--   * The anon and authenticated roles can NOT insert, update, delete or list
--     objects: there are no storage.objects policies for this bucket at all.
--     RLS on storage.objects is enabled by Supabase, so "no policy" = "deny".
--   * Only the service role writes. It bypasses RLS, so it needs no policy.
--
-- Order: run step 1, review its output, then steps 2-4, then step 5 to verify.
-- Run in the Supabase dashboard -> SQL Editor, once per bucket
-- (production "gloo-images" and the dev bucket, e.g. "gloo-images-dev").
-- Replace 'gloo-images' below when running it for another bucket.


-- ── Step 1: inspect the existing policies on storage.objects ─────────────────
-- Any policy that grants anon/authenticated (or "public") INSERT, UPDATE,
-- DELETE or SELECT on this bucket is what made anonymous writes possible (S7).
-- Note the policy names for step 3.
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
ORDER BY policyname;


-- ── Step 2: bucket settings ──────────────────────────────────────────────────
-- public = true: objects are served by the public URL endpoint without RLS
--   (the app stores object keys and builds these URLs on read).
-- file_size_limit: 5 MB, the same cap as lib/validateImage.ts.
-- allowed_mime_types: the server re-encodes every upload to WebP
--   (lib/imageProcessing.ts), so nothing else is ever written. Existing
--   JPEG/PNG objects stay readable; this only applies to new uploads.
UPDATE storage.buckets
SET public = true,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/webp']
WHERE id = 'gloo-images';


-- ── Step 3: drop every policy that grants access to this bucket ──────────────
-- Use the names from step 1. Typical names created by the dashboard look like
-- "Public Access", "Allow uploads", "Give anon users access to JPG images in
-- folder 1oj01fe_0". Repeat one line per policy that mentions this bucket.
-- (Policies for OTHER buckets must be kept.)
--
-- DROP POLICY IF EXISTS "<policy name from step 1>" ON storage.objects;


-- ── Step 4: do NOT create replacement policies ───────────────────────────────
-- Intentionally empty. Public reads go through the public endpoint, which does
-- not consult RLS for public buckets, so no SELECT policy is needed (and
-- without one, anon/authenticated clients also cannot LIST the bucket, which
-- prevents enumerating every user's photos).
-- Writes: the service role bypasses RLS; anon/authenticated get no policy.


-- ── Step 5: verify ───────────────────────────────────────────────────────────
-- Expect: zero rows mentioning this bucket.
SELECT policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND ((coalesce(qual, '') || coalesce(with_check, '')) ILIKE '%gloo-images%'
       -- also flags policies not scoped to any bucket (they would apply here too)
       OR (coalesce(qual, '') || coalesce(with_check, '')) NOT ILIKE '%bucket_id%');
-- Expect: public = true, file_size_limit = 5242880, allowed_mime_types = {image/webp}.
SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'gloo-images';
--
-- Manual check from a terminal (should FAIL with 400/403 "new row violates
-- row-level security policy" or "Unauthorized"):
--   curl -X POST "https://<ref>.supabase.co/storage/v1/object/gloo-images/groups/test/probe.webp" \
--     -H "apikey: <ANON KEY>" -H "Authorization: Bearer <ANON KEY>" \
--     -H "Content-Type: image/webp" --data-binary "probe"
-- And a public read of an existing photo URL should still return 200.
