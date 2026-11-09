-- Runs automatically ONLY when the Docker volume is created for the first time
-- (Postgres skips /docker-entrypoint-initdb.d on an existing data directory).
-- For an existing container use:   npm run test:db:create
--
-- gloo_test   → Vitest / Playwright database (guarded: name must end in _test)
-- gloo_shadow → shadow database for `prisma migrate diff --from-migrations`
CREATE DATABASE gloo_test OWNER party_admin;
CREATE DATABASE gloo_shadow OWNER party_admin;
