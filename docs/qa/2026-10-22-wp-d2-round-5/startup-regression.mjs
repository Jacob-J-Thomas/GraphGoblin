// Replay with the auditor's synthetic pre-0015 store; no owner data is used.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
const evidence = process.env.WP_D2_EVIDENCE;
const fixture = JSON.parse(
  await readFile(
    join(process.env.TEMP, 'gg-audit-d2-20261022/upgrade/retained-fixture.json'),
    'utf8',
  ),
);
const store = await mkdtemp(join(process.env.TEMP, 'gg-wp-d2-round5-startup-'));
await cp(join(fixture.root, 'original'), store, { recursive: true });
const damagedId = '01M5J6BJS4S6E8ASS6KYDKV25Z';
let db = new DatabaseSync(join(store, 'graphgoblin.db'));
const healthy = db.prepare('SELECT * FROM runs WHERE id=?').get(fixture.childId);
const thread = JSON.parse(healthy.initial_thread);
thread.run.id = damagedId;
thread.invocation.returnDefaults = ['corrupt'];
const damaged = {
  ...healthy,
  id: damagedId,
  parent_run_id: null,
  initial_thread: JSON.stringify(thread),
};
const keys = Object.keys(damaged);
db.prepare(`INSERT INTO runs (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(
  ...Object.values(damaged),
);
db.prepare(
  'INSERT INTO run_events SELECT ?,seq,ts,type,node_id,payload FROM run_events WHERE run_id=?',
).run(damagedId, fixture.childId);
const originalEvents = db
  .prepare('SELECT * FROM run_events WHERE run_id=? ORDER BY seq')
  .all(damagedId);
db.close();
const receiver = createServer((req, res) => {
  req.resume();
  res.writeHead(200).end('accepted');
});
let child,
  log = '';
try {
  await new Promise((ok, fail) => {
    receiver.once('error', fail);
    receiver.listen(5642, '127.0.0.1', ok);
  });
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
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
      ].includes(key.toUpperCase()),
    ),
  );
  Object.assign(env, {
    GG_DATA_DIR: store,
    GG_PORT: '5644',
    GG_HOST: '127.0.0.1',
    GG_REQUIRE_API_KEY: 'false',
    GG_WEB_DIST: '',
    GG_MASTER_KEY: Buffer.alloc(32, 17).toString('base64'),
    GG_SWAGGER_UI: 'false',
  });
  child = spawn(process.execPath, ['apps/api/dist/main.js'], {
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (bytes) => (log += bytes));
  child.stderr.on('data', (bytes) => (log += bytes));
  const deadline = Date.now() + 60000;
  let ready = false,
    finalized = false;
  while (Date.now() < deadline) {
    assert.equal(
      child.exitCode,
      null,
      'API must start with healthy and damaged pending runs: ' + log,
    );
    try {
      ready = (await fetch('http://127.0.0.1:5644/healthz', { signal: AbortSignal.timeout(1000) }))
        .ok;
    } catch {}
    if (ready) {
      const response = await fetch('http://127.0.0.1:5644/runs/' + fixture.childId);
      assert.equal(response.status, 200);
      const run = await response.json();
      if (run.deliveries?.[0]?.status === 'delivered' && log.includes('HISTORY_UNREADABLE')) {
        db = new DatabaseSync(join(store, 'graphgoblin.db'), { readOnly: true });
        finalized =
          db.prepare('SELECT finalized_at FROM runs WHERE id=?').get(fixture.childId)
            .finalized_at !== null;
        assert.equal(
          db.prepare('SELECT initial_thread FROM runs WHERE id=?').get(damagedId).initial_thread,
          damaged.initial_thread,
        );
        assert.deepEqual(
          db.prepare('SELECT * FROM run_events WHERE run_id=? ORDER BY seq').all(damagedId),
          originalEvents,
        );
        db.close();
        if (finalized) break;
      }
    }
    await delay(50);
  }
  assert.ok(
    ready && finalized,
    'Healthy pending run must finalize while damaged history stays isolated: ' + log,
  );
  console.log(
    'PASS: API started, healthy return delivered/finalized, damaged run HISTORY_UNREADABLE and byte-identical.',
  );
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
  }
  receiver.closeAllConnections();
  await new Promise((ok) => receiver.close(ok));
  await writeFile(
    join(evidence, 'startup-' + (process.env.WP_D2_PHASE ?? 'before') + '.json'),
    JSON.stringify({ store, log }, null, 2),
  );
}
