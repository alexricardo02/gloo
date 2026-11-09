/**
 * Test-database safety guard.
 *
 * Every test runner (Vitest, Playwright global-setup, E2E DB helpers) must call
 * this before anything can connect to a database. It throws unless the URL
 * points at a loopback host AND the database name ends in `_test`, so a test
 * run can never read, write or reset a dev or production database (e.g. a
 * Supabase URL copied into `.env`).
 *
 * The error messages never include the password from the URL.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export class UnsafeTestDatabaseError extends Error {
  constructor(message: string) {
    super(`[test-db-guard] ${message}`);
    this.name = "UnsafeTestDatabaseError";
  }
}

/** Removes the password so a URL can be printed safely. */
export function redactDatabaseUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.password) url.password = "***";
    return url.toString();
  } catch {
    return "<unparseable URL>";
  }
}

/**
 * Throws `UnsafeTestDatabaseError` unless `rawUrl` is a local `*_test` database.
 *
 * @param rawUrl   The connection string to check.
 * @param varName  Name of the env var it came from (only used in messages).
 * @returns The validated URL, unchanged.
 */
export function assertSafeTestDb(
  rawUrl: string | undefined,
  varName = "TEST_DATABASE_URL",
): string {
  if (!rawUrl || rawUrl.trim() === "") {
    throw new UnsafeTestDatabaseError(
      `${varName} is not set. Copy .env.test.example to .env.test and point it at a ` +
        `local database whose name ends in "_test" (see README → Testing).`,
    );
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeTestDatabaseError(`${varName} is not a valid URL.`);
  }

  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new UnsafeTestDatabaseError(
      `${varName} must be a postgresql:// URL (got "${url.protocol}").`,
    );
  }

  const host = url.hostname.toLowerCase();
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new UnsafeTestDatabaseError(
      `Refusing to run tests: ${varName} host "${host}" is not localhost/127.0.0.1/::1. ` +
        `Tests may only use a local test database. (${redactDatabaseUrl(rawUrl)})`,
    );
  }

  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!dbName.endsWith("_test")) {
    throw new UnsafeTestDatabaseError(
      `Refusing to run tests: ${varName} database "${dbName || "<none>"}" does not end in "_test". ` +
        `(${redactDatabaseUrl(rawUrl)})`,
    );
  }

  return rawUrl;
}
