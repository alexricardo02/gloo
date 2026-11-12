import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { prisma } from "@/lib/prisma";
import { applyRlsLockdown, beginWithAllTablesLocked, readRlsMigration } from "../applyRlsLockdown";

/**
 * Pack 5 (S2): the deny-all RLS migration, run against the local test DB
 * (guarded: localhost "*_test" only).
 *
 * Plain Postgres has no Supabase roles, so the first test simulates them
 * inside ONE transaction that is rolled back at the end: it creates "anon"
 * and "authenticated", grants them what Supabase grants by default
 * (all tables + default privileges), adds a permissive policy and puts the
 * tables in a "supabase_realtime" publication, runs the migration, and checks
 * that none of it survives. Nothing (roles, grants, publication) is left behind.
 */

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Expects `sql` to fail with SQLSTATE `code`, inside a savepoint so the transaction stays usable. */
async function expectSqlError(client: Client, sql: string, code: string) {
  await client.query("SAVEPOINT probe");
  try {
    await client.query(sql);
    throw new Error(`expected ${code} for: ${sql}`);
  } catch (error) {
    expect((error as { code?: string }).code).toBe(code);
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT probe");
  }
}

describe("rls_deny_all migration (integration, local test DB)", () => {
  it("enables RLS everywhere, drops policies, revokes anon/authenticated (now and for future tables), unpublishes", async () => {
    await withClient(async (client) => {
      // All tables locked up front: no deadlock with other test files' transactions.
      await beginWithAllTablesLocked(client);
      try {
        // Simulate Supabase's roles and default grants.
        for (const role of ["anon", "authenticated"]) {
          const exists = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role]);
          if (exists.rowCount === 0) await client.query(`CREATE ROLE ${role} NOLOGIN`);
          await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
          await client.query(`GRANT ALL ON ALL TABLES IN SCHEMA public TO ${role}`);
          await client.query(`GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
          await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${role}`);
          await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ${role}`);
        }
        await client.query(`CREATE POLICY "allow all" ON "Message" FOR SELECT TO anon USING (true)`);
        const hasPublication = await client.query("SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'");
        if (hasPublication.rowCount === 0) {
          await client.query(`CREATE PUBLICATION supabase_realtime FOR TABLE "Message", "Chat"`);
        } else {
          await client.query(`ALTER PUBLICATION supabase_realtime ADD TABLE "Message"`);
        }

        // Before: anon can read messages.
        await client.query("SET LOCAL ROLE anon");
        await client.query(`SELECT 1 FROM "Message" LIMIT 1`);
        await client.query("RESET ROLE");

        await client.query(readRlsMigration());

        const tables = await client.query<{ relname: string; relrowsecurity: boolean }>(`
          SELECT c.relname, c.relrowsecurity
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')`);
        expect(tables.rows.length).toBeGreaterThan(10);
        expect(tables.rows.filter((t) => !t.relrowsecurity)).toEqual([]);

        const policies = await client.query("SELECT 1 FROM pg_policies WHERE schemaname = 'public'");
        expect(policies.rowCount).toBe(0);

        const published = await client.query(
          "SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public'",
        );
        expect(published.rowCount).toBe(0);

        for (const role of ["anon", "authenticated"]) {
          const grants = await client.query(
            `SELECT table_name FROM information_schema.role_table_grants
              WHERE grantee = $1 AND table_schema = 'public'`,
            [role],
          );
          expect(grants.rows).toEqual([]);

          await client.query(`SET LOCAL ROLE ${role}`);
          await expectSqlError(client, `SELECT * FROM "User" LIMIT 1`, "42501");
          await expectSqlError(client, `SELECT * FROM "Message" LIMIT 1`, "42501");
          await expectSqlError(client, `INSERT INTO "GroupBlock" ("id", "blockerId", "blockedGroupId") VALUES ('x', 'y', 'z')`, "42501");
          await client.query("RESET ROLE");
        }

        // Future tables created by the migration role are not granted to anon.
        await client.query(`CREATE TABLE "Pack5FutureTable" (id int)`);
        const future = await client.query(
          "SELECT has_table_privilege('anon', 'public.\"Pack5FutureTable\"', 'SELECT') AS can",
        );
        expect(future.rows[0].can).toBe(false);

        // Even with a privilege granted again by mistake, RLS (no policy) shows no rows.
        await client.query(`GRANT SELECT ON "Session" TO authenticated`);
        await client.query("SET LOCAL ROLE authenticated");
        const rows = await client.query(`SELECT count(*)::int AS n FROM "Session"`);
        expect(rows.rows[0].n).toBe(0);
        await client.query("RESET ROLE");
      } finally {
        await client.query("ROLLBACK");
      }
    });
  });

  it("applies cleanly (and idempotently) to the test DB; Prisma, as table owner, keeps full access", async () => {
    await applyRlsLockdown(process.env.DATABASE_URL!);
    await applyRlsLockdown(process.env.DATABASE_URL!);

    const user = await prisma.user.create({
      data: { email: `rls_${Date.now()}@test.com`, password: "x", name: "RLS", birthDate: new Date("1990-01-01") },
    });
    try {
      expect(await prisma.user.findUnique({ where: { id: user.id }, select: { id: true } })).toEqual({ id: user.id });
      const rls = await prisma.$queryRaw<{ off: number }[]>`
        SELECT count(*)::int AS "off" FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity`;
      expect(rls[0].off).toBe(0);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
