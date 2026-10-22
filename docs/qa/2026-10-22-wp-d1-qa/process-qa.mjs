// Independent QA only. Run with Node 22 --experimental-import-meta-resolve.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { createServer } from 'node:net';
import { randomInt } from 'node:crypto';

const root = new URL('../../../', import.meta.url);
const apiParent = new URL('apps/api/package.json', root);
const load = (name) => import(import.meta.resolve(name, apiParent));
const { CURRENT_DEFINITION_FORMAT: format, LoopDefinitionSchema } =
  await load('@graphgoblin/contracts');
const { RunManager } = await load('@graphgoblin/engine');
const { createFakePorts, DEFAULT_TEST_SETTINGS } = await load('@graphgoblin/engine/testing');
const {
  openDatabase,
  openReadOnlyDatabaseClient,
  SqliteEventStore,
  SqliteRunRepository,
  SqliteLoopRepository,
  SqliteTriggerAdmission,
} = await load('@graphgoblin/infrastructure/sqlite');
const evidenceDir = fileURLToPath(new URL('.', import.meta.url));
const timestamp = () => new Date().toISOString();
const never = () => new Promise(() => {});
const inherited = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !key.toUpperCase().startsWith('GG_') &&
      !['JEV_API_KEY', 'NODE_V8_COVERAGE'].includes(key.toUpperCase()),
  ),
);
const startNode = { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } };
const doneNode = (returns = '"child output"') => ({
  id: 'done',
  kind: 'exit',
  label: 'Done',
  config: { returns },
});
const edge = (id, from, to) => ({ id, from: { node: from, port: 'out' }, to: { node: to } });
const leaf = (wait = true) => ({
  schemaVersion: format,
  name: 'QA input leaf',
  nodes: [
    startNode,
    ...(wait
      ? [
          {
            id: 'ask',
            kind: 'wait',
            label: 'Ask',
            config: { mode: 'input', prompt: 'QA continue?' },
          },
        ]
      : []),
    doneNode(),
  ],
  edges: wait
    ? [edge('a', 'start', 'ask'), edge('b', 'ask', 'done')]
    : [edge('a', 'start', 'done')],
});
const parent = (child, mapping = false) => ({
  schemaVersion: format,
  name: 'QA parent',
  nodes: [
    startNode,
    {
      id: 'sub',
      kind: 'subloop',
      label: 'Sub',
      config: {
        loopRef: { loopId: child },
        ...(mapping ? { output: { mode: 'custom', custom: { patch: '"not a patch"' } } } : {}),
      },
    },
    doneNode('outputs.sub.value.result'),
  ],
  edges: [edge('a', 'start', 'sub'), edge('b', 'sub', 'done')],
});
const failureLeaf = {
  schemaVersion: format,
  name: 'QA fake script child',
  nodes: [
    startNode,
    { id: 'work', kind: 'script', label: 'Work', config: { command: 'qa-fake', args: [] } },
    doneNode(),
  ],
  edges: [edge('a', 'start', 'work'), edge('b', 'work', 'done')],
};
function portsFor(handle) {
  const fake = createFakePorts();
  const events = new SqliteEventStore(handle.db, fake.clock);
  return {
    ...fake,
    events,
    runs: new SqliteRunRepository(handle.db),
    loops: new SqliteLoopRepository(handle.db, fake.clock, fake.ids),
    admission: new SqliteTriggerAdmission(handle.db, events),
  };
}
async function poll(check, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await sleep(10);
  }
  throw new Error('QA poll timeout');
}
function launch(entry, args, env) {
  const child = spawn(process.execPath, [...args, fileURLToPath(entry)], {
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '',
    err = '',
    exited = false;
  child.stdout.on('data', (chunk) => {
    out += chunk;
  });
  child.stderr.on('data', (chunk) => {
    err += chunk;
  });
  const closed = new Promise((resolveClose, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => {
      exited = true;
      resolveClose({ code, signal });
    });
  });
  return {
    child,
    get out() {
      return out;
    },
    get err() {
      return err;
    },
    get exited() {
      return exited;
    },
    async kill() {
      if (!exited) child.kill('SIGKILL');
      return closed;
    },
    async wait(text) {
      await poll(() => {
        if (out.includes(text)) return true;
        if (exited) throw new Error(`Early exit: ${err}`);
        return false;
      });
    },
  };
}
async function worker() {
  const h = openDatabase({ url: process.env.QA_DB });
  const ports = portsFor(h);
  const stored = ports.events;
  const target = process.env.QA_PARENT;
  const mode = process.env.QA_MODE;
  let blocked = false;
  const boundary = async (where) => {
    if (blocked) return never();
    blocked = true;
    process.stdout.write(
      JSON.stringify({
        marker: 'BOUNDARY',
        ts: timestamp(),
        where,
        parent: await ports.runs.get(target),
        children: await ports.runs.listChildren(target),
        events: (await stored.read(target)).map(({ seq, type, nodeId, ...rest }) => ({
          seq,
          type,
          nodeId,
          ...rest,
        })),
      }) + '\n',
    );
    return never();
  };
  if (mode === 'admitted-before-park') {
    const admission = ports.admission;
    ports.admission = {
      create: async (input, receipt) => {
        const run = await admission.create(input, receipt);
        if (input.run.parentRunId === target)
          await boundary('after real admission commit before acknowledgement');
        return run;
      },
      createPollItem: (...a) => admission.createPollItem(...a),
      claim: (...a) => admission.claim(...a),
      get: (...a) => admission.get(...a),
      due: (...a) => admission.due(...a),
      failed: (...a) => admission.failed(...a),
      hasPendingPin: (...a) => admission.hasPendingPin(...a),
    };
  } else if (
    ['finished-before-node', 'failure-before-parent', 'independent-child-resume'].includes(mode)
  ) {
    ports.events = {
      read: (...a) => stored.read(...a),
      subscribe: (...a) => stored.subscribe(...a),
      append: async (id, drafts, options) => {
        const stop =
          id === target &&
          drafts.some((d) =>
            mode === 'finished-before-node'
              ? d.type === 'node.finished' && d.nodeId === 'sub'
              : d.type === 'run.failed',
          );
        if (stop) await boundary(mode);
        return stored.append(id, drafts, options);
      },
    };
  }
  ports.scripts.respondWith(() => ({
    exitCode: process.env.QA_SCRIPT_SUCCESS === '1' ? 0 : 3,
    stdout: '',
    stderr: '',
    stdoutBytes: 0,
    stderrBytes: 0,
    stdoutOverflow: false,
    stderrOverflow: false,
    timedOut: false,
  }));
  const manager = new RunManager(ports, { ...DEFAULT_TEST_SETTINGS, maxConcurrentRuns: 4 });
  await manager.start();
  if (mode === 'independent-child-resume') {
    await manager.resume(process.env.QA_CHILD);
    await poll(async () => (await ports.runs.get(process.env.QA_CHILD))?.status === 'succeeded');
    process.stdout.write(
      JSON.stringify({
        marker: 'CHILD_RESUMED',
        ts: timestamp(),
        child: await ports.runs.get(process.env.QA_CHILD),
        parent: await ports.runs.get(target),
        events: await stored.read(target),
        childEvents: await stored.read(process.env.QA_CHILD),
      }) + '\n',
    );
  }
  setInterval(() => {}, 1000);
}

// Both directions are checked in one SQLite statement/snapshot.
const gapsSql = `SELECT 'child_without_link' AS gap, c.id AS id FROM runs c
  WHERE c.parent_run_id IS NOT NULL AND NOT EXISTS
   (SELECT 1 FROM run_events e WHERE e.run_id=c.parent_run_id AND e.type='child_run.started'
    AND json_extract(e.payload,'$.childRunId')=c.id)
  UNION ALL SELECT 'link_without_child', e.run_id FROM run_events e
  WHERE e.type='child_run.started' AND NOT EXISTS
   (SELECT 1 FROM runs c WHERE c.id=json_extract(e.payload,'$.childRunId') AND c.parent_run_id=e.run_id)`;
const stores = [],
  processes = [],
  results = [];
let apiPort;
async function freePort() {
  for (let p = 5920; p <= 5929; p++) {
    const server = createServer();
    const available = await new Promise((r) => {
      server.on('error', () => r(false));
      server.listen(p, '127.0.0.1', () => server.close(() => r(true)));
    });
    if (available) return p;
  }
  throw new Error('No free QA port');
}
async function createStore(
  name,
  { nested = false, input = true, mapping = false, failing = false } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), 'gg-qa-320-'));
  stores.push(directory);
  const dbFile = join(directory, 'graphgoblin.db');
  const url = `file:${dbFile.replaceAll('\\', '/')}`;
  const h = openDatabase({ url });
  await h.migrate();
  const ports = portsFor(h);
  const manager = new RunManager(ports, DEFAULT_TEST_SETTINGS);
  manager.stop();
  const publish = async (d) => {
    const { loop } = await ports.loops.create('local', LoopDefinitionSchema.parse(d));
    await ports.loops.publish(loop.id);
    return loop.id;
  };
  let loop = await publish(failing ? failureLeaf : leaf(input));
  if (nested) loop = await publish(parent(loop));
  loop = await publish(parent(loop, mapping));
  const run = await manager.startRun({ ownerId: 'local', loopId: loop, source: 'manual.api' });
  h.close();
  const observer = openReadOnlyDatabaseClient(dbFile);
  return {
    name,
    directory,
    dbFile,
    url,
    runId: run.id,
    observer,
    env: {
      ...inherited,
      GG_DATA_DIR: directory,
      GG_DB_URL: url,
      GG_HOST: '127.0.0.1',
      GG_PORT: String(apiPort),
      GG_LOG_LEVEL: 'info',
      GG_REQUIRE_API_KEY: 'false',
      GG_SWAGGER_UI: 'false',
      GG_WEB_DIST: '',
      GG_JEV_API_KEY: '',
      GG_MAX_CONCURRENT_RUNS: '4',
      GG_MASTER_KEY: Buffer.alloc(32, 6).toString('base64'),
    },
  };
}
async function startApi(s) {
  const p = launch(new URL('apps/api/dist/main.js', root), [], s.env);
  processes.push(p);
  return p;
}
async function ready(p) {
  await p.wait('GraphGoblin API listening');
}
async function call(method, path, body) {
  const response = await fetch(`http://127.0.0.1:${apiPort}${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${method} ${path} ${response.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
async function snapshot(s) {
  const runs = (
    await s.observer.execute(
      'SELECT id,parent_run_id,status,current_node_id,waiting,result,failure FROM runs',
    )
  ).rows;
  const events = (
    await s.observer.execute(
      'SELECT run_id,seq,type,node_id,payload,ts FROM run_events ORDER BY run_id,seq',
    )
  ).rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
  const gaps = (await s.observer.execute(gapsSql)).rows;
  return { ts: timestamp(), runs, events, gaps };
}
function assertOne(state, s, levels, terminal = false) {
  assert.equal(state.gaps.length, 0);
  let id = s.runId;
  for (let i = 0; i < levels; i++) {
    const children = state.runs.filter((r) => r.parent_run_id === id);
    assert.equal(children.length, 1);
    const links = state.events.filter((e) => e.run_id === id && e.type === 'child_run.started');
    assert.equal(links.length, 1);
    assert.equal(links[0].payload.childRunId, children[0].id);
    const p = state.runs.find((r) => r.id === id);
    if (terminal) {
      assert.equal(p.status, 'succeeded');
      assert.equal(
        state.events.filter((e) => e.run_id === id && e.type === 'child_run.finished').length,
        1,
      );
      assert.equal(
        state.events.filter((e) => e.run_id === id && e.type === 'run.finished').length,
        1,
      );
    } else {
      assert.equal(p.status, 'waiting');
      assert.equal(JSON.parse(p.waiting).childRunId, children[0].id);
    }
    id = children[0].id;
  }
}
async function finishInput(s, levels) {
  await poll(async () => {
    const ss = await snapshot(s);
    return ss.runs.length === levels + 1 && ss.runs.every((r) => r.status === 'waiting');
  });
  const parked = await snapshot(s);
  assertOne(parked, s, levels);
  const child = parked.runs.find((r) => !parked.runs.some((x) => x.parent_run_id === r.id));
  const inputResponse = await call('POST', `/runs/${child.id}/input`, {
    waitId: JSON.parse(child.waiting).waitId,
    input: 'QA answered after restart',
  });
  await poll(async () => (await snapshot(s)).runs.every((r) => r.status === 'succeeded'));
  const done = await snapshot(s);
  assertOne(done, s, levels, true);
  return { parked, inputResponse, done };
}
async function save(name, record) {
  await writeFile(join(evidenceDir, `${name}.json`), JSON.stringify(record, null, 2) + '\n');
  results.push({ name, pass: true });
  console.log(`${timestamp()} PASS ${name}`);
}
function logExcerpt(p, directory) {
  return p.out
    .split(/\r?\n/)
    .filter((l) => /listening|recover|HISTORY|error|warn/.test(l))
    .map((l) =>
      l
        .replaceAll(directory, '<disposable-store>')
        .replaceAll(directory.replaceAll('\\', '\\\\'), '<disposable-store>'),
    );
}
async function trial(delay, nested = false, afterChild = false) {
  const name = `${nested ? 'nested' : afterChild ? 'random-child' : 'sweep'}-${delay}ms`;
  const s = await createStore(name, { nested });
  let first;
  try {
    first = await startApi(s);
    let anchor,
      observations = 0,
      gap;
    const deadline = Date.now() + 60000;
    for (;;) {
      assert.ok(Date.now() < deadline, 'No run start observed');
      const query = await s.observer.execute(`SELECT
       (SELECT count(*) FROM run_events WHERE run_id='${s.runId}' AND type='run.started') AS started,
       (SELECT count(*) FROM runs WHERE parent_run_id IS NOT NULL) AS children`);
      const gaps = (await s.observer.execute(gapsSql)).rows;
      observations++;
      if (gaps.length) {
        gap = gaps;
        break;
      }
      const row = query.rows[0];
      if (
        nested
          ? Number(row.children) >= 2
          : afterChild
            ? Number(row.children) > 0
            : Number(row.started) > 0
      )
        anchor ??= performance.now();
      if (anchor !== undefined && performance.now() - anchor >= delay) break;
      await new Promise((r) => setImmediate(r));
    }
    const killedAt = timestamp(),
      elapsed = performance.now() - anchor;
    const kill = await first.kill();
    const atKill = await snapshot(s);
    assert.equal(gap, undefined);
    const second = await startApi(s);
    await ready(second);
    const completion = await finishInput(s, nested ? 2 : 1);
    await second.kill();
    await save(name, {
      anchor: nested
        ? 'first grandchild observed'
        : afterChild
          ? 'first child observed; random delay from crypto.randomInt(1,51)'
          : 'parent run.started first observed',
      requestedDelayMs: delay,
      actualDelayMs: elapsed,
      observations,
      gap: gap ?? null,
      killedAt,
      kill,
      port: apiPort,
      atKill,
      ...completion,
      apiLogs: [...logExcerpt(first, s.directory), ...logExcerpt(second, s.directory)],
    });
  } finally {
    await first?.kill();
    s.observer.close();
  }
}
async function spawnWorker(s, mode, overrides = {}) {
  const p = launch(import.meta.url, ['--experimental-import-meta-resolve'], {
    ...s.env,
    QA_WORKER: '1',
    QA_DB: s.url,
    QA_PARENT: s.runId,
    QA_MODE: mode,
    ...overrides,
  });
  processes.push(p);
  return p;
}
async function boundaryTrial(mode) {
  const s = await createStore(mode, {
    input: mode === 'admitted-before-park',
    failing: mode === 'failure-before-parent',
  });
  try {
    const p = await spawnWorker(s, mode);
    await p.wait('BOUNDARY');
    const boundary = JSON.parse(
      p.out
        .trim()
        .split('\n')
        .find((line) => line.includes('BOUNDARY')),
    );
    const killedAt = timestamp();
    await p.kill();
    const before = await snapshot(s);
    assert.equal(before.runs.length, 2);
    assert.equal(before.gaps.length, 0);
    if (mode === 'failure-before-parent') {
      const child = before.runs.find((r) => r.parent_run_id === s.runId);
      const retry = await spawnWorker(s, 'independent-child-resume', {
        QA_CHILD: child.id,
        QA_SCRIPT_SUCCESS: '1',
      });
      await retry.wait('CHILD_RESUMED');
      const retried = JSON.parse(
        retry.out
          .trim()
          .split('\n')
          .find((line) => line.includes('CHILD_RESUMED')),
      );
      assert.equal(retried.child.status, 'succeeded');
      await retry.kill();
      const api = await startApi(s);
      await ready(api);
      const after = await poll(async () => {
        const x = await snapshot(s);
        return x.runs.find((r) => r.id === s.runId)?.status === 'succeeded' && x;
      });
      const events = after.events
        .filter((e) => e.run_id === s.runId)
        .map((e) => ({ ...e.payload, type: e.type, seq: e.seq }));
      const wakes = events.filter((e) => e.type === 'run.woken' && e.reason === 'child');
      const finishes = events.filter((e) => e.type === 'child_run.finished');
      const terminal = retried.childEvents.filter((e) =>
        ['run.failed', 'run.finished'].includes(e.type),
      );
      assert.equal(finishes.at(-1).status, 'succeeded');
      assert.equal(wakes.at(-1).payload.childFinishedSeq, terminal.at(-1).seq);
      assert.equal(new Set(wakes.map((e) => e.payload.childFinishedSeq)).size, 2);
      assert.equal(finishes.length, 2);
      assert.equal(finishes[0].status, 'failed');
      await api.kill();
      await save(mode, {
        evidenceTier:
          'built public RunManager ports, real SQLite, real SIGKILL; script execution fake only; final recovery in built API',
        boundary,
        killedAt,
        before,
        retried,
        after,
        apiLogs: logExcerpt(api, s.directory),
      });
    } else {
      const api = await startApi(s);
      await ready(api);
      const after =
        mode === 'admitted-before-park'
          ? await finishInput(s, 1)
          : await poll(async () => {
              const x = await snapshot(s);
              return x.runs.every((r) => r.status === 'succeeded') && x;
            });
      if (mode !== 'admitted-before-park') assertOne(after, s, 1, true);
      await api.kill();
      await save(mode, {
        evidenceTier:
          'constructed boundary via public DI in built component process, real SIGKILL; recovery in unmodified built API',
        boundary,
        killedAt,
        before,
        after,
        apiLogs: logExcerpt(api, s.directory),
      });
    }
  } finally {
    s.observer.close();
  }
}
async function mappingTrial() {
  const s = await createStore('mapping-retry', { input: false, mapping: true });
  try {
    const api = await startApi(s);
    await ready(api);
    await poll(
      async () => (await snapshot(s)).runs.find((r) => r.id === s.runId)?.status === 'failed',
    );
    const before = await snapshot(s);
    await call('POST', `/runs/${s.runId}/resume`, {});
    await poll(
      async () =>
        (await snapshot(s)).events.filter((e) => e.run_id === s.runId && e.type === 'run.failed')
          .length === 2,
    );
    const after = await snapshot(s);
    assert.equal(after.runs.length, 2);
    assert.equal(
      after.events.filter((e) => e.run_id === s.runId && e.type === 'child_run.finished').length,
      1,
    );
    assert.equal(
      after.events.filter((e) => e.run_id === s.runId && e.type === 'child_run.started').length,
      1,
    );
    await api.kill();
    await save('mapping-retry', { before, after, apiLogs: logExcerpt(api, s.directory) });
  } finally {
    s.observer.close();
  }
}
if (process.env.QA_WORKER === '1') {
  await worker();
} else {
  apiPort = await freePort();
  console.log(`${timestamp()} START node=${process.version} port=${apiPort}`);
  try {
    if (process.env.QA_ONLY === 'random') {
      const delays = new Set();
      while (delays.size < 3) delays.add(randomInt(1, 51));
      for (const delay of delays) await trial(delay, false, true);
    } else if (process.env.QA_ONLY) {
      for (const mode of process.env.QA_ONLY.split(',')) {
        if (mode === 'mapping-retry') await mappingTrial();
        else await boundaryTrial(mode);
      }
    } else {
      for (const delay of [0, 2, 5, 10, 25, 50, 7, 18, 37]) await trial(delay);
      for (const delay of [0, 5, 25]) await trial(delay, true);
      for (const mode of ['admitted-before-park', 'finished-before-node', 'failure-before-parent'])
        await boundaryTrial(mode);
      await mappingTrial();
    }
  } catch (error) {
    console.error(`${timestamp()} FAIL ${error.stack}`);
    process.exitCode = 1;
    results.push({ pass: false, message: error.message });
  } finally {
    await Promise.all(processes.map((p) => p.kill()));
    for (const directory of stores) {
      const absolute = resolve(directory),
        allowed = resolve(tmpdir()) + sep;
      assert.ok(
        absolute.startsWith(allowed) && absolute.split(sep).at(-1).startsWith('gg-qa-320-'),
      );
      try {
        await rm(absolute, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        results.push({ cleanup: absolute.split(sep).at(-1), removed: true });
      } catch (error) {
        results.push({ cleanup: absolute.split(sep).at(-1), removed: false, code: error.code });
        process.exitCode = 1;
      }
    }
    await writeFile(
      join(
        evidenceDir,
        `process-summary${process.env.QA_ONLY ? '-' + process.env.QA_ONLY.replaceAll(',', '-') : ''}.json`,
      ),
      JSON.stringify({ timestamp: timestamp(), results }, null, 2) + '\n',
    );
  }
}
