#!/usr/bin/env node
/**
 * Local test-database helper. Only ever operates on TEST_DATABASE_URL, and
 * only after the shared guard (tests/assertSafeTestDb.ts) has confirmed it is
 * a localhost "*_test" database. Never reads `.env`.
 *
 *   node scripts/test-db.mjs create    # create the DB inside the gloo-db Docker container
 *   node scripts/test-db.mjs prepare   # sync prisma/schema.prisma into the test DB
 *
 * Requires Node >= 22.18 (imports the TypeScript guard via native type stripping).
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  console.error(`[test-db] Node >= 22.18 is required (found ${process.versions.node}).`);
  process.exit(1);
}

const { assertSafeTestDb, UnsafeTestDatabaseError } = await import("../tests/assertSafeTestDb.ts");

const CONTAINER = process.env.TEST_DB_CONTAINER ?? "gloo-db";

function resolveTestDbUrl() {
  const envFile = path.join(process.cwd(), ".env.test");
  const fromFile = fs.existsSync(envFile) ? parseEnv(fs.readFileSync(envFile, "utf8")) : {};
  return assertSafeTestDb(process.env.TEST_DATABASE_URL ?? fromFile.TEST_DATABASE_URL, "TEST_DATABASE_URL");
}

function create(rawUrl) {
  const url = new URL(rawUrl);
  const dbName = decodeURIComponent(url.pathname.slice(1));
  const user = decodeURIComponent(url.username) || "postgres";
  try {
    execFileSync("docker", ["exec", CONTAINER, "createdb", "-U", user, dbName], { stdio: "pipe" });
    console.log(`[test-db] Created database "${dbName}" in container "${CONTAINER}".`);
  } catch (err) {
    const stderr = String(err.stderr ?? err.message);
    if (stderr.includes("already exists")) {
      console.log(`[test-db] Database "${dbName}" already exists in "${CONTAINER}" — nothing to do.`);
      return;
    }
    console.error(`[test-db] Could not create "${dbName}" in container "${CONTAINER}":\n${stderr}`);
    console.error("Is Docker running and the container started (`docker compose up -d`)?");
    process.exit(1);
  }
}

function prepare(rawUrl) {
  // NOTE: uses `db push` (not `migrate deploy`) because prisma/migrations
  // currently drifts from schema.prisma; see README → Testing.
  // No --accept-data-loss: if a change would drop data, Prisma stops and you
  // can recreate the disposable test DB instead.
  console.log("[test-db] Syncing prisma/schema.prisma into the test database (db push)...");
  const result = spawnSync("npx", ["prisma", "db", "push"], {
    stdio: "inherit",
    shell: process.platform === "win32",
    // Explicit URLs so prisma.config.ts' dotenv can never fall back to .env.
    env: { ...process.env, DATABASE_URL: rawUrl, DIRECT_URL: rawUrl },
  });
  process.exit(result.status ?? 1);
}

const command = process.argv[2];
try {
  const testDbUrl = resolveTestDbUrl();
  if (command === "create") create(testDbUrl);
  else if (command === "prepare") prepare(testDbUrl);
  else {
    console.error("Usage: node scripts/test-db.mjs <create|prepare>");
    process.exit(1);
  }
} catch (err) {
  if (err instanceof UnsafeTestDatabaseError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}
