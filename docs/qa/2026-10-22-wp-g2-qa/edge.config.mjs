import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const { defineConfig, devices } = createRequire(join(root, 'apps/web/package.json'))(
  '@playwright/test',
);
export default defineConfig({
  testDir: join(root, 'apps/web/e2e'),
  testMatch: ['history.spec.ts'],
  globalSetup: join(root, 'docs/qa/2026-10-22-wp-g2-qa/edge-setup.mjs'),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: [['list']],
  outputDir: join(process.env.GG_QA_TEMP_ROOT, 'edge-results'),
  use: { trace: 'off', serviceWorkers: 'allow', viewport: { width: 1440, height: 900 } },
  projects: [
    {
      name: 'edge',
      use: {
        ...devices['Desktop Chrome'],
        channel: process.env.GG_E2E_BROWSER_CHANNEL ?? 'msedge',
      },
    },
  ],
});
