import config from '../../../apps/web/playwright.config.js';
import { fileURLToPath } from 'node:url';
export default {
  ...config,
  testDir: fileURLToPath(new URL('../../../apps/web/e2e', import.meta.url)),
  globalSetup: fileURLToPath(new URL('./browser-setup.mjs', import.meta.url)),
  outputDir: fileURLToPath(new URL('../../../output/playwright/wp-e1-186', import.meta.url)),
};
