/* global Buffer, process, performance, global, setInterval, clearInterval, setTimeout */
import { Session } from 'node:inspector';
import { createHash } from 'node:crypto';
import { stat, appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { dependency, definition, Timings, bytes, disk } from './common.mjs';
import { equivalence } from './equivalence.mjs';
import { observeAppendClient } from './append-observer.mjs';
process.stderr.write('PERF_WORKER importing API ' + process.pid + '\n');
const { createContainer, loadConfig, buildApp } = await dependency('@graphgoblin/api');
const { RunManager } = await dependency('@graphgoblin/engine');
const { FakeHarness } = await dependency('@graphgoblin/engine/testing');
const { CURRENT_DEFINITION_FORMAT } = await dependency('@graphgoblin/contracts');
const { databaseView, SqliteEventStore } = await dependency('@graphgoblin/infrastructure/sqlite');
process.stderr.write('PERF_WORKER imports ready\n');
const options = JSON.parse(process.env.GG_PERF_OPTIONS);
if (
  typeof options.dataDir !== 'string' ||
  !options.dataDir ||
  typeof options.output !== 'string' ||
  !options.output
)
  throw new Error('Use measure.mjs: explicit disposable data and output directories are required');
const dataDir = options.dataDir;
let container, manager, app, base, sampling, caseStarted, runStarted, runId, specification;
let stats = {},
  checkpoints = [],
  samples = [],
  observationMs = 0,
  checkpointPass = 0;
let appends = 0,
  activeCalls = 0,
  maxConcurrentCalls = 0;
const terminalRuns = new Set();
let appendObserver;
const lag = monitorEventLoopDelay({ resolution: 10 });
// One turn at a time avoids preallocating an N*M fake script queue.
class Producer extends FakeHarness {
  sequence = 0;
  specification = { items: 0, itemBytes: 120, delayMs: 0 };
  start(request, signal) {
    const turn = ++this.sequence;
    const { items, itemBytes, delayMs } = this.specification;
    this.script([
      {
        items: Array.from({ length: items }, (_, index) => ({
          id: `turn-${turn}-item-${index}`,
          type: 'message',
          summary: 'x'.repeat(itemBytes),
        })),
        finalText: 'OK',
        delayMs,
      },
    ]);
    const session = super.start(request, signal);
    if (!this.specification.itemPauseMs) return session;
    const pause = this.specification.itemPauseMs;
    return {
      ...session,
      events: {
        async *[Symbol.asyncIterator]() {
          for await (const event of session.events) {
            if (event.type === 'item') await new Promise((resolve) => setTimeout(resolve, pause));
            yield event;
          }
        },
      },
    };
  }
}
const harness = new Producer();
function record(name, elapsed) {
  (stats[name] ??= new Timings()).add(elapsed);
}
// New port objects injected through the public constructor; repositories remain untouched.
function timedPort(port, name) {
  return new Proxy(port, {
    get(target, key) {
      const value = Reflect.get(target, key);
      if (typeof value !== 'function') return value;
      if (key === 'subscribe') return value.bind(target);
      return async (...args) => {
        const started = performance.now();
        const finalizationRead = name === 'events' && key === 'read' && terminalRuns.has(args[0]);
        activeCalls++;
        maxConcurrentCalls = Math.max(maxConcurrentCalls, activeCalls);
        let result;
        try {
          result = await value.apply(target, args);
        } finally {
          activeCalls--;
          record(`${name}.${String(key)}`, performance.now() - started);
          if (finalizationRead) record('events.finalizationRead', performance.now() - started);
        }
        if (name === 'runs' && result?.status) {
          if (['succeeded', 'failed', 'cancelled', 'exhausted'].includes(result.status))
            terminalRuns.add(result.id);
          else terminalRuns.delete(result.id);
        }
        if (name === 'events' && key === 'append') appends += result.length;
        if (name === 'runs' && key === 'saveThread' && caseStarted) {
          const pass = args[1].counters.nodeVisits.work ?? 0;
          const step = Math.max(1, Math.floor(specification.passes / 10));
          if (pass > checkpointPass && (pass % step === 0 || pass === specification.passes)) {
            checkpointPass = pass;
            const begin = performance.now(),
              readAt = performance.now();
            const thread = await container.repos.runs.getThread(args[0]);
            const getThreadMs = performance.now() - readAt,
              serialAt = performance.now();
            const snapshotBytes = bytes(thread),
              snapshotSerializeMs = performance.now() - serialAt;
            checkpoints.push({
              pass,
              elapsedMs: performance.now() - caseStarted,
              snapshotBytes,
              snapshotSerializeMs,
              getThreadMs,
              ...process.memoryUsage(),
            });
            observationMs += performance.now() - begin;
          }
        }
        return result;
      };
    },
  });
}
let isClosed = true;
const responses = new Set();
const replaySockets = new Map();
let maxWritableBytes = 0,
  maxRss = 0,
  maxHeap = 0;
async function boot() {
  isClosed = false;
  const started = performance.now();
  container = await createContainer(
    loadConfig({
      GG_DATA_DIR: dataDir,
      GG_SWAGGER_UI: 'false',
      GG_REQUIRE_API_KEY: 'false',
      GG_MASTER_KEY: Buffer.alloc(32, 9).toString('base64'),
      GG_MAX_CONCURRENT_RUNS: '1',
      GG_WEB_DIST: options.webDist,
    }),
    { harnesses: { codex: harness }, startTimers: false },
  );
  await container.start();
  // Startup/recovery is real; stop the unused coordinator before installing decorated ports.
  container.manager.stop();
  await container.manager.waitForIdle();
  const ports = { ...container.ports };
  if (options.traceAppend) {
    appendObserver = observeAppendClient(container.handle.client);
    ports.events = new SqliteEventStore(databaseView(appendObserver.client), ports.clock);
  }
  for (const name of [
    'events',
    'runs',
    'loops',
    'sessions',
    'artifacts',
    'workspace',
    'modelCatalog',
    'admission',
  ])
    ports[name] = timedPort(ports[name], name);
  manager = new RunManager(ports, timedPort(container.settings, 'settings'));
  await manager.start();
  app = await buildApp(
    {
      ...container,
      manager,
      repos: { ...container.repos, events: ports.events, runs: ports.runs },
    },
    { logger: false },
  );
  app.addHook('onRequest', async (_request, reply) => {
    responses.add(reply.raw);
    if (/^\/runs\/[^/]+\/events/.test(_request.url)) {
      const socket = reply.raw.socket;
      replaySockets.set(socket, socket.bytesWritten);
    }
    const forget = () => responses.delete(reply.raw);
    reply.raw.once('finish', forget);
    reply.raw.once('close', forget);
  });
  base = await app.listen({ host: '127.0.0.1', port: options.port });
  return { base, bootMs: performance.now() - started, pid: process.pid };
}
async function size(file) {
  return (
    await stat(join(dataDir, file)).catch((error) => {
      if (error.code === 'ENOENT') return { size: 0 };
      throw error;
    })
  ).size;
}
async function memory(label = 'sample') {
  const usage = process.memoryUsage();
  const writableBytes = [...responses].reduce((sum, response) => sum + response.writableLength, 0);
  maxWritableBytes = Math.max(maxWritableBytes, writableBytes);
  maxHeap = Math.max(maxHeap, usage.heapUsed);
  maxRss = Math.max(maxRss, usage.rss);
  return {
    label,
    elapsedMs: caseStarted ? performance.now() - caseStarted : 0,
    ...usage,
    writableBytes,
    socketBytesWritten: [...replaySockets].reduce(
      (sum, [socket, baseline]) => sum + socket.bytesWritten - baseline,
      0,
    ),
    openResponses: responses.size,
    dbBytes: await size('graphgoblin.db'),
    walBytes: await size('graphgoblin.db-wal'),
  };
}
async function publish(def) {
  const created = await app.inject({ method: 'POST', url: '/loops', payload: { definition: def } });
  if (created.statusCode !== 201) throw new Error(created.body);
  const id = created.json().loop.id;
  const published = await app.inject({ method: 'POST', url: `/loops/${id}/publish`, payload: {} });
  if (published.statusCode !== 200) throw new Error(published.body);
  return id;
}
async function start(loopId) {
  const response = await app.inject({ method: 'POST', url: `/loops/${loopId}/runs`, payload: {} });
  if (response.statusCode !== 202) throw new Error(response.body);
  return response.json().run.id;
}
async function populate(count) {
  const def = definition(CURRENT_DEFINITION_FORMAT, { passes: 1 });
  def.name = 'aged-store-population';
  def.nodes = [def.nodes[0], def.nodes.at(-1)];
  def.edges = [{ id: 'end', from: { node: 'start', port: 'out' }, to: { node: 'done' } }];
  const loopId = await publish(def),
    began = performance.now();
  const admission = new Timings();
  for (let i = 0; i < count; i++) {
    const at = performance.now();
    await start(loopId);
    admission.add(performance.now() - at);
    if (i % 50 === 49) await manager.waitForIdle();
  }
  await manager.waitForIdle();
  const stored = await container.handle.client.execute(
    'SELECT status, count(*) AS n FROM runs GROUP BY status',
  );
  if (Number(stored.rows.find((row) => row.status === 'succeeded')?.n ?? 0) !== count)
    throw new Error('population correctness failed');
  const wallMs = performance.now() - began;
  const dispatch = new Timings();
  const queued = await container.handle.client.execute('SELECT created_at, started_at FROM runs');
  for (const row of queued.rows)
    dispatch.add(Date.parse(row.started_at) - Date.parse(row.created_at));
  return {
    runs: count,
    wallMs,
    admission: admission.json(),
    createdToStarted: dispatch.json(),
    disk: await disk(dataDir),
  };
}
async function begin(spec) {
  specification = spec;
  harness.specification = spec;
  harness.started.length = 0;
  const loopId = await publish(definition(CURRENT_DEFINITION_FORMAT, spec));
  global.gc();
  stats = {};
  checkpoints = [];
  samples = [];
  checkpointPass = 0;
  observationMs = 0;
  maxConcurrentCalls = 0;
  appends = 0;
  appendObserver?.reset();
  maxWritableBytes = 0;
  maxHeap = 0;
  maxRss = 0;
  runId = undefined;
  caseStarted = performance.now();
  lag.reset();
  lag.enable();
  samples.push(await memory('before'));
  sampling = setInterval(() => {
    void memory().then((sample) => {
      samples.push(sample);
      if (process.connected)
        process.send(
          {
            memorySample: {
              runId,
              passes: specification.passes,
              lastObservedPass: checkpointPass,
              ...sample,
            },
          },
          () => {},
        );
    });
  }, 250);
  runStarted = {
    cpu: process.cpuUsage(),
    storage: await disk(dataDir),
    profileStartUs: Number(process.hrtime.bigint() / 1000n),
  };
  runId = await start(loopId);
  return { runId, base };
}
async function finish() {
  await manager.waitForIdle();
  const profileEndUs = Number(process.hrtime.bigint() / 1000n);
  if (profileEndUs <= runStarted.profileStartUs)
    throw new Error('Empty or reversed CPU profile window');
  const wallMs = performance.now() - caseStarted,
    cpu = process.cpuUsage(runStarted.cpu);
  clearInterval(sampling);
  sampling = undefined;
  lag.disable();
  samples.push(await memory('after-before-gc'));
  global.gc();
  samples.push(await memory('after-gc'));
  const timings = Object.fromEntries(
    Object.entries(stats).map(([key, value]) => [key, value.json()]),
  );
  const awaitedPortMs = Object.values(timings).reduce((sum, value) => sum + value.totalMs, 0);
  const run = await container.repos.runs.get(runId),
    thread = await manager.getThread(runId);
  let cursor = 0,
    progress = 0,
    gates = 0,
    terminal = 0,
    eventBytes = 0;
  const entries = {},
    completed = {},
    types = {};
  let unexpectedAttempts = 0;
  const serialization = new Timings();
  const eventHash = createHash('sha256'),
    lateHash = createHash('sha256');
  const equivalent = equivalence();
  const lateAfter = Math.floor(run.lastEventSeq * 0.9);
  for (;;) {
    const events = await container.repos.events.read(runId, cursor, 1000);
    if (!events.length) break;
    const at = performance.now();
    const encoded = events.map((event) => JSON.stringify(event));
    for (const value of encoded) eventBytes += Buffer.byteLength(value);
    serialization.add(performance.now() - at);
    encoded.forEach((value, index) => {
      eventHash.update(value + '\n');
      if (events[index].seq > lateAfter) lateHash.update(value + '\n');
    });
    for (const event of events) {
      equivalent.event(event);
      if (event.seq !== ++cursor) throw new Error('stored sequence gap');
      types[event.type] = (types[event.type] ?? 0) + 1;
      if (event.type === 'node.started') {
        entries[event.nodeId] = (entries[event.nodeId] ?? 0) + 1;
        if (event.attempt !== 1) unexpectedAttempts++;
      }
      if (event.type === 'node.finished')
        completed[event.nodeId] = (completed[event.nodeId] ?? 0) + 1;
      if (event.type === 'node.progress') progress++;
      if (event.type === 'decision.made') gates++;
      if (event.type === 'run.finished') terminal++;
    }
  }
  const expectedVisits = {
    start: 1,
    work: specification.passes,
    gate: specification.passes,
    done: 1,
    ...(specification.grow || !specification.inference ? { init: 1 } : {}),
    ...(specification.grow ? { grow: specification.passes } : {}),
  };
  const nodeCountsOk =
    Object.keys(entries).length === Object.keys(expectedVisits).length &&
    Object.keys(completed).length === Object.keys(expectedVisits).length &&
    Object.keys(thread.counters.nodeVisits).length === Object.keys(expectedVisits).length &&
    Object.entries(expectedVisits).every(
      ([node, count]) =>
        entries[node] === count &&
        completed[node] === count &&
        thread.counters.nodeVisits[node] === count,
    );
  const correctness = {
    entries,
    completed,
    types,
    expectedVisits,
    nodeCountsOk,
    unexpectedAttempts,
    succeeded: run.status === 'succeeded',
    storedEvents: cursor,
    appendEvents: appends,
    progress,
    expectedProgress: specification.inference ? specification.passes * specification.items : 0,
    gates,
    passes: thread.gates.gate?.passes,
    visits: thread.counters.nodeVisits,
    history: thread.vars.history?.length ?? 0,
    historyValuesOk:
      !(specification.grow || !specification.inference) ||
      thread.vars.history.every((value) => value === 'x'.repeat(specification.contextBytes)),
    terminal,
    returnsOk:
      !specification.returnControl ||
      (JSON.stringify(run.result) ===
        JSON.stringify({ passes: specification.passes, output: 'OK' }) &&
        types['return.delivered'] === 2 &&
        !types['return.failed']),
  };
  correctness.ok =
    correctness.succeeded &&
    nodeCountsOk &&
    unexpectedAttempts === 0 &&
    types['run.queued'] === 1 &&
    types['run.started'] === 1 &&
    types['exit.evaluated'] === 1 &&
    (types['harness.session'] ?? 0) === (specification.inference ? specification.passes : 0) &&
    (types['harness.usage'] ?? 0) === (specification.inference ? specification.passes : 0) &&
    cursor === run.lastEventSeq &&
    cursor === appends + 1 &&
    progress === correctness.expectedProgress &&
    gates === specification.passes &&
    correctness.passes === specification.passes &&
    correctness.historyValuesOk &&
    correctness.returnsOk &&
    terminal === 1 &&
    thread.counters.nodeVisits.work === specification.passes &&
    ((specification.inference && !specification.grow) ||
      correctness.history === specification.passes);
  await appendFile(
    join(options.output, 'memory.jsonl'),
    samples.map((s) => JSON.stringify({ runId, ...s })).join('\n') + '\n',
  );
  const result = {
    runId,
    profileWindow: { startUs: runStarted.profileStartUs, endUs: profileEndUs },
    specification,
    wallMs,
    msPerPass: wallMs / specification.passes,
    cpu,
    durableAdmissionToStartMs: Date.parse(run.startedAt) - Date.parse(run.createdAt),
    timings,
    awaitedPortMs,
    observationMs,
    residualMs: wallMs - awaitedPortMs - observationMs,
    maxConcurrentPortCalls: maxConcurrentCalls,
    checkpoints,
    samples,
    eventLoopDelayMs: { mean: lag.mean / 1e6, max: lag.max / 1e6, p99: lag.percentile(99) / 1e6 },
    eventSerialization: {
      ...serialization.json(),
      bytes: eventBytes,
      pageSize: 1000,
      sha256: eventHash.digest('hex'),
      lateAfter,
      lateSha256: lateHash.digest('hex'),
    },
    storageBefore: runStarted.storage,
    storageAfter: await disk(dataDir),
    artifacts: await disk(join(dataDir, 'artifacts')),
    correctness,
    equivalence: equivalent.finish(thread, run),
    ...(appendObserver ? { appendSql: appendObserver.summary() } : {}),
  };
  caseStarted = undefined;
  return result;
}
async function probe() {
  const timing = new Timings(),
    began = performance.now();
  await Promise.all(
    Array.from({ length: 16 }, async () => {
      const at = performance.now();
      await container.handle.client.execute('SELECT 1');
      timing.add(performance.now() - at);
    }),
  );
  return { wallMs: performance.now() - began, latency: timing.json() };
}
async function recoverControl() {
  const id = runId;
  async function capture() {
    const hash = createHash('sha256');
    let after = 0;
    for (;;) {
      const page = await container.repos.events.read(id, after, 256);
      if (!page.length) break;
      for (const event of page) hash.update(JSON.stringify(event) + '\n');
      after = page.at(-1).seq;
    }
    return {
      eventsSha256: hash.digest('hex'),
      events: after,
      thread: await manager.getThread(id),
      run: await container.repos.runs.get(id),
    };
  }
  const before = await capture();
  // Controlled lost-finalization-marker fixture through the repository port, then real close/reopen.
  await container.repos.runs.clearFinalized(id);
  await close();
  await boot();
  await manager.waitForIdle();
  const after = await capture();
  const pending = await container.repos.runs.listRecoveryCandidates();
  return {
    beforeHash: before.eventsSha256,
    afterHash: after.eventsSha256,
    events: after.events,
    ok:
      before.eventsSha256 === after.eventsSha256 &&
      JSON.stringify(before.thread) === JSON.stringify(after.thread) &&
      JSON.stringify(before.run) === JSON.stringify(after.run) &&
      !pending.some((entry) => entry.id === id),
    mechanism:
      'Public clearFinalized port; container close and file-backed reopen; no process crash claim',
  };
}
async function close() {
  if (isClosed) return;
  isClosed = true;
  clearInterval(sampling);
  if (manager && container) {
    const unfinished = await container.repos.runs.listRunReferences([
      'queued',
      'running',
      'waiting',
      'paused',
    ]);
    for (const run of unfinished)
      await manager.cancel(run.id).catch((error) => {
        if (error.code !== 'INVALID_STATE') throw error;
      });
  }
  manager?.stop();
  await manager?.waitForIdle();
  await app?.close();
  await container?.stop();
}
const commands = {
  boot,
  populate: ({ count }) => populate(count),
  begin,
  finish,
  probe,
  recoverControl,
  memory: async ({ gc = false } = {}) => {
    if (gc) global.gc();
    return {
      ...(await memory()),
      maxWritableBytes,
      maxRss,
      maxHeap,
      eventLoopDelayMs: { mean: lag.mean / 1e6, p99: lag.percentile(99) / 1e6, max: lag.max / 1e6 },
      repositoryTimings: Object.fromEntries(
        Object.entries(stats).map(([key, value]) => [key, value.json()]),
      ),
    };
  },
  startReplay: async () => {
    stats = {};
    global.gc();
    maxWritableBytes = 0;
    maxRss = 0;
    maxHeap = 0;
    replaySockets.clear();
    lag.reset();
    lag.enable();
    // Arm the histogram before the request, including synchronous replay reads/writes.
    await new Promise((resolve) => setTimeout(resolve, 20));
    return memory('baseline');
  },
  endReplay: async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    const result = await commands.memory();
    lag.disable();
    return result;
  },
  close,
};
process.on('message', ({ id, command, args }) => {
  Promise.resolve()
    .then(() => commands[command](args))
    .then(
      (result) => process.send({ id, result }),
      (error) => process.send({ id, error: error.stack }),
    );
});
let profiler;
const profilePost = (method, params = {}) =>
  new Promise((resolve, reject) =>
    profiler.post(method, params, (error, result) => (error ? reject(error) : resolve(result))),
  );
if (options.profileMode === 'inspector') {
  profiler = new Session();
  profiler.connect();
  await profilePost('Profiler.enable');
  await profilePost('Profiler.setSamplingInterval', { interval: 1000 });
  await profilePost('Profiler.start');
}
async function stopProfile() {
  if (!profiler) return;
  const { profile } = await profilePost('Profiler.stop');
  await writeFile(
    join(options.output, options.profileName ?? 'api.cpuprofile'),
    JSON.stringify(profile),
  );
  profiler.disconnect();
  profiler = undefined;
}
process.on('disconnect', () => {
  void close()
    .then(stopProfile)
    .then(
      () => process.exit(0),
      (error) => {
        process.stderr.write(error.stack + '\n');
        process.exit(1);
      },
    );
});
process.send({ ready: true });
