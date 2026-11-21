// GraphGoblin #459 independent QA fixture: substitute read-only launcher helper, installed only as
// apps/api/dist/instance-identity.js inside a disposable fixture repository copy (not product code).
// Its behaviour per call comes from the case scenario file named by QA459_SCENARIO.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { CODES, handshake } from '../../../qa/handshake.mjs';

const qaDir = fileURLToPath(new URL('../../../qa/', import.meta.url));
const scenario = JSON.parse(readFileSync(process.env.QA459_SCENARIO, 'utf8'));
const kind = process.argv[2] === '--store-state' ? 'store-state' : 'identity';
const eventsFile = join(scenario.caseDir, 'events.ndjson');
const log = (record) =>
  appendFileSync(eventsFile, JSON.stringify({ at: Date.now(), pid: process.pid, kind, ...record }) + '\n');
const previous = existsSync(eventsFile)
  ? readFileSync(eventsFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((event) => event.event === 'helper-start' && event.kind === kind).length
  : 0;
const index = previous + 1;
const role = `${kind}-${index}`;
const spec =
  kind === 'identity'
    ? scenario.identity
    : (scenario.storeState?.[index - 1] ?? scenario.storeStateDefault ?? { stdout: 'free' });
log({ event: 'helper-start', index, role });
process.on('exit', (code) => log({ event: 'helper-exit', index, role, code }));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

let socket;
try {
  socket = await handshake(role, { helper: kind, index });
} catch {
  process.exit(CODES.setupFault);
}

const awaited = [];
const expectedReady = [];
for (const member of spec.members ?? []) {
  const stdio = {
    stdout: ['ignore', 'inherit', 'ignore'],
    stderr: ['ignore', 'ignore', 'inherit'],
    both: ['ignore', 'inherit', 'inherit'],
    none: ['ignore', 'ignore', 'ignore'],
  }[member.stdio];
  // Ordinary detached child: no libuv kill-on-close job and no breakaway flag.
  const child = spawn(
    process.execPath,
    [join(qaDir, 'member.mjs'), encode({ role: member.role, lifetimeMs: member.lifetimeMs, caseDir: scenario.caseDir })],
    { detached: true, stdio, windowsHide: true },
  );
  child.unref();
  expectedReady.push(member.role);
}
if (spec.psQuery) {
  const query = spec.psQuery;
  const env = {
    ...process.env,
    QA459_PS_ROLE: query.role,
    QA459_PS_LIFETIME_MS: String(query.lifetimeMs),
    QA459_PS_QUERY_PID: String(scenario.queryPid),
    QA459_CASE_DIR: scenario.caseDir,
    QA459_NODE: process.execPath,
    QA459_MEMBER: join(qaDir, 'member.mjs'),
  };
  if (query.nested) {
    env.QA459_PS_NESTED = encode({ role: query.nested.role, lifetimeMs: query.nested.lifetimeMs, caseDir: scenario.caseDir });
    expectedReady.push(query.nested.role);
  }
  // Same shape as the real helper's execFile query: a non-detached child with private pipes.
  const powershell = spawn(
    join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-Command', readFileSync(join(qaDir, 'ps-query.ps1'), 'utf8')],
    { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  powershell.stdout.resume();
  powershell.stderr.resume();
  expectedReady.push(query.role);
  if (query.await) awaited.push(new Promise((resolve) => powershell.once('exit', resolve)));
  else powershell.unref();
}
// Exact handles for every descendant exist before the helper does its observable work.
const readyDeadline = Date.now() + 12_000;
while (expectedReady.some((name) => !existsSync(join(scenario.caseDir, 'ready', name)))) {
  if (Date.now() > readyDeadline) {
    log({ event: 'helper-ready-timeout', index, role });
    break;
  }
  await sleep(20);
}
log({ event: 'helper-members-ready', index, role });
if (spec.delayMs) await sleep(spec.delayMs);
if (awaited.length) await Promise.all(awaited);
if (spec.stderrFloodBytes) {
  const line = `QA459-SYNTHETIC-FLOOD ${scenario.sentinel} ${'x'.repeat(200)}\n`;
  for (let written = 0; written < spec.stderrFloodBytes; written += line.length) process.stderr.write(line);
}
if (spec.stderrSentinel) process.stderr.write(`QA459-SYNTHETIC-PRIVACY ${scenario.sentinel}\n`);
const outputs = {
  identity: () => scenario.identityValue + '\n',
  free: () => JSON.stringify({ state: 'free' }) + '\n',
  held: () =>
    JSON.stringify({
      state: 'held',
      path: join(process.env.GG_DATA_DIR, 'graphgoblin.lock'),
      detail:
        'another GraphGoblin process holds this store; check its port/configuration or let startup/shutdown finish',
    }) + '\n',
  malformed: () => 'QA459-not-a-protocol-value\n',
  'invalid-utf8': () => Buffer.from([0xff, 0xfe, 0x41, 0x0a]),
  none: () => '',
  // qa459-ext/1: exact stdout sizes and strict UTF-8 inside an otherwise valid ownership answer.
  'identity-padded': () => {
    const head = Buffer.from(scenario.identityValue + '\n');
    return Buffer.concat([head, Buffer.alloc(spec.padTo - head.length, 0x20)]);
  },
  filler: () => Buffer.alloc(spec.bytes, 0x78),
  'held-bad-utf8': () => {
    const path = join(process.env.GG_DATA_DIR, 'graphgoblin.lock');
    const text = JSON.stringify({ state: 'held', path: `${path}#MARK`, detail: 'another GraphGoblin process holds this store; check its port/configuration or let startup/shutdown finish' }) + '\n';
    const [before, after] = text.split('#MARK');
    return Buffer.concat([Buffer.from(before), Buffer.from([0xff]), Buffer.from(after)]);
  },
};
const output = outputs[spec.stdout ?? 'none']();
if (output.length) process.stdout.write(output);
log({ event: 'helper-output-written', index, role, stdout: spec.stdout ?? 'none' });
process.exitCode = spec.exitCode ?? 0;
if (spec.hang) {
  // A running root that never answers; bounded natural lifetime.
  setTimeout(() => process.exit(CODES.rootMaxLife), spec.maxLifeMs ?? 90_000);
} else socket.destroy();
