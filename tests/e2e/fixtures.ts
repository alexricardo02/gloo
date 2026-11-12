import { test as base, type Page, type BrowserContext } from '@playwright/test';
import path from 'path';
import fs from 'fs';

// ── Test credentials (written by global-setup) ──
export interface TestUser {
  name: string;
  username: string;
  email: string;
  password: string;
}

export interface TestCredentials {
  userA: TestUser;
  userB: TestUser;
}

export function getTestCredentials(): TestCredentials {
  const credPath = path.join(__dirname, '.auth/test-credentials.json');
  if (fs.existsSync(credPath)) {
    return JSON.parse(fs.readFileSync(credPath, 'utf-8'));
  }
  // Fallback defaults for local dev
  return {
    userA: { name: 'Alice E2E', username: 'e2ealice', email: 'e2e_alice@test.com', password: 'AliceE2E123!' },
    userB: { name: 'Bob E2E', username: 'e2ebob', email: 'e2e_bob@test.com', password: 'BobE2E123!' },
  };
}

export function getAuthFile(user: 'A' | 'B'): string {
  return path.join(__dirname, '.auth', `user${user}.json`);
}

// ── Locale-aware URL helpers ──
export function url(locale: string, pathStr: string): string {
  return `/${locale}${pathStr}`;
}

// ── Wait for no loading spinners ──
export async function waitForAppStable(page: Page) {
  await page.waitForTimeout(500);
  const loader = page.locator('.animate-spin');
  if (await loader.count() > 0) {
    await loader.first().waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
  }
}

// ── Helper to log in as a guest ──
export async function loginAsGuest(page: Page, locale = 'en') {
  await page.goto(url(locale, '/'));
  await page.locator('[data-testid="party-start-btn"]').click();
  await page.waitForURL(`**/${locale}/search-groups`, { timeout: 10_000 });
  await waitForAppStable(page);
}

// ── Helper to navigate via bottom tabs ──
export async function navigateToTab(page: Page, tabId: string) {
  await page.locator(`[data-testid="nav-tab-${tabId}"]`).click();
  await waitForAppStable(page);
}

// ── No external services in E2E ──
/**
 * The map's "your location" label comes from GET /api/geocode, which calls
 * Nominatim from the dev server. Every E2E browser context answers that
 * route locally instead, and any direct request to Nominatim is aborted, so
 * no test depends on (or sends test traffic to) an external service.
 */
export const GEOCODE_STUB = { name: 'E2E Town' };

export async function stubExternalServices(context: BrowserContext): Promise<void> {
  await context.route('**/api/geocode**', (route) => route.fulfill({ json: GEOCODE_STUB }));
  await context.route(/nominatim\.openstreetmap\.org/i, (route) => route.abort('blockedbyclient'));
}

// ── Extended test fixture ──
/**
 * `context` (used by tests that take `page`) and every context a test creates
 * with `browser.newContext()` get stubExternalServices().
 */
export const test = base.extend<object, { stubbedBrowser: void }>({
  // `provide` is Playwright's `use` (renamed: the React hooks lint rule flags a function named `use`).
  context: async ({ context }, provide) => {
    await stubExternalServices(context);
    await provide(context);
  },
  stubbedBrowser: [
    async ({ browser }, provide) => {
      const newContext = browser.newContext.bind(browser);
      browser.newContext = async (...args: Parameters<typeof newContext>) => {
        const context = await newContext(...args);
        await stubExternalServices(context);
        return context;
      };
      await provide();
      browser.newContext = newContext;
    },
    { scope: 'worker', auto: true },
  ],
});

export { expect } from '@playwright/test';
