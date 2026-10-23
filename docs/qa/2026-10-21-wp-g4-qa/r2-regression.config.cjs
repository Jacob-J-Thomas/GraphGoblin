const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../../..');
const { defineConfig } = createRequire(path.join(root, 'apps/web/package.json'))(
  '@playwright/test',
);
module.exports = defineConfig({
  testDir: path.join(root, 'apps/web/e2e'),
  testMatch: ['exit-primitives.spec.ts', 'classifiers.spec.ts'],
  grep: /authors a gate and terminal exits|an exit that returns None is understandable|maximum-length route label|a classifier Choice gate explains/,
  globalSetup: require.resolve('./r2-regression-setup.cjs'),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: [['list']],
  outputDir: path.join(root, 'docs/qa/2026-10-21-wp-g4-qa/r2-browser-output'),
  use: {
    channel: process.env.GG_E2E_BROWSER_CHANNEL || 'msedge',
    headless: true,
    viewport: { width: 1440, height: 900 },
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
});
