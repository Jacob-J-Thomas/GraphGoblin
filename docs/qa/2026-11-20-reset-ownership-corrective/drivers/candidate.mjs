// #434 behavioral QA driver: Unicode-equivalent ownership names (F1) and reclamation attribution (F2)
// through the real built reset CLI, on fresh disposable fixtures. Reusable for another checkout:
//   node qa434-driver.mjs --repo <checkout> --evidence <dir> --work <scratch dir> --label <name>
// Writes only below --work (fixtures) and --evidence (results). Never writes the checkout.
//
// CANDIDATE COPY (#434 candidate fd3b845 QA). Derived from the retained baseline driver
// baseline-corrected-driver.original.mjs, SHA-256 a7cd8e303e6166a21559aa6e9471048a5a114ae1d13300f19bd4394886816d70.
// Changes are limited to (L) private expectation labels and (I) interpretation of output in
// observations; every fixture, precondition proof, snapshot, assertion predicate and refusal control is
// unchanged. See CHANGES.md beside this file.
//   L1: the 23 F1 rows the baseline labelled 'fail' (F1A/F1B/D1 x6, R4G x5) are labelled 'pass' for the
//       candidate, per public acceptance (each physical ownership entry once, under Removes, with its
//       directory-listed spelling). The baseline label is retained on each row as `baselineLabel`.
//   I1-I3: F2 observations compute their assessment from the actual output and snapshots instead of
//       embedding baseline-specific prose/source line numbers, and also capture the candidate's
//       "already gone" wording.
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ---------------------------------------------------------------- arguments and run identity
const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(name);
  if (i < 0 || i + 1 >= argv.length) throw new Error(`missing ${name}`);
  return argv[i + 1];
};
const REPO = arg('--repo');
const EVIDENCE = arg('--evidence');
const WORK = arg('--work');
const LABEL = arg('--label');
const ONLY = argv.includes('--only') ? arg('--only').split(',') : undefined;
const RUN_ID = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const RUN_EVIDENCE = join(EVIDENCE, 'runs', RUN_ID);
const RUN_WORK = join(WORK, 'runs', RUN_ID);
const RAW = join(RUN_EVIDENCE, 'raw');
const ROWS = join(RUN_EVIDENCE, 'rows.jsonl');
mkdirSync(RAW, { recursive: true });
mkdirSync(RUN_WORK, { recursive: true });

const MAIN = join(REPO, 'apps', 'api', 'dist', 'main.js');
const SQLITE = pathToFileURL(join(REPO, 'packages', 'infrastructure', 'dist', 'sqlite', 'index.js')).href;
const NODE = process.execPath;
const SYSROOT = process.env.SystemRoot ?? 'C:\\Windows';
const DEAD_PID = 2147483644;
const RUN = '01JRESETQA434UNICODEAAAAAA';
const STAGING_TOKEN = '0d1f6f0e-6a55-4b8e-9d7c-2b1f9a3c4e5d';
const STAGING = `graphgoblin.lock.reclaim.${STAGING_TOKEN}.tmp`;
const TIMEOUT = 180_000;

const now = () => new Date().toISOString();
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const cps = (s) => [...s].map((c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')).join(' ');
const results = {
  runId: RUN_ID,
  label: LABEL,
  startedAt: now(),
  driver: { path: fileURLToPath(import.meta.url), sha256: sha256(readFileSync(fileURLToPath(import.meta.url))) },
  paths: { repo: REPO, evidence: RUN_EVIDENCE, work: RUN_WORK, main: MAIN },
  harness: [],
  cases: [],
};
const row = (record) => appendFileSync(ROWS, JSON.stringify({ at: now(), ...record }) + '\n');
const harness = (name, ok, details) => {
  const h = { name, ok, at: now(), details };
  results.harness.push(h);
  row({ kind: 'harness', ...h });
  return h;
};

// ---------------------------------------------------------------- read-only environment facts
function git(args) {
  return execFileSync('git', ['--no-optional-locks', '-C', REPO, ...args], { encoding: 'utf8', windowsHide: true }).trim();
}
function binding() {
  return {
    at: now(),
    head: git(['rev-parse', 'HEAD']),
    tree: git(['rev-parse', 'HEAD^{tree}']),
    statusPorcelain: git(['status', '--porcelain=v1', '--untracked-files=all']),
  };
}
const DIST_FILES = [
  'apps/api/dist/main.js',
  'apps/api/dist/reset/reset.js',
  'apps/api/dist/reset/tree.js',
  'apps/api/dist/reset/store-facts.js',
  'apps/api/dist/reset/store-facts-worker.js',
  'apps/api/dist/reset/store-facts-reader.js',
  'apps/api/dist/reset/store-copy.js',
  'apps/api/dist/data-dir-lock.js',
  'apps/api/dist/canonical-path.js',
  'apps/api/dist/windows-process-identity.js',
  'apps/api/dist/store-refusal.js',
  'apps/api/dist/config.js',
];

// ---------------------------------------------------------------- native filesystem helpers
function nodeId(path) {
  try {
    const s = lstatSync(path, { bigint: true });
    return { id: `${s.dev}:${s.ino}`, nlink: Number(s.nlink), type: s.isSymbolicLink() ? 'link' : s.isDirectory() ? 'dir' : s.isFile() ? 'file' : 'other' };
  } catch (error) {
    return { error: error.code ?? String(error) };
  }
}
function fsutilId(path) {
  try {
    const out = execFileSync(join(SYSROOT, 'System32', 'fsutil.exe'), ['file', 'queryFileID', path], { encoding: 'utf8', windowsHide: true }).trim();
    const m = /0x[0-9a-fA-F]+/.exec(out);
    return m ? m[0].toLowerCase() : { error: out };
  } catch (error) {
    return { error: `exit ${error.status}: ${String(error.stdout ?? '').trim()}` };
  }
}
function nativeName(path) {
  try {
    return basename(realpathSync.native(path));
  } catch (error) {
    return { error: error.code ?? String(error) };
  }
}
function nativeRel(root, path) {
  try {
    return relative(realpathSync.native(root), realpathSync.native(path)).split(sep).join('/');
  } catch (error) {
    return undefined;
  }
}
function cmdDir(path) {
  try {
    return execFileSync(join(SYSROOT, 'System32', 'cmd.exe'), ['/u', '/d', '/c', 'dir', '/b', '/a', path], { encoding: 'utf16le', windowsHide: true }).trim();
  } catch (error) {
    return { error: `exit ${error.status}` };
  }
}
function createNew(path, content) {
  try {
    const fd = openSync(path, 'wx');
    writeFileSync(fd, content);
    closeSync(fd);
    return 'created';
  } catch (error) {
    return error.code ?? String(error);
  }
}
function caseAttribute(dir) {
  try {
    return execFileSync(join(SYSROOT, 'System32', 'fsutil.exe'), ['file', 'queryCaseSensitiveInfo', dir], { encoding: 'utf8', windowsHide: true }).trim();
  } catch (error) {
    return `error exit ${error.status}: ${String(error.stdout ?? '').trim()}`;
  }
}

/** Every entry below root: listed names, types, sizes, SHA-256, file IDs and link counts. */
function snapshot(root, prefix = '') {
  const records = [];
  for (const name of readdirSync(join(root, prefix)).sort()) {
    const path = prefix ? `${prefix}/${name}` : name;
    const full = join(root, path);
    const s = lstatSync(full, { bigint: true });
    const rec = { path, id: `${s.dev}:${s.ino}`, nlink: Number(s.nlink) };
    if (s.isSymbolicLink()) records.push({ ...rec, type: 'link' });
    else if (s.isDirectory()) records.push({ ...rec, type: 'dir' }, ...snapshot(root, path));
    else if (s.isFile()) records.push({ ...rec, type: 'file', size: Number(s.size), sha256: sha256(readFileSync(full)) });
    else records.push({ ...rec, type: 'other' });
  }
  return records;
}
const byPath = (snap) => new Map(snap.map((r) => [r.path, r]));
function snapshotDiff(a, b, { compareNlink = true } = {}) {
  const A = byPath(a);
  const B = byPath(b);
  const removed = [...A.keys()].filter((p) => !B.has(p));
  const added = [...B.keys()].filter((p) => !A.has(p));
  const changed = [];
  for (const [p, ra] of A) {
    const rb = B.get(p);
    if (!rb) continue;
    const keys = ['type', 'size', 'sha256', 'id', ...(compareNlink ? ['nlink'] : [])];
    const diff = keys.filter((k) => ra[k] !== rb[k]);
    if (diff.length) changed.push({ path: p, fields: diff, before: ra, after: rb });
  }
  return { removed, added, changed, identical: !removed.length && !added.length && !changed.length };
}

// ---------------------------------------------------------------- child processes
const ROOT_ENV = ['SystemRoot', 'windir', 'SystemDrive', 'ComSpec'];
function childEnv(ctx, gg = {}) {
  const env = {};
  for (const key of ROOT_ENV) if (process.env[key] !== undefined) env[key] = process.env[key];
  env.PATHEXT = '.COM;.EXE;.BAT;.CMD';
  env.PATH = [dirname(NODE), join(SYSROOT, 'System32'), join(SYSROOT, 'System32', 'WindowsPowerShell', 'v1.0'), SYSROOT].join(';');
  env.TEMP = ctx.tmp;
  env.TMP = ctx.tmp;
  env.USERPROFILE = ctx.home;
  env.APPDATA = join(ctx.home, 'AppData', 'Roaming');
  env.LOCALAPPDATA = join(ctx.home, 'AppData', 'Local');
  return { ...env, ...gg };
}
function spawnCapture(command, args, env, cwd) {
  return new Promise((resolve) => {
    const startedAt = now();
    const child = spawn(command, args, { env, cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    const timer = setTimeout(() => child.kill(), TIMEOUT);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ startedAt, finishedAt: now(), exit: null, signal: null, spawnError: String(error), stdout: Buffer.concat(out), stderr: Buffer.concat(err) });
    });
    child.on('close', (exit, signal) => {
      clearTimeout(timer);
      resolve({ startedAt, finishedAt: now(), exit, signal, stdout: Buffer.concat(out), stderr: Buffer.concat(err) });
    });
  });
}
async function reset(ctx, step, cliArgs) {
  const env = childEnv(ctx, ctx.gg);
  const r = await spawnCapture(NODE, [MAIN, ...cliArgs], env, ctx.caseDir);
  const n = String(++ctx.stepNo).padStart(2, '0');
  const dir = join(RAW, ctx.id);
  mkdirSync(dir, { recursive: true });
  const outPath = join(dir, `${n}-${step}.stdout.txt`);
  const errPath = join(dir, `${n}-${step}.stderr.txt`);
  writeFileSync(outPath, r.stdout);
  writeFileSync(errPath, r.stderr);
  const rec = {
    step: `${n}-${step}`,
    argv: ['node', 'apps/api/dist/main.js', ...cliArgs],
    envKeys: Object.keys(env).sort(),
    gg: ctx.gg,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    exit: r.exit,
    signal: r.signal,
    spawnError: r.spawnError,
    stdoutFile: relative(RUN_EVIDENCE, outPath).split(sep).join('/'),
    stderrFile: relative(RUN_EVIDENCE, errPath).split(sep).join('/'),
    stdoutSha256: sha256(r.stdout),
    stderrSha256: sha256(r.stderr),
    tmpAfter: readdirSync(ctx.tmp),
  };
  ctx.record.steps.push(rec);
  row({ kind: 'step', case: ctx.id, ...rec });
  return { ...rec, stdout: r.stdout.toString('utf8'), stderr: r.stderr.toString('utf8') };
}

// ---------------------------------------------------------------- manifest parsing
function parseManifest(text) {
  const lines = text.split('\n');
  const section = (title) => {
    const start = lines.indexOf(title);
    if (start < 0) return undefined;
    const rows = [];
    for (let i = start + 1; i < lines.length && lines[i] !== ''; i += 1) {
      const line = lines[i];
      if (!line.startsWith('  ')) break;
      const body = line.slice(2);
      if (
        body.startsWith('Browser device drafts') ||
        body === 'no store data' ||
        body === 'nothing else is in the data directory' ||
        body.startsWith('... and ')
      ) {
        rows.push({ line, meta: true });
        continue;
      }
      const m = /^(\S+)\s+(.*)$/.exec(body);
      rows.push({ line, path: m ? m[1] : body, rest: m ? m[2] : '' });
    }
    return rows.filter((r) => !r.meta);
  };
  const removingAt = lines.indexOf('Removing:');
  const after = removingAt < 0 ? [] : lines.slice(removingAt + 1).filter((l) => l !== '');
  return {
    removes: section('Removes:'),
    keeps: section('Keeps:'),
    database: lines.find((l) => l.startsWith('Database:')),
    removing: after,
    complete: lines.some((l) => l.startsWith('Reset complete.')),
  };
}

// ---------------------------------------------------------------- assertions
// L1: assertion ids the baseline driver labelled 'fail' (expected defect on 71bf970). Metadata only.
const BASELINE_FAIL_LABELS = new Set([
  ...['F1A-greek-final-upper', 'F1B-greek-reverse', 'D1-greek-distinct-lookalikes'].flatMap((c) =>
    ['dry.disjoint', 'dry.once.guard.db', 'dry.spelling.guard.db', 'dry.once.lock.db', 'dry.spelling.lock.db', 'confirmed.guard-row-spelling.db'].map((s) => `${c}.${s}`)),
  ...['dry.disjoint', 'dry.once.guard.db', 'dry.spelling.guard.db', 'dry.once.lock.db', 'dry.spelling.lock.db'].map((s) => `R4G-greek-hardlinked-db.${s}`),
]);
function check(ctx, id, finding, description, predicted, ok, details) {
  const a = {
    id: `${ctx.id}.${id}`,
    finding,
    description,
    predicted, // 'pass' | 'fail' (candidate expectation from the public acceptance; candidate PLAN.md)
    baselineLabel: BASELINE_FAIL_LABELS.has(`${ctx.id}.${id}`) ? 'fail' : 'pass',
    result: ok ? 'pass' : 'fail',
    classification: ok
      ? predicted === 'pass' ? 'control-pass' : 'defect-not-reproduced'
      : predicted === 'pass' ? 'unexpected-fail' : 'expected-defect-reproduced',
    at: now(),
    details,
  };
  ctx.record.assertions.push(a);
  row({ kind: 'assertion', case: ctx.id, ...a });
  return ok;
}
function notEvaluated(ctx, group, reason) {
  const n = { group, reason, at: now() };
  (ctx.record.notEvaluated ??= []).push(n);
  row({ kind: 'not-evaluated', case: ctx.id, ...n });
}
const stageOf = (stderr) =>
  stderr.includes('could not take the')
    ? 'acquisition'
    : /verify ownership before resetting/.test(stderr)
      ? 'preview lock-state check (before any acquisition)'
      : /under more than one name|by a spelling the data directory does not list/.test(stderr)
        ? 'preview path resolution (before any acquisition)'
        : 'other';
function observe(ctx, id, finding, description, details) {
  const o = { id: `${ctx.id}.${id}`, finding, description, at: now(), details };
  ctx.record.observations.push(o);
  row({ kind: 'observation', case: ctx.id, ...o });
}

// ---------------------------------------------------------------- fixtures
let TEMPLATE_DB;
async function seedTemplate() {
  const dir = join(RUN_WORK, 'template', 'data');
  mkdirSync(dir, { recursive: true });
  const ctx = { tmp: join(RUN_WORK, 'template', 'tmp'), home: join(RUN_WORK, 'template', 'home') };
  mkdirSync(ctx.tmp, { recursive: true });
  mkdirSync(ctx.home, { recursive: true });
  const dbUrl = pathToFileURL(join(dir, 'graphgoblin.db')).href;
  const script = `
    const { openDatabase } = await import(${JSON.stringify(SQLITE)});
    const handle = openDatabase({ url: ${JSON.stringify(dbUrl)} });
    await handle.migrate();
    await handle.client.execute({
      sql: 'INSERT INTO runs (id, owner_id, loop_id, version_id, invocation_id, status, iteration, created_at, initial_thread) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      args: [${JSON.stringify(RUN)}, 'local', 'loop', 'version', 'invocation', 'succeeded', 1, '2026-10-18T00:00:00.000Z', '{}'],
    });
    await handle.client.execute('UPDATE gg_upgrade_state SET format_version = 3');
    // One self-contained file: fold the WAL in and leave no sidecars behind.
    await handle.client.execute('PRAGMA wal_checkpoint(TRUNCATE)');
    await handle.client.execute('PRAGMA journal_mode=DELETE');
    handle.close();
    process.stdout.write('seeded', () => process.exit(0));`;
  const r = await spawnCapture(NODE, ['--input-type=module', '-e', script], childEnv(ctx), join(RUN_WORK, 'template'));
  const listing = readdirSync(dir);
  TEMPLATE_DB = join(dir, 'graphgoblin.db');
  const ok = r.exit === 0 && r.stdout.toString() === 'seeded' && listing.length === 1 && listing[0] === 'graphgoblin.db';
  harness('seed-template-store', ok, {
    exit: r.exit,
    stdout: r.stdout.toString(),
    stderr: r.stderr.toString(),
    listing,
    sha256: existsSync(TEMPLATE_DB) ? sha256(readFileSync(TEMPLATE_DB)) : undefined,
  });
  if (!ok) throw new Error('template store seeding failed');
}

let LIVE_OWNER;
function liveOwnerRecord() {
  const ctx = { tmp: join(RUN_WORK, 'owner-probe', 'tmp'), home: join(RUN_WORK, 'owner-probe', 'home') };
  mkdirSync(ctx.tmp, { recursive: true });
  mkdirSync(join(ctx.home, 'AppData', 'Local'), { recursive: true });
  mkdirSync(join(ctx.home, 'AppData', 'Roaming'), { recursive: true });
  let identity;
  let error;
  try {
    identity = execFileSync(
      join(SYSROOT, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$ErrorActionPreference='Stop'; $owner=Get-CimInstance Win32_Process -Filter 'ProcessId = ${process.pid}'; if ($null -ne $owner.CreationDate) { $owner.CreationDate.ToFileTimeUtc().ToString([Globalization.CultureInfo]::InvariantCulture) }`,
      ],
      { encoding: 'utf8', windowsHide: true, env: childEnv(ctx), timeout: 30_000 },
    ).trim();
  } catch (e) {
    error = String(e.stderr ?? e);
  }
  const ok = /^[1-9][0-9]{16,18}$/.test(identity ?? '');
  harness('live-owner-identity (driver PID, constructed env PowerShell)', ok, { pid: process.pid, identity, error });
  if (!ok) throw new Error('could not establish the live owner identity');
  LIVE_OWNER = (token) => JSON.stringify({ pid: process.pid, startedAt: now(), windowsCreationTime: identity, token });
}

function writeTree(root, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}
function staleGuard(path, withMarker) {
  mkdirSync(path);
  if (!withMarker) return undefined;
  const token = randomUUID();
  writeFileSync(join(path, `${token}.json`), JSON.stringify({ pid: DEAD_PID, token }));
  return `${token}.json`;
}
const STALE = (token) => JSON.stringify({ pid: DEAD_PID, token });

/**
 * Build one fixture. `def`:
 *  dbConfigured, dbListed: database names; stale: { dbLock, dbGuard, dbGuardMarker, dirLock, dirGuard,
 *  dirGuardMarker } listed spellings (undefined = absent); hardlinks: [{ name, to }] (to = listed name or
 *  'GUARD_MARKER'); distinct: [{ name, kind, equivalentTo }]; held: { name, content } extra entries.
 */
function buildFixture(ctx, def) {
  const data = join(ctx.caseDir, 'data');
  mkdirSync(data, { recursive: true });
  copyFileSync(TEMPLATE_DB, join(data, def.dbListed));
  writeTree(data, {
    [`workspaces/${RUN}/out.txt`]: 'run output (synthetic)',
    'workspaces/my-notes/keep.txt': 'user directory (synthetic)',
    'artifacts/text/abc': 'artifact body (synthetic)',
    'master.key': `synthetic key material ${ctx.id}`,
    'notes.txt': `owner notes ${ctx.id}`,
    'other.db.graphgoblin.lock': STALE('another database'),
    [`${STAGING}/${STAGING_TOKEN}.json`]: 'abandoned staging marker',
  });
  linkSync(join(data, 'notes.txt'), join(data, 'notes-hardlink.txt'));
  const s = def.stale ?? {};
  const ownership = [];
  const dbLockSpelling = `${def.dbListed}.graphgoblin.lock`;
  const add = (role, guard, listed, spelling) => ownership.push({ role, guard, listed, lockModuleSpelling: spelling });
  let markerName;
  if (s.dbGuard) {
    if (s.dbGuardFiles) {
      mkdirSync(join(data, s.dbGuard));
      for (const [n, c] of Object.entries(s.dbGuardFiles)) writeFileSync(join(data, s.dbGuard, n), c);
    } else markerName = staleGuard(join(data, s.dbGuard), s.dbGuardMarker);
    add('database lock', true, s.dbGuard, dbLockSpelling + '.reclaim');
  }
  if (s.dbLock) {
    writeFileSync(join(data, s.dbLock), s.dbLockContent ?? STALE('stale db'));
    add('database lock', false, s.dbLock, dbLockSpelling);
  }
  if (s.dirGuard) {
    const m = staleGuard(join(data, s.dirGuard), s.dirGuardMarker);
    markerName ??= m;
    add('data-directory lock', true, s.dirGuard, 'graphgoblin.lock.reclaim');
  }
  if (s.dirLock) {
    writeFileSync(join(data, s.dirLock), s.dirLockContent ?? STALE('stale directory'));
    add('data-directory lock', false, s.dirLock, 'graphgoblin.lock');
  }
  for (const extra of def.extra ?? []) {
    if (extra.kind === 'dir') {
      mkdirSync(join(data, extra.name));
      for (const [n, c] of Object.entries(extra.files ?? {})) writeFileSync(join(data, extra.name, n), c);
    } else writeFileSync(join(data, extra.name), extra.content);
  }
  const hardlinks = [];
  for (const h of def.hardlinks ?? []) {
    const target = h.to === 'GUARD_MARKER' ? `${s.dbGuard ?? s.dirGuard}/${markerName}` : h.to;
    mkdirSync(dirname(join(data, h.name)), { recursive: true });
    linkSync(join(data, target), join(data, h.name));
    hardlinks.push({ name: h.name, target });
  }
  hardlinks.push({ name: 'notes-hardlink.txt', target: 'notes.txt' });
  const distinct = [];
  for (const d of def.distinct ?? []) {
    const path = join(data, d.name);
    const created = d.kind === 'dir'
      ? (() => { try { mkdirSync(path); writeFileSync(join(path, `${randomUUID()}.json`), STALE('distinct look-alike guard')); return 'created'; } catch (e) { return e.code; } })()
      : createNew(path, STALE('distinct look-alike'));
    distinct.push({ ...d, created });
  }
  const dbPath = join(data, def.dbConfigured);
  ctx.gg = {
    GG_DATA_DIR: data,
    GG_DB_URL: `file:${dbPath.replace(/\\/g, '/')}`,
    GG_WEB_DIST: '',
    GG_GOBLIN_DIST: '',
    GG_LOG_LEVEL: 'warn',
  };
  const fx = { data, def, ownership, hardlinks, distinct, dbLockSpelling };
  ctx.fx = fx;
  return fx;
}

/** Native proof of equivalence/distinctness before any manifest is interpreted. */
function proveIdentities(ctx) {
  const { data, ownership, hardlinks, distinct } = ctx.fx;
  const listed = readdirSync(data);
  const proof = { listedTopLevel: listed.map((n) => ({ name: n, codepoints: cps(n) })), caseAttribute: caseAttribute(data), ownership: [], hardlinks: [], distinct: [] };
  let ok = true;
  for (const o of ownership) {
    const viaSpelling = nodeId(join(data, o.lockModuleSpelling));
    const viaListed = nodeId(join(data, o.listed));
    const fsSpelling = fsutilId(join(data, o.lockModuleSpelling));
    const fsListed = fsutilId(join(data, o.listed));
    const nat = nativeName(join(data, o.lockModuleSpelling));
    const p = {
      role: o.role,
      guard: o.guard,
      listed: o.listed,
      listedCodepoints: cps(o.listed),
      lockModuleSpelling: o.lockModuleSpelling,
      lockModuleSpellingCodepoints: cps(o.lockModuleSpelling),
      spellingIsListed: listed.includes(o.lockModuleSpelling),
      nodeFileIdViaSpelling: viaSpelling,
      nodeFileIdViaListed: viaListed,
      fsutilFileIdViaSpelling: fsSpelling,
      fsutilFileIdViaListed: fsListed,
      realpathNativeNameViaSpelling: nat,
      cmdDirViaSpelling: o.guard ? 'n/a (directory: dir lists its contents)' : cmdDir(join(data, o.lockModuleSpelling)),
      jsToLowerCaseEqual: o.listed.toLowerCase() === o.lockModuleSpelling.toLowerCase(),
      jsToLowerCaseListed: cps(o.listed.toLowerCase()),
      jsToLowerCaseSpelling: cps(o.lockModuleSpelling.toLowerCase()),
    };
    p.equivalent =
      viaSpelling.id !== undefined &&
      viaSpelling.id === viaListed.id &&
      typeof fsSpelling === 'string' &&
      fsSpelling === fsListed &&
      nat === o.listed &&
      (o.guard || p.cmdDirViaSpelling === o.listed);
    if (!p.equivalent) ok = false;
    proof.ownership.push(p);
  }
  for (const h of hardlinks) {
    const a = nodeId(join(data, h.name));
    const b = nodeId(join(data, h.target));
    const p = { ...h, nodeFileIdLink: a, nodeFileIdTarget: b, fsutilLink: fsutilId(join(data, h.name)), fsutilTarget: fsutilId(join(data, h.target)), realpathNativeNameLink: nativeName(join(data, h.name)) };
    p.listedInItsDirectory = readdirSync(dirname(join(data, h.name))).includes(basename(h.name));
    p.sameFileSeparateEntry = a.id !== undefined && a.id === b.id && a.nlink >= 2 && p.realpathNativeNameLink === basename(h.name) && p.listedInItsDirectory;
    if (!p.sameFileSeparateEntry) ok = false;
    proof.hardlinks.push(p);
  }
  for (const d of distinct) {
    const a = nodeId(join(data, d.name));
    const eq = nodeId(join(data, d.equivalentTo));
    const p = { ...d, codepoints: cps(d.name), comparedWith: d.equivalentTo, comparedWithCodepoints: cps(d.equivalentTo), nodeFileId: a, nodeFileIdOther: eq, fsutil: fsutilId(join(data, d.name)), fsutilOther: fsutilId(join(data, d.equivalentTo)), realpathNativeName: nativeName(join(data, d.name)), jsToLowerCaseEqual: d.name.toLowerCase() === d.equivalentTo.toLowerCase(), jsToUpperCaseEqual: d.name.toUpperCase() === d.equivalentTo.toUpperCase() };
    p.distinct = d.created === 'created' && a.id !== undefined && eq.id !== undefined && a.id !== eq.id && p.fsutil !== p.fsutilOther && p.realpathNativeName === d.name;
    if (!p.distinct) ok = false;
    proof.distinct.push(p);
  }
  ctx.record.identityProof = proof;
  row({ kind: 'identity-proof', case: ctx.id, ok, proof });
  ctx.record.preconditionOk = ok;
  if (!ok) harness(`${ctx.id}: identity precondition`, false, proof);
  return ok;
}

/** Map a manifest row spelling to the listed entry it natively denotes, on the current state. */
function resolveRow(data, path) {
  const full = join(data, ...path.split('/'));
  const id = nodeId(full);
  if (id.error) return { key: `absent:${path}`, exists: false };
  return { key: nativeRel(data, full) ?? `unresolved:${path}`, exists: true, id: id.id };
}
function resolveRows(data, rows, table) {
  return rows.map((r) => {
    const t = table?.get(r.path);
    const res = t ?? resolveRow(data, r.path);
    return { ...r, key: res.key, exists: res.exists, resolvedFrom: t ? 'pre-state table' : 'state at resolution' };
  });
}

// ---------------------------------------------------------------- shared assertion groups
const OWNED_ROOTS = new Set(['artifacts', 'chat-audio']);
function ownedStorePaths(fx, snap) {
  return snap
    .map((r) => r.path)
    .filter((p) => {
      const top = p.split('/')[0];
      if (OWNED_ROOTS.has(top)) return true;
      if (p === `workspaces/${RUN}` || p.startsWith(`workspaces/${RUN}/`)) return true;
      if (!p.includes('/') && ['', '-wal', '-shm', '-journal'].some((s) => p === fx.def.dbListed + s)) return true;
      return false;
    });
}
function ownershipPaths(fx, snap) {
  const listed = new Set(fx.ownership.map((o) => o.listed));
  return snap.map((r) => r.path).filter((p) => listed.has(p.split('/')[0]));
}
function unrelatedTop(fx) {
  const excluded = new Set(['artifacts', 'chat-audio', 'workspaces', fx.def.dbListed, ...fx.ownership.map((o) => o.listed)]);
  return readdirSync(fx.data).filter((n) => !excluded.has(n)).concat(['workspaces/my-notes']);
}

function manifestChecks(ctx, tag, manifest, rowsRemoves, rowsKeeps, predicted) {
  const { fx } = ctx;
  const removesKeys = rowsRemoves.map((r) => r.key);
  const keepsKeys = rowsKeeps.map((r) => r.key);
  const both = [...new Set(removesKeys.filter((k) => keepsKeys.includes(k) && !k.startsWith('absent:')))];
  check(ctx, `${tag}.disjoint`, 'F1', `${tag}: no native directory entry is listed under both Removes and Keeps`, predicted.disjoint ?? 'pass', both.length === 0, { bothSections: both, removes: rowsRemoves, keeps: rowsKeeps });
  return both;
}

function dryRunOwnershipChecks(ctx, tag, rowsRemoves, rowsKeeps, predicted) {
  const { fx } = ctx;
  for (const o of fx.ownership) {
    const inRemoves = rowsRemoves.filter((r) => r.key === o.listed);
    const inKeeps = rowsKeeps.filter((r) => r.key === o.listed);
    const name = `${o.role}${o.guard ? ' guard' : ''}`;
    check(ctx, `${tag}.once.${o.guard ? 'guard' : 'lock'}.${o.role === 'database lock' ? 'db' : 'dir'}`, 'F1', `${tag}: the ${name} (${o.listed}) appears exactly once across both sections, under Removes`, predicted.once?.[o.role]?.[o.guard ? 'guard' : 'lock'] ?? 'pass', inRemoves.length === 1 && inKeeps.length === 0, { listed: o.listed, removesRows: inRemoves.map((r) => r.line), keepsRows: inKeeps.map((r) => r.line) });
    check(ctx, `${tag}.spelling.${o.guard ? 'guard' : 'lock'}.${o.role === 'database lock' ? 'db' : 'dir'}`, 'F1', `${tag}: the Removes row for the ${name} uses the directory-listed spelling ${o.listed}`, predicted.spelling?.[o.role]?.[o.guard ? 'guard' : 'lock'] ?? 'pass', inRemoves.length === 1 && inRemoves[0].path === o.listed, { listed: o.listed, listedCodepoints: cps(o.listed), rowPaths: inRemoves.map((r) => ({ path: r.path, codepoints: cps(r.path) })) });
  }
}

function unrelatedKeepsChecks(ctx, tag, rowsRemoves, rowsKeeps) {
  const { fx } = ctx;
  const failures = [];
  for (const name of unrelatedTop(fx)) {
    const k = rowsKeeps.filter((r) => r.key === name).length;
    const rm = rowsRemoves.filter((r) => r.key === name).length;
    if (k !== 1 || rm !== 0) failures.push({ name, keeps: k, removes: rm });
  }
  check(ctx, `${tag}.unrelated-kept`, 'control', `${tag}: every unrelated entry, hard link and distinct look-alike appears exactly once under Keeps and never under Removes`, 'pass', failures.length === 0, { expected: unrelatedTop(fx), failures });
}

function storeReadable(ctx, tag, manifest) {
  check(ctx, `${tag}.store-format3`, 'harness', `${tag}: the database line reads the seeded format-3 store (run-ID matching precondition)`, 'pass', /\(format 3; this build requires format 4\)/.test(manifest.database ?? ''), { database: manifest.database });
}

function afterResetChecks(ctx, tag, before, after) {
  const { fx } = ctx;
  const diff = snapshotDiff(before, after, { compareNlink: false });
  const expectedRemoved = new Set([...ownedStorePaths(fx, before), ...ownershipPaths(fx, before)]);
  const unexpectedRemoved = diff.removed.filter((p) => !expectedRemoved.has(p));
  const notRemoved = [...expectedRemoved].filter((p) => !diff.removed.includes(p));
  check(ctx, `${tag}.only-owned-removed`, 'control', `${tag}: exactly the store targets and the ownership entries present before were removed`, 'pass', unexpectedRemoved.length === 0 && notRemoved.length === 0, { removed: diff.removed, expectedRemoved: [...expectedRemoved], unexpectedRemoved, notRemoved });
  check(ctx, `${tag}.preserved-identical`, 'control', `${tag}: every other entry is preserved with identical type, size, SHA-256 and file ID`, 'pass', diff.changed.length === 0, { changed: diff.changed });
  check(ctx, `${tag}.nothing-new`, 'control', `${tag}: nothing new remains (the reset's own lock files and guards are gone)`, 'pass', diff.added.length === 0, { added: diff.added });
  const ownershipNames = fx.ownership.map((o) => o.listed);
  const variants = [...new Set([...ownershipNames, ...fx.ownership.map((o) => o.lockModuleSpelling), 'graphgoblin.lock', 'graphgoblin.lock.reclaim', fx.dbLockSpelling, fx.dbLockSpelling + '.reclaim'])];
  const stillThere = variants.filter((v) => !nodeId(join(fx.data, v)).error);
  check(ctx, `${tag}.ownership-absent-all-spellings`, 'control', `${tag}: no ownership entry remains under any listed or lock-module spelling (native lookup)`, 'pass', stillThere.length === 0, { probed: variants, stillThere });
  const hl = fx.hardlinks.map((h) => ({ ...h, after: after.find((r) => r.path === h.name) ?? null, before: before.find((r) => r.path === h.name) }));
  check(ctx, `${tag}.hardlinks-preserved`, 'control', `${tag}: hard links under unrelated names are preserved with identical bytes and file ID`, 'pass', hl.every((h) => h.after && h.after.sha256 === h.before.sha256 && h.after.id === h.before.id), hl);
  if (fx.distinct.length) {
    const ds = fx.distinct.map((d) => ({ name: d.name, before: before.filter((r) => r.path === d.name || r.path.startsWith(d.name + '/')), after: after.filter((r) => r.path === d.name || r.path.startsWith(d.name + '/')) }));
    check(ctx, `${tag}.distinct-preserved`, 'control', `${tag}: distinct look-alike entries are preserved with identical bytes and file IDs`, 'pass', ds.every((d) => JSON.stringify(d.before) === JSON.stringify(d.after.map((r) => ({ ...r, nlink: d.before.find((b) => b.path === r.path)?.nlink ?? r.nlink })))), ds);
  }
  return diff;
}

function releaseChecks(ctx, tag, manifest, stdout, stderr) {
  const rel = manifest.removing;
  const dbRelease = rel.findIndex((l) => /^ {2}removed \S+ \(database lock\)$/.test(l));
  const dirRelease = rel.findIndex((l) => l === '  removed graphgoblin.lock (data-directory lock)');
  check(ctx, `${tag}.release-order`, 'control', `${tag}: completion names the database lock release before the data-directory lock release, then Reset complete.`, 'pass', dbRelease >= 0 && dirRelease > dbRelease && manifest.complete && stderr === '', { removing: rel, stderr });
  return { dbReleaseLine: rel[dbRelease] };
}

// ---------------------------------------------------------------- case runners
function newCase(id, title) {
  const caseDir = join(RUN_WORK, id);
  const ctx = { id, caseDir, tmp: join(caseDir, 'tmp'), home: join(caseDir, 'home'), stepNo: 0, record: { id, title, startedAt: now(), steps: [], assertions: [], observations: [], snapshots: {} } };
  mkdirSync(ctx.tmp, { recursive: true });
  mkdirSync(join(ctx.home, 'AppData', 'Local'), { recursive: true });
  mkdirSync(join(ctx.home, 'AppData', 'Roaming'), { recursive: true });
  return ctx;
}
function finishCase(ctx) {
  ctx.record.finishedAt = now();
  ctx.record.fixture = { data: ctx.fx?.data, gg: ctx.gg, def: ctx.fx?.def };
  results.cases.push(ctx.record);
  row({ kind: 'case-finished', case: ctx.id, assertions: ctx.record.assertions.length });
}

/** Dry run then confirmed, on one fixture. */
async function manifestCase(id, title, def, predicted = {}) {
  const ctx = newCase(id, title);
  try {
    const fx = buildFixture(ctx, def);
    if (!proveIdentities(ctx)) {
      ctx.record.skippedProductAssertions = 'identity precondition failed; product assertions not evaluated';
      return;
    }
    const before = snapshot(fx.data);
    ctx.record.snapshots.before = before;
    const dry = await reset(ctx, 'dry-run', ['--reset']);
    const afterDry = snapshot(fx.data);
    ctx.record.snapshots.afterDry = afterDry;
    check(ctx, 'dry.exit', 'control', 'dry run exits 0 with empty stderr', 'pass', dry.exit === 0 && dry.stderr === '', { exit: dry.exit, stderr: dry.stderr });
    const dryDiff = snapshotDiff(before, afterDry);
    check(ctx, 'dry.bytes-unchanged', 'control', 'dry run changes no name, type, size, SHA-256, file ID or link count', 'pass', dryDiff.identical, dryDiff);
    const m = parseManifest(dry.stdout);
    if (!m.removes) {
      notEvaluated(ctx, 'dry and confirmed manifest assertions', `the dry run printed no manifest (exit ${dry.exit})`);
      return;
    }
    storeReadable(ctx, 'dry', m);
    // Pre-state resolution table: every listed name, every lock-module spelling, every dry-run row.
    const table = new Map();
    const spellings = new Set([...readdirSync(fx.data), ...fx.ownership.map((o) => o.lockModuleSpelling), fx.dbLockSpelling, fx.dbLockSpelling + '.reclaim', 'graphgoblin.lock', 'graphgoblin.lock.reclaim', ...(m.removes ?? []).map((r) => r.path), ...(m.keeps ?? []).map((r) => r.path)]);
    for (const s of spellings) table.set(s, resolveRow(fx.data, s));
    ctx.record.resolutionTable = Object.fromEntries([...table].map(([k, v]) => [k, { ...v, codepoints: cps(k) }]));
    const rRemoves = resolveRows(fx.data, m.removes ?? [], table);
    const rKeeps = resolveRows(fx.data, m.keeps ?? [], table);
    ctx.record.dryManifest = { removes: rRemoves, keeps: rKeeps, database: m.database };
    manifestChecks(ctx, 'dry', m, rRemoves, rKeeps, { disjoint: predicted.dryDisjoint });
    dryRunOwnershipChecks(ctx, 'dry', rRemoves, rKeeps, predicted);
    unrelatedKeepsChecks(ctx, 'dry', rRemoves, rKeeps);

    const conf = await reset(ctx, 'confirmed', ['--reset', '--yes', '--data-dir', fx.data]);
    const after = snapshot(fx.data);
    ctx.record.snapshots.afterConfirmed = after;
    check(ctx, 'confirmed.exit', 'control', 'confirmed reset exits 0', 'pass', conf.exit === 0, { exit: conf.exit, stderr: conf.stderr });
    const cm = parseManifest(conf.stdout);
    const cRemoves = resolveRows(fx.data, cm.removes ?? [], table);
    const cKeeps = resolveRows(fx.data, cm.keeps ?? [], table);
    ctx.record.confirmedManifest = { removes: cRemoves, keeps: cKeeps, removing: cm.removing };
    manifestChecks(ctx, 'confirmed', cm, cRemoves, cKeeps, {});
    // Confirmed stale-guard rows: spelled as the directory listed the guard when the preview ran.
    for (const o of fx.ownership.filter((x) => x.guard)) {
      const rows = cRemoves.filter((r) => r.key === o.listed);
      check(ctx, `confirmed.guard-row-spelling.${o.role === 'database lock' ? 'db' : 'dir'}`, 'F1', `confirmed: the stale ${o.role} guard row names the spelling the directory listed (${o.listed})`, predicted.confirmedGuardSpelling?.[o.role] ?? 'pass', rows.length === 1 && rows[0].path === o.listed, { listed: o.listed, rows: rows.map((r) => ({ line: r.line, path: r.path, codepoints: cps(r.path) })) });
    }
    releaseChecks(ctx, 'confirmed', cm, conf.stdout, conf.stderr);
    afterResetChecks(ctx, 'confirmed', before, after);
    // F2 (observation): attribution wording versus the isolated pre/post observation.
    // I1 (candidate interpretation): every confirmed lock/guard row is classified from its actual wording,
    // including the candidate's "already gone" wording, and judged against the snapshots; no canned verdict.
    const claims = cRemoves.filter((r) => /^(stale lock guard|database lock|data-directory lock)\s/.test(r.rest)).map((r) => {
      const wording = /reclaimed when the reset took/.test(r.rest) ? 'reclaimed-by-this-reset'
        : /replacing a stale one/.test(r.rest) ? 'replaced-stale-by-this-reset'
          : /already gone when the reset took/.test(r.rest) ? 'already-gone-not-attributed'
            : /the reset's own/.test(r.rest) ? 'own-no-stale-claim' : 'other';
      const presentBefore = before.some((b) => b.path === r.key);
      const presentAfter = after.some((a) => a.path === r.key);
      const consistent = wording === 'reclaimed-by-this-reset' || wording === 'replaced-stale-by-this-reset'
        ? presentBefore && !presentAfter
        : wording === 'already-gone-not-attributed' || wording === 'own-no-stale-claim' ? !presentBefore : false;
      return { line: r.line, entry: r.key, wording, presentBefore, presentAfter, consistent };
    });
    const inconsistent = claims.filter((c) => !c.consistent);
    observe(ctx, 'F2.success-attribution', 'F2', 'confirmed manifest lock/guard rows compared with isolated pre/post observation (no other process ran against this fixture during the transaction; the driver awaits each child)', {
      claims,
      consistent: inconsistent.length === 0,
      assessment: inconsistent.length === 0
        ? `all ${claims.length} confirmed lock/guard rows agree with the isolated snapshots (a reclaimed/replaced claim only for an entry present before and absent after; no already-gone or bare own-lock wording for an entry present before). No peer interval was exercised.`
        : `INCONSISTENT: ${inconsistent.map((c) => `${c.entry} (${c.wording}; presentBefore ${c.presentBefore}, presentAfter ${c.presentAfter})`).join('; ')}`,
    });
  } catch (error) {
    harness(`${id}: driver exception`, false, { error: String(error?.stack ?? error) });
    ctx.record.driverError = String(error?.stack ?? error);
  } finally {
    finishCase(ctx);
  }
}

/** A refusal control: dry run and confirmed must both refuse, at the expected stage, changing nothing. */
async function refusalCase(id, title, def, expectation) {
  const ctx = newCase(id, title);
  try {
    const fx = buildFixture(ctx, def);
    if (!proveIdentities(ctx)) {
      ctx.record.skippedProductAssertions = 'identity precondition failed; product assertions not evaluated';
      return;
    }
    const before = snapshot(fx.data);
    ctx.record.snapshots.before = before;
    for (const [step, cli] of [['dry-run', ['--reset']], ['confirmed', ['--reset', '--yes', '--data-dir', fx.data]]]) {
      const r = await reset(ctx, step, cli);
      const after = snapshot(fx.data);
      ctx.record.snapshots[`after-${step}`] = after;
      const diff = snapshotDiff(before, after);
      const first = r.stderr.split('\n')[0];
      const m = /^reset refused: (.*?): (\S.*?); verify ownership before resetting$/.exec(first);
      const named = m?.[2];
      const resolved = named ? { name: nativeName(named), id: nodeId(named) } : undefined;
      const stage = stageOf(r.stderr);
      check(ctx, `${step}.refused`, 'control', `${step}: exits 1 with an explicit refusal and empty stdout`, 'pass', r.exit === 1 && r.stdout === '' && r.stderr.startsWith('reset refused: '), { exit: r.exit, stdout: r.stdout, stderr: r.stderr });
      check(ctx, `${step}.stage`, 'control', `${step}: refusal stage is ${expectation.stage}`, 'pass', stage === expectation.stage, { observedStage: stage, expectedStage: expectation.stage });
      const reasonOk = expectation.reasonPattern ? expectation.reasonPattern.test(first) : (m?.[1]?.includes(expectation.reason) ?? false);
      check(ctx, `${step}.reason`, 'control', `${step}: refusal reason is "${expectation.reason ?? expectation.reasonPattern}"`, 'pass', reasonOk, { first });
      check(ctx, `${step}.unchanged-text`, 'control', `${step}: says nothing in the data directory was changed`, 'pass', r.stderr.endsWith('Nothing in the data directory was changed.\n'), { stderr: r.stderr });
      check(ctx, `${step}.bytes-unchanged`, 'control', `${step}: every name, type, size, SHA-256, file ID and link count is unchanged`, 'pass', diff.identical, diff);
      if (expectation.listed) {
        check(ctx, `${step}.names-held-entry`, 'control', `${step}: the refusal names a path that natively resolves to the ${expectation.entry} entry (${expectation.listed})`, 'pass', resolved?.name === expectation.listed, { named, namedCodepoints: named ? cps(basename(named)) : undefined, resolved });
        observe(ctx, `${step}.spelling`, 'F1', `${step}: spelling used in the refusal path compared with the directory-listed name`, { printedLeaf: named ? basename(named) : undefined, listed: expectation.listed, printedIsListedSpelling: named ? basename(named) === expectation.listed : undefined });
      }
    }
    observe(ctx, 'boundary', 'scope', 'refusal boundary and unexercised later paths', { boundary: expectation.stage, unexercised: ['lock acquisition', 'locked plan', 'manifest printing', 'removal', 'release reporting'] });
  } catch (error) {
    harness(`${id}: driver exception`, false, { error: String(error?.stack ?? error) });
    ctx.record.driverError = String(error?.stack ?? error);
  } finally {
    finishCase(ctx);
  }
}

/** Failed database-lock acquisition after the data-directory lock was taken (hard-linked database). */
async function hardlinkedDbSteps(ctx, tag, predicted) {
  const { fx } = ctx;
  const before = snapshot(fx.data);
  const r = await reset(ctx, `${tag}-confirmed-hardlinked`, ['--reset', '--yes', '--data-dir', fx.data]);
  const after = snapshot(fx.data);
  ctx.record.snapshots[`after-${tag}-confirmed-hardlinked`] = after;
  const lines = r.stderr.split('\n');
  check(ctx, `${tag}.refused`, 'control', `${tag}: confirmed reset exits 1 with empty stdout`, 'pass', r.exit === 1 && r.stdout === '', { exit: r.exit, stdout: r.stdout });
  check(ctx, `${tag}.stage`, 'control', `${tag}: refusal names the database-lock acquisition stage and the hard-link reason`, 'pass', lines[0]?.startsWith('reset refused: could not take the database lock: database ') && lines[0].includes('has multiple hard links'), { first: lines[0] });
  check(ctx, `${tag}.no-store-data`, 'control', `${tag}: says no store data was removed and never that nothing changed`, 'pass', lines[1]?.startsWith('No store data was removed. Taking the database lock failed,') && !r.stderr.includes('Nothing in the data directory was changed'), { second: lines[1] });
  const dbLines = lines.filter((l) => /\((database lock|database lock guard)\):/.test(l));
  check(ctx, `${tag}.db-presence-only`, 'control', `${tag}: database lock and guard are reported with presence wording only, no attribution`, 'pass', dbLines.length === 2 && dbLines.every((l) => /: present now and before the attempt$/.test(l)) && !lines.some((l) => /reclaimed stale \S+ \(database lock/.test(l)), { dbLines });
  check(ctx, `${tag}.dir-release`, 'control', `${tag}: names the data-directory lock release`, 'pass', lines.includes('  removed graphgoblin.lock (data-directory lock)'), { lines });
  const diff = snapshotDiff(before, after, { compareNlink: false });
  const dirOwnership = fx.ownership.filter((o) => o.role === 'data-directory lock').map((o) => o.listed);
  const expectRemoved = before.map((b) => b.path).filter((p) => dirOwnership.includes(p.split('/')[0]));
  check(ctx, `${tag}.only-dir-metadata-changed`, 'control', `${tag}: only the data-directory lock's stale entries are gone; database, its hard link, DB lock/guard, store data and unrelated entries are unchanged`, 'pass', JSON.stringify(diff.removed.sort()) === JSON.stringify(expectRemoved.sort()) && diff.added.length === 0 && diff.changed.length === 0, { diff, expectRemoved });
  // I2 (candidate interpretation): computed from the actual lines and snapshots; no baseline source
  // line reference and no claim that a line was emitted unless it was.
  const reclaimed = lines.filter((l) => l.startsWith('  reclaimed stale '));
  const alreadyGone = lines.filter((l) => /: stale in the preview, already gone when the reset took that lock$/.test(l));
  const entryOf = (l, re) => {
    const p = re.exec(l)?.[1];
    const key = ctx.resolution?.get(p)?.key ?? p;
    return { line: l, printed: p, entry: key, presentBefore: before.some((b) => b.path === key), presentAfter: after.some((a) => a.path === key) };
  };
  const reclaimedEntries = reclaimed.map((l) => entryOf(l, /^ {2}reclaimed stale (\S+) /)).map((e) => ({ ...e, consistent: e.presentBefore && !e.presentAfter }));
  const alreadyGoneEntries = alreadyGone.map((l) => entryOf(l, /^ {2}(\S+) \(/)).map((e) => ({ ...e, consistent: false, note: 'isolated transaction: no other process ran, so an entry the preview found cannot have been removed by anyone else' }));
  const dirOwnershipBefore = fx.ownership.filter((o) => o.role === 'data-directory lock' && before.some((b) => b.path === o.listed) && !after.some((a) => a.path === o.listed)).map((o) => o.listed);
  const unclaimed = dirOwnershipBefore.filter((n) => !reclaimedEntries.some((e) => e.entry === n));
  const f2ok = reclaimedEntries.every((e) => e.consistent) && alreadyGoneEntries.length === 0 && unclaimed.length === 0;
  observe(ctx, `${tag}.F2.reclaimed-lines`, 'F2', `${tag}: post-acquisition refusal attribution lines compared with isolated pre/post observation`, {
    reclaimedLines: reclaimed,
    alreadyGoneLines: alreadyGone,
    entries: reclaimedEntries,
    alreadyGoneEntries,
    takenLockEntriesRemovedButUnclaimed: unclaimed,
    consistent: f2ok,
    assessment: f2ok
      ? `${reclaimed.length} "reclaimed stale" line(s) emitted, each for an entry present before this transaction and absent after; ${alreadyGone.length} "already gone" line(s). No other process ran against this fixture, so this is consistent with the isolated observation. A peer reclamation before acquisition was not orchestrated and remains unobserved.`
      : `INCONSISTENT with the isolated observation: reclaimed ${JSON.stringify(reclaimedEntries.filter((e) => !e.consistent).map((e) => e.entry))}, already-gone ${JSON.stringify(alreadyGoneEntries.map((e) => e.entry))}, removed-but-unclaimed ${JSON.stringify(unclaimed)}`,
  });
  const spelled = lines.filter((l) => /\((database lock|database lock guard|data-directory lock|data-directory lock guard)\)/.test(l)).map((l) => {
    const p = /(?:reclaimed stale |removed |^ {2})(\S+) \(/.exec(l)?.[1];
    const key = ctx.resolution?.get(p)?.key;
    return { line: l, printed: p, nativeEntry: key, printedIsListedSpelling: key === undefined ? 'n/a' : p === key };
  });
  observe(ctx, `${tag}.failure-spelling`, 'F1', `${tag}: spellings used in failure lines compared with directory-listed names`, spelled);
  return { r, diff };
}

async function hardlinkedGreekCase() {
  const id = 'R4G-greek-hardlinked-db';
  const ctx = newCase(id, 'Greek F1 entries with a hard-linked database: dry run, then confirmed refused at database-lock acquisition');
  try {
    const fx = buildFixture(ctx, {
      dbConfigured: 'οσ-1.db',
      dbListed: 'οσ-1.db',
      stale: { dbLock: 'ΟΣ-1.DB.GRAPHGOBLIN.LOCK', dbGuard: 'ΟΣ-1.DB.GRAPHGOBLIN.LOCK.RECLAIM', dbGuardMarker: true, dirLock: 'graphgoblin.lock', dirGuard: 'graphgoblin.lock.reclaim' },
      hardlinks: [{ name: 'backups/οσ-1-hardlink.db', to: 'οσ-1.db' }],
    });
    if (!proveIdentities(ctx)) return;
    const before = snapshot(fx.data);
    ctx.record.snapshots.before = before;
    const dry = await reset(ctx, 'dry-run', ['--reset']);
    const afterDry = snapshot(fx.data);
    check(ctx, 'dry.exit', 'control', 'dry run exits 0', 'pass', dry.exit === 0 && dry.stderr === '', { exit: dry.exit, stderr: dry.stderr });
    check(ctx, 'dry.bytes-unchanged', 'control', 'dry run changes nothing', 'pass', snapshotDiff(before, afterDry).identical, snapshotDiff(before, afterDry));
    const m = parseManifest(dry.stdout);
    if (!m.removes) {
      notEvaluated(ctx, 'dry manifest and confirmed acquisition-refusal assertions', `the dry run printed no manifest (exit ${dry.exit}, stage ${stageOf(dry.stderr)})`);
      return;
    }
    const table = new Map();
    for (const s of new Set([...readdirSync(fx.data), fx.dbLockSpelling, fx.dbLockSpelling + '.reclaim', 'graphgoblin.lock', 'graphgoblin.lock.reclaim', ...(m.removes ?? []).map((r) => r.path), ...(m.keeps ?? []).map((r) => r.path)])) table.set(s, resolveRow(fx.data, s));
    ctx.resolution = table;
    ctx.record.resolutionTable = Object.fromEntries([...table].map(([k, v]) => [k, { ...v, codepoints: cps(k) }]));
    const rRemoves = resolveRows(fx.data, m.removes ?? [], table);
    const rKeeps = resolveRows(fx.data, m.keeps ?? [], table);
    ctx.record.dryManifest = { removes: rRemoves, keeps: rKeeps, database: m.database };
    // L1: baseline labels were 'fail' (expected defect on 71bf970); candidate expectation is 'pass'.
    manifestChecks(ctx, 'dry', m, rRemoves, rKeeps, { disjoint: 'pass' });
    dryRunOwnershipChecks(ctx, 'dry', rRemoves, rKeeps, { once: { 'database lock': { guard: 'pass', lock: 'pass' } }, spelling: { 'database lock': { guard: 'pass', lock: 'pass' } } });
    observe(ctx, 'dry.db-hardlink-listing', 'scope', 'how the dry run lists the subdirectory holding the database hard link (outside the two findings; recorded only)', { removesRows: rRemoves.filter((r) => r.key === 'backups' || r.key === 'οσ-1.db').map((r) => r.line), keepsRows: rKeeps.filter((r) => r.key === 'backups').map((r) => r.line) });
    await hardlinkedDbSteps(ctx, 'R4G', {});
  } catch (error) {
    harness(`${id}: driver exception`, false, { error: String(error?.stack ?? error) });
    ctx.record.driverError = String(error?.stack ?? error);
  } finally {
    finishCase(ctx);
  }
}

async function f2ChainCase() {
  const id = 'F2C-sequential-attribution';
  const ctx = newCase(id, 'Sequential ordinary reset transactions: does each confirmed reset attribute only what its own preview saw?');
  try {
    const fx = buildFixture(ctx, {
      dbConfigured: 'graphgoblin.db',
      dbListed: 'graphgoblin.db',
      stale: { dbLock: 'graphgoblin.db.graphgoblin.lock', dbGuard: 'graphgoblin.db.graphgoblin.lock.reclaim', dbGuardMarker: true, dirLock: 'graphgoblin.lock', dirGuard: 'graphgoblin.lock.reclaim' },
      hardlinks: [{ name: 'backups/graphgoblin-hardlink.db', to: 'graphgoblin.db' }],
      extra: [{ kind: 'dir', name: 'backups-notes', files: { 'readme.txt': 'unrelated backup notes (synthetic)' } }],
    });
    if (!proveIdentities(ctx)) return;
    const s0 = snapshot(fx.data);
    ctx.record.snapshots.before = s0;
    const table = new Map();
    for (const s of new Set([...readdirSync(fx.data), fx.dbLockSpelling, fx.dbLockSpelling + '.reclaim', 'graphgoblin.lock', 'graphgoblin.lock.reclaim'])) table.set(s, resolveRow(fx.data, s));
    ctx.resolution = table;
    // 1. dry run
    const d1 = await reset(ctx, 'tx1-dry-run', ['--reset']);
    const m1 = parseManifest(d1.stdout);
    if (!m1.removes) {
      check(ctx, 'tx1.exit', 'control', 'tx1 dry run exits 0 with a manifest', 'pass', false, { exit: d1.exit, stderr: d1.stderr, stage: stageOf(d1.stderr) });
      notEvaluated(ctx, 'F2 chain tx1-tx5', `tx1 dry run printed no manifest (exit ${d1.exit})`);
      return;
    }
    const r1 = (m1.removes ?? []).map((r) => r.line);
    check(ctx, 'tx1.lists-all-stale', 'control', 'tx1 dry run lists the stale dir lock and guard and the stale DB lock and guard as reclaimed or replaced', 'pass', d1.exit === 0 && r1.some((l) => /^ {2}graphgoblin\.lock\.reclaim\s+stale lock guard\s+reclaimed when the reset takes the data-directory lock$/.test(l)) && r1.some((l) => /^ {2}graphgoblin\.lock\s+data-directory lock\s+stale; replaced by the reset's own/.test(l)) && r1.some((l) => /^ {2}graphgoblin\.db\.graphgoblin\.lock\.reclaim\s+stale lock guard\s+reclaimed when the reset takes the database lock$/.test(l)) && r1.some((l) => /^ {2}graphgoblin\.db\.graphgoblin\.lock\s+database lock\s+stale; replaced/.test(l)), { exit: d1.exit, removes: r1 });
    check(ctx, 'tx1.bytes-unchanged', 'control', 'tx1 dry run changes nothing', 'pass', snapshotDiff(s0, snapshot(fx.data)).identical, {});
    // 2. confirmed, refused at database-lock acquisition (peer from tx5's point of view)
    await hardlinkedDbSteps(ctx, 'tx2', {});
    const s2 = snapshot(fx.data);
    // 3. dry run again
    const d3 = await reset(ctx, 'tx3-dry-run', ['--reset']);
    const m3 = parseManifest(d3.stdout);
    const r3 = (m3.removes ?? []).map((r) => r.line);
    check(ctx, 'tx3.own-preview', 'control', "tx3 dry run: the data-directory lock is the reset's own with no stale guard row; the DB lock and guard are still stale", 'pass', d3.exit === 0 && !r3.some((l) => l.startsWith('  graphgoblin.lock.reclaim ')) && r3.some((l) => /^ {2}graphgoblin\.lock\s+data-directory lock\s+the reset's own; removed last, on release$/.test(l)) && r3.some((l) => /^ {2}graphgoblin\.db\.graphgoblin\.lock\.reclaim\s+stale lock guard/.test(l)) && r3.some((l) => /^ {2}graphgoblin\.db\.graphgoblin\.lock\s+database lock\s+stale; replaced/.test(l)), { removes: r3 });
    check(ctx, 'tx3.bytes-unchanged', 'control', 'tx3 dry run changes nothing', 'pass', snapshotDiff(s2, snapshot(fx.data)).identical, {});
    // 4. fixture step between transactions (driver, not product): remove the database hard link.
    unlinkSync(join(fx.data, 'backups', 'graphgoblin-hardlink.db'));
    observe(ctx, 'tx4.fixture-step', 'scope', 'driver removed the database hard link between transactions (fixture step, not a product action); backups/ stays as an empty unrelated directory', { removed: 'backups/graphgoblin-hardlink.db', at: now() });
    const s4 = snapshot(fx.data);
    ctx.record.snapshots.beforeTx5 = s4;
    // 5. confirmed
    const c5 = await reset(ctx, 'tx5-confirmed', ['--reset', '--yes', '--data-dir', fx.data]);
    const s5 = snapshot(fx.data);
    ctx.record.snapshots.afterTx5 = s5;
    const m5 = parseManifest(c5.stdout);
    const r5 = (m5.removes ?? []).map((r) => r.line);
    check(ctx, 'tx5.exit', 'control', 'tx5 confirmed exits 0', 'pass', c5.exit === 0 && c5.stderr === '', { exit: c5.exit, stderr: c5.stderr });
    check(ctx, 'tx5.no-claim-for-peer-cleared', 'F2', 'tx5 does not claim the data-directory guard or a stale data-directory lock that tx2 cleared before tx5 began', 'pass', !r5.some((l) => l.startsWith('  graphgoblin.lock.reclaim ')) && r5.some((l) => /^ {2}graphgoblin\.lock\s+data-directory lock\s+the reset's own; removed last, on release$/.test(l)), { removes: r5 });
    check(ctx, 'tx5.claims-own-preview', 'F2', 'tx5 lists the DB guard as reclaimed and the DB lock as replacing a stale one (both present in its own preview)', 'pass', r5.some((l) => /^ {2}graphgoblin\.db\.graphgoblin\.lock\.reclaim\s+stale lock guard\s+reclaimed when the reset took the database lock$/.test(l)) && r5.some((l) => /^ {2}graphgoblin\.db\.graphgoblin\.lock\s+database lock\s+the reset's own, replacing a stale one; removed on release$/.test(l)), { removes: r5 });
    releaseChecks(ctx, 'tx5', m5, c5.stdout, c5.stderr);
    const fxAt4 = { ...fx, ownership: fx.ownership.filter((o) => o.role === 'database lock'), hardlinks: fx.hardlinks.filter((h) => h.name !== 'backups/graphgoblin-hardlink.db') };
    const saved = ctx.fx;
    ctx.fx = fxAt4;
    afterResetChecks(ctx, 'tx5', s4, s5);
    ctx.fx = saved;
    // I3 (candidate interpretation): the "established" statement is conditional on the actual tx5 rows.
    const tx5Rows = ctx.record.assertions.filter((a) => a.id === `${id}.tx5.no-claim-for-peer-cleared` || a.id === `${id}.tx5.claims-own-preview`);
    const tx5Ok = tx5Rows.length === 2 && tx5Rows.every((a) => a.result === 'pass');
    observe(ctx, 'F2.chain-assessment', 'F2', 'what the chain establishes', {
      tx5Rows: tx5Rows.map((a) => ({ id: a.id, result: a.result })),
      established: tx5Ok
        ? 'across separate ordinary sequential transactions, tx5 attributed reclamation only to entries present when it ran; the earlier dry run listing (tx1) was not later claimed after a separate ordinary transaction (tx2) cleared those entries'
        : 'NOT established: at least one tx5 attribution row failed or was not evaluated',
      notEstablished: 'whether a peer clearing an entry between the in-process preview and acquisition of a single confirmed transaction is misattributed (the auditor’s source finding); no interleaving was orchestrated',
    });
  } catch (error) {
    harness(`${id}: driver exception`, false, { error: String(error?.stack ?? error) });
    ctx.record.driverError = String(error?.stack ?? error);
  } finally {
    finishCase(ctx);
  }
}

function caseSensitivityProbe() {
  const id = 'S1-ascii-case-distinct';
  const ctx = newCase(id, 'Genuinely distinct ASCII case spellings: supported by the fixture directory?');
  const dir = join(ctx.caseDir, 'probe');
  mkdirSync(dir, { recursive: true });
  const attribute = caseAttribute(dir);
  const a = createNew(join(dir, 'qa-case-probe'), 'lower');
  const b = createNew(join(dir, 'QA-CASE-PROBE'), 'upper');
  const listing = readdirSync(dir);
  const ids = { lower: nodeId(join(dir, 'qa-case-probe')), upper: nodeId(join(dir, 'QA-CASE-PROBE')) };
  const supported = a === 'created' && b === 'created' && ids.lower.id !== ids.upper.id;
  ctx.record.skip = supported ? undefined : { reason: 'the fixture directory does not hold two entries differing only in ASCII case (CREATE_NEW of the second returned EEXIST; same file ID); no flag was changed', attribute, createLower: a, createUpper: b, listing, ids };
  observe(ctx, 'support', 'scope', 'distinct ASCII case spellings', { supported, attribute, createLower: a, createUpper: b, listing, ids });
  finishCase(ctx);
  return supported;
}

// ---------------------------------------------------------------- main
// L1: the baseline passed { dryDisjoint: 'fail', once/spelling db guard+lock: 'fail', confirmedGuardSpelling db: 'fail' }
// for F1A, F1B and D1 (expected defect on 71bf970). The candidate expectation from the public acceptance is 'pass'.
const CANDIDATE_F1_EXPECT = { dryDisjoint: 'pass', once: { 'database lock': { guard: 'pass', lock: 'pass' } }, spelling: { 'database lock': { guard: 'pass', lock: 'pass' } }, confirmedGuardSpelling: { 'database lock': 'pass' } };
const CASES = [
  ['P1-ascii-exact', () => manifestCase('P1-ascii-exact', 'ASCII exact spellings, all stale entries, hard links to a stale lock and a guard marker', {
    dbConfigured: 'graphgoblin.db', dbListed: 'graphgoblin.db',
    stale: { dbLock: 'graphgoblin.db.graphgoblin.lock', dbGuard: 'graphgoblin.db.graphgoblin.lock.reclaim', dbGuardMarker: true, dirLock: 'graphgoblin.lock', dirGuard: 'graphgoblin.lock.reclaim' },
    hardlinks: [{ name: 'db-lock-hardlink.bak', to: 'graphgoblin.db.graphgoblin.lock' }, { name: 'guard-marker-hardlink.json', to: 'GUARD_MARKER' }],
  })],
  ['P2-ascii-case', () => manifestCase('P2-ascii-case', 'ASCII case-different listed spellings (JS lowercase agrees with the filesystem)', {
    dbConfigured: 'store.db', dbListed: 'store.db',
    stale: { dbLock: 'STORE.DB.GRAPHGOBLIN.LOCK', dbGuard: 'STORE.DB.GRAPHGOBLIN.LOCK.RECLAIM', dbGuardMarker: true, dirLock: 'GraphGoblin.Lock', dirGuard: 'GRAPHGOBLIN.LOCK.RECLAIM' },
    hardlinks: [{ name: 'store-lock-hardlink.bak', to: 'STORE.DB.GRAPHGOBLIN.LOCK' }],
  })],
  ['P3-greek-exact', () => manifestCase('P3-greek-exact', 'Greek database, exact lowercase ownership spellings', {
    dbConfigured: 'οσ-1.db', dbListed: 'οσ-1.db',
    stale: { dbLock: 'οσ-1.db.graphgoblin.lock', dbGuard: 'οσ-1.db.graphgoblin.lock.reclaim', dbGuardMarker: true },
    hardlinks: [{ name: 'lock-hardlink.bak', to: 'οσ-1.db.graphgoblin.lock' }],
  })],
  ['P4-greek-nonfinal-upper', () => manifestCase('P4-greek-nonfinal-upper', 'Greek uppercase listed spellings where sigma is not word-final (JS lowercase agrees)', {
    dbConfigured: 'σα-1.db', dbListed: 'σα-1.db',
    stale: { dbLock: 'ΣΑ-1.DB.GRAPHGOBLIN.LOCK', dbGuard: 'ΣΑ-1.DB.GRAPHGOBLIN.LOCK.RECLAIM', dbGuardMarker: true },
    hardlinks: [{ name: 'lock-hardlink.bak', to: 'ΣΑ-1.DB.GRAPHGOBLIN.LOCK' }],
  })],
  ['F1A-greek-final-upper', () => manifestCase('F1A-greek-final-upper', "Auditor shape: root οσ-1.db, uppercase listed stale DB lock and empty guard", {
    dbConfigured: 'οσ-1.db', dbListed: 'οσ-1.db',
    stale: { dbLock: 'ΟΣ-1.DB.GRAPHGOBLIN.LOCK', dbGuard: 'ΟΣ-1.DB.GRAPHGOBLIN.LOCK.RECLAIM', dbGuardMarker: false },
    hardlinks: [{ name: 'lock-hardlink.bak', to: 'ΟΣ-1.DB.GRAPHGOBLIN.LOCK' }],
  }, CANDIDATE_F1_EXPECT)],
  ['F1B-greek-reverse', () => manifestCase('F1B-greek-reverse', 'Reverse: database listed ΟΣ-1.DB (configured οσ-1.db), lowercase listed stale lock and guard', {
    dbConfigured: 'οσ-1.db', dbListed: 'ΟΣ-1.DB',
    stale: { dbLock: 'οσ-1.db.graphgoblin.lock', dbGuard: 'οσ-1.db.graphgoblin.lock.reclaim', dbGuardMarker: true },
    hardlinks: [{ name: 'lock-hardlink.bak', to: 'οσ-1.db.graphgoblin.lock' }, { name: 'guard-marker-hardlink.json', to: 'GUARD_MARKER' }],
  }, CANDIDATE_F1_EXPECT)],
  ['D1-greek-distinct-lookalikes', () => manifestCase('D1-greek-distinct-lookalikes', 'F1A entries plus genuinely distinct final-sigma look-alikes (JS upper/lowercase fold them together)', {
    dbConfigured: 'οσ-1.db', dbListed: 'οσ-1.db',
    stale: { dbLock: 'ΟΣ-1.DB.GRAPHGOBLIN.LOCK', dbGuard: 'ΟΣ-1.DB.GRAPHGOBLIN.LOCK.RECLAIM', dbGuardMarker: true },
    distinct: [{ name: 'ος-1.db.graphgoblin.lock', kind: 'file', equivalentTo: 'ΟΣ-1.DB.GRAPHGOBLIN.LOCK' }, { name: 'ος-1.db.graphgoblin.lock.reclaim', kind: 'dir', equivalentTo: 'ΟΣ-1.DB.GRAPHGOBLIN.LOCK.RECLAIM' }],
    hardlinks: [{ name: 'lock-hardlink.bak', to: 'ΟΣ-1.DB.GRAPHGOBLIN.LOCK' }],
  }, CANDIDATE_F1_EXPECT)],
  ['D2-kelvin-distinct', () => manifestCase('D2-kelvin-distinct', 'ASCII-uppercase equivalent lock and guard plus genuinely distinct Kelvin-sign look-alikes', {
    dbConfigured: 'k.db', dbListed: 'k.db',
    stale: { dbLock: 'K.DB.GRAPHGOBLIN.LOCK', dbGuard: 'K.DB.GRAPHGOBLIN.LOCK.RECLAIM', dbGuardMarker: true },
    distinct: [{ name: '\u212A.db.graphgoblin.lock', kind: 'file', equivalentTo: 'K.DB.GRAPHGOBLIN.LOCK' }, { name: '\u212A.db.graphgoblin.lock.reclaim', kind: 'dir', equivalentTo: 'K.DB.GRAPHGOBLIN.LOCK.RECLAIM' }],
    hardlinks: [{ name: 'lock-hardlink.bak', to: 'K.DB.GRAPHGOBLIN.LOCK' }],
  })],
  ['S1-ascii-case-distinct', async () => caseSensitivityProbe()],
  ['R1-held-db-lock-greek', () => refusalCase('R1-held-db-lock-greek', 'Greek uppercase-listed DB lock held by a live verified owner', {
    dbConfigured: 'οσ-1.db', dbListed: 'οσ-1.db',
    stale: { dbLock: 'ΟΣ-1.DB.GRAPHGOBLIN.LOCK', dbLockContent: LIVE_OWNER('qa live owner db') },
  }, { stage: 'preview lock-state check (before any acquisition)', reason: 'another GraphGoblin process holds this store', entry: 'database lock', listed: 'ΟΣ-1.DB.GRAPHGOBLIN.LOCK' })],
  ['R2-unverifiable-db-guard-greek', () => refusalCase('R2-unverifiable-db-guard-greek', 'Greek uppercase-listed DB guard holding a non-marker file (ownership unverifiable)', {
    dbConfigured: 'οσ-1.db', dbListed: 'οσ-1.db',
    stale: { dbGuard: 'ΟΣ-1.DB.GRAPHGOBLIN.LOCK.RECLAIM', dbGuardFiles: { 'not-a-marker.txt': 'synthetic' } },
  },{ stage: 'preview lock-state check (before any acquisition)', reason: 'Store ownership could not be verified (reclamation guard is not a physical directory with one valid owner marker)', entry: 'database lock guard', listed: 'ΟΣ-1.DB.GRAPHGOBLIN.LOCK.RECLAIM' })],
  ['R3-held-dir-lock-live', () => refusalCase('R3-held-dir-lock-live', 'Data-directory lock (listed GraphGoblin.Lock) held by a live verified owner, with Greek stale DB entries present', {
    dbConfigured: 'οσ-1.db', dbListed: 'οσ-1.db',
    stale: { dbLock: 'ΟΣ-1.DB.GRAPHGOBLIN.LOCK', dbGuard: 'ΟΣ-1.DB.GRAPHGOBLIN.LOCK.RECLAIM', dirLock: 'GraphGoblin.Lock', dirLockContent: LIVE_OWNER('qa live owner dir') },
  }, { stage: 'preview lock-state check (before any acquisition)', reason: 'another GraphGoblin process holds this store', entry: 'data-directory lock', listed: 'GraphGoblin.Lock' })],
  ['R4G-greek-hardlinked-db', () => hardlinkedGreekCase()],
  ['R5-same-dir-hardlinked-db', () => refusalCase('R5-same-dir-hardlinked-db', 'Greek database with a hard link in the same directory, plus F1A stale DB entries (run-1 observed boundary, now a deliberate control)', {
    dbConfigured: 'οσ-1.db', dbListed: 'οσ-1.db',
    stale: { dbLock: 'ΟΣ-1.DB.GRAPHGOBLIN.LOCK', dbGuard: 'ΟΣ-1.DB.GRAPHGOBLIN.LOCK.RECLAIM', dirLock: 'graphgoblin.lock', dirGuard: 'graphgoblin.lock.reclaim' },
    hardlinks: [{ name: 'οσ-1-hardlink.db', to: 'οσ-1.db' }],
  }, { stage: 'preview path resolution (before any acquisition)', reasonPattern: /^reset refused: the data directory lists οσ-1\.db under more than one name \(οσ-1-hardlink\.db, οσ-1\.db\); a reset cannot tell which one the configuration means$/ })],
  ['F2C-sequential-attribution', () => f2ChainCase()],
];

async function mainRun() {
  results.bindingBefore = binding();
  harness('binding-before', results.bindingBefore.statusPorcelain === '', results.bindingBefore);
  results.versions = { node: process.version, platform: process.platform, arch: process.arch };
  results.distFiles = Object.fromEntries(DIST_FILES.map((f) => [f, existsSync(join(REPO, f)) ? sha256(readFileSync(join(REPO, f))) : null]));
  harness('dist-files-present', Object.values(results.distFiles).every(Boolean), results.distFiles);
  await seedTemplate();
  liveOwnerRecord();
  for (const [id, run] of CASES) {
    if (ONLY && !ONLY.includes(id)) continue;
    await run();
  }
  results.bindingAfter = binding();
  harness('binding-after', results.bindingAfter.statusPorcelain === '' && results.bindingAfter.head === results.bindingBefore.head && results.bindingAfter.tree === results.bindingBefore.tree, results.bindingAfter);
}

try {
  await mainRun();
} catch (error) {
  harness('driver-fatal', false, { error: String(error?.stack ?? error) });
} finally {
  results.finishedAt = now();
  const all = results.cases.flatMap((c) => c.assertions);
  const count = (k) => all.filter((a) => a.classification === k).length;
  results.totals = {
    cases: results.cases.length,
    assertions: all.length,
    pass: all.filter((a) => a.result === 'pass').length,
    fail: all.filter((a) => a.result === 'fail').length,
    controlPass: count('control-pass'),
    expectedDefectReproduced: count('expected-defect-reproduced'),
    defectNotReproduced: count('defect-not-reproduced'),
    unexpectedFail: count('unexpected-fail'),
    observations: results.cases.reduce((n, c) => n + c.observations.length, 0),
    skips: results.cases.filter((c) => c.skip || c.skippedProductAssertions).map((c) => ({ id: c.id, skip: c.skip ?? c.skippedProductAssertions })),
    harnessFailures: results.harness.filter((h) => !h.ok).map((h) => h.name),
  };
  const file = join(RUN_EVIDENCE, 'results.json');
  writeFileSync(file, JSON.stringify(results, null, 2));
  const digest = sha256(readFileSync(file));
  const rowsDigest = sha256(readFileSync(ROWS));
  writeFileSync(join(RUN_EVIDENCE, 'results.sha256'), `${digest}  results.json\n${rowsDigest}  rows.jsonl\n`);
  for (const f of [file, ROWS, join(RUN_EVIDENCE, 'results.sha256')]) chmodSync(f, 0o444);
  console.log(JSON.stringify({ runId: RUN_ID, evidence: RUN_EVIDENCE, resultsSha256: digest, totals: results.totals }, null, 2));
}
