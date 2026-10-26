// #186 diagnostic: replay throughput of the same large history for readers that never stall,
// stall briefly, or are fetch-based, to tell reader artefacts from server behaviour after
// backpressure. Records elapsed time per reader; no pass/fail threshold (no latency SLA exists).
import { makeTemp, removeTemp, startApi, restClient, logger, openSse, eventFrames, assertContiguous, delay } from './lib.mjs';
import { pausedReader } from './raw-sse.mjs';
import { cycle } from './defs.mjs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HERE } from './lib.mjs';

const PORT = 6452;
const log = logger('p186-throughput.log.txt');
const data = await makeTemp('186tp');
const results = [];
let api;
try {
  api = await startApi({ port: PORT, dataDir: data, log });
  const rest = restClient(api.url);
  const heavy = await rest.createLoop(cycle({ name: 'Heavy cycle', passes: 120, blobChars: 196_608 }));
  const run = await rest.start(heavy.loop.id, {});
  await rest.waitStatus(run.id, ['succeeded'], { timeout: 600_000, interval: 500 });
  const last = (await rest('GET', `/runs/${run.id}`)).lastEventSeq;
  const measure = async (label, fn) => {
    const t0 = Date.now();
    const r = await fn();
    const ev = eventFrames(r.frames);
    assertContiguous(ev, 1, label);
    const entry = { label, ms: Date.now() - t0, delivered: ev.length, last, completed: r.frames.some((f) => f.event === 'stream.complete') };
    results.push(entry);
    log(entry);
  };
  for (let i = 0; i < 2; i++) {
    await measure('fetch reader, no stall', () => openSse(api.url, run.id, { after: 0 }).done);
    await measure('raw socket reader, no stall', () => pausedReader({ port: PORT, runId: run.id, pauseMs: 0 }));
    await measure('raw socket reader, 3 s stall', () => pausedReader({ port: PORT, runId: run.id, pauseMs: 3000 }));
    await measure('raw socket reader, 1 s stall', () => pausedReader({ port: PORT, runId: run.id, pauseMs: 1000 }));
  }
  await delay(100);
} catch (error) {
  log('ERROR', String(error?.stack ?? error));
} finally {
  await writeFile(join(HERE, 'p186-throughput.json'), JSON.stringify(results, null, 2));
  await api?.kill();
  await removeTemp(data);
  await log.flush();
}
