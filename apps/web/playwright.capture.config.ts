import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

/**
 * The screenshot set of every screen (#41): `pnpm --filter @graphgoblin/web capture:screens` after
 * `pnpm build`. Same server, browser, and fixtures as the E2E suite, but only `*.capture.ts`, which
 * the suite itself never runs. See e2e/screens.capture.ts for the options.
 */
export default defineConfig({
  ...base,
  testMatch: '**/*.capture.ts',
  timeout: 60 * 60_000,
  retries: 0,
});
