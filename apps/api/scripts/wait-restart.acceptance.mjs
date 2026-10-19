/** Native restart acceptance for #272/#226/#257. Build first; no provider calls. */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { performance } from 'node:perf_hooks';
const { fetch, AbortSignal } = globalThis;
// Bootstrap varied enough to exhaust 30 s during parallel gates; a separate public-main
// measurement took 16.8 s. Give startup bounded headroom without relaxing wait assertions.
const STARTUP_TIMEOUT_MS = 90_000;
// Use only this fixture's GraphGoblin configuration in the disposable process.
const inheritedEnv = { ...process.env };
for (const key of Object.keys(inheritedEnv)) if (key.startsWith('GG_')) delete inheritedEnv[key];
import { setTimeout as delay } from 'node:timers/promises';
const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
async function freePort() {
  for (let port = 5600; port < 5700; port++) {
    const server = createServer();
    try {
      await new Promise((ok, no) => {
        server.once('error', no);
        server.listen(port, '127.0.0.1', ok);
      });
      await new Promise((ok) => server.close(ok));
      return port;
    } catch {
      server.close();
    }
  }
  throw Error('No disposable port');
}
async function until(check, timeout = 30000) {
  const end = performance.now() + timeout;
  while (performance.now() < end) {
    const value = await check();
    if (value) return value;
    await delay(50);
  }
  throw Error('Acceptance timed out');
}
function definition(name, kind, config) {
  return {
    schemaVersion: 4,
    name,
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      { id: 'work', kind, label: 'Work', config },
      { id: 'done', kind: 'exit', label: 'Done', config: { returns: 'lastOutput.value' } },
    ],
    edges: [
      { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'work' } },
      { id: 'b', from: { node: 'work', port: 'out' }, to: { node: 'done' } },
    ],
  };
}
async function removeFixtureDir(dataDir) {
  assert.equal(dirname(dataDir), resolve(tmpdir()));
  assert.ok(basename(dataDir).startsWith('gg-c2-native-'));
  await rm(dataDir, { recursive: true, force: true });
}
for (const poll of [50, 1000]) {
  const dataDir = await mkdtemp(join(tmpdir(), 'gg-c2-native-'));
  const port = await freePort().catch(async (error) => {
    await removeFixtureDir(dataDir);
    throw error;
  });
  const base = 'http://127.0.0.1:' + port;
  let child;
  let output = '';
  async function boot() {
    console.warn(
      JSON.stringify({ phase: 'boot', poll, port, dataDir, at: new Date().toISOString() }),
    );
    const bootStarted = performance.now();
    const preload =
      'data:text/javascript,' +
      encodeURIComponent(
        "process.stderr.write(JSON.stringify({phase:'api-process-started',pid:process.pid,at:Date.now()}));",
      );
    child = spawn(process.execPath, ['--import', preload, join(root, 'apps/api/dist/main.js')], {
      cwd: root,
      windowsHide: true,
      env: {
        ...inheritedEnv,
        GG_DATA_DIR: dataDir,
        GG_DB_URL: 'file:' + join(dataDir, 'store.db'),
        GG_HOST: '127.0.0.1',
        GG_PORT: String(port),
        GG_TIMER_POLL_MS: String(poll),
        GG_REQUIRE_API_KEY: 'false',
        GG_SWAGGER_UI: 'false',
        GG_WEB_DIST: '',
        GG_MASTER_KEY: Buffer.alloc(32, 7).toString('base64'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let bootError;
    child.once('error', (error) => {
      bootError = error;
    });
    child.stdout.on('data', (b) => {
      output = (output + b).slice(-10000);
    });
    child.stderr.on('data', (b) => {
      output = (output + b).slice(-10000);
    });
    try {
      await until(async () => {
        if (bootError) throw bootError;
        if (child.exitCode !== null || child.signalCode !== null) throw Error(output);
        return fetch(base + '/healthz', { signal: AbortSignal.timeout(2000) }).then(
          (r) => r.ok,
          () => false,
        );
      }, STARTUP_TIMEOUT_MS);
      console.warn(
        JSON.stringify({
          phase: 'ready',
          poll,
          pid: child.pid,
          elapsedMs: performance.now() - bootStarted,
        }),
      );
    } catch (error) {
      throw new Error(String(error) + '\n' + output, { cause: error });
    }
  }
  async function stop() {
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise((ok) => child.once('exit', ok));
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
    return { status: response.status, json };
  }
  async function start(def) {
    const made = await request('/loops', { definition: def });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    const id = made.json.loop.id;
    assert.equal((await request('/loops/' + id + '/publish', {})).status, 200);
    const started = await request('/loops/' + id + '/runs', {});
    assert.equal(started.status, 202);
    return until(async () => {
      const r = (await request('/runs/' + started.json.run.id)).json;
      return r.status === 'waiting' ? r : false;
    });
  }
  async function finished(id) {
    return until(async () => {
      const r = (await request('/runs/' + id)).json;
      return r.status === 'succeeded' ? r : false;
    });
  }
  async function wakes(id) {
    return (await request('/runs/' + id + '/events')).json.items.filter(
      (e) => e.type === 'run.woken',
    );
  }
  try {
    await boot();
    const input = await start(
      definition('Input ' + poll, 'wait', { mode: 'input', prompt: 'Native restart' }),
    );
    const hb = await start(
      definition('Heartbeat ' + poll, 'heartbeat', {
        intervalSeconds: 5,
        probe: { kind: 'signal-count', name: 'tick' },
        until: 'probe.count >= 2',
        maxBeats: 50,
      }),
    );
    assert.equal(
      (await request('/runs/' + hb.id + '/signals/tick', { waitId: hb.waiting.waitId })).status,
      200,
    );
    await until(async () => {
      const r = (await request('/runs/' + hb.id)).json;
      return r.waiting?.beat >= 2;
    });
    const deadline = new Date(Date.now() + 30000).toISOString();
    const timer = await start(
      definition('Timer ' + poll, 'wait', { mode: 'until', timestamp: deadline }),
    );
    const paused = await start(
      definition('Paused ' + poll, 'wait', { mode: 'until', timestamp: deadline }),
    );
    assert.equal((await request('/runs/' + paused.id + '/pause', {})).status, 200);
    assert.equal((await request('/runs/' + timer.id)).json.status, 'waiting');
    assert.ok(
      Date.parse(deadline) - Date.now() > 1000,
      'native fixture setup overran its deadline',
    );
    await stop();
    await delay(Math.max(0, Date.parse(deadline) - Date.now() + 100));
    await boot();
    console.warn(JSON.stringify({ phase: 'restarted', poll, at: new Date().toISOString() }));
    const restored = (await request('/runs/' + input.id)).json;
    assert.equal(restored.waiting.waitId, input.waiting.waitId);
    assert.equal(
      (
        await request('/runs/' + input.id + '/input', {
          waitId: input.waiting.waitId,
          input: 'persisted',
        })
      ).status,
      200,
    );
    assert.equal((await finished(input.id)).result, 'persisted');
    const duplicate = await request('/runs/' + input.id + '/input', {
      waitId: input.waiting.waitId,
      input: 'duplicate',
    });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.json.code, 'WAIT_MISMATCH');
    await finished(timer.id);
    assert.equal((await wakes(timer.id)).length, 1);
    const held = (await request('/runs/' + paused.id)).json;
    assert.equal(held.status, 'paused');
    assert.equal(held.waiting.waitId, paused.waiting.waitId);
    await request('/runs/' + paused.id + '/resume', {});
    await finished(paused.id);
    assert.equal((await wakes(paused.id)).length, 1);
    const heartbeat = (await request('/runs/' + hb.id)).json;
    assert.equal(heartbeat.status, 'waiting');
    assert.equal(
      (await request('/runs/' + hb.id + '/signals/tick', { waitId: heartbeat.waiting.waitId }))
        .status,
      200,
    );
    assert.equal((await finished(hb.id)).result.probe.count, 2);
    console.warn(
      JSON.stringify({
        poll,
        dataDir,
        inputIdentity: true,
        timerWakes: 1,
        pausedWakes: 1,
        heartbeatCount: 2,
      }),
    );
  } finally {
    await stop();
    await removeFixtureDir(dataDir);
  }
}
