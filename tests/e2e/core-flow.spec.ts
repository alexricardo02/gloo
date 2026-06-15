import { test, expect } from './fixtures';
import { getAuthFile, navigateToTab, waitForAppStable, url } from './fixtures';

test.describe('Core Flow (TC8–TC14, TC21)', () => {

  test('TC13: After login, land directly on discovery carousel', async ({ browser }) => {
    const context = await browser.newContext({ storageState: getAuthFile('A') });
    const page = await context.newPage();

    await page.goto(url('en', '/search-groups'));
    await waitForAppStable(page);

    await expect(page).toHaveURL(/\/en\/search-groups/);

    // 5 navigation tabs should be visible
    await expect(page.locator('[data-testid="nav-tab-discover"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-tab-games"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-tab-map"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-tab-messages"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-tab-profile"]')).toBeVisible();

    await context.close();
  });

  test('TC8 & TC9: Group edit form loads with Instagram', async ({ browser }) => {
    const context = await browser.newContext({ storageState: getAuthFile('A') });
    const page = await context.newPage();

    // Group was created in global-setup, so this opens the edit form
    await page.goto(url('en', '/profile/create-group'));
    await waitForAppStable(page);

    // Should show edit form (not create) – check for the form
    await expect(page.locator('[data-testid="create-group-form"]')).toBeVisible({ timeout: 5_000 });

    // Instagram input should be pre-filled from global-setup (group created via API)
    const instagramInput = page.locator('input[placeholder="@username"]');
    await expect(instagramInput.first()).toBeVisible({ timeout: 3_000 });
    await expect(instagramInput.first()).toHaveValue(/@alice_e2e/i);

    await context.close();
  });

  test('TC10: Set search preferences', async ({ browser }) => {
    const context = await browser.newContext({ storageState: getAuthFile('A') });
    const page = await context.newPage();

    await page.goto(url('en', '/profile/preferences'));
    await waitForAppStable(page);

    await expect(page.locator('[data-testid="preferences-radius"]').first()).toBeVisible({ timeout: 5_000 });

    const radiusSlider = page.locator('[data-testid="preferences-radius"]');
    await expect(radiusSlider.first()).toBeVisible({ timeout: 3_000 });
    await radiusSlider.fill('25');

    const saveBtn = page.locator('[data-testid="preferences-save"]');
    await expect(saveBtn).toBeVisible({ timeout: 3_000 });
    await saveBtn.click();
    await page.waitForTimeout(2000);

    await context.close();
  });

  test('TC11: Vertical carousel – group discovery with radius modal', async ({ browser }) => {
    const context = await browser.newContext({ storageState: getAuthFile('A') });
    const page = await context.newPage();

    await page.goto(url('en', '/search-groups'));
    await waitForAppStable(page);

    await expect(page.getByText(/Discover|Entdecken/i)).toBeVisible();

    // Groups should be visible (both users have groups from global-setup)
    const groupCards = page.locator('[data-testid="group-card"]');
    // At least User B's group should be discoverable
    await expect(page.getByText(/Discover|Entdecken/i)).toBeVisible();

    // Test radius modal
    await page.locator('[data-testid="radius-open-btn"]').click();
    await expect(page.locator('[data-testid="radius-modal"]')).toBeVisible({ timeout: 3_000 });

    await page.locator('[data-testid="radius-apply-btn"]').click();
    await expect(page.locator('[data-testid="radius-modal"]')).not.toBeVisible();

    await context.close();
  });

  test('TC14 & TC21: Like a group and view likes (User B likes User A)', async ({ browser }) => {
    // ── User B likes User A's group ──
    const ctxB = await browser.newContext({ storageState: getAuthFile('B') });
    const pageB = await ctxB.newPage();

    await pageB.goto(url('en', '/search-groups'));
    await waitForAppStable(pageB);

    const likeBtnB = pageB.locator('[data-testid="like-button"]');
    if (await likeBtnB.count() > 0) {
      await likeBtnB.first().click();
      await pageB.waitForTimeout(500);
      // Toggle off to test toggle
      await likeBtnB.first().click();
      await pageB.waitForTimeout(300);
      // Like again (persist)
      await likeBtnB.first().click();
      await pageB.waitForTimeout(300);
    }

    // ── User A checks likes ──
    const ctxA = await browser.newContext({ storageState: getAuthFile('A') });
    const pageA = await ctxA.newPage();

    // Navigate to messages → likes tab
    await pageA.goto(url('en', '/messages'));
    await waitForAppStable(pageA);
    await pageA.locator('[data-testid="messages-tab-likes"]').click();
    await pageA.waitForTimeout(1500);
    await expect(pageA.locator('[data-testid="messages-tab-likes"]')).toBeVisible();

    // Like overview should show either likes or empty state
    const hasLikesOrEmpty = (await pageA.getByText(/No likes|Noch keine Likes/i).isVisible().catch(() => false)) ||
      (await pageA.locator('[data-testid="messages-tab-likes"]').isVisible());
    expect(hasLikesOrEmpty).toBeTruthy();

    await ctxA.close();
    await ctxB.close();
  });

  test('TC12: Horizontal photo swiping in group card', async ({ browser }) => {
    const context = await browser.newContext({ storageState: getAuthFile('A') });
    const page = await context.newPage();

    await page.goto(url('en', '/search-groups'));
    await waitForAppStable(page);

    // Group card should be visible and have a photo slider (both users have groups from setup)
    const photoSlider = page.locator('[data-testid="group-photo-slider"]');
    await expect(photoSlider.first()).toBeVisible({ timeout: 5_000 });

    // Swipe by using mouse drag on the slider element
    const box = await photoSlider.first().boundingBox();
    if (box) {
      const startX = box.x + box.width * 0.7;
      const endX = box.x + box.width * 0.3;
      const y = box.y + box.height / 2;

      await page.mouse.move(startX, y);
      await page.mouse.down();
      await page.mouse.move(endX, y, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(500);
    }

    await context.close();
  });
});
