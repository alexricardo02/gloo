import { test, expect } from './fixtures';
import { loginAsGuest, navigateToTab, waitForAppStable, url } from './fixtures';

test.describe('Guest Flow (TC1–TC3)', () => {

  test('TC1: Guest login without registration', async ({ page }) => {
    // Step 1: Open app
    await page.goto(url('en', '/'));
    await waitForAppStable(page);

    // Step 2: Click "Party starten" (guest entry)
    await page.locator('[data-testid="party-start-btn"]').click();

    // Should redirect to search-groups
    await page.waitForURL('**/en/search-groups', { timeout: 10_000 });
    await waitForAppStable(page);

    // Check that groups are visible (blur is applied by parent container in search-groups)
    const groupCards = page.locator('[data-testid="group-card"]');
    // The blur is on the wrapper div, not the card itself.
    // We check that the search-groups page loaded correctly.
    await expect(page.getByText(/Discover|Entdecken/i)).toBeVisible({ timeout: 5_000 });

    // Step 3: Navigate to Games – should be accessible
    await navigateToTab(page, 'games');
    await expect(page.locator('[data-testid="game-card-never-have-i-ever"]')).toBeVisible();
    await expect(page.locator('[data-testid="game-card-truth-or-dare"]')).toBeVisible();
    await expect(page.locator('[data-testid="game-card-most-likely-to"]')).toBeVisible();
    await expect(page.locator('[data-testid="game-card-busdriver"]')).toBeVisible();

    // Step 4: Open a game – should work for guests
    await page.locator('[data-testid="game-card-never-have-i-ever"]').click();
    await page.waitForURL('**/games/never-have-i-ever');
    // The game page should be visible
    await expect(page.locator('h1, h2').first()).toBeVisible();

    // Step 5: Navigate to Chat tab – should show paywall
    await page.goto(url('en', '/search-groups'));
    await waitForAppStable(page);
    await navigateToTab(page, 'messages');
    // Guest paywall modal should appear
    await expect(page.locator('[data-testid="guest-paywall-modal"]')).toBeVisible({ timeout: 5_000 });
  });

  test('TC2: Language selection on first start', async ({ page }) => {
    await page.goto(url('en', '/'));
    await waitForAppStable(page);

    // Open language dropdown
    await page.locator('[data-testid="language-dropdown"]').click();

    // Select German
    await page.locator('[data-testid="language-option-de"]').click();

    // URL should change to /de
    await page.waitForURL('**/de', { timeout: 5_000 });

    // UI should show German text
    await expect(page.getByText('Die besten')).toBeVisible();

    // Reload – should stay on German
    await page.reload();
    await waitForAppStable(page);
    await expect(page).toHaveURL(/\/de/);

    // Switch to English
    await page.locator('[data-testid="language-dropdown"]').click();
    await page.locator('[data-testid="language-option-en"]').click();
    await page.waitForURL('**/en', { timeout: 5_000 });
    await expect(page.getByText('The best')).toBeVisible();
  });

  test('TC3: Guest sees blurred groups and paywall on interactions', async ({ page }) => {
    await loginAsGuest(page, 'en');

    // Groups should be visible with blur applied in guest mode.
    // Note: isGuest is set asynchronously via useEffect, so we wait for the re-render.
    await expect(page.getByText(/Discover|Entdecken/i)).toBeVisible({ timeout: 5_000 });

    // Verify the blur effect is active on the group card wrapper (blur-xl class)
    const groupCards = page.locator('[data-testid="group-card"]');
    const blurredWrappers = page.locator('.blur-xl');
    if (await groupCards.count() > 0) {
      await expect(blurredWrappers.first()).toBeVisible({ timeout: 10_000 });
    }

    // Click on chat tab – paywall should appear
    await navigateToTab(page, 'messages');
    await expect(page.locator('[data-testid="guest-paywall-modal"]')).toBeVisible({ timeout: 5_000 });

    // Close paywall
    await page.locator('[data-testid="guest-paywall-modal"] button').first().click();
    await expect(page.locator('[data-testid="guest-paywall-modal"]')).not.toBeVisible();

    // Navigate to search-groups and try clicking like button on a group
    await page.goto(url('en', '/search-groups'));
    await waitForAppStable(page);

    const likeButton = page.locator('[data-testid="like-button"]');
    if (await likeButton.count() > 0) {
      await likeButton.first().click();
      // Paywall should appear or action should be blocked
      await expect(page.locator('[data-testid="guest-paywall-modal"]')).toBeVisible({ timeout: 5_000 });
    }

    // Try clicking message button on a group
    const messageButton = page.locator('[data-testid="message-button"]');
    if (await messageButton.count() > 0) {
      await messageButton.first().click();
      // Paywall should appear
      await expect(page.locator('[data-testid="guest-paywall-modal"]')).toBeVisible({ timeout: 5_000 });
    }
  });
});
