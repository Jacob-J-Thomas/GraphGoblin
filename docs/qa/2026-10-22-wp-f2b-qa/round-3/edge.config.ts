import { defineConfig } from '../../../../apps/web/node_modules/@playwright/test/index.mjs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export default defineConfig({
  testDir: fileURLToPath(new URL('../../../../apps/web/e2e', import.meta.url)),
  globalSetup: './edge-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: [['json']],
  outputDir: join(tmpdir(), 'gg-qa-204-r3-edge-results'),
  use: {
    channel: 'msedge',
    viewport: { width: 1440, height: 900 },
    serviceWorkers: 'allow',
    trace: 'off',
    screenshot: 'off',
  },
});
