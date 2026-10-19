/* global process, performance, fetch, setInterval, clearInterval, setTimeout, clearTimeout, URL, AbortSignal */
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { spawn, fork, spawnSync } from 'node:child_process';
import { cpus, totalmem, freemem, tmpdir, loadavg, release } from 'node:os';
import { mkdtemp, mkdir, writeFile, readFile, appendFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { root, sleep, json, assertSampleCount } from './common.mjs';
import { readReplay } from './replay.mjs';
import { summarize } from './summary.mjs';

if (!process.execArgv.includes('--experimental-import-meta-resolve')) {
  const task = spawnSync(
    process.execPath,
    ['--experimental-import-meta-resolve', ...process.argv.slice(1)],
    { stdio: 'inherit', windowsHide: true },
  );
  if (task.error) throw task.error;
  process.exit(task.status ?? 1);
}
const workload = process.argv[2];
const allowed = ['long', 'context', 'replay', 'artifacts', 'readiness', 'browser'];
if (!allowed.includes(workload))
  throw new Error(
    'Usage: node tooling/perf/measure.mjs ' +
      allowed.join('|') +
      ' [--aged=2000] [--passes=100,1000,10000] [--items=2] [--out=path]',
  );
const flags = Object.fromEntries(
  process.argv.slice(3).map((arg) => {
    const match = /^--([a-z-]+)=(.+)$/.exec(arg);
    if (!match) throw new Error('Expected --name=value: ' + arg);
    return [match[1], match[2]];
  }),
);
for (const name of Object.keys(flags))
  if (
    ![
      'aged',
      'passes',
      'items',
      'context-bytes',
      'item-bytes',
      'pause-ms',
      'browser-ms',
      'setup-timeout-ms',
      'profile',
      'load-conditions',
      'out',
    ].includes(name)
  )
    throw new Error('Unknown flag: ' + name);
function integer(name, fallback, min, max) {
  const value = Number(flags[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error('Invalid ' + name);
  return value;
}
if (workload === 'readiness' && flags.passes !== undefined)
  throw new Error('readiness has no pass-size argument');
const profileMode = flags.profile ?? (process.platform === 'win32' ? 'inspector' : 'node');
if (!['node', 'inspector'].includes(profileMode))
  throw new Error('profile must be node or inspector');
const setupTimeoutMs = integer('setup-timeout-ms', 600_000, 1000, 3_600_000);
const aged = integer('aged', 0, 0, 100_000);
const passes = (
  flags.passes ??
  (['long', 'context'].includes(workload)
    ? '100,1000,10000'
    : workload === 'artifacts'
      ? '100,1000'
      : '1000')
)
  .split(',')
  .map(Number);
if (passes.some((n) => !Number.isInteger(n) || n < 1 || n > 10_000))
  throw new Error('Passes must be 1..10000');
const output = flags.out ? resolve(flags.out) : await mkdtemp(join(tmpdir(), 'gg-sustained-'));
await mkdir(output, { recursive: true });
try {
  await readFile(join(output, 'invocation.json'));
  throw new Error('Evidence directory already used: ' + output);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const dataDir = await mkdtemp(join(output, 'store-'));
const options = { dataDir, output, profileMode, webDist: join(root, 'apps/web/dist') };
const hostBefore = cpus().map((cpu) => cpu.times);
const summary = {
  schema: 2,
  workload,
  command: process.argv.slice(1),
  output,
  dataDir,
  aged,
  environment: {
    measurePid: process.pid,
    launcherPid: process.ppid,
    timestamp: new Date().toISOString(),
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    ramBytes: totalmem(),
    freeRamBefore: freemem(),
    node: process.version,
    profileMode,
    platform: process.platform,
    osRelease: release(),
    loadAverage: loadavg(),
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    loadConditions:
      flags['load-conditions'] ??
      'Unspecified; record concurrent activity externally and inspect hostBusyFraction/free RAM.',
  },
  cases: [],
};
await writeFile(join(output, 'invocation.json'), JSON.stringify(summary, null, 2));
process.stderr.write('PERF_OUTPUT ' + output + '\n');
const pending = new Map();
let nextId = 0;
const child = fork(fileURLToPath(new URL('./worker.mjs', import.meta.url)), [], {
  cwd: root,
  windowsHide: true,
  env: { ...process.env, GG_PERF_OPTIONS: JSON.stringify(options) },
  execArgv: [
    '--experimental-import-meta-resolve',
    '--expose-gc',
    ...(profileMode === 'node'
      ? [
          '--cpu-prof',
          '--cpu-prof-interval=1000',
          '--cpu-prof-dir=' + output,
          '--cpu-prof-name=api.cpuprofile',
        ]
      : []),
  ],
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
});
let readyResolve, readyReject;
const ready = new Promise((resolve, reject) => {
  readyResolve = resolve;
  readyReject = reject;
});
const readyTimer = setTimeout(() => {
  readyReject(new Error('API worker initialization timed out'));
  child.kill();
}, setupTimeoutMs);
ready.then(
  () => clearTimeout(readyTimer),
  () => clearTimeout(readyTimer),
);
let memoryWrites = Promise.resolve();
let stderr = '';
child.stderr.on('data', (chunk) => {
  stderr += chunk;
  process.stderr.write(chunk);
});
child.stdout.on('data', (chunk) => process.stderr.write(chunk));
child.on('message', ({ id, result, error, ready: isReady, memorySample }) => {
  if (memorySample) {
    memoryWrites = memoryWrites
      .then(() =>
        appendFile(join(output, 'memory-live.jsonl'), JSON.stringify(memorySample) + '\n'),
      )
      .catch((error) => {
        summary.memoryLogError = error.stack;
      });
    return;
  }
  if (isReady) {
    readyResolve();
    return;
  }
  const entry = pending.get(id);
  if (!entry) return;
  pending.delete(id);
  clearTimeout(entry.timer);
  if (error) entry.reject(new Error(error));
  else entry.resolve(result);
});
child.on('exit', (code, signal) => {
  readyReject(new Error('API worker exited before initialization: ' + code + '/' + signal));
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
    entry.reject(new Error(`API worker exited ${code}/${signal}: ${stderr}`));
  }
  pending.clear();
});
function call(command, args) {
  if (!child.connected) return Promise.reject(new Error('API worker disconnected'));
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    // Measurement ceiling, not an execution SLA. Preserve partial evidence on failure.
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('measurement timed out: ' + command));
    }, 3_600_000);
    pending.set(id, { resolve, reject, timer });
    child.send({ id, command, args }, (error) => {
      if (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      }
    });
  });
}
async function save() {
  await writeFile(join(output, 'raw-summary.json'), JSON.stringify(summary, null, 2));
  await writeFile(join(output, 'summary.json'), JSON.stringify(summarize([summary]), null, 2));
}
async function replay(base, runId, { after = 0, pauseMs = 0, stopAfter = Infinity, hasher } = {}) {
  const before = await call('startReplay'),
    start = performance.now();
  const observations = [];
  let progress = { receivedBytes: 0, wireBytesConsumed: 0, receivedEvents: 0 },
    inFlight;
  const sample = async () => {
    const memory = await call('memory');
    observations.push({
      ...memory,
      ...progress,
      replayElapsedMs: performance.now() - start,
      bytesInFlight: Math.max(0, memory.socketBytesWritten - progress.wireBytesConsumed),
    });
  };
  // At most one RPC is outstanding while a synchronous replay blocks the API event loop.
  const timer = setInterval(() => {
    if (!inFlight)
      inFlight = sample()
        .catch(() => {})
        .finally(() => {
          inFlight = undefined;
        });
  }, 25);
  try {
    const result = await readReplay(base, runId, {
      after,
      pauseMs,
      stopAfter,
      hasher,
      progress: (value) => {
        progress = value;
      },
    });
    clearInterval(timer);
    await inFlight;
    const afterMemory = await call('endReplay');
    const finalFlight = Math.max(0, afterMemory.socketBytesWritten - result.wireBytesConsumed);
    return {
      ...result,
      before,
      afterMemory,
      observations,
      eventLoopDelayMs: afterMemory.eventLoopDelayMs,
      socketBytesWritten: afterMemory.socketBytesWritten,
      maxBytesInFlight: Math.max(finalFlight, 0, ...observations.map((p) => p.bytesInFlight)),
    };
  } finally {
    clearInterval(timer);
  }
}
async function coldFirstRequest() {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise((resolve, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve())),
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('GG_')),
  );
  Object.assign(env, {
    GG_DATA_DIR: dataDir,
    GG_HOST: '127.0.0.1',
    GG_PORT: String(port),
    GG_REQUIRE_API_KEY: 'false',
    GG_MASTER_KEY: Buffer.alloc(32, 9).toString('base64'),
    GG_SWAGGER_UI: 'false',
    GG_CODEX_BINARY: join(output, 'absent-codex'),
    GG_CLAUDE_BINARY: join(output, 'absent-claude'),
  });
  const at = performance.now();
  const server = spawn(process.execPath, ['apps/api/dist/main.js'], {
    cwd: root,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (chunk) => process.stderr.write(chunk));
  server.stderr.on('data', (chunk) => process.stderr.write(chunk));
  const exited = once(server, 'exit');
  const pollMs = 100;
  let polls = 0,
    result;
  try {
    while (performance.now() - at < setupTimeoutMs) {
      if (server.exitCode !== null || server.signalCode !== null)
        throw new Error('Cold main.js exited before first response');
      const requested = performance.now();
      polls++;
      try {
        const response = await fetch(`http://127.0.0.1:${port}/runs?limit=100`, {
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok) {
          await response.arrayBuffer();
          result = {
            entryPoint: 'apps/api/dist/main.js',
            pid: server.pid,
            port,
            pollMs,
            polls,
            firstRequestMs: performance.now() - requested,
            startupToFirstResponseMs: performance.now() - at,
          };
          break;
        }
      } catch {
        /* connection refused while the native entry point starts */
      }
      await sleep(pollMs);
    }
    if (!result) throw new Error('Cold main.js startup timed out');
  } finally {
    if (server.exitCode === null && server.signalCode === null) server.kill('SIGTERM');
    const [exitCode, signal] = await exited;
    if (result) Object.assign(result, { exitCode, signal });
  }
  return result;
}

async function preflight() {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('GG_')),
  );
  Object.assign(env, {
    GG_DATA_DIR: dataDir,
    GG_SWAGGER_UI: 'false',
    GG_MASTER_KEY: Buffer.alloc(32, 9).toString('base64'),
    GG_CODEX_BINARY: join(output, 'absent-codex'),
    GG_CLAUDE_BINARY: join(output, 'absent-claude'),
  });
  const at = performance.now(),
    cli = spawn(process.execPath, ['apps/api/dist/main.js', '--preflight'], {
      cwd: root,
      env,
      windowsHide: true,
    });
  let stdout = '',
    errors = '';
  cli.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  cli.stderr.on('data', (chunk) => {
    errors += chunk;
  });
  const [exitCode] = await once(cli, 'exit');
  return {
    wallMs: performance.now() - at,
    exitCode,
    stdout,
    stderr: errors,
    harnessCondition: 'Intentionally unavailable executable paths; store checks real, no provider',
  };
}
let failure;
try {
  await ready;
  summary.boot = await call('boot');
  await save();
  if (aged) {
    summary.population = await call('populate', { count: aged });
    await save();
  }
  summary.idleSqlQueue = await call('probe');
  for (const count of passes) {
    const spec = {
      passes: count,
      items: integer(
        'items',
        workload === 'replay' ? 32 : workload === 'artifacts' ? 8 : 2,
        0,
        10_000,
      ),
      itemBytes: integer(
        'item-bytes',
        workload === 'artifacts' ? 4096 : workload === 'replay' ? 256 : 120,
        1,
        1_000_000,
      ),
      contextBytes: integer('context-bytes', workload === 'browser' ? 512 : 128, 1, 1_000_000),
      inference: workload !== 'context',
      grow: workload === 'browser',
      artifacts: workload === 'artifacts',
      // Small browser smoke runs still span all three page observations.
      delayMs:
        workload === 'browser'
          ? Math.max(
              50,
              Math.ceil((3 * integer('browser-ms', 5000, 100, 120_000) + 20_000) / count),
            )
          : 0,
    };
    if (workload === 'readiness') {
      await call('close');
      const cli = await preflight();
      const cold = await coldFirstRequest();
      const at = performance.now(),
        reopened = await call('boot');
      const requestAt = performance.now();
      await json(reopened.base, '/runs?limit=100');
      summary.cases.push({
        cli,
        cold,
        reopened,
        startupToFirstResponseMs: performance.now() - at,
        firstRequestMs: performance.now() - requestAt,
      });
    } else {
      const started = await call('begin', spec);
      let browser;
      if (workload === 'browser') {
        const { measureBrowser } = await import('./browser.mjs');
        browser = await measureBrowser({
          base: started.base,
          runId: started.runId,
          output,
          durationMs: integer('browser-ms', 5000, 100, 120_000),
          warmupPass: Math.max(1, Math.floor(count / 4)),
          call,
        });
      }
      const queueDuring = await call('probe');
      const result = await call('finish');
      const threadAt = performance.now();
      const threadResponse = await fetch(started.base + '/runs/' + started.runId + '/thread', {
        signal: AbortSignal.timeout(120_000),
      });
      const threadBody = await threadResponse.arrayBuffer();
      result.threadRequest = {
        status: threadResponse.status,
        bytes: threadBody.byteLength,
        wallMs: performance.now() - threadAt,
      };
      if (!threadResponse.ok) throw new Error('Thread request HTTP ' + threadResponse.status);
      result.queueDuring = queueDuring;
      if (browser) {
        result.browser = browser;
        result.correctness.browserOk =
          browser.pages.every((page) => page.errors.length === 0) &&
          browser.pages
            .filter((page) => page.name !== 'events-empty')
            .every((page) => page.executionContinued);
      }
      if (workload === 'replay') {
        result.replays = {};
        result.replays.first = await replay(started.base, started.runId);
        result.replays.late = await replay(started.base, started.runId, {
          after: Math.floor(result.correctness.storedEvents * 0.9),
        });
        result.replays.slow = await replay(started.base, started.runId, {
          pauseMs: integer('pause-ms', 50, 1, 10_000),
        });
        const reconnectHasher = createHash('sha256');
        const interrupted = await replay(started.base, started.runId, {
          stopAfter: Math.floor(result.correctness.storedEvents / 3),
          hasher: reconnectHasher,
        });
        const reconnected = await replay(started.base, started.runId, {
          after: interrupted.lastSeq,
          hasher: reconnectHasher,
        });
        result.replays.reconnect = {
          interrupted,
          reconnected,
          ok:
            interrupted.gaps === 0 &&
            reconnected.gaps === 0 &&
            interrupted.events + reconnected.events === result.correctness.storedEvents &&
            reconnected.sha256 === result.eventSerialization.sha256,
        };
        result.correctness.replayOk =
          result.replays.first.events === result.correctness.storedEvents &&
          result.replays.first.gaps === 0 &&
          result.replays.first.sha256 === result.eventSerialization.sha256 &&
          result.replays.slow.sha256 === result.eventSerialization.sha256 &&
          result.replays.late.sha256 === result.eventSerialization.lateSha256 &&
          result.replays.slow.events === result.correctness.storedEvents &&
          result.replays.slow.gaps === 0 &&
          result.replays.late.gaps === 0 &&
          result.replays.late.lastSeq === result.correctness.storedEvents &&
          result.replays.reconnect.ok;
      }
      summary.cases.push(result);
      if (
        !result.correctness.ok ||
        result.correctness.replayOk === false ||
        result.correctness.browserOk === false
      )
        summary.correctnessFailure = true;
    }
    await save();
    process.stderr.write('PERF_CASE ' + count + ' complete\n');
  }
} catch (error) {
  failure = error;
  summary.error = error.stack;
} finally {
  await call('close').catch((error) => {
    summary.closeError = error.message;
  });
  if (child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    if (child.connected) child.disconnect();
    await exited;
  }
  await memoryWrites;
  summary.environment.freeRamAfter = freemem();
  const hostAfter = cpus().map((cpu) => cpu.times);
  let hostIdle = 0,
    hostTotal = 0;
  hostAfter.forEach((times, index) => {
    for (const key of Object.keys(times)) {
      const delta = times[key] - hostBefore[index][key];
      hostTotal += delta;
      if (key === 'idle') hostIdle += delta;
    }
  });
  summary.environment.hostBusyFraction = 1 - hostIdle / hostTotal;
  // Raw profile is retained; a stable table makes sampled attribution inspectable without DevTools.
  try {
    const profile = JSON.parse(await readFile(join(output, 'api.cpuprofile'), 'utf8'));
    const hits = new Map(),
      nodes = new Map(profile.nodes.map((node) => [node.id, node]));
    for (const id of profile.samples ?? []) {
      const frame = nodes.get(id).callFrame;
      const key = `${frame.url}:${frame.lineNumber + 1} ${frame.functionName}`;
      hits.set(key, (hits.get(key) ?? 0) + 1);
    }
    for (const result of summary.cases) {
      if (!result.profileWindow) continue;
      const caseHits = new Map();
      let at = profile.startTime,
        count = 0;
      for (let index = 0; index < (profile.samples?.length ?? 0); index++) {
        at += profile.timeDeltas[index];
        if (at < result.profileWindow.startUs || at > result.profileWindow.endUs) continue;
        const frame = nodes.get(profile.samples[index]).callFrame;
        const key = frame.url + ':' + (frame.lineNumber + 1) + ' ' + frame.functionName;
        caseHits.set(key, (caseHits.get(key) ?? 0) + 1);
        count++;
      }
      assertSampleCount(count, profile.samples?.length ?? 0);
      result.cpuSamples = { count, top: [...caseHits].sort((a, b) => b[1] - a[1]).slice(0, 25) };
    }
    summary.cpuProfile = {
      samples: profile.samples?.length,
      top: [...hits].sort((a, b) => b[1] - a[1]).slice(0, 30),
    };
  } catch (error) {
    summary.profileError = error.message;
  }
  await save();
}
// Keep the terminal record a summary; full sampled traces remain in summary.json/JSONL.
function consoleSummary(key, value) {
  if (!Array.isArray(value) || !['samples', 'observations'].includes(key)) return value;
  const peaks = {};
  for (const metric of ['heapUsed', 'rss', 'external', 'arrayBuffers', 'writableBytes'])
    peaks[metric] = value.reduce((max, sample) => Math.max(max, sample[metric] ?? 0), 0);
  return { count: value.length, first: value[0], last: value.at(-1), sampledPeaks: peaks };
}
process.stdout.write('PERF ' + JSON.stringify(summary, consoleSummary) + '\n');
if (failure) throw failure;
if (
  summary.correctnessFailure ||
  summary.memoryLogError ||
  summary.closeError ||
  summary.profileError
)
  process.exitCode = 1;
