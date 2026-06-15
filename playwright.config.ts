import { defineConfig, devices } from '@playwright/test';

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
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
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
