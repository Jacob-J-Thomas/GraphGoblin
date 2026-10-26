// #186 acceptance fix (D1), aligned to the acceptance report's history lengths: an Edge inspector
// starts following run A live at about 5,000 and again at about 10,000 events of A, each time
// after a no-inspector sample at the same length. Run B is the unrelated neighbour on the same
// gateway. Records both runs' event rates and every API read the inspector issued, by kind.
//
// usage: node throughput-at.mjs <label> [web dist directory]
// The optional web dist serves another build of the web app (for example the base build) from
// the same API build; the API, engine and stores are unchanged by this fix.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { makeTemp, removeTemp, startApi, restClient, logger, edge, delay, until, processMemory, cycle, HERE } from './lib.mjs';

const [label, webDist] = process.argv.slice(2);
if (!label) throw new Error('usage: node throughput-at.mjs <label> [web dist directory]');
const PORT = 6513;
const log = logger(`throughput-at-${label}.log.txt`);
const data = await makeTemp('tpat');
const results = { label, webDist: webDist ? 'alternative build (see README)' : 'apps/web/dist', phases: [] };
let api;
let browser;
try {
  api = await startApi({ port: PORT, dataDir: data, log, env: webDist ? { GG_WEB_DIST: webDist } : {} });
  const rest = restClient(api.url);
  const loopA = await rest.createLoop(cycle({ name: 'Observed A', passes: 1_000_000 }));
  const loopB = await rest.createLoop(cycle({ name: 'Neighbour B', passes: 1_000_000 }));
  const a = await rest.start(loopA.loop.id);
  const b = await rest.start(loopB.loop.id);
  const seqOf = async (run) => (await rest('GET', `/runs/${run.id}`)).lastEventSeq;

  browser = await edge();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let requests = {};
  context.on('request', (req) => {
    const u = new URL(req.url());
    if (u.pathname.startsWith('/app/')) return;
    const kind =
      `${req.method()} ${u.pathname.replace(/[0-9A-HJKMNP-TV-Z]{26}/g, ':id')}` +
      (u.searchParams.has('at') ? '?at' : '') +
      (u.searchParams.has('around') ? '?around' : '') +
      (u.searchParams.has('cursor') ? '?cursor' : '');
    requests[kind] = (requests[kind] ?? 0) + 1;
  });

  const phase = async (name, seconds, page) => {
    requests = {};
    const a0 = await seqOf(a);
    const b0 = await seqOf(b);
    const t0 = Date.now();
    await delay(seconds * 1000);
    const a1 = await seqOf(a);
    const b1 = await seqOf(b);
    const s = (Date.now() - t0) / 1000;
    const reads = Object.entries(requests)
      .filter(([kind]) => !kind.startsWith('GET /system/'))
      .reduce((n, [, count]) => n + count, 0);
    let jsHeapMiB;
    if (page) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Performance.enable');
      await cdp.send('HeapProfiler.collectGarbage');
      const { metrics } = await cdp.send('Performance.getMetrics');
      jsHeapMiB = +(metrics.find((m) => m.name === 'JSHeapUsedSize').value / 1048576).toFixed(2);
      await cdp.detach();
    }
    const entry = {
      name,
      seconds: +s.toFixed(1),
      A: { from: a0, to: a1, eventsPerSecond: +((a1 - a0) / s).toFixed(1) },
      B: { from: b0, to: b1, eventsPerSecond: +((b1 - b0) / s).toFixed(1) },
      inspectorReads: reads,
      inspectorReadsPerSecond: +(reads / s).toFixed(2),
      inspectorReadsPer100EventsOfA: a1 > a0 ? +((reads * 100) / (a1 - a0)).toFixed(2) : null,
      requests: { ...requests },
      ...(jsHeapMiB === undefined ? {} : { jsHeapMiB }),
      apiMemory: await processMemory(api.pid),
    };
    results.phases.push(entry);
    log(entry);
  };

  const open = async () => {
    const page = await context.newPage();
    await page.goto(`${api.url}/app/runs/${a.id}`);
    await page.locator('ol[aria-label="Timeline"] li').first().waitFor({ timeout: 120_000 });
    return page;
  };
  const reach = (n) => until(async () => (await seqOf(a)) >= n, { timeout: 900_000, interval: 250, what: `A at ${n} events` });

  await reach(3_200);
  await phase('no inspector (from about 3,200 events)', 15);
  await reach(5_000);
  let page = await open();
  await phase('inspector following A live (from about 5,000 events)', 30, page);
  await page.close();
  await reach(8_200);
  await phase('no inspector (from about 8,200 events)', 15);
  await reach(10_000);
  page = await open();
  await phase('inspector following A live (from about 10,000 events)', 30, page);
  await page.close();
  await phase('inspector closed', 15);
  await rest('POST', `/runs/${a.id}/cancel`, {});
  await rest('POST', `/runs/${b.id}/cancel`, {});
} catch (error) {
  log('ERROR', String(error?.stack ?? error));
  results.error = String(error?.stack ?? error);
} finally {
  await writeFile(join(HERE, `throughput-at-${label}.json`), JSON.stringify(results, null, 2) + '\n');
  await browser?.close();
  await api?.kill();
  await removeTemp(data);
  await log.flush();
}
