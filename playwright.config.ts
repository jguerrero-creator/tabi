import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  // Serial, single-worker: tests run against the real remote Supabase
  // project and each spins up a fresh anonymous session. Running several
  // in parallel can trip Supabase's anonymous sign-in rate limiting.
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5180',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node tests/e2e/support/dev-server.mjs',
    url: 'http://localhost:5180',
    reuseExistingServer: true,
    stdout: 'pipe',
  },
})
