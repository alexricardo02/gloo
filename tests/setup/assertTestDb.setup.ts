/**
 * Vitest setup file: runs in every worker before any test file is imported.
 * Defense in depth on top of the check in vitest.config.mts — verifies the
 * env that Prisma will actually read in this process.
 */
import { assertSafeTestDb } from "../assertSafeTestDb";

assertSafeTestDb(process.env.TEST_DATABASE_URL, "TEST_DATABASE_URL");
assertSafeTestDb(process.env.DATABASE_URL, "DATABASE_URL");
assertSafeTestDb(process.env.DIRECT_URL, "DIRECT_URL");
