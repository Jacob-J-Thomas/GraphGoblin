// #185 focused re-check of scenario C: what the open inspector shows while the gateway is down
// during a pending delivery (screenshot + page text), and that it settles after restart.
import { makeTemp, removeTemp, startApi, restClient, logger, edge, startReceiver, delay, until, edge_ } from './lib.mjs';
import { manual } from './defs.mjs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HERE } from './lib.mjs';

const PORT = 6450;
const log = logger('p185-outage.log.txt');
const data = await makeTemp('185out');
const results = {};
let api;
let browser;
let recv;
try {
  api = await startApi({ port: PORT, dataDir: data, log });
  const rest = restClient(api.url);
  let attempts = 0;
  let release;
  const held = new Promise((r) => (release = r));
  recv = await startReceiver(6453, () => (++attempts === 1 ? { hold: held, status: 200 } : { status: 200 }));
  const loop = await rest.createLoop({
    schemaVersion: 4,
    name: 'Outage during delivery',
    nodes: [manual(), { id: 'finish', kind: 'exit', label: 'Finish', config: { returns: '1', destinations: [{ kind: 'webhook', url: `${recv.url}/hook` }] } }],
    edges: [edge_('start', 'out', 'finish')],
  });
  const run = await rest.start(loop.loop.id, {});
  browser = await edge();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${api.url}/app/runs/${run.id}`);
  await until(() => attempts >= 1, { what: 'attempt in flight' });
  await page.getByText('Execution ended; finalization pending.').waitFor({ timeout: 15_000 });
  await api.kill();
  const samples = [];
  for (let i = 0; i < 6; i++) {
    await delay(1500);
    const text = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
    samples.push({
      t: (i + 1) * 1.5,
      finalizationPending: text.includes('Execution ended; finalization pending.'),
      fullyFinalized: text.includes('Fully finalized.'),
      timelineComplete: /Timeline \(\d+ events, complete\)/.test(text),
      banner: (await page.locator('body').innerText()).match(/Cannot reach the GraphGoblin API|You are offline/)?.[0] ?? null,
      excerpt: text.slice(0, 260),
    });
  }
  await page.screenshot({ path: join(HERE, 'p185-outage.png') });
  results.duringOutage = samples;
  log('during outage', samples);
  release();
  api = await startApi({ port: PORT, dataDir: data, log });
  await page.getByText('Fully finalized.').waitFor({ timeout: 90_000 });
  await until(async () => /Timeline \(\d+ events, complete\)/.test(await page.locator('body').innerText()), { timeout: 60_000, what: 'timeline complete' });
  const fin = await restClient(api.url)('GET', `/runs/${run.id}`);
  results.after = { delivery: fin.deliveries?.[0], finalizedAt: fin.finalizedAt };
  results.ok = samples.every((s) => !s.fullyFinalized && !s.timelineComplete) && fin.deliveries?.[0]?.status === 'delivered';
  log(results.ok ? 'PASS' : 'FAIL', 'inspector never claims completion during the outage and settles after restart', results.after);
} catch (error) {
  log('ERROR', String(error?.stack ?? error));
  results.error = String(error?.stack ?? error);
} finally {
  await writeFile(join(HERE, 'p185-outage.json'), JSON.stringify(results, null, 2));
  await browser?.close();
  await api?.kill();
  await recv?.close();
  await removeTemp(data);
  await log.flush();
}
