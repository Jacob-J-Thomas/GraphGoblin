// Reviewer check (WP-425 scan 2): does Playwright's page.clock.setFixedTime freeze
// performance.now(), which the editor's history uses for its 1000 ms coalescing window?
// Run: pnpm --filter @graphgoblin/web exec tsx <this file>
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
const { chromium } = createRequire(join(root, 'apps', 'web', 'package.json'))(
  '@playwright/test',
) as typeof import('@playwright/test');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();
await page.setContent('<p>clock</p>');
await page.clock.setFixedTime(new Date());
const a = await page.evaluate(() => ({ date: Date.now(), perf: performance.now() }));
await new Promise((r) => setTimeout(r, 1500));
const b = await page.evaluate(() => ({ date: Date.now(), perf: performance.now() }));
console.log(
  JSON.stringify({
    dateAdvancedMs: b.date - a.date,
    performanceNowAdvancedMs: Math.round(b.perf - a.perf),
    realWaitMs: 1500,
  }),
);
await browser.close();
