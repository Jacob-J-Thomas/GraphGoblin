import config from './playwright.config.js';
export default {
  ...config,
  globalSetup: './e2e/gg-chore-web-extra-setup.ts',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  outputDir: "<USERPROFILE>\\AppData\\Local\\Temp\\gg-chore-web-browser-extra-bounded-results",
};
