#!/usr/bin/env node
/**
 * Independent touched-systems behaviour QA driver for GraphGoblin #409: an API started while
 * another GraphGoblin process (a `--reset --yes`, or a live API) holds the data-directory or
 * database lock must refuse with exit 1 and a one-line, stack-free explanation naming the store,
 * the holder and what to do.
 *
 * It drives only the normal built entry point (apps/api/dist/main.js) in separate native Node
 * processes on disposable data created under this script's folder. It does not build, edit the
 * checkout, write Git, touch an owner store or contact an external service. Children get a short
 * list of named OS variables plus explicit GG_* values (no inherited GG_*, JEV or other secrets),
 * TEMP/TMP point into the disposable folder, Ollama discovery is off, and the driver sends
 * authenticated or shutdown requests only to a listener whose /healthz PID is a child it started.
 * Keys and the disposable master key are redacted from everything it records.
 *
 * Usage (Node 22):
 *   node qa-409-driver.mjs --checkout <built checkout> --label <label>
 *        [--out <results.json>] [--reset-files <n>] [--keep]
 *
 * Assertion gates:
 *   issue-409     the behaviour #409 asks for (expected to FAIL on an unfixed baseline)
 *   control       behaviour every build must keep (holder survival, records, release, controls)
 *   precondition  the driver really established the contended situation (else INCONCLUSIVE)
 *   informational recorded for reviewers; never decides the verdict
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------- arguments and layout
const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1] : fallback;
};
const checkoutArg = option('--checkout');
if (!checkoutArg) {
  console.error('usage: node qa-409-driver.mjs --checkout <built checkout> --label <label> [--out <file>] [--reset-files <n>] [--keep]');
  process.exit(2);
}
const label = option('--label', 'unlabelled').replace(/[^A-Za-z0-9._-]/g, '-');
// 10000 files held the lock for about 115 s on the G: volume; 2500 keeps a wide margin over the
// few seconds a contender needs, and the contention-established precondition checks it anyway.
const resetFiles = Number(option('--reset-files', '2500'));
const keep = argv.includes('--keep');
const driverPath = fileURLToPath(import.meta.url);
const scratch = dirname(driverPath);
const checkout = resolve(checkoutArg);
const apiRoot = join(checkout, 'apps', 'api');
const entry = join(apiRoot, 'dist', 'main.js');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const runId = `${label}-${stamp}`;
const work = join(scratch, 'disposable', runId);
const tmp = join(work, 'tmp');
const outFile = resolve(option('--out', join(scratch, `results-${label}.json`)));

// ---------------------------------------------------------------- small helpers
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const norm = (s) => String(s).replace(/\\/g, '/').toLowerCase();
const secrets = new Set();
function redact(text) {
  let out = String(text ?? '').replace(/\bgg_[A-Za-z0-9_-]{8,}/g, '[redacted-api-key]');
  for (const value of secrets) out = out.split(value).join('[redacted]');
  return out;
}
function excerpt(text, limit = 2500) {
  const out = redact(text);
  return out.length > limit ? `${out.slice(0, limit)}...[+${out.length - limit} chars]` : out;
}
async function readText(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    return `<<unreadable: ${error?.code ?? 'error'}>>`;
  }
}
async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
/** Lock record summary without its random ownership token. */
function lockSummary(text) {
  if (text === null) return null;
  let pid;
  try {
    pid = JSON.parse(text).pid;
  } catch {
    pid = 'unparseable';
  }
  return { pid, sha256: sha256(text), bytes: Buffer.byteLength(text) };
}
async function eventually(check, timeoutMs, intervalMs = 25) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return true;
    if (Date.now() >= deadline) return false;
    await delay(intervalMs);
  }
}
function stackInfo(text) {
  const lines = String(text).split(/\r?\n/);
  const frames = lines.filter((l) => /^\s+at\s+\S/.test(l)).length;
  const fileRefs = (String(text).match(/\.(?:m?js|cjs|ts):\d+(?::\d+)?\b/g) ?? []).length;
  const errorPrefixLine = lines.some((l) => /^\s*[A-Za-z]*Error(?: \[[A-Z_]+\])?:\s/.test(l));
  return { frames, fileRefs, errorPrefixLine, stackFree: frames === 0 && fileRefs === 0 };
}
const nonEmptyLines = (text) => String(text).split(/\r?\n/).filter((l) => l.trim() !== '');

// ---------------------------------------------------------------- network (own listeners only)
function freePort() {
  return new Promise((res, rej) => {
    const server = createServer();
    server.once('error', rej);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => res(port));
    });
  });
}
function isListening(port) {
  return new Promise((res) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = (value) => {
      socket.destroy();
      res(value);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(3000, () => finish(false));
  });
}
async function health(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
      signal: AbortSignal.timeout(5000),
    });
    await response.arrayBuffer();
    return {
      status: response.status,
      pid: response.headers.get('x-graphgoblin-pid'),
      phase: response.headers.get('x-graphgoblin-phase'),
    };
  } catch (error) {
    return { status: null, error: error?.cause?.code ?? error?.name ?? 'error' };
  }
}
/** Only after /healthz proves the listener is `proc`. */
async function ownRequest(proc, port, token, method, path, body) {
  const h = await health(port);
  if (h.pid !== String(proc.pid)) return { sent: false, reason: 'listener is not this child', health: h };
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15_000),
    });
    await response.arrayBuffer();
    return { sent: true, status: response.status };
  } catch (error) {
    return { sent: true, status: null, error: error?.cause?.code ?? error?.name ?? 'error' };
  }
}

// ---------------------------------------------------------------- processes
const sys = process.env.SystemRoot ?? 'C:\\Windows';
const PASSTHROUGH =
  process.platform === 'win32'
    ? ['SystemRoot', 'windir', 'SystemDrive', 'ComSpec', 'PATHEXT', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'PSModulePath']
    : ['HOME', 'LANG'];
const masterKey = randomBytes(32).toString('base64');
secrets.add(masterKey);
function childEnv(dataDir, port, extra = {}) {
  const env = {};
  for (const name of PASSTHROUGH) if (process.env[name] !== undefined) env[name] = process.env[name];
  env.PATH =
    process.platform === 'win32'
      ? [dirname(process.execPath), join(sys, 'System32'), join(sys, 'System32', 'Wbem'), join(sys, 'System32', 'WindowsPowerShell', 'v1.0'), sys].join(delimiter)
      : [dirname(process.execPath), '/usr/bin', '/bin'].join(delimiter);
  env.TEMP = tmp;
  env.TMP = tmp;
  env.TMPDIR = tmp;
  Object.assign(env, {
    GG_DATA_DIR: dataDir,
    GG_HOST: '127.0.0.1',
    GG_PORT: String(port),
    GG_LOG_LEVEL: 'info',
    GG_REQUIRE_API_KEY: 'true',
    GG_SWAGGER_UI: 'false',
    GG_WEB_DIST: '',
    GG_GOBLIN_DIST: '',
    GG_JEV_API_KEY: '',
    GG_OLLAMA_ENABLED: 'false',
    GG_MASTER_KEY: masterKey,
  });
  for (const [k, v] of Object.entries(extra)) if (v === undefined) delete env[k];
  else env[k] = v;
  return env;
}
const live = new Set();
const forcedCleanup = [];
function launch(name, args, env) {
  const started = Date.now();
  const child = spawn(process.execPath, [entry, ...args], {
    cwd: apiRoot,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const p = { name, child, pid: child.pid, stdout: '', stderr: '', exited: false, result: undefined };
  child.stdout.setEncoding('utf8').on('data', (c) => (p.stdout += c));
  child.stderr.setEncoding('utf8').on('data', (c) => (p.stderr += c));
  let settled = false;
  p.done = new Promise((res) => {
    const settle = (result) => {
      if (settled) return;
      settled = true;
      p.exited = true;
      p.result = { ...result, ms: Date.now() - started };
      live.delete(p);
      res(p.result);
    };
    child.once('error', (error) => settle({ code: null, signal: null, spawnError: error?.code ?? 'error' }));
    child.once('close', (code, signal) => settle({ code, signal }));
  });
  live.add(p);
  return p;
}
async function waitExit(p, ms) {
  let timer;
  try {
    return await Promise.race([p.done, new Promise((res) => (timer = setTimeout(() => res(undefined), ms)))]);
  } finally {
    clearTimeout(timer); // never keep the driver alive after the child settled
  }
}
async function forceKill(p, why) {
  if (p.exited) return;
  forcedCleanup.push({ process: p.name, why });
  p.child.kill('SIGKILL');
  await waitExit(p, 30_000);
}
async function mintKey(dataDir, extra = {}) {
  const p = launch('create-api-key', ['--create-api-key', 'qa-409 disposable'], childEnv(dataDir, 0, extra));
  const exit = await waitExit(p, 120_000);
  if (!exit) await forceKill(p, 'create-api-key did not exit in 120 s');
  const token = /^\s+(gg_[A-Za-z0-9_-]+)\s*$/m.exec(p.stdout)?.[1];
  if (token) secrets.add(token);
  return { exit: p.result, token, stderr: excerpt(p.stderr, 800) };
}
async function startApi(name, env, port) {
  if (await isListening(port))
    return { ok: false, reason: `port ${port} already has a listener; not used` };
  const p = launch(name, [], env);
  const up = await eventually(() => p.exited || p.stdout.includes('GraphGoblin API listening'), 120_000);
  if (!up || p.exited)
    return { ok: false, proc: p, reason: p.exited ? 'exited before listening' : 'not listening within 120 s' };
  const h = await health(port);
  if (h.pid !== String(p.pid)) return { ok: false, proc: p, reason: 'healthz PID is not this child', health: h };
  return { ok: true, proc: p, health: h };
}
/** Normal release: the supported drain control, then the process's own exit. */
async function drain(proc, port, token) {
  const request = await ownRequest(proc, port, token, 'POST', '/system/shutdown', { action: 'drain' });
  const exit = request.sent ? await waitExit(proc, 120_000) : undefined;
  return { request, exit: exit ?? null };
}

// ---------------------------------------------------------------- scenarios and assertions
const scenarios = [];
function scenario(id, title) {
  const sc = { id, title, startedAt: new Date().toISOString(), assertions: [], evidence: {}, notes: [] };
  sc.check = (aid, gate, description, pass, observed) =>
    sc.assertions.push({ id: `${id}.${aid}`, gate, description, pass: Boolean(pass), observed });
  scenarios.push(sc);
  return sc;
}
/** The #409 refusal contract for a contender, plus process-level controls. */
async function refusalChecks(sc, p, exit, { resource, resourceLabel }) {
  const stderr = p.stderr;
  const stdout = p.stdout;
  const info = stackInfo(stderr);
  const lines = nonEmptyLines(stderr);
  const candidates = [resource];
  try {
    candidates.push(await realpath(resource));
  } catch {
    /* resource may be gone */
  }
  sc.evidence.contender = {
    pid: p.pid,
    exit,
    stderrLines: lines.length,
    stack: info,
    stderr: excerpt(stderr),
    stdout: excerpt(stdout, 800),
  };
  sc.check('exit-1', 'issue-409', 'contender exits with status 1 (not a signal or timeout)', exit?.code === 1 && exit?.signal === null, exit);
  sc.check('no-stack', 'issue-409', 'stderr carries no stack frames and no file:line:col references', info.stackFree, info);
  sc.check('one-line', 'issue-409', 'stderr is a single non-empty line (issue "Expected")', lines.length === 1, { nonEmptyLines: lines.length });
  sc.check('names-store', 'issue-409', `stderr names the contended ${resourceLabel}`, candidates.some((c) => norm(stderr).includes(norm(c))), { resource: redact(resource) });
  sc.check('names-holder', 'issue-409', 'stderr names the lock holder (a reset, or another GraphGoblin process)', /\breset\b|graphgoblin process/i.test(stderr), null);
  sc.check('says-what-to-do', 'issue-409', 'stderr says what to do (wait for it to finish, or stop it)', /\bwait\b|\bstop\b|\bfinish\b/i.test(stderr), null);
  sc.check('not-started', 'control', 'contender never reported listening and stdout has no stack', !stdout.includes('GraphGoblin API listening') && stackInfo(stdout).stackFree, null);
  sc.check('no-secret-output', 'control', 'contender output contains neither the disposable key nor the master key', ![...secrets].some((s) => stderr.includes(s) || stdout.includes(s)), null);
}
async function runScenario(fn) {
  try {
    await fn();
  } catch (error) {
    const sc = scenarios.at(-1);
    if (sc) {
      sc.error = excerpt(error?.stack ?? String(error), 1500);
      sc.check('driver-completed', 'precondition', 'scenario ran to completion without a driver error', false, null);
    }
  } finally {
    for (const p of [...live]) await forceKill(p, 'left running at scenario end');
    const sc = scenarios.at(-1);
    if (sc) sc.finishedAt = new Date().toISOString();
  }
}

// S1 ------------------------------------------------------------- live startup control
async function s1() {
  const sc = scenario('S1-live-startup', 'Positive control: normal start on a free disposable store, then normal release');
  const dir = join(work, 's1');
  const key = await mintKey(dir);
  sc.check('key-minted', 'precondition', 'built --create-api-key creates a current store and a disposable key (exit 0)', key.exit?.code === 0 && key.token, key.exit);
  const port = await freePort();
  const started = await startApi('s1-api', childEnv(dir, port), port);
  sc.check('starts', 'control', 'API starts, logs listening and /healthz reports this child PID', started.ok, { reason: started.reason, health: started.health });
  if (!started.ok) return;
  const lock = lockSummary(await readText(join(dir, 'graphgoblin.lock')));
  sc.evidence.lock = lock;
  sc.check('holds-lock', 'control', 'graphgoblin.lock records the live API PID', lock?.pid === started.proc.pid, lock);
  const auth = await ownRequest(started.proc, port, key.token, 'GET', '/loops');
  sc.check('serves', 'control', 'authenticated GET /loops returns 200', auth.status === 200, auth);
  const stop = await drain(started.proc, port, key.token);
  sc.evidence.release = stop;
  sc.check('drain-exit-0', 'control', 'POST /system/shutdown drain is accepted (202) and the API exits 0', stop.request.status === 202 && stop.exit?.code === 0, stop);
  sc.check('lock-released', 'control', 'graphgoblin.lock is removed and the port is closed after release', !(await exists(join(dir, 'graphgoblin.lock'))) && !(await isListening(port)), null);
}

// S2 ------------------------------------------------------------- directory holder: live API
async function s2() {
  const sc = scenario('S2-dir-holder-api', 'Directory holder: a live API holds graphgoblin.lock; a second API starts with the same GG_DATA_DIR');
  const dir = join(work, 's2');
  const lockPath = join(dir, 'graphgoblin.lock');
  const key = await mintKey(dir);
  sc.check('key-minted', 'precondition', 'disposable current store and key created (exit 0)', key.exit?.code === 0 && key.token, key.exit);
  const holderPort = await freePort();
  const holder = await startApi('s2-holder', childEnv(dir, holderPort), holderPort);
  sc.check('holder-started', 'precondition', 'holder API is listening with its own PID on /healthz', holder.ok, { reason: holder.reason });
  if (!holder.ok) return;
  const before = await readText(lockPath);
  sc.check('holder-holds', 'precondition', 'graphgoblin.lock names the holder PID before contention', lockSummary(before)?.pid === holder.proc.pid, lockSummary(before));
  const contenderPort = await freePort();
  const contender = launch('s2-contender', [], childEnv(dir, contenderPort));
  const exit = await waitExit(contender, 120_000);
  if (!exit) await forceKill(contender, 'contender did not exit in 120 s');
  await refusalChecks(sc, contender, exit ?? contender.result, { resource: dir, resourceLabel: 'data directory' });
  const after = await readText(lockPath);
  const h = await health(holderPort);
  const auth = await ownRequest(holder.proc, holderPort, key.token, 'GET', '/loops');
  sc.evidence.holder = { pid: holder.proc.pid, lockBefore: lockSummary(before), lockAfter: lockSummary(after), health: h, authAfter: auth };
  sc.check('holder-survives', 'control', 'holder is still running and /healthz still reports its PID', !holder.proc.exited && h.pid === String(holder.proc.pid), h);
  sc.check('lock-record-preserved', 'control', 'the holder lock record is byte-identical after the refusal', before !== null && before === after, null);
  sc.check('record-preserved-live', 'control', 'the pre-contention key still authenticates against the holder (200)', auth.status === 200, auth);
  sc.check('contender-not-bound', 'control', 'the contender port has no listener', !(await isListening(contenderPort)), null);
  const stop = await drain(holder.proc, holderPort, key.token);
  sc.check('holder-normal-release', 'control', 'holder drains (202) and exits 0; the lock is removed', stop.request.status === 202 && stop.exit?.code === 0 && !(await exists(lockPath)), stop);
  const restartPort = await freePort();
  const restart = await startApi('s2-restart', childEnv(dir, restartPort), restartPort);
  sc.check('restart-normal', 'control', 'a normal start on the same data directory succeeds after release', restart.ok, { reason: restart.reason });
  if (!restart.ok) return;
  const authRestart = await ownRequest(restart.proc, restartPort, key.token, 'GET', '/loops');
  sc.check('record-preserved-restart', 'control', 'the pre-contention key still authenticates after restart (store preserved)', authRestart.status === 200, authRestart);
  const stop2 = await drain(restart.proc, restartPort, key.token);
  sc.check('restart-normal-release', 'control', 'the restarted API drains and exits 0; the lock is removed', stop2.request.status === 202 && stop2.exit?.code === 0 && !(await exists(lockPath)), stop2);
}

// S3 ------------------------------------------------------------- directory holder: reset
async function fillArtifacts(dir, total) {
  const per = 500;
  for (let d = 0; d * per < total; d++) {
    const sub = join(dir, 'artifacts', `qa-${String(d).padStart(3, '0')}`);
    await mkdir(sub, { recursive: true });
    const count = Math.min(per, total - d * per);
    await Promise.all(Array.from({ length: count }, (_, i) => writeFile(join(sub, `f${i}.txt`), 'qa-409 disposable\n')));
  }
}
async function s3() {
  const sc = scenario('S3-dir-holder-reset', 'Directory holder: `--reset --yes --data-dir <dir>` holds graphgoblin.lock; an API starts with the same GG_DATA_DIR (issue reproduction)');
  const dir = join(work, 's3');
  const lockPath = join(dir, 'graphgoblin.lock');
  const key = await mintKey(dir);
  sc.check('key-minted', 'precondition', 'disposable current store created (exit 0)', key.exit?.code === 0 && key.token, key.exit);
  // Many disposable artifact files make the product's own removal keep the lock for seconds.
  await fillArtifacts(dir, resetFiles);
  sc.evidence.artifactFiles = resetFiles;
  const reset = launch('s3-reset', ['--reset', '--yes', '--data-dir', dir], childEnv(dir, 0));
  const t0 = Date.now();
  const acquired = await eventually(async () => {
    if (reset.exited) return true;
    const text = await readText(lockPath);
    if (!text) return false;
    try {
      return JSON.parse(text).pid === reset.pid;
    } catch {
      return false;
    }
  }, 300_000, 5);
  const before = await readText(lockPath);
  const acquiredAt = Date.now();
  sc.check('reset-holds', 'precondition', 'the running reset holds graphgoblin.lock (record names its PID)', acquired && !reset.exited && lockSummary(before)?.pid === reset.pid, { msUntilHeld: acquiredAt - t0, lock: lockSummary(before) });
  if (!acquired || reset.exited) {
    sc.evidence.reset = { exit: reset.result, stdout: excerpt(reset.stdout, 1200), stderr: excerpt(reset.stderr, 1200) };
    return;
  }
  const contenderPort = await freePort();
  const contender = launch('s3-contender', [], childEnv(dir, contenderPort));
  const exit = await waitExit(contender, 120_000);
  const resetAliveAtContenderExit = !reset.exited;
  const during = await readText(lockPath);
  if (!exit) {
    sc.notes.push('contender did not exit within 120 s; force-stopped (no key exists for a reset store)');
    await forceKill(contender, 'contender did not exit in 120 s');
  }
  sc.check('contention-established', 'precondition', 'the reset was still running and its lock record unchanged when the contender exited', resetAliveAtContenderExit && during === before, { resetAlive: resetAliveAtContenderExit, lockUnchanged: during === before, contenderMs: (exit ?? contender.result)?.ms });
  await refusalChecks(sc, contender, exit ?? contender.result, { resource: dir, resourceLabel: 'data directory' });
  sc.check('names-reset', 'informational', 'stderr identifies the holder specifically as a reset', /\breset\b/i.test(contender.stderr), null);
  const resetExit = await waitExit(reset, 600_000);
  if (!resetExit) await forceKill(reset, 'reset did not exit in 600 s');
  sc.evidence.reset = {
    pid: reset.pid,
    exit: reset.result,
    lockHeldAtLeastMs: Date.now() - acquiredAt,
    stdoutTail: excerpt(reset.stdout.slice(-600), 700),
    stderr: excerpt(reset.stderr, 800),
  };
  sc.check('reset-completes', 'control', 'the reset holder is undisturbed: exits 0 and prints "Reset complete"', resetExit?.code === 0 && reset.stdout.includes('Reset complete'), reset.result);
  sc.check('reset-released', 'control', 'after the reset, graphgoblin.lock, the database and artifacts/ are gone', !(await exists(lockPath)) && !(await exists(join(dir, 'graphgoblin.db'))) && !(await exists(join(dir, 'artifacts'))), null);
  sc.check('contender-not-bound', 'control', 'the contender port has no listener', !(await isListening(contenderPort)), null);
  const key2 = await mintKey(dir);
  const port = await freePort();
  const restart = key2.token ? await startApi('s3-restart', childEnv(dir, port), port) : { ok: false, reason: 'no key' };
  sc.check('restart-normal', 'control', 'after the reset a new key is minted and a normal start succeeds on the fresh store', key2.exit?.code === 0 && restart.ok, { key: key2.exit, reason: restart.reason });
  if (!restart.ok) return;
  const oldKey = await ownRequest(restart.proc, port, key.token, 'GET', '/loops');
  const newKey = await ownRequest(restart.proc, port, key2.token, 'GET', '/loops');
  sc.check('fresh-store', 'control', 'the pre-reset key is rejected (401) and the new key accepted (200)', oldKey.status === 401 && newKey.status === 200, { oldKey, newKey });
  const stop = await drain(restart.proc, port, key2.token);
  sc.check('restart-normal-release', 'control', 'the restarted API drains and exits 0; the lock is removed', stop.request.status === 202 && stop.exit?.code === 0 && !(await exists(lockPath)), stop);
}

// S4 ------------------------------------------------------------- database holder
async function s4() {
  const sc = scenario('S4-db-holder-api', 'Database holder: a live API owns an external GG_DB_URL; an API with another data directory starts on the same database');
  const ext = join(work, 's4-external');
  await mkdir(ext, { recursive: true });
  const dbFile = join(ext, 'shared.db');
  const dbUrl = `file:${dbFile.replaceAll('\\', '/')}`;
  const dbLock = `${dbFile}.graphgoblin.lock`;
  const dirA = join(work, 's4-dirA');
  const dirB = join(work, 's4-dirB');
  const key = await mintKey(dirA, { GG_DB_URL: dbUrl });
  sc.check('key-minted', 'precondition', 'disposable external current store and key created (exit 0)', key.exit?.code === 0 && key.token, key.exit);
  const portA = await freePort();
  const holder = await startApi('s4-holder', childEnv(dirA, portA, { GG_DB_URL: dbUrl }), portA);
  sc.check('holder-started', 'precondition', 'holder API is listening with its own PID on /healthz', holder.ok, { reason: holder.reason });
  if (!holder.ok) return;
  const before = await readText(dbLock);
  sc.check('holder-holds', 'precondition', 'the database sidecar lock names the holder PID before contention', lockSummary(before)?.pid === holder.proc.pid, lockSummary(before));
  const portB = await freePort();
  const contender = launch('s4-contender', [], childEnv(dirB, portB, { GG_DB_URL: dbUrl }));
  const exit = await waitExit(contender, 120_000);
  if (!exit) await forceKill(contender, 'contender did not exit in 120 s');
  await refusalChecks(sc, contender, exit ?? contender.result, { resource: dbFile, resourceLabel: 'database file' });
  const after = await readText(dbLock);
  const h = await health(portA);
  const auth = await ownRequest(holder.proc, portA, key.token, 'GET', '/loops');
  sc.evidence.holder = { pid: holder.proc.pid, dbLockBefore: lockSummary(before), dbLockAfter: lockSummary(after), health: h, authAfter: auth };
  sc.check('holder-survives', 'control', 'holder is still running and /healthz still reports its PID', !holder.proc.exited && h.pid === String(holder.proc.pid), h);
  sc.check('lock-record-preserved', 'control', 'the database lock record is byte-identical after the refusal', before !== null && before === after, null);
  sc.check('record-preserved-live', 'control', 'the pre-contention key still authenticates against the holder (200)', auth.status === 200, auth);
  sc.check('contender-dir-released', 'control', "the refused contender left no graphgoblin.lock in its own data directory and has no listener", !(await exists(join(dirB, 'graphgoblin.lock'))) && !(await isListening(portB)), null);
  const stop = await drain(holder.proc, portA, key.token);
  sc.check('holder-normal-release', 'control', 'holder drains (202) and exits 0; both its locks are removed', stop.request.status === 202 && stop.exit?.code === 0 && !(await exists(dbLock)) && !(await exists(join(dirA, 'graphgoblin.lock'))), stop);
  const portB2 = await freePort();
  const restart = await startApi('s4-restart', childEnv(dirB, portB2, { GG_DB_URL: dbUrl }), portB2);
  sc.check('restart-normal', 'control', 'the former contender configuration starts normally once the holder released', restart.ok, { reason: restart.reason });
  if (!restart.ok) return;
  const authRestart = await ownRequest(restart.proc, portB2, key.token, 'GET', '/loops');
  sc.check('record-preserved-restart', 'control', 'the key minted under the holder authenticates through the new owner (shared store preserved)', authRestart.status === 200, authRestart);
  const stop2 = await drain(restart.proc, portB2, key.token);
  sc.check('restart-normal-release', 'control', 'the new owner drains and exits 0; its locks are removed', stop2.request.status === 202 && stop2.exit?.code === 0 && !(await exists(dbLock)) && !(await exists(join(dirB, 'graphgoblin.lock'))), stop2);
}

// S5 ------------------------------------------------------------- unrelated error: port in use
async function s5() {
  const sc = scenario('S5-control-port-in-use', 'Independent control: an unrelated startup failure (driver-owned listener on GG_PORT) is not reported as a lock holder');
  const dir = join(work, 's5');
  const key = await mintKey(dir);
  sc.check('key-minted', 'precondition', 'disposable current store created (exit 0)', key.exit?.code === 0, key.exit);
  const server = createServer();
  const port = await new Promise((res) => server.listen(0, '127.0.0.1', () => res(server.address().port)));
  try {
    const p = launch('s5-api', [], childEnv(dir, port));
    const exit = (await waitExit(p, 120_000)) ?? (await forceKill(p, 'did not exit'), p.result);
    const info = stackInfo(p.stderr);
    sc.evidence.api = { exit, stack: info, stderr: excerpt(p.stderr, 1500) };
    sc.check('exit-1', 'control', 'API exits 1', exit?.code === 1, exit);
    sc.check('reports-cause', 'control', 'stderr reports the real cause (EADDRINUSE)', p.stderr.includes('EADDRINUSE'), null);
    sc.check('not-misattributed', 'control', 'stderr does not claim a lock holder', !/another GraphGoblin process|\bholds\b/i.test(p.stderr), null);
    sc.check('lock-released', 'control', 'no graphgoblin.lock is left behind', !(await exists(join(dir, 'graphgoblin.lock'))), null);
    sc.check('stack-observed', 'informational', 'unrelated failure output is stack-free (recorded only; #409 does not ask for it)', info.stackFree, info);
  } finally {
    await new Promise((res) => server.close(() => res()));
  }
}

// S6 ------------------------------------------------------------- reference refusal: unsupported store
async function s6() {
  const sc = scenario('S6-control-store-refusal', 'Reference control: the existing unsupported-store refusal (the shape #409 asks to match)');
  const dir = join(work, 's6');
  await mkdir(dir, { recursive: true });
  const dbFile = join(dir, 'graphgoblin.db');
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(dbFile);
  db.exec('CREATE TABLE legacy_qa_409 (id INTEGER PRIMARY KEY, note TEXT); INSERT INTO legacy_qa_409 (note) VALUES (\'disposable\');');
  db.close();
  const hashBefore = sha256(await readFile(dbFile));
  const port = await freePort();
  const p = launch('s6-api', [], childEnv(dir, port));
  const exit = (await waitExit(p, 120_000)) ?? (await forceKill(p, 'did not exit'), p.result);
  const info = stackInfo(p.stderr);
  const hashAfter = sha256(await readFile(dbFile));
  sc.evidence.api = { exit, stack: info, stderrLines: nonEmptyLines(p.stderr).length, stderr: excerpt(p.stderr, 2000) };
  sc.check('exit-1', 'control', 'API exits 1', exit?.code === 1, exit);
  sc.check('explains', 'control', 'stderr starts with "GraphGoblin did not start" and names the data directory', p.stderr.trimStart().startsWith('GraphGoblin did not start') && norm(p.stderr).includes(norm(dir)), null);
  sc.check('no-stack', 'control', 'the reference refusal is stack-free', info.stackFree, info);
  sc.check('store-preserved', 'control', 'the refused store is byte-identical and no lock is left', hashBefore === hashAfter && !(await exists(join(dir, 'graphgoblin.lock'))), { hashBefore, hashAfter });
  sc.check('line-count', 'informational', 'reference refusal line count (for comparison with the #409 "one line" wording)', true, { nonEmptyLines: nonEmptyLines(p.stderr).length });
}

// S7 ------------------------------------------------------------- adjacent: unverifiable lock record
async function s7() {
  const sc = scenario('S7-adjacent-malformed-lock', 'Adjacent lock refusal: a malformed graphgoblin.lock (ownership cannot be verified), then operator recovery');
  const dir = join(work, 's7');
  const lockPath = join(dir, 'graphgoblin.lock');
  const key = await mintKey(dir);
  sc.check('key-minted', 'precondition', 'disposable current store and key created (exit 0)', key.exit?.code === 0 && key.token, key.exit);
  await writeFile(lockPath, '{"pid":');
  const before = await readText(lockPath);
  const port = await freePort();
  const p = launch('s7-api', [], childEnv(dir, port));
  const exit = (await waitExit(p, 120_000)) ?? (await forceKill(p, 'did not exit'), p.result);
  const info = stackInfo(p.stderr);
  sc.evidence.api = { exit, stack: info, stderrLines: nonEmptyLines(p.stderr).length, stderr: excerpt(p.stderr, 2000) };
  sc.check('exit-1', 'control', 'API exits 1', exit?.code === 1, exit);
  sc.check('explains-unverified', 'control', 'stderr says store ownership could not be verified and names the lock', /could not be verified/i.test(p.stderr) && norm(p.stderr).includes(norm(lockPath)), null);
  sc.check('lock-preserved', 'control', 'the unverifiable record is left byte-identical (never treated as stale)', (await readText(lockPath)) === before, null);
  sc.check('stack-free', 'informational', 'adjacent lock refusal is stack-free (outside the literal #409 case)', info.stackFree, info);
  sc.check('one-line', 'informational', 'adjacent lock refusal is a single non-empty line', nonEmptyLines(p.stderr).length === 1, { nonEmptyLines: nonEmptyLines(p.stderr).length });
  await rm(lockPath); // the operator removes a record they verified is not owned
  const port2 = await freePort();
  const restart = await startApi('s7-restart', childEnv(dir, port2), port2);
  sc.check('recovery-start', 'control', 'after the operator removes the record, a normal start succeeds', restart.ok, { reason: restart.reason });
  if (!restart.ok) return;
  const auth = await ownRequest(restart.proc, port2, key.token, 'GET', '/loops');
  sc.check('record-preserved', 'control', 'the store survived the refusal: the earlier key authenticates (200)', auth.status === 200, auth);
  const stop = await drain(restart.proc, port2, key.token);
  sc.check('normal-release', 'control', 'drains (202), exits 0 and removes the lock', stop.request.status === 202 && stop.exit?.code === 0 && !(await exists(lockPath)), stop);
}

// S8 ------------------------------------------------------------- unrelated error: invalid configuration
async function s8() {
  const sc = scenario('S8-control-invalid-config', 'Independent control: invalid configuration fails before any lock and is not reported as a lock holder');
  const dir = join(work, 's8');
  const p = launch('s8-api', [], childEnv(dir, 0, { GG_PORT: 'not-a-port' }));
  const exit = (await waitExit(p, 120_000)) ?? (await forceKill(p, 'did not exit'), p.result);
  const info = stackInfo(p.stderr);
  sc.evidence.api = { exit, stack: info, stderr: excerpt(p.stderr, 1500) };
  sc.check('exit-1', 'control', 'API exits 1', exit?.code === 1, exit);
  sc.check('reports-cause', 'control', 'stderr reports invalid configuration for GG_PORT', /invalid configuration/i.test(p.stderr) && p.stderr.includes('GG_PORT'), null);
  sc.check('not-misattributed', 'control', 'stderr does not claim a lock holder', !/another GraphGoblin process|\bholds\b/i.test(p.stderr), null);
  sc.check('no-lock', 'control', 'no graphgoblin.lock was created', !(await exists(join(dir, 'graphgoblin.lock'))), null);
  sc.check('stack-observed', 'informational', 'unrelated failure output is stack-free (recorded only)', info.stackFree, info);
}

// ---------------------------------------------------------------- run
function git(args) {
  try {
    return execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8', windowsHide: true }).trim();
  } catch {
    return null;
  }
}
const startedAt = new Date().toISOString();
await stat(entry); // the coordinator supplies a built checkout; this driver never builds
await mkdir(tmp, { recursive: true });
const trackedBefore = git(['status', '--porcelain', '--untracked-files=no']);
const distFiles = ['main.js', 'entry-point.js', 'serve.js', 'data-dir-lock.js', 'container.js', 'store-refusal.js', 'reset/reset.js', 'create-api-key.js'];
const distSha256 = {};
for (const f of distFiles) distSha256[f] = await readFile(join(apiRoot, 'dist', f)).then(sha256, () => null);

const only = option('--only');
for (const [name, fn] of Object.entries({ s1, s2, s3, s4, s5, s6, s7, s8 }))
  if (!only || only.split(',').includes(name)) await runScenario(fn);

for (const p of [...live]) await forceKill(p, 'left running at driver end');
const trackedAfter = git(['status', '--porcelain', '--untracked-files=no']);
let cleanup = 'kept (--keep)';
if (!keep) {
  globalThis.gc?.();
  cleanup = await rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).then(
    () => 'removed',
    (error) => `not fully removed: ${error?.code ?? 'error'}`,
  );
}

const all = scenarios.flatMap((s) => s.assertions);
const byGate = {};
for (const a of all) {
  byGate[a.gate] ??= { total: 0, passed: 0, failed: 0 };
  byGate[a.gate].total += 1;
  byGate[a.gate][a.pass ? 'passed' : 'failed'] += 1;
}
const pre = all.filter((a) => a.gate === 'precondition');
const issue = all.filter((a) => a.gate === 'issue-409');
const control = all.filter((a) => a.gate === 'control');
const verdict = !pre.every((a) => a.pass)
  ? 'INCONCLUSIVE: a precondition was not established (see failed precondition assertions)'
  : issue.length === 0
    ? 'NOT EVALUATED: no #409 assertion ran in this selection'
    : issue.every((a) => a.pass)
    ? 'PASS: every #409 refusal assertion holds'
    : 'FAIL: #409 refusal behaviour absent (failed issue-409 assertions listed)';
const results = {
  schema: 'graphgoblin-qa-409/v1',
  label,
  runId,
  startedAt,
  finishedAt: new Date().toISOString(),
  driver: { file: 'qa-409-driver.mjs', sha256: sha256(await readFile(driverPath)) },
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  checkout: {
    head: git(['rev-parse', 'HEAD']),
    trackedChangesBefore: trackedBefore === null ? null : trackedBefore.split('\n').filter(Boolean).length,
    trackedChangesAfter: trackedAfter === null ? null : trackedAfter.split('\n').filter(Boolean).length,
    entry: 'apps/api/dist/main.js',
    distSha256,
  },
  options: { resetFiles, keep, only: only ?? null },
  childEnvNames: [...PASSTHROUGH, 'PATH (node dir + system dirs)', 'TEMP', 'TMP', 'TMPDIR', 'GG_* (explicit)'],
  verdict,
  controlsAllPass: control.every((a) => a.pass),
  counts: { total: all.length, passed: all.filter((a) => a.pass).length, failed: all.filter((a) => !a.pass).length, byGate },
  failed: all.filter((a) => !a.pass).map((a) => `${a.id} [${a.gate}]`),
  forcedCleanup,
  disposableCleanup: cleanup,
  scenarios: scenarios.map(({ check, ...rest }) => rest),
};
await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, `${JSON.stringify(results, null, 2)}\n`);
console.log(`${verdict}\ncontrols all pass: ${results.controlsAllPass}\ncounts: ${JSON.stringify(results.counts)}\nresults: ${outFile}`);
if (results.failed.length) console.log(`failed:\n  ${results.failed.join('\n  ')}`);
