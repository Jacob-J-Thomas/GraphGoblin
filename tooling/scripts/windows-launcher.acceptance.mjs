// Native Windows executable + built API, disposable stores, no provider turns or owner ports.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { watch } from 'node:fs';
import {
  access,
  chmod,
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import {
  Agent as HttpAgent,
  createServer as createHttpServer,
  request as httpRequest,
} from 'node:http';
import { createConnection, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, normalize, relative, sep } from 'node:path';
import process from 'node:process';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import {
  aliasStage,
  errorCodeOf,
  isExpectedOwnershipRefusal,
  openWindowsLauncherEvidence,
} from './windows-launcher-evidence.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
// CI evidence (#496): typed records only, appended as they occur. Without the CI variable nothing
// is written; the variable is removed from this process before any child starts.
const ciEvidence = openWindowsLauncherEvidence({ repoRoot: root });
const execute = ciEvidence.observeExecFile(promisify(execFile));
/**
 * The one fixture host filter: Windows environment names are case-insensitive, so every inherited
 * spelling of GG_* and JEV_API_KEY is removed before any deliberate fixture override. Enrollment,
 * launcher, manual and job-owner starts all derive their environment from this result.
 */
function fixtureEnvironment(source) {
  return Object.fromEntries(
    Object.entries(source).filter(([key]) => {
      const upper = key.toUpperCase();
      return !upper.startsWith('GG_') && upper !== 'JEV_API_KEY';
    }),
  );
}
const env = fixtureEnvironment(process.env);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function ownershipFixture(path, owner) {
  const record = { ...owner, token: owner.token ?? randomUUID() };
  if (path.endsWith('.reclaim')) {
    await mkdir(path);
    path = join(path, `${record.token}.json`);
  }
  const contents = JSON.stringify(record);
  await writeFile(path, contents);
  return { path, contents };
}

function ownershipContender(dataDir) {
  const module = pathToFileURL(join(root, 'apps/api/dist/data-dir-lock.js')).href;
  const program = `
    const { acquireDataDirLock } = await import(process.argv[1]);
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const facts = error => {
      const failures = [];
      const pending = [error];
      for (let inspected = 0; pending.length && inspected < 8; inspected++) {
        const current = pending.shift();
        if (current.operation) failures.push({ code: current.code ?? null, operation: current.operation, markerToken: current.markerToken ?? null });
        if (current.errors) pending.push(...current.errors);
        if (current.cause) pending.push(current.cause);
      }
      return { code: error.code ?? null, operation: error.operation ?? null, markerToken: error.markerToken ?? null, failures };
    };
    process.stdin.resume();
    const released = new Promise(resolve => process.stdin.once('end', resolve));
    let lock;
    try {
      lock = await acquireDataDirLock(process.argv[2]);
      const { token } = JSON.parse(await readFile(join(process.argv[2], 'graphgoblin.lock'), 'utf8'));
      process.stdout.write(JSON.stringify({ status: 'acquired', pid: process.pid, token }) + '\\n');
    } catch (error) {
      process.stdout.write(JSON.stringify({ status: 'refused', pid: process.pid, error: error.message, ...facts(error) }) + '\\n');
    }
    if (lock) {
      await released;
      try {
        await lock.release();
        process.stdout.write(JSON.stringify({ status: 'released', pid: process.pid }) + '\\n');
      } catch (error) {
        process.stdout.write(JSON.stringify({ status: 'release-failed', pid: process.pid, ...facts(error) }) + '\\n');
        process.exitCode = 1;
      }
    }
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', program, module, dataDir], {
    env,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const exited = new Promise((resolve) => child.once('close', resolve));
  let stdout = '';
  let stderr = '';
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Ownership contender ${child.pid} timed out: ${stderr}`)),
      55_000,
    );
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const newline = stdout.indexOf('\n');
      if (newline < 0) return;
      clearTimeout(timer);
      try {
        resolve(JSON.parse(stdout.slice(0, newline)));
      } catch (error) {
        reject(error);
      }
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (!stdout.includes('\n'))
        reject(new Error(`Ownership contender exited ${code}: ${stderr}`));
    });
  });
  return {
    child,
    result,
    exited,
    messages: () =>
      stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
  };
}
let nextPort = Number(process.env.GG_TEST_PORT_START ?? 4830);
const lastPort = nextPort + 20;
async function freePort() {
  while (nextPort < lastPort) {
    const port = nextPort++;
    const server = createServer();
    const free = await new Promise((resolve) => {
      server.on('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error('No disposable Windows launcher test port is available.');
}
const origin = (config) => `http://127.0.0.1:${config.Port}`;
const health = async (config) => {
  const response = await fetch(origin(config) + '/healthz', {
    redirect: 'error',
    signal: AbortSignal.timeout(2000),
  });
  assert.equal(response.status, 200);
  return {
    pid: response.headers.get('x-graphgoblin-pid'),
    identity: response.headers.get('x-graphgoblin-instance'),
    launch: response.headers.get('x-graphgoblin-launch-identity'),
  };
};

/** Every real API startup in these fixtures is provider-free, whatever a case overrides. */
const providerFree = Object.freeze({ GG_OLLAMA_ENABLED: 'false' });
function assertProviderFree(environment) {
  const value = Object.entries(environment).find(
    ([key]) => key.toUpperCase() === 'GG_OLLAMA_ENABLED',
  )?.[1];
  assert.equal(value, 'false', 'A product gateway environment must disable Ollama first.');
  for (const key of Object.keys(environment))
    assert.ok(
      key.toUpperCase() === key || !key.toUpperCase().startsWith('GG_'),
      'A product gateway environment must use one case-insensitive GG_* spelling.',
    );
}

/**
 * The installer's own enrollment path (#566): the compiled launcher's `--enroll-install` runs the
 * contained configured helper with the cold launch environment, and its record is embedded.
 */
async function enroll(exe, path, config, host = env) {
  const { Enrollment: _previous, ...unenrolled } = config;
  await writeFile(path, JSON.stringify(unenrolled));
  const { stdout, stderr } = await execute(exe, ['--enroll-install', '--config', path], {
    cwd: root,
    env: host,
    windowsHide: true,
    timeout: 40_000,
  });
  assert.equal(stderr, '');
  const enrolled = { ...unenrolled, Enrollment: JSON.parse(stdout) };
  await writeFile(path, JSON.stringify(enrolled));
  return enrolled;
}

/** Independent implementation of the launcher's documented gateway-input encoding. */
function gatewayInputsDigest({ Repo, Node, DataDir, Port, Environment = {} }) {
  const hash = createHash('sha256');
  const field = (value) => {
    const bytes = Buffer.from(String(value), 'utf8');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    hash.update(length).update(bytes);
  };
  const names = Object.keys(Environment).sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  field('graphgoblin-launcher-gateway-inputs/v1');
  for (const value of [Repo, Node, DataDir, Port, names.length]) field(value);
  for (const name of names) {
    field(name);
    field(Environment[name]);
  }
  return hash.digest('hex');
}

/** Disposable helper protocol stub: one fixed, valid non-file enrollment for its store. */
const stubEnrollment = `if(process.argv[2]==='--launch-enrollment'){process.stdout.write(JSON.stringify({version:'1',launch:'v1:'+'c'.repeat(64),instance:'a'.repeat(64),dataDir:process.env.GG_DATA_DIR,database:'non-file'})+'\\n');process.exit(0);}\n`;

/**
 * A disposable stand-in for a built checkout: the guarded entry marker, guard module and web shell
 * exist, while `main` and `identity` supply the gateway and the read-only helper. No real gateway,
 * store or provider is involved.
 */
async function stubCheckout(directory, { main, identity }) {
  for (const [file, contents] of [
    ['apps/api/dist/main.js', `export const WINDOWS_LAUNCHER_LOG_PROTOCOL = 1;\n${main}`],
    ['apps/api/dist/instance-identity.js', identity],
    ['apps/api/dist/windows-log/guard.js', ''],
    ['apps/web/dist/index.html', '<html></html>'],
  ]) {
    await mkdir(dirname(join(directory, file)), { recursive: true });
    await writeFile(join(directory, file), contents);
  }
  return directory;
}

function compileChecks(compiler, checks) {
  return execute(
    compiler,
    [
      '/nologo',
      '/target:exe',
      '/platform:x64',
      '/main:NativeChecks',
      '/reference:System.Windows.Forms.dll',
      '/reference:System.Web.Extensions.dll',
      `/out:${checks}`,
      join(root, 'apps/windows-launcher/Launcher.cs'),
      join(root, 'apps/windows-launcher/NativeChecks.cs'),
    ],
    { windowsHide: true },
  );
}

/**
 * Settle `promise` within `ms` or fail with `label`. A cancelled test (its AbortSignal) fails the
 * wait at once, so the caller's `finally` cleanup always runs. The timer never outlives the wait.
 */
function bounded(promise, ms, label, signal) {
  return new Promise((resolve, reject) => {
    const finish = (settle, value) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancelled);
      settle(value);
    };
    const cancelled = () => finish(reject, new Error(`${label} was cancelled.`));
    const timer = setTimeout(
      () => finish(reject, new Error(`${label} did not settle within ${ms} ms.`)),
      ms,
    );
    if (signal?.aborted) return cancelled();
    signal?.addEventListener('abort', cancelled, { once: true });
    promise.then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
  });
}

/**
 * One public click whose result is an exit record. Should its test fail first, `abandon` stops
 * that exact child before cleanup releases any lock it may be waiting for.
 */
function pendingClick(promise) {
  const { child } = promise;
  const result = promise.then(
    (value) => ({ code: 0, ...value }),
    (error) => error,
  );
  return {
    result,
    async abandon() {
      if (child && child.exitCode === null && child.signalCode === null) child.kill();
      await bounded(result, 45_000, 'An abandoned launcher click');
    },
  };
}

/**
 * A detached child is outside Node's own kill-on-close job, so a fixture job is its only one.
 * A timeout or test cancellation terminates this exact child and waits for it to close. Its
 * limited job is kill-on-close; its other members end with it.
 */
function runDetached(file, args, timeout = 120_000, signal, host = env) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: root,
      env: host,
      windowsHide: true,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let stopped;
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    const stop = (reason) => {
      stopped ??= reason;
      child.kill();
    };
    const cancelled = () => stop(new Error('A detached native fixture was cancelled.'));
    const timer = setTimeout(
      () => stop(new Error('A detached native fixture timed out.')),
      timeout,
    );
    signal?.addEventListener('abort', cancelled, { once: true });
    if (signal?.aborted) cancelled();
    const settle = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancelled);
    };
    child.once('error', (error) => {
      settle();
      reject(error);
    });
    child.once('close', (code) => {
      settle();
      if (stopped) reject(stopped);
      else resolve({ code, stdout, stderr });
    });
  });
}

/**
 * The compatible control's job owner (#544): a detached NativeChecks `--job-owner` broker whose
 * unlimited kill-on-close outer job holds the launcher, its contained helpers, a gateway it starts
 * and their descendants. Its first stdout line reports the click. `release` closes stdin, so the
 * broker observes its sibling and remaining members, reports them and closes its job. A timeout or
 * test cancellation terminates this exact broker, whose closing job handle then settles every
 * member, including a gateway that is still starting.
 */
function ownJob(checks, args, signal, host = env, timeout = 170_000) {
  const child = spawn(checks, args, {
    cwd: root,
    env: host,
    windowsHide: true,
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let stopped;
  let reported;
  const first = new Promise((resolve) => (reported = resolve));
  child.stdin.on('error', () => undefined);
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    if (stdout.includes('\n')) reported();
  });
  child.stderr.on('data', (chunk) => (stderr += chunk));
  const closed = new Promise((resolve) => {
    child.once('close', resolve);
    child.once('error', () => resolve(null));
  });
  const stop = (reason) => {
    stopped ??= reason;
    if (child.exitCode === null && child.signalCode === null) child.kill();
  };
  const timer = setTimeout(() => stop(new Error('A native job owner timed out.')), timeout);
  const cancelled = () => stop(new Error('A native job owner was cancelled.'));
  signal?.addEventListener('abort', cancelled, { once: true });
  if (signal?.aborted) cancelled();
  void closed.then(() => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancelled);
    reported();
  });
  const line = (index) => stdout.split('\n')[index]?.trim() || undefined;
  const report = first.then(() => {
    if (stopped) throw stopped;
    const text = line(0);
    assert.ok(text, `The job owner did not report: ${stderr.split('\n', 1)[0]}`);
    return JSON.parse(text);
  });
  report.catch(() => undefined);
  let releasing;
  return {
    child,
    closed,
    report,
    /** The explicit release: the broker reports its sibling and members, then closes its job. */
    release() {
      releasing ??= (async () => {
        child.stdin.end();
        try {
          await bounded(closed, 30_000, 'The job owner release');
        } catch (error) {
          stop(error);
          await closed;
        }
        if (stopped) throw stopped;
        const text = line(1);
        return { code: await closed, ...(text ? JSON.parse(text) : {}) };
      })();
      return releasing;
    },
    /** Terminate this exact broker; its kill-on-close job settles every remaining member. */
    async cancel() {
      stop(new Error('A native job owner was cancelled.'));
      await closed;
    },
  };
}

/**
 * Exact-handle settlement witness (NativeChecks `--await-exits`): each PID is opened while the
 * caller knows it is alive. `settle` sends the go signal, then reports each expected exit within
 * `bound` and whether each survivor is still running. Nothing is terminated by the witness.
 */
async function exitWitness(checks, exits, survivors, bound = 15_000) {
  const witness = spawn(
    checks,
    ['--await-exits', String(bound), exits.join(','), survivors.join(',')],
    { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let stdout = '';
  let held;
  const holding = new Promise((resolve) => (held = resolve));
  witness.stdin.on('error', () => undefined);
  witness.stdout.on('data', (chunk) => {
    stdout += chunk;
    if (stdout.includes('\n')) held();
  });
  const closed = new Promise((resolve) => witness.once('close', resolve));
  void closed.then(() => held());
  const lines = () => stdout.split('\n').filter((line) => line.trim());
  const abandon = async () => {
    if (witness.exitCode === null && witness.signalCode === null) witness.kill();
    await closed;
  };
  try {
    await bounded(holding, 15_000, 'The exit witness');
    const [first] = lines();
    assert.ok(first, 'The exit witness did not hold its handles.');
    return {
      held: JSON.parse(first).held,
      async settle() {
        witness.stdin.end();
        await bounded(closed, bound + 15_000, 'The exit witness settlement');
        return JSON.parse(lines()[1]).results;
      },
      abandon,
    };
  } catch (error) {
    await abandon();
    throw error;
  }
}

/** Poll a JSON file its writer renames into place; stop at `ms` or when `gone()` reports. */
async function writtenJson(path, ms, gone = () => false) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await readFile(path, 'utf8'));
    } catch {
      if (gone()) break;
      await sleep(50);
    }
  }
  throw new Error(`${basename(path)} was not written.`);
}

/**
 * Hold one configuration's store and port startup mutexes in another process. Acquisition is
 * bounded; `release` is idempotent and stops that exact holder if stdin EOF does not end it.
 */
async function holdLaunchMutexes(checks, config, signal) {
  const holder = spawn(checks, ['--hold-launch-mutexes', config.DataDir, String(config.Port)], {
    env,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const closed = new Promise((resolve) => holder.once('close', resolve));
  let released;
  const release = () =>
    (released ??= (async () => {
      holder.stdin.end();
      try {
        await bounded(closed, 10_000, 'The launch mutex holder');
      } catch {
        holder.kill();
        await closed;
      }
    })());
  try {
    await bounded(
      new Promise((resolve, reject) => {
        let output = '';
        holder.stdout.on('data', (chunk) => {
          output += chunk;
          if (output.includes('held')) resolve();
        });
        holder.once('exit', (code) => reject(new Error(`Mutex holder exited ${code}`)));
        holder.once('error', reject);
      }),
      40_000,
      'The launch mutex holder acquisition',
      signal,
    );
  } catch (error) {
    await release();
    throw error;
  }
  return { release };
}

/**
 * A listener that accepts and never answers. It reads what arrives, so a client's close always
 * ends the socket: unread request bytes would otherwise hold it half-open and hide that close.
 * `probedBefore` settles once the launcher's lock-free `GET /healthz` probe has arrived and its
 * client has closed it unanswered, which is when the click gives up its warm observation (#566).
 */
async function silentListener(port) {
  const sockets = new Set();
  const seen = { connections: 0, closed: 0, healthProbes: 0, closedHealthProbes: 0 };
  let notify;
  const probed = new Promise((resolve) => (notify = resolve));
  const server = createServer((socket) => {
    seen.connections++;
    sockets.add(socket);
    let head = '';
    let probe = false;
    socket.on('error', () => undefined);
    socket.on('data', (chunk) => {
      if (probe || head.length >= 64) return;
      head += chunk.toString('latin1');
      if (head.startsWith('GET /healthz ')) {
        probe = true;
        seen.healthProbes++;
      }
    });
    socket.on('close', () => {
      sockets.delete(socket);
      seen.closed++;
      if (!probe) return;
      seen.closedHealthProbes++;
      notify();
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  let closing;
  return {
    seen,
    /** Fail, with the observed connection counts, if `click` settles or the bound passes first. */
    async probedBefore(click, signal) {
      let early;
      try {
        early = await bounded(
          Promise.race([probed.then(() => null), click]),
          20_000,
          'The unanswered warm probe',
          signal,
        );
      } catch (error) {
        throw new Error(`${error.message} Observed: ${JSON.stringify(seen)}`, { cause: error });
      }
      if (early !== null)
        assert.fail(
          `The click settled before its warm probe ended: ${JSON.stringify({
            code: early.code,
            stderr: String(early.stderr ?? '').split('\n', 1)[0],
            seen,
          })}`,
        );
    },
    close() {
      closing ??= new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      });
      return closing;
    },
  };
}

/**
 * A loopback listener that is not an owned gateway. It answers health with `headers`, offers a
 * running shutdown snapshot it never acts on, answers `/app/` with `app` (a status, or 'hang' for
 * no answer) or redirects everything, and records every request: a test can prove that no drain,
 * shutdown observation or followed redirect reached it.
 */
async function replacementListener(port, { headers = {}, app = 200, redirect } = {}) {
  const requests = [];
  const sockets = new Set();
  const server = createHttpServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    if (redirect) {
      response.writeHead(302, { location: redirect });
      response.end();
    } else if (request.url === '/healthz') {
      response.writeHead(200, { 'content-type': 'application/json', ...headers });
      response.end('{"status":"ok"}');
    } else if (request.method === 'GET' && request.url === '/system/shutdown') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          phase: 'running',
          activeRunIds: [],
          unconfirmedRunIds: [],
          controlToken: 'replacement:0:running',
        }),
      );
    } else if (request.url !== '/app/') {
      response.writeHead(404);
      response.end();
    } else if (app !== 'hang') {
      response.writeHead(app);
      response.end();
    }
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  let closing;
  return {
    requests,
    drains: () => requests.filter((request) => request === 'POST /system/shutdown').length,
    close() {
      closing ??= new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      });
      return closing;
    },
  };
}

/**
 * A manually started built gateway with the launcher's environment, provider-free. Its retained
 * child PID anchors ownership, which is then verified by process identity and its leases. A start
 * that never verifies is settled through that exact child handle, never through its port.
 */
async function manualGateway(config, host = env) {
  const environment = {
    ...host,
    ...config.Environment,
    GG_HOST: '127.0.0.1',
    GG_PORT: String(config.Port),
    GG_DATA_DIR: config.DataDir,
    GG_WEB_DIST: join(config.Repo, 'apps/web/dist'),
  };
  assertProviderFree(environment);
  const child = spawn(config.Node, [join(config.Repo, 'apps/api/dist/main.js')], {
    cwd: config.Repo,
    env: environment,
    windowsHide: true,
    stdio: 'ignore',
  });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  try {
    for (let attempt = 0; attempt < 150; attempt++) {
      let running;
      try {
        running = await health(config);
      } catch {
        /* still binding */
      }
      if (running?.pid === String(child.pid))
        return { running, owner: await ownedAliasGateway(config, running.identity), child, exited };
      if (child.exitCode !== null) throw new Error(`Manual gateway exited ${child.exitCode}.`);
      await sleep(100);
    }
    throw new Error('Manual gateway did not become healthy.');
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await bounded(exited, 10_000, 'An unverified manual gateway');
    throw error;
  }
}
async function stop(config) {
  const cleanup = (result) =>
    ciEvidence.record('cleanup', { action: 'gateway-drain', result, count: null });
  try {
    await health(config);
  } catch {
    cleanup('not-running');
    return;
  }
  await fetch(origin(config) + '/system/shutdown', {
    method: 'POST',
    redirect: 'error',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'drain' }),
    signal: AbortSignal.timeout(3000),
  }).catch((error) => {
    cleanup('failed');
    throw error;
  });
  for (let i = 0; i < 100; i++) {
    try {
      await health(config);
    } catch {
      cleanup('drained');
      return;
    }
    await sleep(100);
  }
  cleanup('failed');
  throw new Error('Disposable gateway did not finish its normal drain.');
}

async function compileLauncher(compiler, exe) {
  await execute(
    compiler,
    [
      '/nologo',
      '/target:winexe',
      '/platform:x64',
      '/reference:System.Windows.Forms.dll',
      '/reference:System.Web.Extensions.dll',
      `/out:${exe}`,
      join(root, 'apps/windows-launcher/Launcher.cs'),
    ],
    { windowsHide: true },
  );
}

function launchNative(exe, path, environment = env) {
  return execute(exe, ['--config', path, '--ensure-gateway'], {
    cwd: root,
    env: environment,
    windowsHide: true,
    timeout: 30_000,
  });
}

const systemTool = (tool) => join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', tool);
let currentUserSid;
/**
 * Managed log roots must be private (#438). A profile or checkout can inherit access for other
 * local principals, so every fixture that receives logs restricts its own ACL explicitly.
 */
async function privateDirectory(path) {
  await mkdir(path, { recursive: true });
  currentUserSid ??= /"(S-1-[0-9-]+)"/.exec(
    (await execute(systemTool('whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { windowsHide: true }))
      .stdout,
  )?.[1];
  assert.ok(currentUserSid, 'The current user SID must be known.');
  await execute(
    systemTool('icacls.exe'),
    [
      path,
      '/inheritance:r',
      '/grant:r',
      `*${currentUserSid}:(OI)(CI)F`,
      '*S-1-5-18:(OI)(CI)F',
      '*S-1-5-32-544:(OI)(CI)F',
    ],
    { windowsHide: true },
  );
  return path;
}

function logRecords(contents) {
  return contents
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test(
  'Windows PowerShell 5.1 installer validates before replacing native launcher files',
  { skip: process.platform !== 'win32', timeout: 120_000 },
  ciEvidence.observeTest('installer', async (t) => {
    await mkdir(join(root, '.tmp'), { recursive: true });
    const base = await mkdtemp(join(root, '.tmp', 'windows-launcher-installer-'));
    ciEvidence.fixture('installer', base);
    const install = join(base, 'installed space α');
    await privateDirectory(install);
    const store = join(base, 'store');
    await mkdir(store);
    const exe = join(install, 'GraphGoblin.exe');
    const installer = join(root, 'scripts/install-windows-launcher.ps1');
    const system = process.env.SystemRoot;
    const powerShell = join(system, 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const compiler = join(system, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
    const fixture = join(base, 'fixture.exe');
    await compileLauncher(compiler, fixture);
    const source = join(base, 'Chrome source.lnk');
    const proxy = join(base, 'chrome_proxy.exe');
    await writeFile(proxy, 'Inert Shell Link target fixture');
    const desktop = join(base, 'Desktop/GraphGoblin.lnk');
    const programs = join(base, 'Programs/GraphGoblin.lnk');
    const port = await freePort();
    const options = {
      RepoPath: root,
      NodePath: process.execPath,
      DataDir: store,
      Port: port,
      PwaShortcut: source,
      InstallDir: install,
      DesktopShortcut: desktop,
      StartMenuShortcut: programs,
    };
    function runPowerShell(script, request, inherited = {}) {
      return execute(
        powerShell,
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-STA',
          '-EncodedCommand',
          Buffer.from(script, 'utf16le').toString('base64'),
        ],
        {
          env: { ...env, ...inherited, GG_INSTALLER_FIXTURE: JSON.stringify(request) },
          cwd: base,
          windowsHide: true,
          timeout: 40_000,
        },
      );
    }
    const chromeId = (
      await execute(fixture, ['--expected-app-id', String(port)], { windowsHide: true })
    ).stdout.trim();
    await runPowerShell(
      `$ErrorActionPreference = 'Stop'
      $request = $env:GG_INSTALLER_FIXTURE | ConvertFrom-Json
      $shell = New-Object -ComObject WScript.Shell
      $shortcut = $shell.CreateShortcut($request.source)
      $shortcut.TargetPath = $request.proxy
      $shortcut.Arguments = $request.arguments
      $shortcut.Save()`,
      { source, proxy, arguments: `--profile-directory="Default" --app-id=${chromeId}` },
    );
    const fixtureConfig = join(base, 'fixture.json');
    await writeFile(
      fixtureConfig,
      JSON.stringify({
        Repo: root,
        Node: process.execPath,
        DataDir: store,
        Port: port,
        Environment: {},
        StartupTimeoutSeconds: 30,
        WindowTimeoutSeconds: 2,
        LauncherAppUserModelId: 'Chrome.PwaFixture',
      }),
    );
    await execute(
      fixture,
      ['--ensure-gateway', '--config', fixtureConfig, '--stamp-shortcut', source],
      {
        windowsHide: true,
      },
    );

    const invoke = (overrides = {}, inherited = {}) =>
      runPowerShell(
        `$ErrorActionPreference = 'Stop'
      $request = $env:GG_INSTALLER_FIXTURE | ConvertFrom-Json
      $options = @{}
      foreach ($property in $request.options.PSObject.Properties) { $options[$property.Name] = $property.Value }
      if ($options.ContainsKey('Environment')) {
        $settings = @{}
        foreach ($property in $options.Environment.PSObject.Properties) { $settings[$property.Name] = $property.Value }
        $options.Environment = $settings
      }
      & $request.installer @options`,
        { installer, options: { ...options, ...overrides } },
        inherited,
      );
    async function invokeWithNodeDiscovery(childPath, overrides = {}) {
      const discoveredOptions = { ...options, ...overrides };
      delete discoveredOptions.NodePath;
      return runPowerShell(
        `$ErrorActionPreference = 'Stop'
      Set-StrictMode -Version Latest
      $request = $env:GG_INSTALLER_FIXTURE | ConvertFrom-Json
      $env:PATH = $request.childPath
      $options = @{}
      foreach ($property in $request.options.PSObject.Properties) { $options[$property.Name] = $property.Value }
      if ($options.ContainsKey('Environment')) {
        $settings = @{}
        foreach ($property in $options.Environment.PSObject.Properties) { $settings[$property.Name] = $property.Value }
        $options.Environment = $settings
      }
      & $request.installer @options`,
        { installer, options: discoveredOptions, childPath },
      );
    }
    async function observeStages(action) {
      const stages = [];
      let watchFailure;
      const observer = watch(base, { recursive: true }, (_event, name) => {
        if (name?.includes('gg-launcher-stage-')) stages.push(name);
      });
      observer.on('error', (error) => (watchFailure = error));
      try {
        await action();
        await sleep(50);
        if (watchFailure) throw watchFailure;
        return stages;
      } finally {
        observer.close();
      }
    }
    const sourceBefore = await readFile(source);
    const safeOverrides = {
      GG_LOG_LEVEL: 'silent',
      GG_REQUIRE_API_KEY: 'false',
      GG_OLLAMA_ENABLED: 'false',
    };
    const secretCanary = 'GG_LAUNCHER_SECRET_CANARY synthetic only';
    const ordinaryStages = await observeStages(() =>
      invoke(
        { Environment: safeOverrides },
        {
          GG_MASTER_KEY: secretCanary,
          GG_JEV_API_KEY: secretCanary,
          GG_LOG_LEVEL: 'invalid-inherited-value',
          GG_MAX_CONCURRENT_RUNS: 'invalid-inherited-value',
        },
      ),
    );
    assert.ok(
      ordinaryStages.length > 0,
      'A normal hashtable install must exercise the stage observer.',
    );
    assert.deepEqual(await readFile(source), sourceBefore);
    const config = JSON.parse(await readFile(exe + '.json', 'utf8'));
    assert.deepEqual(config.Environment, safeOverrides);
    assert.ok(!(await readFile(exe + '.json', 'utf8')).includes(secretCanary));
    // One versioned enrollment from the staged contained runtime, bound to the exact inputs.
    assert.deepEqual(Object.keys(config.Enrollment), [
      'Version',
      'Launch',
      'DataDir',
      'Database',
      'Lookup',
      'Target',
      'Inputs',
    ]);
    assert.equal(config.Enrollment.Version, 1);
    assert.match(config.Enrollment.Launch, /^v1:[a-f0-9]{64}$/);
    assert.equal(config.Enrollment.DataDir.toLowerCase(), (await realpath(store)).toLowerCase());
    assert.equal(config.Enrollment.Database, 'file');
    assert.equal(config.Enrollment.Lookup, join(store, 'graphgoblin.db'));
    assert.equal(
      config.Enrollment.Target.toLowerCase(),
      join(await realpath(store), 'graphgoblin.db').toLowerCase(),
    );
    assert.equal(config.Enrollment.Inputs, gatewayInputsDigest(config));
    assert.deepEqual(await readdir(store), [], 'Enrollment must not create store files.');
    const configPath = exe + '.json';
    const validConfig = await execute(fixture, ['--validate-install', '--config', configPath], {
      cwd: base,
      windowsHide: true,
    });
    assert.equal(validConfig.stdout, '');
    assert.equal(validConfig.stderr, '');
    for (const output of [desktop, programs]) {
      const inspected = JSON.parse(
        (await execute(exe, ['--inspect-shortcut', output], { windowsHide: true })).stdout,
      );
      assert.equal(await realpath(inspected.TargetPath), await realpath(exe));
      assert.equal(inspected.Arguments, `--config "${await realpath(exe)}.json"`);
      const id = await execute(exe, ['--read-shortcut-id', output], { windowsHide: true });
      assert.equal(id.stdout.trim(), config.LauncherAppUserModelId);
    }

    const alias = join(base, 'same source hard link.lnk');
    await link(source, alias);
    const files = [exe, exe + '.json', source, alias, desktop, programs];
    const snapshot = () => Promise.all(files.map((file) => readFile(file)));
    const before = await snapshot();
    async function refuses(overrides, expected) {
      await assert.rejects(invoke(overrides), (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, expected);
        assert.doesNotMatch(error.stdout + error.stderr, /GG_INSTALLER_PRIVATE_PATH_CANARY/);
        assert.ok(!(error.stdout + error.stderr).includes(secretCanary));
        return true;
      });
      assert.deepEqual(await snapshot(), before);
      assert.deepEqual(await readdir(store), []);
    }
    async function refusesPrivate(args, expected, stagedOutput) {
      await assert.rejects(execute(fixture, args, { cwd: base, windowsHide: true }), (error) => {
        assert.equal(error.code, 1);
        assert.equal(error.stderr, `${expected}\r\n`);
        assert.equal(error.stdout, '');
        return true;
      });
      assert.deepEqual(await snapshot(), before);
      assert.deepEqual(await readdir(store), []);
      if (stagedOutput) await assert.rejects(lstat(stagedOutput), { code: 'ENOENT' });
    }
    const secretRefusal =
      'Launcher Environment cannot contain GG_MASTER_KEY or GG_JEV_API_KEY (case-insensitive). Keep credentials in GraphGoblin secret stores; use the data directory master.key for encryption.';
    const secretKeys = [
      'GG_MASTER_KEY',
      'GG_JEV_API_KEY',
      'GG_Master_Key',
      'GG_Jev_Api_Key',
      'gg_master_key',
      'gg_jev_api_key',
    ];
    const manualDirectory = join(base, 'manual credentials');
    await privateDirectory(manualDirectory);
    const baseEntries = await readdir(base);
    for (const key of secretKeys) {
      for (const NoShortcuts of [false, true]) {
        await refuses(
          { NoShortcuts, Environment: { ...safeOverrides, [key]: secretCanary } },
          /Launcher Environment cannot contain GG_MASTER_KEY or GG_JEV_API_KEY/,
        );
        assert.deepEqual(await readdir(base), baseEntries, 'Refusal must create no stage.');
      }
      const manual = join(manualDirectory, 'manual-credential-config.json');
      await writeFile(
        manual,
        JSON.stringify({ ...config, Environment: { ...safeOverrides, [key]: secretCanary } }),
      );
      const manualBefore = await readFile(manual);
      await refusesPrivate(['--validate-install', '--config', manual], secretRefusal);
      const stagedShortcut = join(base, 'refused-credential-shortcut.lnk');
      await refusesPrivate(
        ['--stage-shortcut', stagedShortcut, manual, exe],
        secretRefusal,
        stagedShortcut,
      );
      await assert.rejects(
        execute(exe, ['--ensure-gateway', '--config', manual], { env, windowsHide: true }),
        (error) => {
          assert.equal(error.code, 1);
          assert.equal(error.stdout, '');
          assert.ok(error.stderr.startsWith(secretRefusal));
          assert.ok(!error.stderr.includes(secretCanary));
          return true;
        },
      );
      assert.deepEqual(await readFile(manual), manualBefore);
      assert.deepEqual(await snapshot(), before);
      assert.deepEqual(await readdir(store), []);
      assert.equal(await listening(port), false, 'Refused config must not start a gateway.');
      const launcherLog = await readFile(join(manualDirectory, 'launcher.log'), 'utf8');
      assert.ok(!launcherLog.includes(secretCanary));
      await unlink(manual);
    }
    const protectedOutputs = [exe, configPath, desktop, programs];
    const originalModes = await Promise.all(
      protectedOutputs.map(async (file) => (await stat(file)).mode),
    );
    try {
      for (const file of protectedOutputs) await chmod(file, 0o444);
      for (const key of secretKeys) {
        const stages = await observeStages(() =>
          refuses(
            {
              Environment: {
                ...safeOverrides,
                Keys: 'ordinary companion',
                [key]: secretCanary,
              },
            },
            /Launcher Environment cannot contain GG_MASTER_KEY or GG_JEV_API_KEY/,
          ),
        );
        assert.deepEqual(stages, [], 'Credential refusal must precede any temporary stage.');
      }
      await refuses(
        {
          RepoPath: join(base, 'must-not-be-opened'),
          NodePath: join(base, 'must-not-be-run.exe'),
          Environment: { Keys: 'ordinary companion', GG_MASTER_KEY: secretCanary },
        },
        /Launcher Environment cannot contain GG_MASTER_KEY or GG_JEV_API_KEY/,
      );
    } finally {
      for (let index = 0; index < protectedOutputs.length; index++)
        await chmod(protectedOutputs[index], originalModes[index]);
    }
    for (const key of ['GG_MASTER_KEY', 'GG_JEV_API_KEY']) {
      await refuses(
        { Environment: { [key]: '' } },
        /Launcher Environment cannot contain GG_MASTER_KEY or GG_JEV_API_KEY/,
      );
    }
    const noNodePath = [join(system, 'System32'), system].join(';');
    await assert.rejects(invokeWithNodeDiscovery(noNodePath), (error) => {
      assert.equal(error.code, 1);
      assert.match(
        error.stderr,
        /Node was not found\. Install Node 22.*-NodePath.*run the installer again\./is,
      );
      assert.doesNotMatch(error.stderr, /PropertyNotFoundException|property.+Source|\.Source/i);
      return true;
    });
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(await readdir(store), []);

    const discoveredInstall = join(base, 'discovered install');
    const discoveredStore = join(base, 'discovered store');
    await mkdir(discoveredStore);
    const nodeAvailablePath = [dirname(process.execPath), join(system, 'System32'), system].join(
      ';',
    );
    await invokeWithNodeDiscovery(nodeAvailablePath, {
      DataDir: discoveredStore,
      InstallDir: discoveredInstall,
      NoShortcuts: true,
      Port: port,
    });
    const discoveredExe = join(discoveredInstall, 'GraphGoblin.exe');
    const discoveredConfig = JSON.parse(await readFile(discoveredExe + '.json', 'utf8'));
    assert.equal(discoveredConfig.Node, await realpath(process.execPath));
    assert.equal(discoveredConfig.Port, port);
    assert.deepEqual(await readdir(discoveredStore), []);
    assert.deepEqual(await readFile(source), sourceBefore);

    const drive = base.slice(0, 2);
    const driveRelativeConfig = `${drive}${relative(base, configPath)}`;
    const rootRelativeConfig = configPath.slice(2);
    await refusesPrivate(
      ['--validate-install', '--config', driveRelativeConfig],
      'Invalid staged launcher configuration path.',
    );
    await refusesPrivate(
      ['--validate-install', '--config', rootRelativeConfig],
      'Invalid staged launcher configuration path.',
    );

    const stageDir = join(base, 'private path staging');
    await mkdir(stageDir);
    for (const [kind, privatePath] of [
      ['drive-relative', (absolute) => `${drive}${relative(base, absolute)}`],
      ['root-relative', (absolute) => absolute.slice(2)],
    ]) {
      const shortcut = join(stageDir, `${kind}.lnk`);
      const invalidShortcut = privatePath(shortcut);
      await refusesPrivate(
        ['--stage-shortcut', invalidShortcut, configPath, exe],
        'Invalid staged shortcut or final launcher path.',
        shortcut,
      );

      const finalExe = join(stageDir, `${kind}-launcher.exe`);
      await refusesPrivate(
        [
          '--stage-shortcut',
          join(stageDir, `${kind}-final.lnk`),
          configPath,
          privatePath(finalExe),
        ],
        'Invalid staged shortcut or final launcher path.',
        join(stageDir, `${kind}-final.lnk`),
      );
    }
    await refuses({ NoShortcuts: true, Environment: { GG_PORT: '9999' } }, /reserved GG_\*/i);
    await refuses(
      { NoShortcuts: true, Environment: { GG_Windows_Launcher_Log_Dir: base } },
      /reserved GG_\*/i,
    );
    // Both the installer and its staged native validator require the current guarded build.
    const staleRepo = join(base, 'stale repo');
    for (const [file, contents] of [
      ['apps/api/dist/main.js', 'export const legacyEntry = true;\n'],
      ['apps/api/dist/instance-identity.js', '// stale helper\n'],
      ['apps/web/dist/index.html', '<html></html>'],
    ]) {
      await mkdir(dirname(join(staleRepo, file)), { recursive: true });
      await writeFile(join(staleRepo, file), contents);
    }
    await mkdir(join(staleRepo, 'apps/windows-launcher'), { recursive: true });
    await copyFile(
      join(root, 'apps/windows-launcher/Launcher.cs'),
      join(staleRepo, 'apps/windows-launcher/Launcher.cs'),
    );
    await refuses(
      { RepoPath: staleRepo },
      /Build the checkout first: missing apps\/api\/dist\/windows-log\/guard\.js/,
    );
    await mkdir(join(staleRepo, 'apps/api/dist/windows-log'));
    await copyFile(
      join(root, 'apps/api/dist/windows-log/guard.js'),
      join(staleRepo, 'apps/api/dist/windows-log/guard.js'),
    );
    await refuses({ RepoPath: staleRepo }, /staged launcher configuration was refused/);
    await refuses({ DesktopShortcut: alias }, /distinct files and paths/i);
    await refuses(
      { NodePath: join(base, 'GG_INSTALLER_PRIVATE_PATH_CANARY', 'node.exe') },
      /Node.+22\.22\.2.+-NodePath/is,
    );

    // Public reinstall, publication rollback, compiler staging and default discovery (#498, #532,
    // #520). Every control runs before this case's only gateway start, so the owned store stays
    // empty, and none of them starts a gateway or browser or touches an owner folder or pin.
    const outputState = (paths) =>
      Promise.all(
        paths.map(async (path) => {
          const { dev, ino } = await stat(path, { bigint: true });
          return { path, dev, ino, bytes: await readFile(path) };
        }),
      );
    const sourceState = () => outputState([source, alias]);
    const sourceStateBefore = await sourceState();
    assert.equal(sourceStateBefore[1].ino, sourceStateBefore[0].ino, 'The alias is a hard link.');
    const refused = (attempt, message) =>
      attempt.then(
        () => assert.fail(message),
        (error) => error,
      );
    // An -EncodedCommand child serializes its error stream as CLIXML (progress records included),
    // and the error view may wrap long lines: decode its error lines, then compare refusals
    // without whitespace.
    const xmlEntities = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };
    function errorText(stderr) {
      if (!stderr.startsWith('#< CLIXML')) return stderr;
      return [...stderr.matchAll(/<S S="Error">([^<]*)<\/S>/g)]
        .map(([, line]) =>
          line
            .replace(/&(lt|gt|quot|apos|amp);/g, (_, name) => xmlEntities[name])
            .replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex) =>
              String.fromCharCode(Number.parseInt(hex, 16)),
            ),
        )
        .join('');
    }
    const compact = (text) => text.replace(/\s+/g, '');
    function assertRefusal(error, ...messages) {
      assert.equal(error.code, 1);
      const text = compact(errorText(error.stderr));
      assert.ok(
        messages.some((message) => text.includes(compact(message))),
        `Unexpected installer refusal: ${error.stderr}`,
      );
    }
    async function assertNoStages(directories) {
      for (const directory of directories) {
        const names = await readdir(directory);
        assert.deepEqual(
          names.filter((name) => name.startsWith('gg-launcher-stage-')),
          [],
          'No installer-owned stage may remain beside an output.',
        );
      }
    }
    async function assertLauncherLinks(links, launcher, installed) {
      const canonical = await realpath(launcher);
      for (const link of links) {
        const shortcut = JSON.parse(
          (await execute(fixture, ['--inspect-shortcut', link], { windowsHide: true })).stdout,
        );
        assert.equal(await realpath(shortcut.TargetPath), canonical);
        assert.equal(shortcut.Arguments, `--config "${canonical}.json"`);
        assert.equal(shortcut.IconLocation, installed.IconLocation);
        const id = await execute(fixture, ['--read-shortcut-id', link], { windowsHide: true });
        assert.equal(id.stdout.trim(), installed.LauncherAppUserModelId);
      }
    }
    /** A separate process holds `path` with read access, sharing only `share` ('Read' or 'None'). */
    function holdWithSharing(path, share) {
      const holding = execute(
        powerShell,
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          "$held = [IO.File]::Open($env:GG_TEST_HELD, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]$env:GG_TEST_SHARE); try { [Console]::Out.WriteLine('held'); [Console]::Out.Flush(); [void][Console]::In.ReadToEnd() } finally { $held.Dispose() }",
        ],
        {
          env: { ...env, GG_TEST_HELD: path, GG_TEST_SHARE: share },
          cwd: base,
          windowsHide: true,
          timeout: 60_000,
        },
      );
      // The outcome is the observed child record; a closed pipe must not escape as an event.
      holding.child.stdin.on('error', () => {});
      const settled = holding.then(
        (result) => ({ result }),
        (error) => ({ error }),
      );
      const ready = new Promise((resolve, reject) => {
        holding.child.stdout.on('data', (chunk) => {
          if (String(chunk).includes('held')) resolve();
        });
        settled.then(() => reject(new Error('The file holder exited before holding.')));
      });
      return {
        ready,
        release() {
          holding.child.stdin.end();
          return settled;
        },
      };
    }

    // Disposable Shell Links: a previous direct Chrome pin, and a PWA source for the default port
    // 4747, whose app ID is derived without connecting to or starting anything on that port.
    const seeds = join(base, 'seeds');
    await mkdir(seeds);
    const pinnedSeed = join(seeds, 'previous direct pin.lnk');
    const defaultSource = join(seeds, 'default port source.lnk');
    const defaultChromeId = (
      await execute(fixture, ['--expected-app-id', '4747'], { windowsHide: true })
    ).stdout.trim();
    await runPowerShell(
      `$ErrorActionPreference = 'Stop'
      $request = $env:GG_INSTALLER_FIXTURE | ConvertFrom-Json
      $shell = New-Object -ComObject WScript.Shell
      foreach ($link in $request.links) {
        $shortcut = $shell.CreateShortcut($link.path)
        $shortcut.TargetPath = $request.proxy
        $shortcut.Arguments = $link.arguments
        $shortcut.Description = $link.description
        $shortcut.Save()
      }`,
      {
        proxy,
        links: [
          {
            path: pinnedSeed,
            arguments: `--profile-directory="Default" --app-id=${chromeId}`,
            description: 'Previous direct Chrome pin fixture',
          },
          {
            path: defaultSource,
            arguments: `--profile-directory="Default" --app-id=${defaultChromeId}`,
            description: 'Default port Chrome PWA fixture',
          },
        ],
      },
    );
    await execute(
      fixture,
      ['--ensure-gateway', '--config', fixtureConfig, '--stamp-shortcut', defaultSource],
      { windowsHide: true },
    );

    const reinstallRoot = join(base, 'reinstall');
    const reinstallDir = join(reinstallRoot, 'installed launcher');
    const reinstallExe = join(reinstallDir, 'GraphGoblin.exe');
    const reinstallLinks = ['Desktop', 'Programs', 'Pinned'].map((folder) =>
      join(reinstallRoot, folder, 'GraphGoblin.lnk'),
    );
    const [reinstallDesktop, reinstallPrograms, reinstallPinned] = reinstallLinks;
    for (const link of reinstallLinks) await mkdir(dirname(link), { recursive: true });
    await copyFile(pinnedSeed, reinstallPinned);
    const reinstallOutputs = [reinstallExe, reinstallExe + '.json', ...reinstallLinks];
    const reinstallFolders = [reinstallRoot, ...reinstallLinks.map((link) => dirname(link))];
    const reinstallOptions = (level) => ({
      InstallDir: reinstallDir,
      DesktopShortcut: reinstallDesktop,
      StartMenuShortcut: reinstallPrograms,
      PinnedShortcut: reinstallPinned,
      Environment: { ...safeOverrides, GG_LOG_LEVEL: level },
    });

    // Also the short fresh and same-path reinstall success controls for #532. Rewriting a disposable
    // pinned file is not evidence of Explorer's taskbar behaviour.
    await t.test(
      'public first install and same-path reinstall persist changed settings and every shortcut',
      async () => {
        const seededPin = await readFile(reinstallPinned);
        const installed = [];
        for (const level of ['warn', 'debug']) {
          const result = await invoke(reinstallOptions(level));
          assert.equal(errorText(result.stderr), '');
          assert.match(result.stdout, /Launcher configured\./);
          const persisted = JSON.parse(await readFile(reinstallExe + '.json', 'utf8'));
          assert.deepEqual(persisted.Environment, { ...safeOverrides, GG_LOG_LEVEL: level });
          assert.equal(persisted.Port, port);
          assert.equal(persisted.DataDir, store);
          assert.match(persisted.LauncherAppUserModelId, /^GraphGoblin\.[a-f0-9]{24}$/);
          await assertLauncherLinks(reinstallLinks, reinstallExe, persisted);
          installed.push(persisted);
          assert.deepEqual(await sourceState(), sourceStateBefore);
          assert.deepEqual(await readdir(store), []);
          await assertNoStages([...reinstallFolders, reinstallDir]);
        }
        // Only the explicitly changed setting differs; the launcher identity is stable.
        assert.equal(installed[1].LauncherAppUserModelId, installed[0].LauncherAppUserModelId);
        assert.deepEqual(
          { ...installed[1], Environment: null },
          { ...installed[0], Environment: null },
        );
        assert.notDeepEqual(await readFile(reinstallPinned), seededPin);
      },
    );

    await t.test(
      'a later output held with read-only sharing restores every previous file',
      async () => {
        const outputsBefore = await outputState(reinstallOutputs);
        // Identity and hash reads still succeed; replacing or deleting the Programs link does not.
        const holder = holdWithSharing(reinstallPrograms, 'Read');
        let refusal;
        let released;
        let stages;
        try {
          await holder.ready;
          stages = await observeStages(async () => {
            refusal = await refused(
              invoke(reinstallOptions('info')),
              'A denied replacement must refuse the installation.',
            );
          });
        } finally {
          released = await holder.release();
        }
        assert.ok(released.result, 'The read-sharing holder must exit normally after release.');
        assert.equal(released.result.stdout.trim(), 'held');
        assertRefusal(refusal, 'Launcher publication failed. The previous files were restored.');
        assert.ok(stages.length > 0, 'The restored installation must exercise its stages.');
        assert.deepEqual(await outputState(reinstallOutputs), outputsBefore);
        assert.deepEqual(await sourceState(), sourceStateBefore);
        assert.deepEqual(await readdir(store), []);
        await assertNoStages([...reinstallFolders, reinstallDir]);
      },
    );

    const resourceRefusals = ['CS1567', 'CS1619'].map(
      (code) =>
        `Launcher compilation failed while the .NET Framework C# compiler prepared the launcher's Win32 resources (compiler error ${code}). The installer compiles in a temporary gg-launcher-stage folder inside the install folder, or its nearest existing parent, and that staging path may be too long for this compiler. Choose a shorter writable local folder with -InstallDir, then run the installer again.`,
    );
    await t.test(
      'long staging paths refuse compilation with InstallDir guidance and keep installed files',
      async () => {
        // Fixture geometry, not a product rule: an existing 174-character InstallDir gives a
        // 241-character staged executable, which the .NET Framework compiler was observed to
        // refuse during resource preparation. The installer itself has no path-length limit.
        const geometry = 174;
        const canonicalBase = await realpath(base);
        const longName = (parent) => {
          const length = geometry - join(canonicalBase, parent).length - 1;
          assert.ok(length >= 16 && length <= 200, 'The checkout leaves no room for the fixture.');
          return `long install ${'x'.repeat(length)}`.slice(0, length);
        };
        // Watcher names are relative to the fixture root: the folder that received each stage.
        const stagedIn = (stages) =>
          new Set(
            stages
              .map((name) => dirname(name))
              .filter((folder) => !folder.includes('gg-launcher-stage-')),
          );

        // A fresh install into the existing long folder stages there and is refused.
        const freshName = longName('long fresh');
        const longFresh = join(canonicalBase, 'long fresh', freshName);
        await mkdir(longFresh, { recursive: true });
        assert.equal((await realpath(longFresh)).length, geometry);
        const freshFolders = ['Desktop', 'Programs'].map((folder) =>
          join(base, 'long fresh links', folder),
        );
        for (const folder of freshFolders) await mkdir(folder, { recursive: true });
        let freshRefusal;
        const freshStages = await observeStages(async () => {
          freshRefusal = await refused(
            invoke({
              InstallDir: longFresh,
              DesktopShortcut: join(freshFolders[0], 'GraphGoblin.lnk'),
              StartMenuShortcut: join(freshFolders[1], 'GraphGoblin.lnk'),
              Environment: safeOverrides,
            }),
            'A long fresh staging path must be refused.',
          );
        });
        assertRefusal(freshRefusal, ...resourceRefusals);
        assert.deepEqual([...stagedIn(freshStages)], [join('long fresh', freshName)]);
        for (const folder of [longFresh, ...freshFolders])
          assert.deepEqual(await readdir(folder), []);

        // While the same long folder is absent, staging uses its shorter existing parent.
        const lowerAnchor = join(canonicalBase, 'long reinstall');
        await mkdir(lowerAnchor);
        const installName = longName('long reinstall');
        const longInstall = join(lowerAnchor, installName);
        const longExe = join(longInstall, 'GraphGoblin.exe');
        const longLinks = ['Desktop', 'Programs', 'Pinned'].map((folder) =>
          join(base, 'long reinstall links', folder, 'GraphGoblin.lnk'),
        );
        for (const link of longLinks) await mkdir(dirname(link), { recursive: true });
        await copyFile(pinnedSeed, longLinks[2]);
        const longOptions = (level) => ({
          InstallDir: longInstall,
          DesktopShortcut: longLinks[0],
          StartMenuShortcut: longLinks[1],
          PinnedShortcut: longLinks[2],
          Environment: { ...safeOverrides, GG_LOG_LEVEL: level },
        });
        let first;
        const firstStages = stagedIn(
          await observeStages(async () => {
            first = await invoke(longOptions('warn'));
          }),
        );
        assert.equal(errorText(first.stderr), '');
        assert.ok(firstStages.has('long reinstall'), 'The first install stages in the parent.');
        assert.ok(!firstStages.has(join('long reinstall', installName)));
        assert.equal((await realpath(longInstall)).length, geometry);
        const longOutputs = [longExe, longExe + '.json', ...longLinks];
        const installed = await outputState(longOutputs);
        assert.equal(JSON.parse(installed[1].bytes).Environment.GG_LOG_LEVEL, 'warn');

        // Once it exists, the same-path reinstall stages inside it and is refused safely.
        let reinstallRefusal;
        const reinstallStages = await observeStages(async () => {
          reinstallRefusal = await refused(
            invoke(longOptions('debug')),
            'A long same-path reinstall must be refused.',
          );
        });
        assertRefusal(reinstallRefusal, ...resourceRefusals);
        assert.deepEqual([...stagedIn(reinstallStages)], [join('long reinstall', installName)]);
        assert.deepEqual(await outputState(longOutputs), installed);
        assert.deepEqual((await readdir(longInstall)).sort(), [
          'GraphGoblin.exe',
          'GraphGoblin.exe.json',
        ]);
        await assertNoStages([lowerAnchor, ...longLinks.map((link) => dirname(link))]);
        assert.deepEqual(await sourceState(), sourceStateBefore);
        assert.deepEqual(await readdir(store), []);
      },
    );

    await t.test('a non-resource compiler failure keeps the generic redacted refusal', async () => {
      // Every compiler line names this path, which carries the private canary and partial codes
      // that are not diagnostics. The first source's diagnostic quotes the decoy type name
      // 'CS1619'. The second fails with an actual CS1029 whose #error message contains a later
      // 'error CS1619:', which is not the line's diagnostic field.
      const compileRepo = join(base, 'GG_INSTALLER_PRIVATE_PATH_CANARY CS15670 CS1619 repo');
      for (const file of [
        'apps/api/dist/main.js',
        'apps/api/dist/instance-identity.js',
        'apps/api/dist/windows-log/guard.js',
        'apps/web/dist/index.html',
      ]) {
        await mkdir(dirname(join(compileRepo, file)), { recursive: true });
        await writeFile(join(compileRepo, file), '// compiler failure control only\n');
      }
      await mkdir(join(compileRepo, 'apps/windows-launcher'));
      for (const program of [
        'class CompilerControl { CS1619 field; }\n',
        '#error error CS1619: unrelated compiler failure\n',
      ]) {
        await writeFile(join(compileRepo, 'apps/windows-launcher/Launcher.cs'), program);
        const refusal = await refused(
          invoke({ RepoPath: compileRepo }),
          'A compiler failure must refuse the installation.',
        );
        assert.equal(refusal.code, 1);
        const text = errorText(refusal.stderr);
        assert.match(text, /^Launcher compilation failed\.\r?$/m);
        assert.doesNotMatch(text, /Win32 resources|-InstallDir|CS1567|CS1619/);
        for (const output of [refusal.stdout, refusal.stderr, text]) {
          assert.doesNotMatch(output, /GG_INSTALLER_PRIVATE_PATH_CANARY/);
          assert.ok(!output.includes(secretCanary));
        }
        assert.deepEqual(await snapshot(), before);
        assert.deepEqual(await readdir(store), []);
        await assertNoStages([install, dirname(desktop), dirname(programs)]);
      }
    });

    // #520: the shipped script binds its own zero-argument defaults in a hidden, no-profile child.
    // Checkout, project Node PATH, APPDATA/LOCALAPPDATA, GG_DATA_DIR and TEMP/TMP are fixture
    // values, and a test-only, process-local TypeAccelerators entry answers the script's two
    // [Environment]::GetFolderPath lookups with fixture Desktop and Programs folders. This proves
    // default binding and source selection with an isolated resolver, not how Windows resolves
    // any account's redirected folders. The fixture refuses before the installer on any doubt.
    const confinedDefaults = `$ErrorActionPreference = 'Stop'
      Set-StrictMode -Version Latest
      class GraphGoblinFixtureFolders {
        static [string] $Desktop
        static [string] $Programs
        static [string] GetFolderPath([string] $Folder) {
          if ($Folder -ceq 'Desktop') { return [GraphGoblinFixtureFolders]::Desktop }
          if ($Folder -ceq 'Programs') { return [GraphGoblinFixtureFolders]::Programs }
          throw [NotSupportedException]::new('The fixture folder resolver supports only Desktop and Programs.')
        }
      }
      function Stop-Fixture([string] $Reason) { throw "Fixture refused before the installer ran: $Reason." }
      # Registered before anything parses the installer: parsing resolves its type names, and the
      # process then keeps a resolved [Environment] for every later script block.
      $accelerators = [psobject].Assembly.GetType('System.Management.Automation.TypeAccelerators', $true)
      if ($accelerators::Get.ContainsKey('Environment')) { Stop-Fixture 'an Environment accelerator already exists' }
      $accelerators::Add('Environment', [GraphGoblinFixtureFolders])
      $request = $env:GG_INSTALLER_FIXTURE | ConvertFrom-Json
      [GraphGoblinFixtureFolders]::Desktop = $request.Desktop
      [GraphGoblinFixtureFolders]::Programs = $request.Programs
      $env:PATH = $request.path
      $env:APPDATA = $request.appData
      $env:LOCALAPPDATA = $request.localAppData
      $env:GG_DATA_DIR = $request.dataDir
      $env:TEMP = $request.temp
      $env:TMP = $request.temp
      $text = [IO.File]::ReadAllText($request.installer)
      if ([regex]::Matches($text, 'GetFolderPath|SpecialFolder|System\\.Environment|TypeAccelerators', 'IgnoreCase').Count -ne 2) {
        Stop-Fixture 'the installer folder lookups changed'
      }
      $tokens = $null
      $parseErrors = $null
      $ast = [Management.Automation.Language.Parser]::ParseFile($request.installer, [ref] $tokens, [ref] $parseErrors)
      if ($parseErrors.Count -ne 0) { Stop-Fixture 'the installer did not parse' }
      $typed = @($ast.FindAll({
        param($node)
        ($node -is [Management.Automation.Language.TypeExpressionAst] -or
          $node -is [Management.Automation.Language.TypeConstraintAst] -or
          $node -is [Management.Automation.Language.AttributeAst]) -and
        $node.TypeName.FullName -match '(?:^|\\W)Environment(?:$|\\W)'
      }, $true))
      $lookups = @(foreach ($node in $typed) {
        $call = $node.Parent
        if ($node -isnot [Management.Automation.Language.TypeExpressionAst] -or
          $node.TypeName.FullName -cne 'Environment' -or
          $call -isnot [Management.Automation.Language.InvokeMemberExpressionAst] -or
          !$call.Static -or ![object]::ReferenceEquals($call.Expression, $node) -or
          $call.Member -isnot [Management.Automation.Language.StringConstantExpressionAst] -or
          $call.Member.Value -cne 'GetFolderPath' -or $null -eq $call.Arguments -or
          $call.Arguments.Count -ne 1 -or
          $call.Arguments[0] -isnot [Management.Automation.Language.StringConstantExpressionAst]) {
          Stop-Fixture 'the installer has an unsupported Environment use'
        }
        $call.Arguments[0].Value
      })
      if (($lookups -join ',') -cne 'Desktop,Programs') { Stop-Fixture 'the installer folder lookups changed' }
      if ((& ([scriptblock]::Create('[Environment]'))) -ne [GraphGoblinFixtureFolders]) {
        Stop-Fixture 'Environment does not resolve to the fixture folder resolver'
      }
      foreach ($folder in 'Desktop', 'Programs') {
        if ((& ([scriptblock]::Create("[Environment]::GetFolderPath('$folder')"))) -cne $request.$folder) {
          Stop-Fixture "the $folder lookup does not resolve to its fixture folder"
        }
      }
      $unsupported = $false
      try {
        [void](& ([scriptblock]::Create("[Environment]::GetFolderPath('ApplicationData')")))
        $unsupported = $true
      } catch { }
      if ($unsupported) { Stop-Fixture 'the resolver answered an unsupported folder' }
      & $request.installer`;
    async function defaultsFixture(name) {
      const folder = join(base, name);
      const appData = join(folder, 'AppData', 'Roaming');
      const folders = {
        Desktop: join(folder, 'Desktop'),
        Programs: join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
        appData,
        localAppData: join(folder, 'AppData', 'Local'),
        dataDir: join(folder, 'store'),
        temp: join(folder, 'Temp'),
      };
      for (const path of Object.values(folders)) await mkdir(path, { recursive: true });
      return folders;
    }
    const invokeDefaults = (folders) =>
      runPowerShell(
        confinedDefaults,
        { installer, path: nodeAvailablePath, ...folders },
        {
          APPDATA: folders.appData,
          LOCALAPPDATA: folders.localAppData,
          GG_DATA_DIR: folders.dataDir,
          TEMP: folders.temp,
          TMP: folders.temp,
        },
      );
    const launcherFolders = (folders) => {
      const installDir = join(folders.localAppData, 'GraphGoblin', 'Launcher');
      return { installDir, launcher: join(installDir, 'GraphGoblin.exe') };
    };

    await t.test(
      'zero-argument defaults select the Chrome Apps source and publish separate Desktop and Programs links',
      async () => {
        const folders = await defaultsFixture('defaults chrome apps');
        const chromeApps = join(folders.Programs, 'Chrome Apps');
        await mkdir(chromeApps);
        const pwa = join(chromeApps, 'GraphGoblin.lnk');
        await copyFile(defaultSource, pwa);
        const pwaBefore = await outputState([pwa]);
        const result = await invokeDefaults(folders);
        assert.equal(errorText(result.stderr), '');
        assert.match(result.stdout, /Launcher configured\./);
        assert.match(result.stdout, /Gateway: http:\/\/127\.0\.0\.1:4747\/app\//);
        const { installDir, launcher } = launcherFolders(folders);
        const persisted = JSON.parse(await readFile(launcher + '.json', 'utf8'));
        assert.equal(persisted.Repo, dirname(dirname(installer)));
        assert.equal(persisted.Node, await realpath(process.execPath));
        assert.equal(persisted.DataDir, folders.dataDir);
        assert.equal(persisted.Port, 4747);
        assert.equal(persisted.ChromeAppId, defaultChromeId);
        assert.equal(persisted.PwaAppUserModelId, 'Chrome.PwaFixture');
        assert.deepEqual(persisted.Environment, {});
        const links = [
          join(folders.Desktop, 'GraphGoblin.lnk'),
          join(folders.Programs, 'GraphGoblin.lnk'),
        ];
        await assertLauncherLinks(links, launcher, persisted);
        const [desktopLink, programsLink] = await outputState(links);
        assert.ok(
          desktopLink.dev !== programsLink.dev || desktopLink.ino !== programsLink.ino,
          'Desktop and Programs links must be separate files.',
        );
        assert.deepEqual(await outputState([pwa]), pwaBefore);
        assert.deepEqual(await readdir(folders.dataDir), []);
        await assertNoStages([
          folders.localAppData,
          dirname(installDir),
          installDir,
          folders.Desktop,
          folders.Programs,
          chromeApps,
        ]);
      },
    );

    await t.test(
      'a Desktop-only default source collides with the Desktop output and keeps sentinels',
      async () => {
        const folders = await defaultsFixture('defaults desktop source');
        const pwa = join(folders.Desktop, 'GraphGoblin.lnk');
        await copyFile(defaultSource, pwa);
        const { installDir, launcher } = launcherFolders(folders);
        await mkdir(installDir, { recursive: true });
        const sentinels = [launcher, launcher + '.json', join(folders.Programs, 'GraphGoblin.lnk')];
        for (const sentinel of sentinels) await writeFile(sentinel, `sentinel ${randomUUID()}\n`);
        const watched = [pwa, ...sentinels];
        const before = await outputState(watched);
        const refusal = await refused(
          invokeDefaults(folders),
          'A Desktop-only source must collide with the Desktop output.',
        );
        assertRefusal(
          refusal,
          'The PWA source and launcher outputs must use distinct files and paths. Choose a separate shortcut destination.',
        );
        assert.deepEqual(await outputState(watched), before);
        assert.deepEqual(await readdir(folders.Desktop), ['GraphGoblin.lnk']);
        assert.deepEqual(await readdir(folders.Programs), ['GraphGoblin.lnk']);
        assert.deepEqual((await readdir(installDir)).sort(), [
          'GraphGoblin.exe',
          'GraphGoblin.exe.json',
        ]);
        assert.deepEqual(await readdir(folders.dataDir), []);
        await assertNoStages([folders.localAppData, dirname(installDir)]);
      },
    );

    await t.test('without a default source no destination or stage is published', async () => {
      const folders = await defaultsFixture('defaults missing source');
      await mkdir(join(folders.Programs, 'Chrome Apps'));
      const refusal = await refused(
        invokeDefaults(folders),
        'A missing default source must be refused.',
      );
      assertRefusal(
        refusal,
        'Install the Chrome PWA, then supply -PwaShortcut with its .lnk path.',
      );
      assert.deepEqual(await readdir(folders.Desktop), []);
      assert.deepEqual(await readdir(folders.Programs), ['Chrome Apps']);
      assert.deepEqual(await readdir(join(folders.Programs, 'Chrome Apps')), []);
      assert.deepEqual(await readdir(folders.localAppData), []);
      assert.deepEqual(await readdir(folders.dataDir), []);
    });

    // #499: a leaf observed as a reparse point is refused. Genuine file symbolic links witness it;
    // creating one needs a venue that already permits it, such as the hosted Windows runner, and
    // the fixture never grants itself that right. Cloud placeholders belong to native CFAPI QA.
    const unsupportedSource =
      'The PWA shortcut is a link or other reparse point, which the installer does not support; files in cloud-synced folders can be reparse points. Copy the Chrome PWA shortcut to an ordinary local folder that is not synced, pass that copy with -PwaShortcut, then run the installer again.';
    const unsupportedOutput = (parameter) =>
      `An existing launcher output selected by ${parameter} is a link or other reparse point, which the installer does not replace; files in cloud-synced folders can be reparse points. Choose an ordinary local path that is not synced with ${parameter}, then run the installer again.`;
    /** Creates a file symbolic link and confirms Windows reports it as a visible reparse point. */
    async function visibleFileLink(target, path) {
      await symlink(target, path, 'file');
      const created = await lstat(path, { bigint: true });
      assert.ok(created.isSymbolicLink(), 'The fixture must be a genuine file symbolic link.');
      assert.equal(await realpath(path), await realpath(target));
      const observed = await nativeObservation(
        `
        $item = Get-Item -LiteralPath $env:GG_TEST_FILE_LINK -Force;
        [pscustomobject]@{
          linkType = $item.LinkType
          directory = [bool]($item.Attributes -band [IO.FileAttributes]::Directory)
          reparsePoint = [bool]($item.Attributes -band [IO.FileAttributes]::ReparsePoint)
        } | ConvertTo-Json -Compress
      `,
        { GG_TEST_FILE_LINK: path },
      );
      assert.ok(['SymbolicLink', 'SymLink'].includes(observed.linkType));
      assert.deepEqual(
        { directory: observed.directory, reparsePoint: observed.reparsePoint },
        { directory: false, reparsePoint: true },
        'Windows must report the fixture leaf as a visible file reparse point.',
      );
      return created;
    }
    /**
     * Another process holds `target` without sharing while the installer runs. Its zero-access
     * identity read still succeeds, but a digest or shortcut read would fail with another refusal.
     */
    async function refusedWhileUnshared(target, overrides, message) {
      const holder = holdWithSharing(target, 'None');
      let refusal;
      let stages;
      let released;
      try {
        await holder.ready;
        stages = await observeStages(async () => {
          refusal = await refused(invoke(overrides), message);
        });
      } finally {
        released = await holder.release();
      }
      assert.ok(released.result, 'The unshared holder must exit normally after release.');
      assert.equal(released.result.stdout.trim(), 'held');
      assert.deepEqual(stages, [], 'A reparse-point refusal must precede every stage.');
      return refusal;
    }

    await t.test(
      'a PWA source or existing output observed as a reparse point is refused before its digest',
      async () => {
        const links = join(base, 'reparse links');
        await mkdir(links);
        const linkedSource = join(links, 'linked source.lnk');
        const sourceLink = await visibleFileLink(source, linkedSource);
        // -NoShortcuts publishes only the launcher and config but still needs an ordinary source.
        for (const NoShortcuts of [false, true]) {
          assertRefusal(
            await refusedWhileUnshared(
              source,
              { PwaShortcut: linkedSource, NoShortcuts },
              'A linked PWA source must be refused.',
            ),
            unsupportedSource,
          );
        }
        // Collision priority is unchanged: an output link to the source names the source's file.
        assertRefusal(
          await refused(
            invoke({ DesktopShortcut: linkedSource }),
            'An output link to the source must collide with it.',
          ),
          'The PWA source and launcher outputs must use distinct files and paths. Choose a separate shortcut destination.',
        );
        const outputTarget = join(links, 'output target.lnk');
        await copyFile(pinnedSeed, outputTarget);
        const outputLink = join(links, 'linked output.lnk');
        const outputLinkState = await visibleFileLink(outputTarget, outputLink);
        const outputTargetBefore = await outputState([outputTarget]);
        for (const [parameter, overrides] of [
          ['-DesktopShortcut', { DesktopShortcut: outputLink }],
          ['-PinnedShortcut', { PinnedShortcut: outputLink }],
        ]) {
          assertRefusal(
            await refusedWhileUnshared(outputTarget, overrides, 'A linked output must be refused.'),
            unsupportedOutput(parameter),
          );
        }
        assert.deepEqual(await outputState([outputTarget]), outputTargetBefore);
        assert.ok(sameFile(await lstat(outputLink, { bigint: true }), outputLinkState));
        assert.ok(sameFile(await lstat(linkedSource, { bigint: true }), sourceLink));
        assert.deepEqual(await snapshot(), before);
        assert.deepEqual(await sourceState(), sourceStateBefore);
        assert.deepEqual(await readdir(store), []);
        await assertNoStages([install, dirname(desktop), dirname(programs), links]);
      },
    );

    await t.test(
      'the late source check re-observes the original selected lexical leaf as a link to the same target',
      async () => {
        // Once preparation stages, the junction is retargeted so the selected leaf becomes a file
        // link to the same previously accepted target; the refusal shows that leaf was observed
        // again. The target stays readable and identical, so this case cannot show whether the
        // digest ran first: the installer source shows that ordering, and the early no-sharing
        // cases are the separate evidence of refusal before content reads.
        const late = join(base, 'late source');
        const original = join(late, 'original');
        const relinked = join(late, 'relinked');
        const selected = join(late, 'selected');
        await mkdir(original, { recursive: true });
        await mkdir(relinked);
        const lateTarget = join(original, 'GraphGoblin.lnk');
        await copyFile(source, lateTarget);
        await visibleFileLink(lateTarget, join(relinked, 'GraphGoblin.lnk'));
        await symlink(original, selected, 'junction');
        const lateInstall = join(late, 'install');
        await mkdir(lateInstall);
        const lateExe = join(lateInstall, 'GraphGoblin.exe');
        const lateOptions = {
          PwaShortcut: join(selected, 'GraphGoblin.lnk'),
          InstallDir: lateInstall,
          NoShortcuts: true,
          Environment: safeOverrides,
        };
        // An ordinary leaf through its validated junction path still installs.
        const result = await invoke(lateOptions);
        assert.equal(errorText(result.stderr), '');
        assert.match(result.stdout, /Launcher configured\./);
        assert.equal(
          JSON.parse(await readFile(lateExe + '.json', 'utf8')).PwaAppUserModelId,
          'Chrome.PwaFixture',
        );
        const installed = await outputState([lateExe, lateExe + '.json']);
        const targetBefore = await outputState([lateTarget]);
        let swapping;
        let watchFailure;
        const observer = watch(lateInstall, (_event, name) => {
          if (swapping || !name?.startsWith('gg-launcher-stage-')) return;
          swapping = unlink(selected).then(() => symlink(relinked, selected, 'junction'));
          swapping.catch(() => {});
        });
        observer.on('error', (error) => (watchFailure = error));
        let refusal;
        try {
          refusal = await refused(
            invoke(lateOptions),
            'A selected leaf replaced by a link must be refused.',
          );
        } finally {
          observer.close();
        }
        if (watchFailure) throw watchFailure;
        assert.ok(swapping, 'Preparation must stage before the late source check.');
        await swapping;
        assert.equal(await realpath(selected), await realpath(relinked));
        assertRefusal(refusal, unsupportedSource);
        assert.deepEqual(await outputState([lateExe, lateExe + '.json']), installed);
        assert.deepEqual(await outputState([lateTarget]), targetBefore);
        assert.deepEqual((await readdir(lateInstall)).sort(), [
          'GraphGoblin.exe',
          'GraphGoblin.exe.json',
        ]);
        assert.deepEqual(await sourceState(), sourceStateBefore);
        assert.deepEqual(await readdir(store), []);
      },
    );

    try {
      const started = await execute(exe, ['--ensure-gateway', '--config', configPath], {
        env: {
          ...env,
          GG_MASTER_KEY: secretCanary,
          GG_JEV_API_KEY: secretCanary,
          GG_LOG_LEVEL: 'invalid-inherited-value',
          GG_MAX_CONCURRENT_RUNS: 'invalid-inherited-value',
        },
        windowsHide: true,
        timeout: 30_000,
      });
      assert.deepEqual([started.stdout, started.stderr], ['', '']);
      assert.equal((await health(config)).launch, config.Enrollment.Launch);
      await access(join(store, 'master.key'));
      const response = await fetch(origin(config) + '/secrets');
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { items: [] });
      assert.deepEqual(await readFile(source), sourceBefore);
      assert.deepEqual(await snapshot(), before);
      assert.ok(!(await readFile(join(install, 'gateway.log'), 'utf8')).includes(secretCanary));
    } finally {
      await stop(config);
    }
  }),
);

test(
  'native Windows launcher readiness, reuse, races, refusals, detached lifetime and shell route',
  { skip: process.platform !== 'win32', timeout: 420_000 },
  ciEvidence.observeTest('launcher', async (t) => {
    await mkdir(join(root, '.tmp'), { recursive: true });
    const base = await mkdtemp(join(root, '.tmp', 'windows-launcher-'));
    ciEvidence.fixture('launcher', base);
    const install = join(base, 'launcher space-α');
    await privateDirectory(install);
    const exe = join(install, 'GraphGoblin.exe');
    const compiler = join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
    await compileLauncher(compiler, exe);
    const checks = join(install, 'NativeChecks.exe');
    await compileChecks(compiler, checks);
    async function configuration(name, overrides = {}) {
      const config = {
        Repo: root,
        Node: process.execPath,
        DataDir: join(base, name),
        // Explicit ports keep the shared 20-port pool for cases that need a fresh one.
        Port: overrides.Port ?? (await freePort()),
        LauncherAppUserModelId: 'GraphGoblin.NativeAcceptance',
        StartupTimeoutSeconds: 15,
        WindowTimeoutSeconds: 2,
        ...overrides,
        // The scoped provider disable survives every case's own Environment override.
        Environment: { GG_LOG_LEVEL: 'info', ...overrides.Environment, ...providerFree },
      };
      // The launcher strips inherited GG_* names, so these overrides are the gateway's final ones.
      assertProviderFree(config.Environment);
      const path = join(install, name + '.json');
      return { config: await enroll(exe, path, config), path };
    }
    const launch = (path) => launchNative(exe, path);
    const first = await configuration('primary');
    await t.test(
      'concurrent cold starts create one gateway and later clicks reuse its PID',
      async () => {
        const clicks = await Promise.all(Array.from({ length: 4 }, () => launch(first.path)));
        // Successful clicks are quiet; the gateway's own stdio is NUL, never a caller pipe.
        for (const click of clicks) assert.deepEqual([click.stdout, click.stderr], ['', '']);
        const before = await health(first.config);
        assert.match(before.identity, /^[a-f0-9]{64}$/);
        // The published launch digest is the installed enrollment's, bound to these inputs.
        assert.equal(before.launch, first.config.Enrollment.Launch);
        assert.equal(first.config.Enrollment.Inputs, gatewayInputsDigest(first.config));
        assert.equal(
          String(
            JSON.parse(await readFile(join(first.config.DataDir, 'graphgoblin.lock'), 'utf8')).pid,
          ),
          before.pid,
        );
        await launch(first.path);
        assert.deepEqual(await health(first.config), before);
        process.kill(Number(before.pid), 0); // launchers have exited; gateway and its log remain independent.
        const records = logRecords(await readFile(join(install, 'gateway.log'), 'utf8'));
        assert.ok(
          records.some(
            (record) =>
              record.msg === 'GraphGoblin API listening' && String(record.pid) === before.pid,
          ),
        );
        // Managed access records carry method, route template and status only.
        for (const record of records.filter((entry) => entry.req || entry.res))
          for (const key of Object.keys(record.req ?? record.res))
            assert.ok(['method', 'route', 'statusCode'].includes(key), `access field ${key}`);
        await assert.rejects(lstat(join(install, 'launcher.log')), { code: 'ENOENT' });
      },
    );
    try {
      await t.test(
        'wrong store and changed gateway settings are refused without stopping the live gateway',
        async () => {
          const before = await health(first.config);
          for (const overrides of [
            { DataDir: join(base, 'wrong-store') },
            { Environment: { GG_REQUIRE_API_KEY: 'true' } },
            { Environment: { GG_DB_URL: 'file:' + join(base, 'wrong.db').replaceAll('\\', '/') } },
          ]) {
            const wrong = await configuration('mismatch', { ...first.config, ...overrides });
            await assert.rejects(launch(wrong.path), /differently configured service/);
            assert.deepEqual(await health(first.config), before);
          }
        },
      );
      await t.test(
        'same database under a different data directory cannot acquire a second gateway',
        async () => {
          const shared = await configuration('shared', {
            StartupTimeoutSeconds: 1,
            Environment: {
              GG_DB_URL:
                'file:' + join(first.config.DataDir, 'graphgoblin.db').replaceAll('\\', '/'),
            },
          });
          await assert.rejects(
            launch(shared.path),
            /another GraphGoblin process holds this store; check its port\/configuration/,
          );
          await health(first.config);
        },
      );
      await t.test(
        'warm reuse needs no runtime, checkout files or startup mutex, and edits need re-enrollment (#566)',
        { timeout: 120_000 },
        async (t) => {
          const before = await health(first.config);
          const aliases = join(base, 'warm aliases');
          await mkdir(aliases);
          const checkout = join(aliases, 'checkout');
          const runtime = join(aliases, 'runtime');
          await symlink(root, checkout, 'junction');
          await symlink(dirname(process.execPath), runtime, 'junction');
          let linked = true;
          try {
            const warm = await configuration('warm-aliases', {
              ...first.config,
              Repo: checkout,
              Node: join(runtime, basename(process.execPath)),
            });
            // Another runtime path and checkout spelling keep the launch digest, not the inputs.
            assert.equal(warm.config.Enrollment.Launch, first.config.Enrollment.Launch);
            assert.notEqual(warm.config.Enrollment.Inputs, first.config.Enrollment.Inputs);
            await unlink(checkout);
            await unlink(runtime);
            linked = false;
            const holder = await holdLaunchMutexes(checks, first.config, t.signal);
            try {
              const started = performance.now();
              const reused = await launch(warm.path);
              assert.deepEqual([reused.stdout, reused.stderr], ['', '']);
              assert.ok(performance.now() - started < 10_000, 'Warm reuse waited for a mutex.');
              assert.deepEqual(await health(first.config), before);
            } finally {
              await holder.release();
            }
            const edited = { ...warm.config, DataDir: join(base, 'edited-store') };
            await writeFile(warm.path, JSON.stringify(edited));
            await assert.rejects(
              launch(warm.path),
              /not enrolled for its current Repo, Node, DataDir, Port and GG_\* overrides/,
            );
            assert.deepEqual(await health(first.config), before);
            await assert.rejects(lstat(edited.DataDir), { code: 'ENOENT' });
          } finally {
            if (linked) {
              await unlink(checkout).catch(() => undefined);
              await unlink(runtime).catch(() => undefined);
            }
          }
        },
      );
      await t.test(
        'normal drain releases ownership and a shell shortcut cold start runs the launcher',
        async () => {
          const before = await health(first.config);
          await stop(first.config);
          const shortcut = join(install, 'GraphGoblin native route.lnk');
          await execute(
            exe,
            ['--config', first.path, '--ensure-gateway', '--create-shortcut', shortcut],
            { env, windowsHide: true },
          );
          assert.equal(
            (
              await execute(exe, ['--read-shortcut-id', shortcut], { env, windowsHide: true })
            ).stdout.trim(),
            first.config.LauncherAppUserModelId,
          );
          const inspected = JSON.parse(
            (await execute(exe, ['--inspect-shortcut', shortcut], { env, windowsHide: true }))
              .stdout,
          );
          assert.equal(inspected.TargetPath, exe);
          assert.ok(inspected.Arguments.includes(first.path));
          // Start-Process -Wait waits the whole tree, including the deliberately persistent gateway.
          const ps =
            "$click = Start-Process -FilePath $env:GG_TEST_LINK -PassThru -WindowStyle Hidden; if (!$click.WaitForExit(25000)) { throw 'Launcher did not exit' }; if ($click.ExitCode -ne 0) { throw 'Launcher failed' }";
          await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
            env: { ...env, GG_TEST_LINK: shortcut, GG_TEST_EXE: exe, GG_TEST_CONFIG: first.path },
            windowsHide: true,
            timeout: 30_000,
          });
          const after = await health(first.config);
          assert.notEqual(after.pid, before.pid);
          console.log(
            JSON.stringify({
              evidence: 'native-shell-shortcut-cold-route',
              beforePid: before.pid,
              afterPid: after.pid,
            }),
          );
        },
      );
      await t.test(
        'native HWND COM relaunch command preserves the cold launcher route',
        async () => {
          await stop(first.config);
          const result = await execute(checks, [exe, first.path], {
            env,
            windowsHide: true,
            timeout: 30_000,
          });
          assert.match(result.stdout, /HWND COM\/relaunch route checks passed/);
          await health(first.config);
        },
      );
      await t.test('cross-process HWND metadata survives stamper exit and relaunches', async () => {
        await stop(first.config);
        const handleFile = join(install, 'fixture-window.txt');
        const fixture = spawn(checks, ['--window-fixture', handleFile], {
          env,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        const exited = new Promise((resolve) => fixture.once('exit', resolve));
        let handle;
        let closed;
        try {
          for (let attempt = 0; attempt < 100; attempt++) {
            try {
              handle = (await readFile(handleFile, 'utf8')).trim();
              if (handle) break;
            } catch {
              /* fixture is still creating its HWND */
            }
            await sleep(50);
          }
          assert.match(handle, /^\d+$/);
          await execute(checks, ['--stamp-window', handle, exe, first.path], {
            env,
            windowsHide: true,
            timeout: 10_000,
          });
          // A new process reads/exercises the native metadata only after the stamper exited.
          const result = await execute(checks, ['--relaunch-window', handle], {
            env,
            windowsHide: true,
            timeout: 30_000,
          });
          assert.match(result.stdout, /metadata survived stamper exit/);
          await health(first.config);
        } finally {
          if (handle) await execute(checks, ['--close-window', handle], { env, windowsHide: true });
          closed = await Promise.race([exited.then(() => true), sleep(5000).then(() => false)]);
          if (!closed) {
            fixture.kill();
          }
          ciEvidence.record('cleanup', {
            action: 'window-fixture',
            result: closed ? 'closed' : 'killed',
            count: null,
          });
        }
        assert.equal(closed, true, 'Disposable native HWND fixture did not close.');
      });
    } finally {
      await stop(first.config);
    }
    // One disposable port reused in sequence; each case stops its own gateway.
    const scratchPort = await freePort();
    await t.test('a matching manual start is reused without a spawn (#566)', async () => {
      const manual = await configuration('manual', { Port: scratchPort });
      let started;
      try {
        started = await manualGateway(manual.config);
        const { running } = started;
        assert.equal(running.launch, manual.config.Enrollment.Launch);
        const reused = await launch(manual.path);
        assert.deepEqual([reused.stdout, reused.stderr], ['', '']);
        assert.deepEqual(await health(manual.config), running);
      } finally {
        // Only the verified owner is drained; an unverified start was settled by its own handle.
        if (started) await releaseAliasGateway(manual, started.running.identity, started.owner);
      }
    });
    await t.test(
      'an inconclusive warm probe is re-probed under the startup locks (#566)',
      { timeout: 120_000 },
      async (t) => {
        const transient = await configuration('transient', { Port: scratchPort });
        const holder = await holdLaunchMutexes(checks, transient.config, t.signal);
        let listener;
        let click;
        let started;
        try {
          listener = await silentListener(scratchPort);
          click = pendingClick(launch(transient.path));
          // The lock-free /healthz probe went unanswered and closed; the click waits for the locks.
          await listener.probedBefore(click.result, t.signal);
          await listener.close();
          console.log(
            JSON.stringify({ evidence: 'windows-launcher-warm-probe', ...listener.seen }),
          );
          listener = undefined;
          started = await manualGateway(transient.config);
          const { running } = started;
          await holder.release();
          const result = await bounded(click.result, 45_000, 'The locked re-probe click', t.signal);
          assert.deepEqual([result.code, result.stdout, result.stderr], [0, '', '']);
          assert.deepEqual(await health(transient.config), running);
        } finally {
          await listener?.close();
          // A click still waiting is stopped first, so releasing the locks cannot start a gateway.
          await click?.abandon().catch(() => undefined);
          await holder.release();
          if (started)
            await releaseAliasGateway(transient, started.running.identity, started.owner);
        }
      },
    );
    await t.test(
      'a configuration edited or removed during the lock wait is refused (#566)',
      { timeout: 120_000 },
      async (t) => {
        for (const change of ['edited', 'removed']) {
          const waiting = await configuration(`waiting-${change}`, { Port: scratchPort });
          const holder = await holdLaunchMutexes(checks, waiting.config, t.signal);
          let listener;
          let click;
          try {
            listener = await silentListener(scratchPort);
            click = pendingClick(launch(waiting.path));
            await listener.probedBefore(click.result, t.signal);
            await listener.close();
            listener = undefined;
            if (change === 'edited')
              await writeFile(waiting.path, JSON.stringify(waiting.config) + ' ');
            else await unlink(waiting.path);
            await holder.release();
            const refused = await bounded(click.result, 45_000, `The ${change} click`, t.signal);
            assert.equal(refused.code, 1, change);
            assert.match(
              refused.stderr,
              /configuration was changed, replaced or removed while this click waited/,
            );
            assert.equal(await listening(scratchPort), false);
            await assert.rejects(lstat(waiting.config.DataDir), { code: 'ENOENT' });
          } finally {
            await listener?.close();
            await click?.abandon().catch(() => undefined);
            await holder.release();
          }
        }
      },
    );
    await t.test(
      'a definite missing web shell is refused before the startup locks, while ambiguity waits (#566)',
      { timeout: 120_000 },
      async (t) => {
        const shell = await configuration('missing-shell', { Port: scratchPort });
        // The matching listener's enrolled store must resolve: a disposable directory, database
        // file and ownership records that every refusal must leave untouched.
        await mkdir(shell.config.DataDir);
        await writeFile(shell.config.Enrollment.Lookup, '');
        const records = [];
        for (const name of leaseNames)
          records.push(
            await ownershipFixture(join(shell.config.DataDir, name), {
              pid: 1,
              token: randomUUID(),
            }),
          );
        const unchanged = async (name) => {
          for (const record of records)
            assert.equal(await readFile(record.path, 'utf8'), record.contents, name);
          assert.deepEqual(
            (await readdir(shell.config.DataDir)).sort(),
            ['graphgoblin.db', ...leaseNames].sort(),
            name,
          );
        };
        const headers = {
          'x-graphgoblin-instance': 'f'.repeat(64),
          'x-graphgoblin-launch-identity': shell.config.Enrollment.Launch,
          'x-graphgoblin-pid': String(process.pid),
          'x-graphgoblin-phase': 'running',
        };
        const gatewayLog = join(install, 'gateway.log');
        const logBefore = await readFile(gatewayLog, 'utf8');
        const holder = await holdLaunchMutexes(checks, shell.config, t.signal);
        let listener;
        let click;
        try {
          for (const status of [404, 410]) {
            listener = await replacementListener(scratchPort, { headers, app: status });
            const started = performance.now();
            const refused = await bounded(
              launch(shell.path).then(
                (result) => ({ code: 0, ...result }),
                (error) => error,
              ),
              20_000,
              `The /app/ ${status} click`,
              t.signal,
            );
            // Immediate, classified and lock-free: the held startup mutexes were never awaited.
            assert.ok(performance.now() - started < 10_000, `The ${status} refusal waited.`);
            assert.deepEqual([refused.code, refused.stdout], [1, ''], String(status));
            assert.match(
              refused.stderr,
              /^The gateway answers but its built web app is unavailable/,
            );
            assert.deepEqual(listener.requests, ['GET /healthz', 'GET /app/'], String(status));
            assert.equal(await listening(scratchPort), true, 'The listener must be preserved.');
            const recorded = logRecords(await readFile(join(install, 'launcher.log'), 'utf8')).at(
              -1,
            );
            assert.deepEqual([recorded.stage, recorded.code], ['gateway', 'web-unavailable']);
            await unchanged(String(status));
            assert.equal(await readFile(gatewayLog, 'utf8'), logBefore, 'No gateway was started.');
            await listener.close();
            listener = undefined;
          }
          // Transport-ambiguity control: an /app/ that never answers waits for the held locks.
          listener = await replacementListener(scratchPort, { headers, app: 'hang' });
          click = pendingClick(launch(shell.path));
          const early = await Promise.race([click.result, sleep(5000).then(() => null)]);
          assert.equal(early, null, 'An ambiguous /app/ answer was refused without the locks.');
          assert.deepEqual(listener.requests, ['GET /healthz', 'GET /app/']);
          await holder.release();
          const refused = await bounded(click.result, 45_000, 'The ambiguous click', t.signal);
          assert.equal(refused.code, 1);
          assert.match(
            refused.stderr,
            /occupied but the configured GraphGoblin gateway is not ready/,
          );
          assert.deepEqual(listener.requests, [
            'GET /healthz',
            'GET /app/',
            'GET /healthz',
            'GET /app/',
          ]);
          await unchanged('ambiguous');
          assert.equal(await readFile(gatewayLog, 'utf8'), logBefore, 'No gateway was started.');
        } finally {
          await click?.abandon().catch(() => undefined);
          await listener?.close();
          await holder.release();
        }
      },
    );
    await t.test(
      'a live gateway is refused after its relative database alias is retargeted (#566)',
      async () => {
        const links = join(base, 'retarget-links');
        const original = join(links, 'original');
        const replacement = join(links, 'replacement');
        const alias = join(links, 'db-alias');
        await mkdir(original, { recursive: true });
        await mkdir(replacement);
        await symlink(original, alias, 'junction');
        const relativeDb = relative(root, join(alias, 'store.db')).replaceAll('\\', '/');
        assert.ok(!isAbsolute(relativeDb));
        const retarget = await configuration('retarget', {
          Port: scratchPort,
          Environment: { GG_DB_URL: 'file:' + relativeDb },
        });
        // The database lease lies beside the physical database, whatever the alias names later.
        const leases = gatewayLeases(retarget.config, join(original, 'store.db'));
        let owner;
        let before;
        try {
          // The shipped helper keeps the decoded lookup's alias spelling and its real target.
          assert.equal(retarget.config.Enrollment.Lookup, join(root, relativeDb));
          assert.equal(
            retarget.config.Enrollment.Target.toLowerCase(),
            join(await realpath(original), 'store.db').toLowerCase(),
          );
          const cold = await launch(retarget.path);
          assert.deepEqual([cold.stdout, cold.stderr], ['', '']);
          before = await health(retarget.config);
          // The cold click's gateway: enrolled identity, process identity and its own leases.
          owner = await ownedAliasGateway(retarget.config, before.identity, leases);
          await access(join(original, 'store.db'));
          assert.equal((await launch(retarget.path)).stderr, '');
          await unlink(alias);
          await symlink(replacement, alias, 'junction');
          await writeFile(join(replacement, 'store.db'), 'not the enrolled store');
          await assert.rejects(launch(retarget.path), /no longer resolves to the enrolled store/);
          assert.deepEqual(await health(retarget.config), before);
          assert.equal(
            await readFile(join(replacement, 'store.db'), 'utf8'),
            'not the enrolled store',
          );
          // Restoring the alias restores warm reuse of the same live gateway.
          await unlink(alias);
          await symlink(original, alias, 'junction');
          assert.equal((await launch(retarget.path)).stderr, '');
          assert.deepEqual(await health(retarget.config), before);
        } finally {
          // The gateway releases its database lease through the alias, so restore it first.
          if (owner) {
            await unlink(alias).catch(() => undefined);
            await symlink(original, alias, 'junction');
            await releaseAliasGateway(retarget, before.identity, owner, { leases });
          }
          await unlink(alias).catch(() => undefined);
        }
      },
    );
    await t.test(
      'warm reuse under an outer active-process limit attempts no admission (#544)',
      { timeout: 180_000 },
      async (t) => {
        const quotaPort = await freePort(); // only ever probed, never bound
        const warm = await configuration('quota-warm', { Port: scratchPort });
        const cold = await configuration('quota-cold', { Port: quotaPort });
        // Raw bounded fixture reports, the first failure and the gate state, logged however it ends.
        const record = {
          evidence: 'windows-launcher-active-process-limit',
          limit: 3,
          noAttemptGate: 'open-not-established',
        };
        const job = async (limit, targets, name) => {
          const result = await runDetached(
            checks,
            ['--job-launch', limit, exe, ...targets.map((target) => target.path)],
            150_000,
            t.signal,
          );
          record[name] = { code: result.code, stderr: result.stderr.split('\n', 1)[0] };
          assert.ok(result.stdout.trim(), `The ${name} job fixture did not report.`);
          const report = JSON.parse(result.stdout);
          record[name] = report;
          // A fixture failure is never the expected containment refusal.
          assert.equal(result.code, 0, `The ${name} job fixture failed: ${report.fixtureFailure}`);
          return report;
        };
        const fenced = (window, name) =>
          assert.equal(window?.observer, 'fenced-quiet', `The ${name} observer window failed.`);
        const owned = (report) => [report.selfPid, report.siblingPid].sort((a, b) => a - b);
        const onlyOwned = (report, accounting, name) =>
          assert.deepEqual(
            [accounting?.active, accounting?.pids],
            [2, owned(report)],
            `The ${name} job did not hold exactly the fixture and its sibling.`,
          );
        const leases = () =>
          Promise.all(leaseNames.map((name) => readFile(join(warm.config.DataDir, name))));
        // The control's job stays owned until its explicit release; a cancellation terminates
        // that exact owner and its kill-on-close job settles the launcher, helpers and gateway.
        const owner = ownJob(checks, ['--job-owner', exe, warm.path], t.signal);
        try {
          // Compatible control: the same nested creation shape inside an unlimited outer job.
          const control = await owner.report;
          record.control = control;
          assert.equal(control.fixtureFailure, undefined, 'The control job fixture failed.');
          assert.equal(control.holding, true, 'The control job is not held for the measurement.');
          const [started] = control.phases;
          assert.equal(Number(control.readback.flags) & 0x8, 0, 'The control job has a limit.');
          assert.notEqual(
            Number(control.readback.flags) & 0x2000,
            0,
            'The control job does not own its members until release.',
          );
          fenced(control.setupWindow, 'control setup');
          fenced(started.window, 'control click');
          assert.deepEqual([started.exit, started.stdout, started.stderr], [0, '', '']);
          assert.equal(started.window.denied, 0, 'The compatible control was denied.');
          const running = await health(warm.config);
          assert.equal(running.launch, warm.config.Enrollment.Launch);
          // The launcher, at least one contained helper and the gateway were created in the job.
          assert.ok(started.window.admitted.includes(started.launcherPid));
          assert.ok(started.window.admitted.includes(Number(running.pid)));
          assert.ok(started.window.admitted.length >= 3, 'No contained helper was admitted.');
          // The owned job's gateway, verified by process identity and its disposable leases.
          const gateway = await ownedAliasGateway(warm.config, running.identity);
          const leaseBytes = await leases();

          // One limited job and observer: setup, cold calibration, warm measurement, final probe.
          const quota = await job('3', [cold, warm], 'quota');
          const [refused, reused] = quota.phases;
          assert.ok(
            (Number(quota.readback.flags) & 0x8) !== 0 && quota.readback.activeLimit === 3,
            'The actual active-process limit was not read back as 3.',
          );
          onlyOwned(quota, quota.setup, 'setup');
          fenced(quota.setupWindow, 'setup');
          // One verified free slot: a filler fits, then both creation shapes are refused.
          for (const [name, probe] of [
            ['setup probe', quota.probe],
            ['final probe', quota.postProbe],
          ]) {
            assert.equal(probe.filler, 'admitted', `${name} filler`);
            assert.equal(probe.full.active, 3, `${name} full slot`);
            assert.match(probe.plain, /^refused:\d+$/, `${name} plain creation`);
            assert.match(probe.jobList, /^refused:\d+$/, `${name} JOB_LIST creation`);
            assert.equal(probe.released, true, `${name} slot release`);
            onlyOwned(quota, probe.after, name);
            fenced(probe.window, name);
          }

          // Sensitivity control: the actual public cold helper refusal is denied and observed.
          onlyOwned(quota, refused.before, 'cold');
          assert.deepEqual([refused.exit, refused.stdout], [1, '']);
          assert.match(refused.stderr, /^Windows could not start an isolated launcher check/);
          fenced(refused.window, 'cold click');
          assert.deepEqual(refused.window.admitted, [refused.launcherPid]);
          assert.equal(refused.released, true);
          assert.equal(await listening(quotaPort), false);
          await assert.rejects(lstat(cold.config.DataDir), { code: 'ENOENT' });
          record.calibration = refused.window.denied > 0 ? 'observed' : 'missing';
          assert.ok(
            refused.window.denied > 0,
            'Open #544 gate: the observer did not report the actual cold helper refusal.',
          );

          // Warm under the same limit and observer: no denied or admitted creation at all.
          onlyOwned(quota, reused.before, 'warm');
          assert.deepEqual([reused.exit, reused.stdout, reused.stderr], [0, '', '']);
          fenced(reused.window, 'warm click');
          assert.deepEqual(reused.window.admitted, [reused.launcherPid]);
          assert.equal(reused.window.denied, 0, 'The warm click attempted a denied admission.');
          assert.equal(reused.released, true);
          assert.ok(
            quota.postProbe.window.denied > 0,
            'Open #544 gate: the observer stopped reporting refusals after the warm click.',
          );
          assert.equal(quota.siblingAlive, true);
          assert.deepEqual(await health(warm.config), running);
          assert.deepEqual(await leases(), leaseBytes);
          assert.deepEqual(await ownedAliasGateway(warm.config, running.identity), gateway);
          record.noAttemptGate = 'witnessed';

          // Owned release: the verified gateway is drained, then the job owner is released and
          // reports its surviving sibling and remaining members before closing its job.
          record.release = await releaseAliasGateway(warm, running.identity, gateway);
          const released = await owner.release();
          record.controlRelease = released;
          // The maintained record keeps the control's sibling and final members, now observed at
          // its explicit release rather than at its exit.
          Object.assign(control, {
            siblingAlive: released.siblingAlive,
            final: released.final,
            siblingSettled: released.siblingSettled,
          });
          assert.deepEqual(
            [released.code, released.released, released.siblingAlive, released.siblingSettled],
            [0, 'explicit', true, true],
          );
          onlyOwned(control, released.final, 'control release');
        } catch (error) {
          record.firstFailure ??= String(error?.message ?? error).slice(0, 500);
          throw error;
        } finally {
          // Without a completed owned release, closing the owner's job settles its members; a
          // listener is never stopped by its port.
          record.controlRelease ??= await owner.release().catch((error) => ({
            failure: String(error?.message ?? error).slice(0, 200),
          }));
          console.log(JSON.stringify(record));
        }
      },
    );
    await t.test('plain-health HTTP listener is refused and kept alive', async () => {
      const unrelated = await configuration('unrelated');
      const server = createHttpServer((_request, response) => {
        response.setHeader('Content-Type', 'application/json');
        response.end('{"status":"ok"}');
      });
      await new Promise((resolve) => server.listen(unrelated.config.Port, '127.0.0.1', resolve));
      try {
        await assert.rejects(launch(unrelated.path), /unrelated or differently configured/);
        assert.equal((await fetch(origin(unrelated.config))).status, 200);
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    });
    await t.test(
      'a silent TCP listener never permits a gateway spawn across repeated clicks',
      async () => {
        const unrelated = await configuration('silent-tcp');
        const sockets = new Set();
        const server = createServer((socket) => {
          sockets.add(socket);
          socket.on('error', () => undefined);
          socket.on('close', () => sockets.delete(socket));
        });
        await new Promise((resolve) => server.listen(unrelated.config.Port, '127.0.0.1', resolve));
        const before = await readFile(join(install, 'gateway.log'), 'utf8');
        try {
          for (let trial = 0; trial < 8; trial++) {
            await assert.rejects(launch(unrelated.path), /occupied but .*not ready/);
            assert.equal(await readFile(join(install, 'gateway.log'), 'utf8'), before);
            await assert.rejects(readFile(join(unrelated.config.DataDir, 'graphgoblin.lock')), {
              code: 'ENOENT',
            });
          }
        } finally {
          for (const socket of sockets) socket.destroy();
          await new Promise((resolve) => server.close(resolve));
        }
      },
    );
    await t.test(
      'malformed store ownership is preserved and refused before starting a gateway',
      async () => {
        const failure = await configuration('failure', { StartupTimeoutSeconds: 1 });
        await mkdir(failure.config.DataDir);
        const lock = join(failure.config.DataDir, 'graphgoblin.lock');
        await writeFile(lock, 'unverifiable owner');
        const before = await readFile(join(install, 'gateway.log'), 'utf8');
        await assert.rejects(
          launch(failure.path),
          /Store ownership could not be verified \(malformed or incomplete owner record\)/,
        );
        assert.equal(await readFile(lock, 'utf8'), 'unverifiable owner');
        assert.equal(await readFile(join(install, 'gateway.log'), 'utf8'), before);
      },
    );
    await t.test(
      'reused live PID in both locks and guards permits exactly one cold gateway',
      async () => {
        const reused = await configuration('reused-pid');
        await mkdir(reused.config.DataDir);
        const oldOwner = {
          pid: process.pid,
          windowsCreationTime: '134000000000000000',
          token: randomUUID(),
        };
        for (const file of [
          'graphgoblin.lock',
          'graphgoblin.lock.reclaim',
          'graphgoblin.db.graphgoblin.lock',
          'graphgoblin.db.graphgoblin.lock.reclaim',
        ]) {
          await ownershipFixture(join(reused.config.DataDir, file), oldOwner);
        }
        try {
          await Promise.all([launch(reused.path), launch(reused.path)]);
          const running = await health(reused.config);
          const record = JSON.parse(
            await readFile(join(reused.config.DataDir, 'graphgoblin.lock'), 'utf8'),
          );
          assert.equal(String(record.pid), running.pid);
          assert.match(record.windowsCreationTime, /^[1-9][0-9]{16,18}$/);
          assert.notEqual(record.windowsCreationTime, '134000000000000000');
          process.kill(process.pid, 0);
        } finally {
          await stop(reused.config);
        }
      },
    );
    await t.test(
      'a protected system PID with a different verified identity is recovered without touching that process',
      async () => {
        const discovery = `
          $ErrorActionPreference='Stop'; $selected=$null;
          $candidates=Get-CimInstance Win32_Process -Filter "Name = 'csrss.exe' OR Name = 'lsass.exe' OR Name = 'services.exe' OR Name = 'unsecapp.exe' OR Name = 'wininit.exe' OR Name = 'winlogon.exe'";
          foreach($candidate in $candidates) {
            if ($null -eq $candidate.CreationDate) { continue }; $probe=$null;
            try { $probe=[Diagnostics.Process]::GetProcessById([int]$candidate.ProcessId); $null=$probe.get_HasExited() }
            catch {
              $cause=$_.Exception.GetBaseException();
              if ($cause -is [ComponentModel.Win32Exception] -and $cause.NativeErrorCode -eq 5) {
                $selected=[pscustomobject]@{pid=[int]$candidate.ProcessId;name=$candidate.Name;windowsCreationTime=$candidate.CreationDate.ToFileTimeUtc().ToString([Globalization.CultureInfo]::InvariantCulture);deniedOperation='Process.HasExited';errorCode=5}; break;
              }
            } finally { if ($null -ne $probe) { $probe.Dispose() } }
          }
          ConvertTo-Json -InputObject $selected -Compress
        `;
        const selected = JSON.parse(
          (
            await execute(
              'powershell.exe',
              ['-NoProfile', '-NonInteractive', '-Command', discovery],
              { env, windowsHide: true, timeout: 15_000 },
            )
          ).stdout,
        );
        assert.ok(
          selected,
          'Required protected-process regression could not find a system PID with denied HasExited and queryable CreationDate.',
        );
        assert.equal(selected.errorCode, 5);
        assert.match(selected.windowsCreationTime, /^[1-9][0-9]{16,18}$/);
        const reused = await configuration('reused-protected-pid');
        await mkdir(reused.config.DataDir);
        const previous = {
          pid: selected.pid,
          windowsCreationTime: (BigInt(selected.windowsCreationTime) - 10000000n).toString(),
          token: randomUUID(),
        };
        const fixtures = [];
        for (const file of [
          'graphgoblin.lock',
          'graphgoblin.lock.reclaim',
          'graphgoblin.db.graphgoblin.lock',
          'graphgoblin.db.graphgoblin.lock.reclaim',
        ]) {
          fixtures.push(await ownershipFixture(join(reused.config.DataDir, file), previous));
        }
        const state = await execute(
          process.execPath,
          [join(root, 'apps/api/dist/instance-identity.js'), '--store-state'],
          {
            cwd: root,
            env: {
              ...env,
              GG_DATA_DIR: reused.config.DataDir,
              GG_PORT: String(reused.config.Port),
              GG_WEB_DIST: join(root, 'apps/web/dist'),
            },
            windowsHide: true,
            timeout: 30_000,
          },
        );
        assert.equal(JSON.parse(state.stdout).state, 'free');
        for (const fixture of fixtures)
          assert.equal(await readFile(fixture.path, 'utf8'), fixture.contents);
        try {
          await launch(reused.path);
          const running = await health(reused.config);
          assert.notEqual(Number(running.pid), selected.pid);
          const { windowsProcessIdentity } =
            await import('../../apps/api/dist/windows-process-identity.js');
          assert.equal(
            (await windowsProcessIdentity(selected.pid)).identity,
            selected.windowsCreationTime,
          );
          console.log(
            JSON.stringify({
              evidence: 'protected-system-pid-reuse',
              selected,
              gatewayPid: running.pid,
            }),
          );
        } finally {
          await stop(reused.config);
        }
      },
    );
    await t.test(
      'matching and unknown identities preserve locks, guards and the live process',
      async () => {
        const { windowsProcessIdentity } =
          await import('../../apps/api/dist/windows-process-identity.js');
        const { identity: creationTime } = await windowsProcessIdentity(process.pid);
        assert.match(creationTime, /^[1-9][0-9]{16,18}$/);
        for (const [name, record] of [
          ['matching', { pid: process.pid, windowsCreationTime: creationTime }],
          ['pid-only', { pid: process.pid }],
          ['inaccessible', { pid: 4 }],
          ['file-guard', { pid: process.pid, windowsCreationTime: '134000000000000000' }],
        ]) {
          const refused = await configuration('held-' + name, { StartupTimeoutSeconds: 1 });
          await mkdir(refused.config.DataDir);
          const lock = join(
            refused.config.DataDir,
            name === 'matching' || name === 'file-guard'
              ? 'graphgoblin.db.graphgoblin.lock.reclaim'
              : 'graphgoblin.lock',
          );
          const original =
            name === 'file-guard'
              ? { path: lock, contents: JSON.stringify(record) }
              : await ownershipFixture(lock, record);
          if (name === 'file-guard') await writeFile(original.path, original.contents);
          const before = await readFile(join(install, 'gateway.log'), 'utf8');
          await assert.rejects(
            launch(refused.path),
            name === 'matching'
              ? /another GraphGoblin process holds this store/
              : /Store ownership could not be verified/,
          );
          assert.equal(await readFile(original.path, 'utf8'), original.contents);
          assert.equal(await readFile(join(install, 'gateway.log'), 'utf8'), before);
          process.kill(process.pid, 0);
        }
      },
    );
    console.log(JSON.stringify({ evidence: 'windows-launcher-native', artifacts: base }));
  }),
);

const identityLine = /^[a-f0-9]{64}\n$/;
const freeStoreLine = '{"state":"free"}\n';
const identityRefusal =
  "The Node 22 runtime, launcher configuration or store ownership could not be checked. Check the configured runtime, GG_* overrides and read permissions on the store's lock files.";
const configRefusal = /belongs to an unrelated or differently configured service/;
const leaseNames = ['graphgoblin.lock', 'graphgoblin.db.graphgoblin.lock'];

function publicCommandOutput(output, protocol) {
  if (!output) return '';
  if (protocol && (identityLine.test(output) || output === freeStoreLine)) return output;
  const firstLine = output.split(/\r?\n/, 1)[0];
  if (firstLine === identityRefusal) return firstLine;
  if (configRefusal.test(firstLine)) return 'unrelated or differently configured service';
  return `[${Buffer.byteLength(output)} bytes suppressed]`;
}

async function observeCommand(evidence, name, command) {
  const {
    code = null,
    signal = null,
    stdout = '',
    stderr = '',
  } = await command.then(
    (result) => ({ ...result, code: 0 }),
    (error) => error,
  );
  evidence[name] = {
    code,
    signal,
    stdout: publicCommandOutput(
      stdout,
      name.endsWith('-identity') || name.endsWith('-store-state'),
    ),
    stderr: publicCommandOutput(stderr, false),
  };
  return { code, stdout, stderr };
}

function assertOutput(result, expected, name) {
  assert.equal(result.code, 0, `${name} must exit successfully.`);
  assert.ok(result.stderr === '', `${name} must have empty stderr.`);
  assert.ok(result.stdout === expected, `${name} returned an unexpected stdout record.`);
}

async function nativeObservation(script, overrides = {}) {
  const command = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue';
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false);
    ${script}`;
  const args = ['-NoProfile', '-NonInteractive', '-Command', command];
  const powershell = join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32/WindowsPowerShell/v1.0/powershell.exe',
  );
  const { stdout, stderr } = await execute(powershell, args, {
    env: { ...env, ...overrides },
    windowsHide: true,
    timeout: 15_000,
  });
  assert.ok(stderr === '', 'Native Windows inspection emitted stderr.');
  return parseInspection(stdout, 'Native Windows inspection');
}

function parseInspection(contents, name) {
  try {
    return JSON.parse(contents);
  } catch {
    assert.fail(`${name} must contain valid JSON.`);
  }
}

function listening(port) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.setTimeout(2000, () => socket.destroy(new Error(`TCP probe timed out on ${port}.`)));
    socket.once('error', (error) => {
      if (error.code === 'ECONNREFUSED') resolve(false);
      else reject(error);
    });
  });
}

/** The leases a verified gateway holds: its data directory's and its database's. */
function gatewayLeases(config, database = join(config.DataDir, 'graphgoblin.db')) {
  return [join(config.DataDir, 'graphgoblin.lock'), `${database}.graphgoblin.lock`];
}

const sessionReconnectRefused = 'ERR_FIXTURE_SESSION_RECONNECT';
const sessionSocketUnusable = 'ERR_FIXTURE_SESSION_SOCKET';

/**
 * One private HTTP session over one IPv4 loopback socket (#566), or null when nothing listens. Its
 * agent offers that connected socket once and refuses every later connection, even after the
 * socket closed or while a request is queued, so no request of the session reaches another
 * listener on the port. A request is written only after the agent assigned that exact socket and
 * it is still open both ways; each is bounded in time and size, consumed completely and never
 * redirected, proxied or replayed. `closed` settles when the socket closes; `dispose` destroys the
 * agent and the socket and awaits that close.
 */
async function loopbackSession(port) {
  const socket = createConnection({ host: '127.0.0.1', port, family: 4 });
  const closed = new Promise((resolve) => socket.once('close', resolve));
  let ended = false;
  let failure;
  socket.once('end', () => {
    ended = true;
  });
  socket.on('error', (error) => {
    failure = error;
  });
  const connected = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => socket.destroy(new Error(`TCP session timed out on ${port}.`)),
      2000,
    );
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(true);
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      if (error.code === 'ECONNREFUSED') resolve(false);
      else reject(error);
    });
  });
  if (!connected) {
    await closed;
    return null;
  }
  const written = [];
  let offered = false;
  const agent = new HttpAgent({ keepAlive: true, maxSockets: 1, maxFreeSockets: 1 });
  // A pool size of one would still open a replacement; this agent never opens anything.
  agent.createConnection = (_options, created) => {
    if (offered) {
      created(
        Object.assign(new Error('The fixture session refused a second connection.'), {
          code: sessionReconnectRefused,
          written: [...written],
        }),
      );
      return undefined;
    }
    offered = true;
    return socket;
  };
  const live = () => !ended && !socket.destroyed && socket.writable && socket.readyState === 'open';
  const request = (method, path, { headers = {}, body } = {}) =>
    new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : Buffer.from(body);
      const outgoing = httpRequest({
        agent,
        host: '127.0.0.1',
        port,
        family: 4,
        method,
        path,
        headers: payload ? { ...headers, 'content-length': payload.length } : headers,
      });
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) {
          outgoing.destroy();
          reject(error);
        } else resolve(value);
      };
      const timer = setTimeout(
        () => finish(new Error(`${method} ${path} did not complete within 3000 ms.`)),
        3000,
      );
      outgoing.on('error', finish);
      outgoing.once('socket', (assigned) => {
        // The exact socket, still open both ways, before any byte of this request is written.
        if (assigned === socket && live()) {
          written.push(`${method} ${path}`);
          outgoing.end(payload);
        } else
          finish(
            Object.assign(new Error(`The fixture session socket cannot carry ${method} ${path}.`), {
              code: sessionSocketUnusable,
              written: [...written],
              cause: failure,
            }),
          );
      });
      outgoing.once('response', (response) => {
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > 65_536) finish(new Error(`${method} ${path} answered over 65536 bytes.`));
          else chunks.push(chunk);
        });
        response.on('error', finish);
        response.once('end', () =>
          finish(undefined, {
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      });
    });
  return {
    request,
    closed,
    written,
    async dispose() {
      agent.destroy();
      socket.destroy();
      await bounded(closed, 2000, 'The fixture session socket');
    },
  };
}

const controlTokenShape =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(0|[1-9][0-9]*):([a-z-]+)$/;

/** A session's shutdown snapshot, with the route incarnation its control token carries. */
async function shutdownSnapshot(session) {
  const response = await session.request('GET', '/system/shutdown');
  assert.equal(response.status, 200, 'The shutdown snapshot must answer 200.');
  const state = parseInspection(response.body, 'The shutdown snapshot');
  const token =
    typeof state?.controlToken === 'string' ? controlTokenShape.exec(state.controlToken) : null;
  assert.ok(token && token[3] === state.phase, 'The shutdown token must name its incarnation.');
  return { ...state, incarnation: token[1] };
}

/**
 * The verified owner of a fixture gateway, captured through its own private session and bound to
 * the shutdown incarnation of the listener it observed.
 */
async function ownedAliasGateway(config, digest, leases = gatewayLeases(config)) {
  const session = await loopbackSession(config.Port);
  assert.ok(session, 'The verified gateway must be listening.');
  try {
    return (await observeOwner(config, digest, leases, session)).owner;
  } finally {
    await session.dispose();
  }
}

/**
 * One owner observation on one session: the listener's identity and enrolled launch digest, its
 * PID's Windows creation identity, executable and exact command line, the disposable leases that
 * name that PID and creation time, and then the shutdown incarnation and state of that same
 * listener. An `expected` owner's process facts must match before the shutdown route is read.
 * Every fact is re-read from the system at each call.
 */
async function observeOwner(config, digest, leases, session, expected) {
  const healthz = await session.request('GET', '/healthz');
  assert.equal(healthz.status, 200, 'The listener health must answer 200.');
  const running = {
    pid: healthz.headers['x-graphgoblin-pid'],
    identity: healthz.headers['x-graphgoblin-instance'],
    launch: healthz.headers['x-graphgoblin-launch-identity'],
  };
  assert.ok(
    digest && running.identity === digest,
    'The listener must have the configured identity.',
  );
  if (config.Enrollment)
    assert.equal(
      running.launch,
      config.Enrollment.Launch,
      'The listener must have the enrolled launch identity.',
    );
  assert.ok(/^[1-9][0-9]*$/.test(running.pid), 'The listener must report its PID.');
  const pid = Number(running.pid);
  const native = await nativeObservation(`
    $owner = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}';
    if (!$owner -or !$owner.CreationDate) { throw 'No process creation identity'; }
    [pscustomobject]@{
      pid = [int]$owner.ProcessId
      birth = $owner.CreationDate.ToFileTimeUtc().ToString([Globalization.CultureInfo]::InvariantCulture)
      executable = $owner.ExecutablePath
      commandLine = $owner.CommandLine
    } | ConvertTo-Json -Compress
  `);
  assert.equal(native.pid, pid);
  assert.match(native.birth, /^[1-9][0-9]{16,18}$/);
  const executable = await realpath(native.executable);
  assert.equal(executable, await realpath(config.Node));
  // Exactly two arguments, each quoted (the launcher's spawn) or bare (a direct Node spawn).
  const args = /^(?:"([^"]+)"|([^\s"]+)) (?:"([^"]+)"|([^\s"]+))$/.exec(native.commandLine);
  assert.ok(args, 'The gateway must have a native Node executable and a single main argument.');
  assert.equal(normalize(args[1] ?? args[2]), normalize(config.Node));
  const main = normalize(args[3] ?? args[4]);
  assert.equal(main, join(config.Repo, 'apps/api/dist/main.js'));
  const owned = {};
  for (const lease of leases) {
    const contents = await readFile(lease);
    const name = relative(config.DataDir, lease);
    const record = parseInspection(contents, name);
    assert.ok(
      record?.pid === pid && record.windowsCreationTime === native.birth,
      `${name} must belong to the running process.`,
    );
    owned[name] = createHash('sha256').update(contents).digest('hex');
  }
  const owner = { pid, birth: native.birth, executable, main, leases: owned };
  if (expected) {
    const { incarnation: _incarnation, ...facts } = expected;
    assert.deepEqual(owner, facts, 'Only the verified owner can be drained.');
  }
  const state = await shutdownSnapshot(session);
  return { owner: { ...owner, incarnation: state.incarnation }, state };
}

/**
 * Release a fixture gateway only as its verified owner, over one private loopback session that
 * never reconnects. A configured port, a digest or a previously free port is never ownership: a
 * listener without a verified `owner`, or whose PID, creation identity, executable, lease bytes
 * or shutdown incarnation changed, is refused before any shutdown request. On that one connection
 * the owner is revalidated with the current running token of its own incarnation, revalidated
 * again with that token unchanged, and only then is the drain sent with that exact token. No
 * request follows a redirect. The PID's disappearance, the closed listener and removed leases are
 * then observed within bounds. `afterProof` is a private test-only point between the final proof
 * and the drain; it receives the retained connection's closure.
 */
async function releaseAliasGateway(
  start,
  digest,
  owner,
  { leases = gatewayLeases(start.config), unstarted, afterProof } = {},
) {
  const { config } = start;
  const cleanup = (result) =>
    ciEvidence.record('cleanup', { action: 'gateway-drain', result, count: null });
  try {
    const session = await loopbackSession(config.Port);
    if (session) {
      try {
        assert.ok(
          owner,
          'An unverified listener is retained: cleanup sends it no shutdown request.',
        );
        const verified = async () => {
          const observed = await observeOwner(config, digest, leases, session, owner);
          assert.deepEqual(observed.owner, owner, 'Only the verified owner can be drained.');
          return observed.state;
        };
        const { phase, activeRunIds, unconfirmedRunIds, controlToken } = await verified();
        assert.equal(phase, 'running');
        assert.ok(Array.isArray(activeRunIds) && activeRunIds.length === 0);
        assert.ok(Array.isArray(unconfirmedRunIds) && unconfirmedRunIds.length === 0);
        assert.equal(
          (await verified()).controlToken,
          controlToken,
          'The shutdown token changed before the drain.',
        );
        await afterProof?.({ retained: session.closed });
        const drain = await session.request('POST', '/system/shutdown', {
          headers: {
            'content-type': 'application/json',
            'x-graphgoblin-shutdown-token': controlToken,
          },
          body: JSON.stringify({ action: 'drain' }),
        });
        assert.equal(drain.status, 202);
      } finally {
        await session.dispose();
      }
    }
    await observeRelease(config, owner, leases, unstarted);
  } catch (error) {
    cleanup('failed');
    throw error;
  }
  cleanup(owner ? 'drained' : 'not-running');
  return owner ? 'drained-pid-listener-leases' : 'no-gateway-spawned';
}

async function observeRelease(config, owner, leases, unstarted) {
  if (owner) {
    const deadline = Date.now() + 10_000;
    let birth;
    do {
      birth = await nativeObservation(`
        $owner = Get-CimInstance Win32_Process -Filter 'ProcessId = ${owner.pid}';
        if (!$owner) { 'null'; return }
        if (!$owner.CreationDate) { throw 'No process creation identity'; }
        ConvertTo-Json -InputObject ($owner.CreationDate.ToFileTimeUtc().ToString([Globalization.CultureInfo]::InvariantCulture)) -Compress
      `);
      if (birth !== owner.birth) break;
      await sleep(100);
    } while (Date.now() < deadline);
    assert.ok(
      birth === null || (/^[1-9][0-9]{16,18}$/.test(birth) && birth !== owner.birth),
      'The owned PID and birth must disappear after managed drain.',
    );
  } else {
    // Without a verified owner or clean refusal, a gateway may still be binding.
    await unstarted?.();
  }
  assert.equal(await listening(config.Port), false, 'The gateway listener must close.');
  for (const lease of leases) {
    await assert.rejects(lstat(lease), { code: 'ENOENT' });
    await assert.rejects(lstat(`${lease}.reclaim`), { code: 'ENOENT' });
  }
}

function sameFile(current, original) {
  return (
    current.dev === original.dev &&
    current.ino === original.ino &&
    current.birthtimeNs === original.birthtimeNs
  );
}

async function checkLauncherAlias(exe, sandbox, repo, kind, linkType) {
  const fixture = await privateDirectory(await mkdtemp(join(sandbox, `${kind}-`)));
  const alias = join(fixture, 'checkout alias-α');
  // The link's final state is observed with lstat only; it is never traversed or exported.
  ciEvidence.fixture('alias-link', alias, ciEvidence.fixture('alias-fixture', fixture));
  const evidence = {
    evidence: 'windows-launcher-checkout-alias',
    kind,
    requestedLinkType: linkType,
    fixture,
    commands: {},
    cold: [],
  };
  const fixtureStat = await lstat(fixture, { bigint: true });
  let link;
  let targetMatched = false;
  let releaseVerified = true;
  let stage = 'create-alias';
  let failure;
  try {
    await symlink(repo, alias, kind);
    stage = 'verify-alias';
    const created = await lstat(alias, { bigint: true });
    assert.ok(created.isSymbolicLink());
    assert.equal(await realpath(alias), repo);
    assert.equal(await realpath(await readlink(alias)), repo);
    targetMatched = true;
    evidence.reparse = await nativeObservation(
      `
      $item = Get-Item -LiteralPath $env:GG_TEST_CHECKOUT_ALIAS -Force;
      [pscustomobject]@{
        linkType = $item.LinkType
        directory = [bool]($item.Attributes -band [IO.FileAttributes]::Directory)
        reparsePoint = [bool]($item.Attributes -band [IO.FileAttributes]::ReparsePoint)
      } | ConvertTo-Json -Compress
    `,
      { GG_TEST_CHECKOUT_ALIAS: alias },
    );
    const observedType = evidence.reparse.linkType;
    assert.ok(observedType === linkType || (kind === 'dir' && observedType === 'SymLink'));
    assert.ok(evidence.reparse.directory === true && evidence.reparse.reparsePoint === true);
    link = created;
    stage = 'configure-fixture';
    const dataDir = join(fixture, 'store');
    const wrongDataDir = join(fixture, 'wrong-store');
    await mkdir(dataDir);
    await mkdir(wrongDataDir);
    const port = await freePort();
    evidence.port = port;
    const environment = env;
    async function configuration(name, checkout, overrides = {}) {
      const directory = join(fixture, name);
      await mkdir(directory);
      const config = {
        Repo: checkout,
        Node: process.execPath,
        DataDir: dataDir,
        Port: port,
        StartupTimeoutSeconds: 15,
        WindowTimeoutSeconds: 2,
        ...overrides,
        Environment: { GG_LOG_LEVEL: 'info', ...overrides.Environment, ...providerFree },
      };
      assertProviderFree(config.Environment);
      const path = join(directory, 'launcher.json');
      return { name, config: await enroll(exe, path, config), path };
    }
    const direct = await configuration('direct', repo);
    const aliased = await configuration('alias', alias);
    // Both checkout spellings enroll one canonical launch digest from different exact inputs.
    assert.equal(aliased.config.Enrollment.Launch, direct.config.Enrollment.Launch);
    assert.notEqual(aliased.config.Enrollment.Inputs, direct.config.Enrollment.Inputs);
    const mismatchStore = await configuration('wrong-store-config', alias, {
      DataDir: wrongDataDir,
    });
    const mismatchSettings = await configuration('wrong-settings-config', alias, {
      Environment: { ...aliased.config.Environment, GG_REQUIRE_API_KEY: 'true' },
    });
    const launch = (name, { path }) =>
      observeCommand(evidence.commands, name, launchNative(exe, path, environment));
    const helper = (name, { config }, mode) => {
      const entry = join(config.Repo, 'apps/api/dist/instance-identity.js');
      const importing = mode === 'import';
      const args = importing
        ? ['--input-type=module', '-e', 'await import(process.argv[1])', pathToFileURL(entry).href]
        : [entry, ...(mode ? [mode] : [])];
      const command = execute(config.Node, args, {
        cwd: config.Repo,
        env: {
          ...environment,
          ...config.Environment,
          GG_DATA_DIR: config.DataDir,
          GG_HOST: '127.0.0.1',
          GG_PORT: importing ? 'invalid' : String(config.Port),
          GG_WEB_DIST: join(config.Repo, 'apps/web/dist'),
        },
        windowsHide: true,
        timeout: 15_000,
      });
      return observeCommand(evidence.commands, name, command);
    };
    stage = 'capture-cli';
    const directIdentity = await helper('direct-identity', direct);
    const aliasIdentity = await helper('alias-identity', aliased);
    const state = await helper('alias-store-state', aliased, '--store-state');
    const imported = await helper('alias-import', aliased, 'import');
    const entriesBeforeCold = (await readdir(dataDir)).length;
    evidence.storeEntriesBeforeCold = entriesBeforeCold;
    const digest =
      directIdentity.code === 0 &&
      directIdentity.stderr === '' &&
      identityLine.test(directIdentity.stdout)
        ? directIdentity.stdout.slice(0, -1)
        : undefined;
    for (const [start, alternate] of [
      [aliased, direct],
      [direct, aliased],
    ]) {
      stage = `${start.name}-check-free-port`;
      assert.equal(await listening(port), false, 'The cold launcher must have a free port.');
      releaseVerified = false;
      let owner;
      let roundFailure;
      const observation = { spelling: start.name };
      evidence.cold.push(observation);
      try {
        // Preserve both CLI probe results and the actual native launch on a failing baseline.
        stage = `${start.name}-cold`;
        const launched = await launch(`${start.name}-cold`, start);
        stage = 'assert-cli';
        assert.ok(digest, 'Direct identity helper must emit one lowercase digest and LF.');
        assertOutput(aliasIdentity, directIdentity.stdout, 'Aliased identity helper');
        assertOutput(state, freeStoreLine, 'Aliased store-state helper');
        assertOutput(imported, '', 'Aliased import with invalid CLI settings');
        assert.equal(
          entriesBeforeCold,
          0,
          'The read-only helper and import must leave the store empty.',
        );
        stage = `${start.name}-cold-ready`;
        assertOutput(launched, '', `${start.name} cold launcher`);
        owner = await ownedAliasGateway(start.config, digest);
        observation.owner = owner;
        for (const warm of [start, alternate]) {
          stage = `${start.name}-cold-${warm.name}-warm`;
          const result = await launch(stage, warm);
          assertOutput(result, '', `${warm.name} warm launcher`);
          assert.deepEqual(await ownedAliasGateway(start.config, digest), owner);
        }
        for (const mismatch of [mismatchStore, mismatchSettings]) {
          stage = `${start.name}-cold-${mismatch.name}`;
          const refused = await launch(stage, mismatch);
          assert.equal(refused.code, 1);
          assert.ok(
            configRefusal.test(refused.stderr),
            'Native launcher must refuse the mismatched gateway.',
          );
          assert.deepEqual(await ownedAliasGateway(start.config, digest), owner);
          await assert.rejects(lstat(join(dirname(mismatch.path), 'gateway.log')), {
            code: 'ENOENT',
          });
        }
        assert.deepEqual(await readdir(wrongDataDir), []);
      } catch (error) {
        roundFailure = error;
      }
      try {
        observation.release = await releaseAliasGateway(start, digest, owner, {
          unstarted: () =>
            assert.rejects(lstat(join(dirname(start.path), 'gateway.log')), { code: 'ENOENT' }),
        });
        releaseVerified = true;
      } catch (error) {
        observation.releaseFailure = error.code ?? 'unknown';
        if (!roundFailure) {
          stage = `${start.name}-release`;
          roundFailure = error;
        }
      }
      ciEvidence.record('alias-round', {
        kind,
        spelling: start.name,
        ownerVerified: owner !== undefined,
        release: observation.release ?? 'failed',
        releaseFailure:
          'releaseFailure' in observation
            ? errorCodeOf({ code: observation.releaseFailure })
            : null,
      });
      if (roundFailure) throw roundFailure;
    }
  } catch (error) {
    failure = error;
    evidence.failure = {
      stage,
      code: error.code ?? null,
      errno: error.errno,
      syscall: error.syscall,
    };
    if (stage === 'create-alias') {
      evidence.aliasAbsent = await lstat(alias).then(
        () => false,
        (error) => error.code === 'ENOENT',
      );
    }
  }
  try {
    if (link && releaseVerified) {
      assert.equal(dirname(alias), fixture);
      assert.equal(dirname(fixture), sandbox);
      assert.equal(await realpath(fixture), fixture);
      assert.ok(sameFile(await lstat(fixture, { bigint: true }), fixtureStat));
      const current = await lstat(alias, { bigint: true });
      assert.ok(current.isSymbolicLink() && sameFile(current, link));
      assert.equal(await realpath(alias), repo);
      assert.equal(await realpath(await readlink(alias)), repo);
      await unlink(alias);
      evidence.aliasUnlinked = true;
    }
  } catch (error) {
    evidence.unlinkFailure = error.code ?? 'unknown';
    failure ??= error;
  }
  console.log(JSON.stringify(evidence));
  // Typed projection of the same facts: no paths, protocol identity or command output.
  const reparseType = evidence.reparse?.linkType;
  ciEvidence.record('alias', {
    kind,
    observedLinkType:
      reparseType === 'Junction' || reparseType === 'SymbolicLink'
        ? reparseType
        : evidence.reparse
          ? 'other'
          : 'unobserved',
    reparsePoint:
      typeof evidence.reparse?.reparsePoint === 'boolean' ? evidence.reparse.reparsePoint : null,
    directory: typeof evidence.reparse?.directory === 'boolean' ? evidence.reparse.directory : null,
    targetMatched,
    failureStage: evidence.failure ? aliasStage(evidence.failure.stage) : null,
    failureCode: evidence.failure ? errorCodeOf(failure) : null,
    disposition: evidence.aliasUnlinked
      ? 'unlinked'
      : evidence.aliasAbsent === true
        ? 'not-created'
        : link && !releaseVerified
          ? 'retained-release-unverified'
          : evidence.unlinkFailure !== undefined
            ? 'retained-unlink-refused'
            : 'retained-unverified-link',
    unlinkFailure:
      evidence.unlinkFailure === undefined ? null : errorCodeOf({ code: evidence.unlinkFailure }),
  });
  if (failure) throw failure;
}

test(
  'native Windows launcher accepts junction and directory symlink checkout paths',
  { skip: process.platform !== 'win32', timeout: 240_000 },
  ciEvidence.observeTest('checkout-alias', async (t) => {
    const repo = await realpath(root);
    const temp = await realpath(tmpdir());
    const fromRepo = relative(repo, temp);
    assert.ok(isAbsolute(fromRepo) || fromRepo === '..' || fromRepo.startsWith(`..${sep}`));
    const sandbox = await mkdtemp(join(temp, 'graphgoblin-launcher-alias-'));
    ciEvidence.fixture('alias-sandbox', sandbox);
    const exe = join(sandbox, 'GraphGoblin.exe');
    await compileLauncher(
      join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
      exe,
    );
    for (const [kind, linkType] of [
      ['junction', 'Junction'],
      ['dir', 'SymbolicLink'],
    ]) {
      await t.test(`cold and warm native launcher with a ${linkType} checkout`, () =>
        checkLauncherAlias(exe, sandbox, repo, kind, linkType),
      );
    }
  }),
);

test(
  'independent API processes never share ownership while reclaiming a reused PID',
  { skip: process.platform !== 'win32', timeout: 180_000 },
  ciEvidence.observeTest('lock-contention', async () => {
    await mkdir(join(root, '.tmp'), { recursive: true });
    const base = await mkdtemp(join(root, '.tmp', 'windows-launcher-contention-'));
    ciEvidence.fixture('contention', base);
    const { windowsProcessIdentity } =
      await import('../../apps/api/dist/windows-process-identity.js');
    const { identity } = await windowsProcessIdentity(process.pid);
    assert.match(identity, /^[1-9][0-9]{16,18}$/);
    for (let trial = 1; trial <= 3; trial++) {
      const dataDir = join(base, `trial-${trial}`);
      await mkdir(dataDir);
      const previous = {
        pid: process.pid,
        windowsCreationTime: (BigInt(identity) - 10000000n).toString(),
        token: randomUUID(),
      };
      await ownershipFixture(join(dataDir, 'graphgoblin.lock'), previous);
      await ownershipFixture(join(dataDir, 'graphgoblin.lock.reclaim'), previous);
      await writeFile(join(dataDir, 'unrelated.txt'), 'retain unrelated bytes');
      const contenders = Array.from({ length: 5 }, () => ownershipContender(dataDir));
      try {
        const results = await Promise.all(contenders.map((contender) => contender.result));
        const owners = results.filter((result) => result.status === 'acquired');
        const refused = results.filter((result) => result.status === 'refused').length;
        for (const result of results) {
          ciEvidence.record('ownership-result', {
            trial,
            pid: result.pid,
            status: result.status,
            seededToken: previous.token,
            ownerToken: result.token ?? null,
            markerToken: result.markerToken ?? null,
            operation: result.operation ?? null,
            errorCode: result.code ?? null,
            diagnostic:
              result.status === 'acquired'
                ? 'acquired'
                : /another GraphGoblin process holds/.test(result.error)
                  ? 'store-held'
                  : /Store ownership could not be verified/.test(result.error)
                    ? 'store-unverified'
                    : result.code
                      ? 'filesystem'
                      : 'other',
          });
          for (const [index, failure] of (result.failures ?? []).entries())
            ciEvidence.record('ownership-error', { trial, pid: result.pid, index, ...failure });
        }
        ciEvidence.record('contention', {
          trial,
          contenders: contenders.length,
          acquired: owners.length,
          refused,
          other: results.length - owners.length - refused,
        });
        // No successful contender is released before every result is known. The launcher
        // mutex and in-process acquiringPaths cannot serialize these separate API writers.
        let liveOwners = 0;
        for (const owner of owners) {
          const contender = contenders.find(({ child }) => child.pid === owner.pid);
          if (contender.child.exitCode === null) {
            try {
              process.kill(owner.pid, 0);
              liveOwners++;
            } catch {
              /* recorded below */
            }
          }
        }
        // Retain the final record check before any assertion can stop this trial.
        const recorded = await readFile(join(dataDir, 'graphgoblin.lock'), 'utf8').then(
          (contents) => JSON.parse(contents),
          () => null,
        );
        const seededMarker = await lstat(
          join(dataDir, 'graphgoblin.lock.reclaim', `${previous.token}.json`),
        ).then(
          () => 'present',
          (error) => (error.code === 'ENOENT' ? 'absent' : 'unavailable'),
        );
        ciEvidence.record('ownership-check', {
          trial,
          liveOwners,
          recordedPid: recorded?.pid ?? null,
          recordedToken: recorded?.token ?? null,
          recordedOwnerMatched:
            owners.length === 1 &&
            recorded?.pid === owners[0].pid &&
            recorded?.token === owners[0].token,
          seededMarker,
        });
        console.log(
          JSON.stringify({
            evidence: 'independent-api-lock-contention',
            trial,
            results,
            artifacts: dataDir,
          }),
        );
        assert.equal(
          owners.length,
          1,
          'Expected exactly one live owner after stale-guard reclamation.',
        );
        assert.equal(liveOwners, 1, 'Expected the acquired writer to remain live.');
        assert.equal(recorded?.pid, owners[0].pid);
        assert.equal(recorded?.token, owners[0].token);
        assert.equal(seededMarker, 'absent');
        for (const result of results) {
          if (result.status === 'acquired') continue;
          assert.equal(result.status, 'refused');
          assert.ok(
            isExpectedOwnershipRefusal(result),
            'Expected an ownership refusal without filesystem or cleanup failures.',
          );
        }
      } finally {
        for (const { child } of contenders) child.stdin.end();
        let closedContenders = 0;
        await Promise.all(
          contenders.map(async ({ child, exited }) => {
            const closed = await Promise.race([
              exited.then(() => true),
              sleep(5000).then(() => false),
            ]);
            if (closed) closedContenders++;
            if (!closed) child.kill();
            assert.equal(closed, true, 'Ownership contender did not release on stdin EOF.');
          }),
        ).finally(() =>
          ciEvidence.record('cleanup', {
            action: 'contenders',
            result: closedContenders === contenders.length ? 'closed' : 'killed',
            count: closedContenders,
          }),
        );
        const presence = (path) =>
          lstat(path).then(
            () => 'present',
            (error) => (error.code === 'ENOENT' ? 'absent' : 'unavailable'),
          );
        const main = await presence(join(dataDir, 'graphgoblin.lock'));
        const guard = await presence(join(dataDir, 'graphgoblin.lock.reclaim'));
        const staging = await readdir(dataDir).then(
          (entries) =>
            entries.filter((name) => name.startsWith('graphgoblin.lock.reclaim.')).length,
          () => null,
        );
        const unrelatedIntact = await readFile(join(dataDir, 'unrelated.txt'), 'utf8').then(
          (contents) => contents === 'retain unrelated bytes',
          () => false,
        );
        const released = contenders
          .flatMap((contender) => contender.messages())
          .filter((message) => message.status === 'released').length;
        ciEvidence.record('ownership-cleanup', {
          trial,
          released,
          main,
          guard,
          staging,
          unrelatedIntact,
        });
        assert.equal(released, 1, 'Expected exactly one successful ownership release.');
        assert.equal(main, 'absent');
        assert.equal(guard, 'absent');
        assert.equal(staging, 0);
        assert.equal(unrelatedIntact, true);
      }
    }
  }),
);

/** Complete LF records totalling exactly `bytes`. */
function completeLines(bytes) {
  const buffer = Buffer.alloc(bytes, 0x73);
  for (let index = 99; index < bytes; index += 100) buffer[index] = 0x0a;
  buffer[bytes - 1] = 0x0a;
  return buffer;
}

/** A stopped gateway keeps its log until exit; observe that exact PID disappear. */
async function exited(pid) {
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      process.kill(Number(pid), 0);
    } catch (error) {
      if (error.code === 'ESRCH') return;
      throw error;
    }
    await sleep(50);
  }
  throw new Error(`Gateway ${pid} did not exit after its drain.`);
}

/** A reservation or sharing conflict identifies no holder; shutdown guidance is conditional. */
const destinationInUse =
  /log folder is in use: another process holds the folder's log reservation or has gateway\.log open, and that process was not identified\. If it is a GraphGoblin gateway, possibly an older version still running, shut it down deliberately; otherwise close the program holding the folder or its log\. Launch again once it is released\./;

/** Stand-in for the predecessor's inherited FILE_APPEND_DATA handle, held by another process. */
function holdLegacyAppend(path) {
  const holder = spawn(
    systemTool('WindowsPowerShell/v1.0/powershell.exe'),
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "$f = New-Object IO.FileStream($env:GG_TEST_HELD, [IO.FileMode]::Append, [Security.AccessControl.FileSystemRights]::AppendData, [IO.FileShare]::ReadWrite, 4096, [IO.FileOptions]::None); [Console]::Out.WriteLine('held'); [void][Console]::In.ReadToEnd(); $f.Dispose()",
    ],
    { env: { ...env, GG_TEST_HELD: path }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  const closed = new Promise((resolve) => holder.once('close', resolve));
  const ready = new Promise((resolve, reject) => {
    holder.stdout.on('data', (chunk) => {
      if (String(chunk).includes('held')) resolve();
    });
    holder.once('exit', (code) => reject(new Error(`Legacy append holder exited ${code}`)));
  });
  return {
    ready,
    async release() {
      holder.stdin.end();
      await closed;
    },
  };
}

test(
  'bounded Windows logs: stale entry, closed outcomes, one writer per root, legacy writer and unsafe names',
  { skip: process.platform !== 'win32', timeout: 300_000 },
  ciEvidence.observeTest('bounded-logs', async (t) => {
    await mkdir(join(root, '.tmp'), { recursive: true });
    const base = await mkdtemp(join(root, '.tmp', 'windows-launcher-logs-'));
    ciEvidence.fixture('logs', base);
    const install = await privateDirectory(join(base, 'install α'));
    const canonicalInstall = await realpath(install);
    // Gateway and launcher inherit an isolated TEMP: a no-write witness for managed log names.
    const isolatedTemp = join(base, 'isolated temp');
    await mkdir(isolatedTemp);
    const environment = { ...env, TEMP: isolatedTemp, TMP: isolatedTemp };
    const exe = join(install, 'GraphGoblin.exe');
    const compiler = join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
    await compileLauncher(compiler, exe);
    const launch = (path) =>
      launchNative(exe, path, environment).then(
        (result) => ({ code: 0, ...result }),
        (error) => error,
      );
    // The file shares a 20-port pool. Configurations that are refused before any gateway binds
    // share one port, and each case asserts that nothing ever listens on it.
    const refusalPort = await freePort();
    async function configuration(directory, name, overrides = {}) {
      const config = {
        Repo: root,
        Node: process.execPath,
        DataDir: join(base, `${name}-store`),
        Port: overrides.Port ?? refusalPort,
        StartupTimeoutSeconds: 15,
        WindowTimeoutSeconds: 2,
        ...overrides,
        Environment: { GG_LOG_LEVEL: 'info', ...overrides.Environment, ...providerFree },
      };
      assertProviderFree(config.Environment);
      const path = join(directory, `${name}.json`);
      return { config: await enroll(exe, path, config), path };
    }
    const gatewayLog = join(install, 'gateway.log');
    const launcherRecords = async () =>
      logRecords(await readFile(join(install, 'launcher.log'), 'utf8'));
    const live = [];

    await t.test('native closed outcomes, launcher pair bounds and NUL stdio checks', async () => {
      const checks = join(install, 'NativeChecks.exe');
      await compileChecks(compiler, checks);
      const work = join(base, 'native checks');
      await mkdir(work);
      const enrollment = await execute(checks, ['--enrollment-checks', join(work, 'enrollment')], {
        env: environment,
        windowsHide: true,
        timeout: 60_000,
      });
      assert.match(enrollment.stdout, /enrollment, input binding, strict record and configuration/);
      const handoff = await execute(checks, ['--handoff-checks', join(work, 'handoff')], {
        env: environment,
        windowsHide: true,
        timeout: 60_000,
      });
      assert.match(handoff.stdout, /browser handoff and window mutex checks passed/);
      const result = await execute(checks, ['--bounded-log-checks', work, process.execPath], {
        env: environment,
        windowsHide: true,
        timeout: 60_000,
      });
      assert.match(result.stdout, /bounded log, closed outcome and NUL stdio checks passed/);
      const helpers = await execute(checks, ['--helper-checks', work, process.execPath], {
        env: environment,
        windowsHide: true,
        timeout: 60_000,
      });
      assert.match(helpers.stdout, /Native helper job, pipe and deadline checks passed/);
      const decisions = await execute(checks, ['--cleanup-deadline-checks'], {
        env: environment,
        windowsHide: true,
        timeout: 10_000,
      });
      assert.equal(
        decisions.stdout.trim(),
        'Deterministic cleanup decision checks passed (no kernel fault injected).',
      );
      const workDecisions = await execute(checks, ['--work-deadline-checks'], {
        env: environment,
        windowsHide: true,
        timeout: 10_000,
      });
      assert.equal(
        workDecisions.stdout.trim(),
        'Deterministic caller work deadline checks passed (no scheduling fault injected).',
      );
    });

    await t.test(
      'a stale built entry beside the current guard module refuses before spawn',
      async () => {
        const stale = join(base, 'stale checkout');
        // Only the entry is stale; a disposable helper stub supplies the installer's enrollment.
        for (const [file, contents] of [
          ['apps/api/dist/main.js', 'export const legacyEntry = true;\n'],
          ['apps/api/dist/instance-identity.js', stubEnrollment],
          ['apps/web/dist/index.html', '<html></html>'],
        ]) {
          await mkdir(dirname(join(stale, file)), { recursive: true });
          await writeFile(join(stale, file), contents);
        }
        const guard = join(stale, 'apps/api/dist/windows-log/guard.js');
        await mkdir(dirname(guard), { recursive: true });
        await copyFile(join(root, 'apps/api/dist/windows-log/guard.js'), guard);
        const staleConfig = await configuration(install, 'stale', { Repo: stale });
        const refused = await launch(staleConfig.path);
        assert.equal(refused.code, 1);
        assert.equal(refused.stdout, '');
        assert.match(refused.stderr, /built gateway does not match this launcher/);
        await unlink(guard);
        const missing = await launch(staleConfig.path);
        assert.equal(missing.code, 1);
        assert.match(missing.stderr, /not built: apps\/api\/dist\/windows-log\/guard\.js/);
        assert.equal(await listening(staleConfig.config.Port), false);
        await assert.rejects(lstat(gatewayLog), { code: 'ENOENT' });
        await assert.rejects(lstat(staleConfig.config.DataDir), { code: 'ENOENT' });
        const records = await launcherRecords();
        assert.deepEqual(
          records.map((record) => [record.stage, record.code]),
          [
            ['configuration', 'configuration-refused'],
            ['configuration', 'configuration-refused'],
          ],
        );
      },
    );

    await t.test(
      'an application startup failure reports its written closed diagnostic (74)',
      async () => {
        const corrupt = join(base, 'corrupt.db');
        await writeFile(corrupt, 'GG_PRIVATE_DB_CANARY deliberately not SQLite');
        const failing = await configuration(install, 'startup-failure', {
          Environment: {
            GG_LOG_LEVEL: 'info',
            GG_OLLAMA_ENABLED: 'false',
            GG_DB_URL: 'file:' + corrupt.replaceAll('\\', '/'),
          },
          StartupTimeoutSeconds: 60,
        });
        const refused = await launch(failing.path);
        assert.equal(refused.code, 1);
        assert.match(
          refused.stderr,
          /failed during startup\. A startup diagnostic naming the failed stage was written/,
        );
        assert.ok(refused.stderr.includes(`Log folder: ${canonicalInstall}`));
        assert.doesNotMatch(refused.stderr, /CANARY|SQLITE|not a database/i);
        const last = logRecords(await readFile(gatewayLog, 'utf8')).at(-1);
        assert.deepEqual(Object.keys(last).sort(), [
          'cause',
          'detail',
          'guidance',
          'level',
          'msg',
          'pid',
          'stage',
          'time',
        ]);
        assert.deepEqual(
          [last.msg, last.stage, last.cause],
          ['GraphGoblin startup failed', 'store', 'store-unavailable'],
        );
        const recorded = (await launcherRecords()).at(-1);
        assert.deepEqual([recorded.code, recorded.childExit], ['startup-failed-logged', 74]);
        assert.equal(await listening(failing.config.Port), false);
        await assert.rejects(lstat(join(failing.config.DataDir, 'graphgoblin.lock')), {
          code: 'ENOENT',
        });
      },
    );

    await t.test('held ownership retains guidance and budgets the last recheck', async () => {
      // A tiny isolated built checkout replaces only the read-only protocol fixture. Its
      // main records a spawn then exits; no real gateway, store or owner PID is involved.
      for (const scenario of ['too-late', 'stalled-recheck', 'released']) {
        const fixture = join(base, scenario);
        const samples = join(fixture, 'samples');
        const spawned = join(fixture, 'spawned');
        const lock = join(fixture, 'graphgoblin.lock');
        const marker = JSON.stringify({ pid: 1, token: randomUUID(), fixture: true });
        for (const directory of ['apps/api/dist/windows-log', 'apps/web/dist'])
          await mkdir(join(fixture, directory), { recursive: true });
        await writeFile(lock, marker);
        const before = await stat(lock, { bigint: true });
        await writeFile(join(fixture, 'apps/web/dist/index.html'), '<html></html>');
        await writeFile(join(fixture, 'apps/api/dist/windows-log/guard.js'), '');
        await writeFile(
          join(fixture, 'apps/api/dist/main.js'),
          `export const WINDOWS_LAUNCHER_LOG_PROTOCOL = 1;\nimport fs from 'node:fs';fs.writeFileSync(${JSON.stringify(spawned)},'spawned');process.exit(75);`,
        );
        await writeFile(
          join(fixture, 'apps/api/dist/instance-identity.js'),
          `${stubEnrollment}import fs from 'node:fs';
          if(process.argv[2]!=='--store-state'){process.stdout.write('a'.repeat(64));}
          else {
            const file=${JSON.stringify(samples)};
            const count=fs.existsSync(file)?Number(fs.readFileSync(file,'utf8')):0;
            fs.writeFileSync(file,String(count+1));
            if(count===0) setTimeout(()=>process.stdout.write(JSON.stringify({state:'held',path:${JSON.stringify(lock)},detail:'another GraphGoblin process holds this store'})),600);
            else if(${JSON.stringify(scenario)}==='released') process.stdout.write('{"state":"free"}');
            else setInterval(()=>{},1000);
          }`,
        );
        const attempt = await configuration(install, `held-${scenario}`, {
          Repo: fixture,
          // Ten seconds leaves room for the measured first sample and the real TCP probe,
          // while still forcing a final stalled query below the helper's 15-second cap.
          StartupTimeoutSeconds: scenario === 'too-late' ? 2 : 10,
        });
        const started = performance.now();
        const result = await launch(attempt.path);
        const elapsed = performance.now() - started;
        assert.equal(result.code, 1);
        assert.ok(elapsed < 13_000, `The ${scenario} refusal exceeded bounded work and cleanup.`);
        assert.equal(await readFile(lock, 'utf8'), marker);
        const after = await stat(lock, { bigint: true });
        assert.deepEqual([after.dev, after.ino], [before.dev, before.ino]);
        assert.equal(await readFile(samples, 'utf8'), scenario === 'too-late' ? '1' : '2');
        if (scenario === 'released') {
          assert.equal(await readFile(spawned, 'utf8'), 'spawned');
          assert.match(result.stderr, /failed during startup, and no startup diagnostic/);
        } else {
          await assert.rejects(lstat(spawned), { code: 'ENOENT' });
          assert.match(result.stderr, /another GraphGoblin process holds this store/);
          assert.match(result.stderr, /No second gateway was started/);
          assert.match(
            result.stderr,
            /Do not stop an unrelated process or delete an unverified lock/,
          );
          assert.equal((await launcherRecords()).at(-1).code, 'store-held');
        }
      }
    });

    await t.test(
      'ownership admission requires strict raw JSON and preserves held refusals',
      async () => {
        // Only the disposable helper protocol/main are stubbed. The shipped compiled launcher
        // admits or refuses startup through its public entry; no real owner or WMI is simulated.
        const fixture = join(base, 'strict protocol fixture');
        const payload = join(fixture, 'payload');
        const samples = join(fixture, 'samples');
        const mode = join(fixture, 'mode');
        const spawned = join(fixture, 'spawned');
        const canary = 'GG_STRICT_OWNERSHIP_CANARY';
        for (const directory of ['apps/api/dist/windows-log', 'apps/web/dist'])
          await mkdir(join(fixture, directory), { recursive: true });
        await writeFile(join(fixture, 'apps/web/dist/index.html'), '<html></html>');
        await writeFile(join(fixture, 'apps/api/dist/windows-log/guard.js'), '');
        await writeFile(
          join(fixture, 'apps/api/dist/main.js'),
          `export const WINDOWS_LAUNCHER_LOG_PROTOCOL = 1;\nimport fs from 'node:fs';fs.writeFileSync(${JSON.stringify(spawned)},'spawned');process.exit(75);`,
        );
        await writeFile(
          join(fixture, 'apps/api/dist/instance-identity.js'),
          `${stubEnrollment}import fs from 'node:fs';import path from 'node:path';
        process.stderr.write(${JSON.stringify(canary)});
        if(process.argv[2]!=='--store-state')process.stdout.write('a'.repeat(64)+'\\n');
        else {
          const count=Number(fs.readFileSync(${JSON.stringify(samples)},'utf8'));
          fs.writeFileSync(${JSON.stringify(samples)},String(count+1));
          process.stdout.write(count===0&&fs.readFileSync(${JSON.stringify(mode)},'utf8')==='retained'
            ?JSON.stringify({state:'held',path:path.join(process.env.GG_DATA_DIR,'graphgoblin.lock'),detail:'another GraphGoblin process holds this store'})+'\\n'
            :fs.readFileSync(${JSON.stringify(payload)},'utf8'));
        }`,
        );
        const cases = [
          ['javascript-lines', "{\nstate:'free'\n}", 'invalid'],
          ['single-quotes', "{'state':'free'}", 'invalid'],
          ['duplicate-held-free', '{"state":"held","state":"free"}', 'invalid'],
          [
            'duplicate-free-held',
            '{"state":"free","state":"held","path":"x","detail":"x"}',
            'invalid',
          ],
          ['escaped-duplicate', '{"state":"held","\\u0073tate":"free"}', 'invalid'],
          [
            'duplicate-path',
            '{"state":"held","path":"x","p\\u0061th":"y","detail":"x"}',
            'invalid',
          ],
          ['unknown-field', JSON.stringify({ state: 'free', extra: canary }), 'invalid'],
          ['trailing-object', '{"state":"free"}{"state":"free"}', 'invalid'],
          ['trailing-comma', '{"state":"free",}', 'invalid'],
          ['comment', `{"state":/*${canary}*/"free"}`, 'invalid'],
          ['raw-string-lf', '{"state":"fr\nee"}', 'invalid'],
          ['bad-escape', '{"state":"\\x66ree"}', 'invalid'],
          ['bad-unicode', '{"state":"\\u00g0"}', 'invalid'],
          ['apostrophe-escape', '{"state":"fr\\\'ee"}', 'invalid'],
          ['outer-non-json', '\u00a0{"state":"free"}\u00a0', 'invalid'],
          ['wrong-type', '{"state":null}', 'invalid'],
          ['nested-value', '{"state":{"state":"free"}}', 'invalid'],
          ['empty-object', '{}', 'invalid'],
          ['unknown-state', '{"state":"other"}', 'invalid'],
          ['free-with-held-fields', '{"state":"free","path":"x","detail":"x"}', 'invalid'],
          ['held-missing', '{"state":"held","path":"x"}', 'invalid'],
          ['held-blank', '{"state":"held","path":" ","detail":"x"}', 'invalid'],
          ['held-blank-detail', '{"state":"held","path":"x","detail":" "}', 'invalid'],
          ['producer-free', JSON.stringify({ state: 'free' }) + '\n', 'free'],
          ['json-whitespace', ' \t\r\n{ "state" \t: "free" }\r\n', 'free'],
          ['escaped-free', '{"st\\u0061te":"fr\\u0065e"}\n', 'free'],
          [
            'producer-held',
            (lock) =>
              JSON.stringify({
                state: 'held',
                path: lock,
                detail: `another GraphGoblin process holds this store ${canary}`,
              }) + '\n',
            'held',
          ],
          [
            'escaped-reordered-held',
            (lock) =>
              `{"detail":"another GraphGoblin process holds this store \\b\\f\\n\\r\\t \\/ \\" \\\\ ${canary}","p\\u0061th":${JSON.stringify(lock).replaceAll('α', '\\u03b1').replaceAll('🦊', '\\ud83e\\udd8a')},"st\\u0061te":"h\\u0065ld"}\n`,
            'held',
          ],
          ['held-then-duplicate', '{"state":"held","\\u0073tate":"free"}', 'retained'],
          ['held-then-non-json', '\u00a0{"state":"free"}', 'retained'],
        ];
        for (const [name, response, expected] of cases) {
          const attempt = await configuration(install, `strict-${name}`, {
            Repo: fixture,
            DataDir: join(fixture, `store α 🦊 ${name}`),
            StartupTimeoutSeconds: expected === 'retained' ? 10 : 1,
          });
          await mkdir(attempt.config.DataDir);
          const originals = [];
          for (const file of [
            'graphgoblin.lock',
            'graphgoblin.lock.reclaim',
            'graphgoblin.db.graphgoblin.lock',
            'graphgoblin.db.graphgoblin.lock.reclaim',
          ]) {
            const path = join(attempt.config.DataDir, file);
            const original = await ownershipFixture(path, { pid: 1, token: randomUUID() });
            originals.push({ ...original, identity: await stat(original.path, { bigint: true }) });
            if (file.endsWith('.reclaim'))
              originals.push({ path, identity: await stat(path, { bigint: true }) });
          }
          const lock = join(attempt.config.DataDir, 'graphgoblin.lock');
          await writeFile(payload, typeof response === 'function' ? response(lock) : response);
          await writeFile(samples, '0');
          await writeFile(mode, expected);
          const result = await launch(attempt.path);
          assert.equal(result.code, 1, name);
          assert.equal(result.stdout, '', name);
          assert.ok(!result.stderr.includes(canary), name);
          const recorded = (await launcherRecords()).at(-1);
          assert.ok(!JSON.stringify(recorded).includes(canary), name);
          if (expected === 'free') {
            assert.equal(await readFile(spawned, 'utf8'), 'spawned', name);
            assert.equal(recorded.code, 'startup-failed-unlogged', name);
            await unlink(spawned);
          } else {
            await assert.rejects(lstat(spawned), { code: 'ENOENT' }, name);
            assert.equal(
              recorded.code,
              expected === 'invalid' ? 'helper-invalid' : 'store-held',
              name,
            );
            if (expected !== 'invalid') {
              assert.equal(recorded.lock, lock, name);
              assert.match(result.stderr, /No second gateway was started/, name);
              assert.match(
                result.stderr,
                /Do not stop an unrelated process or delete an unverified lock/,
                name,
              );
            }
          }
          assert.equal(await readFile(samples, 'utf8'), expected === 'retained' ? '2' : '1', name);
          for (const original of originals) {
            const after = await stat(original.path, { bigint: true });
            assert.deepEqual(
              [after.dev, after.ino],
              [original.identity.dev, original.identity.ino],
              name,
            );
            if (original.contents !== undefined)
              assert.equal(await readFile(original.path, 'utf8'), original.contents, name);
          }
        }
      },
    );

    const primary = await configuration(install, 'primary', { Port: await freePort() });
    try {
      await t.test(
        'one writer per physical root refuses a junction contender and a disjoint store and port',
        async () => {
          const started = await launch(primary.path);
          assert.deepEqual([started.code, started.stdout, started.stderr], [0, '', '']);
          live.push(primary.config);
          const owner = await health(primary.config);
          const logBefore = await stat(gatewayLog, { bigint: true });
          const alias = join(base, 'log root junction');
          await symlink(install, alias, 'junction');
          const contenderStore = join(base, 'contender-store');
          await mkdir(contenderStore);
          // The contender exits before binding; it shares the never-bound refusal port.
          const contenderPort = refusalPort;
          const contender = await execute(process.execPath, [join(root, 'apps/api/dist/main.js')], {
            cwd: root,
            env: {
              ...environment,
              GG_WINDOWS_LAUNCHER_LOG_DIR: alias,
              GG_DATA_DIR: contenderStore,
              GG_HOST: '127.0.0.1',
              GG_PORT: String(contenderPort),
              GG_WEB_DIST: join(root, 'apps/web/dist'),
              GG_OLLAMA_ENABLED: 'false',
            },
            windowsHide: true,
            timeout: 30_000,
          }).then(
            (result) => ({ code: 0, ...result }),
            (error) => error,
          );
          assert.deepEqual([contender.code, contender.stdout, contender.stderr], [70, '', '']);
          assert.deepEqual(await readdir(contenderStore), []);
          assert.equal(await listening(contenderPort), false);
          assert.deepEqual(await health(primary.config), owner);
          assert.equal((await stat(gatewayLog, { bigint: true })).ino, logBefore.ino);

          const disjoint = await configuration(install, 'disjoint', { StartupTimeoutSeconds: 1 });
          const refused = await launch(disjoint.path);
          assert.equal(refused.code, 1);
          // A live gateway holds the log here, yet the sharing violation alone does not show it.
          assert.match(refused.stderr, destinationInUse);
          assert.doesNotMatch(refused.stderr, /by another GraphGoblin gateway/);
          assert.equal(await listening(disjoint.config.Port), false);
          await assert.rejects(lstat(disjoint.config.DataDir), { code: 'ENOENT' });
          assert.deepEqual(await health(primary.config), owner);
          assert.equal((await stat(gatewayLog, { bigint: true })).ino, logBefore.ino);
          const refusal = (await launcherRecords()).at(-1);
          assert.deepEqual([refusal.code, refusal.childExit], ['destination-in-use', undefined]);

          const otherDirectory = await privateDirectory(join(base, 'other config'));
          const warm = await configuration(otherDirectory, 'warm', { ...primary.config });
          const reused = await launch(warm.path);
          assert.deepEqual([reused.code, reused.stdout, reused.stderr], [0, '', '']);
          assert.deepEqual(await health(primary.config), owner);
          await assert.rejects(lstat(join(otherDirectory, 'gateway.log')), { code: 'ENOENT' });
          await unlink(alias);
        },
      );

      await t.test(
        'deliberate stop, legacy append writer refusal and oversized history replacement',
        async () => {
          const first = await health(primary.config);
          await stop(primary.config);
          // The stopped gateway keeps its log until process exit; an immediate click waits.
          const relaunched = await launch(primary.path);
          assert.deepEqual([relaunched.code, relaunched.stderr], [0, '']);
          const second = await health(primary.config);
          assert.notEqual(second.pid, first.pid);
          await stop(primary.config);
          await exited(second.pid);

          const blocked = await configuration(install, 'legacy-blocked', {
            StartupTimeoutSeconds: 1,
          });
          const holder = holdLegacyAppend(gatewayLog);
          try {
            await holder.ready;
            const before = await readFile(gatewayLog);
            const refused = await launch(blocked.path);
            assert.equal(refused.code, 1);
            // The holder here is not a gateway; the same neutral guidance applies.
            assert.match(refused.stderr, destinationInUse);
            assert.doesNotMatch(refused.stderr, /by another GraphGoblin gateway/);
            assert.equal(await listening(blocked.config.Port), false);
            await assert.rejects(lstat(blocked.config.DataDir), { code: 'ENOENT' });
            assert.deepEqual(await readFile(gatewayLog), before);
          } finally {
            await holder.release();
          }

          await writeFile(gatewayLog, completeLines(4 * 1024 * 1024 + 100));
          const replaced = await launch(primary.path);
          assert.deepEqual([replaced.code, replaced.stderr], [0, '']);
          const third = await health(primary.config);
          const bytes = await readFile(gatewayLog);
          assert.ok(bytes.length < 64 * 1024, 'Oversized stopped-writer history must be replaced.');
          const records = logRecords(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
          assert.ok(records.some((record) => String(record.pid) === third.pid));
          await stop(primary.config);
          await exited(third.pid);
        },
      );
    } finally {
      for (const config of live) await stop(config);
    }

    await t.test('unsafe managed names are refused and their targets preserved', async () => {
      const target = join(base, 'protected target.log');
      await writeFile(target, 'protected bytes');
      const previous = join(install, 'gateway.log.1');
      await unlink(previous).catch(() => undefined);
      await link(target, previous);
      const unsafe = await configuration(install, 'unsafe', { StartupTimeoutSeconds: 1 });
      const before = await readFile(gatewayLog);
      const refused = await launch(unsafe.path);
      assert.equal(refused.code, 1);
      assert.match(refused.stderr, /log folder is unsafe or unavailable/);
      assert.equal(await readFile(target, 'utf8'), 'protected bytes');
      assert.equal((await stat(target)).nlink, 2);
      assert.deepEqual(await readFile(gatewayLog), before);
      assert.equal(await listening(unsafe.config.Port), false);
      await unlink(previous);
    });

    // Fixed inventory and bounds; no managed TEMP, staging or spill names anywhere.
    assert.deepEqual(
      (await readdir(isolatedTemp)).filter((name) => /(gateway|launcher)\.log/i.test(name)),
      [],
    );
    const managed = (await readdir(install)).filter((name) => /\.log/i.test(name));
    for (const name of managed)
      assert.ok(
        ['gateway.log', 'gateway.log.1', 'launcher.log', 'launcher.log.1'].includes(name),
        `Unexpected managed log name ${name}`,
      );
    assert.ok((await stat(gatewayLog)).size <= 4 * 1024 * 1024);
    assert.ok((await stat(join(install, 'launcher.log'))).size <= 256 * 1024);
    console.log(JSON.stringify({ evidence: 'windows-launcher-bounded-logs', artifacts: base }));
  }),
);

/**
 * A stub child's environment report: names only (never values), plus the provider setting and an
 * ordinary control variable, written where the inherited GRAPHGOBLIN_FIXTURE_REPORTS points.
 */
const childReport = (role) => `import fs from 'node:fs';import path from 'node:path';
{const names=Object.keys(process.env),reports=process.env.GRAPHGOBLIN_FIXTURE_REPORTS;
if(reports)fs.writeFileSync(path.join(reports,${JSON.stringify(role)}+'-'+String(process.argv[2]??'main').replace(/^-+/,'')+'-'+process.pid+'.json'),JSON.stringify({
role:${JSON.stringify(role)},mode:process.argv[2]??null,
jevNames:names.filter(n=>n.toUpperCase()==='JEV_API_KEY').length,
mixedGgNames:names.filter(n=>n.toUpperCase().startsWith('GG_')&&n!==n.toUpperCase()).length,
ollama:names.filter(n=>n.toUpperCase()==='GG_OLLAMA_ENABLED').map(n=>[n,process.env[n]]),
control:process.env.GRAPHGOBLIN_FIXTURE_CONTROL??null}));}
`;

// Focused #566/#544 review-1 regressions: bounded entries into the same compiled launcher,
// NativeChecks and fixture helpers, with disposable stores and two pooled loopback ports.
test(
  'native Windows warm review1 owned fixture and handoff regressions',
  { skip: process.platform !== 'win32', timeout: 180_000 },
  async (t) => {
    await mkdir(join(root, '.tmp'), { recursive: true });
    const base = await mkdtemp(join(root, '.tmp', 'windows-launcher-review1-'));
    ciEvidence.fixture('launcher', base);
    const install = await privateDirectory(join(base, 'install α'));
    const exe = join(install, 'GraphGoblin.exe');
    const compiler = join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
    await compileLauncher(compiler, exe);
    const checks = join(install, 'NativeChecks.exe');
    await compileChecks(compiler, checks);
    // Reused in sequence: the owned gateways' port, and a spare one for a redirect target or for
    // starts that never bind.
    const ownedPort = await freePort();
    const sparePort = await freePort();
    async function configuration(directory, name, overrides = {}, host = env) {
      const config = {
        Repo: root,
        Node: process.execPath,
        DataDir: join(base, `${name}-store`),
        Port: ownedPort,
        StartupTimeoutSeconds: 15,
        WindowTimeoutSeconds: 2,
        ...overrides,
        Environment: { GG_LOG_LEVEL: 'info', ...overrides.Environment, ...providerFree },
      };
      assertProviderFree(config.Environment);
      const path = join(directory, `${name}.json`);
      return { config: await enroll(exe, path, config, host), path };
    }
    const shutdownState = async (config) => {
      const response = await fetch(origin(config) + '/system/shutdown', {
        redirect: 'error',
        signal: AbortSignal.timeout(3000),
      });
      assert.equal(response.status, 200);
      const { phase, controlToken } = await response.json();
      return { phase, controlToken };
    };
    /** A manual start is settled as its verified owner, else through its exact retained child. */
    const settle = async (start, gateway) => {
      if (!gateway) return;
      try {
        if (gateway.child.exitCode === null)
          await releaseAliasGateway(start, gateway.running.identity, gateway.owner);
      } finally {
        if (gateway.child.exitCode === null && gateway.child.signalCode === null)
          gateway.child.kill();
        await bounded(gateway.exited, 10_000, 'A manual fixture gateway');
      }
    };

    await t.test(
      'owned cleanup refuses a replacement listener with zero drains',
      { timeout: 120_000 },
      async () => {
        const directory = await privateDirectory(join(base, 'owned cleanup'));
        const owned = await configuration(directory, 'owned');
        let first;
        let second;
        try {
          first = await manualGateway(owned.config);
          const { running, owner } = first;
          assert.equal(running.launch, owned.config.Enrollment.Launch);
          const before = await shutdownState(owned.config);
          // Changed lease bytes, creation identity or PID, or no verified owner: each is refused
          // before any shutdown request, so the live incarnation keeps running untouched.
          for (const stale of [
            { ...owner, leases: { ...owner.leases, 'graphgoblin.lock': '0'.repeat(64) } },
            { ...owner, birth: String(BigInt(owner.birth) - 1n) },
            { ...owner, pid: owner.pid + 4 },
            undefined,
          ]) {
            await assert.rejects(releaseAliasGateway(owned, running.identity, stale));
            assert.deepEqual(await health(owned.config), running);
            assert.deepEqual(await shutdownState(owned.config), before);
          }
          // A replacement presenting the released owner's exact headers receives no drain.
          const headers = {
            'x-graphgoblin-instance': running.identity,
            'x-graphgoblin-launch-identity': running.launch,
            'x-graphgoblin-pid': running.pid,
            'x-graphgoblin-phase': 'running',
          };
          // Post-proof handover: after the outer drain's final positive proof on its retained
          // connection, the first real positive drain releases that gateway through a separately
          // verified session, the exact fixture settles, and a replacement binds the port. The
          // outer drain must then refuse to reconnect, so the replacement receives no request.
          let replacement;
          const handover = { ran: false };
          try {
            const outer = await releaseAliasGateway(owned, running.identity, owner, {
              async afterProof({ retained }) {
                handover.ran = true;
                // Positive control: the verified owner drains; PID, listener, leases are released.
                handover.drained = await releaseAliasGateway(owned, running.identity, owner);
                await bounded(first.exited, 10_000, 'The drained manual gateway');
                await bounded(retained, 10_000, 'The outer retained connection');
                replacement = await replacementListener(ownedPort, { headers });
                handover.listening = await listening(ownedPort);
              },
            }).then(
              () => assert.fail('The outer drain completed after its gateway was replaced.'),
              (error) => error,
            );
            // The raw failure is kept when the refusal is not the session's own.
            if (outer?.code !== sessionReconnectRefused) throw outer;
            assert.equal(handover.ran, true, 'The post-proof handover did not run.');
            assert.equal(handover.drained, 'drained-pid-listener-leases');
            assert.equal(handover.listening, true, 'The replacement did not listen.');
            assert.ok(
              !outer.written.includes('POST /system/shutdown'),
              `The outer session wrote a drain: ${JSON.stringify(outer.written)}`,
            );
            assert.deepEqual(replacement.requests, [], 'The replacement received a request.');
            handover.replacementDrains = replacement.drains();
            assert.equal(handover.replacementDrains, 0, 'A replacement listener received a drain.');
            for (const stale of [owner, undefined])
              await assert.rejects(releaseAliasGateway(owned, running.identity, stale));
            assert.equal(replacement.drains(), 0, 'A replacement listener received a drain.');
            assert.ok(
              replacement.requests.every((request) => request === 'GET /healthz'),
              `Unexpected replacement requests: ${JSON.stringify(replacement.requests)}`,
            );
          } finally {
            await replacement?.close();
          }
          // A redirect is never followed, so its target receives nothing.
          const target = await replacementListener(sparePort, { headers });
          const redirecting = await replacementListener(ownedPort, {
            redirect: `http://127.0.0.1:${sparePort}/healthz`,
          });
          try {
            await assert.rejects(releaseAliasGateway(owned, running.identity, owner));
            assert.deepEqual(target.requests, [], 'A redirect was followed.');
            assert.equal(redirecting.drains(), 0);
          } finally {
            await redirecting.close();
            await target.close();
          }
          // A later real gateway on the port is another incarnation with the same digests.
          second = await manualGateway(owned.config);
          assert.equal(second.running.identity, running.identity);
          assert.notEqual(second.owner.birth, owner.birth);
          const current = await shutdownState(owned.config);
          await assert.rejects(releaseAliasGateway(owned, running.identity, owner));
          assert.deepEqual(await shutdownState(owned.config), current);
          assert.equal(
            await releaseAliasGateway(owned, second.running.identity, second.owner),
            'drained-pid-listener-leases',
          );
          await bounded(second.exited, 10_000, 'The second drained manual gateway');
          console.log(
            JSON.stringify({
              evidence: 'windows-launcher-owned-cleanup',
              staleRefusals: 4,
              replacementDrains: replacement.drains(),
              redirectTargetRequests: target.requests.length,
              incarnationRefused: true,
              ownedDrains: 2,
              postProofHandoverVenue: 'real-owned-gateway',
              postProofReplacementDrains: handover.replacementDrains,
              postProofConnectionRefused: true,
            }),
          );
        } finally {
          await settle(owned, second);
          await settle(owned, first);
        }
      },
    );

    await t.test(
      'owned compatible control remains alive until explicit release',
      { timeout: 120_000 },
      async (t) => {
        const directory = await privateDirectory(join(base, 'owned control'));
        const control = await configuration(directory, 'control');
        const owner = ownJob(checks, ['--job-owner', exe, control.path], t.signal);
        let released;
        try {
          const report = await owner.report;
          assert.equal(report.fixtureFailure, undefined, 'The control job fixture failed.');
          assert.equal(report.holding, true);
          assert.equal(Number(report.readback.flags) & 0x8, 0, 'The control job has a limit.');
          assert.notEqual(
            Number(report.readback.flags) & 0x2000,
            0,
            'The job is not kill-on-close.',
          );
          const [started] = report.phases;
          assert.deepEqual([started.exit, started.stdout, started.stderr], [0, '', '']);
          assert.equal(started.window.observer, 'fenced-quiet');
          const running = await health(control.config);
          assert.equal(running.launch, control.config.Enrollment.Launch);
          assert.ok(started.window.admitted.includes(started.launcherPid));
          assert.ok(
            started.window.admitted.includes(Number(running.pid)),
            'The gateway is not a member of the owned job.',
          );
          assert.ok(started.window.admitted.length >= 3, 'No contained helper was admitted.');
          const gateway = await ownedAliasGateway(control.config, running.identity);
          // The owner has reported yet still holds its job: the gateway lives on, warm-reused.
          await sleep(1500);
          assert.equal(owner.child.exitCode, null, 'The job owner exited before its release.');
          const warm = await launchNative(exe, control.path);
          assert.deepEqual([warm.stdout, warm.stderr], ['', '']);
          assert.deepEqual(await health(control.config), running);
          assert.deepEqual(await ownedAliasGateway(control.config, running.identity), gateway);
          // Release through the verified owner first, then the job owner's explicit release.
          assert.equal(
            await releaseAliasGateway(control, running.identity, gateway),
            'drained-pid-listener-leases',
          );
          released = await owner.release();
          assert.deepEqual(
            [released.code, released.released, released.siblingAlive, released.siblingSettled],
            [0, 'explicit', true, true],
          );
          assert.deepEqual(
            [released.final.active, released.final.pids],
            [2, [report.selfPid, report.siblingPid].sort((a, b) => a - b)],
            'Only the owner and its sibling may remain in the job at release.',
          );
          console.log(
            JSON.stringify({
              evidence: 'windows-launcher-owned-control',
              readbackFlags: report.readback.flags,
              gatewayPid: gateway.pid,
              released: released.released,
              final: released.final,
            }),
          );
        } finally {
          if (!released) await owner.release().catch(() => undefined);
        }
      },
    );

    await t.test(
      'cancellation before health settles owned startup descendants',
      { timeout: 90_000 },
      async () => {
        const directory = await privateDirectory(join(base, 'owned cancellation'));
        const startedFile = join(base, 'cancellation started.json');
        const spawns = join(base, 'cancellation spawns.log');
        // A gateway that starts a detached descendant, records its family and never listens.
        const checkout = await stubCheckout(join(base, 'starting checkout'), {
          identity: `${stubEnrollment}if(process.argv[2]==='--store-state')process.stdout.write('{"state":"free"}\\n');`,
          main: `import fs from 'node:fs';import {spawn} from 'node:child_process';
const descendant=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore',windowsHide:true});
descendant.unref();
fs.appendFileSync(${JSON.stringify(spawns)},process.pid+'\\n');
fs.writeFileSync(${JSON.stringify(startedFile + '.tmp')},JSON.stringify({launcher:process.ppid,gateway:process.pid,descendant:descendant.pid}));
fs.renameSync(${JSON.stringify(startedFile + '.tmp')},${JSON.stringify(startedFile)});
setInterval(()=>{},1000);`,
        });
        const starting = await configuration(directory, 'starting', {
          Repo: checkout,
          Port: sparePort,
          StartupTimeoutSeconds: 60,
        });
        // The same abort path a cancelled or timed-out test signal takes.
        const cancel = new globalThis.AbortController();
        const owner = ownJob(checks, ['--job-owner', exe, starting.path], cancel.signal);
        // An unrelated process outside the owned job: it must survive the cancellation.
        const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
          env,
          windowsHide: true,
          stdio: 'ignore',
        });
        const unrelatedExited = new Promise((resolve) => unrelated.once('exit', resolve));
        let witness;
        try {
          const family = await writtenJson(
            startedFile,
            30_000,
            () => owner.child.exitCode !== null,
          );
          // Cancelled while starting: nothing listens and no health was ever observed.
          assert.equal(await listening(sparePort), false);
          const members = [family.launcher, family.gateway, family.descendant];
          witness = await exitWitness(checks, members, [unrelated.pid]);
          assert.ok(
            witness.held.every((entry) => entry.alive),
            `Every exact member must be held alive: ${JSON.stringify(witness.held)}`,
          );
          cancel.abort();
          await assert.rejects(owner.report, /cancelled/);
          const results = await witness.settle();
          witness = undefined;
          for (const pid of members) {
            const result = results.find((entry) => entry.pid === pid);
            assert.equal(result?.exited, true, `Owned member ${pid} survived its cancelled owner.`);
          }
          assert.equal(
            results.find((entry) => entry.pid === unrelated.pid)?.exited,
            false,
            'An unrelated process was stopped.',
          );
          // Settled: no late listener and no second gateway start.
          await sleep(1000);
          assert.equal(await listening(sparePort), false);
          assert.equal((await readFile(spawns, 'utf8')).trim().split('\n').length, 1);
          console.log(
            JSON.stringify({
              evidence: 'windows-launcher-owned-cancellation',
              held: members,
              results,
            }),
          );
        } finally {
          await owner.cancel();
          await witness?.abandon();
          if (unrelated.exitCode === null && unrelated.signalCode === null) unrelated.kill();
          await bounded(unrelatedExited, 10_000, 'The unrelated sentinel');
        }
      },
    );

    await t.test('native case-only target comparison preserves object identity', async () => {
      const result = await execute(
        checks,
        ['--enrollment-checks', join(base, 'enrollment checks')],
        {
          env,
          windowsHide: true,
          timeout: 60_000,
        },
      );
      assert.match(
        result.stdout,
        /store-identity controlled-comparison distinct-object=refused equal-low-different-high=refused equal-full-id=accepted other-volume=refused unavailable-id=refused; real-handle case-alias=accepted different-object=refused/,
      );
      assert.match(result.stdout, /enrollment, input binding, strict record and configuration/);
      // Qualified: controlled full-ID comparisons, not a case-sensitive volume or ReFS witness.
      console.log(
        JSON.stringify({
          evidence: 'windows-launcher-store-identity',
          distinctCaseOnlyObjects: 'controlled-native-identity-comparison',
          caseSensitiveDirectoryWitness: false,
          equalLowDifferentHighRefused: true,
          equalFullIdentityAccepted: true,
        }),
      );
    });

    await t.test('mixed-case Jev sentinel is absent from fixture children', async (t) => {
      const directory = await privateDirectory(join(base, 'sanitized children'));
      // Artificial only: never a real credential, and no child reports any variable's value.
      const sentinel = `ARTIFICIAL_JEV_SENTINEL_${randomUUID()}`;
      const checkout = await stubCheckout(join(base, 'environment checkout'), {
        identity: `${childReport('helper')}${stubEnrollment}if(process.argv[2]==='--store-state')process.stdout.write('{"state":"free"}\\n');`,
        main: `${childReport('gateway')}process.exit(75);`,
      });
      const reportsOf = async (name) => {
        const reports = join(base, 'environment reports', name);
        await mkdir(reports, { recursive: true });
        return reports;
      };
      const read = async (reports) =>
        Promise.all(
          (await readdir(reports))
            .sort()
            .map(async (file) => JSON.parse(await readFile(join(reports, file), 'utf8'))),
        );
      // Inherited pollution: mixed-case Jev and GG_* spellings beside an ordinary control name.
      const polluted = (reports) => ({
        ...env,
        Jev_Api_Key: sentinel,
        jEV_aPI_kEY: sentinel,
        gg_Master_Key: sentinel,
        Gg_Ollama_Enabled: 'true',
        GRAPHGOBLIN_FIXTURE_REPORTS: reports,
        GRAPHGOBLIN_FIXTURE_CONTROL: 'present',
      });
      const host = (reports) => fixtureEnvironment(polluted(reports));

      // Detector control: a deliberately unsanitized child does observe the pollution.
      const unsanitized = await reportsOf('unsanitized');
      await execute(process.execPath, [join(checkout, 'apps/api/dist/main.js')], {
        cwd: checkout,
        env: polluted(unsanitized),
        windowsHide: true,
        timeout: 15_000,
      }).catch((error) => error);
      const [detected] = await read(unsanitized);
      assert.ok(
        detected?.jevNames >= 1 && detected.mixedGgNames >= 1 && detected.control === 'present',
        'The child environment detector did not observe unsanitized pollution.',
      );

      const children = {};
      const enrollmentReports = await reportsOf('enrollment');
      const sanitized = await configuration(
        directory,
        'sanitized',
        {
          Repo: checkout,
          Port: sparePort,
          Environment: { GG_LOG_LEVEL: 'debug', GG_REQUIRE_API_KEY: 'false' },
        },
        host(enrollmentReports),
      );
      children.enrollment = await read(enrollmentReports);
      const launcherReports = await reportsOf('launcher');
      const refused = await launchNative(exe, sanitized.path, host(launcherReports)).catch(
        (error) => error,
      );
      assert.equal(refused.code, 1);
      assert.match(refused.stderr, /failed during startup, and no startup diagnostic/);
      children.launcher = await read(launcherReports);
      const manualReports = await reportsOf('manual');
      await assert.rejects(
        manualGateway(sanitized.config, host(manualReports)),
        /Manual gateway exited 75/,
      );
      children.manual = await read(manualReports);
      const ownerReports = await reportsOf('job-owner');
      const owner = ownJob(
        checks,
        ['--job-owner', exe, sanitized.path],
        t.signal,
        host(ownerReports),
      );
      try {
        const report = await owner.report;
        assert.equal(report.fixtureFailure, undefined);
        assert.equal(report.phases[0].exit, 1);
      } finally {
        await owner.release().catch(() => undefined);
      }
      children['job-owner'] = await read(ownerReports);

      const roles = (reports) => [...new Set(reports.map((report) => report.role))].sort();
      assert.deepEqual(roles(children.enrollment), ['helper']);
      assert.deepEqual(roles(children.launcher), ['gateway', 'helper']);
      assert.deepEqual(roles(children.manual), ['gateway']);
      assert.deepEqual(roles(children['job-owner']), ['gateway', 'helper']);
      for (const [start, reports] of Object.entries(children))
        for (const report of reports)
          assert.deepEqual(
            [report.jevNames, report.mixedGgNames, report.ollama, report.control],
            [0, 0, [['GG_OLLAMA_ENABLED', 'false']], 'present'],
            `${start} ${report.role} ${report.mode ?? 'main'}`,
          );
      console.log(
        JSON.stringify({
          evidence: 'windows-launcher-sanitized-children',
          detectorObserved: true,
          children: Object.fromEntries(
            Object.entries(children).map(([start, reports]) => [start, reports.length]),
          ),
        }),
      );
    });

    let handoffCounts;
    await t.test('expired window deadline refuses a late spawn', async () => {
      const result = await execute(checks, ['--handoff-checks', join(base, 'handoff checks')], {
        env,
        windowsHide: true,
        timeout: 60_000,
      });
      const deadline =
        /window-deadline injected near-expiry-spawns=0 slow-preparation-spawns=(\d+) boundary-spawns=1 sleeps-capped; real ordinary-spawns=(\d+) near-expiry-spawns=0/.exec(
          result.stdout,
        );
      assert.ok(deadline, 'The native window deadline checks did not report.');
      assert.match(result.stdout, /browser handoff and window mutex checks passed/);
      const [slowPreparation, ordinaryPrepared] = [Number(deadline[1]), Number(deadline[2])];
      assert.equal(slowPreparation, 0, 'Slow start preparation reached the start seam.');
      assert.equal(ordinaryPrepared, 1, 'The ordinary prepared start did not run exactly once.');
      handoffCounts = {
        slowPreparationSpawnCount: slowPreparation,
        ordinaryPreparedSpawnCount: ordinaryPrepared,
      };
    });
    console.log(
      JSON.stringify({ evidence: 'windows-launcher-review1', artifacts: base, ...handoffCounts }),
    );
  },
);
