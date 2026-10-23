import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
const root = process.cwd(),
  out = resolve(process.env.WP_D2_EVIDENCE),
  fixture = JSON.parse(
    await readFile(
      join(process.env.TEMP, 'gg-audit-d2-20261022/upgrade/retained-fixture.json'),
      'utf8',
    ),
  );
const store = resolve(process.env.TEMP, 'gg-wp-d2-round5-migration-shapes-' + Date.now());
await cp(join(fixture.root, 'original'), store, { recursive: true });
let db = new DatabaseSync(join(store, 'graphgoblin.db'));
const version = db
  .prepare('SELECT definition FROM loop_versions WHERE loop_id=? ORDER BY version DESC LIMIT 1')
  .get(fixture.childLoopId);
const channel = JSON.parse(version.definition)
  .nodes.find((n) => n.kind === 'exit')
  .config.destinations.find((c) => c.kind === 'webhook');
const seq =
  Number(db.prepare('SELECT MAX(seq) AS n FROM run_events WHERE run_id=?').get(fixture.childId).n) +
  1;
const payload = JSON.stringify({
  channel,
  target: 17,
  unexpectedEvidence: 'keep-this-damaged-record',
});
db.prepare('INSERT INTO run_events(run_id,seq,ts,type,node_id,payload) VALUES(?,?,?,?,?,?)').run(
  fixture.childId,
  seq,
  new Date().toISOString(),
  'return.delivered',
  null,
  payload,
);
db.prepare('UPDATE runs SET last_event_seq=? WHERE id=?').run(seq, fixture.childId);
const before = db
  .prepare('SELECT * FROM run_events WHERE run_id=? AND seq=?')
  .get(fixture.childId, seq);
db.close();
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
  GG_PORT: '5644',
  GG_HOST: '127.0.0.1',
  GG_REQUIRE_API_KEY: 'false',
  GG_WEB_DIST: '',
  GG_MASTER_KEY: Buffer.alloc(32, 17).toString('base64'),
  GG_SWAGGER_UI: 'false',
});
const child = spawn(process.execPath, ['apps/api/dist/main.js'], {
  cwd: root,
  env,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', (b) => (log += b));
child.stderr.on('data', (b) => (log += b));
try {
  let up = false;
  for (let i = 0; i < 1200; i++) {
    assert.equal(child.exitCode, null, log);
    try {
      up = (await fetch('http://127.0.0.1:5644/healthz', { signal: AbortSignal.timeout(1000) })).ok;
    } catch {}
    if (up) break;
    await delay(100);
  }
  assert.ok(up);
  const response = await fetch('http://127.0.0.1:5644/runs/' + fixture.childId + '/events');
  const events = await response.json();
  await delay(200);
  db = new DatabaseSync(join(store, 'graphgoblin.db'), { readOnly: true });
  const after = db
    .prepare('SELECT * FROM run_events WHERE run_id=? AND seq=?')
    .get(fixture.childId, seq);
  const run = db.prepare('SELECT status,finalized_at FROM runs WHERE id=?').get(fixture.childId);
  db.close();
  const result = {
    before,
    after,
    eventHttpStatus: response.status,
    run,
    events,
    changed: JSON.stringify(before) !== JSON.stringify(after),
    log,
  };
  await writeFile(join(out, 'migration-shapes.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ before, after, eventHttpStatus: response.status, run }));
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    const done = once(child, 'exit');
    child.kill('SIGKILL');
    await done;
  }
}
