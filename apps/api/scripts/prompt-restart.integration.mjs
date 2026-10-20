import process from 'node:process';
import { Buffer } from 'node:buffer';
import { log, error as reportError } from 'node:console';
import { setTimeout, clearTimeout } from 'node:timers';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { singleNodeLoop } from '@graphgoblin/engine/testing';

const { fetch } = globalThis;

const fixture = fileURLToPath(new URL('./prompt-restart.fixture.mjs', import.meta.url));
async function freePort() {
  for (let port = 5840; port <= 5849; port++) {
    const probe = createServer();
    try {
      await new Promise((resolve, reject) => {
        probe.once('error', reject);
        probe.listen(port, '127.0.0.1', resolve);
      });
      await new Promise((resolve) => probe.close(resolve));
      return port;
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
    }
  }
  throw new Error('No disposable port in 5840-5849');
}
async function eventually(check) {
  const until = Date.now() + 60000;
  while (!(await check())) {
    if (Date.now() > until) throw new Error('Disposable API state deadline under load');
    await delay(25);
  }
}
function message(child, type) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      child.off('message', receive);
      child.off('exit', exited);
    };
    const receive = (value) => {
      if (value.type === type) {
        cleanup();
        resolve(value);
      }
    };
    const exited = (code) => {
      cleanup();
      reject(new Error(`Fixture exited before ${type}: ${code}`));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`IPC deadline for ${type}`));
    }, 60000);
    child.on('message', receive);
    child.once('exit', exited);
  });
}

test(
  'a real kill of the built API continues an uncertain turn from durable visit events',
  { timeout: 180000 },
  async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'gg-wp-f4-restart-'));
    const port = await freePort();
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !key.toUpperCase().startsWith('GG_') && key !== 'NODE_V8_COVERAGE',
      ),
    );
    Object.assign(env, {
      GG_DATA_DIR: dataDir,
      GG_DB_URL: `file:${join(dataDir, 'graphgoblin.db').replaceAll('\\', '/')}`,
      GG_HOST: '127.0.0.1',
      GG_PORT: String(port),
      GG_REQUIRE_API_KEY: 'false',
      GG_SWAGGER_UI: 'false',
      GG_WEB_DIST: '',
      GG_MASTER_KEY: Buffer.alloc(32, 7).toString('base64'),
    });
    const children = [];
    const start = (hold) => {
      const child = spawn(process.execPath, [fixture], {
        env: { ...env, WP_F4_HOLD: hold ? '1' : '0' },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });
      children.push(child);
      let output = '';
      child.stderr.on('data', (chunk) => {
        output += chunk;
      });
      child.on('exit', (code) => {
        if (code) reportError(output);
      });
      return child;
    };
    const origin = `http://127.0.0.1:${port}`;
    const api = async (path, body) => {
      const response = await fetch(
        origin + path,
        body === undefined
          ? undefined
          : {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            },
      );
      assert.equal(response.ok, true, `${path}: ${response.status}`);
      return response.json();
    };
    try {
      let child = start(true);
      await message(child, 'ready');
      const created = await api('/loops', {
        definition: singleNodeLoop('prompt restart', {
          id: 'infer',
          kind: 'inference',
          label: 'Infer',
          config: { prompt: { template: 'The complete synthetic authored task.' } },
        }),
      });
      const loopId = created.loop.id;
      await api(`/loops/${loopId}/publish`, {});
      const run = await api(`/loops/${loopId}/runs`, {});
      const runId = run.run.id;
      let before;
      await eventually(async () => {
        const response = await api(`/runs/${runId}/events`);
        before = Array.isArray(response) ? response : response.items;
        return before.some((event) => event.type === 'harness.submission' && event.marker);
      });
      const original = before.find((event) => event.type === 'harness.turn');
      const exit = once(child, 'exit');
      child.kill('SIGKILL');
      await exit;
      child = start(false);
      await message(child, 'ready');
      await eventually(async () => (await api(`/runs/${runId}`)).status === 'succeeded');
      const received = message(child, 'calls');
      child.send({ type: 'inspect' });
      const calls = await received;
      assert.equal(calls.started.length, 0);
      assert.equal(calls.resumed.length, 1);
      assert.equal(calls.resumed[0].sessionId, 'fake-session-1');
      assert.match(calls.resumed[0].request.turn.prompt, /previous turn was interrupted/);
      const response = await api(`/runs/${runId}/events`);
      const events = Array.isArray(response) ? response : response.items;
      const turns = events.filter((event) => event.type === 'harness.turn');
      assert.equal(turns.length, 2);
      assert.equal(turns[1].visitId, original.visitId);
      assert.equal(turns[1].promptKind, 'continuation');
      log(
        JSON.stringify({
          dataDir,
          port,
          runId,
          visitId: original.visitId,
          turns: turns.length,
          recovered: 'same session, continuation only',
        }),
      );
    } finally {
      for (const child of children)
        if (child.exitCode === null && child.signalCode === null) {
          const exit = once(child, 'exit');
          child.kill('SIGKILL');
          await exit;
        }
      // Preserve disposable evidence for orchestrator cleanup; never remove directories here.
    }
  },
);
