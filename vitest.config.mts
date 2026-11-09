import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import { resolveTestEnv } from './tests/testEnv'

// Load ONLY .env.test (never .env) and force DATABASE_URL / DIRECT_URL to the
// guarded TEST_DATABASE_URL. Throws before any test runs if the database is
// not a local "*_test" database.
const testEnv = resolveTestEnv()
Object.assign(process.env, testEnv)

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    globals: true,
    env: testEnv,
    // Re-checks the effective env inside every worker before any test file loads.
    setupFiles: ['./tests/setup/assertTestDb.setup.ts'],
    exclude: ['tests/e2e/**', '**/node_modules/**'],
  },
})
