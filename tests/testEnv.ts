/**
 * Shared test-environment loader for Vitest and Playwright.
 *
 * Reads ONLY `.env.test` (never `.env`, which may hold dev/prod credentials).
 * Values already present in the process environment win, so CI can inject
 * them directly without a file.
 */

import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { assertSafeTestDb } from "./assertSafeTestDb";

export const TEST_ENV_FILE = ".env.test";

/** Parses `.env.test` (if present) without touching `process.env`. */
export function readTestEnvFile(cwd = process.cwd()): Record<string, string> {
  const file = path.join(cwd, TEST_ENV_FILE);
  if (!fs.existsSync(file)) return {};
  const parsed = parseEnv(fs.readFileSync(file, "utf8"));
  return Object.fromEntries(
    Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === "string"),
  );
}

/**
 * Resolves the full env for a test process:
 * `.env.test` values, overridden by real env vars, with DATABASE_URL and
 * DIRECT_URL forced to the (guarded) TEST_DATABASE_URL.
 *
 * Throws if TEST_DATABASE_URL is missing or unsafe, or if the caller's shell
 * already exports a DATABASE_URL / DIRECT_URL that is not a safe test DB
 * (fail closed instead of silently overriding a possibly-production URL).
 */
export function resolveTestEnv(cwd = process.cwd()): Record<string, string> {
  const fromFile = readTestEnvFile(cwd);

  for (const name of ["DATABASE_URL", "DIRECT_URL"] as const) {
    const inherited = process.env[name];
    if (inherited) assertSafeTestDb(inherited, `${name} (from your shell/CI environment)`);
  }

  const testDbUrl = assertSafeTestDb(
    process.env.TEST_DATABASE_URL ?? fromFile.TEST_DATABASE_URL,
    "TEST_DATABASE_URL",
  );

  const merged: Record<string, string> = { ...fromFile };
  for (const key of Object.keys(fromFile)) {
    const live = process.env[key];
    if (live !== undefined) merged[key] = live;
  }

  return {
    ...merged,
    TEST_DATABASE_URL: testDbUrl,
    DATABASE_URL: testDbUrl,
    DIRECT_URL: testDbUrl,
  };
}
