-- Pack 5 (S2): deny-all Row Level Security on the public schema.
--
-- The app reads and writes the database only through Prisma on the server,
-- connected as the table owner. Owners bypass RLS (no FORCE ROW LEVEL
-- SECURITY here), so Prisma keeps working. Supabase's "anon" and
-- "authenticated" roles (the public anon key, PostgREST, Realtime) must not
-- see any row of any table:
--
--   1. RLS is enabled on EVERY table in "public" (including
--      _prisma_migrations), and every existing policy there is dropped, so no
--      permissive policy can let a non-owner role read a row.
--   2. All privileges on those tables and sequences are revoked from anon and
--      authenticated (defence in depth: permission denied before RLS).
--   3. Default privileges: tables/sequences created later by the role that
--      runs the migrations are not granted to anon/authenticated.
--   4. Public tables are removed from the "supabase_realtime" publication, so
--      Realtime does not stream their changes at all.
--
-- Role- and publication-specific steps only run when the role/publication
-- exists, so this also applies cleanly to plain local Postgres. Idempotent.
-- The "storage" and "realtime" schemas are not touched.
-- See docs/realtime-security.md for the design and post-deploy checks.

-- ── 1. RLS on, no policies ───────────────────────────────────────────────
DO $$
DECLARE
  t record;
  p record;
BEGIN
  FOR t IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
  END LOOP;

  FOR p IN
    SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public'
  LOOP
    RAISE NOTICE 'Dropping policy % on public.%', p.policyname, p.tablename;
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
END $$;

-- ── 2 + 3. No privileges for anon / authenticated, now or later ──────────
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
    END IF;
  END LOOP;
END $$;

-- ── 4. Stop streaming public tables over Supabase Realtime ───────────────
DO $$
DECLARE
  t record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOR t IN
      SELECT tablename FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
    LOOP
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', t.tablename);
    END LOOP;
  END IF;
END $$;
