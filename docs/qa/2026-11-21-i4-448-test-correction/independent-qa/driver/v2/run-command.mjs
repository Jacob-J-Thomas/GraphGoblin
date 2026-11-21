// QA448 command runner. Usage: node run-command.mjs <spec.json>
// Spec: { label, cwd, program: 'node'|'pnpm', args: string[], layers: 'L1,L2'|'L2'|'L1', guard: bool,
//         observe: bool, extraEnv?: object, timeoutMs?: number }
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, openSync, closeSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DRIVER = dirname(fileURLToPath(import.meta.url));
const Q = 'C:\\Users\\98jak\\graphgoblin-qa\\2026-11-17-five-intents\\i4-448-test-independent-01';
const COMMANDS = join(Q, 'commands');
const REPO = 'G:\\ggq\\gg-i4-448-qa\\GraphGoblin';
const SOURCE = join(REPO, 'apps', 'api', 'src', 'preflight-catalog.test.ts');
const RUNTIME = 'C:\\Users\\98jak\\.claude\\codex-runs\\GraphGoblin\\runtime\\node-v22.23.4-win-x64';
const NODE = join(RUNTIME, 'node.exe');
const PNPM_CMD = 'C:\\nvm4w\\nodejs\\pnpm.cmd';
const SCRATCH = 'G:\\ggq\\qa-scratch\\i4-448-test-independent-01';

const specPath = process.argv[2];
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const label = spec.label;
if (!/^[0-9]{2}[a-z]?-[a-z0-9-]+$/.test(label)) throw new Error(`bad label ${label}`);
const base = join(COMMANDS, label);
const receiptPath = `${base}.receipt.json`;
if (existsSync(receiptPath)) throw new Error(`receipt exists: ${receiptPath}`);
copyFileSync(specPath, `${base}.spec.json`);

const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const git = (...args) =>
  execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });

const env = { ...process.env };
const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
for (const k of Object.keys(env)) if (k.toUpperCase() === 'PATH' && k !== pathKey) delete env[k];
env[pathKey] = `${RUNTIME};${env[pathKey]}`;
for (const k of Object.keys(env)) if (['TEMP', 'TMP', 'NODE_OPTIONS'].includes(k.toUpperCase())) delete env[k];
env.TEMP = SCRATCH;
env.TMP = SCRATCH;
env.npm_config_update_notifier = 'false';
const guardLog = `${base}.guard.jsonl`;
if (spec.guard) {
  env.NODE_OPTIONS = `--require=${join(DRIVER, 'guard.cjs')}`;
  env.QA448_GUARD_LOG = guardLog;
  env.QA448_GUARD_LAYERS = spec.layers ?? 'L1,L2';
  env.QA448_LABEL = label;
  if (spec.observe) {
    env.QA448_OBSERVE = '1';
    env.QA448_BLOB_DIR = join(Q, 'fixtures', `blobs-${label}`);
  }
}
for (const [k, v] of Object.entries(spec.extraEnv ?? {})) env[k] = v;
const inheritedGG = Object.keys(process.env).filter((k) => k.startsWith('GG_'));

for (const a of spec.args) if (/[\s"&|<>^%]/.test(a)) throw new Error(`unsafe arg for cmd.exe: ${a}`);
let file;
let argv;
let options = {};
if (spec.program === 'node') {
  file = NODE;
  argv = spec.args;
} else if (spec.program === 'pnpm') {
  file = process.env.ComSpec ?? 'C:\\WINDOWS\\system32\\cmd.exe';
  argv = ['/d', '/s', '/c', `"${PNPM_CMD} ${spec.args.join(' ')}"`];
  options = { windowsVerbatimArguments: true };
} else throw new Error(`program ${spec.program}`);

const before = {
  head: git('rev-parse', 'HEAD').trim(),
  status: git('status', '--porcelain=v1', '-uall'),
  sourceSha256: sha(SOURCE),
};

// Native TCP/UDP poller over this runner's descendants (the poller excludes itself).
const tcpLog = `${base}.tcp.jsonl`;
const stopFile = join(SCRATCH, `qa448-${label}.stop`);
const readyFile = join(SCRATCH, `qa448-${label}.ready`);
const poller = spawn(
  'powershell.exe',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(DRIVER, 'tcp-poll.ps1'), '-RootPid', String(process.pid), '-OutFile', tcpLog, '-StopFile', stopFile, '-ReadyFile', readyFile],
  { stdio: 'ignore', env: { ...env, NODE_OPTIONS: '' } },
);
const readyDeadline = Date.now() + 30_000;
while (!existsSync(readyFile) && Date.now() < readyDeadline) await new Promise((r) => setTimeout(r, 100));
const pollerReady = existsSync(readyFile);

const outFd = openSync(`${base}.stdout.txt`, 'wx');
const errFd = openSync(`${base}.stderr.txt`, 'wx');
const startedUtc = new Date().toISOString();
const t0 = performance.now();
const child = spawn(file, argv, { cwd: spec.cwd, env, stdio: ['ignore', outFd, errFd], ...options });
let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  try {
    execFileSync('taskkill', ['/T', '/F', '/PID', String(child.pid)]);
  } catch {}
}, spec.timeoutMs ?? 600_000);
const [exitCode, signal] = await new Promise((resolve) => child.on('exit', (c, s) => resolve([c, s])));
clearTimeout(timer);
const durationMs = Math.round(performance.now() - t0);
const finishedUtc = new Date().toISOString();
closeSync(outFd);
closeSync(errFd);
await new Promise((r) => setTimeout(r, 1500));
writeFileSync(stopFile, 'stop');
const pollerExit = await Promise.race([
  new Promise((resolve) => poller.on('exit', (c) => resolve(c))),
  new Promise((resolve) => setTimeout(() => resolve('timeout'), 20_000)),
]);

const after = {
  head: git('rev-parse', 'HEAD').trim(),
  status: git('status', '--porcelain=v1', '-uall'),
  sourceSha256: sha(SOURCE),
};

function summarizeGuard() {
  if (!existsSync(guardLog)) return { present: false };
  const lines = readFileSync(guardLog, 'utf8').split('\n').filter(Boolean);
  const events = lines.map((l) => JSON.parse(l));
  const byEvent = {};
  const byKind = {};
  for (const e of events) {
    byEvent[e.event] = (byEvent[e.event] ?? 0) + 1;
    if (e.kind) byKind[`${e.event}:${e.kind}`] = (byKind[`${e.event}:${e.kind}`] ?? 0) + 1;
  }
  return {
    present: true,
    lines: lines.length,
    byEvent,
    byKind,
    installed: events.filter((e) => e.event === 'installed').map((e) => ({ pid: e.pid, ppid: e.ppid, layers: e.layers, argv: e.argv })),
    exits: events.filter((e) => e.event === 'exit').map((e) => ({ pid: e.pid, code: e.code, counts: e.counts })),
    blockedOrAttempted: events.filter((e) => e.event === 'blocked' || e.event === 'attempt-observed').length,
  };
}
function summarizeTcp() {
  if (!existsSync(tcpLog)) return { present: false };
  const events = readFileSync(tcpLog, 'utf8').replace(/^\uFEFF/, '').split('\n').filter(Boolean).map((l) => JSON.parse(l.replace(/^\uFEFF/, '')));
  const rows = events.filter((e) => e.event === 'tcp-row' || e.event === 'udp-endpoint');
  return {
    present: true,
    trackedProcesses: events.filter((e) => e.event === 'process-tracked').map((e) => ({ pid: e.pid, name: e.name })),
    rows: rows.length,
    distinctRows: [...new Set(rows.map((r) => `${r.event} ${r.name}/${r.pid} ${r.state ?? ''} ${r.local}:${r.localPort} -> ${r.remote ?? ''}:${r.remotePort ?? ''}`))],
    stop: events.find((e) => e.event === 'poller-stop'),
  };
}

const receipt = {
  label,
  spec,
  executed: { file, argv, cwd: spec.cwd, windowsVerbatimArguments: Boolean(options.windowsVerbatimArguments) },
  environment: {
    pathHead: env[pathKey].split(';').slice(0, 2),
    TEMP: env.TEMP,
    TMP: env.TMP,
    NODE_OPTIONS: env.NODE_OPTIONS,
    QA448: Object.fromEntries(Object.entries(env).filter(([k]) => k.startsWith('QA448_'))),
    npm_config_update_notifier: env.npm_config_update_notifier,
    extraEnv: spec.extraEnv ?? {},
    inheritedGGVariables: inheritedGG,
  },
  node: { path: NODE, version: execFileSync(NODE, ['--version'], { encoding: 'utf8', env: { ...env, NODE_OPTIONS: '' } }).trim() },
  pnpm: spec.program === 'pnpm' ? { cmd: PNPM_CMD, packageVersion: JSON.parse(readFileSync('C:\\nvm4w\\nodejs\\node_modules\\pnpm\\package.json', 'utf8')).version } : undefined,
  startedUtc,
  finishedUtc,
  durationMs,
  exitCode,
  signal,
  timedOut,
  before,
  after,
  sourceUnchanged: before.sourceSha256 === after.sourceSha256 && before.head === after.head && before.status === after.status,
  poller: { ready: pollerReady, exit: pollerExit, ...summarizeTcp() },
  guard: summarizeGuard(),
  files: { stdout: `${base}.stdout.txt`, stderr: `${base}.stderr.txt`, guardLog, tcpLog },
};
writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ label, exitCode, durationMs, timedOut, sourceUnchanged: receipt.sourceUnchanged, guard: { byEvent: receipt.guard.byEvent, blockedOrAttempted: receipt.guard.blockedOrAttempted }, tcpRows: receipt.poller.rows, distinctTcp: receipt.poller.distinctRows }, null, 2));
