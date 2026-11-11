import { defineConfig, devices } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { resolveTestEnv } from './tests/testEnv';

// Load ONLY .env.test and guard it: throws before any browser or server
// starts unless TEST_DATABASE_URL is a local "*_test" database.
const testEnv = resolveTestEnv();

// The /api/e2e helper needs a shared secret between global-setup and the
// dev server. Generate one per run if .env.test does not provide it; writing
// it to process.env lets re-evaluations of this config (workers) reuse it.
process.env.E2E_TEST_SECRET ??= testEnv.E2E_TEST_SECRET || randomUUID();
Object.assign(process.env, testEnv, { E2E_TEST_SECRET: process.env.E2E_TEST_SECRET });

// Dedicated port so Playwright never talks to a `npm run dev` that a developer
// started against their dev database on :3000.
const E2E_PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://localhost:${E2E_PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  timeout: 90_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  webServer: {
    command: `npm run dev -- --port ${E2E_PORT}`,
    url: BASE_URL,
    // Never reuse an already-running server: it could be connected to a
    // non-test database. (Next 16 also refuses a second `next dev` in the same
    // project, so a running dev server makes this fail fast instead.)
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...testEnv,
      DATABASE_URL: testEnv.TEST_DATABASE_URL,
      DIRECT_URL: testEnv.TEST_DATABASE_URL,
      E2E_ENABLED: '1',
      E2E_TEST_SECRET: process.env.E2E_TEST_SECRET,
      // Pinned explicitly so a value in `.env` (which `next dev` also loads)
      // can't change the run. Default run: email flows off. To run with them
      // on: EMAIL_FLOWS_ENABLED=true npx playwright test
      EMAIL_FLOWS_ENABLED: process.env.EMAIL_FLOWS_ENABLED ?? 'false',
    },
  },

  projects: [
    {
      name: 'guest',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /guest-flow\.spec\.ts/,
    },
    {
      name: 'auth',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /auth-flow\.spec\.ts/,
    },
    {
      name: 'core',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /core-flow\.spec\.ts/,
    },
    {
      name: 'social',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /social-flow\.spec\.ts/,
    },
    {
      name: 'map-moderation',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /map-moderation\.spec\.ts/,
    },
  ],
});
