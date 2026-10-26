// #186 round 2 diagnostic: cost of the inspector's per-update server reads as history grows.
// Finished cyclic runs of increasing length; median latency (5 samples after one warm-up) of
// GET /runs/{id}, /observation, /thread (current, #116) and /thread?at=N for N = last, last-1
// and the midpoint. Then the same reads against a RUNNING run near its tail.
import { makeTemp, removeTemp, startApi, restClient, logger, delay, until } from './lib.mjs';
import { cycle } from './defs.mjs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HERE } from './lib.mjs';

const PORT = 6459;
const log = logger('p186-cost.log.txt');
const data = await makeTemp('186cost');
const results = { finished: [], running: [] };
let api;

async function timed(url) {
  const t0 = performance.now();
  const r = await fetch(url);
  await r.arrayBuffer();
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return performance.now() - t0;
}
async function median(url, n = 5) {
  await timed(url);
  const xs = [];
  for (let i = 0; i < n; i++) xs.push(await timed(url));
  xs.sort((a, b) => a - b);
  return +xs[Math.floor(n / 2)].toFixed(1);
}

try {
  api = await startApi({ port: PORT, dataDir: data, log });
  const rest = restClient(api.url);
  for (const passes of [200, 1000, 2000, 4000]) {
    const loop = await rest.createLoop(cycle({ name: `Cost ${passes}`, passes }));
    const run = await rest.start(loop.loop.id, {});
    await rest.waitStatus(run.id, ['succeeded'], { timeout: 900_000, interval: 1000 });
    const last = (await rest('GET', `/runs/${run.id}`)).lastEventSeq;
    const base = `${api.url}/runs/${run.id}`;
    const entry = {
      passes,
      events: last,
      runMs: await median(base),
      observationMs: await median(`${base}/observation`),
      currentThreadMs: await median(`${base}/thread`),
      threadAtLastMs: await median(`${base}/thread?at=${last}`),
      threadAtLastMinus1Ms: await median(`${base}/thread?at=${last - 1}`),
      threadAtMidMs: await median(`${base}/thread?at=${Math.floor(last / 2)}`),
    };
    results.finished.push(entry);
    log('finished', entry);
  }
  // A running run: reads near the advancing tail, as the live inspector issues them.
  const loop = await rest.createLoop(cycle({ name: 'Cost running', passes: 1_000_000 }));
  const run = await rest.start(loop.loop.id, {});
  for (const target of [2000, 6000, 10000]) {
    await until(async () => (await rest('GET', `/runs/${run.id}`)).lastEventSeq >= target, { timeout: 600_000, interval: 500, what: `${target}` });
    const xs = [];
    for (let i = 0; i < 6; i++) {
      const tail = (await rest('GET', `/runs/${run.id}`)).lastEventSeq;
      xs.push(await timed(`${api.url}/runs/${run.id}/thread?at=${tail - 1}`));
    }
    xs.sort((a, b) => a - b);
    const entry = { approxEvents: target, threadAtTailMinus1MedianMs: +xs[3].toFixed(1), samplesMs: xs.map((x) => +x.toFixed(1)) };
    results.running.push(entry);
    log('running', entry);
  }
  await rest('POST', `/runs/${run.id}/cancel`, {});
} catch (error) {
  log('ERROR', String(error?.stack ?? error));
  results.error = String(error?.stack ?? error);
} finally {
  await writeFile(join(HERE, 'p186-cost.json'), JSON.stringify(results, null, 2));
  await api?.kill();
  await removeTemp(data);
  await log.flush();
}
