import { chromium, FullConfig, type Page } from '@playwright/test';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import http from 'http';

const AUTH_DIR = path.join(__dirname, '.auth');
const AUTH_FILE_A = path.join(AUTH_DIR, 'userA.json');
const AUTH_FILE_B = path.join(AUTH_DIR, 'userB.json');
const PROJECT_ROOT = path.join(__dirname, '../..');

async function callE2eApi(baseURL: string, action: string, email: string, label?: string) {
  const res = await fetch(`${baseURL}/api/e2e`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-e2e-secret': process.env.E2E_TEST_SECRET! },
    body: JSON.stringify({ action, email, label }),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`E2E API ${action} failed for ${email}: ${data.error || res.statusText}`);
  }
  console.log(`[global-setup] E2E API: ${action} OK for ${email}`);
}

async function waitForServer(url: string, maxRetries = 30): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await new Promise<void>((resolve, reject) => {
        http.get(url, (res) => {
          res.resume();
          resolve();
        }).on('error', reject);
      });
      console.log(`[global-setup] Server ready at ${url}`);
      return;
    } catch {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  throw new Error(`Server not reachable at ${url} after ${maxRetries}s`);
}

async function registerAndLogin(
  page: Page,
  baseURL: string,
  user: { name: string; username: string; email: string; password: string },
  label: string
) {
  console.log(`[global-setup] Registering ${label}: ${user.email}`);

  await page.goto(`${baseURL}/en/register`);
  await page.waitForSelector('[data-testid="register-form"]', { timeout: 10_000 });
  await page.fill('[data-testid="register-name-input"]', user.name);
  await page.fill('[data-testid="register-email-input"]', user.email);
  await page.fill('[data-testid="register-username-input"]', user.username);
  await page.fill('[data-testid="register-password-input"]', user.password);
  await page.fill('[data-testid="register-dob-input"]', '2000-01-01');

  const termsCheckbox = page.locator('input[type="checkbox"]').first();
  await termsCheckbox.check();
  await page.locator('[data-testid="register-submit-btn"]').click();

  await page.waitForSelector('[data-testid="register-success"]', { timeout: 15_000 });
  console.log(`[global-setup] ${label} registration successful`);

  // Verify user via E2E API route (uses Next.js server's DB connection)
  await callE2eApi(baseURL, 'verify', user.email);

  // Login
  console.log(`[global-setup] Logging in ${label}...`);
  await page.goto(`${baseURL}/en/login`);
  await page.waitForSelector('[data-testid="login-form"]', { timeout: 10_000 });
  await page.fill('[data-testid="login-identifier-input"]', user.email);
  await page.fill('[data-testid="login-password-input"]', user.password);
  await page.locator('[data-testid="login-submit-btn"]').click();
  await page.waitForURL('**/en/search-groups', { timeout: 15_000 });
  console.log(`[global-setup] ${label} login successful`);

  return user;
}

async function globalSetup(config: FullConfig) {
  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }

  const baseURL = config.projects[0]?.use?.baseURL as string || 'http://localhost:3000';

  // Wait for dev server
  console.log('[global-setup] Waiting for dev server...');
  await waitForServer(`${baseURL}/en`);

  // Push schema (force-reset for clean test state)
  console.log('[global-setup] Pushing Prisma schema...');
  execSync('npx prisma db push --force-reset --accept-data-loss', {
    cwd: PROJECT_ROOT,
    env: { ...process.env },
    stdio: 'inherit',
  });

  const timestamp = Date.now();

  // ── User A ──
  const userA = {
    name: 'Alice E2E',
    username: `e2ealice_${timestamp}`,
    email: `e2e_alice_${timestamp}@test.com`,
    password: 'AliceE2E123!',
  };

  const browserA = await chromium.launch({ headless: true });
  const contextA = await browserA.newContext({ ignoreHTTPSErrors: true });
  const pageA = await contextA.newPage();

  await registerAndLogin(pageA, baseURL, userA, 'User A');
  await contextA.storageState({ path: AUTH_FILE_A });
  await browserA.close();

  // ── User B ──
  const userB = {
    name: 'Bob E2E',
    username: `e2ebob_${timestamp}`,
    email: `e2e_bob_${timestamp}@test.com`,
    password: 'BobE2E123!',
  };

  const browserB = await chromium.launch({ headless: true });
  const contextB = await browserB.newContext({ ignoreHTTPSErrors: true });
  const pageB = await contextB.newPage();

  await registerAndLogin(pageB, baseURL, userB, 'User B');
  await contextB.storageState({ path: AUTH_FILE_B });
  await browserB.close();

  // ── Create groups via E2E API route ──
  await callE2eApi(baseURL, 'create-group', userA.email, 'Alice');
  await callE2eApi(baseURL, 'create-group', userB.email, 'Bob');

  // Save credentials
  fs.writeFileSync(
    path.join(AUTH_DIR, 'test-credentials.json'),
    JSON.stringify({ userA, userB }, null, 2)
  );

  console.log('[global-setup] Done – both users with groups ready.');
}

export default globalSetup;
