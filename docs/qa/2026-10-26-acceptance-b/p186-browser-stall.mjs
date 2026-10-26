// #186 in Edge: the inspector itself becomes a stalled reader. While it replays a large history
// (download throttled through CDP so replay is in progress), its JavaScript is paused for 9 s via
// the DevTools debugger, so Chromium stops draining the response and the gateway sees no drain.
// Expect: the server's explicit slow-consumer failure (or a severed stream), a visible retry
// reason, an automatic resume from the inspector's cursor, and a complete contiguous Timeline.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { makeTemp, removeTemp, startApi, restClient, logger, edge, delay, until, HERE } from './lib.mjs';
import { cycle } from './defs.mjs';

const PORT = 6457;
const log = logger('p186-browser-stall.log.txt');
const data = await makeTemp('186bst');
const results = {};
let api;
let browser;
const rowsOf = (page) => page.$$eval('ol[aria-label="Timeline"] button[data-seq]', (b) => b.map((x) => Number(x.dataset.seq)));
const headingOf = async (page) => {
  const t = await page.locator('h2').filter({ hasText: /^Timeline \(/ }).first().textContent().catch(() => '');
  const m = /Timeline \((\d+) events, ([^)]+)\)/.exec(t ?? '');
  return m ? { total: Number(m[1]), status: m[2] } : { total: NaN, status: t };
};
try {
  api = await startApi({ port: PORT, dataDir: data, log });
  const rest = restClient(api.url);
  const loop = await rest.createLoop(cycle({ name: 'Heavy browser stall', passes: 200, blobChars: 196_608 }));
  const run = await rest.start(loop.loop.id, {});
  await rest.waitStatus(run.id, ['succeeded'], { timeout: 600_000, interval: 500 });
  const last = (await rest('GET', `/runs/${run.id}`)).lastEventSeq;
  results.lastEventSeq = last;
  browser = await edge();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => {
    window.__alerts = [];
    new MutationObserver(() => {
      for (const el of document.querySelectorAll('[role="alert"]')) {
        const t = el.textContent ?? '';
        if (t && window.__alerts.at(-1) !== t) window.__alerts.push(t);
      }
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  const page = await context.newPage();
  const sseRequests = [];
  page.on('request', (req) => {
    if (req.headers()['accept']?.includes('text/event-stream')) sseRequests.push(new URL(req.url()).search);
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: 1_500_000, uploadThroughput: -1 });
  await page.goto(`${api.url}/app/runs/${run.id}`);
  await until(async () => (await headingOf(page)).total > 20, { timeout: 120_000, what: 'replay in progress' });
  const atPause = await headingOf(page);
  await cdp.send('Debugger.enable');
  await cdp.send('Debugger.pause');
  await delay(9000);
  await cdp.send('Debugger.resume');
  await cdp.send('Debugger.disable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  const afterResume = [];
  for (let i = 0; i < 16; i++) {
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    afterResume.push({
      ms: i * 250,
      heading: await headingOf(page),
      fellBehind: body.includes('The reader fell behind'),
      apiUnreachableBanner: body.includes('Cannot reach the GraphGoblin API'),
      offline: body.includes('You are offline'),
    });
    await delay(250);
  }
  results.afterResume = afterResume;
  await until(async () => {
    const h = await headingOf(page);
    return h.total === last && h.status === 'complete';
  }, { timeout: 300_000, interval: 500, what: 'complete after the stall' });
  const rows = await rowsOf(page);
  const alerts = await page.evaluate(() => window.__alerts);
  results.atPause = atPause;
  results.sseRequests = sseRequests;
  results.alerts = alerts;
  results.tail = rows.slice(-3);
  results.contiguous = rows.every((s, i) => i === 0 || s === rows[i - 1] + 1);
  results.ok = results.contiguous && rows.at(-1) === last && sseRequests.length >= 2;
  log(results.ok ? 'PASS' : 'FAIL', 'stalled inspector recovers from its cursor with a complete contiguous Timeline', results);
  await page.screenshot({ path: join(HERE, 'p186-browser-stall.png') });
} catch (error) {
  log('ERROR', String(error?.stack ?? error));
  results.error = String(error?.stack ?? error);
} finally {
  await writeFile(join(HERE, 'p186-browser-stall.json'), JSON.stringify(results, null, 2));
  await browser?.close();
  await api?.kill();
  await removeTemp(data);
  await log.flush();
}
