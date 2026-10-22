import assert from 'node:assert/strict';
import { fork, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  initialThreadFrom,
  tryThreadAt,
  patchDiff,
} from '../../../apps/web/src/runs/projections.ts';
import { independentStates, at } from './oracle.mjs';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const out = fileURLToPath(new URL('./', import.meta.url));
const data = await mkdtemp(join(tmpdir(), 'gg-qa-g1-'));
const origin = 'http://127.0.0.1:5723';
const result = {
  revision: '293dec1cacd6df86f317c7a312e6b744e0aaab11',
  node: process.version,
  data: '%TEMP%/' + data.split(/[\\/]/).at(-1),
  origin,
  checks: [],
  forks: [],
  lifecycle: [],
};
const scrub = (x) =>
  String(x)
    .replaceAll(root.replaceAll('\\', '/'), '<worktree>/')
    .replaceAll(root, '<worktree>/')
    .replaceAll(data, result.data)
    .replace(/C:[\\/]Users[\\/][^\\/\r\n]+/gi, '<local>');
const save = async (name, value) =>
  writeFile(
    join(out, name),
    scrub(typeof value === 'string' ? value : JSON.stringify(value, null, 2)),
  );
function check(name, fn, evidence = {}) {
  try {
    fn();
    result.checks.push({ name, status: 'PASS', ...evidence });
  } catch (error) {
    result.checks.push({ name, status: 'FAIL', error: scrub(error.message), ...evidence });
  }
}
let child,
  key,
  next = 0;
const pending = new Map();
async function launch() {
  child = fork(join(out, 'server.mjs'), [], {
    execArgv: [],
    env: { ...process.env, QA_DATA: data },
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  });
  let log = '';
  child.stdout.on('data', (b) => {
    log += b;
  });
  child.stderr.on('data', (b) => {
    log += b;
  });
  child.on('message', (m) => {
    if (m.id) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.reject(new Error(m.error)) : p.resolve(m.value);
    }
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('server startup timeout ' + scrub(log))),
      30000,
    );
    child.on('message', (m) => {
      if (m.ready) {
        clearTimeout(timeout);
        result.lifecycle.push({ action: 'started', pid: m.pid });
        resolve();
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error('server exited ' + code + ' ' + scrub(log)));
    });
  });
  const launched = child;
  child.on('exit', (code) => {
    result.lifecycle.push({ action: 'exited', pid: launched.pid, code });
    void save('server.log', log);
  });
}
function control(op, args) {
  return new Promise((resolve, reject) => {
    const id = ++next;
    pending.set(id, { resolve, reject });
    child.send({ id, op, args });
  });
}
async function stop() {
  const old = child;
  await control('close');
  await new Promise((r) => (old.exitCode === null ? old.once('exit', r) : r()));
}
async function crash() {
  const old = child;
  const exited = new Promise((r) => old.once('exit', r));
  old.kill('SIGKILL');
  await exited;
}
async function api(path, body, method = body === undefined ? 'GET' : 'POST', expected) {
  const response = await fetch(origin + path, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  const value = text ? JSON.parse(text) : null;
  if (expected !== undefined) assert.equal(response.status, expected, JSON.stringify(value));
  else assert.ok(response.ok, `${path}: ${response.status} ${text}`);
  return expected === undefined ? value : { status: response.status, body: value };
}
const getRun = (id) => api(`/runs/${id}`);
const getEvents = async (id) => (await api(`/runs/${id}/events?limit=1000`)).items;
async function until(id, statuses = ['succeeded', 'failed', 'cancelled', 'waiting']) {
  for (let i = 0; i < 250; i++) {
    const r = await getRun(id);
    if (statuses.includes(r.status)) {
      if (['succeeded', 'failed', 'cancelled'].includes(r.status)) {
        const raw = await control('raw', id);
        if (raw.run[0].finalized_at) return r;
      } else return r;
    }
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error('run poll timeout ' + id);
}
const set = (path, value) => ({ op: 'set', path, value: { kind: 'literal', value } });
const edge = (id, a, b, port = 'out') => ({ id, from: { node: a, port }, to: { node: b } });
function fixture(name, kind = 'repeat', limit = 10) {
  const nodes = [
    { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
    {
      id: 'init',
      kind: 'mutate',
      label: 'Initialize',
      config: {
        operations: [
          set('/vars/items', ['origin']),
          set('/vars/count', 0),
          set('/vars/badge', 'inherited'),
          set('/vars/nested', { yes: true, n: null }),
          { op: 'append-message', role: 'user', content: 'QA seed message' },
        ],
      },
    },
    {
      id: 'append',
      kind: 'mutate',
      label: 'Append',
      config: {
        operations: [
          set('/vars/items/-', 'fork-step'),
          {
            op: 'set',
            path: '/vars/count',
            value: { kind: 'expression', jsonata: '$count(vars.items)' },
          },
          set('/vars/badge', 'executed'),
          set('/vars/newField', 'added'),
          { op: 'append-message', role: 'assistant', content: 'QA appended message' },
        ],
      },
    },
    {
      id: 'gate',
      kind: 'decision',
      label: 'Gate',
      config: {
        kind: 'expression',
        jsonata: '"again"',
        maxPasses: 3,
        routes: [
          { id: 'again', label: 'Again', repeat: true },
          { id: 'done', label: 'Done' },
        ],
      },
    },
    { id: 'done', kind: 'exit', label: 'Done', config: { returns: 'vars' } },
  ];
  const edges = [
    edge('s', 'start', 'init'),
    edge('i', 'init', 'append'),
    edge('a', 'append', 'gate'),
    edge('r', 'gate', 'append', 'again'),
    edge('d', 'gate', 'done', 'done'),
    edge('l', 'gate', 'done', 'limit-reached'),
  ];
  if (kind !== 'repeat') {
    nodes.push(
      kind === 'wait'
        ? {
            id: 'hold',
            kind: 'wait',
            label: 'Input',
            config: { mode: 'input', prompt: 'QA input' },
          }
        : {
            id: 'hold',
            kind: 'inference',
            label: 'Fake turn',
            config: { prompt: { template: 'QA controlled fake turn' } },
          },
    );
    edges[1] = edge('i', 'init', 'hold');
    edges.push(edge('h', 'hold', 'append'));
  }
  return { schemaVersion: 4, name, settings: { maxNodeVisits: limit }, nodes, edges };
}
async function publish(def) {
  const r = await api('/loops', { definition: def });
  await api(`/loops/${r.loop.id}/publish`, {});
  return r.loop.id;
}
async function source(def) {
  const loop = await publish(def);
  const r = (await api(`/loops/${loop}/runs`, { input: { topic: 'qa', nested: [1, null, true] } }))
    .run;
  await until(r.id);
  await control('idle');
  return { id: r.id, loop, def };
}
async function frozen(id) {
  return {
    record: JSON.stringify(await getRun(id)),
    events: JSON.stringify(await api(`/runs/${id}/events?limit=1000`)),
    thread: JSON.stringify(await api(`/runs/${id}/thread`)),
    sqlite: JSON.stringify(await control('raw', id)),
  };
}
async function verify(id, label, def) {
  const events = await getEvents(id);
  const current = await api(`/runs/${id}/thread`);
  const raw = await control('raw', id);
  const stored = JSON.parse(raw.run[0].initial_thread);
  const queued = events[0];
  const seed = initialThreadFrom(current, events, def);
  check(label + ': queued seed equals SQLite initial thread', () =>
    assert.deepEqual(queued.initialThread, stored),
  );
  const states = independentStates(stored, events);
  const comparisons = states.map((s) => {
    const projected = tryThreadAt(seed, events, s.seq);
    let discrepancies = [];
    if (!projected.ok) discrepancies = ['projection error: ' + projected.error];
    else
      for (const field of Object.keys(s.thread)) {
        try {
          assert.deepEqual(projected.thread[field], s.thread[field]);
        } catch {
          discrepancies.push(field);
        }
      }
    return { ...s, projected, discrepancies };
  });
  check(
    label + ': all event sequences equal independent oracle',
    () =>
      assert.deepEqual(
        comparisons.filter((s) => s.discrepancies.length),
        [],
      ),
    {
      sequences: states.length,
      fields: [
        'schemaVersion',
        'run (including iteration)',
        'invocation',
        'vars',
        'messages',
        'outputs',
        'lastOutput',
        'artifacts',
        'gates',
        'counters.nodeVisits',
        'counters.usage',
      ],
    },
  );
  check(label + ': final HTTP thread equals independent oracle', () =>
    assert.deepEqual(current, states.at(-1).thread),
  );
  const checkpointSeq = raw.run[0].thread_snapshot_seq;
  if (checkpointSeq)
    check(
      label + ': SQLite checkpoint equals oracle at checkpoint sequence',
      () =>
        assert.deepEqual(
          JSON.parse(raw.run[0].thread_snapshot),
          states.find((s) => s.seq === checkpointSeq).thread,
        ),
      { checkpointSeq },
    );
  const item = {
    id,
    label,
    record: await getRun(id),
    events,
    storedSeed: stored,
    current,
    checkpointSeq,
    comparisons,
  };
  result.forks.push({
    id,
    label,
    events: events.length,
    status: item.record.status,
    seedVisits: stored.counters.nodeVisits,
    seedGate: stored.gates,
    file: `${label}.json`,
  });
  await save(`${label}.json`, item);
  return item;
}
async function replay(src, node, label, options = {}) {
  const before = await frozen(src.id);
  const parentEvents = await getEvents(src.id);
  const parentRaw = await control('raw', src.id);
  const priorStates = independentStates(JSON.parse(parentRaw.run[0].initial_thread), parentEvents);
  const first = parentEvents.find((e) => e.type === 'node.started' && e.nodeId === node);
  const expected =
    first.seq === 1
      ? JSON.parse(parentRaw.run[0].initial_thread)
      : priorStates.find((s) => s.seq === first.seq - 1).thread;
  if (!options.live) await control('stop');
  const forked = (await api(`/runs/${src.id}/replay`, { nodeId: node })).run;
  const queued = options.live
    ? (await getEvents(forked.id))[0].initialThread
    : await api(`/runs/${forked.id}/thread`);
  for (const field of [
    'vars',
    'messages',
    'outputs',
    'lastOutput',
    'artifacts',
    'gates',
    'counters',
  ])
    check(label + ': inherited ' + field, () => assert.deepEqual(queued[field], expected[field]));
  check(label + ': inherited iteration', () =>
    assert.equal(queued.run.iteration, expected.run.iteration),
  );
  const queuedEvents = await getEvents(forked.id);
  if (!options.live)
    check(label + ': queued public thread is recorded seed', () =>
      assert.deepEqual(queued, queuedEvents[0].initialThread),
    );
  if (options.restart) {
    await crash();
    await launch();
    result.lifecycle.push({ action: 'restart-before-fork-start', forkId: forked.id });
  } else if (!options.live) await control('start');
  await until(forked.id);
  if (options.live && (await getRun(forked.id)).status === 'waiting') await control('idle');
  const artifact = await verify(forked.id, label, src.def);
  const after = await frozen(src.id);
  check(label + ': source bytes unchanged in HTTP and SQLite', () =>
    assert.deepEqual(after, before),
  );
  await save(`${label}-source-bytes.json`, {
    sourceId: src.id,
    before,
    after,
    equal: JSON.stringify(before) === JSON.stringify(after),
  });
  return { id: forked.id, loop: src.loop, def: src.def, artifact };
}
try {
  // Mint the first key with the real built CLI; retain only the redacted transcript.
  const cli = spawn(
    process.execPath,
    [join(root, 'apps/api/dist/main.js'), '--create-api-key', 'independent-qa'],
    { env: { ...process.env, GG_DATA_DIR: data, GG_PORT: '5723' }, windowsHide: true },
  );
  let transcript = '';
  cli.stdout.on('data', (b) => {
    transcript += b;
  });
  cli.stderr.on('data', (b) => {
    transcript += b;
  });
  const code = await new Promise((r) => cli.on('exit', r));
  assert.equal(code, 0, scrub(transcript));
  key = transcript.match(/\bgg_[A-Za-z0-9_-]+/)?.[0];
  assert.ok(key, 'CLI token');
  await save('key-cli.log', transcript.replaceAll(key, '<redacted-disposable-api-key>'));
  // Only the temp helper state contains the disposable token; it is not a report artefact.
  await writeFile(join(data, 'browser-state.json'), JSON.stringify({ key, origin }));
  await launch();
  const def = fixture('Independent QA replay matrix');
  const src = await source(def);
  await verify(src.id, 'source', def);
  const first = await replay(src, 'init', 'first-after-trigger', { restart: true });
  await replay(src, 'append', 'array-mutator');
  const g1 = await replay(src, 'gate', 'gate-pass-1');
  const a2 = await replay(g1, 'append', 'fork-of-fork-pass-2');
  const g2 = await replay(a2, 'gate', 'gate-pass-2');
  const a3 = await replay(g2, 'append', 'fork-of-fork-pass-3');
  const g3 = await replay(a3, 'gate', 'gate-pass-3');
  await replay(src, 'done', 'exit');
  check('gate seeds are passes 1, 2 and 3', () =>
    assert.deepEqual(
      [g1, g2, g3].map((x) => x.artifact.storedSeed.gates.gate.passes),
      [1, 2, 3],
    ),
  );
  check('array values and replace values have exact semantic result', () => {
    assert.deepEqual(g1.artifact.current.vars.items, [
      'origin',
      'fork-step',
      'fork-step',
      'fork-step',
    ]);
    assert.equal(g1.artifact.current.vars.count, 4);
    assert.equal(g1.artifact.current.vars.badge, 'executed');
  });
  const beforeConcurrent = await frozen(src.id);
  await control('stop');
  const pair = await Promise.all(
    [1, 2].map(() => api(`/runs/${src.id}/replay`, { nodeId: 'append' })),
  );
  await control('start');
  for (const [i, p] of pair.entries()) {
    await until(p.run.id);
    await verify(p.run.id, 'concurrent-' + (i + 1), def);
  }
  check('concurrent forks have distinct IDs and equal state values', () => {
    assert.notEqual(pair[0].run.id, pair[1].run.id);
    const pairItems = result.forks.filter((x) => x.label.startsWith('concurrent'));
    assert.equal(pairItems.length, 2);
  });
  const afterConcurrent = await frozen(src.id);
  check('concurrent forks source bytes unchanged', () =>
    assert.deepEqual(afterConcurrent, beforeConcurrent),
  );
  await save('concurrent-source-bytes.json', { before: beforeConcurrent, after: afterConcurrent });
  const waiting = await source(fixture('QA waiting source', 'wait'));
  const waitingFork = await replay(waiting, 'hold', 'waiting-source', { live: true });
  // Persisted middle-of-execution restart at an input wait, then continue with a unique answer.
  const waitingBeforeRestart = await frozen(waitingFork.id);
  await stop();
  await launch();
  const waitingAfterRestart = await frozen(waitingFork.id);
  check('waiting fork seed and thread survive restart', () => {
    assert.equal(waitingBeforeRestart.thread, waitingAfterRestart.thread);
    assert.equal(
      JSON.parse(waitingBeforeRestart.sqlite).run[0].initial_thread,
      JSON.parse(waitingAfterRestart.sqlite).run[0].initial_thread,
    );
  });
  await save('waiting-restart.json', { before: waitingBeforeRestart, after: waitingAfterRestart });
  const wait = await getRun(waitingFork.id);
  await api(`/runs/${waitingFork.id}/input`, {
    waitId: wait.waiting.waitId,
    input: { answer: 'fork only' },
  });
  await until(waitingFork.id);
  await verify(waitingFork.id, 'waiting-fork-after-restart', waiting.def);
  await api(`/runs/${waiting.id}/cancel`, {});
  await until(waiting.id, ['cancelled']);
  await replay(waiting, 'hold', 'cancelled-source');
  await control('script', [
    { error: { code: 'QA_FAKE_FAILURE', message: 'controlled failure', retriable: false } },
  ]);
  const failed = await source(fixture('QA failed source', 'inference'));
  const failedRecord = await getRun(failed.id);
  check('failed source fixture really failed', () => assert.equal(failedRecord.status, 'failed'));
  await replay(failed, 'init', 'failed-source');
  await control('script', [{ delayMs: 60000, finalText: 'delayed source' }]);
  const runningDef = fixture('QA running source', 'inference');
  const runningLoop = await publish(runningDef);
  const running = {
    id: (await api(`/loops/${runningLoop}/runs`, {})).run.id,
    loop: runningLoop,
    def: runningDef,
  };
  for (let i = 0; i < 100; i++) {
    const es = await getEvents(running.id);
    if (es.some((e) => e.type === 'harness.session')) break;
    await new Promise((r) => setTimeout(r, 40));
  }
  assert.equal((await getRun(running.id)).status, 'running');
  await replay(running, 'init', 'running-source', { live: true });
  await api(`/runs/${running.id}/cancel`, {});
  await until(running.id, ['cancelled']);
  // Active native-process crash: fake execution stays uncompleted until the process is killed.
  await control('script', [{ delayMs: 60000, finalText: 'interrupted fork' }]);
  const active = (await api(`/runs/${failed.id}/replay`, { nodeId: 'hold' })).run;
  for (let i = 0; i < 100; i++) {
    const es = await getEvents(active.id);
    if (es.some((e) => e.type === 'harness.session')) break;
    await new Promise((r) => setTimeout(r, 40));
  }
  const activeBefore = await frozen(active.id);
  const oldPid = child.pid;
  const exited = new Promise((r) => child.once('exit', r));
  child.kill('SIGKILL');
  await exited;
  result.lifecycle.push({ action: 'crash-mid-fork-inference', pid: oldPid, forkId: active.id });
  await launch();
  await until(active.id);
  const activeAfter = await frozen(active.id);
  check('active restart preserves queued seed and initial thread bytes', () => {
    assert.equal(
      JSON.parse(activeBefore.sqlite).run[0].initial_thread,
      JSON.parse(activeAfter.sqlite).run[0].initial_thread,
    );
    assert.deepEqual(
      JSON.parse(activeBefore.events).items[0],
      JSON.parse(activeAfter.events).items[0],
    );
  });
  await save('active-restart.json', { before: activeBefore, after: activeAfter });
  await verify(active.id, 'active-restart-fork', failed.def);
  const guardSrc = await source(fixture('QA own-entry guard', 'repeat', 2));
  const guardFork = await replay(guardSrc, 'gate', 'guard-own-starts');
  const guardEvents = guardFork.artifact.events;
  check('maxNodeVisits uses own attempt-1 starts', () => {
    assert.equal(
      guardEvents.filter((e) => e.type === 'node.started' && e.nodeId === 'gate' && e.attempt === 1)
        .length,
      2,
    );
    assert.equal(guardFork.artifact.current.counters.nodeVisits.append, 3);
    assert.equal(guardFork.artifact.record.status, 'failed');
  });
  const negatives = [];
  for (const [label, id, body, status] of [
    ['unreached', waiting.id, { nodeId: 'done' }, 409],
    ['absent-from-pinned', src.id, { nodeId: 'invented' }, 409],
    ['empty-body', src.id, {}, 400],
    ['extra-field-stripped-by-object-schema', src.id, { nodeId: 'append', extra: true }, 202],
    ['invalid-node-unreached-string', src.id, { nodeId: '../bad' }, 409],
  ]) {
    const response = await api(`/runs/${id}/replay`, body, 'POST', status);
    negatives.push({ label, body, response });
  }
  const deleted = await source(fixture('QA deleted loop'));
  await api(`/loops/${deleted.loop}`, undefined, 'DELETE');
  negatives.push({
    label: 'deleted-loop-run',
    response: await api(`/runs/${deleted.id}/replay`, { nodeId: 'append' }, 'POST', 404),
  });
  await save('negative-responses.json', negatives);
  check('public API negative cases', () => assert.equal(negatives.length, 6));
  // Independent display diff captures both concrete replace and array-append limitations.
  const appendFinish = g1.artifact.events.find(
    (e) => e.type === 'node.finished' && e.nodeId === 'append',
  );
  const prev = g1.artifact.comparisons.find((s) => s.seq === appendFinish.seq - 1).thread;
  const nextState = g1.artifact.comparisons.find((s) => s.seq === appendFinish.seq).thread;
  await save('patch-display.json', {
    forkId: g1.id,
    seq: appendFinish.seq,
    before: prev,
    after: nextState,
    patch: appendFinish.patch,
    display: patchDiff(prev, nextState, appendFinish.patch),
  });
  result.browser = {
    keyFile: result.data + '/browser-state.json',
    primaryId: a2.id,
    gateId: g1.id,
    guardId: guardFork.id,
    firstId: first.id,
    origin,
  };
  await save('results.json', result);
  await writeFile(
    join(data, 'browser-state.json'),
    JSON.stringify({ key, ...result.browser, data }),
  );
  process.stdout.write(
    JSON.stringify({
      checks: result.checks.length,
      failed: result.checks.filter((x) => x.status === 'FAIL'),
      browserState: result.data + '/browser-state.json',
      pid: child.pid,
    }) + '\n',
  );
  // Browser stage keeps this native child alive; a newline requests clean shutdown.
  process.stdin.once('data', async () => {
    await stop();
    await save('results.json', result);
    process.exit(0);
  });
} catch (error) {
  result.fatal = scrub(error.stack);
  await save('results.json', result);
  process.stderr.write(result.fatal + '\n');
  if (child?.connected) await stop().catch(() => child.kill());
  process.exitCode = 1;
}
