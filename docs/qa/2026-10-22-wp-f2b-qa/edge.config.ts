import { defineConfig } from '../../../apps/web/node_modules/@playwright/test/index.mjs';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  testDir: fileURLToPath(new URL('../../../apps/web/e2e', import.meta.url)),
  globalSetup: './edge-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: [['line']],
  outputDir: process.env.TEMP + '/gg-qa-204-edge-results',
  use: {
    channel: 'msedge',
    viewport: { width: 1440, height: 900 },
    serviceWorkers: 'allow',
    trace: 'off',
    screenshot: 'off',
  },
});
