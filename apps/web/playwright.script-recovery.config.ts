import { defineConfig } from '@playwright/test';

/** A real built API on a disposable #321 store; no shared E2E server or provider. */
export default defineConfig({
  testDir: 'e2e',
  testMatch: 'script-recovery.browser.ts',
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  outputDir: 'test-results/script-recovery',
  use: { channel: 'msedge', headless: true, viewport: { width: 1440, height: 1000 } },
});
