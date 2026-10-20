// Build first. Controlled receiver and disposable real API; no provider turns.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { setTimeout } from 'node:timers';
import process from 'node:process';
import console from 'node:console';
import { Buffer } from 'node:buffer';
const { fetch, AbortSignal } = globalThis;
const baseline = process.argv.includes('--baseline');
const dataDir = await mkdtemp(join(tmpdir(), 'gg-wp-d2-'));
const base = 'http://127.0.0.1:5800';
const received = [];
let child;
let output = '';
let hold = false;
const receiver = createServer(async (req, res) => {
  let body = '';
  for await (const bytes of req) body += bytes;
  received.push({ path: req.url, headers: req.headers, body });
  if (hold) return;
  const count = received.filter((call) => call.path === req.url).length;
  if (req.url === '/late' && count === 1) {
    const timer = setTimeout(() => res.writeHead(200).end('late ack'), 15_000);
    timer.unref();
    return;
  }
  if (req.url === '/drop' && count === 1) {
    res.writeHead(200, { 'content-length': '100' });
    res.write('partial');
    setTimeout(() => res.destroy(), 5);
    return;
  }
  res
    .writeHead(
      req.url === '/fail' || (req.url === '/retry' && count === 1)
        ? 503
        : req.url === '/permanent'
          ? 400
          : 200,
    )
    .end('ack');
});
await new Promise((ok, no) => {
  receiver.once('error', no);
  receiver.listen(5801, '127.0.0.1', ok);
});
async function until(check, timeout = 90_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = await check();
    if (result) return result;
    await delay(50);
  }
  throw Error('Acceptance timed out\n' + output);
}
async function boot() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GG_')) delete env[key];
  output = '';
  child = spawn(process.execPath, ['apps/api/dist/main.js'], {
    windowsHide: true,
    env: {
      ...env,
      GG_DATA_DIR: dataDir,
      GG_HOST: '127.0.0.1',
      GG_PORT: '5800',
      GG_WEB_DIST: '',
      GG_REQUIRE_API_KEY: 'false',
      GG_SWAGGER_UI: 'false',
      GG_MASTER_KEY: Buffer.alloc(32, 7).toString('base64'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (b) => {
    output = (output + b).slice(-12000);
  });
  child.stderr.on('data', (b) => {
    output = (output + b).slice(-12000);
  });
  child.on('error', (error) => {
    output += String(error);
  });
  await until(async () => {
    assert.equal(child.exitCode, null, output);
    return fetch(base + '/healthz', { signal: AbortSignal.timeout(2000) }).then(
      (r) => r.ok,
      () => false,
    );
  }, 120_000);
}
async function kill() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
}
async function request(path, body) {
  const response = await fetch(
    base + path,
    body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  const json = await response.json();
  assert.ok(response.ok, JSON.stringify(json));
  return json;
}
async function start(name, path) {
  const { loop } = await request('/loops', {
    definition: {
      schemaVersion: 4,
      name,
      nodes: [
        { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
        {
          id: 'done',
          kind: 'exit',
          label: 'Done',
          config: {
            returns: 'invocation.payload',
            destinations: [{ kind: 'webhook', url: 'http://127.0.0.1:5801' + path }],
          },
        },
      ],
      edges: [{ id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'done' } }],
    },
  });
  await request('/loops/' + loop.id + '/publish', {});
  return (await request('/loops/' + loop.id + '/runs', { input: { value: 42 } })).run.id;
}
const observations = { baseline, dataDir, receiverPort: 5801, apiPort: 5800 };
try {
  await boot();
  const failedId = await start('Delivery failure evidence', '/fail');
  await until(async () =>
    (await request('/runs/' + failedId + '/events')).items.some(
      (e) => e.type === (baseline ? 'return.failed' : 'delivery.finished'),
    ),
  );
  await delay(1500);
  observations.failure = {
    run: await request('/runs/' + failedId),
    requests: received.filter((r) => r.path === '/fail'),
    events: (await request('/runs/' + failedId + '/events')).items,
  };
  hold = true;
  const crashId = await start('Delivery crash evidence', '/crash');
  await until(() => received.some((r) => r.path === '/crash'));
  observations.beforeKill = {
    run: await request('/runs/' + crashId),
    events: (await request('/runs/' + crashId + '/events')).items,
  };
  await kill();
  hold = false;
  await boot();
  await until(async () =>
    (await request('/runs/' + crashId + '/events')).items.some(
      (e) => e.type === (baseline ? 'return.delivered' : 'delivery.finished'),
    ),
  );
  observations.afterRestart = {
    run: await request('/runs/' + crashId),
    requests: received.filter((r) => r.path === '/crash'),
    events: (await request('/runs/' + crashId + '/events')).items,
  };
  assert.equal(observations.failure.run.status, 'succeeded');
  assert.equal(observations.afterRestart.run.status, 'succeeded');
  if (!baseline) {
    assert.equal(observations.failure.requests.length, 5);
    assert.equal(
      new Set(observations.failure.requests.map((r) => r.headers['idempotency-key'])).size,
      1,
    );
    assert.ok(observations.failure.requests[0].headers['idempotency-key']);
    assert.equal(observations.failure.run.deliveries[0].status, 'failed');
    assert.equal(observations.failure.run.deliveries[0].lastError.httpStatus, 503);
    const crash = observations.afterRestart;
    assert.equal(crash.requests.length, 2);
    assert.equal(new Set(crash.requests.map((r) => r.headers['idempotency-key'])).size, 1);
    assert.equal(crash.run.deliveries[0].attempts, 2);
    assert.equal(crash.run.deliveries[0].status, 'delivered');
    assert.equal(crash.run.deliveries[0].lastError.code, 'interrupted');
    assert.equal(crash.events.filter((e) => e.type === 'delivery.attempted').length, 2);
    assert.equal(crash.events.filter((e) => e.type === 'delivery.finished').length, 1);
    observations.matrix = [];
    const ids = [];
    for (const path of ['/success', '/retry', '/permanent', '/late', '/drop'])
      ids.push([path, await start('Matrix ' + path, path)]);
    for (const [path, id] of ids) {
      const run = await until(async () => {
        const snapshot = await request('/runs/' + id);
        return snapshot.deliveries?.[0]?.status !== 'pending' && snapshot.deliveries?.length
          ? snapshot
          : false;
      });
      const events = (await request('/runs/' + id + '/events')).items;
      const requests = received.filter((r) => r.path === path);
      assert.equal(run.status, 'succeeded');
      assert.equal(run.deliveries[0].status, path === '/permanent' ? 'failed' : 'delivered');
      assert.equal(requests.length, ['/retry', '/late', '/drop'].includes(path) ? 2 : 1);
      assert.equal(new Set(requests.map((r) => r.headers['idempotency-key'])).size, 1);
      if (path === '/late' || path === '/drop') {
        assert.equal(run.deliveries[0].lastError.acknowledgement, 'unknown');
        assert.equal(run.deliveries[0].effectMayHaveHappened, true);
      }
      observations.matrix.push({ path, run, requests, events });
    }
    // Final outcomes survive a second real kill/restart without another request.
    const requestCount = received.length;
    await kill();
    await boot();
    await delay(1000);
    assert.equal(received.length, requestCount);
    assert.equal((await request('/runs/' + failedId)).deliveries[0].status, 'failed');
  }
  const file = join(dataDir, baseline ? 'before.json' : 'after.json');
  await writeFile(file, JSON.stringify(observations, null, 2));
  console.log(
    JSON.stringify({
      evidence: file,
      failureRequests: observations.failure.requests.length,
      crashRequests: observations.afterRestart.requests.length,
    }),
  );
} finally {
  await kill();
  receiver.closeAllConnections();
  await new Promise((ok) => receiver.close(ok));
}
