// #186 in Edge: bounded browser retention and Timeline, older-history browsing during execution,
// Go to event, reload, Follow live, a gateway restart (reconnect) and JS heap measurements for
// short and long histories.
import { makeTemp, removeTemp, startApi, restClient, logger, edge, delay, until } from './lib.mjs';
import { cycle } from './defs.mjs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HERE } from './lib.mjs';

const PORT = 6457;
const log = logger('p186-browser.log.txt');
const data = await makeTemp('186web');
const results = { checks: [], heap: [] };
const check = (name, ok, detail) => {
  results.checks.push({ name, ok, detail });
  log(ok ? 'PASS' : 'FAIL', name, detail ?? '');
};
let api;
let browser;

const rowsOf = (page) =>
  page.$$eval('ol[aria-label="Timeline"] button[data-seq]', (buttons) => buttons.map((b) => Number(b.dataset.seq)));
const headingOf = async (page) => {
  const text = await page.locator('h2').filter({ hasText: /^Timeline \(/ }).first().textContent();
  const m = /Timeline \((\d+) events, ([^)]+)\)/.exec(text ?? '');
  return m ? { total: Number(m[1]), status: m[2] } : { total: NaN, status: text };
};
const contiguous = (rows) => rows.every((s, i) => i === 0 || s === rows[i - 1] + 1);

async function measure(page, cdp, label, rest, runId) {
  await cdp.send('HeapProfiler.collectGarbage');
  const { metrics } = await cdp.send('Performance.getMetrics');
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
  const storage = await page.evaluate(() => {
    let bytes = 0;
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      bytes += (k.length + (sessionStorage.getItem(k)?.length ?? 0)) * 2;
    }
    return bytes;
  });
  const entry = {
    label,
    serverLastSeq: (await rest('GET', `/runs/${runId}`)).lastEventSeq,
    heading: await headingOf(page),
    jsHeapUsedMiB: +(m.JSHeapUsedSize / 1048576).toFixed(2),
    domNodes: await page.evaluate(() => document.getElementsByTagName('*').length),
    timelineRowsMounted: (await rowsOf(page)).length,
    sessionStorageBytesUtf16: storage,
  };
  results.heap.push(entry);
  log('measure', entry);
  return entry;
}

async function openInspector(context, url, runId) {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.goto(`${url}/app/runs/${runId}`);
  await page.locator('ol[aria-label="Timeline"] button[data-seq]').first().waitFor({ timeout: 60_000 });
  return { page, cdp };
}

try {
  api = await startApi({ port: PORT, dataDir: data, log });
  const rest = restClient(api.url);
  // Finished histories of ~2k and ~20k events (no browser attached while they execute).
  const shortLoop = await rest.createLoop(cycle({ name: 'Short finished', passes: 400 }));
  const shortRun = await rest.start(shortLoop.loop.id, {});
  await rest.waitStatus(shortRun.id, ['succeeded'], { timeout: 600_000, interval: 1000 });
  const longLoop = await rest.createLoop(cycle({ name: 'Long finished', passes: 4000 }));
  const longRun = await rest.start(longLoop.loop.id, {});
  await rest.waitStatus(longRun.id, ['succeeded'], { timeout: 900_000, interval: 1000 });
  browser = await edge();
  for (const [label, run] of [['finished ~2k events', shortRun], ['finished ~20k events', longRun]]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const { page, cdp } = await openInspector(context, api.url, run.id);
    await page.getByText('Fully finalized.').waitFor({ timeout: 120_000 });
    await until(async () => (await headingOf(page)).status === 'complete', { timeout: 120_000, what: 'complete' });
    await delay(1000);
    await measure(page, cdp, label, rest, run.id);
    await context.close();
  }
  const [s, l] = results.heap;
  check('finished 20k vs 2k events: heap within 25% (+2 MiB), Timeline <= 80 rows, session cache bounded, heading = lastSeq', l.jsHeapUsedMiB < s.jsHeapUsedMiB * 1.25 + 2 && l.timelineRowsMounted <= 80 && l.sessionStorageBytesUtf16 < 1_300_000 && l.heading.total === l.serverLastSeq, {
    short: s, long: l,
  });

  // A live run: browse older history while it executes.
  const liveLoop = await rest.createLoop(cycle({ name: 'Live cycle', passes: 1_000_000 }));
  const run = await rest.start(liveLoop.loop.id, {});
  await until(async () => (await rest('GET', `/runs/${run.id}`)).lastEventSeq >= 3000, { timeout: 300_000, interval: 500, what: '3000 events' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const { page, cdp } = await openInspector(context, api.url, run.id);
  await until(async () => {
    const h = await headingOf(page);
    return h.status === 'live' && (await rest('GET', `/runs/${run.id}`)).lastEventSeq - h.total < 200;
  }, { timeout: 120_000, what: 'inspector caught up' });
  const m1 = await measure(page, cdp, 'live, caught up', rest, run.id);
  await delay(60_000);
  const m2 = await measure(page, cdp, 'live, +60 s', rest, run.id);
  check('live inspector: <= 80 rows, bounded cache, heap stable over a minute of live growth', m2.timelineRowsMounted <= 80 && m2.sessionStorageBytesUtf16 < 1_300_000 && m2.jsHeapUsedMiB < m1.jsHeapUsedMiB * 1.25 + 2, {
    m1: [m1.serverLastSeq, m1.jsHeapUsedMiB], m2: [m2.serverLastSeq, m2.jsHeapUsedMiB],
  });

  const tailRows = await rowsOf(page);
  await page.getByRole('button', { name: 'Load older' }).click();
  await until(async () => (await rowsOf(page))[0] < tailRows[0], { timeout: 30_000, what: 'older rows' });
  const older1 = await rowsOf(page);
  const h1 = await headingOf(page);
  await delay(5000);
  const older1b = await rowsOf(page);
  const h2 = await headingOf(page);
  const status = (await rest('GET', `/runs/${run.id}`)).status;
  check('Load older during execution: contiguous ascending rows, window stays put while the live count advances', status === 'running' && contiguous(older1) && older1[0] < tailRows[0] && JSON.stringify(older1) === JSON.stringify(older1b) && h2.total > h1.total, {
    status, tailFirst: tailRows[0], older: [older1[0], older1.at(-1)], headingBefore: h1.total, headingAfter5s: h2.total, followEnabled: await page.getByRole('button', { name: 'Follow live' }).isEnabled(),
  });
  for (let i = 0; i < 6; i++) {
    const first = (await rowsOf(page))[0];
    const prev = page.getByRole('button', { name: 'Previous rows' });
    if (await prev.isEnabled()) await prev.click();
    else await page.getByRole('button', { name: 'Load older' }).click();
    await until(async () => (await rowsOf(page))[0] < first, { timeout: 30_000, what: 'earlier rows' });
  }
  const older2 = await rowsOf(page);
  check('repeated Previous rows / Load older: contiguous, strictly older', contiguous(older2) && older2[0] < older1[0], { range: [older2[0], older2.at(-1)] });
  const nextBtn = page.getByRole('button', { name: 'Next rows' });
  if (await nextBtn.isEnabled()) await nextBtn.click();
  await delay(1000);
  const next = await rowsOf(page);
  check('Next rows after older browsing: contiguous', contiguous(next) && next[0] > older2[0], { range: [next[0], next.at(-1)] });

  const target = 137;
  await page.getByLabel('Event sequence').fill(String(target));
  await page.getByRole('button', { name: 'Go to event' }).click();
  await page.locator(`ol[aria-label="Timeline"] button[data-seq="${target}"][aria-current="true"]`).waitFor({ timeout: 30_000 });
  await page.getByText(`Thread at event ${target}`).waitFor({ timeout: 60_000 });
  const seekRows = await rowsOf(page);
  await page.getByRole('button', { name: `Exact recorded event #${target}` }).click();
  const shown = await page.getByTestId('recorded-event-json').textContent();
  const apiEvent = (await rest('GET', `/runs/${run.id}/events?after=${target - 1}&limit=1`)).items[0];
  check('Go to event 137 during execution: row selected, "Thread at event 137", recorded JSON equals the API event', seekRows.includes(target) && contiguous(seekRows) && JSON.stringify(JSON.parse(shown)) === JSON.stringify(apiEvent), {
    seekRange: [seekRows[0], seekRows.at(-1)],
  });

  const beforeReload = await rowsOf(page);
  await page.reload();
  await page.locator('ol[aria-label="Timeline"] button[data-seq]').first().waitFor({ timeout: 60_000 });
  await delay(3000);
  const afterReload = await rowsOf(page);
  const followEnabled = await page.getByRole('button', { name: 'Follow live' }).isEnabled();
  check('reload restores the browsed window and history mode', afterReload.includes(beforeReload[0]) && contiguous(afterReload) && followEnabled, {
    before: [beforeReload[0], beforeReload.at(-1)], after: [afterReload[0], afterReload.at(-1)], followEnabled,
  });

  await page.getByRole('button', { name: 'Follow live' }).click();
  await until(async () => {
    const rows = await rowsOf(page);
    const last = (await rest('GET', `/runs/${run.id}`)).lastEventSeq;
    return rows.length > 0 && last - rows.at(-1) < 200 && contiguous(rows);
  }, { timeout: 60_000, what: 'live tail rows' });
  check('Follow live returns to the contiguous tail', true, { tail: (await rowsOf(page)).slice(-3) });

  // Gateway restart while following live.
  const killedAt = (await rest('GET', `/runs/${run.id}`)).lastEventSeq;
  await api.kill();
  await delay(4000);
  const bannerText = await page.locator('body').innerText();
  const outageShown = /Cannot reach the GraphGoblin API|stream error|reconnect|offline/i.test(bannerText);
  api = await startApi({ port: PORT, dataDir: data, log });
  const rest2 = restClient(api.url);
  await until(async () => (await rest2('GET', `/runs/${run.id}`)).lastEventSeq > killedAt + 50, { timeout: 300_000, interval: 1000, what: 'run resumed after restart' });
  await rest2('POST', `/runs/${run.id}/cancel`, {});
  await rest2.waitStatus(run.id, ['cancelled'], { timeout: 120_000 });
  const last = (await rest2('GET', `/runs/${run.id}`)).lastEventSeq;
  await until(async () => (await headingOf(page)).total === last, { timeout: 180_000, what: 'heading reaches final seq' });
  await page.getByText('Fully finalized.').waitFor({ timeout: 60_000 });
  await until(async () => (await headingOf(page)).status === 'complete', { timeout: 60_000, what: 'stream complete' });
  const finalRows = await rowsOf(page);
  check('after a gateway restart the open inspector reconnects: heading = server lastSeq, contiguous tail ending at it, stream complete', finalRows.at(-1) === last && contiguous(finalRows), {
    killedAt, last, outageShown, tail: finalRows.slice(-3),
  });
  await measure(page, cdp, 'live run after restart and cancel', rest2, run.id);
  await page.getByLabel('Event sequence').fill(String(killedAt));
  await page.getByRole('button', { name: 'Go to event' }).click();
  await page.locator(`ol[aria-label="Timeline"] button[data-seq="${killedAt}"]`).waitFor({ timeout: 60_000 });
  const around = await rowsOf(page);
  check('history across the restart boundary is contiguous in the Timeline', contiguous(around) && around.includes(killedAt), { range: [around[0], around.at(-1)] });
  await page.screenshot({ path: join(HERE, 'p186-browser-final.png') });
} catch (error) {
  log('ERROR', String(error?.stack ?? error));
  results.error = String(error?.stack ?? error);
} finally {
  await writeFile(join(HERE, 'p186-browser.json'), JSON.stringify(results, null, 2));
  await browser?.close();
  await api?.kill();
  await removeTemp(data);
  await log.flush();
}
