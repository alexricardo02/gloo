import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    globals: true,
    exclude: ['tests/e2e/**', '**/node_modules/**'],
  },
})