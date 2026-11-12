import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { GEOCODE_STUB, getAuthFile, navigateToTab, waitForAppStable, url } from './fixtures';
import { ensureMatch } from './helpers/match';

test.describe('Map & Moderation (TC17–TC18, TC22)', () => {

  test('TC17: Map shows with markers', async ({ browser }) => {
    const context = await browser.newContext({
      storageState: getAuthFile('A'),
      permissions: ['geolocation'],
      geolocation: { latitude: 49.9929, longitude: 8.2473 },
    });
    const page = await context.newPage();

    await page.goto(url('en', '/search-groups'));
    await waitForAppStable(page);

    // The location label is geocoded via /api/geocode, answered by the fixture stub (no Nominatim).
    const geocode = page.waitForResponse((r) => r.url().includes('/api/geocode'));
    await navigateToTab(page, 'map');
    expect(await (await geocode).json()).toEqual(GEOCODE_STUB);
    await page.waitForTimeout(3000);

    // Leaflet container should be visible
    const leafletContainer = page.locator('.leaflet-container');
    await expect(leafletContainer).toBeVisible({ timeout: 10_000 });

    await context.close();
  });

  test('TC18: Share location – sheet opens for both users', async ({ browser }) => {
    // User A: Open map and verify share button exists
    const ctxA = await browser.newContext({
      storageState: getAuthFile('A'),
      permissions: ['geolocation'],
      geolocation: { latitude: 49.9929, longitude: 8.2473 },
    });
    const pageA = await ctxA.newPage();

    await pageA.goto(url('en', '/search-groups'));
    await waitForAppStable(pageA);
    await navigateToTab(pageA, 'map');
    await pageA.waitForTimeout(3000);

    // Click "Share Location" / "Create Party" (map page includes this button for logged-in users)
    const shareBtn = pageA.locator('[data-testid="share-location-btn"]');
    await expect(shareBtn).toBeVisible({ timeout: 8_000 });
    await shareBtn.click();
    await pageA.waitForTimeout(500);

    // Should show party creation sheet
    const hasSheet = (await pageA.getByPlaceholder(/description|Beschreibung/i).isVisible({ timeout: 3000 }).catch(() => false)) ||
                     (await pageA.getByText(/share|teilen|party|Vorglühen/i).first().isVisible({ timeout: 3000 }).catch(() => false));
    expect(hasSheet).toBeTruthy();

    // User B: Map also loads
    const ctxB = await browser.newContext({
      storageState: getAuthFile('B'),
      permissions: ['geolocation'],
      geolocation: { latitude: 49.9929, longitude: 8.2473 },
    });
    const pageB = await ctxB.newPage();

    await pageB.goto(url('en', '/search-groups'));
    await waitForAppStable(pageB);
    await navigateToTab(pageB, 'map');
    await pageB.waitForTimeout(3000);

    const leafletB = pageB.locator('.leaflet-container');
    await expect(leafletB).toBeVisible({ timeout: 5000 });

    await ctxA.close();
    await ctxB.close();
  });

  test('TC19: Pre-party: masked circle until accepted, then exact pin and chat; the host ends it', async ({ browser }) => {
    const geo = { permissions: ['geolocation'], geolocation: { latitude: 49.9929, longitude: 8.2473 } };
    const nominatimRequests: string[] = [];
    const open = async (user: 'A' | 'B') => {
      const context = await browser.newContext({ storageState: getAuthFile(user), ...geo });
      // /api/geocode is stubbed for every context by tests/e2e/fixtures.ts.
      context.on('request', (r) => { if (/nominatim/i.test(r.url())) nominatimRequests.push(r.url()); });
      const page = await context.newPage();
      return { context, page };
    };
    const gotoMap = async (page: Page) => {
      const loaded = page.waitForResponse((r) => r.url().includes('/api/map') && r.ok());
      await page.goto(url('en', '/map'));
      await waitForAppStable(page);
      const body = await (await loaded).text();
      await expect(page.locator('.leaflet-container')).toBeVisible({ timeout: 10_000 });
      return body;
    };
    /** Real click on the circle, at a point inside it that is not covered by a marker. */
    const clickInsideCircle = async (page: Page) => {
      const circle = page.getByTestId('preparty-masked-circle');
      const box = (await circle.boundingBox())!;
      for (const angle of [90, 270, 0, 180, 45, 135, 225, 315]) {
        const x = box.x + box.width / 2 + Math.cos((angle * Math.PI) / 180) * box.width * 0.3;
        const y = box.y + box.height / 2 + Math.sin((angle * Math.PI) / 180) * box.height * 0.3;
        const hit = await page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.getAttribute('data-testid'), [x, y]);
        if (hit === 'preparty-masked-circle') {
          await page.mouse.click(x, y);
          return;
        }
      }
      throw new Error('No free point inside the circle');
    };
    const openPinPopup = (page: Page) => page.getByTestId('preparty-exact-pin').dispatchEvent('click');

    // ── Host A creates a 2-hour pre-party at the map center ──
    const a = await open('A');
    await gotoMap(a.page);
    await a.page.getByTestId('share-location-btn').click();
    await expect(a.page.getByTestId('preparty-sheet')).toBeVisible();
    await a.page.getByTestId('duration-chip-2').click();
    await expect(a.page.getByTestId('duration-chip-2')).toHaveAttribute('aria-checked', 'true');
    await a.page.getByTestId('start-party-btn').click();
    await expect(a.page.getByTestId('share-location-btn')).toContainText(/Active Party/i, { timeout: 10_000 });
    await expect(a.page.getByTestId('preparty-exact-pin')).toHaveCount(1);
    await a.page.getByTestId('share-location-btn').click();
    await expect(a.page.getByTestId('party-time-left')).toHaveText(/^(1h 5\dm|2h 0m)/, { timeout: 5_000 });
    await a.page.getByTestId('preparty-sheet').getByRole('button', { name: 'Close' }).click();
    await expect(a.page.getByTestId('preparty-sheet')).toHaveCount(0);

    // ── B sees a circle (no pin, no coordinates) and requests access ──
    const b = await open('B');
    const raw = await gotoMap(b.page);
    const events = (JSON.parse(raw) as { events: { location: { kind: string } }[] }).events;
    expect(events.map((e) => e.location.kind)).toEqual(['masked']);
    expect(JSON.stringify(events)).not.toMatch(/"(latitude|longitude|ownerId|userId)"/);
    await expect(b.page.getByTestId('preparty-masked-circle')).toHaveCount(1);
    await expect(b.page.getByTestId('preparty-exact-pin')).toHaveCount(0);
    await clickInsideCircle(b.page);
    await b.page.getByTestId('request-access-btn').click();
    await expect(b.page.getByTestId('request-pending')).toBeVisible({ timeout: 10_000 });

    // ── A accepts ──
    await gotoMap(a.page);
    await openPinPopup(a.page);
    await a.page.getByTestId('accept-request-btn').click();
    await expect(a.page.getByTestId('accept-request-btn')).toHaveCount(0, { timeout: 10_000 });

    // ── B now sees the exact pin and can open the chat ──
    await gotoMap(b.page);
    await expect(b.page.getByTestId('preparty-exact-pin')).toHaveCount(1);
    await expect(b.page.getByTestId('preparty-masked-circle')).toHaveCount(0);
    await openPinPopup(b.page);
    await b.page.getByTestId('open-event-chat-btn').click();
    await b.page.waitForURL('**/en/messages/**', { timeout: 10_000 });
    await b.page.goto(url('en', '/messages'));
    await waitForAppStable(b.page);
    await expect(b.page.locator('[data-testid="chat-list-item"]').first()).toBeVisible({ timeout: 10_000 });

    // ── A ends it now; it disappears for B ──
    await gotoMap(a.page);
    await a.page.getByTestId('share-location-btn').click();
    await a.page.getByTestId('end-party-btn').click();
    await expect(a.page.getByTestId('share-location-btn')).toContainText(/Create Party/i, { timeout: 10_000 });
    await gotoMap(b.page);
    await expect(b.page.getByTestId('preparty-exact-pin')).toHaveCount(0);
    await expect(b.page.getByTestId('preparty-masked-circle')).toHaveCount(0);

    expect(nominatimRequests).toEqual([]);
    await a.context.close();
    await b.context.close();
  });

  test('TC22: Block a group via chat options', async ({ browser }) => {
    // Chats only exist after a match (CHAT_CREATION = match-only).
    await ensureMatch(browser);
    const ctx = await browser.newContext({ storageState: getAuthFile('A') });
    const page = await ctx.newPage();

    await page.goto(url('en', '/search-groups'));
    await waitForAppStable(page);

    const messageBtn = page.locator('[data-testid="message-button"]');
    if (await messageBtn.count() > 0) {
      await messageBtn.first().click();
      await page.waitForURL('**/messages/**', { timeout: 10_000 });
      await waitForAppStable(page);

      const optionsBtn = page.locator('[data-testid="chat-options-btn"]');
      if (await optionsBtn.count() > 0) {
        await optionsBtn.click();
        await page.waitForTimeout(300);

        const blockBtn = page.locator('[data-testid="block-group-btn"]');
        if (await blockBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await blockBtn.click();
          await page.waitForTimeout(300);

          const confirmBtn = page.locator('[data-testid="block-confirm-btn"]');
          if (await confirmBtn.count() > 0) {
            await expect(confirmBtn).toBeVisible();
          }
        }
      }
    }

    await ctx.close();
  });

  test('TC22: Report a group', async ({ browser }) => {
    await ensureMatch(browser);
    const ctx = await browser.newContext({ storageState: getAuthFile('A') });
    const page = await ctx.newPage();

    await page.goto(url('en', '/search-groups'));
    await waitForAppStable(page);

    const messageBtn = page.locator('[data-testid="message-button"]');
    if (await messageBtn.count() > 0) {
      await messageBtn.first().click();
      await page.waitForURL('**/messages/**', { timeout: 10_000 });
      await waitForAppStable(page);

      const optionsBtn = page.locator('[data-testid="chat-options-btn"]');
      if (await optionsBtn.count() > 0) {
        await optionsBtn.click();
        await page.waitForTimeout(300);

        const reportBtn = page.locator('[data-testid="report-group-btn"]');
        if (await reportBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await reportBtn.click();
          await page.waitForTimeout(1000);

          const toast = page.getByText(/Report|Meldung|sent|gesendet/i);
          await toast.isVisible({ timeout: 3000 }).catch(() => {});
        }
      }
    }

    await ctx.close();
  });

  test('TC22: A confirmed block hides the chat for both users (BLOCKED_CHAT = hidden-for-both)', async ({ browser }) => {
    await ensureMatch(browser);

    const ctxA = await browser.newContext({ storageState: getAuthFile('A') });
    const pageA = await ctxA.newPage();
    const ctxB = await browser.newContext({ storageState: getAuthFile('B') });
    const pageB = await ctxB.newPage();

    try {
      // A opens the chat and blocks B's group.
      await pageA.goto(url('en', '/search-groups'));
      await waitForAppStable(pageA);
      await pageA.locator('[data-testid="message-button"]').first().click();
      await pageA.waitForURL('**/messages/**', { timeout: 10_000 });
      await waitForAppStable(pageA);
      const chatPath = new URL(pageA.url()).pathname;

      await pageA.locator('[data-testid="chat-options-btn"]').click();
      await pageA.locator('[data-testid="block-group-btn"]').click();
      await pageA.locator('[data-testid="block-confirm-btn"]').click();
      await pageA.waitForURL(/\/en\/messages$/, { timeout: 10_000 });
      await waitForAppStable(pageA);
      await expect(pageA.locator('[data-testid="chat-list-item"]')).toHaveCount(0);

      // B no longer sees the chat, and opening it by URL sends B back to the list.
      await pageB.goto(url('en', '/messages'));
      await waitForAppStable(pageB);
      await expect(pageB.locator('[data-testid="chat-list-item"]')).toHaveCount(0);
      await pageB.goto(chatPath);
      await pageB.waitForURL(/\/en\/messages$/, { timeout: 10_000 });
      await expect(pageB.locator('[data-testid="chat-message-input"]')).toHaveCount(0);
    } finally {
      // Clean up: A unblocks B again (Messages → options → Blocked Groups → Unblock).
      await pageA.goto(url('en', '/messages'));
      await waitForAppStable(pageA);
      await pageA.getByRole('button', { name: 'Options' }).click();
      await pageA.getByRole('button', { name: /Blocked Groups/i }).click();
      const unblock = pageA.getByRole('button', { name: /^Unblock$/i });
      if (await unblock.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
        await unblock.first().click();
        await expect(unblock).toHaveCount(0, { timeout: 10_000 });
      }
      await ctxA.close();
      await ctxB.close();
    }
  });
});
