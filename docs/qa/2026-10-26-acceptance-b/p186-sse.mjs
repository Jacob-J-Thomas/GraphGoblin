// #186: paged replay, bounded server buffering and slow/stalled readers over the built API.
// Long history with large events (each grow pass writes a ~192 KiB string), then:
//  A. a normal reader replays everything in order and completes;
//  B. a reader that stops reading for 3 s (below the server's 5 s drain limit) still completes;
//  C. a reader that stops reading for 15 s gets an explicit failure or a severed connection,
//     never a silent gap, and recovers in order from its own cursor;
//  D. five concurrent stalled readers: server memory does not scale with history x readers;
//  E. the published api-client with a slow consumer delivers every event once, in order.
import {
  makeTemp, removeTemp, startApi, restClient, logger, openSse, eventFrames, assertContiguous,
  processMemory, apiClientPackage, delay, assert,
} from './lib.mjs';
import { pausedReader } from './raw-sse.mjs';
import { cycle } from './defs.mjs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HERE } from './lib.mjs';

const PORT = 6451;
const log = logger('p186-sse.log.txt');
const data = await makeTemp('186sse');
const results = { checks: [] };
const check = (name, ok, detail) => {
  results.checks.push({ name, ok, detail });
  log(ok ? 'PASS' : 'FAIL', name, detail ?? '');
};
let api;
try {
  api = await startApi({ port: PORT, dataDir: data, log });
  const rest = restClient(api.url);
  results.memoryIdle = await processMemory(api.pid);
  const heavy = await rest.createLoop(cycle({ name: 'Heavy cycle', passes: 120, blobChars: 196_608 }));
  const started = Date.now();
  const run = await rest.start(heavy.loop.id, {});
  const finished = await rest.waitStatus(run.id, ['succeeded', 'failed'], { timeout: 600_000, interval: 500 });
  log('heavy run', finished.status, 'result', finished.result?.value, 'ms', Date.now() - started, 'lastEventSeq', finished.lastEventSeq);
  const events = await rest.allEvents(run.id, { limit: 50 });
  assertContiguous(events, 1, 'JSON pages');
  const historyBytes = events.reduce((sum, e) => sum + Buffer.byteLength(JSON.stringify(e)), 0);
  const largest = Math.max(...events.map((e) => Buffer.byteLength(JSON.stringify(e))));
  results.history = { events: events.length, historyBytes, largestEventBytes: largest };
  log('history', results.history);
  const last = events.at(-1).seq;
  await delay(1000);
  results.memoryAfterRun = await processMemory(api.pid);
  log('memory after run (idle, no readers)', results.memoryAfterRun);

  // A. normal reader.
  const samplesA = [];
  const a = openSse(api.url, run.id, { after: 0 });
  const sampler = setInterval(() => processMemory(api.pid).then((m) => samplesA.push(m)).catch(() => {}), 700);
  const ra = await a.done;
  clearInterval(sampler);
  const ea = eventFrames(ra.frames);
  assertContiguous(ea, 1, 'A');
  const completion = ra.frames.find((f) => f.event === 'stream.complete');
  check('A normal replay: every event 1..last in order, then stream.complete', ea.length === last && !!completion && JSON.parse(completion.data).after === last, {
    delivered: ea.length, last, completion: completion?.data, eof: ra.eof, maxPrivateMiB: Math.max(...samplesA.map((m) => m.privateMiB)),
  });
  results.memoryNormalReader = samplesA;

  // B. a 3 s stall is backpressure, not failure.
  const rb = await pausedReader({ port: PORT, runId: run.id, pauseMs: 3000 });
  const eb = eventFrames(rb.frames);
  const errorB = rb.frames.find((f) => f.event === 'stream.error');
  check('B 3 s stall: completes without a failure control', eb.length === last && !errorB && rb.frames.some((f) => f.event === 'stream.complete'), {
    delivered: eb.length, how: rb.how, error: errorB?.data,
  });
  if (eb.length) assertContiguous(eb, 1, 'B');

  // C. a 15 s stall exceeds the 5 s drain limit.
  const samplesC = [];
  const rc = await pausedReader({
    port: PORT,
    runId: run.id,
    pauseMs: 15_000,
    onPaused: async () => {
      const end = Date.now() + 14_000;
      while (Date.now() < end) {
        samplesC.push({ t: Date.now(), ...(await processMemory(api.pid)) });
        await delay(800);
      }
    },
  });
  const ec = eventFrames(rc.frames);
  if (ec.length) assertContiguous(ec, 1, 'C before failure');
  const errorC = rc.frames.find((f) => f.event === 'stream.error');
  const lastC = ec.at(-1)?.seq ?? 0;
  log('C stalled reader result', {
    how: rc.how, rawBytes: rc.rawBytes, delivered: ec.length, lastC, error: errorC?.data, completed: rc.frames.some((f) => f.event === 'stream.complete'),
    framesAfterError: errorC ? rc.frames.slice(rc.frames.indexOf(errorC) + 1).length : null, tailBytes: rc.tail.length,
    pausedForMs: rc.resumedAt - rc.connectedAt, endedAfterResumeMs: rc.endedAt - rc.resumedAt,
  });
  const explicit = errorC && JSON.parse(errorC.data).code === 'SSE_SLOW_CONSUMER';
  check('C 15 s stall: explicit SSE_SLOW_CONSUMER control or severed connection, never completion with a gap', (explicit || rc.how !== 'end' || !rc.terminated) && !rc.frames.some((f) => f.event === 'stream.complete') && lastC < last, {
    explicit: !!explicit, errorControl: errorC?.data, how: rc.how, chunkedTerminated: rc.terminated, lastCompleteEvent: lastC,
  });
  results.memoryStalledReader = samplesC;
  // Recover from the reader's own cursor, with Last-Event-ID (exclusive).
  const resumeC = openSse(api.url, run.id, { lastEventId: lastC });
  const rrc = await resumeC.done;
  const erc = eventFrames(rrc.frames);
  const combined = [...ec, ...erc];
  assertContiguous(combined, 1, 'C combined');
  check('C recovery from Last-Event-ID: combined history is exactly 1..last with no gap or duplicate', combined.length === last && rrc.completed, {
    before: ec.length, after: erc.length, last,
  });

  // D. five concurrent stalled readers on a ~history; memory should not scale with readers x history.
  await delay(2000);
  const baseD = await processMemory(api.pid);
  const samplesD = [];
  const readers = Array.from({ length: 5 }, () => pausedReader({ port: PORT, runId: run.id, pauseMs: 15_000 }));
  for (let i = 0; i < 16; i++) {
    samplesD.push({ t: i, ...(await processMemory(api.pid)) });
    await delay(800);
  }
  const rd = await Promise.all(readers);
  const peakD = Math.max(...samplesD.map((m) => m.privateMiB));
  check('D five stalled readers: server private memory growth stays far below 5 x history size', peakD - baseD.privateMiB < (5 * historyBytes) / 1048576 / 2, {
    baseD, peakPrivateMiB: peakD, growthMiB: +(peakD - baseD.privateMiB).toFixed(1), historyMiB: +(historyBytes / 1048576).toFixed(1),
    outcomes: rd.map((r) => ({ how: r.how, delivered: eventFrames(r.frames).length, error: r.frames.find((f) => f.event === 'stream.error')?.data ? 'stream.error' : null })),
  });
  results.memoryFiveStalled = { baseD, samplesD };
  for (const r of rd) {
    const er = eventFrames(r.frames);
    if (er.length) assertContiguous(er, 1, 'D reader');
  }

  // E. api-client: a consumer slower than the stream still receives every event exactly once.
  const { createGraphGoblinClient, subscribeRunEvents } = await apiClientPackage();
  const client = createGraphGoblinClient({ baseUrl: api.url, client: 'api' });
  const seen = [];
  const errors = [];
  const sub = subscribeRunEvents({
    client,
    runId: run.id,
    after: 0,
    onEvent: async (event) => {
      seen.push(event.seq);
      if (event.type === 'node.finished' && seen.length < 200) await delay(250);
    },
    onError: (error, attempt) => errors.push({ attempt, code: error?.code ?? error?.problem?.code ?? String(error?.message ?? error).slice(0, 120) }),
    backoff: { initialMs: 200, maxMs: 2000 },
  });
  const t = setTimeout(() => sub.close(), 240_000);
  await sub.done;
  clearTimeout(t);
  const duplicates = seen.length - new Set(seen).size;
  const ordered = seen.every((s, i) => i === 0 || s === seen[i - 1] + 1);
  check('E api-client slow consumer: every event once, in order, done resolves after stream.complete', seen.length === last && duplicates === 0 && ordered, {
    delivered: seen.length, duplicates, ordered, errors,
  });
  results.memoryEnd = await processMemory(api.pid);
} catch (error) {
  log('ERROR', String(error?.stack ?? error));
  results.error = String(error?.stack ?? error);
} finally {
  await writeFile(join(HERE, 'p186-sse.json'), JSON.stringify(results, null, 2));
  await api?.kill();
  await removeTemp(data);
  await log.flush();
}
