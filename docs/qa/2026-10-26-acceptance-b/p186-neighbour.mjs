// #186 round 2 (D1 scope): does one inspector following a long fast run live also slow an
// unrelated run on the same gateway? Two fast cyclic runs A and B; B's event rate is measured
// with no inspector, with an inspector following A live, and after it closes.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { makeTemp, removeTemp, startApi, restClient, logger, edge, delay, until, HERE } from './lib.mjs';
import { cycle } from './defs.mjs';

const PORT = 6458;
const log = logger('p186-neighbour.log.txt');
const data = await makeTemp('186nb');
const results = { phases: [] };
let api;
let browser;
try {
  api = await startApi({ port: PORT, dataDir: data, log });
  const rest = restClient(api.url);
  const loopA = await rest.createLoop(cycle({ name: 'Observed A', passes: 1_000_000 }));
  const loopB = await rest.createLoop(cycle({ name: 'Neighbour B', passes: 1_000_000 }));
  const a = await rest.start(loopA.loop.id, {});
  const b = await rest.start(loopB.loop.id, {});
  await until(async () => (await rest('GET', `/runs/${a.id}`)).lastEventSeq >= 5000, { timeout: 300_000, interval: 1000, what: 'A at 5000 events' });
  const phase = async (name, seconds) => {
    const a0 = (await rest('GET', `/runs/${a.id}`)).lastEventSeq;
    const b0 = (await rest('GET', `/runs/${b.id}`)).lastEventSeq;
    const t0 = Date.now();
    await delay(seconds * 1000);
    const a1 = (await rest('GET', `/runs/${a.id}`)).lastEventSeq;
    const b1 = (await rest('GET', `/runs/${b.id}`)).lastEventSeq;
    const s = (Date.now() - t0) / 1000;
    const entry = { name, A: { from: a0, eventsPerSecond: +((a1 - a0) / s).toFixed(1) }, B: { from: b0, eventsPerSecond: +((b1 - b0) / s).toFixed(1) } };
    results.phases.push(entry);
    log(entry);
  };
  await phase('no inspector', 45);
  browser = await edge();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${api.url}/app/runs/${a.id}`);
  await page.locator('ol[aria-label="Timeline"] li').first().waitFor({ timeout: 60_000 });
  await phase('inspector following A live', 60);
  await page.close();
  await phase('inspector closed', 45);
  await rest('POST', `/runs/${a.id}/cancel`, {});
  await rest('POST', `/runs/${b.id}/cancel`, {});
} catch (error) {
  log('ERROR', String(error?.stack ?? error));
  results.error = String(error?.stack ?? error);
} finally {
  await writeFile(join(HERE, 'p186-neighbour.json'), JSON.stringify(results, null, 2));
  await browser?.close();
  await api?.kill();
  await removeTemp(data);
  await log.flush();
}
