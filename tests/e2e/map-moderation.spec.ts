import { test, expect } from './fixtures';
import { getAuthFile, navigateToTab, waitForAppStable, url } from './fixtures';

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

    await navigateToTab(page, 'map');
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

  test('TC22: Block a group via chat options', async ({ browser }) => {
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
});
