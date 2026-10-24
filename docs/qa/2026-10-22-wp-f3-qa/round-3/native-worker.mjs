import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { log } from 'node:console';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import process from 'node:process';

const { fetch, AbortSignal } = globalThis;

async function portNumber() {
  for (let port = 5900; port <= 5909; port += 1) {
    const probe = createServer();
    try {
      await new Promise((yes, no) => {
        probe.once('error', no);
        probe.listen(port, '127.0.0.1', yes);
      });
      await new Promise((yes) => probe.close(yes));
      return port;
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
    }
  }
  throw new Error('No free isolated port 5900-5909');
}
async function until(check, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await delay(40);
  }
  throw new Error('Isolated API evidence deadline');
}
function definition(settings, cycle = true) {
  return {
    schemaVersion: 4,
    name: 'WP-F3 native fixture',
    settings,
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      {
        id: 'work',
        kind: 'inference',
        label: 'Work',
        config: {
          prompt: { template: 'Controlled fake task; never a provider turn' },
          output: { captureTranscript: 'none', toMessages: 'none' },
        },
      },
      {
        id: 'gate',
        kind: 'decision',
        label: 'Gate',
        config: {
          kind: 'expression',
          jsonata: cycle ? '"again"' : '"done"',
          routes: [
            { id: 'again', label: 'Again' },
            { id: 'done', label: 'Done' },
          ],
        },
      },
      { id: 'done', kind: 'exit', label: 'Done', config: {} },
    ],
    edges: [
      { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'work' } },
      { id: 'b', from: { node: 'work', port: 'out' }, to: { node: 'gate' } },
      { id: 'c', from: { node: 'gate', port: 'again' }, to: { node: 'work' } },
      { id: 'd', from: { node: 'gate', port: 'done' }, to: { node: 'done' } },
    ],
  };
}
async function evidence(scenario, check) {
  if (process.argv[2] && process.argv[2] !== scenario) return;
  const data = await mkdtemp(join(tmpdir(), 'gg-qa-243-r3-native-'));
  try {
    const port = await portNumber();
    const binary = join(data, 'cli', 'codex.exe');
    const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
    const compile = `New-Item -ItemType Directory -Path ${quote(join(data, 'cli'))} | Out-Null; Add-Type -Path ${quote(resolve('tooling/fixtures/unlimited-codex.cs'))} -OutputAssembly ${quote(binary)} -OutputType ConsoleApplication`;
    await promisify(execFile)(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', compile],
      { windowsHide: true },
    );
    const child = spawn(process.execPath, ['apps/api/dist/main.js'], {
      cwd: resolve('.'),
      env: {
        ...process.env,
        GG_DATA_DIR: data,
        GG_DB_URL: `file:${join(data, 'graphgoblin.db').replaceAll('\\', '/')}`,
        GG_PORT: String(port),
        GG_HOST: '127.0.0.1',
        GG_REQUIRE_API_KEY: 'false',
        GG_CODEX_BINARY: binary,
        GG_WP_F3_SCENARIO: scenario,
        GG_WP_F3_PID_FILE: join(data, 'fake.pid'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const closed = once(child, 'exit');
    let out = '';
    let err = '';
    let healthStatus;
    let transportCode;
    child.stdout.on('data', (chunk) => {
      out = (out + chunk.toString()).slice(-4096);
    });
    child.stderr.on('data', (chunk) => {
      err = (err + chunk.toString()).slice(-4096);
    });
    const api = async (method, path, body) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        signal: AbortSignal.timeout(10_000),
        ...(body === undefined
          ? {}
          : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      });
      const result = await response.json();
      assert(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(result)}`);
      return result;
    };
    try {
      await until(async () => {
        assert.equal(child.exitCode, null, 'Isolated API exited during startup');
        try {
          const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
            signal: AbortSignal.timeout(2000),
          });
          healthStatus = response.status;
          return response.ok;
        } catch (error) {
          transportCode = error.cause?.code;
          return false;
        }
      }).catch((error) => {
        log(
          JSON.stringify({
            scenario,
            startupExit: child.exitCode,
            signal: child.signalCode,
            healthStatus,
            transportCode,
            listening: out.includes('GraphGoblin API listening'),
            stderrCodes: err.match(
              /EADDRINUSE|SQLITE_[A-Z_]+|EACCES|ENOENT|UV_THREAD_CREATE|Assertion failed|FATAL ERROR|out of memory/g,
            ),
          }),
        );
        throw error;
      });
      const create = async (settings, cycle) => {
        const created = await api('POST', '/loops', { definition: definition(settings, cycle) });
        return (
          await api('POST', `/loops/${created.loop.id}/runs`, {
            allowDraft: true,
            versionId: created.draft.id,
          })
        ).run;
      };
      await check({ api, create, data });
      log(`PASS ${scenario}`);
    } finally {
      if (child.exitCode === null) child.kill();
      await closed;
    }
  } finally {
    // Only this independently created and resolved TEMP store is removed.
    const target = relative(tmpdir(), data);
    assert(
      target.startsWith('gg-qa-243-r3-native-') && !target.includes('..') && !isAbsolute(target),
    );
    await rm(data, { recursive: true, force: true });
  }
}
await evidence('success', async ({ api, create }) => {
  const defaults = await create({}, true);
  const stopped = await until(async () => {
    const r = await api('GET', `/runs/${defaults.id}`);
    return r.status === 'failed' && r;
  });
  assert.equal(stopped.failure.code, 'MAX_NODE_VISITS', JSON.stringify(stopped.failure));
  assert.deepEqual(stopped.pinned.limits, { maxNodeVisits: 10, runDeadlineSeconds: null });
  log('Omitted deadline pinned null; existing ten-visit default retained');
  const unlimited = await create({ maxNodeVisits: null, runDeadlineSeconds: null }, true);
  await until(async () => {
    const thread = await api('GET', `/runs/${unlimited.id}/thread`);
    return thread.counters.nodeVisits.work > 20;
  }, 60000);
  const start = Date.now();
  await api('POST', `/runs/${unlimited.id}/cancel`, {});
  await until(
    async () => (await api('GET', `/runs/${unlimited.id}`)).status === 'cancelled',
    10000,
  );
  log(`Unlimited passed 20 fake turns; cancellation ${Date.now() - start}ms`);
});
await evidence('stall', async ({ api, create, data }) => {
  const run = await create({ maxNodeVisits: null, runDeadlineSeconds: null }, false);
  const pid = await until(async () => {
    try {
      return Number(await readFile(join(data, 'fake.pid'), 'utf8'));
    } catch {
      return false;
    }
  });
  const start = Date.now();
  await api('POST', `/runs/${run.id}/cancel`, {});
  await until(async () => (await api('GET', `/runs/${run.id}`)).status === 'cancelled', 10000);
  await until(() => {
    try {
      process.kill(pid, 0);
      return false;
    } catch (error) {
      return error.code === 'ESRCH';
    }
  }, 10000);
  log(`Native fake CLI ${pid} exited; cancellation ${Date.now() - start}ms`);
  const timed = await create({ runDeadlineSeconds: 5 }, false);
  const failure = await until(async () => {
    const r = await api('GET', `/runs/${timed.id}`);
    return r.status === 'failed' && r;
  });
  assert.equal(failure.failure.code, 'RUN_DEADLINE_EXCEEDED');
  log('Authored 5-second deadline failed RUN_DEADLINE_EXCEEDED');
});
for (const [mode, code] of [
  ['quota', 'HARNESS_QUOTA_EXHAUSTED'],
  ['transport', 'HARNESS_TRANSPORT_FAILED'],
  ['unknown', 'HARNESS_DELIVERY_UNCERTAIN'],
]) {
  await evidence(mode, async ({ api, create }) => {
    const run = await create({ runDeadlineSeconds: null }, false);
    const result = await until(async () => {
      const r = await api('GET', `/runs/${run.id}`);
      return r.status === 'failed' && r;
    });
    assert.equal(result.failure.code, code);
    assert.equal(result.failure.inference.submission, 'delivery-uncertain');
  });
}
