import { defineConfig, devices } from '@playwright/test';

/**
 * E2E against the built app served by the API (see e2e/server.ts). Not part of `test:coverage`;
 * run `pnpm build` first, then `pnpm --filter @graphgoblin/web test:e2e`.
 *
 * Browser: Playwright's bundled Chromium by default. Set GG_E2E_BROWSER_CHANNEL (for example
 * `msedge` or `chrome`) to use an installed browser instead; on Windows it defaults to `msedge`,
 * which every Windows 11 machine has, so no browser download is needed there.
 */
const channel =
  process.env['GG_E2E_BROWSER_CHANNEL'] ?? (process.platform === 'win32' ? 'msedge' : undefined);

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    trace: 'retain-on-failure',
    serviceWorkers: 'allow',
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        ...(channel ? { channel } : {}),
      },
    },
  ],
});
