import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { execFile, fork } from 'node:child_process';
import { promisify } from 'node:util';
import { finished } from 'node:stream/promises';
import { createServer } from 'node:http';
import { createServer as createSocketServer } from 'node:net';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bytes, dependency, disk, json, definition } from './common.mjs';
import { readReplay } from './replay.mjs';
import { measureBrowser } from './browser.mjs';

const recordings = new Map();
const exec = promisify(execFile);
const script = (name) => fileURLToPath(new URL(name, import.meta.url));

async function reportMeasurementFailure(error, output) {
  const clip = (value, limit = 2000) => {
    if (typeof value === 'string')
      return value.length > limit ? value.slice(0, limit) + ' [truncated]' : value;
    return value === null || ['boolean', 'number'].includes(typeof value)
      ? value
      : value === undefined
        ? null
        : '[unexpected ' + typeof value + ']';
  };
  const diagnostic = {
    code: clip(error.code, 80),
    signal: clip(error.signal, 80),
    killed: clip(error.killed),
  };
  try {
    const summary = JSON.parse(await readFile(join(output, 'raw-summary.json'), 'utf8'));
    if (!Array.isArray(summary?.cases)) throw new Error('raw-summary cases must be an array');
    diagnostic.flags = Object.fromEntries(
      ['error', 'correctnessFailure', 'memoryLogError', 'closeError', 'profileError'].map((key) => [
        key,
        clip(summary[key]),
      ]),
    );
    diagnostic.caseCount = summary.cases.length;
    diagnostic.cases = summary.cases.slice(0, 5).map((entry) => {
      const pages = Array.isArray(entry?.browser?.pages) ? entry.browser.pages : [];
      return {
        correctness: Object.fromEntries(
          Object.entries(entry?.correctness ?? {})
            .filter(
              ([, value]) =>
                value === null || ['boolean', 'number', 'string'].includes(typeof value),
            )
            .slice(0, 32)
            .map(([key, value]) => [clip(key, 80), clip(value, 200)]),
        ),
        pageCount: pages.length,
        pages: pages.slice(0, 5).map((page) => ({
          name: clip(page?.name, 80),
          errorCount: Array.isArray(page?.errors) ? page.errors.length : null,
          errors: Array.isArray(page?.errors)
            ? page.errors.slice(0, 5).map((value) => clip(value, 500))
            : [],
          executionContinued: clip(page?.executionContinued),
          runningThroughout: clip(page?.runningThroughout),
          beforeStatus: clip(page?.beforeRun?.status, 80),
          afterStatus: clip(page?.afterRun?.status, 80),
          beforeSeq: clip(page?.beforeRun?.lastEventSeq, 80),
          afterSeq: clip(page?.afterRun?.lastEventSeq, 80),
        })),
      };
    });
  } catch (cause) {
    diagnostic.summaryReadError = clip(cause.message);
  }
  console.error('PERF_FAILURE ' + JSON.stringify(diagnostic));
}

test('measurement failure diagnostics preserve the error and expose bounded raw failure details', async () => {
  const output = await mkdtemp(join(tmpdir(), 'gg-wp-a5b-perf-diagnostics-'));
  const cause = new Error('original cause');
  const error = Object.assign(new Error('original failure', { cause }), {
    code: 1,
    signal: 'SIGTERM',
    killed: true,
    stdout: 'DO_NOT_PRINT_STDOUT',
  });
  const original = { message: error.message, stack: error.stack, ...error };
  const page = {
    name: 'events',
    errors: ['x'.repeat(3000)],
    executionContinued: false,
    runningThroughout: false,
    beforeRun: { status: 'succeeded', lastEventSeq: 12010 },
    afterRun: { status: 'succeeded', lastEventSeq: 12010 },
  };
  await writeFile(
    join(output, 'raw-summary.json'),
    JSON.stringify({
      correctnessFailure: true,
      profileError: 'x'.repeat(3000),
      cases: Array.from({ length: 7 }, () => ({
        correctness: { ok: true, browserOk: false, visits: { data: 'DO_NOT_PRINT_NESTED' } },
        browser: { pages: Array.from({ length: 7 }, () => page) },
      })),
      cpuProfile: 'DO_NOT_PRINT_PROFILE',
      samples: ['DO_NOT_PRINT_SAMPLES'],
      dataDir: 'DO_NOT_PRINT_STORE',
    }),
  );
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await reportMeasurementFailure(error, output);
    const message = log.mock.calls[0][0];
    const diagnostic = JSON.parse(message.slice('PERF_FAILURE '.length));
    assert.deepEqual([diagnostic.code, diagnostic.signal, diagnostic.killed], [1, 'SIGTERM', true]);
    assert.equal(diagnostic.flags.correctnessFailure, true);
    assert.equal(diagnostic.cases[0].correctness.browserOk, false);
    assert.deepEqual(diagnostic.cases[0].pages[0], {
      name: 'events',
      errorCount: 1,
      errors: ['x'.repeat(500) + ' [truncated]'],
      executionContinued: false,
      runningThroughout: false,
      beforeStatus: 'succeeded',
      afterStatus: 'succeeded',
      beforeSeq: 12010,
      afterSeq: 12010,
    });
    assert.equal(diagnostic.caseCount, 7);
    assert.equal(diagnostic.cases.length, 5);
    assert.equal(diagnostic.cases[0].pageCount, 7);
    assert.equal(diagnostic.cases[0].pages.length, 5);
    assert.ok(diagnostic.flags.profileError.length < 2100);
    assert.ok(!message.includes('DO_NOT_PRINT'));
    await reportMeasurementFailure(error, join(output, 'absent'));
    assert.match(log.mock.calls[1][0], /summaryReadError.*ENOENT/);
    await writeFile(join(output, 'raw-summary.json'), '{');
    await reportMeasurementFailure(error, output);
    assert.match(log.mock.calls[2][0], /summaryReadError/);
    assert.deepEqual({ message: error.message, stack: error.stack, ...error }, original);
    assert.equal(error.cause, cause);
  } finally {
    log.mockRestore();
  }
});

test('measurement helpers count nested files, tolerate absent stores and reject invalid HTTP responses', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gg-wp-a5b-perf-helpers-'));
  await mkdir(join(root, 'nested'));
  await writeFile(join(root, 'nested/value'), 'abc');
  assert.deepEqual(await disk(root), { bytes: 3, files: 1 });
  assert.deepEqual(await disk(join(root, 'absent')), { bytes: 0, files: 0 });
  await assert.rejects(disk(join(root, 'nested/value')), /ENOTDIR/);
  assert.equal(bytes({ unicode: '測定' }), Buffer.byteLength('{"unicode":"測定"}'));
  assert.equal(typeof (await dependency('node:fs')).readFile, 'function');
  const graph = definition(4, { passes: 2, inference: true, grow: true, artifacts: true });
  assert.equal(
    graph.nodes.find((n) => n.id === 'work').config.output.captureTranscript,
    'artifact',
  );
  assert.equal(graph.edges.find((e) => e.from.node === 'work').to.node, 'grow');
  const server = createServer((request, response) => {
    response.writeHead(request.url === '/bad' ? 503 : 200, { 'content-type': 'application/json' });
    response.end(
      request.url === '/bad' ? 'unavailable' : JSON.stringify({ method: request.method }),
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.deepEqual(await json(base, '/ok'), { method: 'GET' });
    assert.deepEqual(await json(base, '/ok', {}), { method: 'POST' });
    await assert.rejects(json(base, '/bad'), /503 unavailable/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('raw replay reads real HTTP framing and rejects an incomplete chunked response', async () => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write('id: 1\ndata: {"seq":1}\n\n');
    response.end('id: 2\ndata: {"seq":2}\n\n');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const observations = [];
    const result = await readReplay(`http://127.0.0.1:${server.address().port}`, 'run', {
      after: 0,
      pauseMs: 0,
      stopAfter: Infinity,
      progress: (value) => observations.push(value),
    });
    assert.equal(result.events, 2);
    assert.equal(result.gaps, 0);
    assert.equal(result.lastSeq, 2);
    assert.ok(result.receivedBytes > 0 && observations.length > 0);
    const disconnected = await readReplay(`http://127.0.0.1:${server.address().port}`, 'run', {
      after: 0,
      pauseMs: 1,
      stopAfter: 1,
      progress() {},
    });
    assert.ok(disconnected.events >= 1 && disconnected.events <= 2);
    assert.equal(disconnected.lastSeq, disconnected.events);
    assert.equal(disconnected.gaps, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  const broken = createSocketServer((socket) => {
    socket.once('data', () =>
      socket.end('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n7\r\nshort'),
    );
  });
  await new Promise((resolve) => broken.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(
      readReplay(`http://127.0.0.1:${broken.address().port}`, 'broken', {
        after: 0,
        pauseMs: 0,
        stopAfter: Infinity,
        progress() {},
      }),
      /Incomplete replay response/,
    );
  } finally {
    await new Promise((resolve) => broken.close(resolve));
  }
});

test.each(['long', 'context', 'artifacts', 'replay', 'readiness', 'browser', 'append'])(
  'maintained measurement CLI validates a bounded %s workload with disposable stores',
  async (workload) => {
    const output = await mkdtemp(join(tmpdir(), 'gg-wp-a5b-perf-smoke-'));
    const args = [
      script('./measure.mjs'),
      workload,
      '--aged=' + (workload === 'append' ? 0 : 2),
      '--items=1',
      '--profile=' + (workload === 'append' ? 'node' : 'inspector'),
      '--out=' + output,
    ];
    // Browser observations require a run that remains active across three navigations.
    if (workload !== 'readiness')
      args.push('--passes=' + (workload === 'browser' ? 1000 : workload === 'append' ? 25 : 2));
    if (workload === 'browser') args.push('--browser-ms=1000');
    if (workload === 'replay') args.push('--pause-ms=1');
    if (workload === 'append') args.push('--item-pause-ms=1');
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith('GG_')),
    );
    if (workload === 'browser' && process.env.GG_E2E_BROWSER_CHANNEL !== undefined)
      env.GG_E2E_BROWSER_CHANNEL = process.env.GG_E2E_BROWSER_CHANNEL;
    let result;
    try {
      result = await exec(process.execPath, args, {
        env,
        windowsHide: true,
        timeout: 180_000,
        maxBuffer: 16 * 1024 * 1024,
      });
    } catch (error) {
      // Diagnostic read/log failures must never replace the original subprocess failure.
      await reportMeasurementFailure(error, output).catch(() => {});
      throw error;
    }
    assert.match(result.stdout, /PERF /);
    const summary = JSON.parse(await readFile(join(output, 'raw-summary.json'), 'utf8'));
    const compact = JSON.parse(await readFile(join(output, 'summary.json'), 'utf8'));
    recordings.set(workload, { output, summary });
    assert.equal(summary.workload, workload);
    assert.equal(summary.error, undefined);
    assert.equal(summary.profileError, undefined);
    assert.equal(summary.correctnessFailure, undefined);
    assert.equal(summary.cases.length, 1);
    assert.equal(compact.cases.length, 1);
    if (workload === 'append') {
      assert.equal(summary.cases[0].recovery.ok, true);
      assert.equal(summary.cases[0].threadRequest.status, 200);
      assert.ok(summary.cases[0].appendSql);
    }
    if (workload === 'browser') {
      // The raw record also retains the browser dataset and per-page observations.
      assert.equal(summary.cases[0].browser.inbound.events, 50);
      assert.equal(summary.cases[0].browser.pages.length, 3);
    }
    if (workload === 'readiness') {
      const cold = summary.cases[0].cold;
      assert.equal(cold.entryPoint, 'apps/api/dist/main.js');
      assert.ok(Number.isFinite(cold.startupToFirstResponseMs));
      // measure.mjs owns cleanup. Windows force-termination is not graceful-exit evidence.
      if (process.platform === 'linux') assert.equal(cold.exitCode, 0);
    } else {
      assert.equal(summary.cases[0].correctness.ok, true);
      const samples = summary.cases[0].cpuSamples.count;
      assert.ok(samples > 0 && samples <= summary.cpuProfile.samples);
    }
  },
  200_000,
);

test.each(
  [
    ['unknown'],
    ['long', '--unknown=x'],
    ['long', 'bad-argument'],
    ['readiness', '--passes=2'],
    ['long', '--profile=unknown'],
    ['long', '--aged=-1'],
    ['long', '--passes=0'],
  ].map((args) => ({ args })),
)('measurement CLI refuses malformed invocation $args before opening a store', async ({ args }) => {
  await assert.rejects(
    exec(process.execPath, [script('./measure.mjs'), ...args], {
      timeout: 20_000,
      windowsHide: true,
    }),
    (error) =>
      error.code === 1 &&
      /Usage|Unknown|Expected|Invalid|Passes|profile|readiness/.test(error.stderr),
  );
});

test('summary CLI writes compact records and refuses absent output arguments', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gg-wp-a5b-perf-summary-'));
  const input = join(directory, 'raw.json'),
    output = join(directory, 'summary.json');
  await writeFile(
    input,
    JSON.stringify([
      {
        schema: 2,
        workload: 'readiness',
        cases: [{ cli: { wallMs: 1, exitCode: 0, stdout: 'ok Database reachable and migrated' } }],
      },
    ]),
  );
  await exec(process.execPath, [script('./summary.mjs'), '--out=' + output, input], {
    windowsHide: true,
  });
  const summary = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(summary.cases[0].preflight.databaseReady, true);
  await assert.rejects(exec(process.execPath, [script('./summary.mjs'), input]), (error) =>
    /Usage/.test(error.stderr),
  );
});

test('browser observation refuses an unavailable API before starting a browser', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(503);
    response.end('unavailable');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(
      measureBrowser({
        base: `http://127.0.0.1:${server.address().port}`,
        runId: 'missing',
        warmupPass: 1,
      }),
      /503 unavailable/,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('native measurement worker rejects malformed IPC and cancels an unfinished measurement on close', async (t) => {
  const output = await mkdtemp(join(tmpdir(), 'gg-wp-a5b-perf-worker-'));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GG_')),
  );
  env.GG_PERF_OPTIONS = JSON.stringify({
    dataDir: join(output, 'store'),
    output,
    profileMode: 'node',
  });
  const child = fork(script('./worker.mjs'), [], {
    env,
    windowsHide: true,
    execArgv: ['--experimental-import-meta-resolve', '--expose-gc'],
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  const cleanup = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await deadline(exited, 'forced worker cleanup');
  };
  t.onTestFinished(cleanup);
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const pending = new Map();
  let nextId = 0;
  // Observe the process and its only pipe separately: explicit IPC disconnect can omit
  // ChildProcess's aggregate 'close' event even after 'exit' and stderr completion.
  const exited = Promise.all([
    new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
    }),
    finished(child.stderr),
  ]).then(([exit]) => exit);
  void exited.then(() => {
    readyReject(new Error('worker closed: ' + stderr));
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('worker closed: ' + stderr));
    }
  }, readyReject);
  child.on('message', (message) => {
    if (message.ready) {
      readyResolve();
      return;
    }
    const entry = pending.get(message.id);
    if (!entry) return; // Unsolicited memory samples use the documented separate message shape.
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(message.error));
    else entry.resolve(message.result);
  });
  const call = (command, args) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('measurement IPC timed out: ' + command));
      }, 20_000);
      pending.set(id, { resolve, reject, timer });
      child.send({ id, command, args });
    });
  const deadline = (promise, label) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(label + ' timed out: ' + stderr)), 20_000);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  try {
    await deadline(ready, 'worker initialization');
    const empty = await call('memory', { gc: true });
    assert.equal(empty.dbBytes, 0);
    assert.equal(empty.walBytes, 0);
    await assert.rejects(call('unknown-command'), /not a function/);
    const booted = await call('boot');
    assert.equal(booted.pid, child.pid, 'the API runs inside the measurement worker');
    await assert.rejects(call('begin', { passes: 0, inference: true }), /VALIDATION_FAILED/);
    const started = await call('begin', {
      passes: 3,
      items: 1,
      itemBytes: 16,
      contextBytes: 16,
      inference: true,
      delayMs: 10_000,
    });
    await call('close');
    const reopened = await call('boot');
    assert.equal(reopened.pid, child.pid);
    assert.equal((await json(reopened.base, '/runs/' + started.runId)).status, 'cancelled');
    assert.match(booted.base, /^http:\/\/127\.0\.0\.1:/);
    await call('close');
    // Let disconnect finish the worker's API/profile cleanup and flush subprocess coverage.
    // SIGKILL is reserved for failure cleanup, which must also observe exit and pipe closure.
    child.disconnect();
    assert.deepEqual(await deadline(exited, 'worker shutdown'), { code: 0, signal: null });
  } finally {
    await cleanup();
  }
});

test('comparison CLI accepts identical stored histories and rejects changed workload/state', async () => {
  const before = recordings.get('long'),
    after = recordings.get('context');
  assert.ok(before && after, 'bounded workloads must have produced comparison stores');
  const output = join(before.output, 'comparison.json');
  const run = (a, b) =>
    exec(
      process.execPath,
      ['--experimental-import-meta-resolve', script('./compare.mjs'), a, b, output],
      { windowsHide: true, timeout: 60_000 },
    );
  const a = join(before.output, 'raw-summary.json'),
    b = join(after.output, 'raw-summary.json');
  await run(a, a);
  let comparison = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(comparison.cases[0].equal, true);
  await assert.rejects(run(a, b), (error) => error.code === 1);
  comparison = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(comparison.cases[0].equal, false);
  assert.ok(comparison.cases[0].firstDifference.seq > 0);
  const mismatched = join(before.output, 'wrong-workload.json');
  await writeFile(
    mismatched,
    JSON.stringify({
      ...after.summary,
      cases: after.summary.cases.map((entry) => ({
        ...entry,
        specification: { ...entry.specification, passes: 999 },
      })),
    }),
  );
  await assert.rejects(run(a, mismatched), (error) => /Workload size mismatch/.test(error.stderr));
  await assert.rejects(
    exec(process.execPath, ['--experimental-import-meta-resolve', script('./compare.mjs')]),
    (error) => /Usage:/.test(error.stderr),
  );
}, 120_000);

test('measurement refuses reused evidence and unsafe store prefixes without starting an API', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gg-wp-a5b-perf-refusal-'));
  await writeFile(join(directory, 'invocation.json'), 'preserve');
  const run = (...args) =>
    exec(
      process.execPath,
      [script('./measure.mjs'), 'long', '--passes=1', '--out=' + directory, ...args],
      { windowsHide: true, timeout: 30_000 },
    );
  await assert.rejects(run(), (error) => /Evidence directory already used/.test(error.stderr));
  assert.equal(await readFile(join(directory, 'invocation.json'), 'utf8'), 'preserve');
  const fresh = await mkdtemp(join(tmpdir(), 'gg-wp-a5b-perf-prefix-'));
  await assert.rejects(
    exec(
      process.execPath,
      [script('./measure.mjs'), 'long', '--passes=1', '--out=' + fresh, '--store-prefix=../escape'],
      { windowsHide: true, timeout: 30_000 },
    ),
    (error) => /Invalid store-prefix/.test(error.stderr),
  );
});
