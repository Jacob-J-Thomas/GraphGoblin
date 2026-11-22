// D215 independent criterion QA runner (Opus 5.5). Phased so that every phase finishes well inside
// one tool call; the baseline swap is restored in `finally` and re-verified by every later phase.
// Usage: node runner.mjs <phase> [scenario]
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EVID = 'G:\\ggq\\delivery-evidence\\2026-11-17-five-intents\\i4-486-d215-independent-01';
const QA = path.join(EVID, 'qa');
const RAW = path.join(QA, 'raw');
const OBSERVER = path.join(QA, 'tools', 'child-observer.cjs');
const REPO = 'G:\\ggq\\gg-i4-486-d215-qa\\GraphGoblin';
const PKG = path.join(REPO, 'packages', 'infrastructure');
const TEST_REL = 'packages/infrastructure/src/fs/fs.test.ts';
const FIXTURE = path.join(REPO, ...TEST_REL.split('/'));
const BASE_BLOB = path.join(EVID, 'baseline-fs.test.ts');
const CAND_BLOB = path.join(EVID, 'candidate-fs.test.ts');
const NODE_DIR =
  'C:\\Users\\98jak\\.claude\\codex-runs\\GraphGoblin\\runtime\\node-v22.23.4-win-x64';
const SCRATCH = 'G:\\ggq\\qa-scratch\\i4-486-d215-independent-01';
const COMPILE_CACHE = path.join(SCRATCH, 'node-compile-cache');
const C_PARENT = 'C:\\Users\\98jak\\graphgoblin-qa';
const STATE = path.join(RAW, 'state.json');
const HEAD = '6de50cb8e22b92bfed5d6fe7bf14a2a10b95cd08';
const TREE = '34b80f155c8434abc69fc72105ae7462fc460377';
const BASE = 'b8126de18080b76b15cbbbbc00fd791030fec3e1';
const BASE_TREE = '86f422bb091515defe3d612df660988e5b47ffeb';
const BINDING = JSON.parse(fs.readFileSync(path.join(EVID, 'source-binding.json'), 'utf8'));
const BASE_SHA = BINDING.baselineFixture.sha256;
const CAND_SHA = BINDING.correctedFixture.sha256;

const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const record = (p) => {
  const b = fs.readFileSync(p);
  return { source: p, bytes: b.length, sha256: sha(b) };
};
const need = (ok, why) => {
  if (!ok) throw new Error('QA precondition failed: ' + why);
};
const now = () => new Date().toISOString();
const writeNew = (name, data) => {
  const p = path.join(RAW, name);
  const body =
    typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data, null, 2) + '\n';
  fs.writeFileSync(p, body, { flag: 'wx' });
  return p;
};
const event = (rec) =>
  fs.appendFileSync(
    path.join(RAW, 'runner-events.jsonl'),
    JSON.stringify({ t: now(), pid: process.pid, ...rec }) + '\n',
  );
const loadState = () => (fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {});
const saveState = (s) => fs.writeFileSync(STATE, JSON.stringify(s, null, 2) + '\n');
const exists = (p) => {
  try {
    fs.lstatSync(p);
    return true;
  } catch (e) {
    if (e.code === 'ENOENT') return false;
    throw e;
  }
};
const ident = (p, follow = false) => {
  const s = follow ? fs.statSync(p, { bigint: true }) : fs.lstatSync(p, { bigint: true });
  return {
    dev: String(s.dev),
    ino: String(s.ino),
    birthtimeNs: String(s.birthtimeNs),
    isSymbolicLink: s.isSymbolicLink(),
    isDirectory: s.isDirectory(),
  };
};
const dev = (p) => String(fs.statSync(p, { bigint: true }).dev);
const capacity = (p) => {
  const s = fs.statfsSync(p, { bigint: true });
  return {
    path: p,
    bsize: String(s.bsize),
    freeBytes: String(s.bavail * s.bsize),
    totalBytes: String(s.blocks * s.bsize),
  };
};
const walk = (dir, limit = 400) => {
  const out = [];
  const visit = (p, rel) => {
    for (const name of fs.readdirSync(p).sort()) {
      if (out.length >= limit) return;
      const full = path.join(p, name);
      const r = rel ? rel + '\\' + name : name;
      const s = fs.lstatSync(full);
      const type = s.isSymbolicLink()
        ? 'link'
        : s.isDirectory()
          ? 'dir'
          : s.isFile()
            ? 'file'
            : 'other';
      out.push({ rel: r, type, bytes: s.isFile() ? s.size : 0 });
      if (type === 'dir') visit(full, r);
    }
  };
  visit(dir, '');
  return out;
};
const leftovers = () => fs.readdirSync(PKG).filter((n) => n.startsWith('gg-wp-relative-'));

const envValue = (name) => {
  const key = Object.keys(process.env).find((k) => k.toUpperCase() === name);
  return key ? process.env[key] : undefined;
};
function childEnv(temp, extra = {}) {
  const override = {
    PATH: NODE_DIR + ';' + envValue('PATH'),
    TEMP: temp,
    TMP: temp,
    NODE_COMPILE_CACHE: COMPILE_CACHE,
    GIT_OPTIONAL_LOCKS: '0',
    PNPM_DISABLE_SELF_UPDATE_CHECK: '1',
    TURBO_TELEMETRY_DISABLED: '1',
    npm_config_update_notifier: 'false',
    NO_COLOR: '1',
    ...extra,
  };
  const drop = new Set(Object.keys(override).map((k) => k.toUpperCase()));
  const out = {};
  for (const [k, v] of Object.entries(process.env)) {
    const u = k.toUpperCase();
    if (drop.has(u) || u === 'NODE_OPTIONS' || u.startsWith('QA_D215_')) continue;
    out[k] = v;
  }
  return { ...out, ...override };
}
const ENV_KEYS = [
  'TEMP',
  'TMP',
  'NODE_COMPILE_CACHE',
  'NODE_OPTIONS',
  'QA_D215_LOG',
  'QA_D215_FIXTURE',
  'QA_D215_TAP',
  'QA_D215_OLD_CONTROL',
  'QA_D215_WORKER_TEMP',
  'GIT_OPTIONAL_LOCKS',
  'PNPM_DISABLE_SELF_UPDATE_CHECK',
  'TURBO_TELEMETRY_DISABLED',
  'npm_config_update_notifier',
  'NO_COLOR',
];
const envSubset = (env) => ({
  ...Object.fromEntries(ENV_KEYS.filter((k) => k in env).map((k) => [k, env[k]])),
  PATHFirst: env.PATH.split(';')[0],
});

function git(...args) {
  return execFileSync(
    'git',
    ['-c', 'maintenance.auto=false', '-c', 'gc.auto=0', '--no-optional-locks', ...args],
    {
      cwd: REPO,
      env: childEnv(process.env.TEMP),
      maxBuffer: 512 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
}
// Read-only ignored listing; git cannot descend pnpm's nested workspace junction chains past
// MAX_PATH and warns per directory, so stderr is counted rather than echoed.
function ignoredListing() {
  const r = spawnSync(
    'git',
    [
      '-c',
      'maintenance.auto=false',
      '-c',
      'gc.auto=0',
      '--no-optional-locks',
      'status',
      '--porcelain=v1',
      '-z',
      '--ignored=traditional',
      '--untracked-files=normal',
    ],
    { cwd: REPO, env: childEnv(process.env.TEMP), maxBuffer: 512 * 1024 * 1024 },
  );
  const warnings = String(r.stderr).split('\n').filter(Boolean);
  return {
    exit: r.status,
    entries: String(r.stdout).split('\0').filter(Boolean),
    stderrLines: warnings.length,
    stderrFilenameTooLong: warnings.filter((l) => l.includes('Filename too long')).length,
  };
}
function snapshot() {
  const index = git('rev-parse', '--path-format=absolute', '--git-path', 'index').toString().trim();
  return {
    head: git('rev-parse', 'HEAD').toString().trim(),
    tree: git('rev-parse', 'HEAD^{tree}').toString().trim(),
    parent: git('rev-parse', 'HEAD^').toString().trim(),
    status: git('status', '--porcelain=v1', '-z', '--untracked-files=all').toString(),
    index: record(path.resolve(index)),
    trackedIndexSha256: sha(git('ls-files', '--stage', '-z')),
    fixture: record(FIXTURE),
    lock: record(path.join(REPO, 'pnpm-lock.yaml')),
  };
}
function compareToBinding(snap) {
  const b = BINDING.sourceBeforeQA;
  return {
    head: snap.head === b.head,
    tree: snap.tree === b.tree,
    parent: snap.parent === b.parent,
    statusEmpty: snap.status === '' && b.status === '',
    indexBytesAndSha: snap.index.bytes === b.index.bytes && snap.index.sha256 === b.index.sha256,
    trackedIndexSha256: snap.trackedIndexSha256 === b.trackedIndexSha256,
    fixture: snap.fixture.bytes === b.fixture.bytes && snap.fixture.sha256 === b.fixture.sha256,
    lock: snap.lock.bytes === b.lock.bytes && snap.lock.sha256 === b.lock.sha256,
  };
}

async function invoke({ id, command, cwd = REPO, env, timeoutMs = 240_000, watch = [] }) {
  const stdoutPath = path.join(RAW, `${id}.stdout.txt`);
  const stderrPath = path.join(RAW, `${id}.stderr.txt`);
  const out = fs.openSync(stdoutPath, 'wx');
  const err = fs.openSync(stderrPath, 'wx');
  const watchers = watch.map(({ label, dir, filter }) => {
    const logPath = path.join(RAW, `${id}.watch-${label}.jsonl`);
    fs.writeFileSync(logPath, '', { flag: 'wx' });
    const append = (rec) => fs.appendFileSync(logPath, JSON.stringify({ t: now(), ...rec }) + '\n');
    const w = fs.watch(dir, { recursive: true }, (eventType, filename) => {
      if (!filename || (filter && !filter(filename))) return;
      let state;
      try {
        const s = fs.lstatSync(path.join(dir, filename));
        state = s.isSymbolicLink()
          ? 'link'
          : s.isDirectory()
            ? 'dir'
            : s.isFile()
              ? `file:${s.size}`
              : 'other';
      } catch {
        state = 'absent';
      }
      append({ eventType, filename, stateAtEvent: state });
    });
    w.on('error', (e) => append({ watcherError: String(e) }));
    return { label, dir, logPath, w };
  });
  const started = now();
  event({ kind: 'invoke-start', id, command, cwd, env: envSubset(env) });
  const child = spawn(command, {
    cwd,
    env,
    shell: true,
    stdio: ['ignore', out, err],
    windowsHide: true,
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)]);
  }, timeoutMs);
  const [exitCode, signal, spawnError] = await new Promise((resolve) => {
    child.on('error', (e) => resolve([null, null, String(e)]));
    child.on('exit', (c, s) => resolve([c, s, null]));
  });
  clearTimeout(timer);
  await new Promise((r) => setTimeout(r, 750));
  for (const w of watchers) w.w.close();
  fs.closeSync(out);
  fs.closeSync(err);
  const rec = {
    id,
    command,
    cwd,
    started,
    ended: now(),
    exitCode,
    signal,
    spawnError,
    timedOut,
    timeoutMs,
    env: envSubset(env),
    stdout: record(stdoutPath),
    stderr: record(stderrPath),
    watchers: watchers.map(({ label, dir, logPath }) => ({ label, dir, log: record(logPath) })),
  };
  writeNew(`${id}.invocation.json`, rec);
  event({ kind: 'invoke-end', id, exitCode, timedOut, spawnError });
  return rec;
}

function observedEnv(id, temp, { tap = false, oldControl = false, workerTemp } = {}) {
  const log = path.join(RAW, `${id}.child.jsonl`);
  fs.writeFileSync(log, '', { flag: 'wx' });
  return childEnv(temp, {
    NODE_OPTIONS: `--require=${OBSERVER.replaceAll('\\', '/')}`,
    QA_D215_LOG: log,
    QA_D215_FIXTURE: FIXTURE,
    QA_D215_TAP: tap ? '1' : '0',
    ...(oldControl ? { QA_D215_OLD_CONTROL: '1' } : {}),
    ...(workerTemp ? { QA_D215_WORKER_TEMP: workerTemp } : {}),
  });
}
const vitestCommand = (id, name) =>
  [
    'pnpm.cmd',
    '--filter',
    '@graphgoblin/infrastructure',
    'exec',
    'vitest',
    'run',
    'src/fs/fs.test.ts',
    ...(name ? ['-t', `"${name}"`] : []),
    '--reporter=verbose',
    '--reporter=json',
    `--outputFile.json=${path.join(RAW, `${id}.vitest.json`).replaceAll('\\', '/')}`,
  ].join(' ');

const SCENARIOS = {
  s1: {
    id: 's1-baseline-ordinary-g-temp-engine-temp',
    fixture: 'baseline',
    temp: 'ordinary',
    name: 'uses real temp paths',
    tap: true,
  },
  s2: {
    id: 's2-baseline-junction-g-temp-engine-temp',
    fixture: 'baseline',
    temp: 'alias',
    name: 'uses real temp paths',
    tap: true,
  },
  s3: {
    id: 's3-corrected-ordinary-g-temp-full-fs-file',
    fixture: 'corrected',
    temp: 'ordinary',
    name: null,
    tap: false,
  },
  s4: {
    id: 's4-corrected-junction-g-temp-engine-temp',
    fixture: 'corrected',
    temp: 'alias',
    name: 'uses real temp paths',
    tap: true,
  },
  s6a: {
    id: 's6a-corrected-junction-g-temp-engine-fixed',
    fixture: 'corrected',
    temp: 'alias',
    name: 'uses real fixed paths',
    tap: true,
  },
  s6b: {
    id: 's6b-corrected-junction-g-temp-engine-template',
    fixture: 'corrected',
    temp: 'alias',
    name: 'uses real template paths',
    tap: true,
  },
  s5a: {
    id: 's5a-corrected-c-temp-adapter-mixed',
    fixture: 'corrected',
    temp: 'cdrive',
    name: 'resolves fixed, relative, and temporary directories',
    tap: true,
    oldControl: true,
  },
  s5b: {
    id: 's5b-corrected-c-temp-engine-relative',
    fixture: 'corrected',
    temp: 'cdrive',
    name: 'uses real relative paths',
    tap: true,
    oldControl: true,
  },
};

async function withBaseline(id, run) {
  const saved = path.join(RAW, 'saved-corrected-fs.test.ts');
  const current = fs.readFileSync(FIXTURE);
  need(sha(current) === CAND_SHA, 'working fixture is not the corrected blob before swap');
  if (!exists(saved)) writeNew('saved-corrected-fs.test.ts', current);
  const corrected = fs.readFileSync(saved);
  need(sha(corrected) === CAND_SHA, 'saved corrected bytes differ from the bound blob');
  const baseline = fs.readFileSync(BASE_BLOB);
  need(sha(baseline) === BASE_SHA, 'baseline evidence blob differs from the bound blob');
  const swap = { id, beforeSwap: record(FIXTURE), savedCorrected: record(saved) };
  try {
    fs.writeFileSync(FIXTURE, baseline);
    swap.swapped = record(FIXTURE);
    swap.swappedIsBaseline = swap.swapped.sha256 === BASE_SHA;
    swap.statusDuringSwap = git('status', '--porcelain=v1', '-z', '--untracked-files=all').toString();
    need(swap.swappedIsBaseline, 'swap did not produce the baseline bytes');
    event({ kind: 'baseline-swapped', id, fixture: swap.swapped });
    swap.result = await run();
  } finally {
    fs.writeFileSync(FIXTURE, corrected);
    swap.restored = record(FIXTURE);
    swap.restoredIsCorrected = swap.restored.sha256 === CAND_SHA;
    swap.statusAfterRestore = git('status', '--porcelain=v1', '-z', '--untracked-files=all').toString();
    swap.restoredAt = now();
    writeNew(`${id}.swap.json`, swap);
    event({ kind: 'baseline-restored', id, fixture: swap.restored, ok: swap.restoredIsCorrected });
  }
  need(swap.restoredIsCorrected && swap.statusAfterRestore === '', 'restore failed');
  return swap.result;
}

async function runScenario(key) {
  const sc = SCENARIOS[key];
  need(sc, 'unknown scenario ' + key);
  const st = loadState();
  // cdrive: the vitest main process keeps the ordinary G TEMP (its transformed-module temp stays
  // on G); only the fork worker that executes the tests receives the C TEMP via the observer.
  const isC = sc.temp === 'cdrive';
  const temp = { ordinary: st.ordinary, alias: st.alias, cdrive: st.ordinary }[sc.temp];
  const workerTemp = isC ? st.cdir : undefined;
  need(temp && exists(temp), 'scenario TEMP is missing');
  if (isC) need(workerTemp && exists(workerTemp), 'C worker TEMP is missing');
  const watchDir = sc.temp === 'alias' ? st.physical : isC ? st.cdir : temp;
  const listing = () => ({
    at: now(),
    fixture: record(FIXTURE),
    status: git('status', '--porcelain=v1', '-z', '--untracked-files=all').toString(),
    tempRootListing: walk(watchDir),
    ...(isC ? { mainGTempListing: walk(st.ordinary) } : {}),
    checkoutRelativeLeftovers: leftovers(),
  });
  const pre = listing();
  need(pre.fixture.sha256 === CAND_SHA, 'working fixture must be corrected at scenario start');
  need(pre.status === '', 'checkout must be clean at scenario start');
  const env = observedEnv(sc.id, temp, { ...sc, workerTemp });
  const run = () =>
    invoke({
      id: sc.id,
      command: vitestCommand(sc.id, sc.name),
      env,
      watch: [
        { label: 'temp-physical-root', dir: watchDir },
        ...(isC ? [{ label: 'main-g-temp', dir: st.ordinary }] : []),
        { label: 'checkout-package', dir: PKG, filter: (n) => n.startsWith('gg-wp-relative-') },
      ],
    });
  const result = sc.fixture === 'baseline' ? await withBaseline(sc.id, run) : await run();
  const post = listing();
  writeNew(`${sc.id}.prepost.json`, {
    scenario: { key, ...sc },
    temp,
    workerTemp,
    watchDir,
    pre,
    post,
  });
  console.log(JSON.stringify({ id: sc.id, exitCode: result.exitCode, timedOut: result.timedOut }));
}

function preflight() {
  if (!exists(RAW)) fs.mkdirSync(RAW);
  const base = record(BASE_BLOB);
  const cand = record(CAND_BLOB);
  const blobIds = {
    baselineEvidenceHashObject: git('hash-object', BASE_BLOB).toString().trim(),
    candidateEvidenceHashObject: git('hash-object', CAND_BLOB).toString().trim(),
    baselineGitBlob: git('rev-parse', `${BASE}:${TEST_REL}`).toString().trim(),
    candidateGitBlob: git('rev-parse', `${HEAD}:${TEST_REL}`).toString().trim(),
  };
  const diffRaw = git('diff', '--raw', '--no-renames', '-z', BASE, HEAD).toString();
  const diffEntries = diffRaw.split('\0').filter(Boolean);
  const lsBase = git('ls-tree', '-r', '-z', '--full-tree', BASE).toString().split('\0').filter(Boolean);
  const lsHead = git('ls-tree', '-r', '-z', '--full-tree', HEAD).toString().split('\0').filter(Boolean);
  const headSet = new Set(lsHead);
  const differing = lsBase.filter((e) => !headSet.has(e)).map((e) => e.split('\t')[1]);
  const snap = snapshot();
  const cmp = compareToBinding(snap);
  const modules = record(path.join(REPO, 'node_modules', '.modules.yaml'));
  const pnpmVersion = spawnSync('pnpm.cmd --version', {
    shell: true,
    cwd: REPO,
    env: childEnv(process.env.TEMP),
  });
  const pre = {
    at: now(),
    runner: { pid: process.pid, node: process.version, execPath: process.execPath },
    platform: {
      type: os.type(),
      release: os.release(),
      version: os.version(),
      arch: os.arch(),
      hostname: os.hostname(),
    },
    gitVersion: execFileSync('git', ['--version']).toString().trim(),
    pnpmVersion: { status: pnpmVersion.status, stdout: String(pnpmVersion.stdout).trim() },
    fixtures: {
      baseline: base,
      candidate: cand,
      baselineMatchesBinding: base.sha256 === BASE_SHA && base.bytes === BINDING.baselineFixture.bytes,
      candidateMatchesBinding: cand.sha256 === CAND_SHA && cand.bytes === BINDING.correctedFixture.bytes,
      blobIds,
    },
    productionIdentity: {
      headParentIsBase: snap.parent === BASE,
      baseTree: git('rev-parse', `${BASE}^{tree}`).toString().trim(),
      diffEntries,
      lsTreeEntriesBase: lsBase.length,
      lsTreeEntriesHead: lsHead.length,
      entriesDifferingFromBase: differing,
      lockBlobBase: git('rev-parse', `${BASE}:pnpm-lock.yaml`).toString().trim(),
      lockBlobHead: git('rev-parse', `${HEAD}:pnpm-lock.yaml`).toString().trim(),
      workingTreeCleanAgainstHead: snap.status === '',
      dependencyMetadata: modules,
      dependencyMetadataMatchesBinding: modules.sha256 === BINDING.dependencyMetadata.sha256,
    },
    sourceBefore: snap,
    sourceBeforeMatchesBinding: cmp,
    ignoredBefore: git('status', '--porcelain=v1', '-z', '--ignored=traditional', '--untracked-files=normal')
      .toString()
      .split('\0')
      .filter(Boolean),
    volumes: { cDev: dev('C:\\'), gDev: dev('G:\\') },
    capacity: { c: capacity('C:\\'), g: capacity('G:\\') },
  };
  writeNew('00-preflight.json', pre);
  need(pre.fixtures.baselineMatchesBinding && pre.fixtures.candidateMatchesBinding, 'fixture blobs');
  need(
    blobIds.baselineEvidenceHashObject === blobIds.baselineGitBlob &&
      blobIds.candidateEvidenceHashObject === blobIds.candidateGitBlob,
    'evidence blobs are not the git blobs',
  );
  need(pre.productionIdentity.baseTree === BASE_TREE, 'base tree');
  need(snap.head === HEAD && snap.tree === TREE && snap.parent === BASE, 'head/tree/parent');
  need(
    differing.length === 1 && differing[0] === TEST_REL && lsBase.length === lsHead.length,
    'delta is not exactly fs.test.ts',
  );
  need(Object.values(cmp).every(Boolean), 'source state differs from binding');
  need(pre.productionIdentity.dependencyMetadataMatchesBinding, 'dependency metadata');
  console.log(JSON.stringify({ phase: 'preflight', ok: true, cmp, differing }));
}

async function fixtures() {
  const st = loadState();
  need(!st.root, 'fixtures already created');
  const unique = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
  const root = path.join(SCRATCH, `opus-qa-${unique}`);
  need(!exists(root), 'fixture root exists');
  fs.mkdirSync(root);
  const ordinary = path.join(root, 'ordinary-temp');
  const physical = path.join(root, 'junction-physical');
  const alias = path.join(root, 'junction-alias');
  fs.mkdirSync(ordinary);
  fs.mkdirSync(physical);
  fs.symlinkSync(physical, alias, 'junction');
  const junction = {
    lexical: alias,
    physicalTarget: physical,
    readlink: fs.readlinkSync(alias),
    realpathNative: fs.realpathSync.native(alias),
    realpathJs: fs.realpathSync(alias),
    lstatAlias: ident(alias),
    lstatPhysical: ident(physical),
    statAliasFollowed: ident(alias, true),
    statPhysical: ident(physical, true),
  };
  junction.lexicalDiffersFromPhysical = junction.lexical !== junction.realpathNative;
  junction.reparsePointIdentityDiffers = junction.lstatAlias.ino !== junction.lstatPhysical.ino;
  junction.followedIdentityMatchesTarget =
    junction.statAliasFollowed.ino === junction.statPhysical.ino &&
    junction.statAliasFollowed.dev === junction.statPhysical.dev;
  const dirAL = spawnSync(`dir /AL "${root}"`, { shell: true, encoding: 'utf8' });
  const fsutil = spawnSync('fsutil', ['reparsepoint', 'query', alias], { encoding: 'utf8' });
  const rec = {
    at: now(),
    createdByPid: process.pid,
    unique,
    root: { path: root, identity: ident(root), realpathNative: fs.realpathSync.native(root) },
    ordinary: {
      path: ordinary,
      identity: ident(ordinary),
      realpathNative: fs.realpathSync.native(ordinary),
      lexicalEqualsPhysical: fs.realpathSync.native(ordinary) === ordinary,
    },
    junction,
    nativeDirAL: { status: dirAL.status, stdout: dirAL.stdout, stderr: dirAL.stderr },
    nativeFsutil: { status: fsutil.status, stdout: fsutil.stdout, stderr: fsutil.stderr },
  };
  writeNew('01-fixtures.json', rec);
  need(junction.lstatAlias.isSymbolicLink, 'alias is not a reparse point');
  need(junction.realpathNative === physical, 'alias does not resolve to physical');
  need(junction.lexicalDiffersFromPhysical && junction.reparsePointIdentityDiffers, 'identities');
  need(rec.ordinary.lexicalEqualsPhysical, 'ordinary TEMP is not lexical==physical');
  saveState({
    unique,
    root,
    ordinary,
    physical,
    alias,
    identities: {
      root: rec.root.identity,
      ordinary: rec.ordinary.identity,
      physical: junction.lstatPhysical,
      alias: junction.lstatAlias,
    },
  });
  // Argument-passing probe through the same pnpm.cmd -> pnpm exec path, with the observer loaded.
  const probeId = 'p0-pnpm-exec-argv-probe';
  const probe = await invoke({
    id: probeId,
    command:
      'pnpm.cmd --filter @graphgoblin/infrastructure exec node -p "JSON.stringify({argv:process.argv.slice(1),version:process.version,execPath:process.execPath,cwd:process.cwd()})" "uses real temp paths" "resolves fixed, relative, and temporary directories"',
    env: observedEnv(probeId, ordinary),
    timeoutMs: 120_000,
  });
  console.log(JSON.stringify({ phase: 'fixtures', root, junction, probeExit: probe.exitCode }));
}

function crossSetup() {
  const st = loadState();
  need(st.unique && !st.cdir, 'cross setup state');
  const parentReal = fs.realpathSync.native(C_PARENT);
  const vol = { cDev: dev('C:\\'), gDev: dev('G:\\'), parentDev: dev(C_PARENT) };
  need(parentReal.toUpperCase().startsWith('C:\\'), 'C parent is not physically on C');
  need(vol.parentDev === vol.cDev && vol.cDev !== vol.gDev, 'C parent volume');
  const cdir = path.join(C_PARENT, `d215-small-native-temp-${st.unique}`);
  need(!exists(cdir), 'C fixture exists');
  const capacityBefore = capacity('C:\\');
  fs.mkdirSync(cdir);
  const rec = {
    at: now(),
    createdByPid: process.pid,
    cdir,
    parentRealpath: parentReal,
    identity: ident(cdir),
    realpathNative: fs.realpathSync.native(cdir),
    dev: dev(cdir),
    volumes: vol,
    capacityBefore,
    capacityAfterCreate: capacity('C:\\'),
  };
  writeNew('20-cross-setup.json', rec);
  need(rec.realpathNative === cdir && rec.dev === vol.cDev, 'C fixture is not a plain C directory');
  saveState({ ...st, cdir, cIdentity: rec.identity });
  console.log(JSON.stringify({ phase: 'cross-setup', cdir, volumes: vol }));
}

function removeOwnedDirectory(label, dir, identity) {
  const out = { label, dir, existedBefore: exists(dir) };
  if (!out.existedBefore) return out;
  const id = ident(dir);
  out.identityMatches = id.ino === identity.ino && id.dev === identity.dev && !id.isSymbolicLink;
  need(out.identityMatches, `${label} identity changed`);
  out.listingBeforeRemoval = walk(dir);
  need(
    out.listingBeforeRemoval.every((e) => e.type !== 'link'),
    `${label} contains a link; refusing traversal`,
  );
  if (out.listingBeforeRemoval.length === 0) {
    fs.rmdirSync(dir);
    out.method = 'rmdir (empty, non-recursive)';
  } else {
    fs.rmSync(dir, { recursive: true });
    out.method = 'rm recursive after link-free inventory';
  }
  out.existsAfter = exists(dir);
  return out;
}

function crossCleanup() {
  const st = loadState();
  need(st.cdir, 'no C fixture recorded');
  const rec = { at: now(), ...removeOwnedDirectory('c-temp', st.cdir, st.cIdentity) };
  rec.capacityAfterRemoval = capacity('C:\\');
  rec.cParentEntriesMatchingPrefix = fs
    .readdirSync(C_PARENT)
    .filter((n) => n.startsWith('d215-small-native-temp-'));
  writeNew('29-cross-cleanup.json', rec);
  need(!rec.existsAfter, 'C fixture still exists');
  console.log(JSON.stringify({ phase: 'cross-cleanup', removed: !rec.existsAfter, rec }));
}

async function gates() {
  const st = loadState();
  need(record(FIXTURE).sha256 === CAND_SHA, 'gates require corrected bytes');
  const env = childEnv(st.ordinary);
  const results = [];
  results.push(
    await invoke({
      id: 'g1-infrastructure-typecheck-tests-noemit',
      command: 'pnpm.cmd --filter @graphgoblin/infrastructure exec tsc -p tsconfig.json --pretty false',
      env,
      timeoutMs: 420_000,
    }),
  );
  results.push(
    await invoke({
      id: 'g2-eslint-fs-test',
      command: 'pnpm.cmd --filter @graphgoblin/infrastructure exec eslint src/fs/fs.test.ts',
      env,
      timeoutMs: 300_000,
    }),
  );
  results.push(
    await invoke({
      id: 'g3-prettier-check-fs-test',
      command: `pnpm.cmd exec prettier --check ${TEST_REL}`,
      env,
      timeoutMs: 120_000,
    }),
  );
  const diffCheck = spawnSync(
    'git',
    ['--no-optional-locks', 'diff', '--check', BASE, HEAD, '--', TEST_REL],
    { cwd: REPO, encoding: 'utf8', env },
  );
  writeNew('g4-git-diff-check.json', {
    argv: ['git', '--no-optional-locks', 'diff', '--check', BASE, HEAD, '--', TEST_REL],
    exit: diffCheck.status,
    stdout: diffCheck.stdout,
    stderr: diffCheck.stderr,
  });
  console.log(
    JSON.stringify(
      results.map((r) => ({ id: r.id, exitCode: r.exitCode, timedOut: r.timedOut })).concat({
        id: 'g4',
        exitCode: diffCheck.status,
      }),
    ),
  );
}

// Read-only confirmations that the silent gates actually covered the changed test file.
async function gateCoverage() {
  const st = loadState();
  need(record(FIXTURE).sha256 === CAND_SHA, 'coverage confirmation requires corrected bytes');
  const env = childEnv(st.ordinary);
  const list = await invoke({
    id: 'g1b-typecheck-program-files',
    command: 'pnpm.cmd --filter @graphgoblin/infrastructure exec tsc -p tsconfig.json --listFilesOnly',
    env,
    timeoutMs: 300_000,
  });
  const lint = await invoke({
    id: 'g2b-eslint-fs-test-json',
    command: 'pnpm.cmd --filter @graphgoblin/infrastructure exec eslint --format json src/fs/fs.test.ts',
    env,
    timeoutMs: 300_000,
  });
  const files = fs
    .readFileSync(path.join(RAW, 'g1b-typecheck-program-files.stdout.txt'), 'utf8')
    .split(/\r?\n/)
    .filter(Boolean);
  const lintText = fs.readFileSync(path.join(RAW, 'g2b-eslint-fs-test-json.stdout.txt'), 'utf8');
  const lintJson = JSON.parse(lintText.slice(lintText.indexOf('[')));
  const rec = {
    typecheckProgramFileCount: files.length,
    typecheckProgramIncludesFsTest: files.filter((f) => /packages[\\/]infrastructure[\\/]src[\\/]fs[\\/]fs\.test\.ts$/.test(f)),
    eslintResults: lintJson.map((r) => ({
      filePath: r.filePath,
      errorCount: r.errorCount,
      warningCount: r.warningCount,
      fatalErrorCount: r.fatalErrorCount,
      messages: r.messages,
    })),
    exits: { list: list.exitCode, lint: lint.exitCode },
  };
  writeNew('g-coverage-confirmation.json', rec);
  console.log(JSON.stringify(rec));
}

function cleanup() {
  const st = loadState();
  const rec = { at: now() };
  // Junction first: verify it is the recorded reparse point, then unlink only the link itself.
  if (exists(st.alias)) {
    const a = ident(st.alias);
    const target = fs.readlinkSync(st.alias);
    rec.junction = {
      lstat: a,
      readlink: target,
      matchesRecorded: a.ino === st.identities.alias.ino && a.isSymbolicLink,
      targetMatches: path.resolve(target) === st.physical,
      physicalListingBefore: walk(st.physical),
    };
    need(rec.junction.matchesRecorded && rec.junction.targetMatches, 'junction verification');
    fs.unlinkSync(st.alias);
    rec.junction.method = 'fs.unlinkSync on the reparse point (no traversal)';
    rec.junction.existsAfter = exists(st.alias);
    rec.junction.physicalStillPresentAfterUnlink = exists(st.physical);
    rec.junction.physicalIdentityAfterUnlink = ident(st.physical);
  }
  rec.physical = removeOwnedDirectory('junction-physical', st.physical, st.identities.physical);
  rec.ordinary = removeOwnedDirectory('ordinary-temp', st.ordinary, st.identities.ordinary);
  rec.root = removeOwnedDirectory('fixture-root', st.root, st.identities.root);
  rec.scratchListingAfter = fs.readdirSync(SCRATCH);
  writeNew('40-cleanup.json', rec);
  console.log(JSON.stringify({ phase: 'cleanup', rec }));
}

function after() {
  const snap = snapshot();
  const rec = {
    at: now(),
    sourceAfter: snap,
    sourceAfterMatchesBinding: compareToBinding(snap),
    checkoutRelativeLeftovers: leftovers(),
    dependencyMetadata: record(path.join(REPO, 'node_modules', '.modules.yaml')),
    ignoredAfter: ignoredListing(),
    capacity: { c: capacity('C:\\'), g: capacity('G:\\') },
    cParentEntriesMatchingPrefix: fs
      .readdirSync(C_PARENT)
      .filter((n) => n.startsWith('d215-small-native-temp-')),
  };
  rec.dependencyMetadataMatchesBinding = rec.dependencyMetadata.sha256 === BINDING.dependencyMetadata.sha256;
  writeNew('50-after.json', rec);
  console.log(
    JSON.stringify({
      phase: 'after',
      cmp: rec.sourceAfterMatchesBinding,
      leftovers: rec.checkoutRelativeLeftovers,
      deps: rec.dependencyMetadataMatchesBinding,
    }),
  );
}

const phase = process.argv[2];
const arg = process.argv[3];
const phases = {
  preflight,
  fixtures,
  scenario: () => runScenario(arg),
  'cross-setup': crossSetup,
  'cross-cleanup': crossCleanup,
  gates,
  'gate-coverage': gateCoverage,
  cleanup,
  after,
};
try {
  need(phases[phase], 'unknown phase ' + phase);
  if (exists(RAW)) event({ kind: 'phase-start', phase, arg });
  await phases[phase]();
  event({ kind: 'phase-end', phase, arg });
} catch (error) {
  if (exists(RAW)) event({ kind: 'phase-error', phase, arg, error: String(error?.stack ?? error) });
  console.error(error);
  process.exitCode = 1;
}
