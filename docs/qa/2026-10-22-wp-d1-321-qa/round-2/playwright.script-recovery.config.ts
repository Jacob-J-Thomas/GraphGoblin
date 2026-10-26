import { defineConfig } from '../../../../apps/web/node_modules/@playwright/test/index.mjs';
export default defineConfig({
  testDir: '.',
  testMatch: 'script-recovery.browser.ts',
  workers: 1,
  retries: 0,
  timeout: 180000,
  expect: { timeout: 15000 },
  outputDir: 'standalone-edge-results',
  reporter: 'line',
  use: { channel: 'msedge', headless: true, viewport: { width: 1440, height: 1000 } },
});
