/**
 * Applies the deny-all RLS migration (prisma/migrations/*_rls_deny_all) to a
 * database. The test databases are created with `prisma db push`, which only
 * syncs the Prisma schema and never runs raw-SQL migrations, so the test-DB
 * prepare script, Playwright's global setup and the RLS integration test call
 * this to run every test against an RLS-enabled database like production.
 *
 * The caller must pass a URL that already passed assertSafeTestDb().
 * Plain TypeScript (no enums / parameter properties) so scripts/test-db.mjs
 * can import it with Node's native type stripping.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

export const RLS_MIGRATION_SUFFIX = "_rls_deny_all";

export function rlsMigrationPath(cwd: string = process.cwd()): string {
  const dir = path.join(cwd, "prisma", "migrations");
  const name = fs.readdirSync(dir).find((d) => d.endsWith(RLS_MIGRATION_SUFFIX));
  if (!name) throw new Error(`No *${RLS_MIGRATION_SUFFIX} migration found in ${dir}`);
  return path.join(dir, name, "migration.sql");
}

export function readRlsMigration(cwd: string = process.cwd()): string {
  return fs.readFileSync(rlsMigrationPath(cwd), "utf8");
}

/** Runs the migration file as one simple-protocol query (it contains DO blocks). */
export async function applyRlsLockdown(connectionString: string, cwd: string = process.cwd()): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(readRlsMigration(cwd));
  } finally {
    await client.end();
  }
}
