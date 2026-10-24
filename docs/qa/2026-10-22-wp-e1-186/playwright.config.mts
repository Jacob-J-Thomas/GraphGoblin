import config from '../../../apps/web/playwright.config.js';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export default {
  ...config,
  testDir: fileURLToPath(new URL('../../../apps/web/e2e', import.meta.url)),
  globalSetup: fileURLToPath(new URL('./browser-setup.mjs', import.meta.url)),
  outputDir: mkdtempSync(join(tmpdir(), 'gg-wp-e1-186-')),
};
