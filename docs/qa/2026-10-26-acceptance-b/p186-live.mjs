// #186: live tail during a fast cyclic run. Readers attach while events are being produced:
//  L1 a fast fetch reader from 0;
//  L2 a fetch reader that stops pulling for 4 s every few hundred events (below the 5 s limit;
//     forces the bounded live handoff to overflow and catch up from durable pages);
//  L3 a reader that disconnects at random points and reconnects with Last-Event-ID;
//  L4 the api-client subscription with periodic 1.5 s consumer pauses.
// All must deliver exactly 1..last in order and end with stream.complete. Also counts events
// that share identical timestamps (ordering must come from seq, not time).
import { makeTemp, removeTemp, startApi, restClient, logger, SseCollector, openSse, eventFrames, apiClientPackage, delay } from './lib.mjs';
import { cycle } from './defs.mjs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HERE } from './lib.mjs';

const PORT = 6456;
const log = logger('p186-live.log.txt');
const data = await makeTemp('186live');
const results = { checks: [] };
const check = (name, ok, detail) => {
  results.checks.push({ name, ok, detail });
  log(ok ? 'PASS' : 'FAIL', name, detail ?? '');
};
let api;

async function stallingReader(url, runId, { every = 300, stallMs = 4000 }) {
  const response = await fetch(`${url}/runs/${runId}/events?after=0`, { headers: { accept: 'text/event-stream' } });
  const reader = response.body.getReader();
  const collector = new SseCollector();
  const decoder = new TextDecoder();
  let nextStall = every;
  let stalls = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    collector.push(decoder.decode(value, { stream: true }));
    const n = collector.frames.filter((f) => f.id !== undefined).length;
    if (n >= nextStall) {
      nextStall += every;
      stalls += 1;
      await delay(stallMs);
    }
  }
  return { frames: collector.frames, stalls };
}

async function reconnectingReader(url, runId) {
  const all = [];
  let cursor = 0;
  let connections = 0;
  for (;;) {
    connections += 1;
    const cut = 50 + Math.floor(Math.random() * 400);
    let got = 0;
    const s = openSse(url, runId, {
      ...(cursor ? { lastEventId: cursor } : { after: 0 }),
      onFrame: (f) => {
        if (f.id === undefined) return;
        got += 1;
        if (got === cut) s.close();
      },
    });
    const r = await s.done;
    for (const f of r.frames) {
      if (f.id === undefined) continue;
      const e = JSON.parse(f.data);
      if (e.seq <= cursor) continue; // frames parsed after close() was requested
      all.push(e);
      cursor = e.seq;
    }
    if (r.completed) return { events: all, connections };
    if (connections > 500) throw new Error('reconnecting reader did not complete');
  }
}

try {
  api = await startApi({ port: PORT, dataDir: data, log });
  const rest = restClient(api.url);
  const fast = await rest.createLoop(cycle({ name: 'Fast cycle', passes: 2500 }));
  const run = await rest.start(fast.loop.id, {});
  const t0 = Date.now();
  const L1 = openSse(api.url, run.id, { after: 0 }).done;
  const L2 = stallingReader(api.url, run.id, { every: 300, stallMs: 4000 });
  const L3 = reconnectingReader(api.url, run.id);
  const { createGraphGoblinClient, subscribeRunEvents } = await apiClientPackage();
  const client = createGraphGoblinClient({ baseUrl: api.url, client: 'api' });
  const seen4 = [];
  const errors4 = [];
  const L4sub = subscribeRunEvents({
    client,
    runId: run.id,
    after: 0,
    onEvent: async (event) => {
      seen4.push(event.seq);
      if (seen4.length % 1000 === 0) await delay(1500);
    },
    onError: (error, attempt) => errors4.push({ attempt, message: String(error?.message ?? error).slice(0, 160) }),
  });
  const finished = await rest.waitStatus(run.id, ['succeeded', 'failed'], { timeout: 600_000, interval: 250 });
  log('run', finished.status, 'lastEventSeq', finished.lastEventSeq, 'ms', Date.now() - t0);
  const [r1, r2, r3] = await Promise.all([L1, L2, L3]);
  await L4sub.done;
  const last = (await rest('GET', `/runs/${run.id}`)).lastEventSeq;
  const exact = (events) => events.length === last && events.every((e, i) => e.seq === i + 1);
  const e1 = eventFrames(r1.frames);
  check('L1 live reader from 0 during execution: 1..last in order, then stream.complete', exact(e1) && r1.completed, { delivered: e1.length, last });
  const e2 = eventFrames(r2.frames);
  check('L2 reader pausing 4 s every 300 events: 1..last in order, no failure control, stream.complete', exact(e2) && !r2.frames.some((f) => f.event === 'stream.error') && r2.frames.some((f) => f.event === 'stream.complete'), {
    delivered: e2.length, stalls: r2.stalls, last,
  });
  check('L3 reader disconnecting at random points, reconnecting with Last-Event-ID: 1..last in order', exact(r3.events), { delivered: r3.events.length, connections: r3.connections });
  check('L4 api-client with periodic 1.5 s consumer pauses: 1..last exactly once, in order', seen4.length === last && seen4.every((s, i) => s === i + 1), { delivered: seen4.length, errors: errors4 });
  const all = await rest.allEvents(run.id, { limit: 500 });
  const byTs = new Map();
  for (const e of all) byTs.set(e.ts, (byTs.get(e.ts) ?? 0) + 1);
  const shared = [...byTs.values()].filter((n) => n > 1);
  results.timestamps = { events: all.length, distinctTimestamps: byTs.size, timestampsSharedByMoreThanOneEvent: shared.length, largestGroup: Math.max(...shared, 0) };
  check('identical timestamps occur and JSON pages still return 1..last by seq', shared.length > 0 && exact(all), results.timestamps);
  results.runId = run.id;
} catch (error) {
  log('ERROR', String(error?.stack ?? error));
  results.error = String(error?.stack ?? error);
} finally {
  await writeFile(join(HERE, 'p186-live.json'), JSON.stringify(results, null, 2));
  await api?.kill();
  await removeTemp(data);
  await log.flush();
}
