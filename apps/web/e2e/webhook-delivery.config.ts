import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'webhook-delivery.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  outputDir: `../output/playwright/webhook-${Date.now()}`,
  use: { channel: 'msedge', headless: true, viewport: { width: 1440, height: 1000 } },
});
