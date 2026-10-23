import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const root = process.cwd(),
  out = resolve(process.env.WP_D2_EVIDENCE);
const store = resolve(process.env.TEMP, 'gg-wp-d2-round5-native-' + Date.now());
await mkdir(store, { recursive: true });
const { createClient } = createRequire(join(root, 'packages/infrastructure/package.json'))(
  '@libsql/client',
);
const { chromium } = createRequire(join(root, 'apps/web/package.json'))('@playwright/test');
const api = 'http://127.0.0.1:5640',
  receiverUrl = 'http://127.0.0.1:5641';
const env = Object.fromEntries(
  Object.entries(process.env).filter(([k]) =>
    [
      'PATH',
      'SYSTEMROOT',
      'WINDIR',
      'TEMP',
      'TMP',
      'APPDATA',
      'LOCALAPPDATA',
      'USERPROFILE',
      'COMSPEC',
      'PATHEXT',
    ].includes(k.toUpperCase()),
  ),
);
Object.assign(env, {
  GG_DATA_DIR: store,
  GG_HOST: '127.0.0.1',
  GG_PORT: '5640',
  GG_REQUIRE_API_KEY: 'false',
  GG_SWAGGER_UI: 'false',
  GG_MASTER_KEY: Buffer.alloc(32, 11).toString('base64'),
  GG_WEB_DIST: join(root, 'apps/web/dist'),
});
let child,
  generation = 0,
  browser;
const logs = [],
  requests = [],
  results = [],
  held = new Set(),
  modes = new Map();
const save = async (name, data) => writeFile(join(out, name), JSON.stringify(data, null, 2) + '\n');
const note = (name, data) => {
  results.push({ name, ...data });
  console.log(JSON.stringify({ name, ...data }));
};
async function sql(query, args = []) {
  const c = createClient({ url: 'file:' + join(store, 'graphgoblin.db').replaceAll('\\', '/') });
  try {
    return (await c.execute({ sql: query, args })).rows;
  } finally {
    c.close();
  }
}
async function until(fn, limit = 120000) {
  const end = Date.now() + limit;
  while (Date.now() < end) {
    const x = await fn();
    if (x) return x;
    await delay(50);
  }
  throw Error('Timed out observing state');
}
async function call(path, body, method) {
  const r = await fetch(api + path, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  const j = r.status === 204 ? null : await r.json();
  assert.ok(r.ok, JSON.stringify({ path, status: r.status, body: j }));
  return j;
}
async function boot() {
  generation++;
  const gen = generation;
  child = spawn(process.execPath, ['apps/api/scripts/webhook-retry.process.mjs'], {
    cwd: root,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let buf = '';
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (b) => {
      buf += b;
      logs.push({ generation: gen, text: String(b) });
    });
  await until(async () => {
    assert.equal(child.exitCode, null, buf);
    try {
      return (await fetch(api + '/healthz', { signal: AbortSignal.timeout(1000) })).ok;
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
async function stop() {
  const t = Date.now(),
    count = requests.length,
    done = once(child, 'exit');
  child.send('stop');
  const guard = setTimeout(() => child.kill('SIGKILL'), 15000);
  try {
    const [code, signal] = await done;
    assert.equal(code, 0);
    assert.equal(signal, null);
    return { elapsedMs: Date.now() - t, newRequests: requests.length - count };
  } finally {
    clearTimeout(guard);
  }
}
async function start(name, path, extras = []) {
  const channel =
    typeof path === 'string'
      ? { kind: 'webhook', url: path.startsWith('/') ? receiverUrl + path : path }
      : path;
  const { loop } = await call('/loops', {
    definition: {
      schemaVersion: 4,
      name,
      nodes: [
        { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
        {
          id: 'done',
          kind: 'exit',
          label: 'Done',
          config: { returns: 'invocation.payload', destinations: [channel, ...extras] },
        },
      ],
      edges: [{ id: 'edge', from: { node: 'start', port: 'out' }, to: { node: 'done' } }],
    },
  });
  await call('/loops/' + loop.id + '/publish', {});
  return {
    loopId: loop.id,
    runId: (await call('/loops/' + loop.id + '/runs', { input: { name, value: 42 } })).run.id,
    path: typeof path === 'string' ? path : channel.url,
  };
}
async function final(id) {
  return until(async () => {
    const r = await call('/runs/' + id);
    return r.deliveries?.length && r.deliveries.every((d) => d.status !== 'pending') ? r : false;
  });
}
async function snapshot(f) {
  const run = await call('/runs/' + f.runId),
    events = (await call('/runs/' + f.runId + '/events')).items;
  return {
    ...f,
    run,
    events,
    rows: await sql('SELECT finalized_at,last_event_seq,status FROM runs WHERE id=?', [f.runId]),
    requests: requests.filter((x) => x.body.runId === f.runId),
  };
}
const receiver = createServer(async (req, res) => {
  let text = '';
  for await (const chunk of req) text += chunk;
  const path = req.url,
    n = requests.filter((x) => x.path === path).length + 1;
  requests.push({
    path,
    n,
    ms: Date.now(),
    key: req.headers['idempotency-key'],
    signature: req.headers['x-graphgoblin-signature'],
    body: JSON.parse(text),
  });
  held.add(res);
  res.on('close', () => held.delete(res));
  const mode = modes.get(path);
  if (mode === 'hold' || path === '/never') return;
  if (path === '/slow' && n === 1) {
    res.writeHead(200, { 'content-length': '20' });
    res.write('partial');
    return;
  }
  if ((path === '/drop' || path === '/uncertainty') && n === 1) {
    res.writeHead(200, { 'content-length': '100' });
    res.write('part');
    setTimeout(() => res.destroy(), 10);
    return;
  }
  if (path === '/late' && n === 1) {
    setTimeout(() => res.writeHead(200).end('late'), 15000).unref();
    return;
  }
  if (path === '/overflow' && n === 1) {
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
  const status =
    mode === 'fail'
      ? 503
      : path === '/429'
        ? 429
        : path === '/503'
          ? 503
          : path === '/600'
            ? 600
            : path === '/400'
              ? 400
              : path === '/uncertainty' && n === 2
                ? 429
                : path === '/retry' && n < 3
                  ? 503
                  : 200;
  res.writeHead(status).end('ack');
});
try {
  await new Promise((ok, no) => {
    receiver.once('error', no);
    receiver.listen(5641, '127.0.0.1', ok);
  });
  await boot();
  // A real persisted secret whose bytes fail decryption exercises resolution failure without a fake port.
  await sql(
    "INSERT INTO secrets(owner_id,name,ciphertext,created_at,updated_at) VALUES('local','broken','eA==',?,?)",
    [new Date().toISOString(), new Date().toISOString()],
  );
  const fixtures = [];
  for (const path of [
    '/success',
    '/retry',
    '/429',
    '/503',
    '/400',
    '/redirect',
    '/drop',
    '/late',
    '/slow',
    '/overflow',
    '/boundary',
    '/uncertainty',
  ])
    fixtures.push(await start('Audit ' + path, path));
  fixtures.push(await start('Audit DNS', 'http://gg-audit-d2-nonexistent.invalid:5649/hook'));
  fixtures.push(
    await start('Audit resolver', {
      kind: 'webhook',
      url: receiverUrl + '/secret',
      secretRef: 'broken',
    }),
  );
  fixtures.push(await start('Audit refused', 'http://127.0.0.1:5649/refused'));
  fixtures.push(await start('Audit invalid', 'ftp://127.0.0.1/hook'));
  fixtures.push(await start('Audit credentials', 'http://user:pass@127.0.0.1:5641/credential'));
  fixtures.push(
    await start('Audit two channels', '/two-a', [{ kind: 'webhook', url: receiverUrl + '/two-b' }]),
  );
  const odd = await start('Audit nonstandard HTTP', '/600');
  for (const f of fixtures) {
    const r = await final(f.runId);
    assert.equal(r.status, 'succeeded');
    const s = await snapshot(f);
    for (const d of r.deliveries) {
      assert.ok(d.attempts <= 5);
      assert.equal(
        s.events.filter((e) => e.type === 'delivery.finished' && e.delivery.id === d.id).length,
        1,
      );
    }
    for (const [id, calls] of Object.entries(Object.groupBy(s.requests, (x) => x.key)))
      assert.equal(r.deliveries.find((x) => x.id === id)?.attempts, calls.length);
    await save('case-' + f.runId + '.json', s);
    note(f.path, {
      status: r.status,
      deliveries: r.deliveries,
      requestCount: s.requests.length,
      finalized: s.rows[0].finalized_at !== null,
    });
  }
  assert.equal(requests.filter((r) => r.path === '/redirect-target').length, 0);
  assert.equal(requests.filter((r) => r.path === '/secret').length, 0);
  const os = await snapshot(odd);
  await save('nonstandard-http.json', os);
  note('HTTP 600', {
    runId: odd.runId,
    delivery: os.run.deliveries[0],
    requests: os.requests.length,
    finalized: os.rows[0].finalized_at !== null,
    errors: logs.filter((x) => x.text.includes('journal persistence failed')),
  });
  const u = fixtures.find((f) => f.path === '/uncertainty');
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(api + '/app/runs/' + u.runId);
  await page.getByText('Delivered after 3 attempts').waitFor();
  const ui = await page.locator('body').innerText();
  await page.screenshot({ path: join(out, 'uncertainty-inspector.png'), fullPage: true });
  note('uncertainty inspector', {
    runId: u.runId,
    warningVisible: ui.includes('An acknowledgement was unknown'),
    text: ui,
  });
  // Observe pending -> delivered polling without a page reload.
  modes.set('/live-ui', 'hold');
  const live = await start('Audit live inspector', '/live-ui');
  await until(() => requests.some((x) => x.path === '/live-ui'));
  await page.goto(api + '/app/runs/' + live.runId);
  await page.getByText(/Pending \(1\/5 attempts\)/).waitFor();
  modes.delete('/live-ui');
  for (const res of held) if (!res.writableEnded) res.writeHead(200).end('released');
  await page.getByText('Delivered after 1 attempt', { exact: true }).waitFor();
  note('pending to delivered UI', { passed: true });
  await browser.close();
  browser = undefined;
  // Disable only the malformed-status worker via the normal loop deletion interface before lifecycle cases.
  await call('/loops/' + odd.loopId, undefined, 'DELETE');
  modes.set('/backoff', 'fail');
  const back = await start('Audit backoff crash', '/backoff');
  await until(async () => {
    const r = await call('/runs/' + back.runId);
    return r.deliveries?.[0]?.attempts === 2 && !r.deliveries[0].inFlight;
  });
  const before = await snapshot(back);
  await kill();
  await boot();
  await final(back.runId);
  const after = await snapshot(back);
  assert.equal(after.requests.length, 5);
  assert.equal(after.run.deliveries[0].id, before.run.deliveries[0].id);
  note('crash in retry window', {
    requests: after.requests.length,
    attempts: after.run.deliveries[0].attempts,
    sameIdentity: true,
    finishedEvents: after.events.filter((e) => e.type === 'delivery.finished').length,
  });
  await save('crash-backoff.json', { before, after });
  modes.set('/crash-flight', 'hold');
  const crash = await start('Audit crash flight', '/crash-flight');
  await until(() => requests.some((x) => x.path === '/crash-flight'));
  const cb = await snapshot(crash);
  await kill();
  modes.delete('/crash-flight');
  await boot();
  await final(crash.runId);
  const ca = await snapshot(crash);
  assert.equal(ca.requests.length, 2);
  assert.equal(ca.run.deliveries[0].lastError.code, 'interrupted');
  assert.equal(ca.run.deliveries[0].id, cb.run.deliveries[0].id);
  note('crash in flight', {
    requests: 2,
    attempts: ca.run.deliveries[0].attempts,
    sameIdentity: true,
  });
  await save('crash-flight.json', { before: cb, after: ca });
  for (const phase of ['backoff', 'attempt']) {
    const path = '/drain-' + phase;
    modes.set(path, phase === 'attempt' ? 'hold' : 'fail');
    const f = await start('Audit drain ' + phase, path);
    await until(async () => {
      const r = await call('/runs/' + f.runId);
      return (
        r.deliveries?.[0]?.attempts === 1 &&
        r.deliveries[0].inFlight === (phase === 'attempt') &&
        requests.some((x) => x.path === path)
      );
    });
    const prior = await snapshot(f);
    const timing = await stop();
    assert.equal(timing.newRequests, 0);
    const saved = await sql(
      "SELECT payload FROM run_events WHERE run_id=? AND type LIKE 'delivery.%' ORDER BY seq DESC LIMIT 1",
      [f.runId],
    );
    modes.delete(path);
    await boot();
    await final(f.runId);
    const done = await snapshot(f);
    assert.equal(done.requests.length, 2);
    assert.equal(done.run.deliveries[0].id, prior.run.deliveries[0].id);
    note('orderly ' + phase, {
      ...timing,
      afterStop: JSON.parse(saved[0].payload),
      afterRestart: done.run.deliveries[0],
    });
    await save('drain-' + phase + '.json', { prior, timing, saved, done });
  }
  // Exhaust the forced-interruption budget with five real starts and five acknowledged receiver arrivals.
  modes.set('/crash-five', 'hold');
  const five = await start('Audit repeated crash', '/crash-five');
  for (let n = 1; n <= 5; n++) {
    await until(() => requests.filter((r) => r.path === '/crash-five').length === n);
    await kill();
    await boot();
  }
  await final(five.runId);
  const fs = await snapshot(five);
  assert.equal(fs.requests.length, 5);
  assert.equal(fs.run.deliveries[0].status, 'failed');
  assert.equal(fs.run.deliveries[0].attempts, 5);
  note('fifth interrupted attempt', { requests: 5, delivery: fs.run.deliveries[0] });
  await save('crash-five.json', fs);
  const count = requests.length;
  const beforeRows = await sql('SELECT * FROM run_events ORDER BY run_id,seq');
  await kill();
  await boot();
  await delay(2500);
  assert.equal(requests.length, count);
  assert.deepEqual(await sql('SELECT * FROM run_events ORDER BY run_id,seq'), beforeRows);
  note('final outcomes on second startup', { newRequests: 0, eventsUnchanged: true });
  // Real deletion during backoff must not leave an orphan after its old deadline passes.
  modes.set('/delete', 'fail');
  const del = await start('Audit delete backoff', '/delete');
  await until(async () => {
    const r = await call('/runs/' + del.runId);
    return r.deliveries?.[0]?.attempts === 1 && !r.deliveries[0].inFlight;
  });
  await call('/loops/' + del.loopId, undefined, 'DELETE');
  await delay(2300);
  assert.equal(requests.filter((r) => r.path === '/delete').length, 1);
  assert.equal((await sql('SELECT * FROM run_events WHERE run_id=?', [del.runId])).length, 0);
  note('loop deletion', { newRequests: 0, orphanEvents: 0 });
} catch (error) {
  note('DRIVER FAILURE', { error: String(error), stack: error.stack });
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await kill();
  receiver.closeAllConnections();
  await new Promise((ok) => receiver.close(ok));
  await save('native-results.json', results);
  await save('receiver.json', requests);
  await save('api-log.json', logs);
  console.log('Saved ' + out);
}
