import { test, expect } from './fixtures';
import { getTestCredentials, waitForAppStable, url } from './fixtures';
import {
  emailFlowsEnabled,
  fillAndSubmitRegister,
  freshUser,
  loginViaUi,
  logoutViaProfile,
  registerAndSignIn,
} from './helpers/auth';

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

  test('Registration – form marks its client instance ready and keeps values typed into it', async ({ page }) => {
    await page.goto(url('en', '/register'));
    // The SSR/hydration instance (data-ready="false") is remounted on the client;
    // input typed before that was lost and blocked submit in global-setup.
    const form = page.locator('[data-testid="register-form"]');
    await expect(form).toHaveAttribute('data-ready', 'true');

    await page.fill('[data-testid="register-name-input"]', 'Ready User');
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid="register-name-input"]')).toHaveValue('Ready User');
    await expect(form).toHaveAttribute('data-ready', 'true');
  });

  test('TC5: Registration – duplicate email does not reveal that the account exists (S14)', async ({ page }) => {
    test.skip(!emailFlowsEnabled(), 'Only with EMAIL_FLOWS_ENABLED=true ("check your email" screen)');
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

    // Same "check your email" screen as a brand-new registration; no error.
    await expect(page.locator('[data-testid="register-success"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="register-error-msg"]')).toHaveCount(0);
  });

  test('TC5: Registration – duplicate email shows "already registered" (email flows off)', async ({ page, baseURL }) => {
    test.skip(emailFlowsEnabled(), 'Only with email flows off');

    await fillAndSubmitRegister(page, baseURL!, { ...freshUser('dupmail'), email: creds.userA.email });

    await expect(page.locator('[data-testid="register-error-msg"]')).toHaveText(
      'This email address is already registered.',
      { timeout: 10_000 }
    );
    await expect(page).toHaveURL(/\/en\/register/);
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

    if (emailFlowsEnabled()) {
      await expect(page.locator('[data-testid="register-success"]')).toBeVisible({ timeout: 10_000 });
    } else {
      // Email flows off: signed in directly and taken to the discovery page.
      await page.waitForURL('**/en/search-groups', { timeout: 15_000 });
      await expect(page.locator('[data-testid="nav-tab-discover"]')).toBeVisible();
    }
    // The saved draft is cleared entirely after a successful registration.
    expect(await page.evaluate(() => sessionStorage.getItem('gloo_register_data'))).toBeNull();
  });

  test('Registration – password is never persisted to sessionStorage', async ({ page }) => {
    const readDraft = () => page.evaluate(() => sessionStorage.getItem('gloo_register_data'));

    // Legacy data written by an older version of the page, including a password.
    await page.goto(url('en', '/register'));
    await page.evaluate(() => sessionStorage.setItem('gloo_register_data', JSON.stringify({
      name: 'Legacy User', email: 'legacy@test.com', dob: '', username: 'legacyuser',
      password: 'LegacyPass123!', agreed: false,
    })));
    await page.reload();
    await waitForAppStable(page);

    // Non-secret fields are restored, the password is not, and storage is sanitized.
    await expect(page.locator('[data-testid="register-username-input"]')).toHaveValue('legacyuser');
    await expect(page.locator('[data-testid="register-password-input"]')).toHaveValue('');
    await expect.poll(readDraft).not.toContain('LegacyPass123!');
    expect(JSON.parse((await readDraft())!)).not.toHaveProperty('password');

    // Typing a password never writes it to storage.
    await page.fill('[data-testid="register-name-input"]', 'Typed User');
    await page.fill('[data-testid="register-password-input"]', 'TypedPass123!');
    await expect.poll(async () => JSON.parse((await readDraft()) ?? '{}').name).toBe('Typed User');
    const draft = (await readDraft())!;
    expect(draft).not.toContain('TypedPass123!');
    expect(JSON.parse(draft)).not.toHaveProperty('password');
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

test.describe('Email flows off (default)', () => {
  test.beforeEach(() => {
    test.skip(emailFlowsEnabled(), 'Only with EMAIL_FLOWS_ENABLED unset/false');
  });

  test('register → signed in on discover → log out → log back in with the (unverified) account', async ({ page, baseURL }) => {
    const user = freshUser('direct');

    await registerAndSignIn(page, baseURL!, user);
    await expect(page.locator('[data-testid="nav-tab-profile"]')).toBeVisible();

    await logoutViaProfile(page, baseURL!);

    // The account was never verified; login must still work.
    await loginViaUi(page, baseURL!, user.username, user.password);
    await page.waitForURL('**/en/search-groups', { timeout: 15_000 });
    await expect(page.locator('[data-testid="nav-tab-discover"]')).toBeVisible();
    await expect(page.locator('[data-testid="login-error-msg"]')).toHaveCount(0);
  });

  test('password recovery is hidden and its pages show "unavailable"', async ({ page }) => {
    await page.goto(url('en', '/login'));
    await expect(page.locator('[data-testid="login-form"]')).toBeVisible();
    await expect(page.locator('[data-testid="login-forgot-password-link"]')).toHaveCount(0);

    for (const path of ['/forgotPassword', '/resetPassword?token=anything']) {
      await page.goto(url('en', path));
      await expect(page.locator('[data-testid="password-recovery-unavailable"]')).toBeVisible();
    }
    await page.locator('[data-testid="password-recovery-back-to-login"]').click();
    await page.waitForURL('**/en/login');
  });

  test('the verify page redirects to login instead of erroring', async ({ page }) => {
    await page.goto(url('en', '/verify?token=anything'));
    await page.waitForURL('**/en/login', { timeout: 10_000 });
    await expect(page.locator('[data-testid="login-form"]')).toBeVisible();
  });
});

test.describe('Change password (signed in)', () => {
  test('wrong current password is rejected; a valid change keeps you signed in; only the new password works', async ({ page, baseURL }) => {
    const user = freshUser('chpw', 'OldPass123!');
    const newPassword = 'NewPass456!';

    await registerAndSignIn(page, baseURL!, user);
    await page.goto(url('en', '/profile/account'));
    await expect(page.locator('[data-testid="change-password-form"]')).toBeVisible();
    // The reset-by-email button only exists while email flows are on.
    await expect(page.locator('[data-testid="account-reset-link-btn"]')).toHaveCount(emailFlowsEnabled() ? 1 : 0);

    // Wrong current password
    await page.fill('[data-testid="change-password-current-input"]', 'NotMyPass123!');
    await page.fill('[data-testid="change-password-new-input"]', newPassword);
    await page.fill('[data-testid="change-password-confirm-input"]', newPassword);
    await page.locator('[data-testid="change-password-submit-btn"]').click();
    await expect(page.locator('[data-testid="change-password-error-msg"]')).toHaveText(
      'Your current password is incorrect.'
    );

    // Correct change
    await page.fill('[data-testid="change-password-current-input"]', user.password);
    await page.fill('[data-testid="change-password-new-input"]', newPassword);
    await page.fill('[data-testid="change-password-confirm-input"]', newPassword);
    await page.locator('[data-testid="change-password-submit-btn"]').click();
    await expect(page.locator('[data-testid="change-password-success"]')).toBeVisible();

    // This session survived the change.
    await page.reload();
    await expect(page.locator('[data-testid="change-password-form"]')).toBeVisible();

    await logoutViaProfile(page, baseURL!);

    await loginViaUi(page, baseURL!, user.email, user.password);
    await expect(page.locator('[data-testid="login-error-msg"]')).toBeVisible();

    await loginViaUi(page, baseURL!, user.email, newPassword);
    await page.waitForURL('**/en/search-groups', { timeout: 15_000 });
  });
});
