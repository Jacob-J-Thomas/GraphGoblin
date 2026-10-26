// QA tooling for the WP-B3 final behaviour QA (PR #355 integrated head), not product code.
// Nothing in the build, the tests or the gates imports it. Every data directory it creates lives
// under the system temp directory in a folder named gg-qa-b3-int-*, and every API it starts
// listens on a port from 6340 to 6349.
import { execFile, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  writeFileSync,
} from 'node:fs';
import { lstat, mkdtemp, readFile, readdir, readlink } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

export const QA_DIR = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(QA_DIR, '..', '..', '..');
export const MAIN = join(ROOT, 'apps', 'api', 'dist', 'main.js');
export const SQLITE = pathToFileURL(
  join(ROOT, 'packages', 'infrastructure', 'dist', 'sqlite', 'index.js'),
).href;
export const PREFIX = 'gg-qa-b3-int-';
export const TMP = tmpdir();
export const BIN_DIR = join(TMP, `${PREFIX}bin`);

/** Replace the local user profile path (any slash style or case) with %USERPROFILE%. */
export function sanitize(text) {
  const home = homedir();
  const name = home.split(/[\\/]/).pop();
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return String(text)
    .replace(new RegExp(`([A-Za-z]:)?(\\\\\\\\|\\\\|/)Users(\\\\\\\\|\\\\|/)${escaped}`, 'gi'), '%USERPROFILE%')
    .replace(new RegExp(`/[a-z]/Users/${escaped}`, 'gi'), '%USERPROFILE%');
}

/** A log that is written to <QA_DIR>/<name>.log.txt, sanitized. */
export class Log {
  constructor(name) {
    this.name = name;
    this.lines = [];
    this.failures = [];
    this.passes = 0;
  }
  line(...parts) {
    const text = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p, null, 2))).join(' ');
    this.lines.push(text);
    process.stdout.write(sanitize(text) + '\n');
  }
  section(title) {
    this.line('');
    this.line(`=== ${title} ===`);
  }
  block(label, text) {
    this.line(`--- ${label} ---`);
    this.line(String(text).replace(/\n$/, ''));
    this.line(`--- end ${label} ---`);
  }
  check(ok, label, detail) {
    if (ok) this.passes += 1;
    else this.failures.push(label);
    this.line(`${ok ? 'PASS' : 'FAIL'}: ${label}${detail === undefined ? '' : ` (${typeof detail === 'string' ? detail : JSON.stringify(detail)})`}`);
    return ok;
  }
  save() {
    this.line('');
    this.line(`SUMMARY ${this.name}: ${this.passes} passed, ${this.failures.length} failed`);
    for (const failure of this.failures) this.line(`  FAILED: ${failure}`);
    writeFileSync(join(QA_DIR, `${this.name}.log.txt`), sanitize(this.lines.join('\n')) + '\n');
  }
}

/** A fresh base folder under the system temp directory, named gg-qa-b3-int-<tag>-XXXXXX. */
export async function makeBase(tag) {
  return mkdtemp(join(TMP, `${PREFIX}${tag}-`));
}

/** The environment of a GraphGoblin process: nothing GG_* is inherited. */
export function environment(dataDir, extra = {}) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GG_')),
  );
  return {
    ...env,
    ...(dataDir === undefined ? {} : { GG_DATA_DIR: dataDir }),
    GG_WEB_DIST: '',
    GG_LOG_LEVEL: 'warn',
    ...extra,
  };
}

/** Run the built API binary to completion; returns code, stdout, stderr, elapsed ms. */
export function cli(args, dataDir, extra = {}, { timeoutMs = 120_000, cwd = ROOT } = {}) {
  return new Promise((done) => {
    const started = Date.now();
    const child = spawn(process.execPath, [MAIN, ...args], {
      cwd,
      env: environment(dataDir, extra),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      done({ code, signal, stdout, stderr, timedOut, ms: Date.now() - started });
    });
  });
}

/**
 * Run the built API binary and call `onRemoving` (synchronously, in this process) as soon as its
 * stdout shows the `Removing:` line, which the reset writes immediately before its first removal.
 * Returns the usual result plus a timeline of stdout lines with milliseconds since start and the
 * moment the hook ran.
 */
export function cliWithHook(args, dataDir, extra, onRemoving, { timeoutMs = 300_000 } = {}) {
  return new Promise((done) => {
    const started = Date.now();
    const child = spawn(process.execPath, [MAIN, ...args], {
      cwd: ROOT,
      env: environment(dataDir, extra),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let pending = '';
    let hooked = false;
    const timeline = [];
    let hookResult;
    child.stdout.on('data', (chunk) => {
      const at = Date.now() - started;
      stdout += chunk;
      pending += chunk;
      const lines = pending.split('\n');
      pending = lines.pop();
      for (const line of lines) {
        if (/^(Removing:|  removed |Reset )/.test(line)) timeline.push(`${at} ms: ${line}`);
        if (!hooked && line === 'Removing:') {
          hooked = true;
          const t0 = Date.now() - started;
          try {
            hookResult = onRemoving();
          } catch (error) {
            hookResult = `hook error: ${error.stack}`;
          }
          timeline.push(`${t0}-${Date.now() - started} ms: [hook ran: ${typeof hookResult === 'string' ? hookResult : JSON.stringify(hookResult)}]`);
        }
      }
    });
    child.stderr.on('data', (chunk) => (stderr += chunk));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      done({ code, signal, stdout, stderr, timedOut, ms: Date.now() - started, timeline, hookResult, hooked });
    });
  });
}

/** Log a CLI invocation and its result. */
export function logCli(log, label, args, result, envNote = '') {
  log.line(`$ node apps/api/dist/main.js ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}${envNote ? `   [${envNote}]` : ''}`);
  log.line(`exit code: ${String(result.code)}${result.timedOut ? ' (TIMED OUT, killed)' : ''}; ${result.ms} ms`);
  if (result.stdout) log.block(`${label} stdout`, result.stdout);
  if (result.stderr) log.block(`${label} stderr`, result.stderr);
}

/** Every entry below `dir`, never following links: kind, size, sha256, mtime, link target. */
export async function snapshot(dir, prefix = '') {
  const records = [];
  let names;
  try {
    names = (await readdir(join(dir, prefix))).sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [`${prefix || '.'} <missing>`];
    throw error;
  }
  for (const name of names) {
    const path = prefix ? `${prefix}/${name}` : name;
    const full = join(dir, path);
    let stats;
    try {
      stats = await lstat(full, { bigint: true });
    } catch (error) {
      // Node cannot lstat a Windows AF_UNIX socket file (EACCES); record that it is there.
      records.push(`X ${path} <lstat ${error.code}>`);
      continue;
    }
    if (stats.isSymbolicLink()) records.push(`L ${path} -> ${await readlink(full)} ino=${stats.ino}`);
    else if (stats.isDirectory()) {
      records.push(`D ${path}/ mtime=${stats.mtimeNs} ino=${stats.ino}`);
      records.push(...(await snapshot(dir, path)));
    } else if (stats.isFile())
      records.push(
        `F ${path} ${stats.size}B sha256=${createHash('sha256')
          .update(await readFile(full))
          .digest('hex')} mtime=${stats.mtimeNs} ino=${stats.ino}`,
      );
    else records.push(`O ${path} mode=${stats.mode}`);
  }
  return records;
}

export const treeHash = (records) => createHash('sha256').update(records.join('\n')).digest('hex');

/** Records present in only one of two snapshots. */
export function diff(before, after) {
  const a = new Set(before);
  const b = new Set(after);
  return {
    removed: before.filter((r) => !b.has(r)),
    added: after.filter((r) => !a.has(r)),
  };
}

export function logSnapshot(log, label, records) {
  log.block(`${label} (tree hash ${treeHash(records)})`, records.join('\n'));
}

/** Compare and log two snapshots; returns whether they are identical. */
export function sameTree(log, label, before, after) {
  const d = diff(before, after);
  const same = d.removed.length === 0 && d.added.length === 0;
  log.check(same, label, `before ${treeHash(before).slice(0, 16)} after ${treeHash(after).slice(0, 16)}`);
  if (!same) {
    log.block(`${label}: only before`, d.removed.join('\n'));
    log.block(`${label}: only after`, d.added.join('\n'));
  }
  return same;
}

/** sha256 of a file, or "missing". */
export function fileHash(path) {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  } catch (error) {
    if (error.code === 'ENOENT') return 'missing';
    throw error;
  }
}

/** Compile the disposable fake Codex CLI (tooling/fixtures/unlimited-codex.cs) once. */
export async function fakeCodex() {
  const binary = join(BIN_DIR, 'codex.exe');
  if (existsSync(binary)) return binary;
  mkdirSync(BIN_DIR, { recursive: true });
  const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
  await promisify(execFile)(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Add-Type -Path ${quote(join(ROOT, 'tooling', 'fixtures', 'unlimited-codex.cs'))} -OutputAssembly ${quote(binary)} -OutputType ConsoleApplication`,
    ],
    { windowsHide: true },
  );
  return binary;
}

/** Start the built API on `dataDir` and `port` (6340-6349) and wait for /healthz. */
export async function startApi(dataDir, port, extra = {}) {
  if (port < 6340 || port > 6349) throw new Error(`port ${port} is outside 6340-6349`);
  const child = spawn(process.execPath, [MAIN], {
    cwd: ROOT,
    env: environment(dataDir, { GG_PORT: String(port), GG_HOST: '127.0.0.1', ...extra }),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const api = { child, port, stdout: '', stderr: '', exited: once(child, 'exit') };
  child.stdout.on('data', (chunk) => (api.stdout += chunk));
  child.stderr.on('data', (chunk) => (api.stderr += chunk));
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return { ...api, failed: true, code: child.exitCode };
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) return api;
    } catch {
      // not listening yet
    }
    await delay(100);
  }
  child.kill();
  throw new Error(`API on ${port} did not become healthy: ${api.stderr}`);
}

/** Call the running API; returns { status, body }. */
export async function call(api, method, path, body) {
  const response = await fetch(`http://127.0.0.1:${api.port}${path}`, {
    method,
    signal: AbortSignal.timeout(15_000),
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed };
}

/** Stop the API gracefully through POST /system/shutdown {action: "drain"}; returns its exit code. */
export async function stopApi(api) {
  if (api.child.exitCode !== null) return api.child.exitCode;
  await call(api, 'POST', '/system/shutdown', { action: 'drain' }).catch(() => undefined);
  const timer = setTimeout(() => api.child.kill(), 60_000);
  const [code] = await api.exited;
  clearTimeout(timer);
  return code;
}

/** Kill the API hard (TerminateProcess), leaving its lock file behind. */
export async function killApi(api) {
  spawnSync('taskkill', ['/F', '/PID', String(api.child.pid)], { windowsHide: true });
  await api.exited;
}

export const LOOP = {
  schemaVersion: 4,
  name: 'WP-B3 final QA loop',
  nodes: [
    { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
    {
      id: 'work',
      kind: 'inference',
      label: 'Work',
      config: { prompt: { template: 'Controlled fake task; never a provider turn' } },
    },
    { id: 'done', kind: 'exit', label: 'Done', config: {} },
  ],
  edges: [
    { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'work' } },
    { id: 'b', from: { node: 'work', port: 'out' }, to: { node: 'done' } },
  ],
};

/** Create the QA loop and run it `count` times to completion; returns the run IDs. */
export async function createLoopAndRuns(log, api, count = 1) {
  const created = await call(api, 'POST', '/loops', { definition: LOOP });
  log.check(created.status === 201, 'POST /loops creates the loop', created.status);
  const runIds = [];
  for (let i = 0; i < count; i += 1) {
    const started = await call(api, 'POST', `/loops/${created.body.loop.id}/runs`, {
      allowDraft: true,
      versionId: created.body.draft.id,
    });
    log.check(started.status === 202, `POST /loops/:id/runs starts run ${i + 1}`, started.status);
    const id = started.body.run.id;
    let status;
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      status = (await call(api, 'GET', `/runs/${id}`)).body.status;
      if (!['queued', 'running', 'pending', 'starting'].includes(status)) break;
      await delay(100);
    }
    log.check(status === 'succeeded', `run ${id} finished`, status);
    runIds.push(id);
  }
  return { loopId: created.body.loop.id, runIds };
}

/**
 * Seed a store in a child process (its exit releases SQLite's files): a complete current store
 * from the shipped migrations, then the requested damage. `format` rewrites the marker (3 =
 * format-3 store); `dropMarker` removes the marker table (an unmarked store written before
 * markers existed). `runIds` inserts runs.
 */
export async function seedStore(databaseFile, { runIds = [], format, dropMarker = false } = {}) {
  const script = `
    const { openDatabase } = await import(${JSON.stringify(SQLITE)});
    const handle = openDatabase({ url: ${JSON.stringify(pathToFileURL(databaseFile).href)} });
    await handle.migrate();
    for (const id of ${JSON.stringify(runIds)})
      await handle.client.execute({
        sql: 'INSERT INTO runs (id, owner_id, loop_id, version_id, invocation_id, status, iteration, created_at, initial_thread) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        args: [id, 'local', 'loop', 'version', 'invocation', 'succeeded', 1, '2026-10-18T00:00:00.000Z', '{}'],
      });
    ${format === undefined ? '' : `await handle.client.execute('UPDATE gg_upgrade_state SET format_version = ${format}');`}
    ${dropMarker ? `await handle.client.execute('DROP TABLE gg_upgrade_state');` : ''}
    process.stdout.write('seeded', () => process.exit(0));`;
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ['--input-type=module', '-e', script],
    { timeout: 120_000, windowsHide: true, cwd: ROOT },
  );
  if (stdout !== 'seeded') throw new Error(`seed failed: ${stdout}`);
}

/** Read a store's marker and migration ledger from a private copy, in a child process. */
export async function inspectStore(databaseFile) {
  const copyDir = await mkdtemp(join(TMP, `${PREFIX}inspect-`));
  const script = `
    import { copyFileSync, existsSync, rmSync } from 'node:fs';
    import { join } from 'node:path';
    const { openDatabase } = await import(${JSON.stringify(SQLITE)});
    const source = ${JSON.stringify(databaseFile)};
    const copy = join(${JSON.stringify(copyDir)}, 'store.db');
    copyFileSync(source, copy);
    if (existsSync(source + '-wal')) copyFileSync(source + '-wal', copy + '-wal');
    const handle = openDatabase({ url: new URL('file:///' + copy.replaceAll('\\\\', '/')).href });
    const rows = async (sql) => (await handle.client.execute(sql)).rows.map((r) => ({ ...r }));
    const tables = (await rows("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")).map((r) => r.name);
    const out = { tables };
    if (tables.includes('gg_upgrade_state')) out.marker = await rows('SELECT * FROM gg_upgrade_state');
    if (tables.includes('__drizzle_migrations')) out.ledger = await rows('SELECT id, hash, created_at FROM __drizzle_migrations ORDER BY created_at');
    if (tables.includes('loops')) out.loops = (await rows('SELECT count(*) AS n FROM loops'))[0].n;
    if (tables.includes('runs')) out.runs = (await rows('SELECT count(*) AS n FROM runs'))[0].n;
    process.stdout.write(JSON.stringify(out), () => process.exit(0));`;
  try {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ['--input-type=module', '-e', script],
      { timeout: 120_000, windowsHide: true, cwd: ROOT, maxBuffer: 16 * 1024 * 1024 },
    );
    return JSON.parse(stdout);
  } finally {
    const { rm } = await import('node:fs/promises');
    await rm(copyDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

/**
 * A populated store on disk without starting the API: a store (format 3 by default) with one run,
 * its workspace (`files` files), artifacts, a user folder under workspaces/ and a master key.
 */
export async function seedDataDir(dataDir, { runId = '01JQAB3INTRUNAAAAAAAAAAAAA', format = 3, files = 3, database = 'graphgoblin.db' } = {}) {
  mkdirSync(join(dataDir, dirname(database)), { recursive: true });
  await seedStore(join(dataDir, database), { runIds: [runId], ...(format === 4 ? {} : { format }) });
  mkdirSync(join(dataDir, 'artifacts', 'text'), { recursive: true });
  writeFileSync(join(dataDir, 'artifacts', 'text', 'a1'), 'artifact one');
  writeFileSync(join(dataDir, 'artifacts', 'text', 'a2'), 'artifact two');
  writeMany(join(dataDir, 'workspaces', runId), files);
  mkdirSync(join(dataDir, 'workspaces', 'my-notes'), { recursive: true });
  writeFileSync(join(dataDir, 'workspaces', 'my-notes', 'keep.txt'), 'user directory');
  writeFileSync(join(dataDir, 'master.key'), Buffer.alloc(32, 9).toString('base64'));
  return runId;
}

/** The Windows short (8.3) spelling of an existing path, or undefined. */
export function shortPath(path) {
  const result = spawnSync('cmd.exe', ['/d', '/s', '/c', `for %I in ("${path}") do @echo %~sI`], {
    windowsVerbatimArguments: true,
    encoding: 'utf8',
    windowsHide: true,
  });
  const value = result.stdout.trim();
  return value && value !== path ? value : undefined;
}

/** The shipped migration journal: count and last tag/when. */
export function shippedLedger() {
  const journal = JSON.parse(
    readFileSync(join(ROOT, 'packages', 'infrastructure', 'drizzle', 'meta', '_journal.json'), 'utf8'),
  );
  const entries = journal.entries;
  return { count: entries.length, last: entries.at(-1) };
}

/** Write `files` files of `bytes` bytes each under `dir`. */
export function writeMany(dir, files, prefix = 'f', content = (i) => `run output ${i}\n`) {
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < files; i += 1)
    writeFileSync(join(dir, `${prefix}${String(i).padStart(5, '0')}.txt`), content(i));
}

export function isLink(path) {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

export function readlinkOr(path) {
  try {
    return readlinkSync(path);
  } catch (error) {
    return `<${error.code}>`;
  }
}

export function listDir(dir) {
  try {
    return readdirSync(dir).sort();
  } catch (error) {
    return [`<${error.code}>`];
  }
}

export const rel = (from, to) => relative(from, to).replaceAll('\\', '/');
