// Reference copy from the earlier QA, not executed in this re-check.
// Executed replacement: a11y-strict.mjs plus a11y-pause.mjs.
// Check 5 (accessibility and wording), keyboard and screen-reader view of the two modes:
//  - what the live regions announce while following live, and how often (10 s window);
//  - a keyboard-only path: Tab from the page start to the Timeline, Enter on a completion,
//    then Shift+Tab to Follow live and Enter; where focus lands after each step;
//  - the accessible names and states of the thread panel, the patch diff and the current row
//    in each mode (Playwright ARIA snapshots).
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { makeTemp, removeTemp, startApi, restClient, logger, edge, delay, until, cycle, inspectorState, HERE } from './lib.mjs';

const PORT = 6618;
const log = logger('a11y.log.txt');
const data = await makeTemp('a11y');
const results = { checks: [] };
const check = (name, ok, detail) => {
  results.checks.push({ name, ok, detail });
  log(ok ? 'PASS' : 'FAIL', name, detail ?? '');
};
let api;
let browser;
const focused = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    return { tag: el?.tagName, seq: el?.dataset?.seq ? Number(el.dataset.seq) : undefined, text: (el?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 50) };
  });
try {
  api = await startApi({ port: PORT, dataDir: data, log });
  const rest = restClient(api.url);
  const loop = await rest.createLoop(cycle({ name: 'QA a11y' }));
  const run = await rest.start(loop.loop.id);
  await until(async () => (await rest.run(run.id)).lastEventSeq >= 500, { timeout: 120_000, what: '500 events' });
  browser = await edge();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__live = [];
    const seen = new WeakMap();
    new MutationObserver(() => {
      for (const el of document.querySelectorAll('[aria-live]')) {
        const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (t && seen.get(el) !== t) {
          seen.set(el, t);
          window.__live.push({ at: performance.now(), politeness: el.getAttribute('aria-live'), text: t });
        }
      }
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  await page.goto(`${api.url}/app/runs/${run.id}`);
  await page.getByRole('heading', { name: 'Current thread' }).waitFor({ timeout: 60_000 });
  await delay(3000);

  // 1. Live-region traffic while following live.
  const t0 = await page.evaluate(() => performance.now());
  await delay(10_000);
  const live = await page.evaluate((from) => window.__live.filter((e) => e.at >= from), t0);
  const byText = {};
  for (const e of live) {
    const key = e.text.replace(/\d[\d,–-]*/g, '#');
    byText[key] = (byText[key] ?? 0) + 1;
  }
  results.liveRegionsWhileFollowing = { windowSeconds: 10, changes: live.length, byPattern: byText, sample: live.slice(0, 5).map((e) => e.text) };
  check('while following live, live regions do not announce on every stream batch (at most one change per 2 s)', live.length <= 5, results.liveRegionsWhileFollowing);

  // 2. ARIA view while following.
  const timelineSection = page.locator('section').filter({ has: page.getByRole('heading', { name: /^Timeline \(/ }) });
  results.ariaFollowing = {
    thread: (await page.locator('section').filter({ has: page.getByRole('heading', { name: 'Current thread', exact: true }) }).ariaSnapshot()).slice(0, 600),
    currentRow: await page.locator('ol[aria-label="Timeline"] button[aria-current="true"]').ariaSnapshot().catch(() => 'none'),
    timelineHeading: await timelineSection.getByRole('heading').first().textContent(),
  };

  // 3. Keyboard only: Tab from the start of the page to the first Timeline row.
  await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press('Home');
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  let tabs = 0;
  let f = await focused(page);
  while (f.seq === undefined && tabs < 80) {
    await page.keyboard.press('Tab');
    tabs++;
    f = await focused(page);
  }
  const reachedRow = f.seq;
  // Move to a completion with the arrow keys, then Enter.
  let guard = 0;
  let rowName = await page.evaluate(() => document.activeElement?.textContent ?? '');
  while (!/node\.finished/.test(rowName) && guard++ < 10) {
    await page.keyboard.press('ArrowDown');
    rowName = await page.evaluate(() => document.activeElement?.textContent ?? '');
  }
  const target = (await focused(page)).seq;
  const tSel = await page.evaluate(() => performance.now());
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: `Thread at event ${target}` }).waitFor({ timeout: 30_000 });
  await until(async () => !(await inspectorState(page)).reading.some((r) => r.startsWith('Reading the thread')), { timeout: 30_000, what: 'read finished' });
  const afterEnter = await focused(page);
  const selAnnouncements = await page.evaluate((from) => window.__live.filter((e) => e.at >= from).map((e) => e.text), tSel);
  results.ariaSelected = {
    thread: (await page.locator('section').filter({ has: page.getByRole('heading', { name: `Thread at event ${target}` }) }).ariaSnapshot()).slice(0, 600),
    patch: (await page.getByRole('list', { name: 'Patch diff' }).ariaSnapshot().catch(() => 'none')).slice(0, 600),
    currentRow: await page.locator('ol[aria-label="Timeline"] button[aria-current="true"]').ariaSnapshot().catch(() => 'none'),
  };
  check('keyboard: Tab reaches the Timeline rows; Enter on a completion selects it and keeps focus on that row; its reading note is announced', reachedRow !== undefined && afterEnter.seq === target && selAnnouncements.some((t) => t === `Reading the thread at event ${target}…`), {
    tabsToFirstRow: tabs, firstFocusedRow: reachedRow, selected: target, focusAfterEnter: afterEnter, announcementsAfterEnter: selAnnouncements.slice(0, 6),
  });

  // 4. Back to Follow live by keyboard. First try Shift+Tab alone (up to 200 presses), recording
  //    where focus goes; then the Home key (first retained row) followed by Shift+Tab.
  let back = 0;
  f = await focused(page);
  const trail = [];
  while (f.text !== 'Follow live' && back < 200) {
    await page.keyboard.press('Shift+Tab');
    back++;
    f = await focused(page);
    if (back <= 5 || back % 50 === 0) trail.push({ press: back, ...f });
  }
  const shiftTabOnly = { presses: back, reachedFollowLive: f.text === 'Follow live', trail };
  let viaHome;
  if (f.text !== 'Follow live') {
    await page.keyboard.press('Home');
    const atHome = await focused(page);
    let n = 0;
    while (f.text !== 'Follow live' && n < 20) {
      await page.keyboard.press('Shift+Tab');
      n++;
      f = await focused(page);
    }
    viaHome = { atHome, shiftTabsAfterHome: n, reachedFollowLive: f.text === 'Follow live' };
  }
  results.keyboardBackToFollowLive = { shiftTabOnly, viaHome };
  check('keyboard: Shift+Tab from a Timeline row reaches Follow live within 200 presses', shiftTabOnly.reachedFollowLive, results.keyboardBackToFollowLive);
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'Current thread' }).waitFor({ timeout: 30_000 });
  await delay(500);
  const afterFollow = await focused(page);
  check('keyboard: Follow live reached with Shift+Tab and activated with Enter keeps focus in the Timeline controls', afterFollow.tag !== 'BODY', {
    shiftTabsToFollowLive: back, focusAfterFollowLive: afterFollow,
  });
  await page.keyboard.press('Tab');
  const nextAfterFollow = await focused(page);
  results.focusAfterFollowLiveThenTab = nextAfterFollow;
  await page.screenshot({ path: join(HERE, 'a11y-following.png') });
  await rest('POST', `/runs/${run.id}/cancel`, {});
} catch (error) {
  log('ERROR', String(error?.stack ?? error));
  results.error = String(error?.stack ?? error);
} finally {
  await writeFile(join(HERE, 'a11y.json'), JSON.stringify(results, null, 2) + '\n');
  await browser?.close();
  await api?.kill();
  await removeTemp(data);
  await log.flush();
}
