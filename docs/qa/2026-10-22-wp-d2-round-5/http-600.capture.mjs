// Collect public/native evidence for the same response-outcomes.check regression as before.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
const store = await mkdtemp(join(process.env.TEMP, 'gg-wp-d2-round5-http600-'));
const base = 'http://127.0.0.1:5645';
const identities = [];
let child,
  log = '';
const receiver = createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    identities.push(req.headers['idempotency-key']);
    res.writeHead(600).end('nonstandard');
  });
});
async function until(check) {
  const end = Date.now() + 90000;
  while (Date.now() < end) {
    assert.equal(child.exitCode, null, log);
    const result = await check();
    if (result) return result;
    await delay(50);
  }
  throw Error('Timed out observing final HTTP 600 delivery: ' + log);
}
async function call(path, body) {
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
  assert.ok(response.ok, await response.clone().text());
  return response.json();
}
try {
  await new Promise((ok, fail) => {
    receiver.once('error', fail);
    receiver.listen(5646, '127.0.0.1', ok);
  });
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GG_')),
  );
  Object.assign(env, {
    GG_DATA_DIR: store,
    GG_PORT: '5645',
    GG_HOST: '127.0.0.1',
    GG_REQUIRE_API_KEY: 'false',
    GG_WEB_DIST: '',
    GG_SWAGGER_UI: 'false',
    GG_MASTER_KEY: Buffer.alloc(32, 7).toString('base64'),
  });
  child = spawn(process.execPath, ['apps/api/dist/main.js'], {
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (bytes) => (log += bytes));
  child.stderr.on('data', (bytes) => (log += bytes));
  await until(async () => {
    try {
      return (await fetch(base + '/healthz')).ok;
    } catch {
      return false;
    }
  });
  const { loop } = await call('/loops', {
    definition: {
      schemaVersion: 4,
      name: 'Invalid status bounded outcome',
      nodes: [
        { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
        {
          id: 'done',
          kind: 'exit',
          label: 'Done',
          config: {
            returns: '42',
            destinations: [{ kind: 'webhook', url: 'http://127.0.0.1:5646/600' }],
          },
        },
      ],
      edges: [{ id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'done' } }],
    },
  });
  await call('/loops/' + loop.id + '/publish', {});
  const { run: started } = await call('/loops/' + loop.id + '/runs', {});
  const run = await until(async () => {
    const run = await call('/runs/' + started.id);
    return run.deliveries?.[0]?.status === 'failed' ? run : false;
  });
  const events = await call('/runs/' + started.id + '/events');
  let finalized;
  await until(async () => {
    const db = new DatabaseSync(join(store, 'graphgoblin.db'), { readOnly: true });
    try {
      finalized =
        db.prepare('SELECT finalized_at FROM runs WHERE id=?').get(started.id).finalized_at !==
        null;
      return finalized;
    } finally {
      db.close();
    }
  });
  assert.equal(run.status, 'succeeded');
  assert.equal(new Set(identities).size, 1);
  assert.equal(identities[0], run.deliveries[0].id);
  assert.equal(events.items.filter((event) => event.type === 'delivery.finished').length, 1);
  const result = {
    name: 'HTTP 600',
    delivery: run.deliveries[0],
    requests: identities.length,
    finalized,
    run,
    events,
    identities,
    store,
  };
  await writeFile(
    join(process.env.WP_D2_EVIDENCE, 'http-600-final.json'),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
  }
  receiver.closeAllConnections();
  await new Promise((ok) => receiver.close(ok));
}
