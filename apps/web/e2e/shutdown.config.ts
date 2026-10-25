import { defineConfig, devices } from '@playwright/test';

// Shutdown owns its real built-entry process; the shared E2E gateway must stay alive.
export default defineConfig({
  testDir: '.',
  testMatch: 'shutdown.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  outputDir: '../test-results/shutdown',
  use: {
    ...devices['Desktop Chrome'],
    ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
    serviceWorkers: 'block',
    trace: 'on',
  },
});
