// Independent QA through the built HTTP API, native processes, SQLite and real receivers.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import process from 'node:process';
const root = process.cwd(),
  out = join(root, 'docs/qa/2026-10-21-wp-d2-qa');
const store = await mkdtemp(join(tmpdir(), 'gg-qa-246-native-'));
const records = [],
  cases = [],
  logs = [],
  lifecycle = [];
let child,
  generation = 0,
  token;
const clean = (s) =>
  s
    .replaceAll(root, '%WORKTREE%')
    .replaceAll(process.env.TEMP, '%TEMP%')
    .replaceAll(process.env.USERPROFILE, '%USERPROFILE%');
const save = async (name, value) =>
  writeFile(join(out, name), clean(JSON.stringify(value, null, 2)) + '\n');
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GG_')));
Object.assign(env, {
  GG_DATA_DIR: store,
  GG_HOST: '127.0.0.1',
  GG_PORT: '5810',
  GG_WEB_DIST: '',
  GG_REQUIRE_API_KEY: 'true',
  GG_SWAGGER_UI: 'false',
  GG_LOG_LEVEL: 'info',
});
const api = 'http://127.0.0.1:5810',
  receiverUrl = 'http://127.0.0.1:5811';
const held = new Set(),
  timers = new Set();
const receiver = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const path = req.url,
    n = records.filter((r) => r.path === path).length + 1;
  records.push({
    ts: new Date().toISOString(),
    ms: Date.now(),
    path,
    n,
    key: req.headers['idempotency-key'],
    timestamp: req.headers['x-graphgoblin-timestamp'],
    body,
  });
  held.add(res);
  res.on('close', () => held.delete(res));
  if (path === '/never' || path === '/stop-attempt') return;
  if (path === '/slow-body') {
    res.writeHead(200, { 'content-length': '16' });
    res.write('partial');
    return;
  }
  if (path === '/late' && n === 1) {
    const t = setTimeout(() => {
      res.writeHead(200).end('late');
      timers.delete(t);
    }, 15000);
    timers.add(t);
    return;
  }
  if (path === '/drop' && n === 1) {
    res.writeHead(200, { 'content-length': '100' });
    res.write('short');
    res.destroy();
    return;
  }
  if (path === '/overflow') {
    res.writeHead(200).end(Buffer.alloc(65537, 120));
    return;
  }
  if (path === '/boundary') {
    res.writeHead(200).end(Buffer.alloc(65536, 120));
    return;
  }
  if (path === '/redirect') {
    res.writeHead(302, { location: receiverUrl + '/redirect-target' }).end();
    return;
  }
  const numeric = /^\/status-(\d+)$/.exec(path);
  const status = numeric
    ? Number(numeric[1])
    : path === '/five-success'
      ? n < 5
        ? 503
        : 200
      : ['/always', '/restart', '/parent-fail'].includes(path)
        ? 503
        : path === '/stop-backoff' && n === 1
          ? 503
          : 200;
  res.writeHead(status).end('ack');
});
async function until(fn, limit = 120000) {
  const end = Date.now() + limit;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await delay(40);
  }
  throw Error('Timed out');
}
async function boot(orderly = false) {
  generation++;
  const gen = generation;
  child = spawn(
    process.execPath,
    [orderly ? 'apps/api/scripts/webhook-retry.process.mjs' : 'apps/api/dist/main.js'],
    { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
  );
  let buf = '';
  const capture = (b) => {
    buf += b;
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  child.on('exit', (code, signal) => {
    lifecycle.push({ generation: gen, ts: new Date().toISOString(), code, signal });
    for (const line of buf.split(/\r?\n/)) {
      try {
        const r = JSON.parse(line);
        if (r.level >= 40 || /listening|shutting|returned|stop|closed/i.test(r.msg))
          logs.push({ generation: gen, ...r });
      } catch {
        if (line) logs.push({ generation: gen, line });
      }
    }
  });
  await until(async () => {
    assert.equal(child.exitCode, null, clean(buf));
    try {
      return (await fetch(api + '/healthz', { signal: AbortSignal.timeout(1500) })).ok;
    } catch {
      return false;
    }
  }, 120000);
}
async function kill() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const done = once(child, 'exit');
  child.kill('SIGKILL');
  await done;
}
async function stop(path) {
  const count = records.filter((r) => r.path === path).length;
  const start = Date.now();
  const done = once(child, 'exit');
  child.send('stop');
  const timeout = setTimeout(() => child.kill('SIGKILL'), 15000);
  try {
    const [code, signal] = await done;
    assert.equal(code, 0);
    assert.equal(signal, null);
    assert.equal(records.filter((r) => r.path === path).length, count);
    return Date.now() - start;
  } finally {
    clearTimeout(timeout);
  }
}
async function request(path, body) {
  const r = await fetch(api + path, {
    headers: {
      authorization: 'Bearer ' + token,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
  });
  const json = await r.json();
  assert.ok(r.ok, JSON.stringify(json));
  return json;
}
const trigger = { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } };
const exit = (destinations) => ({
  id: 'done',
  kind: 'exit',
  label: 'Done',
  config: { returns: 'invocation.payload', destinations },
});
async function publish(name, nodes, edges) {
  const { loop } = await request('/loops', {
    definition: { schemaVersion: 4, name, nodes, edges },
  });
  await request('/loops/' + loop.id + '/publish', {});
  return loop.id;
}
async function start(name, urls) {
  const id = await publish(
    'QA ' + name,
    [trigger, exit(urls.map((url) => ({ kind: 'webhook', url })))],
    [{ id: 'e', from: { node: 'start', port: 'out' }, to: { node: 'done' } }],
  );
  return (await request('/loops/' + id + '/runs', { input: { qa: name } })).run.id;
}
const snapshot = (id) => request('/runs/' + id);
const events = async (id) => (await request('/runs/' + id + '/events')).items;
function sql(id) {
  const script = `import {DatabaseSync} from 'node:sqlite';const d=new DatabaseSync(process.argv[1],{readOnly:true});console.log(JSON.stringify({run:d.prepare('SELECT id,status,finalized_at,last_event_seq FROM runs WHERE id=?').get(process.argv[2]),events:d.prepare('SELECT run_id,seq,ts,type,node_id,payload FROM run_events WHERE run_id=? ORDER BY seq').all(process.argv[2])}));d.close();`;
  const r = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', script, join(store, 'graphgoblin.db'), id],
    { windowsHide: true, encoding: 'utf8' },
  );
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}
async function finished(id) {
  return until(async () => {
    const r = await snapshot(id);
    return r.deliveries?.length && r.deliveries.every((d) => d.status !== 'pending') ? r : false;
  });
}
async function record(name, id, expected, extra = {}) {
  const run = await snapshot(id),
    ev = await events(id);
  const rows = sql(id);
  assert.equal(run.status, 'succeeded');
  assert.equal(ev.filter((e) => e.type === 'delivery.finished').length, run.deliveries.length);
  assert.deepEqual(
    ev.filter((e) => e.type.startsWith('delivery.')).map((e) => [e.seq, e.type]),
    rows.events.filter((e) => e.type.startsWith('delivery.')).map((e) => [e.seq, e.type]),
  );
  cases.push({
    name,
    id,
    expected,
    actual: run.deliveries,
    apiEvents: ev.filter((e) => e.type.startsWith('delivery.') || e.type.startsWith('return.')),
    sqlite: rows,
    pass: true,
    ...extra,
  });
  await save('native.json', {
    store: '%TEMP%\\' + basename(store),
    node: process.version,
    ports: [5810, 5811, 5819],
    cases,
  });
}
try {
  await new Promise((ok, no) => {
    receiver.once('error', no);
    receiver.listen(5811, '127.0.0.1', ok);
  });
  // CLI creates a real API key; keep its token only in memory, never in evidence.
  const keyed = spawnSync(
    process.execPath,
    ['apps/api/dist/main.js', '--create-api-key', 'independent-qa'],
    { cwd: root, env, encoding: 'utf8', windowsHide: true },
  );
  assert.equal(keyed.status, 0, clean(keyed.stderr));
  token = keyed.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => /^gg_/.test(l));
  assert.ok(token, 'CLI token format');
  await boot();
  const matrix = [
    ['five-success', '/five-success', 5, 'delivered'],
    ['always', '/always', 5, 'failed'],
    ...[408, 429, 500, 400, 401, 404].map((n) => [
      'http-' + n,
      '/status-' + n,
      [408, 429, 500].includes(n) ? 5 : 1,
      'failed',
    ]),
    ['redirect', '/redirect', 1, 'failed'],
    ['never', '/never', 5, 'failed'],
    ['slow-body', '/slow-body', 5, 'failed'],
    ['overflow', '/overflow', 5, 'failed'],
    ['small-body', '/small', 1, 'delivered'],
    ['exact-boundary', '/boundary', 1, 'delivered'],
    ['late', '/late', 2, 'delivered'],
    ['drop', '/drop', 2, 'delivered'],
    ['refused', 'http://127.0.0.1:5819/closed', 5, 'failed'],
    ['credentials', 'http://user:pass@127.0.0.1:5811/credentials', 1, 'failed'],
    ['scheme', 'ftp://127.0.0.1:5811/unsupported', 1, 'failed'],
  ];
  const started = [];
  for (const [name, path, n, status] of matrix) {
    const id = await start(name, [path.startsWith('/') ? receiverUrl + path : path]);
    started.push({ name, path, n, status, id });
  }
  const two = await start('two channels', [receiverUrl + '/channel-a', receiverUrl + '/channel-b']);
  for (const c of started) {
    const r = await finished(c.id),
      d = r.deliveries[0];
    assert.equal(d.attempts, c.n, c.name);
    assert.equal(d.status, c.status, c.name);
    const calls = records.filter((x) => x.path === c.path);
    if (c.path.startsWith('/')) assert.equal(calls.length, c.n, c.name);
    if (calls.length) {
      assert.equal(new Set(calls.map((x) => x.key)).size, 1);
      assert.match(calls[0].key, /^[0-9A-HJKMNP-TV-Z]{26}$/);
    }
    if (['five-success', 'always'].includes(c.name)) {
      const gaps = calls.slice(1).map((x, i) => x.ms - calls[i].ms);
      [2000, 5000, 10000, 20000].forEach((ms, i) =>
        assert.ok(gaps[i] >= ms - 100 && gaps[i] < ms + 2500, `${c.name} gap ${gaps[i]}`),
      );
    }
    if (['never', 'slow-body'].includes(c.name)) {
      assert.equal(d.lastError.code, 'timeout');
      assert.equal(d.acknowledgement, 'unknown');
      const ev = await events(c.id);
      const attempted = ev.filter((e) => e.type === 'delivery.attempted');
      const ended = ev.filter((e) =>
        ['delivery.attempt_finished', 'delivery.finished'].includes(e.type),
      );
      const deadlines = attempted.map((e, i) => Date.parse(ended[i].ts) - Date.parse(e.ts));
      deadlines.forEach((ms) => assert.ok(ms >= 9900 && ms < 12500, String(ms)));
      c.deadlineDurationsMs = deadlines;
    }
    if (c.name === 'overflow') {
      assert.equal(d.lastError.code, 'transport');
      assert.equal(d.acknowledgement, 'unknown');
    }
    if (['late', 'drop'].includes(c.name)) {
      assert.equal(d.effectMayHaveHappened, true);
      assert.equal(d.lastError.acknowledgement, 'unknown');
    }
    if (['credentials', 'scheme'].includes(c.name)) {
      assert.equal(d.lastError.code, 'invalid_destination');
      assert.equal(d.acknowledgement, 'not_sent');
    }
    if (c.name === 'refused') {
      assert.equal(d.lastError.code, 'connection_refused');
      assert.equal(d.acknowledgement, 'not_sent');
    }
    await record(c.name, c.id, `${c.n} attempts; ${c.status}`, {
      deadlineDurationsMs: c.deadlineDurationsMs,
      gapsMs: calls.slice(1).map((x, i) => x.ms - calls[i].ms),
    });
  }
  assert.equal(
    records.filter(
      (x) =>
        x.path === '/redirect-target' || x.path === '/credentials' || x.path === '/unsupported',
    ).length,
    0,
  );
  const twoRun = await finished(two);
  assert.equal(twoRun.deliveries.length, 2);
  assert.notEqual(twoRun.deliveries[0].id, twoRun.deliveries[1].id);
  assert.equal(
    new Set(records.filter((r) => ['/channel-a', '/channel-b'].includes(r.path)).map((r) => r.key))
      .size,
    2,
  );
  await record('two-channels', two, 'Distinct ULIDs');
  console.log('MATRIX PASS', matrix.length + 1);
  // An awaited child completes execution before its failing return delivery completes.
  const childLoop = await publish(
    'QA awaited child',
    [
      trigger,
      { id: 'ask', kind: 'wait', label: 'Ask', config: { mode: 'input', prompt: 'finish' } },
      exit([{ kind: 'webhook', url: receiverUrl + '/parent-fail' }]),
    ],
    [
      { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'ask' } },
      { id: 'b', from: { node: 'ask', port: 'out' }, to: { node: 'done' } },
    ],
  );
  const parentLoop = await publish(
    'QA parent',
    [
      trigger,
      { id: 'sub', kind: 'subloop', label: 'Child', config: { loopRef: { loopId: childLoop } } },
      exit([]),
    ],
    [
      { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'sub' } },
      { id: 'b', from: { node: 'sub', port: 'out' }, to: { node: 'done' } },
    ],
  );
  const parentId = (await request('/loops/' + parentLoop + '/runs', {})).run.id;
  const childRun = await until(async () => {
    const p = await snapshot(parentId);
    if (p.waiting?.kind !== 'child') return false;
    const c = await snapshot(p.waiting.childRunId);
    return c.waiting?.kind === 'input' ? c : false;
  });
  await request('/runs/' + childRun.id + '/input', {
    waitId: childRun.waiting.waitId,
    input: 'finish',
  });
  await until(async () => (await snapshot(parentId)).status === 'succeeded');
  const pendingChild = await snapshot(childRun.id),
    pendingRows = sql(childRun.id);
  assert.equal(pendingChild.deliveries[0].status, 'pending');
  assert.equal(pendingRows.run.finalized_at, null);
  await finished(childRun.id);
  await until(() => sql(childRun.id).run.finalized_at);
  const parentEvents = await events(parentId);
  assert.equal(parentEvents.filter((e) => e.type === 'child_run.finished').length, 1);
  await record(
    'parent-child',
    childRun.id,
    'Parent continues while delivery pending; child finalized after final failure',
    { parentId, parentEvents, pendingChild, pendingRows },
  );
  // Crash after failure two is durable, before attempt three.
  const crashId = await start('crash after two', [receiverUrl + '/restart']);
  const before = await until(async () => {
    const r = await snapshot(crashId);
    return r.deliveries?.[0]?.attempts === 2 && !r.deliveries[0].inFlight ? r : false;
  });
  const beforeRows = sql(crashId);
  await kill();
  await boot();
  await finished(crashId);
  const after = await snapshot(crashId);
  assert.equal(after.deliveries[0].attempts, 5);
  assert.equal(after.deliveries[0].id, before.deliveries[0].id);
  assert.equal(records.filter((r) => r.path === '/restart').length, 5);
  await record('crash-between-two-three', crashId, 'Exactly five total attempts across restart', {
    before,
    beforeRows,
  });
  const stable = sql(two);
  const oldCount = records.length;
  await kill();
  await boot();
  await delay(2300);
  assert.equal(records.length, oldCount);
  assert.deepEqual(sql(two), stable);
  await record('delivered-not-resent', two, 'No resend or event changes after hard kill/restart');
  for (const phase of ['backoff', 'attempt']) {
    await kill();
    await boot(true);
    const path = '/stop-' + phase;
    const id = await start('stop ' + phase, [receiverUrl + path]);
    const pending = await until(async () => {
      const r = await snapshot(id),
        d = r.deliveries?.[0];
      return d?.attempts === 1 &&
        d.inFlight === (phase === 'attempt') &&
        records.some((x) => x.path === path)
        ? r
        : false;
    });
    const elapsedMs = await stop(path);
    assert.ok(elapsedMs < (phase === 'attempt' ? 12000 : 3000), String(elapsedMs));
    if (phase === 'attempt') assert.ok(elapsedMs > 9000, String(elapsedMs));
    for (const r of held) r.destroy();
    await boot(); // slow endpoint now still holds: release second request explicitly.
    if (phase === 'attempt')
      await until(() => {
        if (records.filter((x) => x.path === path).length < 2) return false;
        for (const res of held) if (!res.headersSent) res.writeHead(200).end('ack after restart');
        return true;
      });
    const resumed = await finished(id);
    assert.equal(resumed.deliveries[0].attempts, 2);
    assert.equal(resumed.deliveries[0].id, pending.deliveries[0].id);
    assert.equal(resumed.deliveries[0].status, 'delivered');
    await record('orderly-' + phase, id, 'No new attempt on stop; next boot uses attempt two', {
      pending,
      elapsedMs,
      requestsDuringStop: 0,
    });
  }
  console.log('NATIVE PASS', cases.length);
} catch (error) {
  await save('native-error.json', { message: String(error), stack: clean(error.stack ?? '') });
  console.error(clean(String(error)));
  process.exitCode = 1;
} finally {
  await kill();
  for (const t of timers) clearTimeout(t);
  receiver.closeAllConnections();
  await new Promise((ok) => receiver.close(ok));
  await save('receiver.json', records);
  await save('api-log.json', logs);
  await save('process-lifecycle.json', lifecycle);
  assert.equal(dirname(store), resolve(tmpdir()));
  assert.ok(basename(store).startsWith('gg-qa-246-'));
  await rm(store, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await save('native-cleanup.json', { store: '%TEMP%\\' + basename(store), removed: true });
}
