import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
const root = process.cwd(),
  out = process.env.GG_AUDIT_D2_OUT ?? join(process.env.TEMP, 'gg-audit-d2-round2-20261022');
await mkdir(out, { recursive: true });
const fixture = JSON.parse(
  await readFile(
    join(process.env.TEMP, 'gg-audit-d2-20261022/upgrade/retained-fixture.json'),
    'utf8',
  ),
);
const { RunEventSchema: oldSchema } = await import(
  pathToFileURL(join(process.env.GG_WP_D2_BASE_ROOT, 'packages/contracts/dist/events.js')).href
);
const { RunEventSchema: newSchema } = await import(
  pathToFileURL(join(root, 'packages/contracts/dist/events.js')).href
);
const store = await mkdtemp(join(out, 'gg-audit-d2-boundaries-store-'));
await cp(join(fixture.root, 'original'), store, { recursive: true });
let db = new DatabaseSync(join(store, 'graphgoblin.db'));
const ts = new Date().toISOString();
db.prepare('UPDATE runs SET finalized_at=?').run(ts);
const seed = db.prepare('SELECT * FROM runs WHERE id=?').get(fixture.childId);
const channel = { kind: 'webhook', url: 'https://example.test/hook' };
const cases = [];
function delivered(name, target, secretRef, url = channel.url) {
  cases.push({
    name,
    type: 'return.delivered',
    payload: {
      channel: { ...channel, url, ...(secretRef === undefined ? {} : { secretRef }) },
      ...(target === undefined ? {} : { target }),
    },
  });
}
function failed(name, error, secretRef) {
  cases.push({
    name,
    type: 'return.failed',
    payload: { channel: { ...channel, ...(secretRef === undefined ? {} : { secretRef }) }, error },
  });
}
delivered('valid omitted optional fields');
delivered('valid empty optional fields', '', '');
delivered('valid ASCII maxima', 't'.repeat(4096), 's'.repeat(128));
delivered('valid astral maxima', '😀'.repeat(2048), '😀'.repeat(64));
delivered('valid embedded NUL below limits', 'a\0b', 'x\0y');
failed('valid ASCII failure maximum', 'e'.repeat(4000));
failed('valid astral failure maximum', '😀'.repeat(2000));
failed('valid empty failure', '');
delivered('invalid ASCII target over bound', 't'.repeat(4097));
delivered('invalid ASCII secret over bound', undefined, 's'.repeat(129));
failed('invalid ASCII error over bound', 'e'.repeat(4001));
delivered('invalid astral target over UTF16 bound', '😀'.repeat(2049));
delivered('invalid astral secret over UTF16 bound', undefined, '😀'.repeat(65));
failed('invalid astral error over UTF16 bound', '😀'.repeat(2001));
delivered('invalid NUL target over bound', 'a\0' + 't'.repeat(4096));
delivered('invalid NUL secret over bound', undefined, 'a\0' + 's'.repeat(128));
failed('invalid NUL error over bound', 'a\0' + 'e'.repeat(4000));
delivered('invalid URL format', undefined, undefined, 'not-a-url');
delivered('invalid target number', 17);
cases.push({
  name: 'invalid extra evidence',
  type: 'return.delivered',
  payload: { channel, unexpectedEvidence: 'must-remain' },
});
for (const [i, c] of cases.entries()) {
  const id = '01M5J60000000000000000' + String(i).padStart(4, '0');
  assert.equal(id.length, 26);
  const thread = JSON.parse(seed.initial_thread);
  thread.run.id = id;
  const row = {
    ...seed,
    id,
    parent_run_id: null,
    initial_thread: JSON.stringify(thread),
    last_event_seq: 1,
  };
  const keys = Object.keys(row);
  db.prepare(`INSERT INTO runs (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(
    ...Object.values(row),
  );
  const payload = JSON.stringify(c.payload);
  db.prepare(
    'INSERT INTO run_events(run_id,seq,ts,type,node_id,payload) VALUES(?,1,?,?,NULL,?)',
  ).run(id, ts, c.type, payload);
  const old = oldSchema.safeParse({ runId: id, seq: 1, ts, type: c.type, ...c.payload });
  Object.assign(c, {
    id,
    oldValid: old.success,
    oldIssues: old.success ? [] : old.error.issues,
    before: db.prepare('SELECT * FROM run_events WHERE run_id=?').get(id),
  });
}
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
  let ready = false;
  const end = Date.now() + 60000;
  while (Date.now() < end) {
    assert.equal(child.exitCode, null, log);
    try {
      ready = (await fetch('http://127.0.0.1:5644/healthz', { signal: AbortSignal.timeout(1000) }))
        .ok;
    } catch {}
    if (ready) break;
    await delay(50);
  }
  assert.ok(ready, log);
  db = new DatabaseSync(join(store, 'graphgoblin.db'), { readOnly: true });
  for (const c of cases) {
    const after = db.prepare('SELECT * FROM run_events WHERE run_id=? AND seq=1').get(c.id);
    const parsed = newSchema.safeParse({
      runId: c.id,
      seq: 1,
      ts: after.ts,
      type: after.type,
      ...JSON.parse(after.payload),
    });
    const response = await fetch('http://127.0.0.1:5644/runs/' + c.id + '/events');
    Object.assign(c, {
      after,
      changed: JSON.stringify(c.before) !== JSON.stringify(after),
      newValid: parsed.success,
      newIssues: parsed.success ? [] : parsed.error.issues,
      httpStatus: response.status,
      httpBody: await response.json(),
    });
  }
  db.close();
  const summary = cases.map((c) => ({
    name: c.name,
    oldValid: c.oldValid,
    converted: c.after.type === 'delivery.finished',
    changed: c.changed,
    newValid: c.newValid,
    httpStatus: c.httpStatus,
  }));
  await writeFile(
    join(out, 'migration-boundaries.json'),
    JSON.stringify({ store, summary, cases, log }, null, 2),
  );
  console.log(JSON.stringify(summary, null, 2));
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    const done = once(child, 'exit');
    child.kill('SIGKILL');
    await done;
  }
}
