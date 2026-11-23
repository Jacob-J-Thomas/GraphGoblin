#!/usr/bin/env node
// GraphGoblin #434 independent touched-systems QA driver (reusable for baseline and candidates).
//
// Drives the real built CLI `node <checkout>/apps/api/dist/main.js --reset ...` as a separate
// process against disposable fixtures only, and compares filesystem snapshot before, the printed
// manifest, the output, and filesystem snapshot after. Ownership state (held and stale locks and
// `.reclaim` guards) is produced by the checkout's own built lock code in helper processes
// (holder.mjs); stores are seeded by the checkout's own built infrastructure (seed-store.mjs).
//
// Isolation: every child gets a minimal environment built here (never the parent's GG_* values):
// GG_DATA_DIR always names a disposable fixture, and USERPROFILE/HOME/TEMP/TMP/APPDATA point into
// the run folder, so even the default data directory and the reset's private store copies stay
// inside it. Nothing is written to the checkout; Git is read with --no-optional-locks only.
//
// Usage:
//   node qa-434-reset-locks.mjs --checkout <path> --label <name> [--out <file.json>]
//        [--expect-head <sha>] [--only S01,S02] [--keep-fixtures]
// Exit code: 0 when the driver ran to completion (assertion failures are results, not errors),
// 1 on a setup/driver error.
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, readdir, readlink, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep, isAbsolute } from 'node:path';
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
    else if (a === '--only') o.only = argv[++i].split(',');
    else if (a === '--keep-fixtures') o.keep = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!o.checkout || !o.label) throw new Error('--checkout and --label are required');
  if (!/^[A-Za-z0-9._-]+$/.test(o.label)) throw new Error('--label: letters, digits, . _ - only');
  o.checkout = resolve(o.checkout);
  o.out = resolve(o.out ?? join(SCRATCH, 'results', `${o.label}-results.json`));
  return o;
}

const inside = (root, path) => {
  const rel = relative(root, path);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
};
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

async function provenance(checkout, expectHead) {
  const git = (args) =>
    promisify(execFile)('git', ['--no-optional-locks', '-C', checkout, ...args], {
      windowsHide: true,
    }).then(
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

async function startHolder(ctx, mode, arg) {
  const child = spawn(process.execPath, [join(DRIVER_DIR, 'holder.mjs'), mode, ctx.checkout, arg], {
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
          rej(new Error(`holder ${mode} exited ${JSON.stringify(exitInfo)} ${stderr} ${JSON.stringify(messages)}`));
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        rej(new Error(`holder ${mode} timed out`));
      }, ms);
      waiters.push(check);
      check();
    });
  const ready = await until((m) => 'ready' in m);
  if (!ready.ready) throw new Error(`holder ${mode} failed: ${ready.error}`);
  const holder = {
    mode,
    pid: child.pid,
    messages,
    until,
    exited: () => exitInfo,
    kill: async () => {
      if (exitInfo) return exitInfo;
      child.kill('SIGKILL');
      return exited;
    },
  };
  ctx.holders.push(holder);
  return holder;
}

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

// ---------------------------------------------------------------- output parsing
const PROSE = [/^nothing but the lock file$/, /^\.\.\. and \d+ more/, /^Browser device drafts/, /^nothing else is in the data directory$/];
function parseManifest(text) {
  const lines = text.split(/\r?\n/);
  const section = (title) => {
    const i = lines.indexOf(title);
    if (i < 0) return [];
    const rows = [];
    for (let j = i + 1; j < lines.length && lines[j].trim() !== ''; j++) rows.push(lines[j].trim());
    return rows;
  };
  // The path is the first whitespace-free token: fixture names contain no spaces, and a name longer
  // than the 38-character column is followed by a single space only.
  const rows = (r) =>
    r
      .filter((x) => !PROSE.some((p) => p.test(x)))
      .map((x) => {
        const c = /^(\S+)\s*(.*)$/.exec(x);
        return { path: c[1].replaceAll('\\', '/'), rest: c[2].replace(/\s{2,}/g, ' | ') };
      });
  const at = lines.indexOf('Removing:');
  const removingSection = at < 0 ? '' : lines.slice(at).join('\n');
  // "removed <path>" lines of the confirmed run, as reported removals.
  const removedLines = at < 0 ? [] : [...removingSection.matchAll(/^\s+removed (\S+)/gm)].map((x) => ({ path: x[1].replaceAll('\\', '/') }));
  return {
    printed: lines.includes('Removes:'),
    removes: rows(section('Removes:')),
    keeps: rows(section('Keeps:')),
    removingSection,
    removedLines,
  };
}

const listed = (rows, rel) => rows.some((r) => r.path === rel || r.path.endsWith('/' + rel));
const coveredBy = (rows, rel) => rows.some((r) => r.path === rel || rel.startsWith(r.path + '/'));
const pathsOf = (rows) => rows.map((r) => r.path).sort();

/** Paths in one "  Label: a, b, and N more" line of a reset failure message. */
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

/** The subjects of "Could not remove|release <subject>: ..." clauses. */
const couldNotSubjects = (text) => [...text.matchAll(/could not (?:remove|release) (.+?): /gi)].map((m) => m[1]);

// ---------------------------------------------------------------- fixtures
async function put(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

/**
 * A disposable data directory. `db`: 'default' | 'nested' | 'custom' | 'external' | 'none'.
 * Returns the paths and env the scenario uses; nothing outside ctx.fixture is created.
 */
async function buildFixture(ctx, db) {
  const data = join(ctx.fixture, 'data');
  const outside = join(ctx.fixture, 'outside');
  await mkdir(data, { recursive: true });
  await put(join(outside, 'precious.txt'), 'outside the data directory; never touched');
  await put(join(outside, 'sub', 'also.txt'), 'outside nested file');
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
    ...Object.keys(unrelatedTop).map((n) => `data/${n}`),
    'data/workspaces/my-notes',
    'data/workspaces/my-notes/keep.txt',
    'outside/precious.txt',
    'outside/sub',
    'outside/sub/also.txt',
  ];
  const expectKeeps = [...Object.keys(unrelatedTop), 'workspaces/my-notes'];
  let dbRel;
  let dbFile;
  let env = { GG_DATA_DIR: data };
  if (db !== 'none') {
    await put(join(data, 'artifacts', 'text', 'abc123'), 'artifact body');
    await put(join(data, 'chat-audio', 'clip.webm'), 'audio bytes');
    for (const id of RUN_IDS) await put(join(data, 'workspaces', id, 'src', 'out.txt'), id);
    const place = {
      default: ['data', 'graphgoblin.db'],
      nested: ['data', 'db/store.db'],
      custom: ['data', 'custom.db'],
      external: ['external', 'ext.db'],
    }[db];
    const root = join(ctx.fixture, place[0]);
    dbRel = place[1];
    dbFile = join(root, ...dbRel.split('/'));
    await mkdir(dirname(dbFile), { recursive: true });
    await copyFile(join(ctx.seed, 'graphgoblin.db'), dbFile);
    await copyFile(join(ctx.seed, 'graphgoblin.db-wal'), `${dbFile}-wal`);
    if (db !== 'default') env.GG_DB_URL = `file:${dbFile.replaceAll('\\', '/')}`;
    if (db === 'external') {
      await put(join(ctx.fixture, 'external', 'unrelated.txt'), 'next to the external database');
      unrelated.push('external/unrelated.txt');
    }
  } else {
    dbRel = 'graphgoblin.db';
    dbFile = join(data, dbRel);
  }
  const dbLockRel = `${dbRel}.graphgoblin.lock`;
  return {
    data,
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

/** Whether a data-directory-relative path is reset-owned content or ownership metadata. */
function ownedBy(fx, rel) {
  const parts = ['', '-wal', '-shm', '-journal'].map((s) => fx.dbRel + s);
  const under = (p) => rel === p || rel.startsWith(p + '/');
  return (
    parts.includes(rel) ||
    under('artifacts') ||
    under('chat-audio') ||
    RUN_IDS.some((id) => under(`workspaces/${id}`)) ||
    rel === DIR_LOCK ||
    under(DIR_GUARD) ||
    rel === fx.dbLockRel ||
    under(fx.dbGuardRel)
  );
}

// ---------------------------------------------------------------- assertions
function recorder(sc) {
  return (run, id, kind, criterion, pass, expected, actual) => {
    sc.assertions.push({
      id: `${sc.id}.${run}.${id}`,
      kind,
      criterion,
      outcome: pass === null ? 'not-run' : pass ? 'pass' : 'fail',
      expected,
      actual,
    });
  };
}

const dataRel = (k) => (k.startsWith('data/') ? k.slice(5) : undefined);

async function runReset(ctx, fx, argv, extraEnv = {}) {
  const main = join(ctx.checkout, 'apps', 'api', 'dist', 'main.js');
  const before = await snapshot(ctx.fixture);
  const res = await runNode([main, ...argv], childEnv(ctx, { ...fx.env, ...extraEnv }), ctx.base);
  const after = await snapshot(ctx.fixture);
  const tempLeft = (await readdir(ctx.temp)).filter((n) => n.startsWith('gg-reset-store-'));
  const env = { ...fx.env, ...extraEnv };
  return { argv, env, res, before, after, d: diff(before, after), m: parseManifest(res.out), tempLeft };
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

function checkDry(A, run, fx, r, guards) {
  const { res, d, m } = r;
  A(run, 'exit0', 'positive', 'CTL', res.code === 0, 'exit 0', res.code);
  A(run, 'stderrEmpty', 'positive', 'CTL', res.err === '', 'empty stderr', res.err.slice(0, 300));
  A(run, 'noByteChange', 'safety', 'AC3', !d.removed.length && !d.added.length && !d.changed.length, 'fixture tree byte-identical', d);
  A(run, 'dryRunHeaderAndTrailer', 'positive', 'DIFF', res.out.startsWith('GraphGoblin reset (dry run: nothing is removed)') && res.out.includes('Nothing was removed.'), 'dry-run header and "Nothing was removed." trailer', res.out.split('\n')[0]);
  A(run, 'noRemovalSection', 'positive', 'DIFF', m.removingSection === '', 'no "Removing:" section', m.removingSection.slice(0, 200));
  const missingKeeps = fx.expectKeeps.filter((p) => !listed(m.keeps, p));
  A(run, 'unrelatedListedAsKept', 'positive', 'AC3', missingKeeps.length === 0, fx.expectKeeps, { missing: missingKeeps });
  const lockExists = r.before.has(`data/${fx.dbLockRel}`);
  A(run, 'dbLockNotListedAsKept', 'acceptance', 'AC1', !listed(m.keeps, fx.dbLockRel), `${fx.dbLockRel} absent from Keeps`, m.keeps.filter((k) => k.path.endsWith(fx.dbLockRel)));
  A(run, 'dbLockClassifiedAsRemoved', lockExists ? 'acceptance' : 'interpretive', 'AC1', listed(m.removes, fx.dbLockRel), `${fx.dbLockRel} listed under Removes (${lockExists ? 'stale sidecar present' : 'sidecar the confirmed run creates and removes'})`, pathsOf(m.removes));
  for (const [rel, kind] of guards) {
    const tag = rel === DIR_GUARD ? 'dirGuard' : 'dbGuard';
    A(run, `${tag}NotListedAsKept`, kind, 'AC1', !listed(m.keeps, rel), `${rel} absent from Keeps`, m.keeps.filter((k) => k.path.startsWith(rel)));
    A(run, `${tag}ClassifiedAsRemoved`, kind, 'AC1', listed(m.removes, rel), `${rel} listed under Removes`, pathsOf(m.removes));
  }
}

function checkConfirmed(A, run, fx, r, dry, guards, { unlistedKind = 'acceptance' } = {}) {
  const { res, d, m, after, before } = r;
  A(run, 'exit0', 'positive', 'CTL', res.code === 0, 'exit 0', res.code);
  A(run, 'resetComplete', 'positive', 'DIFF', res.out.includes('Reset complete.'), '"Reset complete."', res.out.slice(-200));
  const damaged = fx.unrelated.filter((k) => JSON.stringify(before.get(k)) !== JSON.stringify(after.get(k)));
  A(run, 'unrelatedPreservedByteForByte', 'safety', 'AC3', damaged.length === 0, fx.unrelated, { changedOrMissing: damaged });
  const rels = d.removed.map(dataRel);
  const foreign = d.removed.filter((k, i) => rels[i] === undefined || !ownedBy(fx, rels[i]));
  A(run, 'removedOnlyOwned', 'safety', 'AC3', foreign.length === 0, 'every removed path is store content or this configuration\'s lock metadata', { notOwned: foreign, removed: d.removed });
  A(run, 'nothingAddedOrChanged', 'safety', 'AC3', d.added.length === 0 && d.changed.length === 0, 'no entry added or modified', { added: d.added, changed: d.changed });
  const keptButGone = m.keeps.map((k) => k.path).filter((p) => !after.has(`data/${p}`));
  A(run, 'keepsListIsTruthful', 'acceptance', 'AC1', keptButGone.length === 0, 'every Keeps path exists after the reset', { listedAsKeptButRemoved: keptButGone });
  const removesStill = m.removes.map((k) => k.path).filter((p) => after.has(`data/${p}`));
  A(run, 'removesListIsTruthful', 'positive', 'AC1', removesStill.length === 0, 'every Removes path is absent after the reset', { stillPresent: removesStill });
  const disclosedBy = [...m.removes, ...m.removedLines];
  const unlisted = d.removed.map(dataRel).filter((p) => p !== undefined && !coveredBy(disclosedBy, p));
  A(run, 'noUnlistedRemoval', unlistedKind, 'AC1', unlisted.length === 0, 'every pre-existing path the reset removed is disclosed by a Removes row or a "removed <path>" line', { removedButUnlisted: unlisted });
  A(run, 'dbLockNotListedAsKept', 'acceptance', 'AC1', !listed(m.keeps, fx.dbLockRel), `${fx.dbLockRel} absent from Keeps`, m.keeps.filter((k) => k.path.endsWith(fx.dbLockRel)));
  A(run, 'dbLockClassifiedAsRemoved', 'acceptance', 'AC1', listed(m.removes, fx.dbLockRel), `${fx.dbLockRel} listed under Removes`, pathsOf(m.removes));
  for (const [rel, kind] of guards) {
    const tag = rel === DIR_GUARD ? 'dirGuard' : 'dbGuard';
    const gone = d.removed.map(dataRel).filter((p) => p === rel || p?.startsWith(rel + '/'));
    A(run, `${tag}RemovalListed`, kind, 'AC1', gone.length === 0 || listed(disclosedBy, rel), `${rel} removal disclosed (Removes row or "removed" line)`, { removed: gone, removes: pathsOf(m.removes), removedLines: pathsOf(m.removedLines) });
  }
  const sect = m.removingSection;
  A(run, 'completionNamesDirLock', 'positive', 'AC2', /removed\s+graphgoblin\.lock\b/.test(sect), 'completion output reports graphgoblin.lock removed', sect.split('\n').slice(-4));
  A(run, 'completionNamesDbLock', 'acceptance', 'AC2', sect.includes(basename(fx.dbLockRel)), `completion output reports ${fx.dbLockRel} removed`, sect.split('\n').slice(-4));
  const lockState = Object.fromEntries([DIR_LOCK, DIR_GUARD, fx.dbLockRel, fx.dbGuardRel].map((p) => [p, after.has(`data/${p}`) ? 'present' : 'absent']));
  A(run, 'locksReleased', 'positive', 'CTL', Object.values(lockState).every((v) => v === 'absent'), 'no lock or guard of this configuration left in the data directory', lockState);
  A(run, 'tempCopiesCleaned', 'safety', 'CTL', r.tempLeft.length === 0, 'no gg-reset-store-* left in the isolated TEMP', r.tempLeft);
  if (dry) {
    const same = (a, b) => JSON.stringify(pathsOf(a)) === JSON.stringify(pathsOf(b));
    A(run, 'manifestParityWithDryRun', 'acceptance', 'AC1', same(dry.m.removes, m.removes) && same(dry.m.keeps, m.keeps), 'dry-run and confirmed Removes/Keeps path sets equal (only header, trailer and Removing section differ)', {
      dryRemoves: pathsOf(dry.m.removes),
      confirmedRemoves: pathsOf(m.removes),
      dryKeeps: pathsOf(dry.m.keeps),
      confirmedKeeps: pathsOf(m.keeps),
    });
  }
}

function checkRefusal(A, run, r, { names, because }) {
  const { res, d } = r;
  A(run, 'exit1', 'positive', 'CTL', res.code === 1, 'exit 1', res.code);
  A(run, 'stdoutEmpty', 'positive', 'CTL', res.out === '', 'no manifest printed', res.out.slice(0, 200));
  const norm = (s) => s.replaceAll('\\', '/');
  A(run, 'refusalNamesPath', 'positive', 'AC2', norm(res.err).includes(norm(names)), `stderr names ${names}`, res.err.trim());
  if (because) A(run, 'refusalReason', 'positive', 'CTL', res.err.includes(because), `stderr says "${because}"`, res.err.trim());
  A(run, 'claimsNothingChanged', 'positive', 'CTL', res.err.includes('Nothing in the data directory was changed.'), 'refusal says nothing changed', res.err.trim().split('\n').at(-1));
  A(run, 'noByteChange', 'safety', 'AC3', !d.removed.length && !d.added.length && !d.changed.length, 'fixture tree byte-identical (data, outside, external)', d);
  A(run, 'tempCopiesCleaned', 'safety', 'CTL', r.tempLeft.length === 0, 'no gg-reset-store-* left', r.tempLeft);
}

// ---------------------------------------------------------------- scenarios
const dryArgs = (fx) => ['--reset', '--data-dir', fx.data];
const yesArgs = (fx) => ['--reset', '--yes', '--data-dir', fx.data];

async function pairScenario(ctx, sc, fx, guards, options) {
  const A = recorder(sc);
  const dry = await runReset(ctx, fx, dryArgs(fx));
  record(sc, 'dry', dry, ctx);
  checkDry(A, 'dry', fx, dry, guards);
  const yes = await runReset(ctx, fx, yesArgs(fx));
  record(sc, 'confirmed', yes, ctx);
  checkConfirmed(A, 'confirmed', fx, yes, dry, guards, options);
}

const SCENARIOS = [
  {
    id: 'S01',
    title: 'Default database, no stale ownership: dry run then confirmed reset',
    async run(ctx, sc) {
      const fx = await buildFixture(ctx, 'default');
      await pairScenario(ctx, sc, fx, []);
    },
  },
  {
    id: 'S02',
    title: 'Default database with stale directory lock and stale database sidecar left by a killed owner',
    async run(ctx, sc) {
      const fx = await buildFixture(ctx, 'default');
      const h = await startHolder(ctx, 'both', `${fx.data}|${fx.dbFile}`);
      await h.kill();
      sc.setup = { staleOwnerPid: h.pid, staleFiles: [DIR_LOCK, fx.dbLockRel].filter((p) => existsSync(join(fx.data, p))) };
      await pairScenario(ctx, sc, fx, []);
    },
  },
  {
    id: 'S03',
    title: 'Default database with a stale database-lock .reclaim guard (owner killed mid-acquisition)',
    async run(ctx, sc) {
      const fx = await buildFixture(ctx, 'default');
      const h = await startHolder(ctx, 'guard', join(fx.data, ...fx.dbGuardRel.split('/')));
      await h.kill();
      sc.setup = { staleGuard: fx.dbGuardRel, marker: h.messages[0]?.marker };
      await pairScenario(ctx, sc, fx, [[fx.dbGuardRel, 'acceptance']]);
    },
  },
  {
    id: 'S04',
    title: 'Control: stale data-directory .reclaim guard (owner killed mid-acquisition)',
    async run(ctx, sc) {
      const fx = await buildFixture(ctx, 'default');
      const h = await startHolder(ctx, 'guard', join(fx.data, DIR_GUARD));
      await h.kill();
      sc.setup = { staleGuard: DIR_GUARD, marker: h.messages[0]?.marker };
      await pairScenario(ctx, sc, fx, [[DIR_GUARD, 'interpretive']], { unlistedKind: 'interpretive' });
    },
  },
  {
    id: 'S05',
    title: 'Held control: live owner of the database sidecar lock refuses dry run and confirmed reset',
    async run(ctx, sc) {
      const fx = await buildFixture(ctx, 'default');
      const h = await startHolder(ctx, 'db-lock', fx.dbFile);
      const A = recorder(sc);
      for (const [name, argv] of [['dry', dryArgs(fx)], ['confirmed', yesArgs(fx)]]) {
        const r = await runReset(ctx, fx, argv);
        record(sc, name, r, ctx);
        checkRefusal(A, name, r, { names: fx.dbLockFile, because: 'verify ownership before resetting' });
        A(name, 'refusalDoesNotBlameDirLock', 'positive', 'AC2', !r.res.err.includes(join(fx.data, DIR_LOCK) + ';') && !r.res.err.includes(join(fx.data, DIR_LOCK) + ':'), 'refusal does not name the directory lock as the held lock', r.res.err.trim());
      }
      await h.kill();
    },
  },
  {
    id: 'S06',
    title: 'Held control: live owner of the data-directory lock refuses dry run and confirmed reset',
    async run(ctx, sc) {
      const fx = await buildFixture(ctx, 'default');
      const h = await startHolder(ctx, 'dir-lock', fx.data);
      const A = recorder(sc);
      for (const [name, argv] of [['dry', dryArgs(fx)], ['confirmed', yesArgs(fx)]]) {
        const r = await runReset(ctx, fx, argv);
        record(sc, name, r, ctx);
        checkRefusal(A, name, r, { names: join(fx.data, DIR_LOCK), because: 'verify ownership before resetting' });
      }
      await h.kill();
    },
  },
  {
    id: 'S07',
    title: 'Held control: live marker in the database-lock .reclaim guard refuses dry run and confirmed reset',
    async run(ctx, sc) {
      const fx = await buildFixture(ctx, 'default');
      const h = await startHolder(ctx, 'guard', join(fx.data, ...fx.dbGuardRel.split('/')));
      const A = recorder(sc);
      for (const [name, argv] of [['dry', dryArgs(fx)], ['confirmed', yesArgs(fx)]]) {
        const r = await runReset(ctx, fx, argv);
        record(sc, name, r, ctx);
        checkRefusal(A, name, r, { names: `${fx.dbLockFile}.reclaim`, because: 'verify ownership before resetting' });
      }
      await h.kill();
    },
  },
  {
    id: 'S08',
    title: 'Failure control: an artifact held open exclusively stops the confirmed reset part way',
    async run(ctx, sc) {
      const fx = await buildFixture(ctx, 'default');
      const held = join(fx.data, 'artifacts', 'text', 'held.bin');
      await put(held, 'held artifact bytes');
      const heldSha = sha(await readFile(held)).slice(0, 16);
      const h = await startHolder(ctx, 'exfile', held);
      const A = recorder(sc);
      const dry = await runReset(ctx, fx, dryArgs(fx));
      record(sc, 'dry', dry, ctx);
      checkDry(A, 'dry', fx, dry, []);
      const r = await runReset(ctx, fx, yesArgs(fx));
      record(sc, 'confirmed', r, ctx);
      const { res, d, after, before, m } = r;
      const run = 'confirmed';
      A(run, 'exit1', 'positive', 'CTL', res.code === 1, 'exit 1', res.code);
      A(run, 'stopNamesHeldFile', 'positive', 'AC2', /Reset stopped: could not remove artifacts\/text\/held\.bin/.test(res.err), 'names artifacts/text/held.bin', res.err.split('\n')[0]);
      const removedList = failureList(res.err, 'Removed') ?? [];
      const notRemoved = failureList(res.err, 'Not removed') ?? [];
      const partly = failureList(res.err, 'Partly removed') ?? [];
      A(run, 'failureRemovedListAccurate', 'positive', 'AC2', removedList.length > 0 && removedList.every((p) => !after.has(`data/${p}`)), 'every "Removed" item is absent', { removedList, present: removedList.filter((p) => after.has(`data/${p}`)) });
      A(run, 'failureNotRemovedListAccurate', 'positive', 'AC2', notRemoved.length > 0 && notRemoved.every((p) => after.has(`data/${p}`)), 'every "Not removed" item is present', { notRemoved, missing: notRemoved.filter((p) => !after.has(`data/${p}`)) });
      A(run, 'failurePartlyAccurate', 'positive', 'AC2', partly.length === 1 && after.has(`data/${partly[0]}`) && after.has('data/artifacts/text/held.bin'), 'partly removed target still present with the held file', partly);
      A(run, 'dirLockReleasedAndReported', 'positive', 'AC2', !after.has(`data/${DIR_LOCK}`) && /Released graphgoblin\.lock|graphgoblin\.lock.*released/i.test(res.err), 'graphgoblin.lock absent and its release reported', res.err.split('\n').slice(-3));
      const dbLockGone = !after.has(`data/${fx.dbLockRel}`);
      A(run, 'dbLockReleasedAndReported', 'acceptance', 'AC2', dbLockGone && res.err.includes(basename(fx.dbLockRel)), `${fx.dbLockRel} absent and the failure message identifies its release`, { dbLockPresentAfter: !dbLockGone, stderrTail: res.err.split('\n').slice(-3) });
      A(run, 'manifestDbLockNotKept', 'acceptance', 'AC1', !listed(m.keeps, fx.dbLockRel), `${fx.dbLockRel} absent from the printed Keeps`, m.keeps.filter((k) => k.path.endsWith(fx.dbLockRel)));
      const damaged = fx.unrelated.filter((k) => JSON.stringify(before.get(k)) !== JSON.stringify(after.get(k)));
      A(run, 'unrelatedPreservedByteForByte', 'safety', 'AC3', damaged.length === 0, fx.unrelated, { changedOrMissing: damaged });
      const foreign = d.removed.filter((k) => !dataRel(k) || !ownedBy(fx, dataRel(k)));
      A(run, 'removedOnlyOwned', 'safety', 'AC3', foreign.length === 0, 'removed paths are owned', { notOwned: foreign, removed: d.removed });
      await h.kill();
      const heldAfter = sha(await readFile(held)).slice(0, 16);
      A(run, 'heldFileBytesIntact', 'safety', 'AC3', heldAfter === heldSha, heldSha, heldAfter);
      const again = await runReset(ctx, fx, yesArgs(fx));
      record(sc, 'rerun', again, ctx);
      checkConfirmed(A, 'rerun', fx, again, undefined, []);
    },
  },
  {
    id: 'S09',
    title: 'Failure control: the database sidecar is held exclusively once the reset creates it (lock release fails)',
    async run(ctx, sc) {
      const fx = await buildFixture(ctx, 'default');
      const A = recorder(sc);
      const h = await startHolder(ctx, 'exfile-wait', fx.dbLockFile);
      const r = await runReset(ctx, fx, yesArgs(fx));
      record(sc, 'confirmed', r, ctx);
      const heldMsg = h.messages.find((x) => x.held === true);
      const run = 'confirmed';
      A(run, 'holderCaughtSidecar', 'precondition', 'CTL', Boolean(heldMsg), 'holder opened the reset-created sidecar exclusively before release', heldMsg ?? h.messages);
      const { res, after, before, m } = r;
      if (!heldMsg) {
        for (const id of ['exit1', 'dirLockStatusAccurate', 'releaseFailureNamesDbLock', 'unrelatedPreservedByteForByte'])
          A(run, id, id === 'releaseFailureNamesDbLock' ? 'acceptance' : 'positive', 'AC2', null, 'requires precondition', null);
      } else {
        A(run, 'exit1', 'positive', 'CTL', res.code === 1, 'exit 1 (release failed)', res.code);
        const subjects = couldNotSubjects(res.err);
        const dirLockGone = !after.has(`data/${DIR_LOCK}`);
        const blamesDir = subjects.some((s) => s === DIR_LOCK || s.endsWith(sep + DIR_LOCK) || s.endsWith('/' + DIR_LOCK));
        A(run, 'dirLockStatusAccurate', 'acceptance', 'AC2', !(dirLockGone && blamesDir), 'no "could not remove graphgoblin.lock" claim when graphgoblin.lock was removed', { dirLockPresentAfter: !dirLockGone, couldNotSubjects: subjects });
        A(run, 'releaseFailureNamesDbLock', 'acceptance', 'AC2', subjects.some((s) => s.includes(basename(fx.dbLockRel))), `the "could not remove/release" subject names ${fx.dbLockRel}`, { couldNotSubjects: subjects, stderr: res.err.trim() });
        A(run, 'dbLockLeftInPlace', 'observation', 'CTL', after.has(`data/${fx.dbLockRel}`), 'the held sidecar remains after the failed release', after.has(`data/${fx.dbLockRel}`));
        const damaged = fx.unrelated.filter((k) => JSON.stringify(before.get(k)) !== JSON.stringify(after.get(k)));
        A(run, 'unrelatedPreservedByteForByte', 'safety', 'AC3', damaged.length === 0, fx.unrelated, { changedOrMissing: damaged });
        A(run, 'manifestDbLockNotKept', 'acceptance', 'AC1', !listed(m.keeps, fx.dbLockRel), `${fx.dbLockRel} absent from the printed Keeps`, m.keeps.filter((k) => k.path.endsWith(fx.dbLockRel)));
      }
      await h.kill();
      // Recovery: the leftover sidecar now records a dead reset process; a rerun must reclaim it.
      const again = await runReset(ctx, fx, yesArgs(fx));
      record(sc, 'rerun', again, ctx);
      checkConfirmed(A, 'rerun', fx, again, undefined, []);
    },
  },
  {
    id: 'S10',
    title: 'External database outside the data directory: explicit refusal, no external sidecar created',
    async run(ctx, sc) {
      const fx = await buildFixture(ctx, 'external');
      const A = recorder(sc);
      for (const [name, argv] of [['dry', dryArgs(fx)], ['confirmed', yesArgs(fx)]]) {
        const r = await runReset(ctx, fx, argv);
        record(sc, name, r, ctx);
        checkRefusal(A, name, r, { names: fx.dbFile, because: 'is outside the data directory' });
        A(name, 'noExternalSidecar', 'safety', 'AC3', !r.after.has('external/ext.db.graphgoblin.lock') && !r.after.has('external/ext.db.graphgoblin.lock.reclaim'), 'no ext.db.graphgoblin.lock(.reclaim) created', [...r.after.keys()].filter((k) => k.startsWith('external/')));
      }
    },
  },
  {
    id: 'S11',
    title: 'Supported nested database (data/db/store.db) with a stale nested sidecar and an unrelated file beside it',
    async run(ctx, sc) {
      const fx = await buildFixture(ctx, 'nested');
      await put(join(fx.data, 'db', 'readme.txt'), 'unrelated file beside the nested database');
      fx.unrelated.push('data/db/readme.txt');
      const h = await startHolder(ctx, 'db-lock', fx.dbFile);
      await h.kill();
      sc.setup = { staleSidecar: fx.dbLockRel, present: existsSync(fx.dbLockFile) };
      await pairScenario(ctx, sc, fx, []);
      const A = recorder(sc);
      const conf = sc.runs.find((x) => x.name === 'confirmed');
      A('confirmed', 'nestedUnrelatedListedAsKept', 'observation', 'AC3', conf.manifest.keeps.some((k) => k.path === 'db/readme.txt' || k.path === 'db'), 'db/readme.txt (or db/) disclosed under Keeps', conf.manifest.keeps.map((k) => k.path));
    },
  },
  {
    id: 'S12',
    title: 'Custom top-level database name (custom.db) with a foreign graphgoblin.db.graphgoblin.lock file that must be kept',
    async run(ctx, sc) {
      const fx = await buildFixture(ctx, 'custom');
      await put(join(fx.data, 'graphgoblin.db.graphgoblin.lock'), 'foreign lock-like file from another configuration');
      fx.unrelated.push('data/graphgoblin.db.graphgoblin.lock');
      fx.expectKeeps.push('graphgoblin.db.graphgoblin.lock');
      await pairScenario(ctx, sc, fx, []);
    },
  },
  {
    id: 'S13',
    title: 'No database file: only unrelated files; the reset still takes and releases the database sidecar',
    async run(ctx, sc) {
      const fx = await buildFixture(ctx, 'none');
      await pairScenario(ctx, sc, fx, []);
    },
  },
];

// ---------------------------------------------------------------- main
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!existsSync(join(opts.checkout, 'apps', 'api', 'dist', 'main.js')))
    throw new Error('the checkout has no built apps/api/dist/main.js; the coordinator supplies a built checkout');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runRoot = join(SCRATCH, 'runs', `${opts.label}-${stamp}`);
  if (!inside(SCRATCH, runRoot)) throw new Error('run folder escaped the scratch folder');
  await mkdir(runRoot, { recursive: true });
  const results = {
    schema: 'gg-434-reset-lock-qa/v1',
    issue: 434,
    label: opts.label,
    startedAt: new Date().toISOString(),
    provenance: await provenance(opts.checkout, opts.expectHead),
    method: {
      entrypoint: 'node <checkout>/apps/api/dist/main.js --reset [--yes] --data-dir <fixture>/data',
      isolation: 'minimal child env built by the driver; GG_DATA_DIR always a fixture; USERPROFILE/HOME/TEMP/TMP/APPDATA/LOCALAPPDATA inside the run folder; GG_DB_URL only when the scenario configures one',
      ownershipFixtures: 'held/stale locks and guards produced by the checkout\'s built apps/api/dist/data-dir-lock.js and windows-process-identity.js in holder processes (killed with SIGKILL to leave stale records)',
      store: 'real current-format store seeded by packages/infrastructure/dist/sqlite openDatabase+migrate with two run IDs (database + WAL copy)',
      kinds: {
        acceptance: '#434 acceptance criterion; expected to FAIL on an unfixed baseline',
        safety: 'must hold on baseline and candidate (no unrelated or unowned change)',
        positive: 'existing documented behaviour / control expected to hold',
        interpretive: 'QA reading beyond the literal acceptance text; reported, not gating',
        precondition: 'fixture precondition; dependent assertions are not-run when it fails',
        observation: 'recorded fact outside #434 scope',
      },
      criteria: {
        AC1: 'Dry-run and confirmed manifests accurately classify the database lock and its .reclaim guard',
        AC2: 'Completion and failure messages identify directory and database locks accurately',
        AC3: 'Confirmed runs preserve unrelated files; only owned metadata/content is removed',
        CTL: 'held/failure/refusal controls',
        DIFF: 'expected dry-run vs confirmed differences',
      },
    },
    scenarios: [],
  };
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
      const ctx = {
        checkout: opts.checkout,
        base,
        fixture: join(base, 'fixture'),
        temp: join(base, 'env', 'tmp'),
        home: join(base, 'env', 'home'),
        seed: join(seedRoot, 'current'),
        holders: [],
      };
      for (const dir of [ctx.fixture, ctx.temp, join(ctx.home, 'AppData', 'Roaming'), join(ctx.home, 'AppData', 'Local')])
        await mkdir(dir, { recursive: true });
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
  const tally = (list) => ({
    total: list.length,
    pass: list.filter((a) => a.outcome === 'pass').length,
    fail: list.filter((a) => a.outcome === 'fail').length,
    notRun: list.filter((a) => a.outcome === 'not-run').length,
  });
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
