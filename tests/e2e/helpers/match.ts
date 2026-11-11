import { expect, type Browser, type Page } from '@playwright/test';
import { getAuthFile, url, waitForAppStable } from '../fixtures';

/** English text of Chat.systemMessages.MATCH_CREATED (messages/en.json). */
export const MATCH_NOTICE_EN = "It's a match! Your groups liked each other. Say hi!";
/** German text of Chat.systemMessages.MATCH_CREATED (messages/de.json). */
export const MATCH_NOTICE_DE = 'Es ist ein Match! Eure Gruppen haben sich gegenseitig geliked. Sagt Hallo!';

/**
 * Makes sure the signed-in user on `page` likes the (only) other group in the
 * discovery feed. Clicking an already liked heart would unlike it, so the
 * current state is read first. Waits for the server action to finish.
 */
export async function likeOtherGroup(page: Page) {
  await page.goto(url('en', '/search-groups'));
  await waitForAppStable(page);

  const like = page.locator('[data-testid="like-button"]').first();
  await expect(like).toBeVisible({ timeout: 8_000 });
  if ((await like.getAttribute('aria-pressed')) === 'true') return;

  await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/search-groups')),
    like.click(),
  ]);
  await expect(like).toHaveAttribute('aria-pressed', 'true');
}

/**
 * Chats only exist after a match (CHAT_CREATION = match-only): users A and B
 * like each other's group. Idempotent, so every test can call it.
 */
export async function ensureMatch(browser: Browser) {
  for (const user of ['B', 'A'] as const) {
    const context = await browser.newContext({ storageState: getAuthFile(user) });
    const page = await context.newPage();
    await likeOtherGroup(page);
    await context.close();
  }
}
