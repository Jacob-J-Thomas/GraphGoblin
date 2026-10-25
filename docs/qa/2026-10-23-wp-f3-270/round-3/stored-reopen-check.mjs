import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Resolve public package entry points from the API workspace, without dependency links.
const root = process.cwd();
assert(root.endsWith('codex-wp-f3-270'), 'run from the assigned worktree root');
const packageContext = pathToFileURL(join(root, 'apps/api/package.json')).href;
const from = (name) => import(import.meta.resolve(name, packageContext));
const { buildApp, createContainer, loadConfig } = await from('@graphgoblin/api');
const { FakeHarness, CapturingLogger } = await from('@graphgoblin/engine/testing');

if (process.argv.includes('--serve')) {
  const container = await createContainer(loadConfig(process.env), {
    harnesses: { codex: new FakeHarness() },
    logger: new CapturingLogger(),
    startTimers: false,
  });
  await container.start();
  const app = await buildApp(container, { logger: false });
  await app.listen({ host: '127.0.0.1', port: Number(process.env.GG_PORT) });
  process.stdin.once('data', async () => {
    await app.close();
    await container.stop();
  });
  process.stdin.resume();
  process.stdout.write(JSON.stringify({ ready: true, pid: process.pid }) + '\n');
} else {
  const { openDatabase } = await from('@graphgoblin/infrastructure/sqlite');
  const { minimalLoop } = await from('@graphgoblin/contracts/testing');
  const dataDir = await mkdtemp(join(tmpdir(), 'gg-wp-f3-270-cold-reopen-'));
  const dbUrl = 'file:' + join(dataDir, 'graphgoblin.db').replaceAll('\\', '/');
  let port;
  for (let candidate = 5780; candidate <= 5789; candidate++) {
    const probe = createServer();
    const free = await new Promise((res, rej) => {
      probe.once('error', (error) => error.code === 'EADDRINUSE' ? res(false) : rej(error));
      probe.listen(candidate, '127.0.0.1', () => probe.close(() => res(true)));
    });
    if (free) { port = candidate; break; }
  }
  assert(port, 'no port free in assigned 5780-5789 range');
  const origin = 'http://127.0.0.1:' + port;
  let child;
  let childOutput = '';
  async function start() {
    child = spawn(process.execPath, [...process.execArgv, process.argv[1], '--serve'], {
      cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, GG_DATA_DIR: dataDir, GG_DB_URL: dbUrl, GG_HOST: '127.0.0.1', GG_PORT: String(port), GG_REQUIRE_API_KEY: 'false', GG_MASTER_KEY: Buffer.alloc(32, 9).toString('base64') },
    });
    const owned = child;
    await new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error('API did not become ready within 90 seconds')), 90_000);
      owned.stdout.setEncoding('utf8');
      owned.stdout.on('data', (chunk) => {
        childOutput += chunk;
        if (chunk.includes('"ready":true')) { clearTimeout(timer); res(); }
      });
      owned.stderr.setEncoding('utf8');
      owned.stderr.on('data', (chunk) => { childOutput += chunk; });
      owned.once('exit', (code) => { clearTimeout(timer); rej(new Error('API exited before readiness: ' + code + '\n' + childOutput)); });
    });
    return owned.pid;
  }
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const owned = child;
    const exited = once(owned, 'exit');
    owned.stdin.end('stop\n');
    let timer;
    try {
      await Promise.race([exited, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('owned API did not stop within 30 seconds')), 30_000); })]);
      assert.equal(owned.exitCode, 0);
    } catch (error) {
      owned.kill();
      throw error;
    } finally { clearTimeout(timer); }
  }
  async function call(method, path, body) {
    const response = await fetch(origin + path, { method, signal: AbortSignal.timeout(30_000), ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
    const data = await response.json();
    assert(response.ok, method + ' ' + path + ': ' + response.status + ' ' + JSON.stringify(data));
    return { http: response.status, data };
  }
  const evidence = { node: process.version, dataDir, origin, kind: 'built API, real SQLite file, fake harness; no provider turns', reads: [] };
  try {
    evidence.firstPid = await start();
    const draft = (await call('POST', '/loops', { definition: { ...minimalLoop(), name: 'Cold old draft' } })).data;
    const published = (await call('POST', '/loops', { definition: { ...minimalLoop(), name: 'Cold old published' } })).data;
    await call('POST', '/loops/' + published.loop.id + '/publish');
    const started = (await call('POST', '/loops/' + draft.loop.id + '/runs', { allowDraft: true, versionId: draft.draft.id })).data.run;
    for (let count = 0; count < 200; count++) {
      const run = (await call('GET', '/runs/' + started.id)).data;
      if (run.status === 'succeeded') break;
      assert(count < 199, 'draft run did not finish');
      await new Promise((res) => setTimeout(res, 50));
    }
    await stop();
    const handle = openDatabase({ url: dbUrl });
    try {
      const trigger = (await handle.client.execute("SELECT sql FROM sqlite_master WHERE name = 'loop_versions_snapshot_immutable'")).rows[0].sql;
      await handle.client.execute('DROP TRIGGER loop_versions_snapshot_immutable');
      await handle.client.execute("UPDATE loop_versions SET definition = json_remove(definition, '$.settings.structuredTimeoutMs', '$.settings.runDeadlineSeconds')");
      await handle.client.execute(String(trigger));
      await handle.client.execute("UPDATE runs SET pinned = json_remove(pinned, '$.limits.structuredTimeoutMs', '$.limits.runDeadlineSeconds')");
      await handle.client.execute("UPDATE run_events SET payload = json_remove(payload, '$.pinned.limits.structuredTimeoutMs', '$.pinned.limits.runDeadlineSeconds') WHERE type = 'run.queued'");
      await handle.client.execute('DELETE FROM __drizzle_migrations WHERE created_at = 1792818000000');
      evidence.before = (await handle.client.execute("SELECT id, status, json_type(definition, '$.settings.structuredTimeoutMs') AS completionType, json_type(definition, '$.settings.runDeadlineSeconds') AS runType FROM loop_versions")).rows;
      assert(evidence.before.every((row) => row.completionType === null && row.runType === null));
    } finally { handle.close(); }
    evidence.secondPid = await start();
    assert.notEqual(evidence.firstPid, evidence.secondPid);
    for (const [state, created] of [['draft', draft], ['published', published]]) {
      const result = await call('GET', '/loops/' + created.loop.id);
      const version = result.data[state === 'draft' ? 'draft' : 'current'];
      assert.equal(version.definition.settings.structuredTimeoutMs, null);
      assert.equal(version.definition.settings.runDeadlineSeconds, null);
      const exported = await call('GET', '/loops/' + created.loop.id + '/export' + (state === 'draft' ? '?draft=true' : ''));
      assert.equal(exported.data.loop.settings.structuredTimeoutMs, null);
      evidence.reads.push({ state, http: result.http, exportHttp: exported.http, structuredTimeoutMs: version.definition.settings.structuredTimeoutMs, runDeadlineSeconds: version.definition.settings.runDeadlineSeconds });
    }
    const run = (await call('GET', '/runs/' + started.id)).data;
    assert.equal(run.pinned.limits.structuredTimeoutMs, null);
    assert.equal(run.pinned.limits.runDeadlineSeconds, null);
    const snapshot = await call('GET', '/loops/' + draft.loop.id + '/versions/' + started.versionId);
    assert.equal(snapshot.data.definition.settings.structuredTimeoutMs, null);
    evidence.reads.push({ state: 'run pin and immutable snapshot', http: snapshot.http, structuredTimeoutMs: null, runDeadlineSeconds: null });
    await stop();
    const after = openDatabase({ url: dbUrl });
    try {
      evidence.after = (await after.client.execute("SELECT id, status, json_type(definition, '$.settings.structuredTimeoutMs') AS completionType, json_type(definition, '$.settings.runDeadlineSeconds') AS runType FROM loop_versions")).rows;
      assert(evidence.after.every((row) => row.completionType === 'null' && row.runType === 'null'));
      evidence.migrationRecorded = (await after.client.execute('SELECT count(*) AS count FROM __drizzle_migrations WHERE created_at = 1792818000000')).rows[0].count;
      assert.equal(Number(evidence.migrationRecorded), 1);
    } finally { after.close(); }
    evidence.result = 'PASS';
    process.stdout.write(JSON.stringify(evidence, null, 2) + '\n');
  } finally {
    await stop();
    // Leave this explicitly named disposable store for the orchestrator; no directory deletion.
  }
}
