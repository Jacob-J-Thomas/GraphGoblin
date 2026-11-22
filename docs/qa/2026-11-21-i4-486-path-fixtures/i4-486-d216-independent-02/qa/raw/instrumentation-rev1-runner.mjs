// D216 independent native-path QA runner (Opus 5.5, attempt02). Derived from the verified D215
// reference runner (reference-tools/runner.mjs, sha256 4242bdec...). Changes: new packet/checkout/
// head bindings; no git-status-ignored listing; D216 matrix (uppercase G TEMP, genuine 8.3 C
// TEMP, ordinary, junction, worker-only C long TEMP); uninstrumented resolver probes; explicit
// instrumentation mode per invocation. The observer is the byte-exact reference child-observer.cjs.
// Usage: node runner.mjs <phase> [scenario]
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EVID = 'G:\\ggq\\delivery-evidence\\2026-11-17-five-intents\\i4-486-d216-independent-02';
const QA = path.join(EVID, 'qa');
const RAW = path.join(QA, 'raw');
const TOOLS = path.join(QA, 'tools');
const OBSERVER = path.join(TOOLS, 'child-observer.cjs');
const OBSERVER_SHA = '62a5a655b8e1ef75d6ca60eeede029c20c3a45bd77376c0cfa0127d8da73814d';
const PROBE = path.join(TOOLS, 'realpath-probe.mjs');
const REPO = 'G:\\ggq\\gg-i4-486-d216-qa\\GraphGoblin';
const PKG = path.join(REPO, 'packages', 'infrastructure');
const TEST_REL = 'packages/infrastructure/src/fs/fs.test.ts';
const FIXTURE = path.join(REPO, ...TEST_REL.split('/'));
const BASE_BLOB = path.join(EVID, 'baseline-fs.test.ts');
const CAND_BLOB = path.join(EVID, 'candidate-fs.test.ts');
const NODE_DIR =
  'C:\\Users\\98jak\\.claude\\codex-runs\\GraphGoblin\\runtime\\node-v22.23.4-win-x64';
const SCRATCH = 'G:\\ggq\\qa-scratch\\i4-486-d216-independent-02';
const COMPILE_CACHE = path.join(SCRATCH, 'node-compile-cache');
const C_PARENT = 'C:\\Users\\98jak\\graphgoblin-qa';
const C_PREFIX = 'd216-small-native-temp-';
const STATE = path.join(RAW, 'state.json');
const HEAD = 'e630bb83679bdb055bdd90d2b30e25fbf60571ac';
const TREE = '0713eef9779a14e68b8ca0461f784538ba116c9f';
const BASE = '6de50cb8e22b92bfed5d6fe7bf14a2a10b95cd08';
const BASE_TREE = '34b80f155c8434abc69fc72105ae7462fc460377';
const BINDING = JSON.parse(fs.readFileSync(path.join(EVID, 'source-binding.json'), 'utf8'));
const BASE_SHA = BINDING.baselineFixture.sha256;
const CAND_SHA = BINDING.correctedFixture.sha256;
const THREE_CASE = 'uses real [ft][ie][xm]'; // fixed|temp|template, excludes relative (regex, no pipe)

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
const gitStatus = () => git('status', '--porcelain=v1', '-z', '--untracked-files=all').toString();
function snapshot() {
  const index = git('rev-parse', '--path-format=absolute', '--git-path', 'index').toString().trim();
  return {
    head: git('rev-parse', 'HEAD').toString().trim(),
    tree: git('rev-parse', 'HEAD^{tree}').toString().trim(),
    parent: git('rev-parse', 'HEAD^').toString().trim(),
    status: gitStatus(),
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
  need(record(OBSERVER).sha256 === OBSERVER_SHA, 'observer bytes differ from the bound reference');
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

function observedEnv(id, temp, { tap = false, workerTemp } = {}) {
  const log = path.join(RAW, `${id}.child.jsonl`);
  fs.writeFileSync(log, '', { flag: 'wx' });
  return childEnv(temp, {
    NODE_OPTIONS: `--require=${OBSERVER.replaceAll('\\', '/')}`,
    QA_D215_LOG: log,
    QA_D215_FIXTURE: FIXTURE,
    QA_D215_TAP: tap ? '1' : '0',
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

// Uninstrumented resolver probe: node.exe directly (no shell, no NODE_OPTIONS, no observer).
function probe(id, label, input, temp) {
  const env = childEnv(temp);
  const argv = [PROBE, label, input];
  const r = spawnSync(path.join(NODE_DIR, 'node.exe'), argv, {
    cwd: REPO,
    env,
    encoding: 'utf8',
    windowsHide: true,
  });
  writeNew(`${id}.stdout.json`, r.stdout ?? '');
  writeNew(`${id}.stderr.txt`, r.stderr ?? '');
  const rec = {
    id,
    argv: [path.join(NODE_DIR, 'node.exe'), ...argv],
    instrumentation: 'uninstrumented (no NODE_OPTIONS/--require)',
    env: envSubset(env),
    exit: r.status,
    stdout: record(path.join(RAW, `${id}.stdout.json`)),
    stderr: record(path.join(RAW, `${id}.stderr.txt`)),
  };
  writeNew(`${id}.invocation.json`, rec);
  need(r.status === 0, `probe ${id} failed`);
  return JSON.parse(r.stdout);
}

// Instrumentation modes: 'record-only' loads the byte-exact observer with QA_D215_TAP=0 (one
// process record per Node child; no builtin is wrapped). 'passthrough-tapped' sets QA_D215_TAP=1
// (vitest processes wrap path.relative/resolve, fs.mkdtempSync and JS fs.realpathSync, each
// calling the original and returning its result unchanged; fs.realpathSync.native stays the
// original builtin property, reference observer line 159).
const SCENARIOS = {
  s1a: {
    id: 's1a-baseline6de-upper-g-temp-engine-temp-recordonly',
    criterion: 1,
    fixture: 'baseline',
    temp: 'upper',
    name: 'uses real temp paths',
    tap: false,
  },
  s1b: {
    id: 's1b-candidate-e630-upper-g-temp-engine-temp-recordonly',
    criterion: 1,
    fixture: 'corrected',
    temp: 'upper',
    name: 'uses real temp paths',
    tap: false,
  },
  s2a: {
    id: 's2a-baseline6de-c-short-temp-engine-fixed-temp-template-recordonly',
    criterion: 2,
    fixture: 'baseline',
    temp: 'cshort',
    name: THREE_CASE,
    tap: false,
  },
  s2b: {
    id: 's2b-candidate-e630-c-short-temp-engine-fixed-temp-template-recordonly',
    criterion: 2,
    fixture: 'corrected',
    temp: 'cshort',
    name: THREE_CASE,
    tap: false,
  },
  s2c: {
    id: 's2c-candidate-e630-c-short-temp-engine-fixed-temp-template-tapped',
    criterion: 2,
    fixture: 'corrected',
    temp: 'cshort',
    name: THREE_CASE,
    tap: true,
  },
  s3: {
    id: 's3-candidate-e630-ordinary-g-temp-full-fs-file-recordonly',
    criterion: 3,
    fixture: 'corrected',
    temp: 'ordinary',
    name: null,
    tap: false,
  },
  s4: {
    id: 's4-candidate-e630-junction-g-temp-engine-fixed-temp-template-tapped',
    criterion: 4,
    fixture: 'corrected',
    temp: 'alias',
    name: THREE_CASE,
    tap: true,
  },
  s5a: {
    id: 's5a-candidate-e630-c-long-temp-adapter-mixed-tapped',
    criterion: 5,
    fixture: 'corrected',
    temp: 'clong',
    name: 'resolves fixed, relative, and temporary directories',
    tap: true,
  },
  s5b: {
    id: 's5b-candidate-e630-c-long-temp-engine-relative-tapped',
    criterion: 5,
    fixture: 'corrected',
    temp: 'clong',
    name: 'uses real relative paths',
    tap: true,
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
    swap.statusDuringSwap = gitStatus();
    need(swap.swappedIsBaseline, 'swap did not produce the baseline bytes');
    event({ kind: 'baseline-swapped', id, fixture: swap.swapped });
    swap.result = await run();
  } finally {
    fs.writeFileSync(FIXTURE, corrected);
    swap.restored = record(FIXTURE);
    swap.restoredIsCorrected = swap.restored.sha256 === CAND_SHA;
    swap.statusAfterRestore = gitStatus();
    swap.restoredAt = now();
    writeNew(`${id}.swap.json`, swap);
    event({ kind: 'baseline-restored', id, fixture: swap.restored, ok: swap.restoredIsCorrected });
  }
  need(swap.restoredIsCorrected && swap.statusAfterRestore === '', 'restore failed');
  return swap.result;
}

function tempPlan(st, kind) {
  // main = TEMP for pnpm and the vitest main process; worker = TEMP applied by the observer in
  // the vitest fork worker only; watch = physical directory watched outside the test process.
  switch (kind) {
    case 'ordinary':
      return { main: st.ordinary, worker: undefined, watch: st.ordinary };
    case 'alias':
      return { main: st.alias, worker: undefined, watch: st.physical };
    case 'upper':
      return { main: st.ordinary, worker: st.upperSpelling, watch: st.upperPhysical };
    case 'cshort':
      need(st.cShort && st.cShort.available, 'genuine short spelling not available');
      return { main: st.ordinary, worker: st.cShort.shortSpelling, watch: st.cShort.longPath };
    case 'clong':
      return { main: st.ordinary, worker: st.cLong, watch: st.cLong };
    default:
      throw new Error('unknown temp kind ' + kind);
  }
}

async function runScenario(key) {
  const sc = SCENARIOS[key];
  need(sc, 'unknown scenario ' + key);
  const st = loadState();
  const plan = tempPlan(st, sc.temp);
  need(plan.main && exists(plan.main), 'scenario main TEMP is missing');
  if (plan.worker) need(exists(plan.worker), 'worker TEMP spelling does not exist');
  const separateMain = plan.worker !== undefined;
  const listing = () => ({
    at: now(),
    fixture: record(FIXTURE),
    status: gitStatus(),
    tempRootListing: walk(plan.watch),
    ...(separateMain ? { mainGTempListing: walk(plan.main) } : {}),
    checkoutRelativeLeftovers: leftovers(),
  });
  const pre = listing();
  need(pre.fixture.sha256 === CAND_SHA, 'working fixture must be corrected at scenario start');
  need(pre.status === '', 'checkout must be clean at scenario start');
  const env = observedEnv(sc.id, plan.main, { tap: sc.tap, workerTemp: plan.worker });
  const run = () =>
    invoke({
      id: sc.id,
      command: vitestCommand(sc.id, sc.name),
      env,
      watch: [
        { label: 'temp-physical-root', dir: plan.watch },
        ...(separateMain ? [{ label: 'main-g-temp', dir: plan.main }] : []),
        { label: 'checkout-package', dir: PKG, filter: (n) => n.startsWith('gg-wp-relative-') },
      ],
    });
  const result = sc.fixture === 'baseline' ? await withBaseline(sc.id, run) : await run();
  const post = listing();
  writeNew(`${sc.id}.prepost.json`, {
    scenario: { key, ...sc },
    instrumentation: sc.tap ? 'passthrough-tapped' : 'record-only',
    plan,
    pre,
    post,
  });
  need(post.fixture.sha256 === CAND_SHA && post.status === '', 'fixture not restored after run');
  console.log(JSON.stringify({ id: sc.id, exitCode: result.exitCode, timedOut: result.timedOut }));
}

function deltaProof(baseText, candText) {
  const strip = (s) => s.replace(/\s+/g, '');
  const sites = [
    ['realpathSync(dataDir)', 'realpathSync.native(dataDir)'],
    ['realpathSync(path)', 'realpathSync.native(path)'],
  ];
  const count = (s, needle) => s.split(needle).length - 1;
  const rewritten = sites.reduce((s, [from, to]) => s.split(from).join(to), baseText);
  const tokens = [
    'expect(',
    'toBe(',
    'toHaveBeenCalledExactlyOnceWith(',
    'toHaveBeenCalledTimes(',
    'toHaveBeenCalledWith(',
    'toHaveLength(',
    'toMatchObject(',
    'toEqual(',
    'toLowerCase(',
    'realpathSync',
    '.skip',
    '.only',
    '.todo',
    'retry',
    'timeout',
    'chdir',
    'vi.mock',
  ];
  return {
    sites: sites.map(([from, to]) => ({
      from,
      to,
      fromInBaseline: count(baseText, from),
      toInBaseline: count(baseText, to),
      fromInCandidate: count(candText, from),
      toInCandidate: count(candText, to),
    })),
    whitespaceInsensitiveEqualAfterTwoSiteRewrite: strip(rewritten) === strip(candText),
    whitespaceInsensitiveEqualWithoutRewrite: strip(baseText) === strip(candText),
    tokenCounts: Object.fromEntries(
      tokens.map((t) => [t, { baseline: count(baseText, t), candidate: count(candText, t) }]),
    ),
  };
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
  writeNew('00c-two-site-delta-U0.diff', git('diff', '-U0', '--no-color', BASE, HEAD, '--', TEST_REL));
  const delta = deltaProof(fs.readFileSync(BASE_BLOB, 'utf8'), fs.readFileSync(CAND_BLOB, 'utf8'));
  const snap = snapshot();
  const cmp = compareToBinding(snap);
  const modules = record(path.join(REPO, 'node_modules', '.modules.yaml'));
  const pnpmVersion = spawnSync('pnpm.cmd --version', {
    shell: true,
    cwd: REPO,
    env: childEnv(process.env.TEMP),
  });
  const pnpmWhere = spawnSync('where pnpm.cmd', {
    shell: true,
    cwd: REPO,
    env: childEnv(process.env.TEMP),
  });
  const observerRec = record(OBSERVER);
  const pre = {
    at: now(),
    runner: {
      pid: process.pid,
      node: process.version,
      execPath: process.execPath,
      runner: record(path.join(TOOLS, 'runner.mjs')),
    },
    observer: { ...observerRec, matchesReference: observerRec.sha256 === OBSERVER_SHA },
    probeTool: record(PROBE),
    platform: {
      type: os.type(),
      release: os.release(),
      version: os.version(),
      arch: os.arch(),
      hostname: os.hostname(),
    },
    gitVersion: execFileSync('git', ['--version']).toString().trim(),
    pnpmVersion: { status: pnpmVersion.status, stdout: String(pnpmVersion.stdout).trim() },
    pnpmWhereFirst: String(pnpmWhere.stdout).split(/\r?\n/)[0],
    fixtures: {
      baseline: base,
      candidate: cand,
      baselineMatchesBinding: base.sha256 === BASE_SHA && base.bytes === BINDING.baselineFixture.bytes,
      candidateMatchesBinding: cand.sha256 === CAND_SHA && cand.bytes === BINDING.correctedFixture.bytes,
      blobIds,
    },
    deltaProof: delta,
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
    volumes: { cDev: dev('C:\\'), gDev: dev('G:\\') },
    capacity: { c: capacity('C:\\'), g: capacity('G:\\') },
    scratchListing: fs.readdirSync(SCRATCH),
    cParentPrefixEntries: fs.readdirSync(C_PARENT).filter((n) => n.startsWith(C_PREFIX)),
  };
  writeNew('00-preflight.json', pre);
  need(pre.observer.matchesReference, 'observer');
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
  need(
    delta.whitespaceInsensitiveEqualAfterTwoSiteRewrite &&
      !delta.whitespaceInsensitiveEqualWithoutRewrite,
    'delta is not exactly the two resolver sites',
  );
  need(Object.values(cmp).every(Boolean), 'source state differs from binding');
  need(pre.productionIdentity.dependencyMetadataMatchesBinding, 'dependency metadata');
  need(pre.cParentPrefixEntries.length === 0, 'C prefix entries already exist');
  console.log(
    JSON.stringify({
      phase: 'preflight',
      ok: true,
      cmp,
      differing,
      pnpm: pre.pnpmVersion,
      pnpmWhereFirst: pre.pnpmWhereFirst,
      delta: {
        afterRewrite: delta.whitespaceInsensitiveEqualAfterTwoSiteRewrite,
        withoutRewrite: delta.whitespaceInsensitiveEqualWithoutRewrite,
        sites: delta.sites,
      },
    }),
  );
}

async function fixtures() {
  const st = loadState();
  need(!st.root, 'fixtures already created');
  const unique = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
  const root = path.join(SCRATCH, `opus-qa-${unique}`);
  need(!exists(root), 'fixture root exists');
  fs.mkdirSync(root);
  const ordinary = path.join(root, 'ordinary-temp');
  const upperPhysical = path.join(root, 'upper-temp');
  const physical = path.join(root, 'junction-physical');
  const alias = path.join(root, 'junction-alias');
  fs.mkdirSync(ordinary);
  fs.mkdirSync(upperPhysical);
  fs.mkdirSync(physical);
  fs.symlinkSync(physical, alias, 'junction');
  const upperSpelling = upperPhysical.toUpperCase();
  const upper = {
    physical: upperPhysical,
    spelling: upperSpelling,
    spellingDiffersLexically: upperSpelling !== upperPhysical,
    spellingEqualsIgnoringCase: upperSpelling.toLowerCase() === upperPhysical.toLowerCase(),
    lstatPhysical: ident(upperPhysical),
    lstatSpelling: ident(upperSpelling),
    realpathNativeOfSpelling: fs.realpathSync.native(upperSpelling),
    realpathJsOfSpelling: fs.realpathSync(upperSpelling),
  };
  upper.sameDevInoAndNotLink =
    upper.lstatPhysical.dev === upper.lstatSpelling.dev &&
    upper.lstatPhysical.ino === upper.lstatSpelling.ino &&
    !upper.lstatSpelling.isSymbolicLink;
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
    upper,
    junction,
    nativeDirAL: { status: dirAL.status, stdout: dirAL.stdout, stderr: dirAL.stderr },
    nativeFsutil: { status: fsutil.status, stdout: fsutil.stdout, stderr: fsutil.stderr },
  };
  writeNew('01-fixtures.json', rec);
  saveState({
    unique,
    root,
    ordinary,
    upperPhysical,
    upperSpelling,
    physical,
    alias,
    identities: {
      root: rec.root.identity,
      ordinary: rec.ordinary.identity,
      upper: upper.lstatPhysical,
      physical: junction.lstatPhysical,
      alias: junction.lstatAlias,
    },
  });
  need(junction.lstatAlias.isSymbolicLink, 'alias is not a reparse point');
  need(junction.realpathNative === physical, 'alias does not resolve to physical');
  need(junction.lexicalDiffersFromPhysical && junction.reparsePointIdentityDiffers, 'identities');
  need(rec.ordinary.lexicalEqualsPhysical, 'ordinary TEMP is not lexical==physical');
  need(rec.root.realpathNative === root, 'root is not lexical==physical');
  need(upper.spellingDiffersLexically && upper.sameDevInoAndNotLink, 'uppercase spelling identity');
  need(upper.realpathNativeOfSpelling === upperPhysical, 'native realpath of uppercase spelling');
  // Uninstrumented resolver probe with the uppercase spelling as TEMP (criterion 1).
  const p1 = probe('p1-upper-g-temp-resolver-probe', 'upper-g-temp', upperSpelling, upperSpelling);
  // Argument-passing probe through the same pnpm.cmd -> pnpm exec path, with the observer loaded.
  const probeId = 'p0-pnpm-exec-argv-probe';
  const p0 = await invoke({
    id: probeId,
    command:
      'pnpm.cmd --filter @graphgoblin/infrastructure exec node -p "JSON.stringify({argv:process.argv.slice(1),version:process.version,execPath:process.execPath,cwd:process.cwd()})" "uses real temp paths" "' +
      THREE_CASE +
      '" "resolves fixed, relative, and temporary directories"',
    env: observedEnv(probeId, ordinary),
    timeoutMs: 120_000,
  });
  console.log(
    JSON.stringify({
      phase: 'fixtures',
      root,
      upper: {
        spelling: upperSpelling,
        native: upper.realpathNativeOfSpelling,
        js: upper.realpathJsOfSpelling,
      },
      p1: {
        tmpdir: p1.tmpdir,
        child: p1.childLexical,
        js: p1.childRecord.jsRealpathSync,
        native: p1.childRecord.nativeRealpathSync,
        promises: p1.childRecord.promisesRealpath,
        nativeEqualsPromises: p1.childRecord.nativeEqualsPromises,
        same: p1.childRecord.inputAndNativeSameDevIno,
        removed: p1.childRemoved,
      },
      p0Exit: p0.exitCode,
    }),
  );
}

// Criteria 2 and 5: tiny unique owned C root. Probes genuine 8.3 availability with ordinary
// existing behavior only (GetShortPathName via cmd %~s, dir /x on the owned root, read-only
// fsutil query). No volume setting, privilege, mapping or owner data is changed.
function cSetup() {
  const st = loadState();
  need(st.unique && !st.croot, 'C setup state');
  const parentReal = fs.realpathSync.native(C_PARENT);
  const vol = { cDev: dev('C:\\'), gDev: dev('G:\\'), parentDev: dev(C_PARENT) };
  need(parentReal.toUpperCase().startsWith('C:\\'), 'C parent is not physically on C');
  need(vol.parentDev === vol.cDev && vol.cDev !== vol.gDev, 'C parent volume');
  const croot = path.join(C_PARENT, `${C_PREFIX}${st.unique}`);
  need(!exists(croot), 'C fixture exists');
  const capacityBefore = capacity('C:\\');
  fs.mkdirSync(croot);
  const cLong = path.join(croot, 'long-spelling-worker-temp');
  const cAliasLong = path.join(croot, 'short-alias-worker-temp');
  fs.mkdirSync(cLong);
  fs.mkdirSync(cAliasLong);
  const identities = { croot: ident(croot), cLong: ident(cLong), cAliasLong: ident(cAliasLong) };
  saveState({ ...st, croot, cLong, cAliasLong, cIdentities: identities });
  const shortOf = (p) => {
    const r = spawnSync(`for %I in ("${p}") do @echo %~sI`, { shell: true, encoding: 'utf8' });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, value: String(r.stdout).trim() };
  };
  const dirX = spawnSync(`dir /x /a:d "${croot}"`, { shell: true, encoding: 'utf8' });
  const fsutil8 = spawnSync('fsutil', ['8dot3name', 'query', 'C:'], { encoding: 'utf8' });
  const shortQuery = {
    parent: shortOf(C_PARENT),
    croot: shortOf(croot),
    cAliasLong: shortOf(cAliasLong),
    cLong: shortOf(cLong),
  };
  const candidate = shortQuery.cAliasLong.value;
  const lc = (s) => s.toLowerCase();
  const genuine =
    shortQuery.cAliasLong.status === 0 &&
    candidate.length > 0 &&
    lc(candidate) !== lc(cAliasLong) &&
    candidate.includes('~');
  const cShort = {
    longPath: cAliasLong,
    shortSpelling: genuine ? candidate : null,
    available: false,
  };
  if (genuine) {
    const a = ident(candidate, true);
    const b = ident(cAliasLong, true);
    cShort.identityShortFollowed = a;
    cShort.identityLong = b;
    cShort.lstatShort = ident(candidate);
    cShort.sameDevIno = a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
    cShort.shortIsNotReparsePoint = !cShort.lstatShort.isSymbolicLink;
    cShort.nativeOfShort = fs.realpathSync.native(candidate);
    cShort.jsOfShort = fs.realpathSync(candidate);
    cShort.nativeOfShortEqualsLong = cShort.nativeOfShort === cAliasLong;
    const marker = path.join(cAliasLong, 'identity-marker.txt');
    const token = crypto.randomBytes(8).toString('hex');
    fs.writeFileSync(marker, token, { flag: 'wx' });
    cShort.markerReadViaShort =
      fs.readFileSync(path.join(candidate, 'identity-marker.txt'), 'utf8') === token;
    fs.unlinkSync(marker);
    cShort.markerRemoved = !exists(marker);
    const segsS = candidate.split('\\');
    const segsL = cAliasLong.split('\\');
    cShort.componentsShortened = segsS
      .map((s, i) => ({ index: i, short: s, long: segsL[i] }))
      .filter((x) => lc(x.short) !== lc(x.long ?? ''));
    cShort.available =
      cShort.sameDevIno &&
      cShort.shortIsNotReparsePoint &&
      cShort.nativeOfShortEqualsLong &&
      cShort.markerReadViaShort &&
      segsS.length === segsL.length;
  }
  const rec = {
    at: now(),
    createdByPid: process.pid,
    croot,
    cLong,
    cAliasLong,
    parentRealpath: parentReal,
    identities,
    realpathNative: {
      croot: fs.realpathSync.native(croot),
      cLong: fs.realpathSync.native(cLong),
      cAliasLong: fs.realpathSync.native(cAliasLong),
    },
    dev: dev(croot),
    volumes: vol,
    capacityBefore,
    capacityAfterCreate: capacity('C:\\'),
    shortNameProbe: {
      method:
        'cmd for %~sI (GetShortPathName), dir /x on the owned root only, read-only fsutil 8dot3name query',
      shortQuery,
      dirX: { status: dirX.status, stdout: dirX.stdout, stderr: dirX.stderr },
      fsutil8dot3Query: { status: fsutil8.status, stdout: fsutil8.stdout, stderr: fsutil8.stderr },
      cShort,
    },
  };
  writeNew('20-c-setup.json', rec);
  saveState({ ...loadState(), cShort });
  need(rec.realpathNative.croot === croot && rec.dev === vol.cDev, 'C fixture is not a plain C directory');
  need(rec.realpathNative.cLong === cLong, 'C long TEMP is not lexical==physical');
  let p2 = null;
  if (cShort.available)
    p2 = probe(
      'p2-c-short-temp-resolver-probe',
      'c-short-temp',
      cShort.shortSpelling,
      cShort.shortSpelling,
    );
  const p5 = probe('p5-c-long-temp-resolver-probe', 'c-long-temp', cLong, cLong);
  console.log(
    JSON.stringify({
      phase: 'c-setup',
      croot,
      shortQuery: Object.fromEntries(Object.entries(shortQuery).map(([k, v]) => [k, v.value])),
      fsutil: { status: fsutil8.status, out: String(fsutil8.stdout).trim().slice(0, 400) },
      cShort,
      p2: p2 && {
        tmpdir: p2.tmpdir,
        child: p2.childLexical,
        js: p2.childRecord.jsRealpathSync,
        native: p2.childRecord.nativeRealpathSync,
        promises: p2.childRecord.promisesRealpath,
        nativeEqualsPromises: p2.childRecord.nativeEqualsPromises,
        same: p2.childRecord.inputAndNativeSameDevIno,
        removed: p2.childRemoved,
      },
      p5: {
        tmpdir: p5.tmpdir,
        nativeEqualsLexical: p5.childRecord.nativeEqualsInputLexical,
        removed: p5.childRemoved,
      },
    }),
  );
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

function cCleanup() {
  const st = loadState();
  need(st.croot, 'no C fixture recorded');
  const rec = { at: now() };
  rec.cLong = removeOwnedDirectory('c-long-temp', st.cLong, st.cIdentities.cLong);
  rec.cAliasLong = removeOwnedDirectory(
    'c-short-alias-temp',
    st.cAliasLong,
    st.cIdentities.cAliasLong,
  );
  rec.croot = removeOwnedDirectory('c-root', st.croot, st.cIdentities.croot);
  rec.shortSpellingExistsAfter = st.cShort?.shortSpelling ? exists(st.cShort.shortSpelling) : null;
  rec.capacityAfterRemoval = capacity('C:\\');
  rec.cParentEntriesMatchingPrefix = fs.readdirSync(C_PARENT).filter((n) => n.startsWith(C_PREFIX));
  writeNew('29-c-cleanup.json', rec);
  need(
    !rec.croot.existsAfter && rec.cParentEntriesMatchingPrefix.length === 0,
    'C fixture still exists',
  );
  console.log(
    JSON.stringify({
      phase: 'c-cleanup',
      removed: !rec.croot.existsAfter,
      prefix: rec.cParentEntriesMatchingPrefix,
      methods: [rec.cLong.method, rec.cAliasLong.method, rec.croot.method],
    }),
  );
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
  rec.upper = removeOwnedDirectory('upper-temp', st.upperPhysical, st.identities.upper);
  rec.ordinary = removeOwnedDirectory('ordinary-temp', st.ordinary, st.identities.ordinary);
  rec.root = removeOwnedDirectory('fixture-root', st.root, st.identities.root);
  rec.scratchListingAfter = fs.readdirSync(SCRATCH);
  writeNew('40-cleanup.json', rec);
  console.log(
    JSON.stringify({
      phase: 'cleanup',
      junctionUnlinked: rec.junction ? !rec.junction.existsAfter : null,
      rootRemoved: !rec.root.existsAfter,
      scratch: rec.scratchListingAfter,
    }),
  );
}

function after() {
  const snap = snapshot();
  const rec = {
    at: now(),
    sourceAfter: snap,
    sourceAfterMatchesBinding: compareToBinding(snap),
    checkoutRelativeLeftovers: leftovers(),
    dependencyMetadata: record(path.join(REPO, 'node_modules', '.modules.yaml')),
    observer: record(OBSERVER),
    capacity: { c: capacity('C:\\'), g: capacity('G:\\') },
    cParentEntriesMatchingPrefix: fs.readdirSync(C_PARENT).filter((n) => n.startsWith(C_PREFIX)),
    scratchListing: fs.readdirSync(SCRATCH),
    savedCorrected: exists(path.join(RAW, 'saved-corrected-fs.test.ts'))
      ? record(path.join(RAW, 'saved-corrected-fs.test.ts'))
      : null,
  };
  rec.dependencyMetadataMatchesBinding =
    rec.dependencyMetadata.sha256 === BINDING.dependencyMetadata.sha256;
  writeNew('50-after.json', rec);
  console.log(
    JSON.stringify({
      phase: 'after',
      cmp: rec.sourceAfterMatchesBinding,
      leftovers: rec.checkoutRelativeLeftovers,
      deps: rec.dependencyMetadataMatchesBinding,
      cPrefix: rec.cParentEntriesMatchingPrefix,
      scratch: rec.scratchListing,
    }),
  );
}

const phase = process.argv[2];
const arg = process.argv[3];
const phases = {
  preflight,
  fixtures,
  scenario: () => runScenario(arg),
  'c-setup': cSetup,
  'c-cleanup': cCleanup,
  cleanup,
  after,
};
try {
  need(phases[phase], 'unknown phase ' + phase);
  if (exists(RAW))
    event({
      kind: 'phase-start',
      phase,
      arg,
      runnerSha256: record(path.join(TOOLS, 'runner.mjs')).sha256,
    });
  await phases[phase]();
  event({ kind: 'phase-end', phase, arg });
} catch (error) {
  if (exists(RAW)) event({ kind: 'phase-error', phase, arg, error: String(error?.stack ?? error) });
  console.error(error);
  process.exitCode = 1;
}
