// Independent #363 F3 behavior QA driver (Claude Code Opus 5.5 QA context).
// Spawns the UNMODIFIED checkout host packages/adapter-codex/src/fixtures/sdk-schema-case.mjs,
// which imports the actual installed SDK and injects the actual corrected schema-cli.mjs producer.
// Own roots, config, env, TEMP construction, schema bytes, sentinels, expectations and native
// observations. No retries. Writes only to --out (new) and --scratch (new).
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const EXLOCK = 0x10000000; // libuv UV_FS_O_EXLOCK on Windows: CreateFileW share mode 0
const EXPECTED = {
  head: 'b1cdd20463f6dbbd4e55cae0109395db724a778f',
  tree: '65443d7d6be5eb7c1a4f98579c017692f00a5a2c',
  files: {
    'packages/adapter-codex/src/fixtures/schema-cli.mjs':
      '80a342d89d5601e3b9c6ab1acaa2874fac48ea63d0028cc77c56da54b7cedf03',
    'packages/adapter-codex/src/fixtures/sdk-schema-case.mjs':
      '8bddd500a108d3275472c6dbaaad6d3dccbb1120ede9752556017cf1e46ef7b2',
    'packages/adapter-codex/src/sdk-schema.test.ts':
      '2050e1298e84323fd026c8af5d953697562894ba5de3f0db8863d6caa629058a',
  },
  sdk: 'ec7471535be310cabbb8f256faa80a1101e46b84b41d42cae40a3e36a9a5feb7',
  node: 'v22.23.4',
};
// Independent strict schema: same constraints as the maintained one, different key order/bytes.
const QA_SCHEMA = {
  additionalProperties: false,
  properties: { ok: { type: 'boolean' } },
  required: ['ok'],
  type: 'object',
};
const QA_SCHEMA_TEXT = JSON.stringify(QA_SCHEMA);
const HOST_CAP_MS = 9000;
const HOLD_CAP_MS = 2300;
const HOLD_MIN_MS = 300;

const opts = {};
for (let i = 2; i < process.argv.length; i += 2)
  opts[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const CHECKOUT = path.resolve(opts.checkout);
const SCRATCH = path.resolve(opts.scratch);
const OUT = path.resolve(opts.out);
const SCRATCH_PARENT = 'g:\\ggq\\qa-scratch\\i4-363-marker-qa';
const OUT_PARENT =
  'c:\\users\\98jak\\graphgoblin-qa\\2026-11-17-five-intents\\i4-363-marker-independent-01';
if (path.dirname(SCRATCH).toLowerCase() !== SCRATCH_PARENT) throw new Error(`Bad scratch ${SCRATCH}`);
if (path.dirname(OUT).toLowerCase() !== OUT_PARENT) throw new Error(`Bad out ${OUT}`);
const scratchEntries = fs.readdirSync(SCRATCH);
if (!isDeepStrictEqual(scratchEntries, ['tmp']) || fs.readdirSync(path.join(SCRATCH, 'tmp')).length)
  throw new Error(`Scratch is not fresh: ${scratchEntries}`);
fs.mkdirSync(OUT); // throws if it already exists: never overwrite evidence
const DRIVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const HOST = path.join(CHECKOUT, 'packages', 'adapter-codex', 'src', 'fixtures', 'sdk-schema-case.mjs');
const CASES = path.join(SCRATCH, 'cases');
const PROBE_DIR = path.join(SCRATCH, 'probe');
const CONTROLS = path.join(SCRATCH, 'controls');
for (const d of [CASES, PROBE_DIR, CONTROLS, path.join(OUT, 'cases'), path.join(OUT, 'controls')])
  fs.mkdirSync(d);

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const now = () => Date.now();
const T0 = now();
const ENV_KEYS = [
  'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'CODEX_HOME',
  'NODE_OPTIONS', 'GG_SCHEMA_PAUSE_FILE', 'GG_SCHEMA_RELEASE_FILE', 'GG_SCHEMA_RECORD', 'GG_SCHEMA_MODE',
];
const pickEnv = () => Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k] ?? null]));
const ledger = {
  startedUtc: new Date(T0).toISOString(),
  driver: { pid: process.pid, ppid: process.ppid, node: process.version, execPath: process.execPath, argv: process.argv, cwd: process.cwd() },
  driverEnvAtStart: pickEnv(),
  events: [],
};
function event(name, data = {}) {
  const e = { t: now(), dt: now() - T0, name, ...data };
  ledger.events.push(e);
  process.stdout.write(JSON.stringify(e) + '\n');
}
const writeJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n', { flag: 'wx' });
const readMaybe = (p) => {
  try {
    return fs.readFileSync(p);
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
};
const lstatInfo = (p) => {
  try {
    const s = fs.lstatSync(p);
    return { exists: true, size: s.size, isFile: s.isFile(), isDirectory: s.isDirectory() };
  } catch (error) {
    return { exists: false, code: error.code };
  }
};
const list = (d) => fs.readdirSync(d).sort();
const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const allOf = (o) => Object.values(o ?? {}).flatMap(arr);
const isConhost = (p) => (p.Name ?? '').toLowerCase() === 'conhost.exe';
let exlockValid = false; // set by control C1
const kill0 = (pid) => {
  try {
    process.kill(pid, 0);
    return { alive: true };
  } catch (error) {
    return { alive: false, code: error.code };
  }
};
const tryExlock = (p) => {
  try {
    const fd = fs.openSync(p, fs.constants.O_RDONLY | EXLOCK);
    fs.closeSync(fd);
    return { ok: true };
  } catch (error) {
    return { ok: false, code: error.code };
  }
};
const tryParse = (b) => {
  try {
    return { ok: true, value: JSON.parse(b.toString('utf8')) };
  } catch (error) {
    return { ok: false, name: error.name, message: error.message };
  }
};
function walk(root) {
  const out = [];
  const visit = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const s = fs.lstatSync(full);
      const rel = path.relative(root, full);
      if (s.isSymbolicLink()) out.push({ rel, type: 'symlink' });
      else if (s.isDirectory()) {
        out.push({ rel, type: 'dir' });
        visit(full);
      } else out.push({ rel, type: 'file', size: s.size, sha256: sha256(fs.readFileSync(full)) });
    }
  };
  visit(root);
  return out;
}

// ---------- preflight (read-only) ----------
function preflight() {
  const git = (...a) =>
    execFileSync('git', ['--no-optional-locks', '-C', CHECKOUT, ...a], { encoding: 'utf8' }).trim();
  const p = {
    head: git('rev-parse', 'HEAD'),
    tree: git('rev-parse', 'HEAD^{tree}'),
    status: git('status', '--porcelain=v1', '--untracked-files=all'),
    files: {},
  };
  for (const f of Object.keys(EXPECTED.files)) {
    const b = fs.readFileSync(path.join(CHECKOUT, f));
    p.files[f] = { bytes: b.length, sha256: sha256(b) };
  }
  const fixturesDir = path.dirname(HOST);
  const resolvedUrl = execFileSync(
    process.execPath,
    ['--input-type=module', '-e', "process.stdout.write(import.meta.resolve('@openai/codex-sdk'))"],
    { cwd: fixturesDir, encoding: 'utf8' },
  );
  const sdkFile = fileURLToPath(resolvedUrl);
  p.sdk = { resolvedUrl, file: sdkFile, realpath: fs.realpathSync(sdkFile), sha256: sha256(fs.readFileSync(sdkFile)) };
  p.node = process.version;
  p.checks = {
    head: p.head === EXPECTED.head,
    tree: p.tree === EXPECTED.tree,
    clean: p.status === '',
    files: Object.entries(EXPECTED.files).every(([f, h]) => p.files[f].sha256 === h),
    sdk: p.sdk.sha256 === EXPECTED.sdk,
    node: p.node === EXPECTED.node,
  };
  p.ok = Object.values(p.checks).every(Boolean);
  return p;
}

// ---------- owned CIM probe ----------
let probe;
let reqSeq = 0;
async function startProbe() {
  const out = [];
  const err = [];
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(DRIVER_DIR, 'cim-probe.ps1'), '-Dir', PROBE_DIR, '-MaxSeconds', '900'],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  child.stdout.on('data', (d) => out.push(d));
  child.stderr.on('data', (d) => err.push(d));
  const closed = new Promise((res) => child.once('close', (code, signal) => res({ code, signal, t: now() })));
  probe = { child, pid: child.pid, out, err, closed, spawnedAt: now() };
  event('probe-spawned', { pid: child.pid });
  const ready = path.join(PROBE_DIR, 'ready.json');
  const deadline = now() + 30000;
  while (!fs.existsSync(ready) && now() < deadline && child.exitCode === null) await delay(20);
  if (!fs.existsSync(ready)) throw new Error('CIM probe did not become ready');
  probe.ready = JSON.parse(fs.readFileSync(ready, 'utf8').replace(/^\uFEFF/, ''));
  event('probe-ready', probe.ready);
}
async function cim(request, timeoutMs) {
  const id = String(++reqSeq).padStart(3, '0');
  const req = path.join(PROBE_DIR, `req-${id}.json`);
  fs.writeFileSync(`${req}.tmp`, JSON.stringify(request), { flag: 'wx' });
  fs.renameSync(`${req}.tmp`, req);
  const requestedMs = now();
  const res = path.join(PROBE_DIR, `res-${id}.json`);
  const deadline = requestedMs + timeoutMs;
  while (!fs.existsSync(res)) {
    if (now() > deadline) return { id, request, requestedMs, timeout: true };
    await delay(5);
  }
  const body = JSON.parse(fs.readFileSync(res, 'utf8').replace(/^\uFEFF/, ''));
  return { id, request, requestedMs, receivedMs: now(), ...body };
}
async function stopProbe() {
  fs.writeFileSync(path.join(PROBE_DIR, 'stop'), 'stop', { flag: 'wx' });
  const result = await Promise.race([probe.closed, delay(15000).then(() => undefined)]);
  if (!result) {
    event('probe-stop-timeout-kill', { pid: probe.pid });
    probe.child.kill();
    return { killedByOwnedHandle: true, close: await probe.closed };
  }
  return { killedByOwnedHandle: false, close: result };
}

// ---------- instrument controls ----------
async function controlExlock() {
  const f = path.join(CONTROLS, 'c1-exlock.txt');
  fs.writeFileSync(f, 'exlock control', { flag: 'wx' });
  const held = fs.openSync(f, 'r');
  const whileHeld = tryExlock(f);
  fs.closeSync(held);
  const afterClose = tryExlock(f);
  const pass = whileHeld.ok === false && whileHeld.code === 'EBUSY' && afterClose.ok === true;
  return { id: 'C1', file: f, whileHeld, afterClose, pass };
}
async function controlKill0Cim() {
  const marker = path.join(CONTROLS, 'c2-sleeper-marker');
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', marker], {
    windowsHide: true,
    stdio: 'ignore',
    env: { ...hostBaseEnv(), TEMP: path.join(SCRATCH, 'tmp'), TMP: path.join(SCRATCH, 'tmp') },
  });
  const closed = new Promise((res) => child.once('close', (code, signal) => res({ code, signal, t: now() })));
  await delay(400);
  const aliveKill0 = kill0(child.pid);
  const aliveCim = await cim({ pids: [child.pid], parents: [], net: false }, 10000);
  child.kill(); // owned handle
  const close = await closed;
  const deadKill0 = kill0(child.pid);
  const deadCim = await cim({ pids: [child.pid], parents: [], net: false }, 10000);
  const live = arr(aliveCim.byPid?.[String(child.pid)]);
  const dead = arr(deadCim.byPid?.[String(child.pid)]);
  const pass =
    aliveKill0.alive === true &&
    live.length === 1 &&
    live[0].ParentProcessId === process.pid &&
    live[0].CommandLine.includes(marker) &&
    deadKill0.alive === false &&
    deadKill0.code === 'ESRCH' &&
    dead.filter((p) => p.CommandLine.includes(marker)).length === 0;
  return { id: 'C2', pid: child.pid, marker, aliveKill0, aliveCim, close, deadKill0, deadCim, pass };
}

// ---------- host cases ----------
function hostBaseEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) => v !== undefined && /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i.test(k),
    ),
  );
}
const CASE_DEFS = [
  { id: 'M1-short-success', mode: 'success' },
  { id: 'M2-short-error', mode: 'error' },
  { id: 'M3-short-abort', mode: 'abort' },
  { id: 'M4-226-success', mode: 'success', length: 226 },
  { id: 'M5-226-error', mode: 'error', length: 226 },
  { id: 'M6-226-abort', mode: 'abort', length: 226 },
  { id: 'M7-barrier-self', mode: 'abort', controls: { publicationBarrier: true } },
  { id: 'M8-fault-read', mode: 'abort', controls: { observerFault: 'read' }, expectExit: 1 },
  { id: 'M9-fault-parse', mode: 'abort', controls: { observerFault: 'parse' }, expectExit: 1 },
  { id: 'X1-hold-release', mode: 'abort', hold: 'release' },
  { id: 'X3-hold-empty-marker', mode: 'abort', hold: 'empty-marker', expectExit: 1 },
];

function buildTemp(root, length) {
  if (length === undefined) return path.join(root, 'tmp-short');
  let temp = path.join(root, 't');
  while (temp.length + 50 < length) temp = path.join(temp, 'q'.repeat(40));
  temp = path.join(temp, 'z'.repeat(length - temp.length - 1));
  if (temp.length !== length) throw new Error(`TEMP length ${temp.length} != ${length}`);
  return temp;
}

async function runCase(def) {
  const { id, mode, length, controls = {}, hold } = def;
  const expectExit = def.expectExit ?? 0;
  const root = path.join(CASES, id);
  fs.mkdirSync(root);
  const caseOut = path.join(OUT, 'cases', id);
  fs.mkdirSync(caseOut);
  const temp = buildTemp(root, length);
  const home = path.join(root, 'home');
  fs.mkdirSync(temp, { recursive: true });
  fs.mkdirSync(home);
  const sentinelFiles = {
    [path.join(temp, 'gg-schema-QAKEEP', 'keep')]: `sentinel ${id} schema-namespace dir`,
    [path.join(temp, 'gg-structured-qa', 'keep')]: `sentinel ${id} structured dir`,
    [path.join(temp, 'gg-schema-sentinel.txt')]: `sentinel ${id} schema-prefixed file`,
    [path.join(temp, 'unrelated-qa.txt')]: `Keep this file ${id}`,
    [path.join(root, 'root-sentinel.txt')]: `root sentinel ${id}`,
  };
  for (const [f, content] of Object.entries(sentinelFiles)) {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, content, { flag: 'wx' });
  }
  const hashSentinels = () =>
    Object.fromEntries(Object.keys(sentinelFiles).map((f) => [f, readMaybe(f) ? sha256(readMaybe(f)) : null]));
  const recordFile = path.join(root, 'schema-record.json');
  const stateFile = path.join(root, 'state.json');
  const configFile = path.join(root, 'case.json');
  const holdPause = path.join(root, 'qa-hold.paused');
  const holdRelease = path.join(root, 'qa-hold.release');
  const config = { mode, workingDirectory: root, schema: QA_SCHEMA, recordFile, stateFile, ...controls };
  fs.writeFileSync(configFile, JSON.stringify(config), { flag: 'wx' });
  const env = {
    ...hostBaseEnv(),
    TEMP: temp,
    TMP: temp,
    TMPDIR: temp,
    CODEX_HOME: home,
    HOME: home,
    USERPROFILE: home,
    APPDATA: home,
    LOCALAPPDATA: home,
    ...(hold ? { GG_SCHEMA_PAUSE_FILE: holdPause, GG_SCHEMA_RELEASE_FILE: holdRelease } : {}),
  };
  const before = {
    tempListing: list(temp),
    rootListing: list(root),
    sentinels: hashSentinels(),
    driverEnv: pickEnv(),
  };
  const r = {
    id,
    def,
    root,
    temp,
    tempLength: temp.length,
    config,
    configSha256: sha256(fs.readFileSync(configFile)),
    command: { file: process.execPath, args: [HOST, configFile], cwd: root, env },
    before,
  };
  const out = [];
  const err = [];
  let exited;
  const tSpawn = now();
  const host = spawn(process.execPath, [HOST, configFile], {
    cwd: root,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  r.hostPid = host.pid;
  r.timing = { spawnMs: tSpawn };
  event('host-spawned', { id, pid: host.pid });
  host.stdout.on('data', (d) => out.push(d));
  host.stderr.on('data', (d) => err.push(d));
  let spawnError;
  host.once('error', (e) => (spawnError = { name: e.name, message: e.message, code: e.code }));
  const closed = new Promise((res) =>
    host.once('close', (code, signal) => res((exited = { code, signal, t: now() }))),
  );
  let timedOut = false;
  const timer = setTimeout(() => {
    if (!exited) {
      timedOut = true;
      event('host-timeout-kill-owned-handle', { id, pid: host.pid });
      host.kill();
    }
  }, HOST_CAP_MS);

  if (hold) {
    const capAt = tSpawn + HOLD_CAP_MS;
    while (!fs.existsSync(holdPause) && !exited && now() < capAt) await delay(5);
    if (!fs.existsSync(holdPause)) {
      r.hold = { established: false, reason: exited ? 'host exited first' : 'cap reached' };
    } else {
      const tPause = now();
      const pauseBytes = fs.readFileSync(holdPause);
      const pauseMeta = JSON.parse(pauseBytes.toString('utf8'));
      const pendingFile = pauseMeta.pendingFile;
      const pendingBytes = fs.readFileSync(pendingFile);
      const pending = JSON.parse(pendingBytes.toString('utf8'));
      const pendingSha256 = sha256(pendingBytes);
      const childPid = pending.pid;
      event('hold-established', { id, childPid, pendingFile });
      const sample = () => {
        const t = now();
        const pb = readMaybe(pendingFile);
        const sb = readMaybe(pending.schemaPath);
        return {
          t,
          sincePauseMs: t - tPause,
          finalMarker: lstatInfo(recordFile),
          rootListing: list(root),
          pending: pb
            ? { exists: true, size: pb.length, sha256: sha256(pb), unchanged: sha256(pb) === pendingSha256, parse: tryParse(pb).ok }
            : { exists: false },
          pendingExclusiveOpen: tryExlock(pendingFile),
          schemaFile: sb
            ? { exists: true, size: sb.length, bytesEqualQaSchema: sb.toString('utf8') === QA_SCHEMA_TEXT }
            : { exists: false },
          schemaDirectoryListing: fs.existsSync(pending.schemaDirectory) ? list(pending.schemaDirectory) : null,
          childKill0: kill0(childPid),
          hostAlive: !exited && host.exitCode === null && host.signalCode === null,
          stateFileExists: fs.existsSync(stateFile),
          hostStdoutBytes: Buffer.concat(out).length,
          hostStderrBytes: Buffer.concat(err).length,
        };
      };
      const s1 = sample();
      const aliveProbe = cim({ pids: [childPid, host.pid], parents: [host.pid, childPid], net: true }, 10000);
      await Promise.race([aliveProbe, delay(Math.max(0, capAt - now()))]);
      const minAt = Math.min(tPause + HOLD_MIN_MS, capAt);
      if (now() < minAt) await delay(minAt - now());
      const s2 = sample();
      let action;
      if (hold === 'release') {
        fs.writeFileSync(holdRelease, 'independent QA release\n', { flag: 'wx' });
        action = { kind: 'release', t: now() };
      } else {
        // Exact F3 window state: final path exists, opened and closed, nothing written.
        fs.closeSync(fs.openSync(recordFile, 'wx'));
        action = { kind: 'empty-final-marker', t: now() };
      }
      event('hold-action', { id, ...action });
      let markerSeenMs;
      if (hold === 'release') {
        while (!exited && !fs.existsSync(recordFile) && now() < action.t + 3000) await delay(2);
        if (fs.existsSync(recordFile)) markerSeenMs = now();
      }
      const cimAlive = await aliveProbe;
      r.hold = {
        established: true,
        holdPause,
        holdRelease,
        tPause,
        pauseBytes: pauseBytes.toString('utf8'),
        pauseSha256: sha256(pauseBytes),
        pendingFile,
        pendingBytes: pendingBytes.toString('utf8'),
        pendingSha256,
        pending,
        childPid,
        samples: [s1, s2],
        cimAlive,
        action,
        markerSeenMs,
      };
    }
  }

  await closed;
  clearTimeout(timer);
  const stdout = Buffer.concat(out).toString('utf8');
  const stderr = Buffer.concat(err).toString('utf8');
  r.timing.exitMs = exited.t;
  r.timing.durationMs = exited.t - tSpawn;
  r.exit = { code: exited.code, signal: exited.signal, timedOut, spawnError };
  r.stdout = stdout;
  r.stderr = stderr;
  const stateBytes = readMaybe(stateFile);
  r.stateRaw = stateBytes ? stateBytes.toString('utf8') : null;
  const state = stateBytes ? JSON.parse(stateBytes.toString('utf8')) : undefined;
  r.state = state;
  const markerBytes = readMaybe(recordFile);
  r.marker = markerBytes
    ? { exists: true, length: markerBytes.length, sha256: sha256(markerBytes), bytes: markerBytes.toString('utf8') }
    : { exists: false, lstat: lstatInfo(recordFile) };
  const childPid = state?.record?.pid ?? r.hold?.childPid;
  const schemaDirectory = state?.record?.schemaDirectory ?? r.hold?.pending?.schemaDirectory;
  r.after = {
    tempListing: list(temp),
    rootListing: list(root),
    sentinels: hashSentinels(),
    driverEnv: pickEnv(),
    childPid,
    childKill0: childPid ? kill0(childPid) : null,
    hostKill0: kill0(host.pid),
    schemaDirectory,
    schemaDirectoryExists: schemaDirectory ? fs.existsSync(schemaDirectory) : null,
  };
  r.after.cim = await cim(
    { pids: [childPid, host.pid].filter(Boolean), parents: [host.pid, childPid].filter(Boolean), net: false },
    10000,
  );
  evaluate(r, def, expectExit);
  // Preserve top-level root files and a full root manifest.
  const rootFilesOut = path.join(caseOut, 'root-files');
  fs.mkdirSync(rootFilesOut);
  for (const name of list(root)) {
    const full = path.join(root, name);
    if (fs.lstatSync(full).isFile()) fs.copyFileSync(full, path.join(rootFilesOut, name), fs.constants.COPYFILE_EXCL);
  }
  r.rootManifest = walk(root);
  fs.writeFileSync(path.join(caseOut, 'host-stdout.log'), stdout, { flag: 'wx' });
  fs.writeFileSync(path.join(caseOut, 'host-stderr.log'), stderr, { flag: 'wx' });
  writeJson(path.join(caseOut, 'result.json'), r);
  event('case-done', { id, pass: r.pass, failed: r.checks.filter((c) => !c.pass).map((c) => c.name) });
  return r;
}

function evaluate(r, def, expectExit) {
  const checks = [];
  const check = (name, pass, actual, kind = 'criterion') => checks.push({ name, kind, pass: Boolean(pass), actual });
  const s = r.state;
  const rec = s?.record;
  const hostPid = r.hostPid;
  const childPid = r.after.childPid;
  const isOurs = (p) => p.ParentProcessId === hostPid || (p.CommandLine ?? '').includes(r.root);
  check('host not timed out by driver cap', !r.exit.timedOut, r.exit);
  check(`host exit code ${expectExit}, no signal`, r.exit.code === expectExit && r.exit.signal === null, r.exit);
  check('state file written', Boolean(s), Boolean(s));
  check('stdout equals state file + newline', r.stdout === `${r.stateRaw}\n`, r.stdout.length);
  if (!s) return finish();
  check('host actualTemp is my TEMP', s.actualTemp === r.temp, s.actualTemp);
  check('host TEMP entries unchanged', isDeepStrictEqual([...s.entriesAfter].sort(), [...s.entriesBefore].sort()), { before: s.entriesBefore, after: s.entriesAfter });
  check('driver-native TEMP listing unchanged', isDeepStrictEqual(r.after.tempListing, r.before.tempListing), r.after.tempListing);
  check('all sentinels byte-identical', isDeepStrictEqual(r.after.sentinels, r.before.sentinels), r.after.sentinels);
  check('driver (parent) env unchanged', isDeepStrictEqual(r.after.driverEnv, r.before.driverEnv), r.after.driverEnv);
  check('SDK work settled', s.workSettled === true, s.workSettled);
  check('child pid known', Number.isInteger(childPid), childPid);
  check('driver kill0: child ESRCH', r.after.childKill0?.alive === false && r.after.childKill0?.code === 'ESRCH', r.after.childKill0);
  check('driver kill0: host ESRCH', r.after.hostKill0.alive === false && r.after.hostKill0.code === 'ESRCH', r.after.hostKill0);
  const cimByPid = allOf(r.after.cim.byPid);
  const cimChildren = allOf(r.after.cim.childrenOf);
  const remaining = [...cimByPid, ...cimChildren].filter(isOurs);
  check('CIM answered after exit', r.after.cim.ok === true, r.after.cim.ok);
  check('CIM: no owned host/child node process remains', remaining.filter((p) => !isConhost(p)).length === 0, { byPid: cimByPid, children: cimChildren });
  check('CIM: no conhost.exe of owned host/child remains', remaining.filter(isConhost).length === 0, remaining.filter(isConhost), 'observation');
  check('driver-native schema directory absent', r.after.schemaDirectoryExists === false, r.after.schemaDirectoryExists);
  const expectResidue = def.hold === 'empty-marker';
  const residue = r.after.rootListing.filter((n) => n.endsWith('.pending') || n.endsWith('.pause'));
  if (!expectResidue) check('no .pending/.pause residue in root', residue.length === 0, residue);
  if (def.mode === 'success') check('outcome resolved {"ok":true}', isDeepStrictEqual(s.outcome, { kind: 'resolved', finalResponse: '{"ok":true}' }), s.outcome);
  if (def.mode === 'error')
    check('outcome rejected with fixture failure, code 7', s.outcome?.kind === 'rejected' && s.outcome.message.includes('Controlled schema fixture failure') && s.outcome.message.includes('code 7'), s.outcome);
  if (def.mode === 'abort') check('outcome rejected AbortError', s.outcome?.kind === 'rejected' && s.outcome.name === 'AbortError', s.outcome);
  const recordExpected = def.hold !== 'empty-marker';
  if (recordExpected) {
    check('record present', Boolean(rec), Boolean(rec));
    if (rec) {
      check('strict schema bytes exact', rec.schemaText === QA_SCHEMA_TEXT, rec.schemaText);
      check('strict schema parsed equal', isDeepStrictEqual(rec.schema, QA_SCHEMA), rec.schema);
      const argvExpected = ['--experimental-json', '--sandbox', 'read-only', '--cd', r.root, '--skip-git-repo-check', '--output-schema', rec.schemaPath, '--config', 'approval_policy="never"'];
      check('SDK argv exact (no model/baseUrl/apiKey/config extras)', isDeepStrictEqual(rec.argv, argvExpected), rec.argv);
      check('schema dir directly under my TEMP', path.dirname(rec.schemaDirectory) === r.temp, rec.schemaDirectory);
      check('schema dir name gg-schema-[A-Za-z0-9]{6}', /^gg-schema-[A-Za-z0-9]{6}$/.test(path.basename(rec.schemaDirectory)), path.basename(rec.schemaDirectory));
      check('schemaPath = dir/schema.json', rec.schemaPath === path.join(rec.schemaDirectory, 'schema.json'), rec.schemaPath);
      if (def.length === 226) {
        check('TEMP length 226', r.temp.length === 226, r.temp.length);
        check('schemaDirectory length 243', rec.schemaDirectory.length === 243, rec.schemaDirectory.length);
        check('schemaPath length 255', rec.schemaPath.length === 255, rec.schemaPath.length);
      }
      check('host schemaDirectoryExistsAfter false', s.schemaDirectoryExistsAfter === false, s.schemaDirectoryExistsAfter);
      check('host childAliveAfter false (own kill0 check ran)', s.childAliveAfter === false, s.childAliveAfter);
      check('record pid is the child pid', rec.pid === childPid, rec.pid);
    }
  }
  const fault = def.controls?.observerFault;
  if (!fault && def.hold !== 'empty-marker') {
    check('stderr empty', r.stderr === '', r.stderr);
    check('no observationError', s.observationError === undefined, s.observationError);
    check('final marker bytes = JSON.stringify(record)', r.marker.exists && rec && r.marker.bytes === JSON.stringify(rec), r.marker);
  }
  if (def.mode === 'abort' && !fault && def.hold !== 'empty-marker')
    check('schemaPresentAtAbort true', s.schemaPresentAtAbort === true, s.schemaPresentAtAbort);
  if (fault || def.hold === 'empty-marker') {
    const oe = s.observationError;
    check('observationError recorded', Boolean(oe), oe);
    check('stderr carries original observation message', Boolean(oe) && r.stderr.includes(oe.message), r.stderr);
    check('stderr stack points at original observer read/parse line 78', r.stderr.includes('sdk-schema-case.mjs:78'), r.stderr);
    check('original fault not masked by AbortError in stderr', !r.stderr.includes('AbortError'), r.stderr);
    if (fault === 'read') {
      check('observationError Error/ENOENT', oe?.name === 'Error' && oe?.code === 'ENOENT', oe);
      check('stderr names ENOENT on the final marker', r.stderr.includes('ENOENT') && r.stderr.includes('schema-record.json'), r.stderr);
      check('final marker absent (observer unlinked it)', r.marker.exists === false, r.marker);
    }
    if (fault === 'parse') {
      check('observationError SyntaxError', oe?.name === 'SyntaxError', oe);
      check('stderr names SyntaxError', r.stderr.includes('SyntaxError'), r.stderr);
      check('final marker bytes exactly "{"', r.marker.exists && r.marker.bytes === '{', r.marker);
    }
    if (def.hold === 'empty-marker') {
      check('observationError SyntaxError: Unexpected end of JSON input', oe?.name === 'SyntaxError' && oe?.message === 'Unexpected end of JSON input', oe);
      check('stderr names SyntaxError: Unexpected end of JSON input', r.stderr.includes('SyntaxError: Unexpected end of JSON input'), r.stderr);
      check('final marker is the 0-byte injected file', r.marker.exists && r.marker.length === 0, r.marker);
      check('host record undefined (parse failed before assignment)', rec === undefined, rec, 'prediction');
      check('host childAliveAfter undefined (host self-check skipped without record)', s.childAliveAfter === undefined, s.childAliveAfter, 'prediction');
      check('host schemaDirectoryExistsAfter undefined', s.schemaDirectoryExistsAfter === undefined, s.schemaDirectoryExistsAfter, 'prediction');
      check('residue: pending sibling remains (CLI terminated before finally)', r.hold?.established && fs.existsSync(r.hold.pendingFile), residue, 'prediction');
      check('residue: hold pause file remains', r.after.rootListing.includes('qa-hold.paused'), r.after.rootListing, 'prediction');
    }
  }
  if (def.controls?.publicationBarrier) {
    const w = s.publicationWindow;
    check('publicationWindow recorded', Boolean(w), w);
    if (w) {
      check('window: finalMarkerExists false', w.finalMarkerExists === false, w.finalMarkerExists);
      check('window: workSettled false', w.workSettled === false, w.workSettled);
      check('window: observerWaiting true (source literal; not independent evidence)', w.observerWaiting === true, w.observerWaiting, 'self-report');
      check('window: pendingFileExistsAfter false', w.pendingFileExistsAfter === false, w.pendingFileExistsAfter);
      check('window: pendingRecord deep-equals final record', isDeepStrictEqual(w.pendingRecord, rec), w.pendingRecord);
      check('driver-native: pending path absent after', !fs.existsSync(w.pendingFile), w.pendingFile);
      check('host pause/release files present', r.after.rootListing.includes('schema-record.json.paused') && r.after.rootListing.includes('schema-record.json.release'), r.after.rootListing);
    }
  }
  if (def.hold) {
    const h = r.hold;
    check('external hold established (producer paused on my barrier)', h?.established === true, h?.established ? 'established' : h);
    if (h?.established) {
      for (const [i, smp] of h.samples.entries()) {
        const n = `hold sample ${i + 1}`;
        check(`${n}: final marker absent (ENOENT)`, smp.finalMarker.exists === false && smp.finalMarker.code === 'ENOENT', smp.finalMarker);
        check(`${n}: pending sibling complete JSON, bytes stable`, smp.pending.exists && smp.pending.parse && smp.pending.unchanged, smp.pending);
        check(`${n}: pending sibling has no open handle (EXLOCK open ok)`, smp.pendingExclusiveOpen.ok === true, smp.pendingExclusiveOpen, exlockValid ? 'criterion' : 'instrument-unavailable');
        check(`${n}: SDK schema.json still present with my bytes (SDK cleanup not run)`, smp.schemaFile.exists && smp.schemaFile.bytesEqualQaSchema, smp.schemaFile);
        check(`${n}: child kill0 alive`, smp.childKill0.alive === true, smp.childKill0);
        check(`${n}: host alive`, smp.hostAlive === true, smp.hostAlive);
        check(`${n}: host state.json absent`, smp.stateFileExists === false, smp.stateFileExists);
        check(`${n}: host stdout empty`, smp.hostStdoutBytes === 0, smp.hostStdoutBytes);
      }
      check('hold samples span >= 250 ms', h.samples[1].t - h.samples[0].t >= 250, h.samples[1].t - h.samples[0].t);
      check('pending pid = child pid and schemaText = my bytes', h.pending.pid === h.childPid && h.pending.schemaText === QA_SCHEMA_TEXT, { pid: h.pending.pid });
      check('pending name is <record>.<childpid>.<uuid>.pending', new RegExp(`^schema-record\\.json\\.${h.childPid}\\.[0-9a-f-]{36}\\.pending$`).test(path.basename(h.pendingFile)), path.basename(h.pendingFile));
      const ca = h.cimAlive;
      check('CIM alive probe answered', ca.ok === true, ca.ok ?? ca);
      if (ca.ok) {
        const cimDuring = ca.cimEndMs < h.action.t;
        const netDuring = ca.netEndMs < h.action.t;
        check('CIM process queries completed during hold (before action)', cimDuring, { startMs: ca.startMs, cimEndMs: ca.cimEndMs, actionMs: h.action.t });
        const c = arr(ca.byPid?.[String(h.childPid)]);
        check('CIM: child exists with parent = owned host pid, node.exe', c.length === 1 && c[0].ParentProcessId === r.hostPid && c[0].Name.toLowerCase() === 'node.exe', c);
        check('CIM: child command line = SDK exec with my --output-schema', c.length === 1 && c[0].CommandLine.includes('exec --experimental-json') && c[0].CommandLine.includes(h.pending.schemaPath), c[0]?.CommandLine);
        const kids = arr(ca.childrenOf?.[String(r.hostPid)]);
        check('CIM: exactly one non-conhost child of owned host = SDK child', kids.filter((p) => !isConhost(p)).length === 1 && kids.find((p) => !isConhost(p))?.ProcessId === h.childPid, kids);
        const grand = arr(ca.childrenOf?.[String(h.childPid)]);
        check('CIM: SDK child has no non-conhost children (no codex.exe/provider process)', grand.filter((p) => !isConhost(p)).length === 0, grand);
        const tcp = allOf(ca.tcp);
        const udp = allOf(ca.udp);
        check('TCP/UDP endpoint queries completed during hold (before action)', netDuring, { netEndMs: ca.netEndMs, actionMs: h.action.t });
        check('no TCP/UDP endpoints owned by host or child', tcp.length === 0 && udp.length === 0, { tcp, udp });
      }
      if (def.hold === 'release') {
        check('final marker appeared after release', Number.isInteger(h.markerSeenMs), h.markerSeenMs);
        check('final marker bytes identical to held closed sibling', r.marker.exists && r.marker.sha256 === h.pendingSha256, { marker: r.marker.sha256, held: h.pendingSha256 });
        check('host record deep-equals held sibling', isDeepStrictEqual(rec, h.pending), rec?.pid);
        check('held pending path absent after', !fs.existsSync(h.pendingFile), h.pendingFile);
      }
    }
  }
  return finish();
  function finish() {
    r.checks = checks;
    r.pass = checks.filter((c) => c.kind === 'criterion').every((c) => c.pass);
    r.predictionsMet = checks.filter((c) => c.kind === 'prediction').every((c) => c.pass);
  }
}

// ---------- main ----------
const summary = { cases: [], controls: [] };
let exitCode = 0;
try {
  const pre = preflight();
  ledger.preflight = pre;
  writeJson(path.join(OUT, 'preflight.json'), pre);
  event('preflight', { ok: pre.ok, checks: pre.checks });
  if (!pre.ok) throw new Error('Preflight binding mismatch; no cases run');
  await startProbe();
  const c1 = await controlExlock();
  exlockValid = c1.pass;
  writeJson(path.join(OUT, 'controls', 'C1-exlock.json'), c1);
  event('control', { id: 'C1', pass: c1.pass });
  const c2 = await controlKill0Cim();
  writeJson(path.join(OUT, 'controls', 'C2-kill0-cim.json'), c2);
  event('control', { id: 'C2', pass: c2.pass });
  summary.controls.push({ id: 'C1', pass: c1.pass }, { id: 'C2', pass: c2.pass });
  const recordedPids = [probe.pid, c2.pid];
  for (const def of CASE_DEFS) {
    const r = await runCase(def);
    recordedPids.push(r.hostPid);
    if (r.after.childPid) recordedPids.push(r.after.childPid);
    summary.cases.push({
      id: r.id,
      pass: r.pass,
      predictionsMet: r.predictionsMet,
      hostPid: r.hostPid,
      childPid: r.after.childPid,
      exit: r.exit,
      durationMs: r.timing.durationMs,
      failed: r.checks.filter((c) => !c.pass).map((c) => `${c.kind}: ${c.name}`),
      checkCount: r.checks.length,
    });
  }
  const sweep = await cim(
    { pids: recordedPids.filter((p) => p !== probe.pid), parents: [], commandLineLike: ['i4-363-marker-qa'], net: false },
    20000,
  );
  const casesPrefix = CASES + path.sep;
  const sweepHits = allOf(sweep.commandLineLike).filter(
    (p) => (p.CommandLine ?? '').includes(casesPrefix) || (p.CommandLine ?? '').includes('c2-sleeper-marker'),
  );
  const pidHits = allOf(sweep.byPid).filter((p) => (p.CommandLine ?? '').includes(SCRATCH));
  summary.finalSweep = { recordedPids, pidHits, sweepHits, pass: sweep.ok === true && pidHits.length === 0 && sweepHits.length === 0 };
  writeJson(path.join(OUT, 'final-process-sweep.json'), { sweep, ...summary.finalSweep });
  event('final-sweep', { pass: summary.finalSweep.pass, pidHits: pidHits.length, sweepHits: sweepHits.length });
} catch (error) {
  summary.driverError = { name: error.name, message: error.message, stack: error.stack };
  event('driver-error', summary.driverError);
} finally {
  if (probe) {
    summary.probeStop = await stopProbe();
    fs.writeFileSync(path.join(OUT, 'probe-stdout.log'), Buffer.concat(probe.out), { flag: 'wx' });
    fs.writeFileSync(path.join(OUT, 'probe-stderr.log'), Buffer.concat(probe.err), { flag: 'wx' });
    summary.probe = { pid: probe.pid, ready: probe.ready, requests: reqSeq };
  }
  summary.driverEnvAtEnd = pickEnv();
  summary.allCasesPass = summary.cases.length === CASE_DEFS.length && summary.cases.every((c) => c.pass);
  summary.allPredictionsMet = summary.cases.every((c) => c.predictionsMet);
  summary.allControlsPass = summary.controls.length === 2 && summary.controls.every((c) => c.pass);
  summary.ok = !summary.driverError && summary.allCasesPass && summary.allControlsPass && summary.finalSweep?.pass === true;
  ledger.finishedUtc = new Date().toISOString();
  writeJson(path.join(OUT, 'summary.json'), summary);
  writeJson(path.join(OUT, 'ledger.json'), ledger);
  exitCode = summary.ok ? 0 : 1;
  process.stdout.write(JSON.stringify({ ok: summary.ok, cases: summary.cases.map((c) => [c.id, c.pass, c.failed]) }) + '\n');
}
process.exitCode = exitCode;
