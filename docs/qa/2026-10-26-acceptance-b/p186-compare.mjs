// #186 round 2 before/after: the same fast cyclic run on the pre-round-2 build (aa8b2348, a
// disposable `git archive` build under %TEMP%) and on the accepted build (d42e859f). Phases:
// 60 s with no inspector, 90 s with an inspector following live, 45 s with the inspector in
// history mode (Load older), 30 s closed. Records execution rate, browser request mix, JS heap
// and API private memory.
import { makeTemp, removeTemp, startApi, restClient, logger, edge, delay, processMemory, ROOT } from './lib.mjs';
import { cycle } from './defs.mjs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HERE } from './lib.mjs';

const BASELINE = process.argv[2];
if (!BASELINE) throw new Error('usage: node p186-compare.mjs <baseline build root>');
const PORT = 6458;
const log = logger('p186-compare.log.txt');
const results = {};

for (const [label, root] of [['before (aa8b2348, pre-#186 round 2)', BASELINE], ['after (d42e859f, accepted main)', ROOT]]) {
  const data = await makeTemp('186cmp');
  let api;
  let browser;
  const out = { phases: [], requests: {}, heap: [], apiMemory: [] };
  results[label] = out;
  try {
    api = await startApi({ port: PORT, dataDir: data, log, root });
    const rest = restClient(api.url);
    const loop = await rest.createLoop(cycle({ name: 'Compare cycle', passes: 1_000_000 }));
    const run = await rest.start(loop.loop.id, {});
    const phase = async (name, seconds, extra) => {
      const a = (await rest('GET', `/runs/${run.id}`)).lastEventSeq;
      const t0 = Date.now();
      await delay(seconds * 1000);
      const b = (await rest('GET', `/runs/${run.id}`)).lastEventSeq;
      const entry = { name, fromSeq: a, toSeq: b, seconds: (Date.now() - t0) / 1000, eventsPerSecond: +((b - a) / ((Date.now() - t0) / 1000)).toFixed(1), ...(await extra?.()) };
      out.phases.push(entry);
      log(label, entry);
    };
    await phase('no inspector', 60, async () => ({ apiMemory: await processMemory(api.pid) }));
    browser = await edge();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    page.on('request', (req) => {
      const u = new URL(req.url());
      if (u.pathname.startsWith('/app/')) return;
      const key = `${req.method()} ${u.pathname.replace(/[0-9A-HJKMNP-TV-Z]{26}/g, ':id')}${u.search.includes('at=') ? '?at=' : ''}`;
      out.requests[key] = (out.requests[key] ?? 0) + 1;
    });
    await page.goto(`${api.url}/app/runs/${run.id}`);
    await page.locator('ol[aria-label="Timeline"] li').first().waitFor({ timeout: 60_000 });
    const heap = async () => {
      await cdp.send('HeapProfiler.collectGarbage');
      const { metrics } = await cdp.send('Performance.getMetrics');
      return +(metrics.find((m) => m.name === 'JSHeapUsedSize').value / 1048576).toFixed(2);
    };
    await phase('inspector following live', 90, async () => ({ jsHeapMiB: await heap(), apiMemory: await processMemory(api.pid), requests: { ...out.requests } }));
    const older = page.getByRole('button', { name: 'Load older' });
    if (await older.count()) {
      await older.click().catch(() => {});
      await phase('inspector in history mode (Load older)', 45, async () => ({ jsHeapMiB: await heap() }));
    } else {
      out.phases.push({ name: 'inspector in history mode (Load older)', skipped: 'no Load older control in this build' });
    }
    await page.close();
    await phase('inspector closed', 30);
    await rest('POST', `/runs/${run.id}/cancel`, {});
  } catch (error) {
    log('ERROR', label, String(error?.stack ?? error));
    out.error = String(error?.stack ?? error);
  } finally {
    await browser?.close();
    await api?.kill();
    await removeTemp(data);
  }
}
await writeFile(join(HERE, 'p186-compare.json'), JSON.stringify(results, null, 2));
await log.flush();
