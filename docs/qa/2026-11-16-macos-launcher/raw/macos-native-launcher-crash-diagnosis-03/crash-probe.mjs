import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, opendirSync, readSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';

const NODE = '/opt/homebrew/Cellar/node@22/22.22.2_2/bin/node';
const NODE_SHA = 'e67e9c664f5b3d6d9fc0050ac895d8f30d213ce340c84439750edc9cc449d010';
const UID = 501n, DEV = 16777232n, REPORT_CAP = 2 * 1024 ** 2;
const HOME = '/Users/jake', CACHE = HOME + '/Library/Caches';
const SCOPE = CACHE + '/graphgoblin-456-qa-54a825d1';
const REPO = CACHE + '/graphgoblin-456-product-build-db37bfdf935746039f9030c4d49b10fb/repo';
const GATEWAY = NODE + ' ' + REPO + '/apps/api/dist/main.js';
const PORTS = [62241, 62242];
const APP = HOME + '/Applications/GraphGoblin QA \u00fc-54a825d1.app';
const BINARY = APP + '/Contents/MacOS/GraphGoblin';
const ID = 'c908e6ef553d4cb4871644a9674a5c7b';
const BUNDLE_ID = 'com.graphgoblin.launcher.instance.' + ID;
const RECEIPT = HOME + '/Library/Application Support/GraphGoblin/LauncherInstalls/' + ID + '.json';
const DATA = SCOPE + '/data/QA data u\u0308 %41 #1';
const PID = 45243, START = Date.parse('2026-11-16T21:04:13.989Z'), CRASH = START + 751;
const env = { HOME, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C', LC_ALL: 'C' };
const knownFiles = [
  [BINARY, 725576, '700', '56766e122f6fda499390064c0a947e4b342c6f4ffb81213d557d1ea332fb6ffe'],
  [APP + '/Contents/Info.plist', 960, '600', '8105dce97e1ae1177ea3cf0236b69925d118c7157ba3c4cdf928c2334826caf4'],
  [APP + '/Contents/Resources/launcher.json', 332, '600', '53809519874a46057fa45107c9379bfa23bb628204fe1b5b25baca8c8367701e'],
  [RECEIPT, 16_384, '600', '456acdc6d69bc09615385e3ae0ba26c12321d51382b1259de6602d3f399a9e4d', '178892209'],
];
const sha = (value) => createHash('sha256').update(value).digest('hex');
const must = (ok, message) => { if (!ok) throw Error(message); };
const utf8 = new TextDecoder('utf-8', { fatal: true });
const identity = (stat) => ({ device: BigInt.asUintN(64, stat.dev).toString(), inode: BigInt.asUintN(64, stat.ino).toString() });
const mode = (stat) => (stat.mode & 0o7777n).toString(8);
const same = (a, b) => a.mode === b.mode && a.size === b.size && a.nlink === b.nlink && a.uid === b.uid &&
  a.dev === b.dev && a.ino === b.ino && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
const observed = (path) => {
  try { return lstatSync(path, { bigint: true }); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
};
function directory(path, privateMode = false) {
  const st = lstatSync(path, { bigint: true });
  must(st.isDirectory() && st.uid === UID && st.dev === DEV && realpathSync(path).normalize('NFC') === path.normalize('NFC') &&
    (st.mode & (privateMode ? 0o077n : 0o022n)) === 0n, 'directory identity or privacy mismatch: ' + path);
  return st;
}
function file(path, cap, device = DEV) {
  const before = lstatSync(path, { bigint: true });
  must(before.isFile() && before.uid === UID && before.nlink === 1n && (device === null || before.dev === device) &&
    before.size <= BigInt(cap) && realpathSync(path).normalize('NFC') === path.normalize('NFC'), 'unsafe report or fixture file');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    must(same(before, fstatSync(fd, { bigint: true })), 'file changed before read');
    const bytes = Buffer.alloc(Number(before.size));
    for (let pos = 0; pos < bytes.length;) {
      const count = readSync(fd, bytes, pos, bytes.length - pos, pos);
      must(count > 0, 'short file read'); pos += count;
    }
    must(readSync(fd, Buffer.alloc(1), 0, 1, bytes.length) === 0 && same(before, fstatSync(fd, { bigint: true })) &&
      same(before, lstatSync(path, { bigint: true })), 'file changed while reading');
    return { bytes, stat: before, sha256: sha(bytes) };
  } finally { closeSync(fd); }
}

function installation() {
  const app = directory(APP, true), parent = directory(dirname(APP));
  must(identity(app).inode === '178892200' && identity(parent).inode === '1116841', 'installed generation changed');
  for (const relative of ['Contents', 'Contents/MacOS', 'Contents/Resources']) directory(join(APP, relative), true);
  const files = knownFiles.map(([path, cap, perms, digest, inode]) => {
    const read = file(path, cap);
    must(read.sha256 === digest && mode(read.stat) === perms && (inode === undefined || identity(read.stat).inode === inode),
      'installed artifact or external receipt changed');
    return { path, bytes: read.bytes.length, sha256: read.sha256, ...identity(read.stat) };
  });
  return { matchesInstalledA: true, app: APP, bundle: identity(app), applications: identity(parent), installationId: ID, files };
}
function leases() {
  directory(SCOPE, true); directory(dirname(DATA), true);
  if (!observed(DATA)) return { dataDirectory: 'absent', names: [] };
  const st = directory(DATA, true);
  const names = ['graphgoblin.lock', 'graphgoblin.lock.reclaim', 'graphgoblin.db.graphgoblin.lock', 'graphgoblin.db.graphgoblin.lock.reclaim'];
  return { dataDirectory: 'present', identity: identity(st), names: names.map((name) => {
    const item = observed(join(DATA, name));
    if (!item) return { name, present: false };
    return { name, present: true, kind: item.isFile() ? 'file' : item.isDirectory() ? 'dir' : item.isSymbolicLink() ? 'symlink' : 'other',
      uid: Number(item.uid), mode: mode(item), ...identity(item) };
  }) };
}
const inspect = (fn) => { try { return fn(); } catch (error) { return { error: String(error.message).slice(0, 512) }; } };
function native(exe, args) {
  return new Promise((done) => execFile(exe, args, { env, cwd: '/', timeout: 3000, maxBuffer: 1024 ** 2, encoding: 'utf8' },
    (error, stdout, stderr) => done({ code: error?.code ?? 0, signal: error?.signal ?? null, stdout, stderr })));
}
async function listeners(port) {
  const r = await native('/usr/sbin/lsof', ['-nP','-a','-iTCP:' + port,'-sTCP:LISTEN','-F','pn']);
  const rows = []; let pid;
  for (const line of r.stdout.split('\n')) {
    if (/^p\d+$/.test(line)) pid = Number(line.slice(1));
    else if (line.startsWith('n') && pid) rows.push({ pid, address: line.slice(1) });
  }
  const status = r.code === 0 && rows.length && !r.stderr ? 'listeners' :
    r.code === 1 && !r.signal && !r.stdout && !r.stderr ? 'no-listener-observed' : 'unverified';
  return { port, status, code: r.code, signal: r.signal, rows };
}
async function processes() {
  const r = await native('/bin/ps', ['-A','-ww','-o','pid=,uid=,lstart=,command=']);
  const rows = [], pidReusedOrVisible = [];
  for (const line of r.stdout.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\w{3} +\w{3} +\d{1,2} \d\d:\d\d:\d\d \d{4})\s+(.*)$/.exec(line);
    if (!m) continue;
    if (Number(m[1]) === PID) pidReusedOrVisible.push({ pid: PID, uid: Number(m[2]), birth: m[3], exactLauncher: m[4] === BINARY + ' --ensure-gateway' });
    if (m[2] === '501' && m[4] === GATEWAY) rows.push({ pid: Number(m[1]), uid: 501, birth: m[3] });
  }
  return { status: r.code === 0 && !r.signal && !r.stderr ? 'snapshot' : 'unverified', code: r.code,
    sameCheckoutGateways: rows, crashPidNow: pidReusedOrVisible };
}

function timestamp(value) {
  if (typeof value !== 'string') return NaN;
  const m = /^(\d{4}-\d\d-\d\d)[ T](\d\d:\d\d:\d\d)(?:\.(\d+))?\s*(Z|[+-]\d\d:?\d\d)$/.exec(value);
  if (!m) return NaN;
  const zone = m[4].length === 5 ? m[4].slice(0, 3) + ':' + m[4].slice(3) : m[4];
  return Date.parse(m[1] + 'T' + m[2] + '.' + (m[3] ?? '').padEnd(3, '0').slice(0, 3) + zone);
}
function parseReport(bytes) {
  const text = utf8.decode(bytes), split = text.indexOf('\n');
  try { return [{}, JSON.parse(text)]; } catch {
    if (split < 0) throw Error('no crash body');
    return [JSON.parse(text.slice(0, split)), JSON.parse(text.slice(split + 1))];
  }
}
const pick = (value, keys) => Object.fromEntries(keys.flatMap((name) => {
  const field = value?.[name];
  if (typeof field === 'string') return [[name, field.slice(0, 512)]];
  if (typeof field === 'boolean' || Number.isFinite(field)) return [[name, field]];
  return [];
}));
function projection(header, body) {
  const threadIndex = Number.isInteger(body.faultingThread) ? body.faultingThread : body.threads?.findIndex((t) => t.triggered === true);
  const thread = body.threads?.[threadIndex];
  const frames = (thread?.frames ?? []).slice(0, 96).map((frame) => pick(frame, ['imageIndex','imageOffset','symbol','symbolLocation','instructionAddr']));
  const imageIndexes = [...new Set(frames.map((frame) => frame.imageIndex))].filter(Number.isInteger);
  const images = imageIndexes.map((index) => ({ index, ...pick(body.usedImages?.[index], ['name','path','base','size','uuid','arch','source']) }));
  const register = (key) => pick(thread?.threadState?.[key], ['value','description','matchesCrashFrame']);
  return {
    ...pick(body, ['pid','procName','procPath','userID','captureTime','procLaunch','incident','translated']),
    bundle: pick(body.bundleInfo, ['CFBundleIdentifier','CFBundleVersion','CFBundleShortVersionString']),
    header: pick(header, ['timestamp','slice_uuid','incident_id','bug_type']),
    exception: { ...pick(body.exception, ['type','signal','subtype','codes']), rawCodes: body.exception?.rawCodes?.filter(Number.isFinite).slice(0,4) },
    termination: pick(body.termination, ['namespace','code','flags','indicator']),
    faultingThread: { index: threadIndex, ...pick(thread, ['id','name','queue','triggered']),
      state: Object.fromEntries(['pc','lr','sp','far','esr','cpsr'].map((key) => [key, register(key)])), frames, images },
  };
}
const REPORTS = HOME + '/Library/Logs/DiagnosticReports';
function crashDirectoryFacts(path) {
  const st = observed(path);
  if (!st) return { path, present: false };
  const realpath = inspect(() => realpathSync(path));
  return { path, present: true, realpath, uid: Number(st.uid), gid: Number(st.gid), mode: mode(st), ...identity(st),
    kind: st.isDirectory() ? 'directory' : st.isSymbolicLink() ? 'symlink' : 'other' };
}
function inspectCrash() {
  const directories = { parent: inspect(() => crashDirectoryFacts(dirname(REPORTS))),
    reports: inspect(() => crashDirectoryFacts(REPORTS)) };
  return { directories, ...inspect(() => crashReport(directories)) };
}
function crashReport({ parent, reports }) {
  const path = REPORTS;
  if (reports.present === false) return { status: 'no-user-crash-directory' };
  const reportDirectory = () => {
    const st = lstatSync(path, { bigint: true });
    // This fixed Apple directory is read-only here. Its system group may write it.
    must(st.isDirectory() && st.uid === UID && st.dev === DEV && (st.mode & 0o002n) === 0n &&
      realpathSync(path) === path, 'unsafe DiagnosticReports directory');
    return st;
  };
  const stillBound = () => {
    const homeLogs = directory(dirname(path));
    const current = reportDirectory();
    must(identity(homeLogs).inode === parent.inode && identity(current).inode === reports.inode &&
      mode(homeLogs) === parent.mode && mode(current) === reports.mode &&
      Number(homeLogs.gid) === parent.gid && Number(current.gid) === reports.gid, 'crash directory identity changed');
  };
  stillBound();
  const stream = opendirSync(path);
  const candidates = []; let count = 0;
  try {
    for (let entry; (entry = stream.readSync()) !== null;) {
      must(++count <= 2048, 'crash directory listing exceeded cap');
      if (!entry.isFile() || !/^GraphGoblin[-_][A-Za-z0-9_.-]{1,125}\.ips$/.test(entry.name)) continue;
      const filePath = join(path, entry.name), stat = observed(filePath);
      if (stat?.isFile() && stat.uid === UID && stat.size <= BigInt(REPORT_CAP) &&
        Number(stat.mtimeMs) >= START - 2000 && Number(stat.mtimeMs) <= CRASH + 120_000) {
        candidates.push({ filePath, name: entry.name, stat });
      }
    }
  } finally { stream.closeSync(); }
  must(candidates.length <= 16, 'too many recent GraphGoblin reports');
  const matches = [];
  const candidateChecks = [];
  let unreadable = 0;
  for (const candidate of candidates) {
    try {
      stillBound();
      const raw = file(candidate.filePath, REPORT_CAP);
      stillBound();
      const [header, body] = parseReport(raw.bytes);
      const time = timestamp(body.captureTime ?? header.timestamp);
      const launch = timestamp(body.procLaunch);
      const bundleID = body.bundleInfo?.CFBundleIdentifier ?? header.bundleID;
      const checks = {
        pid: body.pid === PID,
        name: body.procName === 'GraphGoblin',
        path: body.procPath?.normalize('NFC') === BINARY.normalize('NFC'),
        bundle: bundleID === BUNDLE_ID,
        time: Number.isFinite(time) && time >= START - 2000 && time <= CRASH + 10_000,
        launch: !Number.isFinite(launch) || Math.abs(launch - START) <= 2000,
      };
      const scalars = checks.pid && checks.name ? {
        ...pick(body, ['captureTime','procLaunch','procPath']),
        ...pick(header, ['timestamp']),
        bundleID: typeof bundleID === 'string' ? bundleID.slice(0, 512) : null,
      } : undefined;
      candidateChecks.push({ checks, scalars });
      if (!Object.values(checks).every(Boolean)) continue;
      const rawText = utf8.decode(raw.bytes);
      const sensitiveCanary = /"(?:env|environment|launchEnvironment|processEnvironment)"\s*:|GG_MASTER_KEY|NODE_OPTIONS|OPENAI_API_KEY|ANTHROPIC_API_KEY|Bearer\s+[A-Za-z0-9]/i.test(rawText);
      matches.push({ name: candidate.name, identity: identity(raw.stat), bytes: raw.bytes.length, sha256: raw.sha256,
        selected: projection(header, body), rawWithheld: sensitiveCanary,
        rawBase64: sensitiveCanary ? undefined : raw.bytes.toString('base64') });
    } catch { unreadable++; }
  }
  if (matches.length !== 1) return { status: matches.length ? 'ambiguous' : 'no-exact-match', candidates: candidates.length,
    unreadable, matches: matches.length, candidateChecks };
  return { status: 'exact-pid-time-bundle-match', candidates: candidates.length, unreadable, candidateChecks, report: matches[0] };
}

must(process.platform === 'darwin' && process.arch === 'arm64' && process.getuid() === Number(UID) &&
  process.geteuid() === Number(UID) && process.execPath === NODE && process.versions.node === '22.22.2' &&
  file(NODE, 256 * 1024, null).sha256 === NODE_SHA, 'owner runtime mismatch');
const [gatewayProcesses, p1, p2] = await Promise.all([processes(), ...PORTS.map(listeners)]);
const report = { schema: 'gg456-launcher-crash-diagnosis/v1', runId: '54a825d1', pid: PID,
  startedAt: new Date(START).toISOString(), observedCrashAt: new Date(CRASH).toISOString(), sampledAt: new Date().toISOString(),
  installation: inspect(installation), gatewayProcesses, ports: [p1,p2], leases: inspect(leases), crash: inspectCrash() };
process.stdout.write(JSON.stringify(report) + '\n');

