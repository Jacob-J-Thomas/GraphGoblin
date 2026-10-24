import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

/** The refresh regression uses a disposable built API, without the source/fake control server. */
export default defineConfig({
  ...base,
  globalSetup: './e2e/events-refresh-setup.ts',
  testMatch: 'events-refresh.spec.ts',
  retries: 0,
});
