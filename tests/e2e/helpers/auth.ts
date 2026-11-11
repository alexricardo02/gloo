import { expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isEmailFlowEnabled } from '../../../lib/features';

/**
 * Same flag the dev server uses: playwright.config.ts passes this process's
 * EMAIL_FLOWS_ENABLED (default "false") to `next dev`.
 */
export const emailFlowsEnabled = () => isEmailFlowEnabled(process.env);

export interface NewUser {
  name: string;
  username: string;
  email: string;
  password: string;
}

/** A unique, valid user for one test run. */
export function freshUser(prefix: string, password = 'FreshPass123!'): NewUser {
  const id = `${Date.now()}${crypto.randomBytes(4).toString('hex')}`;
  return { name: `${prefix} User`, username: `${prefix}_${id}`, email: `${prefix}_${id}@test.com`, password };
}

/** Calls the guarded /api/e2e helper (only reachable from the Playwright dev server). */
export async function callE2eApi(baseURL: string, action: string, email: string, label?: string) {
  const res = await fetch(`${baseURL}/api/e2e`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-e2e-secret': process.env.E2E_TEST_SECRET! },
    body: JSON.stringify({ action, email, label }),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`E2E API ${action} failed for ${email}: ${data.error || res.statusText}`);
  }
}

export async function fillAndSubmitRegister(page: Page, baseURL: string, user: NewUser, locale = 'en') {
  await page.goto(`${baseURL}/${locale}/register`);
  // Wait for the client instance of the form. The SSR/hydration instance is
  // remounted once on the client (draft restore), which wipes anything typed
  // into it: filling too early left "Full Name" empty and native `required`
  // validation silently blocked the submit.
  await page.waitForSelector('[data-testid="register-form"][data-ready="true"]', { timeout: 10_000 });
  await page.fill('[data-testid="register-name-input"]', user.name);
  await page.fill('[data-testid="register-email-input"]', user.email);
  await page.fill('[data-testid="register-username-input"]', user.username);
  await page.fill('[data-testid="register-password-input"]', user.password);
  await page.fill('[data-testid="register-dob-input"]', '2000-01-01');
  await page.locator('input[type="checkbox"]').first().check();
  // Regression guard: if a remount wiped a field, fail here with a clear
  // message instead of native `required` validation silently blocking submit.
  await expect(page.locator('[data-testid="register-name-input"]')).toHaveValue(user.name);
  await expect(page.locator('[data-testid="register-email-input"]')).toHaveValue(user.email);
  await expect(page.locator('[data-testid="register-username-input"]')).toHaveValue(user.username);
  await expect(page.locator('[data-testid="register-dob-input"]')).toHaveValue('2000-01-01');
  await page.locator('[data-testid="register-submit-btn"]').click();
}

export async function loginViaUi(page: Page, baseURL: string, identifier: string, password: string, locale = 'en') {
  await page.goto(`${baseURL}/${locale}/login`);
  await page.waitForSelector('[data-testid="login-form"]', { timeout: 10_000 });
  await page.fill('[data-testid="login-identifier-input"]', identifier);
  await page.fill('[data-testid="login-password-input"]', password);
  await page.locator('[data-testid="login-submit-btn"]').click();
}

/**
 * Registers through the UI and ends signed in on /{locale}/search-groups.
 * Email flows off (default): registration signs the user in directly.
 * Email flows on: "check your email" screen, verify via /api/e2e, then log in.
 */
export async function registerAndSignIn(page: Page, baseURL: string, user: NewUser, locale = 'en') {
  try {
    await fillAndSubmitRegister(page, baseURL, user, locale);

    if (emailFlowsEnabled()) {
      await page.waitForSelector('[data-testid="register-success"]', { timeout: 15_000 });
      await callE2eApi(baseURL, 'verify', user.email);
      await loginViaUi(page, baseURL, user.email, user.password, locale);
    }

    await page.waitForURL(`**/${locale}/search-groups`, { timeout: 15_000 });
    await expect(page.locator('[data-testid="nav-tab-discover"]')).toBeVisible({ timeout: 10_000 });
  } catch (error) {
    await captureFailureEvidence(page, `register-${user.username}`, error);
    throw error;
  }
}

/**
 * Saves a screenshot plus the URL and visible text of `page` to
 * test-results/global-setup-failure.{png,txt} (last failure wins) so a setup
 * failure can be diagnosed without re-running headed. Never throws.
 */
export async function captureFailureEvidence(page: Page, label: string, error: unknown) {
  const dir = path.join(process.cwd(), 'test-results');
  try {
    fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, 'global-setup-failure.png'), fullPage: true }).catch(() => {});
    const text = await page.locator('body').innerText({ timeout: 2_000 }).catch(() => '<unavailable>');
    const report = [
      `label: ${label}`,
      `time: ${new Date().toISOString()}`,
      `url: ${page.url()}`,
      `emailFlowsEnabled: ${emailFlowsEnabled()}`,
      `error: ${error instanceof Error ? error.message : String(error)}`,
      '',
      '--- visible text ---',
      text,
    ].join('\n');
    fs.writeFileSync(path.join(dir, 'global-setup-failure.txt'), report);
    console.error(`[e2e] ${label} failed at ${page.url()}; evidence saved to ${dir}${path.sep}global-setup-failure.{png,txt}`);
  } catch {
    // Evidence capture must never mask the original error.
  }
}

/** Logs out from the profile page; the user lands on the discovery feed as a guest. */
export async function logoutViaProfile(page: Page, baseURL: string, locale = 'en') {
  await page.goto(`${baseURL}/${locale}/profile`);
  await page.locator('[data-testid="profile-logout-btn"]').click();
  await page.waitForURL(`**/${locale}/search-groups`, { timeout: 15_000 });
}
