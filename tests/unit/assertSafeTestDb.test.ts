import { describe, it, expect, afterEach, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertSafeTestDb,
  redactDatabaseUrl,
  UnsafeTestDatabaseError,
} from "../assertSafeTestDb";
import { resolveTestEnv } from "../testEnv";

describe("assertSafeTestDb (test DB guard)", () => {
  it.each([
    "postgresql://u:p@localhost:5433/gloo_test?schema=public",
    "postgresql://u:p@127.0.0.1:5432/gloo_test",
    "postgresql://u:p@[::1]:5432/gloo_test",
    "postgres://u:p@LOCALHOST/app_test",
  ])("accepts local *_test database %s", (url) => {
    expect(assertSafeTestDb(url)).toBe(url);
  });

  it("rejects a missing URL with setup instructions", () => {
    expect(() => assertSafeTestDb(undefined)).toThrow(UnsafeTestDatabaseError);
    expect(() => assertSafeTestDb("")).toThrow(/is not set/);
  });

  it("rejects a remote host (e.g. Supabase) even if the DB name ends in _test", () => {
    expect(() =>
      assertSafeTestDb("postgresql://u:p@db.abc.supabase.co:5432/gloo_test"),
    ).toThrow(/host "db.abc.supabase.co" is not localhost/);
  });

  it("rejects hostnames that merely start with localhost", () => {
    expect(() =>
      assertSafeTestDb("postgresql://u:p@localhost.evil.com:5432/gloo_test"),
    ).toThrow(/is not localhost/);
  });

  it("rejects a local database whose name does not end in _test", () => {
    expect(() =>
      assertSafeTestDb("postgresql://u:p@localhost:5433/gloo_db"),
    ).toThrow(/database "gloo_db" does not end in "_test"/);
    expect(() =>
      assertSafeTestDb("postgresql://u:p@localhost:5433/gloo_test_backup"),
    ).toThrow(/does not end in "_test"/);
  });

  it("rejects non-postgres and unparseable URLs", () => {
    expect(() => assertSafeTestDb("mysql://u:p@localhost/x_test")).toThrow(/postgresql:\/\//);
    expect(() => assertSafeTestDb("not a url")).toThrow(/not a valid URL/);
  });

  it("never includes the password in error messages", () => {
    try {
      assertSafeTestDb("postgresql://u:SuperSecret123@prod.example.com:5432/postgres");
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).not.toContain("SuperSecret123");
      expect((e as Error).message).toContain("***");
    }
    expect(redactDatabaseUrl("postgresql://u:pw@h/db")).not.toContain("pw@");
  });
});

describe("resolveTestEnv", () => {
  const saved = { ...process.env };
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gloo-testenv-"));
    delete process.env.DATABASE_URL;
    delete process.env.DIRECT_URL;
    delete process.env.TEST_DATABASE_URL;
  });

  afterEach(() => {
    process.env = { ...saved };
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reads only .env.test and forces DATABASE_URL/DIRECT_URL to the test DB", () => {
    fs.writeFileSync(
      path.join(dir, ".env"),
      'DATABASE_URL="postgresql://u:p@prod.example.com:5432/postgres"\n',
    );
    fs.writeFileSync(
      path.join(dir, ".env.test"),
      'TEST_DATABASE_URL="postgresql://u:p@localhost:5433/gloo_test"\nFOO="bar"\n',
    );

    const env = resolveTestEnv(dir);
    expect(env.DATABASE_URL).toBe("postgresql://u:p@localhost:5433/gloo_test");
    expect(env.DIRECT_URL).toBe("postgresql://u:p@localhost:5433/gloo_test");
    expect(env.FOO).toBe("bar");
  });

  it("fails closed when the shell exports a non-test DATABASE_URL", () => {
    fs.writeFileSync(
      path.join(dir, ".env.test"),
      'TEST_DATABASE_URL="postgresql://u:p@localhost:5433/gloo_test"\n',
    );
    process.env.DATABASE_URL = "postgresql://u:p@db.fake-remote.example:5432/postgres";
    expect(() => resolveTestEnv(dir)).toThrow(/DATABASE_URL \(from your shell\/CI environment\)/);
  });

  it("fails when TEST_DATABASE_URL is missing", () => {
    expect(() => resolveTestEnv(dir)).toThrow(/TEST_DATABASE_URL is not set/);
  });
});
