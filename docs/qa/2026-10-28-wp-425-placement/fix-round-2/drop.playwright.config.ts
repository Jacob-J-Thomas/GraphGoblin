import { fileURLToPath } from 'node:url';
import base from '../../../../apps/web/playwright.config.js';

export default {
  ...base,
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  testMatch: 'drop-settlement.spec.ts',
  globalSetup: fileURLToPath(new URL('../../../../apps/web/e2e/global-setup.ts', import.meta.url)),
};
