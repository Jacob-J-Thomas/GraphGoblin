// #186: the explicit slow-consumer failure as a reader sees it, and api-client recovery.
//  F1. fetch readers stall 6 s / 6.5 s (past the 5 s drain limit, inside the 2 s close window),
//      then read: expect complete frames, an interrupted partial frame whose id is reset to the
//      last complete event, and `event: stream.error` with SSE_SLOW_CONSUMER; then a reconnect
//      from that cursor delivers the rest in order.
//  F2. the api-client with a consumer that blocks 8 s once: onError reports the failure (or a
//      premature close), the helper resumes from its cursor, every event arrives exactly once.
import { makeTemp, removeTemp, startApi, restClient, logger, SseCollector, openSse, apiClientPackage, delay } from './lib.mjs';
import { cycle } from './defs.mjs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HERE } from './lib.mjs';

const PORT = 6455;
const log = logger('p186-failure.log.txt');
const data = await makeTemp('186fail');
const results = { checks: [] };
const check = (name, ok, detail) => {
  results.checks.push({ name, ok, detail });
  log(ok ? 'PASS' : 'FAIL', name, detail ?? '');
};
let api;

function parsed(frames) {
  const events = [];
  const invalid = [];
  for (const f of frames) {
    if (f.id === undefined) continue;
    try {
      events.push(JSON.parse(f.data));
    } catch {
      invalid.push({ id: f.id, event: f.event, dataTail: f.data.slice(-40) });
    }
  }
  return { events, invalid };
}

async function fetchStall(url, runId, stallMs) {
  const response = await fetch(`${url}/runs/${runId}/events?after=0`, { headers: { accept: 'text/event-stream' } });
  const reader = response.body.getReader();
  await delay(stallMs);
  const collector = new SseCollector();
  const decoder = new TextDecoder();
  let how = 'end';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      collector.push(decoder.decode(value, { stream: true }));
    }
  } catch (error) {
    how = `error:${error?.cause?.code ?? error?.message}`;
  }
  return { how, frames: collector.frames, tail: collector.buffer };
}

try {
  api = await startApi({ port: PORT, dataDir: data, log });
  const rest = restClient(api.url);
  const heavy = await rest.createLoop(cycle({ name: 'Heavy cycle', passes: 120, blobChars: 196_608 }));
  const run = await rest.start(heavy.loop.id, {});
  await rest.waitStatus(run.id, ['succeeded'], { timeout: 600_000, interval: 500 });
  const last = (await rest('GET', `/runs/${run.id}`)).lastEventSeq;

  for (const stallMs of [6000, 6500]) {
    const r = await fetchStall(api.url, run.id, stallMs);
    const { events, invalid } = parsed(r.frames);
    const ordered = events.every((e, i) => e.seq === i + 1);
    const error = r.frames.find((f) => f.event === 'stream.error');
    const code = error ? JSON.parse(error.data).code : undefined;
    const lastGood = events.at(-1)?.seq ?? 0;
    log(`F1 stall ${stallMs}`, { how: r.how, delivered: events.length, invalid, errorData: error?.data, completed: r.frames.some((f) => f.event === 'stream.complete') });
    check(`F1 stall ${stallMs} ms: ordered prefix, then explicit SSE_SLOW_CONSUMER (or premature close), no completion`, ordered && lastGood < last && !r.frames.some((f) => f.event === 'stream.complete') && (code === 'SSE_SLOW_CONSUMER' || r.how !== 'end'), {
      how: r.how, lastGood, code, interruptedFrames: invalid,
    });
    if (invalid.length) {
      check(`F1 stall ${stallMs} ms: an interrupted frame is unparseable and its id is reset to the last complete event`, invalid.every((f) => Number(f.id) === lastGood), invalid);
    }
    const rest2 = await openSse(api.url, run.id, { lastEventId: lastGood }).done;
    const after = parsed(rest2.frames).events;
    const all = [...events, ...after];
    check(`F1 stall ${stallMs} ms: reconnect from Last-Event-ID ${lastGood} completes the history in order`, all.length === last && all.every((e, i) => e.seq === i + 1) && rest2.completed, { before: events.length, after: after.length });
  }

  const { createGraphGoblinClient, subscribeRunEvents } = await apiClientPackage();
  const client = createGraphGoblinClient({ baseUrl: api.url, client: 'api' });
  const seen = [];
  const errors = [];
  let blocked = false;
  const t0 = Date.now();
  const sub = subscribeRunEvents({
    client,
    runId: run.id,
    after: 0,
    onEvent: async (event) => {
      seen.push(event.seq);
      if (!blocked && event.seq === 20) {
        blocked = true;
        await delay(8000);
      }
    },
    onError: (error, attempt) => errors.push({ attempt, code: error?.code, status: error?.status, message: String(error?.message ?? error).slice(0, 200) }),
    backoff: { initialMs: 200, maxMs: 2000 },
  });
  await sub.done;
  const duplicates = seen.length - new Set(seen).size;
  check('F2 api-client: one 8 s consumer block is reported through onError and recovered from the cursor; every event once, in order', seen.length === last && duplicates === 0 && seen.every((s, i) => s === i + 1) && errors.length >= 1, {
    delivered: seen.length, duplicates, errors, ms: Date.now() - t0,
  });
} catch (error) {
  log('ERROR', String(error?.stack ?? error));
  results.error = String(error?.stack ?? error);
} finally {
  await writeFile(join(HERE, 'p186-failure.json'), JSON.stringify(results, null, 2));
  await api?.kill();
  await removeTemp(data);
  await log.flush();
}
