import { test, expect } from './fixtures';
import { getTestCredentials, waitForAppStable, url } from './fixtures';

test.describe('Auth Flow (TC4–TC7)', () => {
  let creds: ReturnType<typeof getTestCredentials>;

  test.beforeAll(() => {
    creds = getTestCredentials();
  });

  test('TC5: Registration – invalid inputs', async ({ page }) => {
    await page.goto(url('en', '/register'));
    await waitForAppStable(page);

    // Submit button is disabled until terms are accepted
    await expect(page.locator('[data-testid="register-submit-btn"]')).toBeDisabled();

    // Accept terms, fill minimal data, leave required fields empty → server error
    const termsCheckbox = page.locator('input[type="checkbox"]').first();
    await termsCheckbox.check();
    await page.locator('[data-testid="register-submit-btn"]').click();
    // HTML5 validation should block, or server returns an error
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid="register-form"]')).toBeVisible();

    // Test weak password (age-under-18 can't be tested via UI due to date max attr)
    await page.fill('[data-testid="register-name-input"]', 'Weak User');
    await page.fill('[data-testid="register-email-input"]', 'weakpass@test.com');
    await page.fill('[data-testid="register-username-input"]', 'weakuser99');
    await page.fill('[data-testid="register-password-input"]', '123');
    await page.fill('[data-testid="register-dob-input"]', '2000-01-01');
    await page.locator('[data-testid="register-submit-btn"]').click();

    await expect(page.locator('[data-testid="register-error-msg"]')).toBeVisible({ timeout: 5_000 });
  });

  test('TC5: Registration – duplicate email', async ({ page }) => {
    await page.goto(url('en', '/register'));
    await waitForAppStable(page);

    // Use User A's already-registered email
    await page.fill('[data-testid="register-name-input"]', 'Duplicate User');
    await page.fill('[data-testid="register-email-input"]', creds.userA.email);
    await page.fill('[data-testid="register-username-input"]', 'unique_user_' + Date.now());
    await page.fill('[data-testid="register-password-input"]', 'ValidPass123!');
    await page.fill('[data-testid="register-dob-input"]', '2000-01-01');

    const termsCheckbox = page.locator('input[type="checkbox"]').first();
    await termsCheckbox.check();
    await page.locator('[data-testid="register-submit-btn"]').click();

    await expect(page.locator('[data-testid="register-error-msg"]')).toBeVisible({ timeout: 5_000 });
  });

  test('TC4: Registration – valid input', async ({ page }) => {
    await page.goto(url('en', '/register'));
    await waitForAppStable(page);

    const uniqueEmail = `fresh_${Date.now()}@test.com`;
    const uniqueUser = `freshuser_${Date.now()}`;

    await page.fill('[data-testid="register-name-input"]', 'Fresh User');
    await page.fill('[data-testid="register-email-input"]', uniqueEmail);
    await page.fill('[data-testid="register-username-input"]', uniqueUser);
    await page.fill('[data-testid="register-password-input"]', 'FreshPass123!');
    await page.fill('[data-testid="register-dob-input"]', '2000-01-01');

    const termsCheckbox = page.locator('input[type="checkbox"]').first();
    await termsCheckbox.check();
    await page.locator('[data-testid="register-submit-btn"]').click();

    await expect(page.locator('[data-testid="register-success"]')).toBeVisible({ timeout: 10_000 });
  });

  test('TC7: Login – invalid credentials', async ({ page }) => {
    await page.goto(url('en', '/login'));
    await waitForAppStable(page);

    // Test wrong password
    await page.fill('[data-testid="login-identifier-input"]', creds.userA.email);
    await page.fill('[data-testid="login-password-input"]', 'WrongPass123!');
    await page.locator('[data-testid="login-submit-btn"]').click();
    await expect(page.locator('[data-testid="login-error-msg"]')).toBeVisible({ timeout: 5_000 });

    // Test non-existent email
    await page.fill('[data-testid="login-identifier-input"]', `nonexistent_${Date.now()}@test.com`);
    await page.fill('[data-testid="login-password-input"]', 'SomePass123!');
    await page.locator('[data-testid="login-submit-btn"]').click();
    await expect(page.locator('[data-testid="login-error-msg"]')).toBeVisible({ timeout: 5_000 });

    // Test empty form
    await page.fill('[data-testid="login-identifier-input"]', '');
    await page.fill('[data-testid="login-password-input"]', '');
    await page.locator('[data-testid="login-submit-btn"]').click();
    await expect(page.locator('[data-testid="login-form"]')).toBeVisible();
  });

  test('TC6: Login – valid credentials', async ({ page }) => {
    await page.goto(url('en', '/login'));
    await waitForAppStable(page);

    await page.fill('[data-testid="login-identifier-input"]', creds.userA.email);
    await page.fill('[data-testid="login-password-input"]', creds.userA.password);
    await page.locator('[data-testid="login-submit-btn"]').click();

    await page.waitForURL('**/en/search-groups', { timeout: 10_000 });
    await waitForAppStable(page);

    await expect(page.locator('[data-testid="nav-tab-discover"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-tab-games"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-tab-map"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-tab-messages"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-tab-profile"]')).toBeVisible();
  });
});
