import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { CURRENT_DEFINITION_FORMAT } = await import(pathToFileURL(resolve('packages/contracts/dist/index.js')).href);
const { openDatabase } = await import(pathToFileURL(resolve('packages/infrastructure/dist/sqlite/index.js')).href);
const dataDir = await mkdtemp(join(tmpdir(), 'gg-audit-422-native-'));
const database = join(dataDir, 'graphgoblin.db');
const marker = join(dataDir, 'marker.txt');
const effect = join(dataDir, 'effect.mjs');
const origin = 'http://127.0.0.1:6652';
const children = [];
await writeFile(effect, "import {appendFileSync} from 'node:fs'; appendFileSync(process.argv[2], 'effect\\n'); console.log('null'); process.exit(Number(process.argv[3]));\n", 'utf8');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GG_') && key !== 'JEV_API_KEY'));
Object.assign(env, {
  GG_DATA_DIR: dataDir, GG_DB_URL: pathToFileURL(database).href,
  GG_HOST: '127.0.0.1', GG_PORT: '6652', GG_REQUIRE_API_KEY: 'false', GG_SWAGGER_UI: 'false',
  GG_MASTER_KEY: Buffer.alloc(32, 9).toString('base64'), GG_JEV_API_KEY: '',
  GG_WEB_DIST: resolve('apps/web/dist'),
});
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check) {
  const deadline = Date.now() + 30000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('Native probe state deadline exceeded');
    await pause(20);
  }
}
async function call(method, path, body) {
  const response = await fetch(origin + path, {
    method, headers: { 'content-type': 'application/json' },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
  });
  return { status: response.status, body: await response.json() };
}
async function boot() {
  const child = spawn(process.execPath, [resolve('apps/api/dist/main.js')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let log = '';
  child.stdout.on('data', (chunk) => { log += chunk; });
  child.stderr.on('data', (chunk) => { log += chunk; });
  await until(async () => {
    if (child.exitCode !== null) throw new Error(`API exited ${child.exitCode}: ${log}`);
    return fetch(origin + '/healthz').then((r) => r.ok, () => false);
  });
  console.log(JSON.stringify({ scenario: 'native boot', pid: child.pid }));
  return child;
}
async function stop(child) {
  if (child.exitCode !== null) return;
  const exit = once(child, 'exit');
  await call('POST', '/system/shutdown', { action: 'drain' });
  await Promise.race([exit, pause(15000).then(() => { if (child.exitCode === null) throw new Error('Native drain did not exit'); })]);
  console.log(JSON.stringify({ scenario: 'native orderly exit', pid: child.pid, exit: child.exitCode }));
}
async function publish(name, exitCode) {
  const definition = {
    schemaVersion: CURRENT_DEFINITION_FORMAT, name,
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      { id: 'effect', kind: 'script', label: 'Effect', config: { command: process.execPath, args: [effect, marker, String(exitCode)] } },
      { id: 'done', kind: 'exit', label: 'Done', config: {} },
    ],
    edges: [
      { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'effect' } },
      { id: 'b', from: { node: 'effect', port: 'out' }, to: { node: 'done' } },
    ],
  };
  const created = await call('POST', '/loops', { definition });
  assert.equal(created.status, 201, JSON.stringify(created));
  const id = created.body.loop.id;
  const published = await call('POST', `/loops/${id}/publish`);
  assert.equal(published.status, 200, JSON.stringify(published));
  return id;
}
const get = async (id) => (await call('GET', `/runs/${id}`)).body;
async function terminal(id) {
  await until(async () => (await get(id)).finalizedAt !== undefined);
  return get(id);
}
const count = async () => (await readFile(marker, 'utf8')).trim().split('\n').length;
let active;
let db;
try {
  active = await boot();
  const loopId = await publish('audit known failure', 7);
  const started = await call('POST', `/loops/${loopId}/runs`, {});
  assert.equal(started.status, 202);
  const source = await terminal(started.body.run.id);
  assert.equal(source.failure.code, 'SCRIPT_EXIT_CODE');
  assert.equal(source.recovery.resume.allowed, true);
  const resumes = await Promise.all(Array.from({ length: 12 }, () => call('POST', `/runs/${source.id}/resume`, { observedSeq: source.recovery.observedSeq })));
  const again = await terminal(source.id);
  assert.equal(resumes.filter((r) => r.status === 200).length, 1);
  assert.equal(resumes.filter((r) => r.status === 409).length, 11);
  assert.equal(await count(), 2);
  assert.equal((await call('POST', `/runs/${source.id}/resume`, { observedSeq: source.recovery.observedSeq })).body.code, 'RECOVERY_STALE');
  console.log(JSON.stringify({ scenario: 'native parallel Resume then repeated failure', statuses: resumes.map((r) => r.status), markerCount: await count(), sameRun: again.id === source.id }));
  const history = (await call('GET', `/runs/${source.id}/events?limit=500`)).body;
  const replayIntent = { observedSeq: again.recovery.observedSeq, nodeId: 'effect' };
  const replays = await Promise.all(Array.from({ length: 12 }, () => call('POST', `/runs/${source.id}/replay`, replayIntent)));
  assert.equal(replays.filter((r) => r.status === 202).length, 1);
  assert.equal(replays.filter((r) => r.status === 409).length, 11);
  const forkId = replays.find((r) => r.status === 202).body.run.id;
  await terminal(forkId);
  assert.equal(await count(), 3);
  assert.deepEqual((await call('GET', `/runs/${source.id}/events?limit=500`)).body, history);
  console.log(JSON.stringify({ scenario: 'native parallel Replay', statuses: replays.map((r) => r.status), forkId, markerCount: await count(), sourceHistoryUnchanged: true }));
  const lostIntent = { observedSeq: again.recovery.observedSeq, nodeId: 'start' };
  await new Promise((resolve, reject) => {
    const req = request(origin + `/runs/${source.id}/replay`, { method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => { res.destroy(); resolve(); });
    req.on('error', reject);
    req.end(JSON.stringify(lostIntent));
  });
  const found = await call('POST', `/runs/${source.id}/replay`, lostIntent);
  assert.equal(found.status, 409);
  assert.equal(found.body.code, 'RECOVERY_STALE');
  assert.ok(found.body.replayRunId);
  await terminal(found.body.replayRunId);
  assert.equal(await count(), 4);
  console.log(JSON.stringify({ scenario: 'discarded Replay response body', existingFork: found.body.replayRunId, markerCount: await count() }));
  await stop(active);
  active = await boot();
  const repeated = await call('POST', `/runs/${source.id}/replay`, replayIntent);
  assert.equal(repeated.status, 409);
  assert.equal(repeated.body.replayRunId, forkId);
  assert.equal(await count(), 4);
  console.log(JSON.stringify({ scenario: 'native restart preserves Replay deduplication', existingFork: repeated.body.replayRunId, markerCount: await count() }));
  db = openDatabase({ url: pathToFileURL(database).href });
  const uncertainLoop = await publish('audit uncertain completion', 0);
  await db.client.execute("CREATE TRIGGER audit_refuse_completion BEFORE INSERT ON run_events WHEN NEW.type = 'node.finished' AND NEW.node_id = 'effect' BEGIN SELECT RAISE(ABORT, 'AUDIT_COMPLETION_FAULT'); END;");
  const uncertainStart = await call('POST', `/loops/${uncertainLoop}/runs`, {});
  const uncertain = await terminal(uncertainStart.body.run.id);
  assert.equal(uncertain.failure.code, 'SCRIPT_OUTCOME_UNCERTAIN');
  assert.equal(await count(), 5);
  for (const action of ['resume', 'replay']) {
    const refused = await call('POST', `/runs/${uncertain.id}/${action}`, { observedSeq: uncertain.recovery.observedSeq, ...(action === 'replay' ? { nodeId: 'effect' } : {}) });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.code, 'SCRIPT_CONSENT_REQUIRED');
  }
  await stop(active);
  active = await boot();
  assert.equal((await get(uncertain.id)).failure.code, 'SCRIPT_OUTCOME_UNCERTAIN');
  assert.equal(await count(), 5);
  await db.client.execute('DROP TRIGGER audit_refuse_completion');
  const current = await get(uncertain.id);
  assert.equal((await call('POST', `/runs/${current.id}/resume`, { observedSeq: current.recovery.observedSeq, retryUncertainScript: true })).status, 200);
  assert.equal((await terminal(current.id)).status, 'succeeded');
  assert.equal(await count(), 6);
  console.log(JSON.stringify({ scenario: 'native uncertain completion restart and consent', beforeConsent: 5, afterConsent: await count(), sameRun: current.id === uncertain.id }));
} finally {
  db?.close();
  if (active?.exitCode === null) await stop(active);
  console.log(JSON.stringify({ scenario: 'owned native cleanup', processes: children.map((child) => ({ pid: child.pid, exit: child.exitCode })), dataDir }));
}
