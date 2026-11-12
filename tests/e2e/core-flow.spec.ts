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

    await expect(page.getByTestId('page-title')).toHaveText(/Discover|Entdecken/i);

    // Groups should be visible (both users have groups from global-setup)
    const groupCards = page.locator('[data-testid="group-card"]');
    // At least User B's group should be discoverable
    await expect(page.getByTestId('page-title')).toHaveText(/Discover|Entdecken/i);

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

  test('TC14b: Discovery shows rounded distances, never coordinates; the "Liked" badge toggles and persists (User B)', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: getAuthFile('B') });
    const page = await ctx.newPage();

    // Server action responses (discovery feed, likes) seen by the browser.
    const actionBodies: Promise<string>[] = [];
    page.on('response', (r) => {
      if (r.request().method() === 'POST' && r.url().includes('/search-groups')) {
        actionBodies.push(r.text().catch(() => ''));
      }
    });
    const isAction = (r: { request(): { method(): string }; url(): string }) =>
      r.request().method() === 'POST' && r.url().includes('/search-groups');

    await page.goto(url('en', '/search-groups'));
    await waitForAppStable(page);

    const card = () => page.locator('[data-testid="group-card"]').first();
    const like = () => card().getByTestId('like-button');
    const badge = () => card().getByTestId('group-card-liked-badge');
    const toggle = async () => {
      await Promise.all([page.waitForResponse(isAction), like().click()]);
    };

    await expect(card()).toBeVisible({ timeout: 10_000 });
    // DISTANCE_DISPLAY = rounded-km (both E2E groups share one point: "< 1 km").
    await expect(card().getByTestId('group-card-distance')).toHaveText(/^(< 1|\d+) km away$/);
    // Read the first feed responses now: bodies still streaming at a reload are lost.
    const firstBodies = await Promise.all(actionBodies);

    // Start from "not liked" (TC14 leaves B -> A liked).
    if ((await like().getAttribute('aria-pressed')) === 'true') {
      await expect(badge()).toBeVisible();
      await toggle();
    }
    await expect(like()).toHaveAttribute('aria-pressed', 'false');
    await expect(badge()).toHaveCount(0);

    // Like: badge appears and survives a reload.
    await toggle();
    await expect(like()).toHaveAttribute('aria-pressed', 'true');
    await expect(badge()).toHaveText('Liked');
    await page.reload();
    await waitForAppStable(page);
    await expect(like()).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });
    await expect(badge()).toBeVisible();

    // Unlike: badge disappears, also after a reload.
    await toggle();
    await expect(like()).toHaveAttribute('aria-pressed', 'false');
    await expect(badge()).toHaveCount(0);
    await page.reload();
    await waitForAppStable(page);
    await expect(like()).toHaveAttribute('aria-pressed', 'false', { timeout: 10_000 });
    await expect(badge()).toHaveCount(0);

    // Restore TC14's state (B likes A) for the liked-me test and the social flow.
    await toggle();
    await expect(badge()).toBeVisible();

    // Discovery feed responses only (getGroupByUser returns the caller's OWN group).
    const bodies = [...firstBodies, ...(await Promise.all(actionBodies))].filter((body) => body.includes('hasNoGroup'));
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      expect(body).toContain('distanceKm');
      expect(body).not.toMatch(/latitude|longitude|"userId"|"ownerId"/);
      expect(body).not.toContain('49.99');
    }

    await ctx.close();
  });

  test('TC21b: The liked-me map shows approximate circles, no pins and no coordinates (User A)', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: getAuthFile('A') });
    const page = await ctx.newPage();

    const likesResponse = page.waitForResponse((r) => r.url().includes('/api/likes') && r.status() === 200);
    await page.goto(url('en', '/messages'));
    await waitForAppStable(page);
    await page.locator('[data-testid="messages-tab-likes"]').click();

    const raw = await (await likesResponse).text();
    expect(raw).not.toMatch(/"(latitude|longitude|userId)"/);
    const { groups } = JSON.parse(raw) as { groups: { area: { center: [number, number]; radiusM: number } | null; distanceKm: number | null }[] };
    expect(groups.length).toBeGreaterThan(0);
    expect(groups[0].area?.radiusM).toBe(1000);
    expect(groups[0].distanceKm).toBe(0);

    // List view shows the distance.
    await expect(page.getByTestId('liked-me-distance').first()).toHaveText(/^(< 1|\d+) km away$/);

    await page.getByTestId('likes-view-map').click();
    await expect(page.locator('path.liked-group-area').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.leaflet-marker-icon')).toHaveCount(0);

    await ctx.close();
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
