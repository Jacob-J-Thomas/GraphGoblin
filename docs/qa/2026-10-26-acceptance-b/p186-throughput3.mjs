// #186 diagnostic 3: the api-client with an intermittently slow consumer (timestamps of the
// slow phase and the full-speed tail), and curl as an independent SSE client.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { makeTemp, removeTemp, startApi, restClient, logger, SseCollector, eventFrames, assertContiguous, apiClientPackage, delay } from './lib.mjs';
import { cycle } from './defs.mjs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HERE } from './lib.mjs';

const PORT = 6454;
const log = logger('p186-throughput3.log.txt');
const data = await makeTemp('186tp3');
const results = [];
let api;
try {
  api = await startApi({ port: PORT, dataDir: data, log });
  const rest = restClient(api.url);
  const heavy = await rest.createLoop(cycle({ name: 'Heavy cycle', passes: 120, blobChars: 196_608 }));
  const run = await rest.start(heavy.loop.id, {});
  await rest.waitStatus(run.id, ['succeeded'], { timeout: 600_000, interval: 500 });
  const { createGraphGoblinClient, subscribeRunEvents } = await apiClientPackage();
  const client = createGraphGoblinClient({ baseUrl: api.url, client: 'api' });
  for (const slowUntil of [0, 200]) {
    const seen = [];
    const errors = [];
    const t0 = Date.now();
    let slowEndedAt;
    let delayed = 0;
    const sub = subscribeRunEvents({
      client,
      runId: run.id,
      after: 0,
      onEvent: async (event) => {
        seen.push(event.seq);
        if (event.type === 'node.finished' && seen.length < slowUntil) {
          delayed += 250;
          await delay(250);
        }
        if (seen.length === slowUntil) slowEndedAt = Date.now();
      },
      onError: (error, attempt) => errors.push({ attempt, message: String(error?.message ?? error).slice(0, 160) }),
    });
    await sub.done;
    const entry = {
      label: `api-client, consumer sleeps 250 ms per node.finished for the first ${slowUntil} events`,
      totalMs: Date.now() - t0,
      consumerSleepMs: delayed,
      slowPhaseMs: slowEndedAt ? slowEndedAt - t0 : 0,
      tailMs: slowEndedAt ? Date.now() - slowEndedAt : Date.now() - t0,
      delivered: seen.length,
      ordered: seen.every((s, i) => s === i + 1),
      errors,
    };
    results.push(entry);
    log(entry);
  }
  const t1 = Date.now();
  const out = join(data, 'curl.txt');
  await promisify(execFile)('curl.exe', ['-s', '-N', '-H', 'Accept: text/event-stream', '-o', out, `${api.url}/runs/${run.id}/events?after=0`], { maxBuffer: 1 << 26 });
  const { readFile } = await import('node:fs/promises');
  const c = new SseCollector();
  c.push(await readFile(out, 'utf8'));
  const ev = eventFrames(c.frames);
  assertContiguous(ev, 1, 'curl');
  const curl = { label: 'curl.exe, no stall', ms: Date.now() - t1, delivered: ev.length, completed: c.frames.some((f) => f.event === 'stream.complete') };
  results.push(curl);
  log(curl);
} catch (error) {
  log('ERROR', String(error?.stack ?? error));
} finally {
  await writeFile(join(HERE, 'p186-throughput3.json'), JSON.stringify(results, null, 2));
  await api?.kill();
  await removeTemp(data);
  await log.flush();
}
