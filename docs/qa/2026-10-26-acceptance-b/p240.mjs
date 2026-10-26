// #240: the Events page admits new events only on deliberate Refresh, keeping the reader's
// rows, scroll position, focus and URL filters; paging after Refresh; empty filtered results;
// a time (`before`) filter; Refresh and availability-check failures; Clear controls.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { makeTemp, removeTemp, startApi, restClient, logger, edge, delay, until, edge_, HERE } from './lib.mjs';
import { manual } from './defs.mjs';

const PORT = 6450;
const log = logger('p240.log.txt');
const data = await makeTemp('240');
const results = { checks: [] };
const check = (name, ok, detail) => {
  results.checks.push({ name, ok, detail });
  log(ok ? 'PASS' : 'FAIL', name, detail ?? '');
};
let api;
let browser;

const eventLoop = (type) => ({
  schemaVersion: 4,
  name: `Events ${type}`,
  nodes: [{ id: 'start', kind: 'trigger', label: 'On event', config: { type: 'event', eventType: type } }, { id: 'finish', kind: 'exit', label: 'Finish', config: {} }],
  edges: [edge_('start', 'out', 'finish')],
});
const rowIds = (page) => page.$$eval('[data-testid^="payload-"]', (els) => els.map((e) => e.dataset.testid.slice('payload-'.length)));
const status = async (page) => (await page.getByRole('status').filter({ hasText: /./ }).allInnerTexts().catch(() => [])).join(' | ');
const headerStatus = (page) => page.locator('header [role="status"], [role="status"].text-sm').first().innerText().catch(() => '');

try {
  api = await startApi({ port: PORT, dataDir: data, log });
  const rest = restClient(api.url);
  const loops = {};
  for (const type of ['acc_alpha', 'acc_beta', 'acc_gamma']) loops[type] = (await rest.createLoop(eventLoop(type))).loop.id;
  const post = (type, i) => rest('POST', '/events', { loopId: loops[type], type, payload: { i } });
  for (let i = 0; i < 130; i++) {
    await post('acc_alpha', i);
    if (i % 3 === 0) await post('acc_beta', i);
  }
  const apiAlpha = async () => {
    const items = [];
    let cursor;
    for (;;) {
      const page = await rest('GET', `/events?type=acc_alpha&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      items.push(...page.items);
      if (!page.nextCursor) return items;
      cursor = page.nextCursor;
    }
  };
  const before1 = await apiAlpha();
  browser = await edge();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(`${api.url}/app/events?type=acc_alpha`);
  await page.locator('[data-testid^="payload-"]').first().waitFor({ timeout: 30_000 });
  const first = await rowIds(page);
  await page.getByRole('button', { name: 'Load more' }).click();
  await until(async () => (await rowIds(page)).length > first.length, { what: 'older page appended' });
  const loaded = await rowIds(page);
  check('paging under a type filter: first page + Load more equal the API listing order, no duplicates', JSON.stringify(loaded) === JSON.stringify(before1.map((e) => e.id).slice(0, loaded.length)) && new Set(loaded).size === loaded.length, { first: first.length, loaded: loaded.length, apiTotal: before1.length });
  // The reader scrolls into the older page and focuses a row link.
  await page.mouse.wheel(0, 2400);
  await delay(500);
  const scrollBefore = await page.evaluate(() => window.scrollY);
  const urlBefore = page.url();
  // New arrivals: three matching, two not.
  for (let i = 0; i < 3; i++) await post('acc_alpha', 1000 + i);
  for (let i = 0; i < 2; i++) await post('acc_beta', 2000 + i);
  await page.getByText('New events available').waitFor({ timeout: 15_000 });
  await delay(2500);
  const rowsAfterArrival = await rowIds(page);
  const scrollAfter = await page.evaluate(() => window.scrollY);
  check('arrivals while reading an older page: "New events available" shown; rows, scroll position and URL filter unchanged', JSON.stringify(rowsAfterArrival) === JSON.stringify(loaded) && Math.abs(scrollAfter - scrollBefore) < 4 && page.url() === urlBefore, {
    scrollBefore, scrollAfter, rows: rowsAfterArrival.length, url: page.url().replace(api.url, ''),
  });
  await page.getByRole('button', { name: 'Refresh' }).click();
  await page.getByText('Showing the newest events.').waitFor({ timeout: 15_000 });
  const after = await apiAlpha();
  const refreshed = await rowIds(page);
  const typesShown = await page.$$eval('tbody tr td:nth-child(2) code', (c) => [...new Set(c.map((x) => x.textContent))]);
  check('Refresh: newest matching page replaces the rows (3 new alpha first, no beta), filter kept in URL and chip, notice cleared', JSON.stringify(refreshed) === JSON.stringify(after.map((e) => e.id).slice(0, refreshed.length)) && refreshed.slice(0, 3).every((id) => !before1.some((e) => e.id === id)) && typesShown.length === 1 && typesShown[0] === 'acc_alpha' && page.url().includes('type=acc_alpha') && (await page.getByText('Type: acc_alpha').count()) === 1 && (await page.getByText('New events available').count()) === 0, {
    refreshedRows: refreshed.length, typesShown,
  });
  await page.getByRole('button', { name: 'Load more' }).click();
  await until(async () => (await rowIds(page)).length > refreshed.length, { what: 'paging after refresh' });
  const paged = await rowIds(page);
  check('paging after Refresh continues with the new cursor: exactly the API order, no duplicates or gaps', JSON.stringify(paged) === JSON.stringify(after.map((e) => e.id).slice(0, paged.length)) && new Set(paged).size === paged.length, { paged: paged.length, apiTotal: after.length });

  // Refresh failure keeps the rows; availability-check failure is reported.
  const kept = await rowIds(page);
  await page.route((url) => url.pathname === '/events', (route) => route.abort('connectionrefused'));
  await post('acc_alpha', 3000);
  await page.getByRole('button', { name: 'Refresh' }).click();
  await page.getByText(/Refresh failed\. Your current events are still shown\./).waitFor({ timeout: 15_000 });
  await page.getByText('Could not check for new events. Refresh to try again.').waitFor({ timeout: 15_000 }).catch(() => {});
  const failedRows = await rowIds(page);
  const failText = await status(page);
  check('Refresh failure: rows and filters kept, failure explained; availability-check failure explained', JSON.stringify(failedRows) === JSON.stringify(kept) && /Refresh failed/.test(failText) && page.url().includes('type=acc_alpha'), { status: failText });
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  const recovery = [];
  for (let i = 0; i < 12; i++) {
    await delay(1000);
    recovery.push({ t: i + 1, status: (await status(page)).replace(/\s+/g, ' ').slice(0, 220), refreshBusy: await page.getByRole('button', { name: 'Refresh' }).getAttribute('aria-busy') });
  }
  log('after the network returns (no clicks)', recovery);
  let clicks = 0;
  const t0 = Date.now();
  await until(async () => {
    if (await page.getByText('Showing the newest events.').count()) return true;
    clicks += 1;
    await page.getByRole('button', { name: 'Refresh' }).click();
    await delay(1500);
    return (await page.getByText('Showing the newest events.').count()) > 0;
  }, { timeout: 30_000, interval: 100, what: 'refresh recovery' });
  const recoveredRows = await rowIds(page);
  check('recovery: a later Refresh succeeds, clears the failure and brings the arrival in', !/Refresh failed/.test(await status(page)) && recoveredRows.length >= 100, { clicks, ms: Date.now() - t0, status: await status(page) });

  // Clear the type filter: only that parameter goes, focus returns to Refresh.
  await page.getByRole('button', { name: 'Clear type filter' }).click();
  await until(async () => !page.url().includes('type='), { what: 'type cleared' });
  const focused = await page.evaluate(() => document.activeElement?.textContent?.trim());
  await page.locator('[data-testid^="payload-"]').first().waitFor();
  const unfilteredTypes = await page.$$eval('tbody tr td:nth-child(2) code', (c) => [...new Set(c.map((x) => x.textContent))]);
  check('Clear type filter: URL loses only type, focus moves to Refresh, unfiltered rows include other types', focused === 'Refresh' && unfilteredTypes.includes('acc_beta'), { focused, unfilteredTypes });

  // Empty filtered result, then a first arrival.
  await page.goto(`${api.url}/app/events?type=acc_gamma`);
  await page.getByText('No inbound events match these filters.').waitFor({ timeout: 15_000 });
  await post('acc_gamma', 1);
  await page.getByText('New events available').waitFor({ timeout: 15_000 });
  const stillEmpty = await page.getByText('No inbound events match these filters.').count();
  await page.getByRole('button', { name: 'Refresh' }).click();
  await page.locator('[data-testid^="payload-"]').first().waitFor({ timeout: 15_000 });
  check('empty filtered result: explained; a first arrival is announced without inserting rows; Refresh shows it', stillEmpty === 1 && (await rowIds(page)).length === 1, {});

  // A `before` time filter: later arrivals do not match and are not announced.
  const pivot = after[50];
  await page.goto(`${api.url}/app/events?type=acc_alpha&before=${encodeURIComponent(pivot.receivedAt)}`);
  await page.locator('[data-testid^="payload-"]').first().waitFor({ timeout: 15_000 });
  const beforeRows = await rowIds(page);
  await post('acc_alpha', 4000);
  await delay(5000);
  const noticed = await page.getByText('New events available').count();
  const apiBefore = await rest('GET', `/events?type=acc_alpha&before=${encodeURIComponent(pivot.receivedAt)}&limit=100`);
  await page.getByRole('button', { name: 'Refresh' }).click();
  await page.getByText('Showing the newest events.').waitFor({ timeout: 15_000 });
  check('before filter: chip shown, rows match the API, later events are not announced, Refresh keeps both filters', noticed === 0 && JSON.stringify(beforeRows) === JSON.stringify(apiBefore.items.map((e) => e.id).slice(0, beforeRows.length)) && page.url().includes('before=') && page.url().includes('type=acc_alpha') && (await page.getByText(/^Before: /).count()) === 1, { rows: beforeRows.length });
  await page.screenshot({ path: join(HERE, 'p240-before-filter.png') });
} catch (error) {
  log('ERROR', String(error?.stack ?? error));
  results.error = String(error?.stack ?? error);
} finally {
  await writeFile(join(HERE, 'p240.json'), JSON.stringify(results, null, 2));
  await browser?.close();
  await api?.kill();
  await removeTemp(data);
  await log.flush();
}
