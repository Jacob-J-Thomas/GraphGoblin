import { defineConfig, devices } from '../../../apps/web/node_modules/@playwright/test/index.mjs';
export default defineConfig({
  testDir: '.', testMatch: 'script-recovery.spec.ts', workers: 1, retries: 0,
  timeout: 60000, expect: { timeout: 10000 }, reporter: [['list']], outputDir: 'native-browser-results',
  use: { ...devices['Desktop Chrome'], channel: 'msedge', viewport: { width: 1440, height: 900 }, trace: 'off' },
});
