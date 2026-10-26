import { createRequire } from 'node:module';
import { join } from 'node:path';
import { repo, evidence } from './qa-lib.mjs';
const require = createRequire(new URL('../../../../apps/web/package.json', import.meta.url)),
  { defineConfig, devices } = require('@playwright/test');
export default defineConfig({
  testDir: join(repo, 'apps/web/e2e'),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: [['list']],
  outputDir: join(evidence, 'edge-output'),
  use: {
    ...devices['Desktop Chrome'],
    channel: 'msedge',
    viewport: { width: 1440, height: 900 },
    trace: 'off',
    screenshot: 'off',
  },
});
