#!/usr/bin/env node
// GraphGoblin #434 correction dc65a24: independent continuation QA, targeted acquisition controls.
//
// Complements the unchanged 13-case driver (../driver/qa-434-reset-locks.mjs). That driver's
// held-lock refusals (S05-S07) are refused by the read-only preview, before any lock is taken. This
// driver reaches the correction's new path natively: the preview passes, the confirmed reset takes
// a lock, and taking the next lock (or the release after it) fails for a real Windows reason:
//   - a hard-linked database (the lock module's own nlink refusal), outside and inside the data dir;
//   - a stale lock file or stale guard marker (dead-owner record from the product's own lock code)
//     that another process holds open with FileShare.Read: readable, so the preview classifies it as
//     stale, but its deletion fails with a real sharing violation (EBUSY);
//   - the reset's own graphgoblin.lock grabbed exclusively by a spinning helper as soon as the reset
//     creates it, so releasing it fails (a timing precondition, recorded).
// No fault is injected into the product process; every failure is native. Entrypoint is the real
// built CLI `node <checkout>/apps/api/dist/main.js --reset [--yes] --data-dir <fixture>/data`, with
// the same minimal, fixture-local child environment as the original driver.
//
// Usage: node qa-434-acquisition-controls.mjs --checkout <path> --label <name> [--expect-head <sha>]
//        [--only C1,C2] [--keep-fixtures] [--out <file.json>]
// Refuses to overwrite an existing results file. Exit 0 when the driver completed (assertion
// failures are results), 1 on a driver error.
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, existsSync, openSync, closeSync, readFileSync, statSync } from 'node:fs';
import { copyFile, link, lstat, mkdir, readFile, readdir, readlink, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const CONT_DIR = dirname(fileURLToPath(import.meta.url));
const SCRATCH = resolve(CONT_DIR, '..');
const ORIGINAL_DRIVER_DIR = join(SCRATCH, 'driver'); // holder.mjs and seed-store.mjs, reused unchanged
const RUN_IDS = ['01KQA434RVNAAAAAAAAAAAAAAA', '01KQA434RVNBBBBBBBBBBBBBBB'];
const DIR_LOCK = 'graphgoblin.lock';
const DIR_GUARD = 'graphgoblin.lock.reclaim';
const DB = 'graphgoblin.db';
const DB_LOCK = 'graphgoblin.db.graphgoblin.lock';
const DB_GUARD = 'graphgoblin.db.graphgoblin.lock.reclaim';
const UV_FS_O_EXLOCK = 0x10000000;
const ROLE_FILES = {
  'data-directory lock': { lock: DIR_LOCK, guard: DIR_GUARD },
  'database lock': { lock: DB_LOCK, guard: DB_GUARD },
};
const STORE_DATA = [DB, `${DB}-wal`, 'artifacts', 'chat-audio', ...RUN_IDS.map((id) => `workspaces/${id}`)];

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
  o.out = resolve(o.out ?? join(CONT_DIR, 'results', `${o.label}-results.json`));
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
  const status = await git(['status', '--porcelain']);
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
    statusLines: status ? status.split('\n') : [],
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
      done({ code, signal, out, err, started, ended: Date.now(), ms: Date.now() - started, pid: child.pid });
    });
  });
}

/** A helper process speaking one JSON object per stdout line; resolves once it says ready. */
async function startProc(ctx, name, command, args, env) {
  const child = spawn(command, args, { env, cwd: ctx.base, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const messages = [];
  const waiters = [];
  let buffer = '';
  let stderr = '';
  let exitInfo;
  const notify = () => [...waiters].forEach((w) => w());
  child.stdout.setEncoding('utf8').on('data', (d) => {
    buffer += d;
    for (let i; (i = buffer.indexOf('\n')) >= 0; ) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      try {
        messages.push({ ...JSON.parse(line), receivedAt: Date.now() });
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
          rej(new Error(`${name} exited ${JSON.stringify(exitInfo)} ${stderr} ${JSON.stringify(messages)}`));
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        rej(new Error(`${name} timed out`));
      }, ms);
      waiters.push(check);
      check();
    });
  const ready = await until((m) => 'ready' in m);
  if (!ready.ready) throw new Error(`${name} failed: ${ready.error}`);
  const proc = {
    name,
    pid: child.pid,
    messages,
    stderr: () => stderr,
    exited: () => exitInfo,
    kill: async () => {
      if (exitInfo) return exitInfo;
      child.kill('SIGKILL');
      return exited;
    },
  };
  ctx.procs.push(proc);
  return proc;
}

const holder = (ctx, mode, arg) =>
  startProc(ctx, `holder:${mode}`, process.execPath, [join(ORIGINAL_DRIVER_DIR, 'holder.mjs'), mode, ctx.checkout, arg], childEnv(ctx));

// Holds <QA_HOLD_PATH> open for reading with FileShare.Read only: other processes can read it, but
// any open for DELETE (unlink) fails with a sharing violation. Native .NET FileStream, no injection.
const PS_SHARE_READ = [
  "$ErrorActionPreference = 'Stop'",
  'try {',
  '  $f = [System.IO.File]::Open($env:QA_HOLD_PATH, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)',
  "  [Console]::Out.WriteLine('{\"ready\":true,\"share\":\"Read\"}')",
  '} catch {',
  "  [Console]::Out.WriteLine('{\"ready\":false,\"error\":' + (ConvertTo-Json ([string]$_.Exception.Message)) + '}')",
  '  exit 1',
  '}',
  '[Console]::Out.Flush()',
  'while ($true) { Start-Sleep -Seconds 5 }',
].join('\n');
const powershell = () => join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const shareReadHold = (ctx, file) =>
  startProc(ctx, 'share-read', powershell(), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(PS_SHARE_READ, 'utf16le').toString('base64')], childEnv(ctx, { QA_HOLD_PATH: file }));
const spinHold = (ctx, file) =>
  startProc(ctx, 'spin-exlock', process.execPath, [join(CONT_DIR, 'spin-exlock.mjs'), file, '120000'], childEnv(ctx));

/** Readable by another process, yet some handle is open (an exclusive open fails). */
function shareHoldProbe(file, expectBytes) {
  let readable = false;
  let sameBytes = false;
  let exclusiveOpen = 'not tried';
  try {
    const bytes = readFileSync(file);
    readable = true;
    sameBytes = expectBytes === undefined || Buffer.compare(bytes, expectBytes) === 0;
  } catch (e) {
    readable = `error ${e.code}`;
  }
  try {
    const fd = openSync(file, constants.O_RDONLY | UV_FS_O_EXLOCK);
    closeSync(fd);
    exclusiveOpen = 'succeeded (no other handle)';
  } catch (e) {
    exclusiveOpen = e.code;
  }
  return { readable, sameBytes, exclusiveOpen, effective: readable === true && sameBytes && exclusiveOpen === 'EBUSY' };
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
        map.set(r, { kind: 'file', size: Number(st.size), sha: digest, nlink: Number(st.nlink) });
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
const treeRecord = (map) =>
  Object.fromEntries([...map].map(([k, v]) => [k, v.kind === 'file' ? `file ${v.size}B ${v.sha} nlink=${v.nlink}` : v.kind]));

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
  const rows = (r) =>
    r
      .filter((x) => !PROSE.some((p) => p.test(x)))
      .map((x) => {
        const c = /^(\S+)\s*(.*)$/.exec(x);
        return { path: c[1].replaceAll('\\', '/'), rest: c[2].replace(/\s{2,}/g, ' | ') };
      });
  const at = lines.indexOf('Removing:');
  const removingSection = at < 0 ? '' : lines.slice(at).join('\n');
  const removedLines = at < 0 ? [] : [...removingSection.matchAll(/^\s+removed (\S+)/gm)].map((x) => x[1].replaceAll('\\', '/'));
  return { printed: lines.includes('Removes:'), removes: rows(section('Removes:')), keeps: rows(section('Keeps:')), removingSection, removedLines };
}

const OBSERVED = /^(\S+) \((.+?)\): (?:(present|absent) now(?: and before the attempt|, (present|absent) before the attempt)|could not be inspected now .*)$/;
const RELEASE = [
  [/^removed (\S+) \((.+?)\)$/, 'removed'],
  [/^could not remove (\S+) \((.+?)\): (.*)$/, 'failed'],
  [/^(\S+) \((.+?)\) was already gone$/, 'missing'],
  [/^kept (\S+) \((.+?)\): /, 'kept'],
];
const RECLAIMED = /^reclaimed stale (\S+) \((.+?)\)$/;
/** An acquisition-stage refusal (or any refusal / incomplete message) on stderr. */
function parseErr(err) {
  const lines = err.split(/\r?\n/);
  const first = lines[0] ?? '';
  const stage = /^reset refused: could not take the (data-directory lock|database lock): (.*)$/.exec(first);
  const headerIndex = lines.findIndex((l) => l.startsWith('No store data was removed.'));
  const items = lines.filter((l) => /^ {2}\S/.test(l)).map((l) => l.trim());
  const observed = [];
  const releases = [];
  const reclaimed = [];
  const unknown = [];
  for (const item of items) {
    let m;
    if ((m = OBSERVED.exec(item))) observed.push({ path: m[1], what: m[2], now: m[3] ?? 'uninspectable', before: m[4] ?? m[3] ?? 'unknown', line: item });
    else if ((m = RECLAIMED.exec(item))) reclaimed.push({ path: m[1], what: m[2] });
    else {
      const r = RELEASE.find(([re]) => re.test(item));
      if (r) {
        const c = r[0].exec(item);
        releases.push({ outcome: r[1], path: c[1], what: c[2], detail: c[3] ?? null, line: item });
      } else unknown.push(item);
    }
  }
  return { first, stage: stage ? { role: stage[1], cause: stage[2] } : null, header: headerIndex >= 0 ? lines[headerIndex] : null, observed, releases, reclaimed, unknown };
}
const hasStack = (text) => /^\s+at .+\(.+:\d+:\d+\)$/m.test(text) || /^\s+at file:/m.test(text);

// ---------------------------------------------------------------- fixtures
async function put(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}
/** The original driver's default-database fixture shape (same unrelated files and look-alikes). */
async function buildFixture(ctx) {
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
  await put(join(data, 'artifacts', 'text', 'abc123'), 'artifact body');
  await put(join(data, 'chat-audio', 'clip.webm'), 'audio bytes');
  for (const id of RUN_IDS) await put(join(data, 'workspaces', id, 'src', 'out.txt'), id);
  const dbFile = join(data, DB);
  await copyFile(join(ctx.seed, 'graphgoblin.db'), dbFile);
  await copyFile(join(ctx.seed, 'graphgoblin.db-wal'), `${dbFile}-wal`);
  return {
    data,
    dbFile,
    env: { GG_DATA_DIR: data },
    unrelated: [
      ...Object.keys(unrelatedTop).map((n) => `data/${n}`),
      'data/workspaces/my-notes',
      'data/workspaces/my-notes/keep.txt',
      'outside/precious.txt',
      'outside/sub',
      'outside/sub/also.txt',
    ],
    expectKeeps: [...Object.keys(unrelatedTop), 'workspaces/my-notes'],
  };
}
const dataRel = (k) => (k.startsWith('data/') ? k.slice(5) : undefined);
const under = (rel, p) => rel === p || rel.startsWith(p + '/');
const isStoreData = (rel) => STORE_DATA.some((p) => under(rel, p));
const isLockMeta = (rel) => [DIR_LOCK, DB_LOCK].includes(rel) || under(rel, DIR_GUARD) || under(rel, DB_GUARD);
const isStaging = (rel) => /^graphgoblin(\.db\.graphgoblin)?\.lock\.reclaim\.[0-9a-f-]{36}\.tmp(\/|$)/.test(rel);

// ---------------------------------------------------------------- assertions
function recorder(sc) {
  return (run, id, kind, criterion, pass, expected, actual) => {
    sc.assertions.push({ id: `${sc.id}.${run}.${id}`, kind, criterion, outcome: pass === null ? 'not-run' : pass ? 'pass' : 'fail', expected, actual });
  };
}

async function runReset(ctx, fx, argv) {
  const main = join(ctx.checkout, 'apps', 'api', 'dist', 'main.js');
  const before = await snapshot(ctx.fixture);
  const res = await runNode([main, ...argv], childEnv(ctx, fx.env), ctx.base);
  const after = await snapshot(ctx.fixture);
  const tempLeft = (await readdir(ctx.temp)).filter((n) => n.startsWith('gg-reset-store-'));
  return { argv, res, before, after, d: diff(before, after), m: parseManifest(res.out), e: parseErr(res.err), tempLeft };
}
function record(sc, name, r, ctx, extra = {}) {
  const show = (s) => s.replaceAll(ctx.base, '<run>');
  sc.runs.push({
    name,
    ggEnv: Object.fromEntries(Object.entries(r.fxEnv ?? {}).map(([k, v]) => [k, show(v)])),
    argv: r.argv.map(show),
    exitCode: r.res.code,
    signal: r.res.signal,
    startedAt: r.res.started,
    endedAt: r.res.ended,
    ms: r.res.ms,
    stdout: r.res.out,
    stderr: r.res.err,
    manifest: { removes: r.m.removes, keeps: r.m.keeps },
    parsedStderr: r.e,
    fsDiff: r.d,
    treeBefore: treeRecord(r.before),
    treeAfter: treeRecord(r.after),
    tempLeftovers: r.tempLeft,
    ...extra,
  });
}
const DRY = ['--reset', '--data-dir'];
const CONFIRM = ['--reset', '--yes', '--data-dir'];

function checkUnrelated(A, run, fx, r) {
  const damaged = fx.unrelated.filter((k) => JSON.stringify(r.before.get(k)) !== JSON.stringify(r.after.get(k)));
  A(run, 'unrelatedPreservedByteForByte', 'safety', 'AC3', damaged.length === 0, fx.unrelated, { changedOrMissing: damaged });
  const outsideData = [...r.d.removed, ...r.d.added, ...r.d.changed].filter((k) => !dataRel(k));
  A(run, 'nothingOutsideDataChanged', 'safety', 'AC3', outsideData.length === 0, 'no change outside data/', outsideData);
  const staging = [...r.after.keys()].filter((k) => dataRel(k) && isStaging(dataRel(k)));
  A(run, 'noGuardStagingLeft', 'safety', 'CTL', staging.length === 0, 'no <lock>.reclaim.<uuid>.tmp staging directory left', staging);
  A(run, 'tempCopiesCleaned', 'safety', 'CTL', r.tempLeft.length === 0, 'no gg-reset-store-* left in the isolated TEMP', r.tempLeft);
  A(run, 'noStackTrace', 'positive', 'CTL', !hasStack(r.res.err) && !hasStack(r.res.out), 'no JavaScript stack frames in output', hasStack(r.res.err) ? r.res.err : '');
}

function checkDry(A, fx, r, { staleListed = [] } = {}) {
  const run = 'dry';
  A(run, 'exit0', 'positive', 'CTL', r.res.code === 0, 0, r.res.code);
  A(run, 'stderrEmpty', 'positive', 'CTL', r.res.err === '', '', r.res.err);
  const ch = [...r.d.removed, ...r.d.added, ...r.d.changed];
  A(run, 'noByteChange', 'safety', 'AC3', ch.length === 0, 'fixture byte-identical', r.d);
  A(run, 'dryRunHeaderAndTrailer', 'positive', 'DIFF', r.res.out.startsWith('GraphGoblin reset (dry run: nothing is removed)') && r.res.out.includes('Nothing was removed.'), 'dry-run header and trailer', r.res.out.split('\n')[0]);
  A(run, 'noRemovalSection', 'positive', 'DIFF', !r.m.removingSection, 'no Removing: section', r.m.removingSection);
  for (const p of staleListed) {
    const row = r.m.removes.find((x) => x.path === p);
    A(run, `stale:${p}:inRemovesNotKeeps`, 'acceptance', 'AC1', !!row && !r.m.keeps.some((k) => k.path === p), `${p} listed under Removes, not Keeps`, { row, keeps: r.m.keeps.map((k) => k.path) });
    A(run, `stale:${p}:describedStale`, 'positive', 'AC1', !!row && /stale/i.test(row.rest), `${p} row says it is stale`, row?.rest);
  }
  const missingKeeps = fx.expectKeeps.filter((k) => !r.m.keeps.some((x) => x.path === k));
  A(run, 'unrelatedListedAsKept', 'positive', 'AC3', missingKeeps.length === 0, fx.expectKeeps, { missing: missingKeeps });
}

/**
 * A refusal at an acquisition stage. `held`: what the data-directory lock's release must show for a
 * database-stage failure ('removed' | 'failed'); null for a data-directory-stage failure.
 */
function checkAcqRefusal(A, run, fx, r, { role, cause, causePath, held, allowedDiff = [] }) {
  const e = r.e;
  const { lock, guard } = ROLE_FILES[role];
  A(run, 'exit1', 'positive', 'CTL', r.res.code === 1, 1, r.res.code);
  A(run, 'noPlanPrinted', 'positive', 'DIFF', r.res.out === '', 'stdout empty: refused before the locked plan is printed', r.res.out);
  A(run, 'stageNamed', 'correction', 'ACQ', e.stage?.role === role, `first line: reset refused: could not take the ${role}: ...`, e.first);
  A(run, 'causeNamed', 'correction', 'AC2', !!e.stage && cause.test(e.stage.cause) && e.stage.cause.includes(causePath), { cause: String(cause), path: causePath }, e.stage?.cause ?? e.first);
  A(run, 'noFalseNothingChanged', 'correction', 'ACQ', !r.res.err.includes('Nothing in the data directory was changed'), 'never "Nothing in the data directory was changed."', r.res.err);
  A(run, 'uncertainHeaderNamesRole', 'correction', 'ACQ', !!e.header && e.header.includes(`Taking the ${role} failed`), `header "No store data was removed. Taking the ${role} failed ..."`, e.header);
  // "No store data was removed." must be true against the filesystem.
  const storeTouched = [...r.d.removed, ...r.d.changed, ...r.d.added].filter((k) => dataRel(k) && isStoreData(dataRel(k)));
  A(run, 'noStoreDataRemovedIsTrue', 'safety', 'AC3', storeTouched.length === 0, 'no store-data path removed, added or changed', storeTouched);
  // The failed lock's file and guard, as found now and before the attempt, must match the disk.
  const paths = e.observed.map((o) => o.path).sort();
  A(run, 'observedCoversFailedLockOnly', 'correction', 'ACQ', JSON.stringify(paths) === JSON.stringify([guard, lock].sort()), [guard, lock].sort(), paths);
  const wrong = e.observed.filter((o) => {
    const now = r.after.has(`data/${o.path}`) ? 'present' : 'absent';
    const before = r.before.has(`data/${o.path}`) ? 'present' : 'absent';
    return o.now !== now || o.before !== before;
  });
  A(run, 'observedLinesTruthful', 'correction', 'AC2', e.observed.length > 0 && wrong.length === 0, 'each now/before matches the before and after snapshots', { observed: e.observed.map((o) => o.line), wrong: wrong.map((o) => o.line) });
  if (held === null) {
    A(run, 'noReleaseLines', 'correction', 'ACQ', e.releases.length === 0, 'no lock was held, so nothing was released', e.releases);
    const dbMeta = [...r.d.removed, ...r.d.added, ...r.d.changed].filter((k) => dataRel(k) && (dataRel(k) === DB_LOCK || under(dataRel(k), DB_GUARD)));
    A(run, 'databaseLockNeverAttempted', 'correction', 'ACQ', !r.res.err.includes(DB_LOCK) && dbMeta.length === 0, 'database lock neither reported nor changed', { dbMeta });
  } else {
    const rel = e.releases.filter((x) => x.path === DIR_LOCK);
    const present = r.after.has(`data/${DIR_LOCK}`);
    A(run, 'heldDirLockReleaseReported', 'correction', 'AC2', e.releases.length === 1 && rel.length === 1 && rel[0].what === 'data-directory lock' && rel[0].outcome === held, `exactly one release line: ${held} ${DIR_LOCK} (data-directory lock)`, e.releases.map((x) => x.line));
    A(run, 'heldDirLockReleaseTruthful', 'correction', 'AC2', held === 'removed' ? !present : present, held === 'removed' ? `${DIR_LOCK} absent after` : `${DIR_LOCK} still present after`, { present });
  }
  A(run, 'allStderrLinesUnderstood', 'positive', 'AC2', e.unknown.length === 0, 'every indented line is an observed, reclaimed or release line', e.unknown);
  const allowed = new Set(allowedDiff);
  const unexpected = [...r.d.removed, ...r.d.added, ...r.d.changed].filter((k) => !allowed.has(k));
  A(run, 'onlyAllowedChange', 'safety', 'AC3', unexpected.length === 0, allowedDiff.length ? allowedDiff : 'fixture byte-identical', { diff: r.d, unexpected });
  checkUnrelated(A, run, fx, r);
}

/** A confirmed reset that ran to completion (exit 0). */
function checkComplete(A, run, fx, r, { reclaimed = [] } = {}) {
  A(run, 'exit0', 'positive', 'CTL', r.res.code === 0, 0, r.res.code);
  A(run, 'resetComplete', 'positive', 'DIFF', /^Reset complete\./m.test(r.res.out) && r.res.err === '', 'Reset complete., empty stderr', { tail: r.res.out.split('\n').slice(-4), err: r.res.err });
  const foreign = r.d.removed.filter((k) => !dataRel(k) || !(isStoreData(dataRel(k)) || isLockMeta(dataRel(k))));
  A(run, 'removedOnlyOwned', 'safety', 'AC3', foreign.length === 0, 'only store data and lock metadata removed', foreign);
  A(run, 'nothingAddedOrChanged', 'safety', 'AC3', r.d.added.length === 0 && r.d.changed.length === 0, 'no added/changed path', { added: r.d.added, changed: r.d.changed });
  const leftOwned = [...r.after.keys()].filter((k) => dataRel(k) && (isStoreData(dataRel(k)) || isLockMeta(dataRel(k))));
  A(run, 'noOwnedLeft', 'positive', 'AC3', leftOwned.length === 0, 'no store data or lock metadata left', leftOwned);
  const keepsGone = r.m.keeps.filter((k) => !r.after.has(`data/${k.path}`));
  A(run, 'keepsListIsTruthful', 'acceptance', 'AC1', keepsGone.length === 0, 'every Keeps path survives', keepsGone.map((k) => k.path));
  const removedTop = [...new Set(r.d.removed.map((k) => dataRel(k)).filter(Boolean).map((rel) => {
    const top = STORE_DATA.find((p) => under(rel, p));
    if (top) return top;
    if (under(rel, DIR_GUARD)) return DIR_GUARD;
    if (under(rel, DB_GUARD)) return DB_GUARD;
    return rel;
  }))];
  const unlisted = removedTop.filter((p) => !r.m.removes.some((x) => x.path === p) && !r.m.removedLines.includes(p));
  A(run, 'noUnlistedRemoval', 'acceptance', 'AC1', unlisted.length === 0, 'every removed pre-existing path is a Removes row or a removed line', unlisted);
  A(run, 'bothLockReleasesReported', 'acceptance', 'AC2', r.m.removedLines.includes(DB_LOCK) && r.m.removedLines.includes(DIR_LOCK), `removed ${DB_LOCK} and removed ${DIR_LOCK}`, r.m.removedLines.filter((p) => p.includes('lock')));
  for (const p of reclaimed) {
    const row = r.m.removes.find((x) => x.path === p);
    A(run, `reclaimed:${p}:listedStale`, 'acceptance', 'AC1', !!row && /stale/i.test(row.rest) && !r.m.keeps.some((k) => k.path === p), `${p} under Removes as stale, not under Keeps`, row ?? null);
    A(run, `reclaimed:${p}:gone`, 'positive', 'AC1', ![...r.after.keys()].some((k) => dataRel(k) && under(dataRel(k), p)), `${p} gone after`, null);
  }
  checkUnrelated(A, run, fx, r);
}

// ---------------------------------------------------------------- scenarios
async function dryThenConfirm(ctx, sc, fx, opts, beforeConfirm) {
  const A = recorder(sc);
  const dry = await runReset(ctx, fx, [...DRY, fx.data]);
  dry.fxEnv = fx.env;
  record(sc, 'dry', dry, ctx);
  checkDry(A, fx, dry, opts);
  const extra = beforeConfirm ? await beforeConfirm() : undefined;
  const conf = await runReset(ctx, fx, [...CONFIRM, fx.data]);
  conf.fxEnv = fx.env;
  return { A, dry, conf, extra };
}

async function staleShareHeld(ctx, sc, fx, kind) {
  // Leave a genuine dead-owner record with the product's own lock code, then hold it read-shared.
  let target;
  if (kind === 'dir-lock') {
    const h = await holder(ctx, 'dir-lock', fx.data);
    await h.kill();
    target = join(fx.data, DIR_LOCK);
  } else if (kind === 'db-lock') {
    const h = await holder(ctx, 'db-lock', fx.dbFile);
    await h.kill();
    target = join(fx.data, DB_LOCK);
  } else {
    const h = await holder(ctx, 'guard', join(fx.data, DB_GUARD));
    const ready = h.messages.find((m) => m.ready);
    await h.kill();
    target = join(fx.data, DB_GUARD, ready.marker);
  }
  const bytes = readFileSync(target);
  const hold = await shareReadHold(ctx, target);
  const probe = shareHoldProbe(target, bytes);
  sc.setup = { ...(sc.setup ?? {}), staleRecord: relative(fx.data, target).replaceAll('\\', '/'), staleRecordSha256: sha(bytes).slice(0, 16), shareHoldPid: hold.pid, shareHoldProbe: probe };
  recorder(sc)('setup', 'shareReadHoldEffective', 'precondition', 'CTL', probe.effective, 'stale record readable by another process while a handle is open', probe);
  return { target, hold, probe };
}

const SCENARIOS = [
  {
    id: 'C0',
    title: 'Positive control: default database, no fault; dry run then confirmed reset completes',
    async run(ctx, sc) {
      const fx = await buildFixture(ctx);
      const { A, conf } = await dryThenConfirm(ctx, sc, fx, {});
      record(sc, 'confirmed', conf, ctx);
      checkComplete(A, 'confirmed', fx, conf);
    },
  },
  {
    id: 'C1',
    title: 'Hard-linked database (second link outside the data directory): refused at the database-lock stage',
    async run(ctx, sc) {
      const fx = await buildFixture(ctx);
      await link(fx.dbFile, join(ctx.fixture, 'outside', 'linked.db'));
      fx.unrelated.push('outside/linked.db');
      sc.setup = { hardLink: 'outside/linked.db', nlink: statSync(fx.dbFile).nlink };
      const { A, conf } = await dryThenConfirm(ctx, sc, fx, {});
      record(sc, 'confirmed', conf, ctx);
      checkAcqRefusal(A, 'confirmed', fx, conf, { role: 'database lock', cause: /has multiple hard links/, causePath: fx.dbFile, held: 'removed' });
      A('confirmed', 'linkStillShared', 'safety', 'AC3', statSync(fx.dbFile).nlink === 2, 'database still has its 2 links', statSync(fx.dbFile).nlink);
    },
  },
  {
    // controls-run1 expected a database-stage refusal here and failed 12 assertions: the read-only
    // preview itself refuses a database listed under two names (correct; nothing changed). Since
    // controls-run2 this scenario expects that preview-stage refusal for both runs.
    id: 'C1b',
    title: 'Hard-linked database (second link inside the data directory): the read-only preview refuses dry run and confirmed reset; nothing changed',
    async run(ctx, sc) {
      const fx = await buildFixture(ctx);
      await link(fx.dbFile, join(fx.data, 'linked-copy.db'));
      fx.unrelated.push('data/linked-copy.db');
      sc.setup = { hardLink: 'data/linked-copy.db', nlink: statSync(fx.dbFile).nlink };
      const A = recorder(sc);
      const runs = {};
      for (const [name, argv] of [['dry', DRY], ['confirmed', CONFIRM]]) {
        const r = await runReset(ctx, fx, [...argv, fx.data]);
        r.fxEnv = fx.env;
        record(sc, name, r, ctx);
        runs[name] = r;
        A(name, 'exit1', 'positive', 'CTL', r.res.code === 1, 1, r.res.code);
        A(name, 'noPlanPrinted', 'positive', 'CTL', r.res.out === '', 'stdout empty', r.res.out);
        A(name, 'namesBothNames', 'positive', 'CTL', /^reset refused: .*graphgoblin\.db.*more than one name.*linked-copy\.db/.test(r.e.first), 'refusal names graphgoblin.db and linked-copy.db as one database', r.e.first);
        A(name, 'refusedBeforeAnyLock', 'positive', 'ACQ', !r.e.stage && r.e.observed.length === 0 && r.e.releases.length === 0, 'no "could not take the" stage, no lock lines', { first: r.e.first, observed: r.e.observed, releases: r.e.releases });
        const ch = [...r.d.removed, ...r.d.added, ...r.d.changed];
        A(name, 'nothingChangedClaimIsTrue', 'safety', 'AC3', r.res.err.includes('Nothing in the data directory was changed.') && ch.length === 0, '"Nothing in the data directory was changed." and the fixture is byte-identical', r.d);
        checkUnrelated(A, name, fx, r);
      }
      A('confirmed', 'sameRefusalAsDryRun', 'positive', 'DIFF', runs.dry.res.err === runs.confirmed.res.err, 'dry run and confirmed reset print the same refusal', { dry: runs.dry.res.err, confirmed: runs.confirmed.res.err });
      A('confirmed', 'linkStillShared', 'safety', 'AC3', statSync(fx.dbFile).nlink === 2, 'database still has its 2 links', statSync(fx.dbFile).nlink);
    },
  },
  {
    id: 'C2',
    title: 'Stale data-directory lock that cannot be deleted (held FileShare.Read): refused at the data-directory stage; rerun completes',
    async run(ctx, sc) {
      const fx = await buildFixture(ctx);
      const { target, hold, probe } = await staleShareHeld(ctx, sc, fx, 'dir-lock');
      const { A, conf } = await dryThenConfirm(ctx, sc, fx, { staleListed: [DIR_LOCK] });
      record(sc, 'confirmed', conf, ctx);
      if (probe.effective) checkAcqRefusal(A, 'confirmed', fx, conf, { role: 'data-directory lock', cause: /EBUSY/, causePath: target, held: null });
      await hold.kill();
      const rerun = await runReset(ctx, fx, [...CONFIRM, fx.data]);
      rerun.fxEnv = fx.env;
      record(sc, 'rerun', rerun, ctx);
      checkComplete(A, 'rerun', fx, rerun, { reclaimed: [DIR_LOCK] });
    },
  },
  {
    id: 'C3',
    title: 'Stale database lock that cannot be deleted (held FileShare.Read): refused at the database stage; data-directory lock released; rerun completes',
    async run(ctx, sc) {
      const fx = await buildFixture(ctx);
      const { target, hold, probe } = await staleShareHeld(ctx, sc, fx, 'db-lock');
      const { A, conf } = await dryThenConfirm(ctx, sc, fx, { staleListed: [DB_LOCK] });
      record(sc, 'confirmed', conf, ctx);
      if (probe.effective) checkAcqRefusal(A, 'confirmed', fx, conf, { role: 'database lock', cause: /EBUSY/, causePath: target, held: 'removed' });
      await hold.kill();
      const rerun = await runReset(ctx, fx, [...CONFIRM, fx.data]);
      rerun.fxEnv = fx.env;
      record(sc, 'rerun', rerun, ctx);
      checkComplete(A, 'rerun', fx, rerun, { reclaimed: [DB_LOCK] });
    },
  },
  {
    id: 'C4',
    title: 'Stale database-lock guard whose owner marker cannot be deleted (held FileShare.Read): refused at the database stage; staging cleaned; rerun completes',
    async run(ctx, sc) {
      const fx = await buildFixture(ctx);
      const { target, hold, probe } = await staleShareHeld(ctx, sc, fx, 'db-guard');
      const { A, conf } = await dryThenConfirm(ctx, sc, fx, { staleListed: [DB_GUARD] });
      record(sc, 'confirmed', conf, ctx);
      if (probe.effective) checkAcqRefusal(A, 'confirmed', fx, conf, { role: 'database lock', cause: /EBUSY/, causePath: target, held: 'removed' });
      await hold.kill();
      const rerun = await runReset(ctx, fx, [...CONFIRM, fx.data]);
      rerun.fxEnv = fx.env;
      record(sc, 'rerun', rerun, ctx);
      checkComplete(A, 'rerun', fx, rerun, { reclaimed: [DB_GUARD] });
    },
  },
  {
    id: 'C5',
    title: 'Primary refusal plus cleanup failure: C3 fault, and the reset\'s own graphgoblin.lock held exclusively once created, so its release fails; rerun completes',
    async run(ctx, sc) {
      const fx = await buildFixture(ctx);
      const { target, hold, probe } = await staleShareHeld(ctx, sc, fx, 'db-lock');
      let spin;
      const { A, conf } = await dryThenConfirm(ctx, sc, fx, { staleListed: [DB_LOCK] }, async () => {
        spin = await spinHold(ctx, join(fx.data, DIR_LOCK));
      });
      const heldMsg = spin.messages.find((m) => m.held === true);
      const won = !!heldMsg && heldMsg.at <= conf.res.ended;
      sc.setup = { ...sc.setup, spinPid: spin.pid, spinHeld: heldMsg ?? null, spinMessages: spin.messages, resetStarted: conf.res.started, resetEnded: conf.res.ended };
      record(sc, 'confirmed', conf, ctx, { raceWon: won });
      A('confirmed', 'racePreconditionWon', 'precondition', 'CTL', won, 'spin helper held graphgoblin.lock before the reset exited', heldMsg ?? spin.messages);
      if (probe.effective && won) {
        checkAcqRefusal(A, 'confirmed', fx, conf, { role: 'database lock', cause: /EBUSY/, causePath: target, held: 'failed', allowedDiff: [`data/${DIR_LOCK}`] });
        const failLine = conf.e.releases.find((x) => x.outcome === 'failed');
        A('confirmed', 'cleanupFailureCauseNamed', 'correction', 'AC2', !!failLine && /EBUSY/.test(failLine.detail ?? '') && (failLine.detail ?? '').includes(join(fx.data, DIR_LOCK)), `could not remove ${DIR_LOCK} (data-directory lock): EBUSY ... ${DIR_LOCK}`, failLine?.line ?? null);
        A('confirmed', 'noRemovedClaimForLeftLock', 'correction', 'AC2', !/removed graphgoblin\.lock\b/.test(conf.res.err), `never "removed ${DIR_LOCK}"`, conf.res.err);
      } else {
        for (const id of ['refusalChecks']) A('confirmed', id, 'correction', 'ACQ', null, 'precondition not met', { probe, won });
      }
      await spin.kill();
      await hold.kill();
      const left = existsSync(join(fx.data, DIR_LOCK)) ? JSON.parse(readFileSync(join(fx.data, DIR_LOCK), 'utf8')) : null;
      sc.setup.leftDirLockRecordPidIsResetPid = left ? left.pid === conf.res.pid : null;
      A('confirmed', 'leftDirLockIsResetsOwnRecord', 'observation', 'AC2',!won || (left !== null && left.pid === conf.res.pid), 'the graphgoblin.lock left behind names the reset process', left ? { pid: left.pid, resetPid: conf.res.pid } : null);
      const rerun = await runReset(ctx, fx, [...CONFIRM, fx.data]);
      rerun.fxEnv = fx.env;
      record(sc, 'rerun', rerun, ctx);
      checkComplete(A, 'rerun', fx, rerun, { reclaimed: won ? [DIR_LOCK, DB_LOCK] : [DB_LOCK] });
    },
  },
  {
    id: 'C6',
    title: 'Release failure of the data-directory lock after a complete removal (graphgoblin.lock held exclusively once created); rerun completes',
    async run(ctx, sc) {
      const fx = await buildFixture(ctx);
      let spin;
      const { A, conf } = await dryThenConfirm(ctx, sc, fx, {}, async () => {
        spin = await spinHold(ctx, join(fx.data, DIR_LOCK));
      });
      const heldMsg = spin.messages.find((m) => m.held === true);
      const won = !!heldMsg && heldMsg.at <= conf.res.ended;
      sc.setup = { spinPid: spin.pid, spinHeld: heldMsg ?? null, resetStarted: conf.res.started, resetEnded: conf.res.ended };
      record(sc, 'confirmed', conf, ctx, { raceWon: won });
      A('confirmed', 'racePreconditionWon', 'precondition', 'CTL', won, 'spin helper held graphgoblin.lock before the reset exited', heldMsg ?? spin.messages);
      const run = 'confirmed';
      const pend = (id, kind, crit, pass, exp, act) => A(run, id, kind, crit, won ? pass : null, exp, act);
      const e = conf.e;
      pend('exit1', 'positive', 'CTL', conf.res.code === 1, 1, conf.res.code);
      pend('stoppedHeadline', 'positive', 'AC2', e.first === 'Reset stopped: every listed item was removed, but not every lock file was released:', 'Reset stopped: every listed item was removed, but not every lock file was released:', e.first);
      const dbRel = e.releases.find((x) => x.path === DB_LOCK);
      const dirRel = e.releases.find((x) => x.path === DIR_LOCK);
      pend('dbLockRemovedAndTrue', 'acceptance', 'AC2', dbRel?.outcome === 'removed' && !conf.after.has(`data/${DB_LOCK}`), `removed ${DB_LOCK} (database lock), and it is absent`, dbRel?.line ?? null);
      pend('dirLockFailureNamedAndTrue', 'acceptance', 'AC2', dirRel?.outcome === 'failed' && dirRel.what === 'data-directory lock' && /EBUSY/.test(dirRel.detail ?? '') && conf.after.has(`data/${DIR_LOCK}`), `could not remove ${DIR_LOCK} (data-directory lock): EBUSY..., and it is present`, dirRel?.line ?? null);
      pend('noResetComplete', 'positive', 'AC2', !/Reset complete/.test(conf.res.out), 'no "Reset complete."', conf.res.out.split('\n').slice(-3));
      const storeLeft = [...conf.after.keys()].filter((k) => dataRel(k) && isStoreData(dataRel(k)));
      pend('allStoreDataRemoved', 'positive', 'AC3', storeLeft.length === 0, 'every listed store item removed', storeLeft);
      const keepsGone = conf.m.keeps.filter((k) => !conf.after.has(`data/${k.path}`));
      pend('keepsListIsTruthful', 'acceptance', 'AC1', keepsGone.length === 0, 'every Keeps path survives', keepsGone);
      const foreign = conf.d.removed.filter((k) => !dataRel(k) || !(isStoreData(dataRel(k)) || isLockMeta(dataRel(k))));
      pend('removedOnlyOwned', 'safety', 'AC3', foreign.length === 0, 'only owned removed', foreign);
      pend('onlyDirLockAdded', 'safety', 'AC3', JSON.stringify(conf.d.added) === JSON.stringify([`data/${DIR_LOCK}`]) && conf.d.changed.length === 0, [`data/${DIR_LOCK}`], { added: conf.d.added, changed: conf.d.changed });
      checkUnrelated(A, run, fx, conf);
      await spin.kill();
      const rerun = await runReset(ctx, fx, [...CONFIRM, fx.data]);
      rerun.fxEnv = fx.env;
      record(sc, 'rerun', rerun, ctx);
      const A2 = recorder(sc);
      A2('rerun', 'exit0', 'positive', 'CTL', rerun.res.code === 0, 0, rerun.res.code);
      A2('rerun', 'resetComplete', 'positive', 'DIFF', /^Reset complete\./m.test(rerun.res.out) && rerun.res.err === '', 'Reset complete.', { tail: rerun.res.out.split('\n').slice(-4), err: rerun.res.err });
      if (won) {
        const row = rerun.m.removes.find((x) => x.path === DIR_LOCK);
        A2('rerun', `reclaimed:${DIR_LOCK}:listedStale`, 'acceptance', 'AC1', !!row && /stale/i.test(row.rest), `${DIR_LOCK} under Removes as stale`, row ?? null);
      }
      const leftOwned = [...rerun.after.keys()].filter((k) => dataRel(k) && (isStoreData(dataRel(k)) || isLockMeta(dataRel(k))));
      A2('rerun', 'noOwnedLeft', 'positive', 'AC3', leftOwned.length === 0, 'no store data or lock metadata left', leftOwned);
      A2('rerun', 'bothLockReleasesReported', 'acceptance', 'AC2', rerun.m.removedLines.includes(DB_LOCK) && rerun.m.removedLines.includes(DIR_LOCK), 'both release lines', rerun.m.removedLines);
      checkUnrelated(A2, 'rerun', fx, rerun);
    },
  },
];

// ---------------------------------------------------------------- main
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (existsSync(opts.out)) throw new Error(`refusing to overwrite ${opts.out}`);
  if (!existsSync(join(opts.checkout, 'apps', 'api', 'dist', 'main.js'))) throw new Error('the checkout has no built apps/api/dist/main.js');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runRoot = join(SCRATCH, 'runs', `${opts.label}-${stamp}`);
  if (!inside(join(SCRATCH, 'runs'), runRoot)) throw new Error('run folder escaped the scratch folder');
  await mkdir(runRoot, { recursive: true });
  const results = {
    schema: 'gg-434-acquisition-controls-qa/v1',
    issue: 434,
    label: opts.label,
    evidenceSource: 'continuation session: independent real execution (not part of the original run1)',
    startedAt: new Date().toISOString(),
    provenanceBefore: await provenance(opts.checkout, opts.expectHead),
    method: {
      entrypoint: 'node <checkout>/apps/api/dist/main.js --reset [--yes] --data-dir <fixture>/data (separate process, real built CLI)',
      isolation: 'minimal child env; GG_DATA_DIR always a fixture; USERPROFILE/HOME/TEMP/TMP/APPDATA/LOCALAPPDATA inside the run folder',
      nativeFaults: {
        hardLink: 'fs.link of the fixture database; the lock module refuses nlink > 1',
        shareRead: 'powershell.exe [System.IO.File]::Open(path, Open, Read, FileShare.Read) on a stale record: readable, deletion fails with a sharing violation',
        spinExlock: 'node spin-exlock.mjs: synchronous retry of open(O_RDONLY|UV_FS_O_EXLOCK) until the reset creates graphgoblin.lock (timing precondition recorded)',
        staleRecords: 'produced by ../driver/holder.mjs (unchanged) with the checkout\'s built lock code, then SIGKILL',
        injectedIntoProduct: 'none',
      },
      kinds: {
        correction: 'behaviour the dc65a24 correction states for an acquisition-stage refusal (CHANGELOG, reset-acquisition.test.ts contract)',
        acceptance: '#434 acceptance criterion',
        safety: 'no unrelated or unowned change',
        positive: 'existing documented behaviour / control',
        precondition: 'fixture precondition; dependent assertions are not-run when it fails',
        observation: 'recorded fact outside #434 scope',
      },
      criteria: {
        AC1: 'Dry-run and confirmed manifests accurately classify the database lock and its .reclaim guard',
        AC2: 'Completion and failure messages identify directory and database locks accurately',
        AC3: 'Confirmed runs preserve unrelated files; only owned metadata/content is removed',
        ACQ: 'Acquisition-stage refusal: names the stage, never claims nothing changed, reports the failed lock file/guard now vs before and the held lock release',
        CTL: 'held/failure/refusal controls',
        DIFF: 'expected dry-run vs confirmed differences',
      },
    },
    scenarios: [],
  };
  const procsAll = [];
  try {
    const seedRoot = join(runRoot, 'seed');
    for (const dir of ['seed-tmp', 'seed-home']) await mkdir(join(runRoot, dir), { recursive: true });
    const seed = await runNode(
      [join(ORIGINAL_DRIVER_DIR, 'seed-store.mjs'), opts.checkout, join(seedRoot, 'staging'), join(seedRoot, 'current'), RUN_IDS.join(',')],
      childEnv({ temp: join(runRoot, 'seed-tmp'), home: join(runRoot, 'seed-home') }),
      runRoot,
    );
    if (seed.code !== 0 || seed.out !== 'seeded') throw new Error(`store seeding failed: ${seed.code} ${seed.out} ${seed.err}`);
    for (const scenario of SCENARIOS) {
      if (opts.only && !opts.only.includes(scenario.id)) continue;
      const base = join(runRoot, scenario.id);
      const ctx = { checkout: opts.checkout, base, fixture: join(base, 'fixture'), temp: join(base, 'env', 'tmp'), home: join(base, 'env', 'home'), seed: join(seedRoot, 'current'), procs: [] };
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
        for (const p of ctx.procs) await p.kill();
        procsAll.push(...ctx.procs);
        sc.helperExits = ctx.procs.map((p) => ({ name: p.name, pid: p.pid, exit: p.exited() }));
      }
      const f = sc.assertions.filter((a) => a.outcome === 'fail').length;
      const nr = sc.assertions.filter((a) => a.outcome === 'not-run').length;
      process.stdout.write(`  ${sc.assertions.length} assertions, ${f} failed, ${nr} not-run\n`);
    }
  } finally {
    for (const p of procsAll) await p.kill();
  }
  const all = results.scenarios.flatMap((s) => s.assertions);
  const tally = (list) => ({ total: list.length, pass: list.filter((a) => a.outcome === 'pass').length, fail: list.filter((a) => a.outcome === 'fail').length, notRun: list.filter((a) => a.outcome === 'not-run').length });
  results.totals = {
    all: tally(all),
    byKind: Object.fromEntries(['correction', 'acceptance', 'safety', 'positive', 'precondition', 'observation'].map((k) => [k, tally(all.filter((a) => a.kind === k))])),
    byCriterion: Object.fromEntries(['AC1', 'AC2', 'AC3', 'ACQ', 'CTL', 'DIFF'].map((k) => [k, tally(all.filter((a) => a.criterion === k))])),
    failed: all.filter((a) => a.outcome === 'fail').map((a) => `${a.id} [${a.kind}/${a.criterion}]`),
    notRun: all.filter((a) => a.outcome === 'not-run').map((a) => `${a.id} [${a.kind}/${a.criterion}]`),
  };
  results.provenanceAfter = await provenance(opts.checkout, opts.expectHead);
  results.finishedAt = new Date().toISOString();
  results.fixtures = opts.keep ? `kept at ${runRoot}` : 'deleted after the run (disposable)';
  await mkdir(dirname(opts.out), { recursive: true });
  await writeFile(opts.out, JSON.stringify(results, null, 1), { flag: 'wx' });
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
