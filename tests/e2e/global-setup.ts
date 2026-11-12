import { chromium, FullConfig, type Page } from '@playwright/test';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { assertSafeTestDb } from '../assertSafeTestDb';
import { applyRlsLockdown } from '../applyRlsLockdown';
import { callE2eApi as postE2eApi, emailFlowsEnabled, registerAndSignIn } from './helpers/auth';

const AUTH_DIR = path.join(__dirname, '.auth');
const AUTH_FILE_A = path.join(AUTH_DIR, 'userA.json');
const AUTH_FILE_B = path.join(AUTH_DIR, 'userB.json');
const PROJECT_ROOT = path.join(__dirname, '../..');

async function callE2eApi(baseURL: string, action: string, email: string, label?: string) {
  await postE2eApi(baseURL, action, email, label);
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
  console.log(
    `[global-setup] Registering ${label}: ${user.email} (email flows ${emailFlowsEnabled() ? 'ON: verify + login' : 'OFF: signed in directly'})`
  );

  // Email flows off (default): registration signs the user in directly.
  // Email flows on: verified via the E2E API route, then logged in.
  await registerAndSignIn(page, baseURL, user);
  console.log(`[global-setup] ${label} registered and signed in`);

  return user;
}

async function globalSetup(config: FullConfig) {
  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }

  const baseURL =
    (config.projects[0]?.use?.baseURL as string) ||
    `http://localhost:${process.env.E2E_PORT ?? 3100}`;

  // Wait for dev server
  console.log('[global-setup] Waiting for dev server...');
  await waitForServer(`${baseURL}/en`);

  // SAFETY: the next command wipes the target database. Re-validate the URL
  // right here (not only in playwright.config.ts) and pass it explicitly so
  // Prisma can never fall back to DIRECT_URL from `.env` (prisma.config.ts
  // loads dotenv, which does not override vars that are already set).
  const testDbUrl = assertSafeTestDb(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL');

  // Push schema (force-reset for clean test state)
  console.log('[global-setup] Pushing Prisma schema to the test database...');
  execSync('npx prisma db push --force-reset --accept-data-loss', {
    cwd: PROJECT_ROOT,
    env: { ...process.env, DATABASE_URL: testDbUrl, DIRECT_URL: testDbUrl },
    stdio: 'inherit',
  });
  // `db push` skips raw-SQL migrations; run E2E with the production RLS lockdown.
  await applyRlsLockdown(testDbUrl, PROJECT_ROOT);
  console.log('[global-setup] Applied the deny-all RLS migration.');

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
