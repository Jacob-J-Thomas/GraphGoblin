#!/usr/bin/env node
// GraphGoblin #409 independent touched-systems QA driver (held-store startup refusals).
//
// Drives the NORMAL built API entry (`node <api>/dist/main.js`) as separate native processes on
// disposable data directories created under --work. Nothing in a checkout, Git, an owner store or
// an external service is touched. Children get a minimal, explicit environment (no inherited
// variables beyond SystemRoot for PowerShell), loopback ports picked here and verified free, and
// every HTTP request is only sent after /healthz proves the listener is the child spawned here.
//
// Usage:
//   node qa-409-driver.mjs --api-main <dist/main.js> --label <name> --out <results.json>
//                          --work <scratch-dir> [--reset-files 3000] [--only s1,s2] [--keep]
//
// Exit code: 0 when every assertion passed, 1 when any assertion failed, 2 on driver error.
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) throw new Error(`unexpected argument ${a}`);
  const next = process.argv[i + 1];
  if (next === undefined || next.startsWith('--')) args[a.slice(2)] = true;
  else {
    args[a.slice(2)] = next;
    i++;
  }
}
for (const required of ['api-main', 'label', 'out', 'work'])
  if (typeof args[required] !== 'string') throw new Error(`--${required} is required`);

const API_MAIN = path.resolve(args['api-main']);
const LABEL = args.label;
const OUT = path.resolve(args.out);
const RUN_ROOT = path.join(
  path.resolve(args.work),
  `${LABEL}-${new Date().toISOString().replace(/[:.]/g, '-')}`,
);
const KEEP = Boolean(args.keep);
const RESET_FILES = Number(args['reset-files'] ?? 3000);
const ONLY = typeof args.only === 'string' ? new Set(args.only.split(',')) : undefined;
const IS_WIN = process.platform === 'win32';
const SYSROOT = process.env.SystemRoot ?? 'C:\\Windows';
const LISTENING = 'GraphGoblin API listening';

// ---------------------------------------------------------------- utilities

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const canonical = (p) => realpathSync.native(p);
const norm = (p) => (IS_WIN ? p.toLowerCase() : p);
const textHasPath = (text, p) => norm(text).includes(norm(p));
const bounded = (text, max = 4000) =>
  text.length <= max ? text : `${text.slice(0, max)}…[${text.length - max} more chars]`;

async function readMaybe(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
async function names(dir) {
  try {
    return (await readdir(dir)).sort();
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  if (await isListening(port)) throw new Error(`picked port ${port} is unexpectedly in use`);
  return port;
}
function isListening(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(1500, () => done(false));
  });
}

// ---------------------------------------------------------------- child processes

const children = new Set();

function childEnv(extra) {
  const home = path.join(RUN_ROOT, 'home');
  return {
    // Only what the API and its Windows PowerShell identity probe need; nothing inherited.
    SystemRoot: SYSROOT,
    windir: SYSROOT,
    PATH: [
      path.dirname(process.execPath),
      path.join(SYSROOT, 'System32'),
      SYSROOT,
      path.join(SYSROOT, 'System32', 'Wbem'),
      path.join(SYSROOT, 'System32', 'WindowsPowerShell', 'v1.0'),
    ].join(path.delimiter),
    TEMP: path.join(RUN_ROOT, 'tmp'),
    TMP: path.join(RUN_ROOT, 'tmp'),
    USERPROFILE: home,
    HOME: home,
    APPDATA: path.join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
    GG_HOST: '127.0.0.1',
    GG_LOG_LEVEL: 'info',
    GG_OLLAMA_ENABLED: 'false',
    GG_SWAGGER_UI: 'false',
    GG_WEB_DIST: '',
    GG_GOBLIN_DIST: '',
    GG_CODEX_BINARY: path.join(RUN_ROOT, 'no-harness', 'codex.exe'),
    GG_CLAUDE_BINARY: path.join(RUN_ROOT, 'no-harness', 'claude.exe'),
    ...extra,
  };
}

function launch(name, argv, extraEnv) {
  const env = childEnv(extraEnv);
  const child = spawn(process.execPath, [API_MAIN, ...argv], {
    cwd: RUN_ROOT,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const p = {
    name,
    argv,
    gg: Object.fromEntries(Object.entries(extraEnv).filter(([k]) => k.startsWith('GG_'))),
    port: Number(env.GG_PORT),
    child,
    pid: child.pid,
    stdout: '',
    stderr: '',
    exit: undefined,
    spawnedAt: Date.now(),
    exitedAt: undefined,
  };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (d) => (p.stdout += d));
  child.stderr.on('data', (d) => (p.stderr += d));
  child.on('exit', () => (p.exitedAt ??= Date.now()));
  child.on('error', (error) => (p.spawnError = String(error)));
  p.closed = new Promise((resolve) =>
    child.on('close', (code, signal) => {
      p.exit = { code, signal };
      p.exitedAt ??= Date.now();
      children.delete(p);
      resolve(p.exit);
    }),
  );
  children.add(p);
  return p;
}
const running = (p) => p.child.exitCode === null && p.child.signalCode === null;
async function waitClose(p, ms = 120_000) {
  return Promise.race([p.closed, delay(ms).then(() => undefined)]);
}
async function waitFor(predicate, ms, every = 50) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await predicate()) return true;
    await delay(every);
  }
  return false;
}
async function healthz(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
      signal: AbortSignal.timeout(5000),
    });
    return {
      status: response.status,
      pid: response.headers.get('x-graphgoblin-pid'),
      phase: response.headers.get('x-graphgoblin-phase'),
    };
  } catch (error) {
    return { error: String(error.cause?.code ?? error.message) };
  }
}
/** Ready only when the listening log appeared AND /healthz on our port reports our child's PID. */
async function ready(p, ms = 90_000) {
  await waitFor(() => p.stdout.includes(LISTENING) || !running(p), ms);
  const health = running(p) ? await healthz(p.port) : { error: 'exited' };
  return { listeningLog: p.stdout.includes(LISTENING), health, ours: health.pid === String(p.pid) };
}
/** Graceful drain through the API's own control, sent only to a verified child. */
async function drain(p) {
  const health = await healthz(p.port);
  if (health.pid !== String(p.pid)) return { refused: 'listener is not this child', health };
  let status;
  try {
    const response = await fetch(`http://127.0.0.1:${p.port}/system/shutdown`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'drain' }),
      signal: AbortSignal.timeout(10_000),
    });
    status = response.status;
  } catch (error) {
    status = `request failed: ${String(error.cause?.code ?? error.message)}`;
  }
  const exit = await waitClose(p, 90_000);
  return { status, exit };
}
function evidence(p, { stdoutExcerpt = false } = {}) {
  return {
    name: p.name,
    pid: p.pid,
    argv: ['node', API_MAIN, ...p.argv],
    gg: p.gg,
    exit: p.exit ?? (running(p) ? 'still running' : 'exited, close pending'),
    durationMs: (p.exitedAt ?? Date.now()) - p.spawnedAt,
    stderr: bounded(p.stderr),
    stdoutBytes: p.stdout.length,
    stdoutHasListeningLog: p.stdout.includes(LISTENING),
    ...(stdoutExcerpt ? { stdout: bounded(p.stdout, 3000) } : {}),
    ...(p.spawnError ? { spawnError: p.spawnError } : {}),
  };
}

// ---------------------------------------------------------------- assertions

const scenarios = [];
function scenario(id, kind, title) {
  const s = { id, kind, title, assertions: [], evidence: {}, notes: [] };
  scenarios.push(s);
  return s;
}
function check(s, id, description, pass, actual, expected) {
  s.assertions.push({ id: `${s.id}.${id}`, description, expected, actual, pass: Boolean(pass) });
  return Boolean(pass);
}
const STACK_FRAME = /^\s+at\s/m;
const ERROR_TOKEN = /\b[A-Za-z]*Error\b/;
const DISPLAY_CONTROL = /[\p{Cc}\p{Zl}\p{Zp}]/u;

function shape(stderr) {
  const endsWithNewline = /\n$/.test(stderr);
  const body = stderr.replace(/\r?\n$/, '');
  const lines = body === '' ? [] : body.split(/\r?\n/);
  return {
    lineCount: lines.length,
    endsWithNewline,
    firstLine: lines[0] ?? '',
    stackFrames: lines.filter((l) => /^\s+at\s/.test(l)).length,
  };
}

/**
 * The refusal shape #409 asks for: exit 1, exactly one stack-free line that names the lock path
 * (in the data directory or beside the database), the holder and what to do, and no server start.
 */
async function assertRefusal(s, p, { lockPath, prefix, holder, action, reason }) {
  const sh = shape(p.stderr);
  check(s, 'exit-1', 'refused process exits with code 1 (no signal)', p.exit?.code === 1 && p.exit?.signal === null, p.exit, { code: 1, signal: null });
  check(s, 'one-line', 'stderr is exactly one newline-terminated line', sh.lineCount === 1 && sh.endsWithNewline, { lineCount: sh.lineCount, endsWithNewline: sh.endsWithNewline }, { lineCount: 1, endsWithNewline: true });
  check(s, 'no-stack', 'stderr has no stack frame lines', !STACK_FRAME.test(p.stderr), { stackFrames: sh.stackFrames }, { stackFrames: 0 });
  check(s, 'no-error-object', 'stderr shows no Error class/name (e.g. "Error:")', !ERROR_TOKEN.test(p.stderr), (p.stderr.match(ERROR_TOKEN) ?? [null])[0], null);
  check(s, 'prefix', `line starts with "${prefix}"`, sh.firstLine.startsWith(prefix), sh.firstLine.slice(0, 120), prefix);
  check(s, 'names-lock-path', 'line names the held lock path (data directory or database sidecar)', textHasPath(sh.firstLine, lockPath), sh.firstLine, lockPath);
  check(s, 'names-holder', 'line identifies the holder/ownership problem', holder.test(sh.firstLine), sh.firstLine, String(holder));
  check(s, 'actionable', 'line says what to do', action.test(sh.firstLine), sh.firstLine, String(action));
  if (reason)
    check(s, 'keeps-reason', 'line keeps the verification reason', sh.firstLine.includes(reason), sh.firstLine, reason);
  check(s, 'no-display-controls', 'line has no control or line-separator characters', !DISPLAY_CONTROL.test(sh.firstLine), JSON.stringify(sh.firstLine.match(DISPLAY_CONTROL)?.[0] ?? null), null);
  check(s, 'no-listen', 'refused process never logged that it was listening', !p.stdout.includes(LISTENING), p.stdout.includes(LISTENING), false);
  check(s, 'stdout-empty', 'refused process wrote nothing to stdout', p.stdout === '', { stdoutBytes: p.stdout.length }, { stdoutBytes: 0 });
  const listening = await isListening(p.port);
  check(s, 'port-closed', "refused process's port is not listening", !listening, listening, false);
}

const HELD_HOLDER = /another GraphGoblin process|\breset\b/i;
const HELD_ACTION = /\bwait\b[^]*\bfinish\b[^]*\bstop\b/i;
const UNCERTAIN_HOLDER = /ownership could not be verified/i;
const UNCERTAIN_ACTION = /\binspect\b[^]*\bretry/i;

// ---------------------------------------------------------------- scenarios

async function fresh(name) {
  const dir = path.join(RUN_ROOT, name);
  await mkdir(dir, { recursive: true });
  return dir;
}
const want = (id) => !ONLY || ONLY.has(id);

async function s1s2s3() {
  const d1 = await fresh('d1-directory-holder');
  const lock = path.join(canonical(d1), 'graphgoblin.lock');

  const s1 = scenario('s1-live-startup', 'positive', 'Live startup control: normal API start on a fresh disposable data directory');
  const a = launch('holder-api', [], { GG_DATA_DIR: d1, GG_PORT: String(await freePort()) });
  const r = await ready(a);
  check(s1, 'listening', 'API logs that it is listening', r.listeningLog, r.listeningLog, true);
  check(s1, 'healthz-ours', '/healthz on the chosen port answers 200 with this child PID', r.health.status === 200 && r.ours, r.health, { status: 200, pid: String(a.pid) });
  const record = await readMaybe(lock);
  const owner = record === null ? undefined : parseJson(record);
  check(s1, 'lock-owner', 'data-directory lock exists and records this child PID', owner?.pid === a.pid, owner ? { pid: owner.pid, hasToken: typeof owner.token === 'string' } : record, { pid: a.pid });
  if (IS_WIN)
    check(s1, 'lock-identity', 'Windows lock record carries a process creation identity', typeof owner?.windowsCreationTime === 'string', owner?.windowsCreationTime ?? null, 'string');
  s1.evidence.holder = evidence(a);
  if (!r.ours) {
    s1.notes.push('holder did not become ready; dependent scenarios skipped');
    return;
  }

  const s2 = scenario('s2-directory-holder-api', 'negative', 'A second API on the same data directory (different port) while a live API holds it');
  const before = { record: await readMaybe(lock), names: await names(d1) };
  const b = launch('contender-api', [], { GG_DATA_DIR: d1, GG_PORT: String(await freePort()) });
  await waitClose(b);
  await assertRefusal(s2, b, {
    lockPath: lock,
    prefix: 'another GraphGoblin process holds ',
    holder: HELD_HOLDER,
    action: HELD_ACTION,
  });
  const health = await healthz(a.port);
  check(s2, 'holder-survives', 'holder API is still running and still answers /healthz with its PID', running(a) && health.pid === String(a.pid), { running: running(a), health }, { running: true, pid: String(a.pid) });
  const after = { record: await readMaybe(lock), names: await names(d1) };
  check(s2, 'record-preserved', "holder's lock record bytes are unchanged", after.record === before.record, sha256(after.record ?? ''), sha256(before.record ?? ''));
  check(s2, 'dir-unchanged', 'data-directory entries unchanged (no staging/reclaim leftovers)', JSON.stringify(after.names) === JSON.stringify(before.names), after.names, before.names);
  s2.evidence.contender = evidence(b);
  s2.evidence.expectedLockPath = lock;

  const s3 = scenario('s3-release-start-normal', 'positive', 'Holder drains through its own control and releases; a new API then starts normally on the same directory');
  const drained = await drain(a);
  check(s3, 'drain-accepted', 'holder accepts POST /system/shutdown {action:"drain"} (202)', drained.status === 202, drained.status, 202);
  check(s3, 'holder-exit-0', 'holder exits 0 after draining', drained.exit?.code === 0, drained.exit, { code: 0, signal: null });
  check(s3, 'lock-released', 'data-directory lock file removed on release', (await readMaybe(lock)) === null, await readMaybe(lock), null);
  const c = launch('restart-api', [], { GG_DATA_DIR: d1, GG_PORT: String(await freePort()) });
  const rc = await ready(c);
  check(s3, 'restart-ready', 'new API starts and /healthz reports its PID', rc.listeningLog && rc.ours, rc, { listeningLog: true, ours: true });
  const cOwner = parseJson((await readMaybe(lock)) ?? '');
  check(s3, 'restart-owns-lock', 'new API owns the data-directory lock', cOwner?.pid === c.pid, cOwner?.pid ?? null, c.pid);
  const cDrain = await drain(c);
  check(s3, 'restart-drains', 'new API drains and exits 0, removing its lock', cDrain.exit?.code === 0 && (await readMaybe(lock)) === null, cDrain, { exit: { code: 0 } });
  s3.evidence.holder = evidence(a);
  s3.evidence.restart = evidence(c);
}

async function s4() {
  const s = scenario('s4-database-holder', 'negative', 'An API with a different data directory but the same external SQLite file (GG_DB_URL) while a live API owns it');
  const d2 = await fresh('d2-db-holder-dir');
  const d3 = await fresh('d3-db-contender-dir');
  const ext = await fresh('ext-db');
  const dbUrl = `file:${ext.replaceAll('\\', '/')}/shared.db`;
  const h = launch('db-holder-api', [], { GG_DATA_DIR: d2, GG_DB_URL: dbUrl, GG_PORT: String(await freePort()) });
  const rh = await ready(h);
  check(s, 'holder-ready', 'holder API with the external database starts and /healthz reports its PID', rh.listeningLog && rh.ours, rh, { ours: true });
  s.evidence.holder = evidence(h);
  if (!rh.ours) return;
  const dbLock = `${path.join(canonical(ext), 'shared.db')}.graphgoblin.lock`;
  const d2Lock = path.join(canonical(d2), 'graphgoblin.lock');
  const d3Lock = path.join(canonical(d3), 'graphgoblin.lock');
  const before = { db: await readMaybe(dbLock), d2: await readMaybe(d2Lock), ext: await names(ext) };
  check(s, 'holder-owns-db', 'database sidecar lock records the holder PID', parseJson(before.db ?? '')?.pid === h.pid, parseJson(before.db ?? '')?.pid ?? null, h.pid);
  const k = launch('db-contender-api', [], { GG_DATA_DIR: d3, GG_DB_URL: dbUrl, GG_PORT: String(await freePort()) });
  await waitClose(k);
  await assertRefusal(s, k, {
    lockPath: dbLock,
    prefix: 'another GraphGoblin process holds ',
    holder: HELD_HOLDER,
    action: HELD_ACTION,
  });
  const health = await healthz(h.port);
  check(s, 'holder-survives', 'holder API still runs and answers /healthz with its PID', running(h) && health.pid === String(h.pid), { running: running(h), health }, { running: true });
  check(s, 'db-record-preserved', "holder's database lock record bytes are unchanged", (await readMaybe(dbLock)) === before.db, sha256((await readMaybe(dbLock)) ?? ''), sha256(before.db ?? ''));
  check(s, 'dir-record-preserved', "holder's data-directory lock record bytes are unchanged", (await readMaybe(d2Lock)) === before.d2, sha256((await readMaybe(d2Lock)) ?? ''), sha256(before.d2 ?? ''));
  check(s, 'contender-dir-released', "contender released its own data-directory lock", (await readMaybe(d3Lock)) === null, await readMaybe(d3Lock), null);
  const extAfter = await names(ext);
  check(s, 'db-dir-unchanged', 'database directory entries unchanged (no leftovers)', JSON.stringify(extAfter) === JSON.stringify(before.ext), extAfter, before.ext);
  const d3Names = await names(d3);
  check(s, 'contender-dir-clean', 'contender data directory has no lock/reclaim/staging leftovers', !d3Names.some((n) => /graphgoblin\.lock|\.tmp$|\.reclaim/.test(n)), d3Names, 'no lock artefacts');
  s.evidence.contender = evidence(k);
  s.evidence.expectedLockPath = dbLock;

  const s5 = scenario('s5-database-release-start', 'positive', 'After the database holder drains, the former contender configuration starts normally');
  const dh = await drain(h);
  check(s5, 'holder-exit-0', 'database holder drains and exits 0', dh.status === 202 && dh.exit?.code === 0, dh, { status: 202, exit: { code: 0 } });
  check(s5, 'db-lock-released', 'database and directory locks removed on release', (await readMaybe(dbLock)) === null && (await readMaybe(d2Lock)) === null, { db: await readMaybe(dbLock), d2: await readMaybe(d2Lock) }, { db: null, d2: null });
  const k2 = launch('db-restart-api', [], { GG_DATA_DIR: d3, GG_DB_URL: dbUrl, GG_PORT: String(await freePort()) });
  const rk = await ready(k2);
  check(s5, 'restart-ready', 'former contender configuration starts and /healthz reports its PID', rk.listeningLog && rk.ours, rk, { ours: true });
  check(s5, 'restart-owns-db', 'it now owns the database lock', parseJson((await readMaybe(dbLock)) ?? '')?.pid === k2.pid, parseJson((await readMaybe(dbLock)) ?? '')?.pid ?? null, k2.pid);
  const dk = await drain(k2);
  check(s5, 'restart-drains', 'it drains and exits 0, releasing both locks', dk.exit?.code === 0 && (await readMaybe(dbLock)) === null && (await readMaybe(d3Lock)) === null, dk, { exit: { code: 0 } });
  s5.evidence.restart = evidence(k2);
}

async function currentStore(dir) {
  const p = launch('store-creator-api', [], { GG_DATA_DIR: dir, GG_PORT: String(await freePort()) });
  const r = await ready(p);
  const d = r.ours ? await drain(p) : undefined;
  if (running(p)) p.child.kill();
  await waitClose(p, 30_000);
  return { ok: r.ours && d?.exit?.code === 0, ready: r, drain: d, process: evidence(p) };
}
async function fill(dir, count) {
  for (let i = 0; i < count; i += 500) {
    const batch = path.join(dir, `batch-${String(i).padStart(6, '0')}`);
    await mkdir(batch, { recursive: true });
    await Promise.all(
      Array.from({ length: Math.min(500, count - i) }, (_, j) =>
        writeFile(path.join(batch, `f${j}.txt`), 'disposable'),
      ),
    );
  }
}

async function s6() {
  const s = scenario('s6-reset-holder', 'negative', 'An API started while a confirmed `--reset --yes` holds the data-directory lock (the original #409 reproduction)');
  const d4 = await fresh('d4-reset-holder');
  const lock = path.join(canonical(d4), 'graphgoblin.lock');
  const attempts = [];
  let achieved;
  for (let attempt = 0; attempt < 3 && !achieved; attempt++) {
    const files = RESET_FILES * 2 ** attempt;
    const store = await currentStore(d4);
    const info = { attempt, files, storeCreated: store.ok };
    attempts.push(info);
    if (!store.ok) {
      info.store = store;
      continue;
    }
    await fill(path.join(d4, 'artifacts'), files);
    const r = launch('reset', ['--reset', '--yes', '--data-dir', d4], { GG_DATA_DIR: d4, GG_PORT: String(await freePort()) });
    let heldRecord = null;
    await waitFor(async () => {
      const text = await readMaybe(lock);
      if (text !== null && parseJson(text)?.pid === r.pid) heldRecord = text;
      return heldRecord !== null || !running(r);
    }, 120_000, 10);
    info.resetObservedHolding = heldRecord !== null;
    if (heldRecord === null) {
      await waitClose(r);
      info.reset = evidence(r, { stdoutExcerpt: true });
      continue;
    }
    const lockSeenAt = Date.now();
    const q = launch('contender-during-reset', [], { GG_DATA_DIR: d4, GG_PORT: String(await freePort()) });
    await Promise.race([q.closed, waitFor(() => q.stdout.includes(LISTENING), 120_000)]);
    const resetRunningAtContenderExit = running(r);
    const recordAtContenderExit = await readMaybe(lock);
    info.msFromLockSeenToContenderExit = (q.exitedAt ?? Date.now()) - lockSeenAt;
    info.resetRunningAtContenderExit = resetRunningAtContenderExit;
    const rExit = await waitClose(r);
    info.resetMsAfterContenderExit = (r.exitedAt ?? Date.now()) - (q.exitedAt ?? Date.now());
    if (q.exit?.code === 1 && resetRunningAtContenderExit) {
      achieved = { r, q, heldRecord, recordAtContenderExit, rExit, info };
    } else {
      info.missed = 'reset released before the contender checked ownership';
      info.contender = evidence(q);
      if (running(q)) await drain(q);
      await waitClose(q, 30_000);
      info.reset = evidence(r, { stdoutExcerpt: true });
    }
  }
  s.evidence.attempts = attempts;
  check(s, 'window-achieved', 'a contender API ran entirely while the reset held the lock (feasibility)', Boolean(achieved), attempts.map((a) => ({ attempt: a.attempt, files: a.files, achieved: a.resetRunningAtContenderExit === true && !a.missed })), 'one attempt achieved');
  if (!achieved) return;
  const { r, q, heldRecord, recordAtContenderExit, info } = achieved;
  await assertRefusal(s, q, {
    lockPath: lock,
    prefix: 'another GraphGoblin process holds ',
    holder: HELD_HOLDER,
    action: HELD_ACTION,
  });
  check(s, 'reset-held-throughout', 'the lock recorded the reset PID before the contender spawned and the reset was still running when the contender exited', info.resetObservedHolding === true && info.resetRunningAtContenderExit === true && parseJson(heldRecord)?.pid === r.pid, { resetPid: r.pid, recordPid: parseJson(heldRecord)?.pid, resetRunningAtContenderExit: info.resetRunningAtContenderExit, resetMsAfterContenderExit: info.resetMsAfterContenderExit }, { recordPid: r.pid, resetRunningAtContenderExit: true });
  check(s, 'record-preserved', "the reset's lock record was unchanged when the contender exited", recordAtContenderExit === heldRecord, sha256(recordAtContenderExit ?? ''), sha256(heldRecord));
  check(s, 'reset-exit-0', 'the reset finishes with exit 0 and "Reset complete"', r.exit?.code === 0 && r.stdout.includes('Reset complete'), { exit: r.exit, complete: r.stdout.includes('Reset complete') }, { exit: { code: 0 }, complete: true });
  check(s, 'reset-stderr-empty', 'the reset wrote nothing to stderr', r.stderr === '', bounded(r.stderr, 500), '');
  check(s, 'reset-released', 'the reset removed its lock (normal release)', (await readMaybe(lock)) === null, await readMaybe(lock), null);
  const after = await names(d4);
  check(s, 'reset-unaffected', 'reset removed artifacts and database, kept master.key', !after.includes('artifacts') && !after.includes('graphgoblin.db') && after.includes('master.key'), after, 'no artifacts/graphgoblin.db; master.key kept');
  s.evidence.reset = evidence(r, { stdoutExcerpt: true });
  s.evidence.contender = evidence(q);
  s.evidence.expectedLockPath = lock;

  const s7 = scenario('s7-reset-release-start', 'positive', 'After the reset releases, the API starts normally on the reset directory');
  const z = launch('post-reset-api', [], { GG_DATA_DIR: d4, GG_PORT: String(await freePort()) });
  const rz = await ready(z);
  check(s7, 'ready', 'API starts and /healthz reports its PID', rz.listeningLog && rz.ours, rz, { ours: true });
  check(s7, 'owns-lock', 'it owns the data-directory lock', parseJson((await readMaybe(lock)) ?? '')?.pid === z.pid, parseJson((await readMaybe(lock)) ?? '')?.pid ?? null, z.pid);
  const dz = await drain(z);
  check(s7, 'drains', 'it drains, exits 0 and removes its lock', dz.exit?.code === 0 && (await readMaybe(lock)) === null, dz, { exit: { code: 0 } });
  s7.evidence.api = evidence(z);
}

async function uncertain(id, title, record, reason) {
  const s = scenario(id, 'negative', title);
  const dir = await fresh(id);
  const lock = path.join(canonical(dir), 'graphgoblin.lock');
  await writeFile(lock, record);
  const beforeNames = await names(dir);
  const p = launch('api', [], { GG_DATA_DIR: dir, GG_PORT: String(await freePort()) });
  await waitClose(p);
  const verified = !IS_WIN && reason.startsWith('live PID');
  await assertRefusal(s, p, {
    lockPath: lock,
    prefix: verified ? 'another GraphGoblin process holds ' : 'Store ownership could not be verified (',
    holder: verified ? HELD_HOLDER : UNCERTAIN_HOLDER,
    action: verified ? HELD_ACTION : UNCERTAIN_ACTION,
    ...(verified ? {} : { reason }),
  });
  check(s, 'record-preserved', 'the owner record bytes are unchanged', (await readMaybe(lock)) === record, await readMaybe(lock), record);
  const after = await names(dir);
  check(s, 'dir-unchanged', 'no database, key or staging entries were created', JSON.stringify(after) === JSON.stringify(beforeNames), after, beforeNames);
  s.evidence.api = evidence(p);
  s.evidence.expectedLockPath = lock;
}

async function deadPid() {
  for (let i = 0; i < 5; i++) {
    const c = spawn(process.execPath, ['-e', ''], { env: {}, windowsHide: true, stdio: 'ignore' });
    const pid = c.pid;
    await new Promise((resolve) => c.on('close', resolve));
    await delay(200);
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') return pid;
    }
  }
  throw new Error('could not obtain a dead PID');
}

async function s10() {
  const s = scenario('s10-stale-lock-control', 'positive', 'Control: a lock recording a dead PID is reclaimed and the API starts normally');
  const dir = await fresh('s10-stale');
  const lock = path.join(canonical(dir), 'graphgoblin.lock');
  const pid = await deadPid();
  await writeFile(lock, JSON.stringify({ pid, startedAt: new Date().toISOString(), token: randomUUID() }));
  const p = launch('api', [], { GG_DATA_DIR: dir, GG_PORT: String(await freePort()) });
  const r = await ready(p);
  check(s, 'ready', 'API starts and /healthz reports its PID', r.listeningLog && r.ours, r, { ours: true });
  check(s, 'reclaimed', 'the lock now records this API', parseJson((await readMaybe(lock)) ?? '')?.pid === p.pid, parseJson((await readMaybe(lock)) ?? '')?.pid ?? null, p.pid);
  check(s, 'stderr-clean', 'no stack or error on stderr', !STACK_FRAME.test(p.stderr) && !ERROR_TOKEN.test(p.stderr), bounded(p.stderr, 500), '');
  const d = await drain(p);
  check(s, 'drains', 'it drains and exits 0', d.exit?.code === 0, d, { exit: { code: 0 } });
  s.evidence.deadPid = pid;
  s.evidence.api = evidence(p);
}

async function s11() {
  const s = scenario('s11-unrelated-datadir-file', 'control', 'Control: an unrelated filesystem failure (GG_DATA_DIR is a regular file) keeps its diagnostics');
  const file = path.join(RUN_ROOT, 's11-not-a-directory');
  await writeFile(file, 'keep');
  const p = launch('api', [], { GG_DATA_DIR: file, GG_PORT: String(await freePort()) });
  await waitClose(p);
  check(s, 'exit-1', 'exits 1', p.exit?.code === 1, p.exit, { code: 1 });
  check(s, 'diagnostic-code', 'stderr keeps the filesystem error code', /EEXIST|ENOTDIR/.test(p.stderr), shape(p.stderr).firstLine, 'EEXIST|ENOTDIR');
  check(s, 'stack-kept', 'stderr keeps the stack frames (not converted to a one-line refusal)', STACK_FRAME.test(p.stderr), { stackFrames: shape(p.stderr).stackFrames }, '>=1');
  check(s, 'not-ownership-text', 'not mis-reported as an ownership refusal', !/another GraphGoblin process|ownership could not be verified/i.test(p.stderr), false, false);
  check(s, 'file-preserved', 'the file is unchanged', (await readMaybe(file)) === 'keep', await readMaybe(file), 'keep');
  check(s, 'port-closed', 'port not listening', !(await isListening(p.port)), false, false);
  s.evidence.api = evidence(p);
}

async function s12() {
  const s = scenario('s12-unrelated-port-in-use', 'control', 'Control: an unrelated bind failure (port held by a driver-owned socket) keeps its diagnostics and releases the lock');
  const dir = await fresh('s12-port');
  const lock = path.join(canonical(dir), 'graphgoblin.lock');
  const blocker = net.createServer();
  await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
  const port = blocker.address().port;
  try {
    const p = launch('api', [], { GG_DATA_DIR: dir, GG_PORT: String(port) });
    await waitClose(p);
    check(s, 'exit-1', 'exits 1', p.exit?.code === 1, p.exit, { code: 1 });
    check(s, 'diagnostic-code', 'stderr keeps EADDRINUSE', p.stderr.includes('EADDRINUSE'), shape(p.stderr).firstLine, 'EADDRINUSE');
    check(s, 'stack-kept', 'stderr keeps the stack frames', STACK_FRAME.test(p.stderr), { stackFrames: shape(p.stderr).stackFrames }, '>=1');
    check(s, 'not-ownership-text', 'not mis-reported as an ownership refusal', !/another GraphGoblin process|ownership could not be verified/i.test(p.stderr), false, false);
    check(s, 'lock-released', 'the data-directory lock was released', (await readMaybe(lock)) === null, await readMaybe(lock), null);
    s.evidence.api = evidence(p);
  } finally {
    await new Promise((resolve) => blocker.close(resolve));
  }
}

async function s13() {
  const s = scenario('s13-existing-store-refusal', 'control', 'Comparator: the existing unsupported-store refusal stays stack-free and leaves the store unchanged');
  const dir = await fresh('s13-unsupported');
  const db = path.join(dir, 'graphgoblin.db');
  const { DatabaseSync } = await import('node:sqlite');
  const sqlite = new DatabaseSync(db);
  sqlite.exec(
    "CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC); INSERT INTO __drizzle_migrations VALUES (1, 'qa-disposable', 0);",
  );
  sqlite.close();
  const before = sha256(await readFile(db));
  const p = launch('api', [], { GG_DATA_DIR: dir, GG_PORT: String(await freePort()) });
  await waitClose(p);
  check(s, 'exit-1', 'exits 1', p.exit?.code === 1, p.exit, { code: 1 });
  check(s, 'stack-free', 'stderr has no stack frames', !STACK_FRAME.test(p.stderr), { stackFrames: shape(p.stderr).stackFrames }, 0);
  check(s, 'explains', 'stderr explains the refusal and names the reset command', p.stderr.includes('GraphGoblin did not start') && p.stderr.includes('--reset'), shape(p.stderr).firstLine, 'GraphGoblin did not start … --reset');
  check(s, 'store-preserved', 'database bytes unchanged', sha256(await readFile(db)) === before, sha256(await readFile(db)), before);
  check(s, 'lock-released', 'no data-directory lock left', (await readMaybe(path.join(canonical(dir), 'graphgoblin.lock'))) === null, null, null);
  s.evidence.api = evidence(p);
  s.evidence.lineCount = shape(p.stderr).lineCount;
}

async function s14() {
  const s = scenario('s14-escaped-path-controls', 'negative', 'Ownership refusal for a data directory whose name holds line-separator/control characters stays one escaped line');
  // Win32 rejects C0 controls in names; NEL, LINE SEPARATOR and PARAGRAPH SEPARATOR are valid.
  const controls = IS_WIN ? '\u0085  ' : '\n\t\u001b\u0085  ';
  const dir = await fresh(`s14-odd${controls}name`);
  const lock = path.join(canonical(dir), 'graphgoblin.lock');
  const record = '{"pid":';
  await writeFile(lock, record);
  const p = launch('api', [], { GG_DATA_DIR: dir, GG_PORT: String(await freePort()) });
  await waitClose(p);
  const escapedLock = lock.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  await assertRefusal(s, p, {
    lockPath: escapedLock,
    prefix: 'Store ownership could not be verified (',
    holder: UNCERTAIN_HOLDER,
    action: UNCERTAIN_ACTION,
    reason: 'malformed or incomplete owner record',
  });
  check(s, 'raw-path-absent', 'the raw (unescaped) path is not printed', !p.stderr.includes(dir), p.stderr.includes(dir), false);
  check(s, 'record-preserved', 'the owner record bytes are unchanged', (await readMaybe(lock)) === record, await readMaybe(lock), record);
  s.evidence.api = evidence(p);
  s.evidence.expectedEscapedLockPath = escapedLock;
}

// ---------------------------------------------------------------- main

const startedAt = new Date().toISOString();
let driverError;
try {
  await mkdir(path.join(RUN_ROOT, 'tmp'), { recursive: true });
  await mkdir(path.join(RUN_ROOT, 'home', 'AppData', 'Local'), { recursive: true });
  await mkdir(path.join(RUN_ROOT, 'home', 'AppData', 'Roaming'), { recursive: true });
  if (want('s1')) await s1s2s3();
  if (want('s4')) await s4();
  if (want('s6')) await s6();
  if (want('s8'))
    await uncertain('s8-uncertain-malformed', 'Held by an unverifiable owner: malformed lock record', '{"pid":', 'malformed or incomplete owner record');
  if (want('s9'))
    await uncertain(
      's9-uncertain-live-pid',
      'Held by an unverifiable owner: a live non-GraphGoblin PID without a creation identity (the driver itself)',
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), token: randomUUID() }),
      'live PID without a verifiable process creation identity',
    );
  if (want('s10')) await s10();
  if (want('s11')) await s11();
  if (want('s12')) await s12();
  if (want('s13')) await s13();
  if (want('s14')) await s14();
} catch (error) {
  driverError = String(error?.stack ?? error);
} finally {
  for (const p of children) {
    p.child.kill();
    await waitClose(p, 15_000);
  }
}

const assertions = scenarios.flatMap((s) => s.assertions);
const results = {
  driver: 'qa-409-driver.mjs',
  label: LABEL,
  apiMain: API_MAIN,
  apiMainSha256: sha256(await readFile(API_MAIN)),
  node: process.version,
  platform: `${process.platform} ${process.arch}`,
  startedAt,
  finishedAt: new Date().toISOString(),
  fixturesRoot: RUN_ROOT,
  fixturesKept: KEEP,
  childEnvironment: Object.keys(childEnv({ GG_DATA_DIR: '', GG_PORT: '' })).sort(),
  driverError: driverError ?? null,
  counts: {
    scenarios: scenarios.length,
    scenariosPassed: scenarios.filter((s) => s.assertions.length && s.assertions.every((a) => a.pass)).length,
    assertions: assertions.length,
    passed: assertions.filter((a) => a.pass).length,
    failed: assertions.filter((a) => !a.pass).length,
  },
  failedAssertions: assertions.filter((a) => !a.pass).map((a) => a.id),
  scenarios,
};
await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(results, null, 2) + '\n');
if (!KEEP) await rm(RUN_ROOT, { recursive: true, force: true, maxRetries: 5 });
console.log(JSON.stringify({ label: LABEL, out: OUT, counts: results.counts, failed: results.failedAssertions, driverError: results.driverError }, null, 2));
process.exit(driverError ? 2 : results.counts.failed ? 1 : 0);
