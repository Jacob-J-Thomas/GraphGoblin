import { defineConfig } from '@playwright/test';
import config from './playwright.config.js';

/** #255: built packages, physical disposable storage and this worker's reserved ports. */
export default defineConfig({
  ...config,
  globalSetup: './e2e/execution-evidence-setup.ts',
  testMatch: '**/execution-evidence.capture.ts',
  retries: 0,
});
