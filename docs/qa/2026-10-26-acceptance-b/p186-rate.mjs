// #186 diagnostic: event production rate of a cyclic run without and with an open inspector,
// and the browser's request mix while it follows the run live.
import { makeTemp, removeTemp, startApi, restClient, logger, edge, delay } from './lib.mjs';
import { cycle } from './defs.mjs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HERE } from './lib.mjs';

const PORT = 6458;
const log = logger('p186-rate.log.txt');
const data = await makeTemp('186rate');
const results = { samples: [], requests: {} };
let api;
let browser;
try {
  api = await startApi({ port: PORT, dataDir: data, log });
  const rest = restClient(api.url);
  const loop = await rest.createLoop(cycle({ name: 'Rate cycle', passes: 100000 }));
  const run = await rest.start(loop.loop.id, {});
  const sample = async (phase, seconds) => {
    for (let i = 0; i < seconds / 5; i++) {
      await delay(5000);
      const r = await rest('GET', `/runs/${run.id}`);
      const entry = { phase, t: Date.now(), lastEventSeq: r.lastEventSeq, status: r.status };
      results.samples.push(entry);
      log(entry);
    }
  };
  await sample('no browser', 60);
  browser = await edge();
  const page = await browser.newPage();
  page.on('request', (req) => {
    const u = new URL(req.url());
    const key = `${req.method()} ${u.pathname.replace(/[0-9A-HJKMNP-TV-Z]{26}/g, ':id')}${u.search.includes('at=') ? '?at=' : ''}${u.search.includes('around=') ? '?around=' : ''}`;
    results.requests[key] = (results.requests[key] ?? 0) + 1;
  });
  await page.goto(`${api.url}/app/runs/${run.id}`);
  await sample('inspector open (live)', 90);
  log('requests during inspector phase', results.requests);
  await page.close();
  await sample('inspector closed', 60);
  await rest('POST', `/runs/${run.id}/cancel`, {});
} catch (error) {
  log('ERROR', String(error?.stack ?? error));
  results.error = String(error?.stack ?? error);
} finally {
  await writeFile(join(HERE, 'p186-rate.json'), JSON.stringify(results, null, 2));
  await browser?.close();
  await api?.kill();
  await removeTemp(data);
  await log.flush();
}
