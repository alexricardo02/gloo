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

const LOCK_RETRY_LIMIT = 400;

/**
 * BEGINs a transaction that holds ACCESS EXCLUSIVE locks on every table in
 * the public schema, taken in ONE `LOCK TABLE ... NOWAIT` statement. The
 * migration ALTERs every table; doing that lock by lock while integration
 * tests in other files run multi-table transactions on the shared test DB
 * can deadlock. Holding all locks first means the migration never waits
 * halfway. If any table is busy, the attempt is rolled back (holding
 * nothing) and retried after a short pause.
 */
export async function beginWithAllTablesLocked(client: pg.Client): Promise<void> {
  const { rows } = await client.query<{ name: string }>(
    `SELECT format('%I.%I', n.nspname, c.relname) AS name
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      ORDER BY c.relname`,
  );
  for (let attempt = 1; ; attempt += 1) {
    await client.query("BEGIN");
    if (rows.length === 0) return;
    try {
      await client.query(`LOCK TABLE ${rows.map((r) => r.name).join(", ")} IN ACCESS EXCLUSIVE MODE NOWAIT`);
      return;
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code !== "55P03" || attempt >= LOCK_RETRY_LIMIT) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 + Math.random() * 50));
    }
  }
}

/** Runs the migration file as one simple-protocol query (it contains DO blocks), with all tables locked first. */
export async function applyRlsLockdown(connectionString: string, cwd: string = process.cwd()): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await beginWithAllTablesLocked(client);
    try {
      await client.query(readRlsMigration(cwd));
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    await client.end();
  }
}
