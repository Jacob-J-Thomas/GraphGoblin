#!/usr/bin/env node
// GraphGoblin #434 independent QA: targeted controls that supplement (never replace) the reusable
// 13-case driver qa-434-reset-locks.mjs, which is run unchanged. Same method: the real built CLI
// `node <checkout>/apps/api/dist/main.js --reset [--yes] --data-dir <dir>` as a separate process,
// disposable fixtures only, filesystem snapshot before, printed manifest, output, snapshot after.
// Ownership state comes from the checkout's own built lock code (holder.mjs, unchanged) and a
// record-replacing helper (replacer.mjs); stores from seed-store.mjs (unchanged).
//
// Checks on completion and failure messages are wording-neutral: a line must name the lock's path
// as its own token (so `graphgoblin.lock` never matches inside `graphgoblin.db.graphgoblin.lock`)
// together with the claimed effect, and the claim is compared with the after tree.
//
// Isolation is as in the 13-case driver: a minimal child environment (no inherited GG_* values),
// USERPROFILE/HOME/TEMP/TMP/APPDATA/LOCALAPPDATA inside the run folder; Git read-only with
// --no-optional-locks; nothing is written to the checkout.
//
// Usage:
//   node qa-434-targeted-controls.mjs --checkout <path> --label <name> [--expect-head <sha>]
//        [--regrade <13-case results.json>] [--only T01,T02] [--keep-fixtures] [--out <file.json>]
// Exit 0 when the driver ran to completion (assertion failures are results), 1 on a driver error.
import { spawn, execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, link, lstat, mkdir, readFile, readdir, readlink, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const DRIVER_DIR = dirname(fileURLToPath(import.meta.url));
const SCRATCH = resolve(DRIVER_DIR, '..');
const RUN_IDS = ['01KQA434RVNAAAAAAAAAAAAAAA', '01KQA434RVNBBBBBBBBBBBBBBB'];
const DIR_LOCK = 'graphgoblin.lock';
const DIR_GUARD = 'graphgoblin.lock.reclaim';

// ---------------------------------------------------------------- arguments and provenance
function parseArgs(argv) {
  const o = { keep: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--checkout') o.checkout = argv[++i];
    else if (a === '--label') o.label = argv[++i];
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--expect-head') o.expectHead = argv[++i];
    else if (a === '--regrade') o.regrade = argv[++i];
    else if (a === '--only') o.only = argv[++i].split(',');
    else if (a === '--keep-fixtures') o.keep = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!o.checkout || !o.label) throw new Error('--checkout and --label are required');
  if (!/^[A-Za-z0-9._-]+$/.test(o.label)) throw new Error('--label: letters, digits, . _ - only');
  o.checkout = resolve(o.checkout);
  o.out = resolve(o.out ?? join(SCRATCH, 'results', `${o.label}-targeted-results.json`));
  if (o.regrade) o.regrade = resolve(o.regrade);
  return o;
}

const inside = (root, path) => {
  const rel = relative(root, path);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
};
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

async function provenance(checkout, expectHead) {
  const git = (args) =>
    promisify(execFile)('git', ['--no-optional-locks', '-C', checkout, ...args], { windowsHide: true }).then(
      ({ stdout }) => stdout.trim(),
      (e) => `git failed: ${e.message.split('\n')[0]}`,
    );
  const head = await git(['rev-parse', 'HEAD']);
  const status = await git(['status', '--porcelain', '--untracked-files=no']);
  const files = {};
  for (const rel of [
    'apps/api/dist/main.js',
    'apps/api/dist/reset/reset.js',
    'apps/api/dist/data-dir-lock.js',
    'apps/api/src/reset/reset.ts',
    'apps/api/src/data-dir-lock.ts',
  ]) {
    const p = join(checkout, ...rel.split('/'));
    files[rel] = existsSync(p) ? sha(await readFile(p)) : 'missing';
  }
  return {
    checkout,
    head,
    expectHead: expectHead ?? null,
    headMatches: expectHead ? head === expectHead : null,
    trackedChanges: status ? status.split('\n') : [],
    node: process.version,
    platform: process.platform,
    fileSha256: files,
  };
}

// ---------------------------------------------------------------- processes
function childEnv(ctx, extra = {}) {
  const sys = process.env.SystemRoot ?? 'C:\\Windows';
  return {
    SystemRoot: sys,
    windir: sys,
    SystemDrive: process.env.SystemDrive ?? 'C:',
    ComSpec: join(sys, 'System32', 'cmd.exe'),
    PATHEXT: '.COM;.EXE;.BAT;.CMD',
    PATH: [dirname(process.execPath), join(sys, 'System32'), join(sys, 'System32', 'WindowsPowerShell', 'v1.0')].join(';'),
    TEMP: ctx.temp,
    TMP: ctx.temp,
    TMPDIR: ctx.temp,
    USERPROFILE: ctx.home,
    HOME: ctx.home,
    APPDATA: join(ctx.home, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(ctx.home, 'AppData', 'Local'),
    GG_OLLAMA_ENABLED: 'false',
    ...extra,
  };
}

function runNode(args, env, cwd, timeoutMs = 180_000) {
  return new Promise((done) => {
    const started = Date.now();
    const child = spawn(process.execPath, args, { env, cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8').on('data', (d) => (out += d));
    child.stderr.setEncoding('utf8').on('data', (d) => (err += d));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      err += '\n[qa-driver] timed out and killed';
    }, timeoutMs);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      done({ code, signal, out, err, ms: Date.now() - started, pid: child.pid });
    });
  });
}

/** Start holder.mjs (args [mode, checkout, arg]) or replacer.mjs (args [checkout, file]). */
async function startHelper(ctx, script, args) {
  const child = spawn(process.execPath, [join(DRIVER_DIR, script), ...args], {
    env: childEnv(ctx),
    cwd: ctx.base,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const messages = [];
  const waiters = [];
  let buffer = '';
  let stderr = '';
  let exitInfo;
  const notify = () => [...waiters].forEach((w) => w());
  child.stdout.setEncoding('utf8').on('data', (d) => {
    buffer += d;
    for (let i; (i = buffer.indexOf('\n')) >= 0; ) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      try {
        messages.push(JSON.parse(line));
      } catch {
        /* ignore non-JSON */
      }
    }
    notify();
  });
  child.stderr.setEncoding('utf8').on('data', (d) => (stderr += d));
  const exited = new Promise((r) =>
    child.on('exit', (code, signal) => {
      exitInfo = { code, signal };
      r(exitInfo);
      notify();
    }),
  );
  const until = (pred, ms = 90_000) =>
    new Promise((res, rej) => {
      const cleanup = () => {
        clearTimeout(timer);
        const i = waiters.indexOf(check);
        if (i >= 0) waiters.splice(i, 1);
      };
      const check = () => {
        const m = messages.find(pred);
        if (m) {
          cleanup();
          res(m);
        } else if (exitInfo) {
          cleanup();
          rej(new Error(`${script} exited ${JSON.stringify(exitInfo)} ${stderr} ${JSON.stringify(messages)}`));
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        rej(new Error(`${script} timed out`));
      }, ms);
      waiters.push(check);
      check();
    });
  const ready = await until((m) => 'ready' in m);
  if (!ready.ready) throw new Error(`${script} ${args[0]} failed: ${ready.error}`);
  const helper = {
    pid: child.pid,
    messages,
    until,
    kill: async () => {
      if (exitInfo) return exitInfo;
      child.kill('SIGKILL');
      return exited;
    },
  };
  ctx.holders.push(helper);
  return helper;
}
const startHolder = (ctx, mode, arg) => startHelper(ctx, 'holder.mjs', [mode, ctx.checkout, arg]);

// ---------------------------------------------------------------- filesystem evidence
async function snapshot(root) {
  const map = new Map();
  async function walk(rel) {
    const full = rel ? join(root, ...rel.split('/')) : root;
    for (const name of (await readdir(full)).sort()) {
      const r = rel ? `${rel}/${name}` : name;
      const p = join(full, name);
      const st = await lstat(p);
      if (st.isSymbolicLink()) map.set(r, { kind: 'link', target: await readlink(p) });
      else if (st.isDirectory()) {
        map.set(r, { kind: 'dir' });
        await walk(r);
      } else if (st.isFile()) {
        let digest;
        try {
          digest = sha(await readFile(p)).slice(0, 16);
        } catch (e) {
          digest = `unreadable:${e.code}`;
        }
        map.set(r, { kind: 'file', size: Number(st.size), sha: digest });
      } else map.set(r, { kind: 'other' });
    }
  }
  await walk('');
  return map;
}

function diff(before, after) {
  const removed = [];
  const added = [];
  const changed = [];
  for (const [k, v] of before) {
    const w = after.get(k);
    if (!w) removed.push(k);
    else if (JSON.stringify(v) !== JSON.stringify(w)) changed.push(k);
  }
  for (const k of after.keys()) if (!before.has(k)) added.push(k);
  return { removed, added, changed };
}

const treeRecord = (map) => Object.fromEntries([...map].map(([k, v]) => [k, v.kind === 'file' ? `file ${v.size}B ${v.sha}` : v.kind]));
const hasCI = (map, key) => [...map.keys()].some((k) => k.toLowerCase() === key.toLowerCase());

// ---------------------------------------------------------------- output parsing
// As the 13-case driver, plus `no store data` (the candidate's wording for an empty target list).
const PROSE = [/^nothing but the lock file$/, /^no store data$/, /^\.\.\. and \d+ more/, /^Browser device drafts/, /^nothing else is in the data directory$/];
function parseManifest(text) {
  const lines = text.split(/\r?\n/);
  const section = (title) => {
    const i = lines.indexOf(title);
    if (i < 0) return [];
    const rows = [];
    for (let j = i + 1; j < lines.length && lines[j].trim() !== ''; j++) rows.push(lines[j].trim());
    return rows;
  };
  const rows = (r) =>
    r
      .filter((x) => !PROSE.some((p) => p.test(x)))
      .map((x) => {
        const c = /^(\S+)\s*(.*)$/.exec(x);
        return { path: c[1].replaceAll('\\', '/'), rest: c[2].replace(/\s{2,}/g, ' | ') };
      });
  const at = lines.indexOf('Removing:');
  const removingSection = at < 0 ? '' : lines.slice(at).join('\n');
  const removedLines = at < 0 ? [] : [...removingSection.matchAll(/^\s+removed (\S+)/gm)].map((x) => ({ path: x[1].replaceAll('\\', '/') }));
  return { printed: lines.includes('Removes:'), removes: rows(section('Removes:')), keeps: rows(section('Keeps:')), removingSection, removedLines };
}

const eq = (a, b, ci) => (ci ? a.toLowerCase() === b.toLowerCase() : a === b);
const listed = (rows, rel, ci = false) => rows.some((r) => eq(r.path, rel, ci));
const coveredBy = (rows, rel, ci = false) =>
  rows.some((r) => eq(r.path, rel, ci) || (ci ? rel.toLowerCase().startsWith(r.path.toLowerCase() + '/') : rel.startsWith(r.path + '/')));
const pathsOf = (rows, ci = false) => rows.map((r) => (ci ? r.path.toLowerCase() : r.path)).sort();

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Lines naming `rel` as its own path token (a preceding `/` or `\` is allowed, a preceding `.` or word character is not). */
const linesNaming = (text, rel) => {
  const re = new RegExp(`(^|[^\\w.])${esc(rel)}(?![\\w.])`, 'i');
  return text.split(/\r?\n/).filter((l) => re.test(l.replaceAll('\\', '/')));
};

function failureList(err, label) {
  const m = new RegExp(`^\\s*${label}:\\s*(.*)$`, 'm').exec(err);
  if (!m) return undefined;
  if (m[1].trim() === 'nothing') return [];
  return m[1]
    .replace(/, and \d+ more$/, '')
    .split(', ')
    .map((s) => s.replace(/ \(.*\)$/, '').trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------- fixtures
async function put(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

/**
 * A disposable data directory inside ctx.fixture. `db`: 'default' | 'nested'. `dataDir` overrides
 * the location (T09: <fixture>/home/.graphgoblin); `envDataDir: false` leaves GG_DATA_DIR unset.
 */
async function buildFixture(ctx, { db = 'default', dataDir, envDataDir = true } = {}) {
  const data = dataDir ?? join(ctx.fixture, 'data');
  const dataKey = relative(ctx.fixture, data).replaceAll('\\', '/');
  const outside = join(ctx.fixture, 'outside');
  await mkdir(data, { recursive: true });
  await put(join(outside, 'precious.txt'), 'outside the data directory; never touched');
  const unrelatedTop = {
    'master.key': 'disposable QA key material (not a real secret)',
    'notes.txt': 'owner notes (disposable)',
    'other.db.graphgoblin.lock': 'lock-like name of another database; unrelated to this configuration',
    'graphgoblin.db.graphgoblin.lock.bak': 'user backup copy with a lock-like name',
    'graphgoblin.lock.old': 'user file with a lock-like name',
  };
  for (const [name, body] of Object.entries(unrelatedTop)) await put(join(data, name), body);
  await put(join(data, 'workspaces', 'my-notes', 'keep.txt'), 'user directory under workspaces');
  const unrelated = [
    ...Object.keys(unrelatedTop).map((n) => `${dataKey}/${n}`),
    `${dataKey}/workspaces/my-notes`,
    `${dataKey}/workspaces/my-notes/keep.txt`,
    'outside/precious.txt',
  ];
  const expectKeeps = [...Object.keys(unrelatedTop), 'workspaces/my-notes'];
  await put(join(data, 'artifacts', 'text', 'abc123'), 'artifact body');
  await put(join(data, 'chat-audio', 'clip.webm'), 'audio bytes');
  for (const id of RUN_IDS) await put(join(data, 'workspaces', id, 'src', 'out.txt'), id);
  const dbRel = db === 'nested' ? 'db/store.db' : 'graphgoblin.db';
  const dbFile = join(data, ...dbRel.split('/'));
  // v3: db 'none' leaves the database file absent (the shape of the candidate's own unit test).
  if (db !== 'none') {
    await mkdir(dirname(dbFile), { recursive: true });
    await copyFile(join(ctx.seed, 'graphgoblin.db'), dbFile);
    await copyFile(join(ctx.seed, 'graphgoblin.db-wal'), `${dbFile}-wal`);
  }
  const env = envDataDir ? { GG_DATA_DIR: data } : {};
  if (db === 'nested') env.GG_DB_URL = `file:${dbFile.replaceAll('\\', '/')}`;
  const dbLockRel = `${dbRel}.graphgoblin.lock`;
  return {
    data,
    dataKey,
    dbRel,
    dbFile,
    dbLockRel,
    dbLockFile: `${dbFile}.graphgoblin.lock`,
    dbGuardRel: `${dbLockRel}.reclaim`,
    env,
    unrelated,
    expectKeeps,
  };
}

const dk = (fx, rel) => `${fx.dataKey}/${rel}`;
const dataRel = (fx, k) => (k.startsWith(fx.dataKey + '/') ? k.slice(fx.dataKey.length + 1) : undefined);

function ownedBy(fx, rel, ci = false) {
  const r = ci ? rel.toLowerCase() : rel;
  const n = (s) => (ci ? s.toLowerCase() : s);
  const parts = ['', '-wal', '-shm', '-journal'].map((s) => n(fx.dbRel + s));
  const under = (p) => r === n(p) || r.startsWith(n(p) + '/');
  return (
    parts.includes(r) ||
    under('artifacts') ||
    under('chat-audio') ||
    RUN_IDS.some((id) => under(`workspaces/${id}`)) ||
    r === n(DIR_LOCK) ||
    under(DIR_GUARD) ||
    r === n(fx.dbLockRel) ||
    under(fx.dbGuardRel)
  );
}

// ---------------------------------------------------------------- assertions
function recorder(sc) {
  return (run, id, kind, criterion, pass, expected, actual) => {
    sc.assertions.push({ id: `${sc.id}.${run}.${id}`, kind, criterion, outcome: pass === null ? 'not-run' : pass ? 'pass' : 'fail', expected, actual });
  };
}

async function runReset(ctx, fx, argv, extraEnv = {}) {
  const main = join(ctx.checkout, 'apps', 'api', 'dist', 'main.js');
  const before = await snapshot(ctx.fixture);
  const res = await runNode([main, ...argv], childEnv(ctx, { ...fx.env, ...extraEnv }), ctx.base);
  const after = await snapshot(ctx.fixture);
  const tempLeft = (await readdir(ctx.temp)).filter((n) => n.startsWith('gg-reset-store-'));
  return { argv, env: { ...fx.env, ...extraEnv }, res, before, after, d: diff(before, after), m: parseManifest(res.out), tempLeft };
}

function record(sc, name, r, ctx) {
  const show = (s) => s.replaceAll(ctx.base, '<run>');
  sc.runs.push({
    name,
    ggEnv: Object.fromEntries(Object.entries(r.env).map(([k, v]) => [k, show(v)])),
    argv: r.argv.map(show),
    exitCode: r.res.code,
    signal: r.res.signal,
    ms: r.res.ms,
    stdout: r.res.out,
    stderr: r.res.err,
    manifest: { removes: r.m.removes, keeps: r.m.keeps },
    fsDiff: r.d,
    treeBefore: treeRecord(r.before),
    treeAfter: treeRecord(r.after),
    tempLeftovers: r.tempLeft,
  });
}

const dryArgs = (fx) => ['--reset', '--data-dir', fx.data];
const yesArgs = (fx) => ['--reset', '--yes', '--data-dir', fx.data];
const noStack = (err) => !/\n\s+at .+\(.+:\d+:\d+\)/.test(err);

/** Wording-neutral release report: the lock is absent after and a line names it with removed/released. */
function releaseReported(text, rel, after, fx) {
  const lines = linesNaming(text, rel);
  const gone = !after.has(dk(fx, rel));
  return { pass: gone && lines.some((l) => /remov|releas/i.test(l) && !/could not|kept|not remov/i.test(l)), gone, lines };
}

function checkDry(A, run, fx, r, { ci = false } = {}) {
  const { res, d, m } = r;
  A(run, 'exit0', 'positive', 'CTL', res.code === 0, 'exit 0', res.code);
  A(run, 'stderrEmpty', 'positive', 'CTL', res.err === '', 'empty stderr', res.err.slice(0, 300));
  A(run, 'noByteChange', 'safety', 'AC3', !d.removed.length && !d.added.length && !d.changed.length, 'fixture tree byte-identical', d);
  A(run, 'dryRunHeaderAndTrailer', 'positive', 'DIFF', res.out.startsWith('GraphGoblin reset (dry run: nothing is removed)') && res.out.includes('Nothing was removed.'), 'dry-run header and trailer', res.out.split('\n')[0]);
  A(run, 'noRemovalSection', 'positive', 'DIFF', m.removingSection === '', 'no "Removing:" section', m.removingSection.slice(0, 200));
  const missingKeeps = fx.expectKeeps.filter((p) => !listed(m.keeps, p, ci));
  A(run, 'unrelatedListedAsKept', 'positive', 'AC3', missingKeeps.length === 0, fx.expectKeeps, { missing: missingKeeps });
}

function checkConfirmed(A, run, fx, r, dry, { ci = false, removedLinesFrom } = {}) {
  const { res, d, m, after, before } = r;
  A(run, 'exit0', 'positive', 'CTL', res.code === 0, 'exit 0', res.code);
  A(run, 'resetComplete', 'positive', 'DIFF', res.out.includes('Reset complete.'), '"Reset complete."', res.out.slice(-200));
  const damaged = fx.unrelated.filter((k) => JSON.stringify(before.get(k)) !== JSON.stringify(after.get(k)));
  A(run, 'unrelatedPreservedByteForByte', 'safety', 'AC3', damaged.length === 0, fx.unrelated, { changedOrMissing: damaged });
  const foreign = d.removed.filter((k) => dataRel(fx, k) === undefined || !ownedBy(fx, dataRel(fx, k), ci));
  A(run, 'removedOnlyOwned', 'safety', 'AC3', foreign.length === 0, 'every removed path is store content or this configuration\'s lock metadata', { notOwned: foreign, removed: d.removed });
  A(run, 'nothingAddedOrChanged', 'safety', 'AC3', d.added.length === 0 && d.changed.length === 0, 'no entry added or modified', { added: d.added, changed: d.changed });
  const keptButGone = m.keeps.map((k) => k.path).filter((p) => !(ci ? hasCI(after, dk(fx, p)) : after.has(dk(fx, p))));
  A(run, 'keepsListIsTruthful', 'acceptance', 'AC1', keptButGone.length === 0, 'every Keeps path exists after the reset', { listedAsKeptButRemoved: keptButGone });
  const removesStill = m.removes.map((k) => k.path).filter((p) => (ci ? hasCI(after, dk(fx, p)) : after.has(dk(fx, p))));
  A(run, 'removesListIsTruthful', 'positive', 'AC1', removesStill.length === 0, 'every Removes path is absent after the reset', { stillPresent: removesStill });
  const disclosedBy = [...m.removes, ...m.removedLines, ...(removedLinesFrom ?? [])];
  const unlisted = d.removed.map((k) => dataRel(fx, k)).filter((p) => p !== undefined && !coveredBy(disclosedBy, p, ci));
  A(run, 'noUnlistedRemoval', 'acceptance', 'AC1', unlisted.length === 0, `every pre-existing path the reset removed is disclosed by a Removes row or "removed" line${ci ? ' (case-insensitive)' : ''}`, { removedButUnlisted: unlisted });
  A(run, 'dbLockNotListedAsKept', 'acceptance', 'AC1', !listed(m.keeps, fx.dbLockRel, ci), `${fx.dbLockRel} absent from Keeps`, pathsOf(m.keeps));
  A(run, 'dbLockClassifiedAsRemoved', 'acceptance', 'AC1', listed(m.removes, fx.dbLockRel, ci), `${fx.dbLockRel} listed under Removes`, pathsOf(m.removes));
  const dir = releaseReported(m.removingSection, DIR_LOCK, after, fx);
  A(run, 'completionReportsDirLockRemoved', 'positive', 'AC2', dir.pass, 'graphgoblin.lock absent and a completion line names it as removed', dir);
  const db = releaseReported(m.removingSection, fx.dbLockRel, after, fx);
  A(run, 'completionReportsDbLockRemoved', 'acceptance', 'AC2', db.pass, `${fx.dbLockRel} absent and a completion line names it as removed`, db);
  const lockState = Object.fromEntries([DIR_LOCK, DIR_GUARD, fx.dbLockRel, fx.dbGuardRel].map((p) => [p, hasCI(after, dk(fx, p)) ? 'present' : 'absent']));
  A(run, 'locksReleased', 'positive', 'CTL', Object.values(lockState).every((v) => v === 'absent'), 'no lock or guard of this configuration left', lockState);
  A(run, 'tempCopiesCleaned', 'safety', 'CTL', r.tempLeft.length === 0, 'no gg-reset-store-* left in the isolated TEMP', r.tempLeft);
  if (dry) {
    const same = (a, b) => JSON.stringify(pathsOf(a, ci)) === JSON.stringify(pathsOf(b, ci));
    A(run, 'manifestParityWithDryRun', 'acceptance', 'AC1', same(dry.m.removes, m.removes) && same(dry.m.keeps, m.keeps), `dry-run and confirmed Removes/Keeps path sets equal${ci ? ' (case-insensitive)' : ''}`, {
      dryRemoves: pathsOf(dry.m.removes),
      confirmedRemoves: pathsOf(m.removes),
      dryKeeps: pathsOf(dry.m.keeps),
      confirmedKeeps: pathsOf(m.keeps),
    });
  }
}

function checkRefusal(A, run, r, { names, because, nothingChanged = true }) {
  const { res, d } = r;
  const norm = (s) => s.replaceAll('\\', '/');
  A(run, 'exit1', 'positive', 'CTL', res.code === 1, 'exit 1', res.code);
  A(run, 'stdoutEmpty', 'positive', 'CTL', res.out === '', 'no manifest printed', res.out.slice(0, 200));
  A(run, 'refusalNamesPath', 'positive', 'AC2', norm(res.err).includes(norm(names)), `stderr names ${names}`, res.err.trim());
  if (because) A(run, 'refusalReason', 'positive', 'CTL', res.err.includes(because), `stderr says "${because}"`, res.err.trim());
  A(run, 'noStackTrace', 'positive', 'CTL', noStack(res.err), 'no stack trace in stderr', res.err.trim().split('\n').slice(0, 4));
  if (nothingChanged) {
    A(run, 'claimsNothingChanged', 'positive', 'CTL', res.err.includes('Nothing in the data directory was changed.'), 'refusal says nothing changed', res.err.trim().split('\n').at(-1));
    A(run, 'noByteChange', 'safety', 'AC3', !d.removed.length && !d.added.length && !d.changed.length, 'fixture tree byte-identical', d);
  }
  A(run, 'tempCopiesCleaned', 'safety', 'CTL', r.tempLeft.length === 0, 'no gg-reset-store-* left', r.tempLeft);
}

/** Wording-neutral re-grade of a 13-case S08 confirmed run (from its recorded stderr and after tree). */
function gradeS08Semantic(A, run, stderr, afterHas) {
  const lines = (rel) => linesNaming(stderr, rel);
  const ok = (rel) => !afterHas(`data/${rel}`) && lines(rel).some((l) => /remov|releas/i.test(l) && !/could not|kept|not remov/i.test(l));
  A(run, 'dirLockReleasedAndReportedSemantic', 'positive', 'AC2', ok(DIR_LOCK), 'graphgoblin.lock absent and a failure-message line names it as removed or released', { dirLockPresentAfter: afterHas(`data/${DIR_LOCK}`), linesNaming: lines(DIR_LOCK) });
  A(run, 'dbLockReleasedAndReportedSemantic', 'acceptance', 'AC2', ok('graphgoblin.db.graphgoblin.lock'), 'graphgoblin.db.graphgoblin.lock absent and a failure-message line names it as removed or released', { dbLockPresentAfter: afterHas('data/graphgoblin.db.graphgoblin.lock'), linesNaming: lines('graphgoblin.db.graphgoblin.lock') });
}

// ---------------------------------------------------------------- scenarios
const SCENARIOS = [
  {
    id: 'T01',
    title: 'S08 re-executed with wording-neutral grading: artifact held open, confirmed reset stops part way',
    async run(ctx, sc) {
      const fx = await buildFixture(ctx);
      const held = join(fx.data, 'artifacts', 'text', 'held.bin');
      await put(held, 'held artifact bytes');
      const heldSha = sha(await readFile(held)).slice(0, 16);
      const h = await startHolder(ctx, 'exfile', held);
      const A = recorder(sc);
      const r = await runReset(ctx, fx, yesArgs(fx));
      record(sc, 'confirmed', r, ctx);
      const { res, d, after, before } = r;
      const run = 'confirmed';
      A(run, 'exit1', 'positive', 'CTL', res.code === 1, 'exit 1', res.code);
      A(run, 'stopNamesHeldFile', 'positive', 'AC2', /could not remove artifacts\/text\/held\.bin/.test(res.err), 'names artifacts/text/held.bin', res.err.split('\n')[0]);
      gradeS08Semantic(A, run, res.err, (k) => after.has(k));
      const removedList = failureList(res.err, 'Removed') ?? [];
      const notRemoved = failureList(res.err, 'Not removed') ?? [];
      const partly = failureList(res.err, 'Partly removed') ?? [];
      A(run, 'failureRemovedListAccurate', 'positive', 'AC2', removedList.length > 0 && removedList.every((p) => !after.has(dk(fx, p))), 'every "Removed" item is absent', removedList);
      A(run, 'failureNotRemovedListAccurate', 'positive', 'AC2', notRemoved.length > 0 && notRemoved.every((p) => after.has(dk(fx, p))), 'every "Not removed" item is present', notRemoved);
      A(run, 'failurePartlyAccurate', 'positive', 'AC2', partly.length === 1 && after.has(dk(fx, partly[0])) && after.has(dk(fx, 'artifacts/text/held.bin')), 'partly removed target present with the held file', partly);
      const damaged = fx.unrelated.filter((k) => JSON.stringify(before.get(k)) !== JSON.stringify(after.get(k)));
      A(run, 'unrelatedPreservedByteForByte', 'safety', 'AC3', damaged.length === 0, fx.unrelated, { changedOrMissing: damaged });
      const foreign = d.removed.filter((k) => !dataRel(fx, k) || !ownedBy(fx, dataRel(fx, k)));
      A(run, 'removedOnlyOwned', 'safety', 'AC3', foreign.length === 0, 'removed paths are owned', { notOwned: foreign });
      await h.kill();
      const heldAfter = sha(await readFile(held)).slice(0, 16);
      A(run, 'heldFileBytesIntact', 'safety', 'AC3', heldAfter === heldSha, heldSha, heldAfter);
    },
  },
  {
    id: 'T02',
    title: 'Case-variant stale lock spellings (GraphGoblin.db.graphgoblin.lock, GraphGoblin.lock) on a case-insensitive volume',
    async run(ctx, sc) {
      const A = recorder(sc);
      const probe = join(ctx.fixture, 'case-probe.txt');
      await put(probe, 'probe');
      const caseInsensitive = existsSync(join(ctx.fixture, 'CASE-PROBE.TXT'));
      await rm(probe);
      const fx = await buildFixture(ctx);
      const h = await startHolder(ctx, 'both', `${fx.data}|${fx.dbFile}`);
      await h.kill();
      const variants = [
        ['graphgoblin.db.graphgoblin.lock', 'GraphGoblin.db.graphgoblin.lock', 'db'],
        ['graphgoblin.lock', 'GraphGoblin.lock', 'dir'],
      ];
      for (const [from, to] of variants) await rename(join(fx.data, from), join(fx.data, to));
      const listing = await readdir(fx.data);
      const ok = caseInsensitive && variants.every(([, to]) => listing.includes(to));
      A('setup', 'caseInsensitiveVolumeWithVariantSpellings', 'precondition', 'CTL', ok, 'volume folds case and lists the variant spellings', { caseInsensitive, listing });
      sc.setup = { staleOwnerPid: h.pid, variants: variants.map(([, to]) => to) };
      if (!ok) return;
      const dry = await runReset(ctx, fx, dryArgs(fx));
      record(sc, 'dry', dry, ctx);
      checkDry(A, 'dry', fx, dry, { ci: true });
      for (const [, to, tag] of variants) {
        A('dry', `${tag}VariantNotKept`, 'acceptance', 'AC1', !listed(dry.m.keeps, to, true), `${to} (any case) absent from Keeps`, pathsOf(dry.m.keeps));
        const row = dry.m.removes.find((x) => eq(x.path, to, true));
        A('dry', `${tag}VariantInRemoves`, 'acceptance', 'AC1', Boolean(row) && /stale/i.test(row.rest), `${to} (any case) under Removes, marked stale`, row ?? pathsOf(dry.m.removes));
        A('dry', `${tag}VariantExactSpelling`, 'positive', 'AC1', listed(dry.m.removes, to), `Removes row spelled as the directory lists it: ${to}`, pathsOf(dry.m.removes));
      }
      const yes = await runReset(ctx, fx, yesArgs(fx));
      record(sc, 'confirmed', yes, ctx);
      checkConfirmed(A, 'confirmed', fx, yes, dry, { ci: true });
      for (const [, to, tag] of variants) {
        A('confirmed', `${tag}VariantNotKept`, 'acceptance', 'AC1', !listed(yes.m.keeps, to, true), `${to} (any case) absent from Keeps`, pathsOf(yes.m.keeps));
        A('confirmed', `${tag}VariantGone`, 'positive', 'CTL', !hasCI(yes.after, dk(fx, to)), `${to} (any case) absent after`, [...yes.after.keys()].filter((k) => /lock/i.test(k)));
      }
      const unlistedExact = yes.d.removed.map((k) => dataRel(fx, k)).filter((p) => p && !coveredBy([...yes.m.removes, ...yes.m.removedLines], p));
      A('confirmed', 'removedPathsDisclosedExactCase', 'observation', 'AC1', unlistedExact.length === 0, 'removed pre-existing paths disclosed with their exact spelling', { notExact: unlistedExact, removes: pathsOf(yes.m.removes) });
    },
  },
  {
    id: 'T03',
    title: 'Look-alikes: a hard link to the stale data-directory lock and abandoned .reclaim.<UUID>.tmp staging directories are kept',
    async run(ctx, sc) {
      const A = recorder(sc);
      const fx = await buildFixture(ctx);
      const h = await startHolder(ctx, 'both', `${fx.data}|${fx.dbFile}`);
      await h.kill();
      const linkName = 'lock-hardlink.txt';
      let linked = true;
      try {
        await link(join(fx.data, DIR_LOCK), join(fx.data, linkName));
      } catch (e) {
        linked = String(e);
      }
      const a = randomUUID();
      const b = randomUUID();
      const dirStaging = `${DIR_GUARD}.${a}.tmp`;
      const dbStaging = `${fx.dbGuardRel}.${b}.tmp`;
      await put(join(fx.data, dirStaging, `${a}.json`), JSON.stringify({ pid: h.pid, startedAt: new Date().toISOString(), token: a }));
      await mkdir(join(fx.data, dbStaging));
      A('setup', 'hardLinkCreated', 'precondition', 'CTL', linked === true, 'hard link created', linked);
      const lookalikes = [linkName, dirStaging, dbStaging];
      fx.unrelated.push(dk(fx, linkName), dk(fx, dirStaging), dk(fx, `${dirStaging}/${a}.json`), dk(fx, dbStaging));
      fx.expectKeeps.push(...lookalikes);
      sc.setup = { staleOwnerPid: h.pid, lookalikes };
      const dry = await runReset(ctx, fx, dryArgs(fx));
      record(sc, 'dry', dry, ctx);
      checkDry(A, 'dry', fx, dry);
      for (const [r, run] of [[dry, 'dry']]) {
        for (const p of lookalikes) A(run, `lookalikeNotRemoves:${p}`, 'acceptance', 'AC1', !listed(r.m.removes, p), `${p} not under Removes`, pathsOf(r.m.removes));
        A(run, 'staleLocksInRemoves', 'acceptance', 'AC1', listed(r.m.removes, DIR_LOCK) && listed(r.m.removes, fx.dbLockRel), 'both stale locks under Removes', pathsOf(r.m.removes));
      }
      const yes = await runReset(ctx, fx, yesArgs(fx));
      record(sc, 'confirmed', yes, ctx);
      checkConfirmed(A, 'confirmed', fx, yes, dry);
      for (const p of lookalikes) A('confirmed', `lookalikeListedAndKept:${p}`, 'acceptance', 'AC1', listed(yes.m.keeps, p) && !listed(yes.m.removes, p) && yes.after.has(dk(fx, p)), `${p} under Keeps and present after`, { keeps: pathsOf(yes.m.keeps), present: yes.after.has(dk(fx, p)) });
    },
  },
  ...[
    ['T04a', 'database lock path is a directory', (fx) => fx.dbLockRel, 'dir'],
    ['T04b', 'database lock guard path is a regular file', (fx) => fx.dbGuardRel, 'file'],
    ['T04c', 'data-directory lock path is a directory', () => DIR_LOCK, 'dir'],
    ['T04d', 'data-directory lock guard path is a regular file', () => DIR_GUARD, 'file'],
    // v3: the same malformed paths with no database file, as in the candidate's unit test.
    ['T04e', 'database lock path is a directory and no database file exists', (fx) => fx.dbLockRel, 'dir', 'none'],
    ['T04f', 'data-directory lock path is a directory and no database file exists', () => DIR_LOCK, 'dir', 'none'],
  ].map(([id, what, relOf, kind, db = 'default']) => ({
    id,
    title: `Malformed ownership path: the ${what}; dry run and confirmed reset refuse and change nothing`,
    async run(ctx, sc) {
      const A = recorder(sc);
      const fx = await buildFixture(ctx, { db });
      const rel = relOf(fx);
      if (kind === 'dir') await put(join(fx.data, rel, 'note.txt'), 'a directory where a lock file belongs');
      else await put(join(fx.data, rel), 'a regular file where a guard directory belongs');
      sc.setup = { path: rel, kind };
      for (const [name, argv] of [['dry', dryArgs(fx)], ['confirmed', yesArgs(fx)]]) {
        const r = await runReset(ctx, fx, argv);
        record(sc, name, r, ctx);
        checkRefusal(A, name, r, { names: rel });
      }
    },
  })),
  {
    id: 'T05',
    title: 'Held control: live marker in the data-directory .reclaim guard refuses dry run and confirmed reset',
    async run(ctx, sc) {
      const A = recorder(sc);
      const fx = await buildFixture(ctx);
      const h = await startHolder(ctx, 'guard', join(fx.data, DIR_GUARD));
      for (const [name, argv] of [['dry', dryArgs(fx)], ['confirmed', yesArgs(fx)]]) {
        const r = await runReset(ctx, fx, argv);
        record(sc, name, r, ctx);
        checkRefusal(A, name, r, { names: join(fx.data, DIR_GUARD), because: 'verify ownership before resetting' });
      }
      await h.kill();
    },
  },
  {
    id: 'T06',
    title: 'Nested database (data/db/store.db) with a stale database-lock .reclaim guard beside it',
    async run(ctx, sc) {
      const A = recorder(sc);
      const fx = await buildFixture(ctx, { db: 'nested' });
      await put(join(fx.data, 'db', 'readme.txt'), 'unrelated file beside the nested database');
      fx.unrelated.push(dk(fx, 'db/readme.txt'));
      const h = await startHolder(ctx, 'guard', join(fx.data, ...fx.dbGuardRel.split('/')));
      await h.kill();
      sc.setup = { staleGuard: fx.dbGuardRel, marker: h.messages[0]?.marker };
      const dry = await runReset(ctx, fx, dryArgs(fx));
      record(sc, 'dry', dry, ctx);
      checkDry(A, 'dry', fx, dry);
      const row = dry.m.removes.find((x) => x.path === fx.dbGuardRel);
      A('dry', 'nestedGuardInRemoves', 'acceptance', 'AC1', Boolean(row) && /guard/i.test(row.rest), `${fx.dbGuardRel} under Removes as a guard`, row ?? pathsOf(dry.m.removes));
      A('dry', 'nestedGuardNotKept', 'acceptance', 'AC1', !dry.m.keeps.some((k) => fx.dbGuardRel.startsWith(k.path)), `${fx.dbGuardRel} (or db/) not under Keeps`, pathsOf(dry.m.keeps));
      const yes = await runReset(ctx, fx, yesArgs(fx));
      record(sc, 'confirmed', yes, ctx);
      checkConfirmed(A, 'confirmed', fx, yes, dry);
      A('confirmed', 'nestedGuardRemovedAndListed', 'acceptance', 'AC1', !yes.after.has(dk(fx, fx.dbGuardRel)) && listed(yes.m.removes, fx.dbGuardRel), `${fx.dbGuardRel} gone and listed`, { present: yes.after.has(dk(fx, fx.dbGuardRel)), removes: pathsOf(yes.m.removes) });
    },
  },
  ...[
    ['T07a', true],
    ['T07b', false],
  ].map(([id, stale]) => ({
    id,
    title: `Refusal after the confirmed reset takes the data-directory lock (database has a second hard link outside the data directory)${stale ? ', with stale data-directory and database locks' : ', no stale locks'}`,
    async run(ctx, sc) {
      const A = recorder(sc);
      const fx = await buildFixture(ctx);
      // v2: stale locks first. The product's acquireDatabaseLock refuses a hard-linked database, so
      // v1 (link first) could not create the stale database lock (recorded in the v1 results).
      if (stale) {
        const h = await startHolder(ctx, 'both', `${fx.data}|${fx.dbFile}`);
        await h.kill();
        sc.setup = { staleOwnerPid: h.pid, stale: [DIR_LOCK, fx.dbLockRel].filter((p) => existsSync(join(fx.data, p))) };
      }
      const linkPath = join(ctx.fixture, 'outside', 'graphgoblin-db-hardlink.db');
      let linked = true;
      try {
        await link(fx.dbFile, linkPath);
      } catch (e) {
        linked = String(e);
      }
      fx.unrelated.push('outside/graphgoblin-db-hardlink.db');
      A('setup', 'dbHardLinkCreated', 'precondition', 'CTL', linked === true, 'second hard link of the database created outside the data directory', linked);
      const dry = await runReset(ctx, fx, dryArgs(fx));
      record(sc, 'dry', dry, ctx);
      A('dry', 'dryExitCode', 'observation', 'CTL', dry.res.code === 0, 'dry run exit 0 (the preview does not check database hard links)', { exit: dry.res.code, stderr: dry.res.err.trim() });
      A('dry', 'noByteChange', 'safety', 'AC3', !dry.d.removed.length && !dry.d.added.length && !dry.d.changed.length, 'fixture tree byte-identical', dry.d);
      const r = await runReset(ctx, fx, yesArgs(fx));
      record(sc, 'confirmed', r, ctx);
      const { res, d, after, before } = r;
      const run = 'confirmed';
      A(run, 'exit1', 'positive', 'CTL', res.code === 1, 'exit 1', res.code);
      A(run, 'refusalReason', 'positive', 'CTL', res.err.includes('multiple hard links'), 'stderr names the hard-link refusal', res.err.trim());
      A(run, 'noStackTrace', 'positive', 'CTL', noStack(res.err), 'no stack trace', res.err.trim().split('\n').slice(0, 4));
      const storeKeys = [...before.keys()].filter((k) => { const p = dataRel(fx, k); return p !== undefined && ownedBy(fx, p) && p !== DIR_LOCK && p !== fx.dbLockRel && !p.startsWith(DIR_GUARD) && !p.startsWith(fx.dbGuardRel); });
      const storeChanged = storeKeys.filter((k) => JSON.stringify(before.get(k)) !== JSON.stringify(after.get(k)));
      A(run, 'noStoreDataChanged', 'safety', 'AC3', storeChanged.length === 0, 'database, sidecars, artifacts, chat audio and run workspaces byte-identical', { checked: storeKeys.length, changed: storeChanged });
      const damaged = fx.unrelated.filter((k) => JSON.stringify(before.get(k)) !== JSON.stringify(after.get(k)));
      A(run, 'unrelatedPreservedByteForByte', 'safety', 'AC3', damaged.length === 0, fx.unrelated, { changedOrMissing: damaged });
      A(run, 'nothingAdded', 'safety', 'AC3', d.added.length === 0, 'no entry added', d.added);
      const changedPaths = [...d.removed, ...d.added, ...d.changed].map((k) => dataRel(fx, k));
      const claimsNothing = res.err.includes('Nothing in the data directory was changed.');
      A(run, 'nothingChangedClaimMatchesFs', 'acceptance', 'AC2', claimsNothing === (changedPaths.length === 0), '"Nothing in the data directory was changed." printed exactly when the tree is byte-identical', { claimsNothing, fsChanges: changedPaths });
      for (const p of d.removed.map((k) => dataRel(fx, k)).filter(Boolean)) {
        const lines = linesNaming(res.err, p);
        A(run, `removedPathNamed:${p}`, 'acceptance', 'AC2', lines.some((l) => /reclaim|remov/i.test(l)), `the refusal names ${p}, which the run removed`, lines);
      }
      if (stale) {
        A(run, 'storeDataNotRemovedStatement', 'positive', 'AC2', res.err.includes('No store data was removed'), 'refusal says no store data was removed', res.err.trim().split('\n').slice(1));
        const dbLines = linesNaming(res.err, fx.dbLockRel);
        A(run, 'untouchedDbLockNotClaimed', 'acceptance', 'AC2', after.has(dk(fx, fx.dbLockRel)) && JSON.stringify(before.get(dk(fx, fx.dbLockRel))) === JSON.stringify(after.get(dk(fx, fx.dbLockRel))) && !dbLines.some((l) => /reclaim|remov/i.test(l)), `the stale ${fx.dbLockRel} the run never touched is unchanged and not claimed as reclaimed or removed`, { present: after.has(dk(fx, fx.dbLockRel)), dbLines });
      } else {
        A(run, 'noByteChange', 'safety', 'AC3', !d.removed.length && !d.added.length && !d.changed.length, 'fixture tree byte-identical', d);
      }
      A(run, 'tempCopiesCleaned', 'safety', 'CTL', r.tempLeft.length === 0, 'no gg-reset-store-* left', r.tempLeft);
    },
  })),
  {
    id: 'T08',
    title: 'Another process replaces the database lock record during the confirmed reset: the release keeps it and says so; a rerun reclaims it',
    async run(ctx, sc) {
      const A = recorder(sc);
      const fx = await buildFixture(ctx);
      const rp = await startHelper(ctx, 'replacer.mjs', [ctx.checkout, fx.dbLockFile]);
      const r = await runReset(ctx, fx, yesArgs(fx));
      record(sc, 'confirmed', r, ctx);
      const rep = rp.messages.find((x) => x.replaced === true);
      const run = 'confirmed';
      A(run, 'replacerReplacedRecord', 'precondition', 'CTL', Boolean(rep), 'the helper replaced the reset\'s database lock record before release', rep ?? rp.messages);
      const { res, after, before, d } = r;
      const text = `${res.out}\n${res.err}`;
      if (rep) {
        const dbLines = linesNaming(text, fx.dbLockRel).filter((l) => !/^\s*graphgoblin\.db\.graphgoblin\.lock\s{2,}/.test(l));
        A(run, 'releaseLineSaysKept', 'acceptance', 'AC2', dbLines.some((l) => /\bkept\b/i.test(l)), `a release line names ${fx.dbLockRel} as kept`, dbLines);
        A(run, 'noRemovedClaimForDbLock', 'acceptance', 'AC2', !dbLines.some((l) => /^\s*removed\b/i.test(l)), `no "removed ${fx.dbLockRel}" claim`, dbLines);
        const now = after.get(dk(fx, fx.dbLockRel));
        A(run, 'replacedRecordPreserved', 'safety', 'AC3', now?.kind === 'file' && now.sha === rep.sha, 'the other process\'s lock file is left with its record', { after: now, replacerSha: rep.sha });
        const dir = releaseReported(text, DIR_LOCK, after, fx);
        A(run, 'dirLockRemovedAndReported', 'positive', 'AC2', dir.pass, 'graphgoblin.lock absent and named as removed', dir);
        A(run, 'exitAndCompletion', 'observation', 'CTL', res.code === 0 && res.out.includes('Reset complete.'), 'exit code and completion when only a replaced lock was kept', { exit: res.code, tail: res.out.trim().split('\n').slice(-3), stderr: res.err.trim() });
        const damaged = fx.unrelated.filter((k) => JSON.stringify(before.get(k)) !== JSON.stringify(after.get(k)));
        A(run, 'unrelatedPreservedByteForByte', 'safety', 'AC3', damaged.length === 0, fx.unrelated, { changedOrMissing: damaged });
        const foreign = d.removed.filter((k) => !dataRel(fx, k) || !ownedBy(fx, dataRel(fx, k)));
        A(run, 'removedOnlyOwned', 'safety', 'AC3', foreign.length === 0, 'removed paths are owned', { notOwned: foreign });
      }
      await rp.kill();
      const again = await runReset(ctx, fx, yesArgs(fx));
      record(sc, 'rerun', again, ctx);
      checkConfirmed(A, 'rerun', fx, again, undefined);
      if (rep) {
        const row = again.m.removes.find((x) => x.path === fx.dbLockRel);
        A('rerun', 'staleReplacedLockMarkedStale', 'acceptance', 'AC1', Boolean(row) && /stale/i.test(row.rest), `${fx.dbLockRel} row says it replaces a stale lock`, row ?? pathsOf(again.m.removes));
      }
    },
  },
  {
    id: 'T09',
    title: 'Default data directory: GG_DATA_DIR unset, HOME/USERPROFILE inside the fixture, so ~/.graphgoblin is a disposable directory',
    async run(ctx, sc) {
      const A = recorder(sc);
      ctx.home = join(ctx.fixture, 'home');
      for (const dir of [join(ctx.home, 'AppData', 'Roaming'), join(ctx.home, 'AppData', 'Local')]) await mkdir(dir, { recursive: true });
      // Gate before any product process: the child's os.homedir() must be the fixture home, so even
      // a read-only dry run can never resolve the real ~/.graphgoblin.
      const probe = await runNode(['-e', 'process.stdout.write(require("node:os").homedir())'], childEnv(ctx), ctx.base);
      const homeOk = resolve(probe.out).toLowerCase() === resolve(ctx.home).toLowerCase();
      A('setup', 'childHomedirIsFixture', 'precondition', 'CTL', homeOk, `child os.homedir() is ${ctx.home}`, probe.out.replaceAll(ctx.base, '<run>'));
      if (!homeOk) return;
      const fx = await buildFixture(ctx, { dataDir: join(ctx.home, '.graphgoblin'), envDataDir: false });
      // v2: APPDATA/LOCALAPPDATA outside the snapshot root. In v1 they were under the fixture home,
      // and the product's Windows process-identity probe (powershell.exe, during lock acquisition)
      // wrote PowerShell's StartupProfileData-NonInteractive cache there (recorded in the v1 results).
      fx.env.APPDATA = join(ctx.base, 'env', 'appdata', 'Roaming');
      fx.env.LOCALAPPDATA = join(ctx.base, 'env', 'appdata', 'Local');
      for (const dir of [fx.env.APPDATA, fx.env.LOCALAPPDATA]) await mkdir(dir, { recursive: true });
      const dry = await runReset(ctx, fx, dryArgs(fx));
      record(sc, 'dry', dry, ctx);
      const line = /^Data directory:\s+(.*)$/m.exec(dry.res.out)?.[1]?.trim();
      const gate = line !== undefined && resolve(line).toLowerCase() === resolve(fx.data).toLowerCase() && inside(ctx.fixture, resolve(line));
      A('dry', 'defaultDataDirIsFixture', 'precondition', 'CTL', gate, `configured default data directory is ${fx.data}`, line ?? dry.res.err.trim());
      if (!gate) return;
      checkDry(A, 'dry', fx, dry);
      A('dry', 'dbLockClassifiedAsRemoved', 'acceptance', 'AC1', listed(dry.m.removes, fx.dbLockRel) && !listed(dry.m.keeps, fx.dbLockRel), `${fx.dbLockRel} under Removes, not Keeps`, { removes: pathsOf(dry.m.removes), keeps: pathsOf(dry.m.keeps) });
      const yes = await runReset(ctx, fx, yesArgs(fx));
      record(sc, 'confirmed', yes, ctx);
      checkConfirmed(A, 'confirmed', fx, yes, dry);
    },
  },
];

// ---------------------------------------------------------------- main
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!existsSync(join(opts.checkout, 'apps', 'api', 'dist', 'main.js')))
    throw new Error('the checkout has no built apps/api/dist/main.js; the coordinator supplies a built checkout');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runRoot = join(SCRATCH, 'runs', `${opts.label}-targeted-${stamp}`);
  if (!inside(SCRATCH, runRoot)) throw new Error('run folder escaped the scratch folder');
  await mkdir(runRoot, { recursive: true });
  const results = {
    schema: 'gg-434-reset-lock-qa-targeted/v1',
    issue: 434,
    label: opts.label,
    startedAt: new Date().toISOString(),
    provenance: await provenance(opts.checkout, opts.expectHead),
    method: {
      entrypoint: 'node <checkout>/apps/api/dist/main.js --reset [--yes] --data-dir <fixture data dir>',
      supplements: 'qa-434-reset-locks.mjs (13 cases, run unchanged); these controls never replace its results',
      isolation: 'minimal child env; GG_DATA_DIR a fixture (T09: unset, with HOME/USERPROFILE inside the fixture and a dry-run gate on the printed data directory); TEMP inside the run folder',
      grading: 'completion/failure-message checks are wording-neutral: a line naming the path as its own token plus the claimed effect, compared with the after tree',
      kinds: {
        acceptance: '#434 acceptance criterion',
        safety: 'no unrelated or unowned change',
        positive: 'documented behaviour / control',
        interpretive: 'QA reading beyond the acceptance text; not gating',
        precondition: 'fixture precondition; dependent checks skipped when it fails',
        observation: 'recorded fact; not gating',
      },
    },
    scenarios: [],
  };
  if (opts.regrade) {
    const first = JSON.parse(await readFile(opts.regrade, 'utf8'));
    const s08 = first.scenarios?.find((s) => s.id === 'S08');
    const conf = s08?.runs.find((x) => x.name === 'confirmed');
    const sc = { id: 'T01R', title: `Wording-neutral re-grade of the original first run's S08 confirmed output (${first.label}, head ${first.provenance?.head}); no re-execution`, source: opts.regrade, runs: [], assertions: [] };
    if (conf) gradeS08Semantic(recorder(sc), 'confirmed', conf.stderr, (k) => k in conf.treeAfter);
    else sc.assertions.push({ id: 'T01R.source', kind: 'precondition', criterion: 'CTL', outcome: 'fail', expected: 'S08 confirmed run in source', actual: null });
    results.scenarios.push(sc);
    process.stdout.write(`T01R regrade: ${sc.assertions.map((a) => `${a.id}=${a.outcome}`).join(' ')}\n`);
  }
  const holdersAll = [];
  try {
    const seedRoot = join(runRoot, 'seed');
    for (const dir of ['seed-tmp', 'seed-home']) await mkdir(join(runRoot, dir), { recursive: true });
    const seed = await runNode(
      [join(DRIVER_DIR, 'seed-store.mjs'), opts.checkout, join(seedRoot, 'staging'), join(seedRoot, 'current'), RUN_IDS.join(',')],
      childEnv({ temp: join(runRoot, 'seed-tmp'), home: join(runRoot, 'seed-home') }),
      runRoot,
    );
    if (seed.code !== 0 || seed.out !== 'seeded') throw new Error(`store seeding failed: ${seed.code} ${seed.out} ${seed.err}`);
    for (const scenario of SCENARIOS) {
      if (opts.only && !opts.only.includes(scenario.id)) continue;
      const base = join(runRoot, scenario.id);
      const ctx = { checkout: opts.checkout, base, fixture: join(base, 'fixture'), temp: join(base, 'env', 'tmp'), home: join(base, 'env', 'home'), seed: join(seedRoot, 'current'), holders: [] };
      for (const dir of [ctx.fixture, ctx.temp, join(ctx.home, 'AppData', 'Roaming'), join(ctx.home, 'AppData', 'Local')]) await mkdir(dir, { recursive: true });
      const sc = { id: scenario.id, title: scenario.title, runs: [], assertions: [] };
      results.scenarios.push(sc);
      process.stdout.write(`${scenario.id} ${scenario.title}\n`);
      try {
        await scenario.run(ctx, sc);
      } catch (error) {
        sc.error = error instanceof Error ? error.stack : String(error);
        sc.assertions.push({ id: `${sc.id}.driver`, kind: 'precondition', criterion: 'CTL', outcome: 'fail', expected: 'scenario ran', actual: sc.error });
      } finally {
        for (const h of ctx.holders) await h.kill();
        holdersAll.push(...ctx.holders);
      }
      const f = sc.assertions.filter((a) => a.outcome === 'fail').length;
      process.stdout.write(`  ${sc.assertions.length} assertions, ${f} failed\n`);
    }
  } finally {
    for (const h of holdersAll) await h.kill();
  }
  const all = results.scenarios.flatMap((s) => s.assertions);
  const tally = (list) => ({ total: list.length, pass: list.filter((a) => a.outcome === 'pass').length, fail: list.filter((a) => a.outcome === 'fail').length, notRun: list.filter((a) => a.outcome === 'not-run').length });
  results.totals = {
    all: tally(all),
    byKind: Object.fromEntries(['acceptance', 'safety', 'positive', 'interpretive', 'precondition', 'observation'].map((k) => [k, tally(all.filter((a) => a.kind === k))])),
    byCriterion: Object.fromEntries(['AC1', 'AC2', 'AC3', 'CTL', 'DIFF'].map((k) => [k, tally(all.filter((a) => a.criterion === k))])),
    failed: all.filter((a) => a.outcome === 'fail').map((a) => `${a.id} [${a.kind}/${a.criterion}]`),
  };
  results.finishedAt = new Date().toISOString();
  results.fixtures = opts.keep ? `kept at ${runRoot}` : 'deleted after the run (disposable)';
  await mkdir(dirname(opts.out), { recursive: true });
  await writeFile(opts.out, JSON.stringify(results, null, 1));
  if (!opts.keep) {
    if (!inside(join(SCRATCH, 'runs'), runRoot)) throw new Error('refusing to delete outside runs/');
    await rm(runRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
  process.stdout.write(`\nresults: ${opts.out}\n${JSON.stringify(results.totals.all)}\nbyKind ${JSON.stringify(results.totals.byKind)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
