#!/usr/bin/env node
// GraphGoblin #459 independent native behaviour QA driver (baseline and candidate controls).
//
// Compiles the checkout's apps/windows-launcher/Launcher.cs with the shipped installer's csc
// flags, runs the normal `--config <file> --ensure-gateway` CLI against disposable stores, ports
// and private log folders, and witnesses every owned fixture process through exact native handles
// opened while the fixture is alive and blocked in a private handshake. Launcher collection is
// observed first; the driver's own teardown (release request, then exact-handle watchdog
// termination with a distinctive code) is recorded separately afterwards.
//
// Usage (Node 22 first on PATH):
//   node qa459-driver.mjs --checkout <repo> --scratch <dir> --out <dir> [--label baseline|candidate]
//        [--cases id,id] [--job-exit-code <n>] [--port-start 4871]
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import os from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { CASES } from './qa459-cases.mjs';

export const WATCHDOG_CODE = 0xa459; // 42073: driver watchdog TerminateProcess on an exact handle
export const DOTNET_KILL_CODE = 0xffffffff; // .NET Framework Process.Kill => TerminateProcess(-1)
export const CODES = {
  member: 41,
  psQuery: 43,
  gatewayDrained: 44,
  gatewayMaxLife: 45,
  sentinel: 46,
  released: 47,
  driverGone: 48,
  rootMaxLife: 49,
  setupFault: 97,
};
const GRACE_MS = 3000;
const EXIT_SLACK_MS = 32; // FILETIME granularity between two OS-recorded exit times

const { values: args } = parseArgs({
  options: {
    checkout: { type: 'string' },
    scratch: { type: 'string' },
    out: { type: 'string' },
    label: { type: 'string', default: 'baseline' },
    cases: { type: 'string' },
    'job-exit-code': { type: 'string' },
    'port-start': { type: 'string', default: '4871' },
    // detached: launcher outside the driver's libuv job, like an Explorer shortcut click.
    // job: launcher inside the driver's libuv job (KILL_ON_JOB_CLOSE + silent breakaway).
    'launcher-host': { type: 'string', default: 'detached' },
  },
});
if (!['detached', 'job'].includes(args['launcher-host'])) {
  console.error('--launcher-host must be detached or job');
  process.exit(2);
}
if (!args.checkout || !args.scratch || !args.out) {
  console.error('Usage: qa459-driver.mjs --checkout <repo> --scratch <dir> --out <dir> [--label ...]');
  process.exit(2);
}
if (process.platform !== 'win32') {
  console.error('Windows only.');
  process.exit(2);
}
const label = args.label;
const checkout = resolve(args.checkout);
const scratch = resolve(args.scratch);
const driverDir = dirname(fileURLToPath(import.meta.url));
const jobExitCode = args['job-exit-code'] === undefined ? null : Number(args['job-exit-code']);
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const runId = `${label}-${stamp}-${randomBytes(3).toString('hex')}`;
const runDir = join(scratch, 'runs', runId);
const outDir = join(resolve(args.out), runId);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const fileHash = (path) => sha256(readFileSync(path));

// ---------------------------------------------------------------- scrubbing (public outputs)
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const scrubRoots = [
  [outDir, '<OUT>'],
  [runDir, '<RUN>'],
  [scratch, '<SCRATCH>'],
  [checkout, '<CHECKOUT>'],
  [driverDir, '<DRIVER>'],
  [dirname(process.execPath), '<NODE_DIR>'],
  [os.homedir(), '<HOME>'],
].sort((a, b) => b[0].length - a[0].length);
const scrubPatterns = scrubRoots.flatMap(([path, token]) =>
  [path, path.replaceAll('\\', '/'), path.replaceAll('\\', '\\\\')].map((variant) => [
    new RegExp(escapeRegExp(variant), 'gi'),
    token,
  ]),
);
const username = os.userInfo().username;
export function scrub(text) {
  let result = String(text);
  for (const [pattern, token] of scrubPatterns) result = result.replace(pattern, token);
  result = result.replace(/\b[A-Za-z]:(?:\\\\|\\|\/)[^\s"'<>|,;]*/g, '<ABS_PATH>');
  if (username.length >= 3) result = result.replace(new RegExp(escapeRegExp(username), 'gi'), '<USER>');
  return result;
}
const scrubValue = (value) => {
  if (typeof value === 'string') return scrub(value);
  if (Array.isArray(value)) return value.map(scrubValue);
  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, item] of Object.entries(value)) result[key] = scrubValue(item);
    return result;
  }
  return value;
};

// ---------------------------------------------------------------- environment for the launcher
const ENV_ALLOW = new Set(
  [
    'SystemRoot', 'windir', 'SystemDrive', 'ComSpec', 'PATHEXT', 'Path', 'TEMP', 'TMP',
    'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'HOMEDRIVE', 'HOMEPATH', 'ProgramData',
    'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'CommonProgramFiles',
    'CommonProgramFiles(x86)', 'CommonProgramW6432', 'NUMBER_OF_PROCESSORS',
    'PROCESSOR_ARCHITECTURE', 'OS', 'USERNAME', 'USERDOMAIN', 'COMPUTERNAME', 'PSModulePath',
    'PUBLIC', 'ALLUSERSPROFILE',
  ].map((key) => key.toUpperCase()),
);
/** A minimal allowlisted environment: no GG_* and no credentials or provider settings. */
function baseEnvironment() {
  const env = {};
  for (const [key, value] of Object.entries(process.env))
    if (ENV_ALLOW.has(key.toUpperCase())) env[key.toUpperCase() === 'PATH' ? 'Path' : key] = value;
  env.Path = `${dirname(process.execPath)};${env.Path ?? ''}`;
  return env;
}

// ---------------------------------------------------------------- native witness client
class Witness {
  constructor(exe) {
    this.child = spawn(exe, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.seq = 0;
    this.pending = new Map();
    let buffer = '';
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const reply = JSON.parse(line);
        const waiter = this.pending.get(Number(reply.seq));
        if (waiter) {
          this.pending.delete(Number(reply.seq));
          waiter(reply);
        }
      }
    });
  }
  call(op, ...rest) {
    const seq = ++this.seq;
    return new Promise((done, fail) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        fail(new Error(`witness ${op} timed out`));
      }, 15_000);
      this.pending.set(seq, (reply) => {
        clearTimeout(timer);
        done(reply);
      });
      this.child.stdin.write(`${seq} ${op} ${rest.join(' ')}\n`);
    });
  }
  close() {
    this.child.stdin.end();
  }
}

const pickState = (reply) =>
  reply && reply.ok !== false
    ? {
        alive: reply.alive,
        exitCode: reply.exitCode ?? null,
        createdAtMs: reply.createdAtMs ?? null,
        exitedAtMs: reply.exitedAtMs ?? null,
      }
    : { error: reply?.error ?? reply?.win32 ?? 'unavailable' };

// ---------------------------------------------------------------- owned process registry
function naturalCodes(role) {
  if (role === 'sentinel') return [CODES.sentinel];
  if (role.startsWith('ps-query')) return [CODES.psQuery];
  if (role.startsWith('gateway-')) return [CODES.gatewayDrained, CODES.gatewayMaxLife];
  if (role.startsWith('launcher-')) return [0, 1];
  if (role.startsWith('identity-') || role.startsWith('store-state-')) return [];
  if (role === 'real-gateway' || role === 'contender') return [];
  if (role.startsWith('real-helper-')) return [0];
  return [CODES.member];
}

class Registry {
  constructor(witness, token) {
    this.witness = witness;
    this.token = token;
    this.records = [];
    this.rejected = [];
  }
  listen(pipe) {
    this.server = createNetServer((socket) => {
      let buffer = '';
      let record = null;
      socket.setEncoding('utf8');
      socket.on('error', () => {});
      socket.on('data', async (chunk) => {
        buffer += chunk;
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          let message;
          try {
            message = JSON.parse(line);
          } catch {
            continue;
          }
          if (record) {
            record.messages.push({ atMs: Date.now(), ...message });
            continue;
          }
          if (message.hello !== 1 || message.token !== this.token || !Number.isSafeInteger(message.pid)) {
            this.rejected.push({ atMs: Date.now(), reason: 'bad-hello' });
            socket.end('{"ack":false}\n');
            return;
          }
          const { token: _token, hello: _hello, ...self } = message;
          record = await this.open(message.case, message.role, message.pid, 'handshake', self);
          record.socket = socket;
          socket.write(JSON.stringify({ ack: record.opened?.ok === true }) + '\n');
        }
      });
    });
    return new Promise((done) => this.server.listen(`\\\\.\\pipe\\${pipe}`, done));
  }
  async open(caseId, role, pid, source, self = null) {
    const tag = `${caseId}/${role}/${pid}`;
    const reply = await this.witness.call('open', tag, pid);
    const record = {
      tag,
      case: caseId,
      role,
      pid,
      source,
      self,
      openedAtMs: Date.now(),
      opened: {
        ok: reply.ok,
        image: reply.image ?? null,
        parentPid: reply.parentPid ?? null,
        inAnyJob: reply.inAnyJob ?? null,
        ...pickState(reply),
      },
      naturalCodes: naturalCodes(role),
      messages: [],
      samples: {},
      teardown: null,
      socket: null,
    };
    this.records.push(record);
    return record;
  }
  forCase(caseId) {
    return this.records.filter((record) => record.case === caseId);
  }
  async state(record) {
    if (!record.opened.ok) return { error: 'not-opened' };
    return pickState(await this.witness.call('state', record.tag));
  }
}

// ---------------------------------------------------------------- shared run state
const shared = {
  runId,
  label,
  runDir,
  outDir,
  checkout,
  token: randomBytes(16).toString('hex'),
  pipe: `gg459qa-${randomBytes(8).toString('hex')}`,
  privacy: `QA459-SENTINEL-${randomBytes(6).toString('hex')}`,
  identityValue: sha256(`qa459-fixture-identity/${runId}`),
  jobExitCode,
};

class PortPool {
  constructor(start) {
    this.next = start;
    this.end = start + 60;
  }
  async take() {
    while (this.next < this.end) {
      const port = this.next++;
      const server = createNetServer();
      const free = await new Promise((done) => {
        server.on('error', () => done(false));
        server.listen(port, '127.0.0.1', () => server.close(() => done(true)));
      });
      if (free) return port;
    }
    throw new Error('No disposable QA port is available.');
  }
}

// ---------------------------------------------------------------- per-case context
class CaseContext {
  constructor(def) {
    this.def = def;
    this.id = def.id;
    this.dir = join(runDir, 'cases', def.id);
    this.invocations = [];
    this.assertions = [];
    this.setupFaults = [];
    this.notes = [];
    this.timeline = [];
    this.listeners = [];
    this.grace = GRACE_MS;
    this.codes = CODES;
    this.watchdogCode = WATCHDOG_CODE;
    this.dotnetKillCode = DOTNET_KILL_CODE;
    this.jobExitCode = jobExitCode;
    this.privacy = shared.privacy;
    this.notNode = shared.notNode;
    this.sleep = sleep;
    mkdirSync(join(this.dir, 'ready'), { recursive: true });
  }
  /** Where the synthetic privacy sentinel appeared: launcher streams and managed logs. */
  privacyLeaks() {
    const leaks = [];
    for (const invocation of this.invocations)
      for (const [stream, chunks] of [['stdout', invocation.stdoutChunks], ['stderr', invocation.stderrChunks]])
        if (Buffer.concat(chunks).toString('utf8').includes(shared.privacy)) leaks.push(`${invocation.name}:${stream}`);
    for (const name of ['launcher.log', 'launcher.log.1', 'gateway.log', 'gateway.log.1'])
      if (existsSync(join(this.dir, name)) && readFileSync(join(this.dir, name), 'utf8').includes(shared.privacy))
        leaks.push(name);
    return leaks;
  }
  /** One direct run of the checkout's shipped helper with the launcher's child environment shape. */
  async runRealHelper(name, argv = []) {
    const { config } = this.prepared;
    const env = {
      ...baseEnvironment(),
      ...config.Environment,
      GG_HOST: '127.0.0.1',
      GG_PORT: String(config.Port),
      GG_DATA_DIR: config.DataDir,
      GG_WEB_DIST: join(checkout, 'apps/web/dist'),
    };
    const startedAtMs = Date.now();
    const child = spawn(process.execPath, [join(checkout, 'apps/api/dist/instance-identity.js'), ...argv], {
      cwd: checkout,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out = [];
    const err = [];
    child.stdout.on('data', (chunk) => out.push(chunk));
    child.stderr.on('data', (chunk) => err.push(chunk));
    const closed = new Promise((done) => child.once('close', done));
    const record = await shared.registry.open(this.id, `real-helper-${name}`, child.pid, 'spawn');
    if (!record.opened.ok || !/^node\.exe$/i.test(record.opened.image ?? '') ||
      Math.abs((record.opened.createdAtMs ?? 0) - startedAtMs) > 3000)
      this.fault('real-helper-handle-unverified', record.opened);
    const settled = await Promise.race([closed.then(() => 'closed'), sleep(30_000).then(() => 'watchdog')]);
    if (settled === 'watchdog') {
      record.teardown = { action: 'watchdog-terminate', reply: pickState(await shared.witness.call('terminate', record.tag, WATCHDOG_CODE)) };
      await Promise.race([closed, sleep(5000)]);
    }
    const state = await shared.registry.state(record);
    record.samples.exit = state;
    const stdout = Buffer.concat(out).toString('utf8');
    let result = 'other';
    if (/^[a-f0-9]{64}\n$/.test(stdout)) result = 'digest';
    else
      try {
        const parsed = JSON.parse(stdout);
        result = { state: parsed.state, detailPrefix: typeof parsed.detail === 'string' ? parsed.detail.slice(0, 48) : null };
      } catch {
        result = stdout.length ? 'unparsable' : 'empty';
      }
    return {
      name,
      settled,
      exitCode: state.exitCode,
      osElapsedMs: state.exitedAtMs && state.createdAtMs ? state.exitedAtMs - state.createdAtMs : null,
      result,
      stderrBytes: Buffer.concat(err).length,
    };
  }
  /** A real store owner from the checkout's built lock module, held until its stdin ends. */
  async startContender(dataDir) {
    const moduleUrl = pathToFileURL(join(checkout, 'apps/api/dist/data-dir-lock.js')).href;
    const program = `
      const { acquireDataDirLock } = await import(process.argv[1]);
      process.stdin.resume();
      const released = new Promise((resolve) => process.stdin.once('end', resolve));
      let lock;
      try {
        lock = await acquireDataDirLock(process.argv[2]);
        process.stdout.write(JSON.stringify({ status: 'acquired', pid: process.pid }) + '\\n');
      } catch (error) {
        process.stdout.write(JSON.stringify({ status: 'refused', code: error?.code ?? null }) + '\\n');
        process.exit(3);
      }
      await released;
      await lock.release();
      process.stdout.write(JSON.stringify({ status: 'released' }) + '\\n');
    `;
    const child = spawn(process.execPath, ['--input-type=module', '-e', program, moduleUrl, dataDir], {
      env: baseEnvironment(),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stderr.resume();
    child.stdout.setEncoding('utf8');
    const messages = [];
    let buffer = '';
    const first = await new Promise((done) => {
      const timer = setTimeout(() => done(null), 60_000);
      child.stdout.on('data', (chunk) => {
        buffer += chunk;
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          try {
            messages.push(JSON.parse(line));
          } catch {
            messages.push({ unparsable: true });
          }
          clearTimeout(timer);
          done(messages[0]);
        }
      });
      child.once('exit', () => {
        clearTimeout(timer);
        done(null);
      });
    });
    if (first?.status !== 'acquired') {
      this.fault('contender-not-acquired', first);
      child.stdin.end();
      return null;
    }
    // Alive and blocked on stdin while the witness opens it: the PID cannot have been reused.
    const record = await shared.registry.open(this.id, 'contender', child.pid, 'spawn');
    record.contender = child;
    record.messages = messages;
    this.mark('contender-acquired');
    return record;
  }
  mark(event, extra = {}) {
    this.timeline.push({ atMs: Date.now(), event, ...extra });
  }
  fault(reason, detail = null) {
    this.setupFaults.push({ reason, detail });
  }
  note(text) {
    this.notes.push(text);
  }
  async prepare({ repo = 'fixture', timeoutSeconds = 6, scenario = {}, marker = false, node } = {}) {
    const port = await shared.ports.take();
    const dataDir = join(this.dir, 'data');
    const scenarioFile = join(this.dir, 'scenario.json');
    writeFileSync(
      scenarioFile,
      JSON.stringify({
        ...scenario,
        case: this.id,
        caseDir: this.dir,
        identityValue: shared.identityValue,
        queryPid: shared.sentinel.pid,
        sentinel: shared.privacy,
      }),
    );
    const config = {
      Repo: repo === 'fixture' ? shared.fixtureRepo : checkout,
      Node: node ?? process.execPath,
      DataDir: dataDir,
      Port: port,
      Environment: repo === 'fixture' ? {} : { GG_LOG_LEVEL: 'info' },
      LauncherAppUserModelId: 'GraphGoblin.QA459',
      StartupTimeoutSeconds: timeoutSeconds,
      WindowTimeoutSeconds: 2,
    };
    const configPath = join(this.dir, 'launcher.json');
    writeFileSync(configPath, JSON.stringify(config));
    const env = {
      ...baseEnvironment(),
      QA459_PIPE: shared.pipe,
      QA459_TOKEN: shared.token,
      QA459_CASE: this.id,
      QA459_SCENARIO: scenarioFile,
    };
    if (marker) {
      // Plain-health listener: a foreign-listener refusal right after the identity helper proves
      // the identity result was accepted, without starting a gateway.
      const server = createHttpServer((_request, response) => {
        response.setHeader('content-type', 'application/json');
        response.end('{"status":"ok"}');
      });
      await new Promise((done) => server.listen(port, '127.0.0.1', done));
      this.listeners.push(server);
    }
    this.prepared = { config, configPath, port, dataDir, env, repo, timeoutSeconds, marker };
    this.mark('prepared', { repo, port: 'disposable', timeoutSeconds, marker });
    return this.prepared;
  }
  processes(prefix = '') {
    return shared.registry.forCase(this.id).filter((record) => record.role.startsWith(prefix));
  }
  process(role) {
    return shared.registry.forCase(this.id).find((record) => record.role === role) ?? null;
  }
  async snapshot(name) {
    for (const record of shared.registry.forCase(this.id))
      record.samples[name] = await shared.registry.state(record);
    shared.sentinelSamples.push({ case: this.id, sample: name, ...(await shared.registry.state(shared.sentinel)) });
  }
  launcherLogRecords() {
    const path = join(this.dir, 'launcher.log');
    if (!existsSync(path)) return [];
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return { unparsable: true };
        }
      });
  }
  events() {
    const path = join(this.dir, 'events.ndjson');
    if (!existsSync(path)) return [];
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
  async launch(name, { watchdogMs = 45_000 } = {}) {
    const { configPath, env } = this.prepared;
    const before = this.launcherLogRecords().length;
    const startedAtMs = Date.now();
    const t0 = performance.now();
    const child = spawn(shared.launcherExe, ['--config', configPath, '--ensure-gateway'], {
      cwd: dirname(shared.launcherExe),
      env,
      windowsHide: true,
      detached: args['launcher-host'] === 'detached',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    let exitPerf = null;
    const exited = new Promise((done) =>
      child.once('exit', (code, signal) => {
        exitPerf = performance.now();
        done({ code, signal });
      }),
    );
    const spawnError = new Promise((done) => child.once('error', (error) => done(error)));
    const closed = new Promise((done) => child.once('close', () => done(performance.now())));
    this.mark('launcher-spawned', { name });
    if (!Number.isSafeInteger(child.pid)) {
      this.fault('launcher-spawn-error', await spawnError.then((error) => error?.code ?? 'unknown'));
      throw new Error('launcher did not start');
    }
    const record = await shared.registry.open(this.id, `launcher-${name}`, child.pid, 'spawn');
    if (!record.opened.ok || !/^GraphGoblin\.exe$/i.test(record.opened.image ?? '') ||
      Math.abs((record.opened.createdAtMs ?? 0) - startedAtMs) > 3000)
      this.fault('launcher-handle-unverified', record.opened);
    const outcome = await Promise.race([
      exited.then(() => 'exit'),
      spawnError.then(() => 'spawn-error'),
      sleep(watchdogMs).then(() => 'watchdog'),
    ]);
    let watchdog = null;
    if (outcome === 'spawn-error') this.fault('launcher-spawn-error');
    if (outcome === 'watchdog') {
      this.mark('launcher-watchdog', { name });
      watchdog = await shared.witness.call('terminate', record.tag, WATCHDOG_CODE);
      await Promise.race([exited, sleep(6000)]);
    }
    const exitState = await shared.registry.state(record);
    record.samples.exit = exitState;
    this.mark('launcher-exited', { name, exitCode: exitState.exitCode });
    await this.snapshot(`atExit:${name}`);
    const eof = await Promise.race([closed, sleep(1500).then(() => null)]);
    const after = this.launcherLogRecords();
    const records = after.slice(before);
    const stderrText = Buffer.concat(stderr).toString('utf8');
    const invocation = {
      name,
      tag: record.tag,
      pid: child.pid,
      startedAtMs,
      exitCode: exitState.exitCode,
      exitKind: watchdog ? 'driver-watchdog' : 'launcher-natural',
      watchdog: watchdog ? pickState(watchdog) : null,
      elapsedMs: exitPerf === null ? null : Math.round(exitPerf - t0),
      osCreatedAtMs: exitState.createdAtMs,
      osExitedAtMs: exitState.exitedAtMs,
      osElapsedMs:
        exitState.exitedAtMs && exitState.createdAtMs ? exitState.exitedAtMs - exitState.createdAtMs : null,
      callerEofAfterExitMs: eof === null || exitPerf === null ? null : Math.round(eof - exitPerf),
      code: records.length ? (records.at(-1).code ?? null) : exitState.exitCode === 0 ? 'success' : null,
      diagnostic: shared.classifyDiagnostic(stderrText),
      launcherLogRecords: records,
      stdoutBytes: Buffer.concat(stdout),
      stderrBytes: Buffer.concat(stderr),
      closed,
      stdoutChunks: stdout,
      stderrChunks: stderr,
    };
    this.invocations.push(invocation);
    return invocation;
  }
  async health(port = this.prepared.port) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(2500) });
      return {
        status: response.status,
        pid: response.headers.get('x-graphgoblin-pid'),
        identityMatchesFixture: response.headers.get('x-graphgoblin-instance') === shared.identityValue,
        identityShape: /^[a-f0-9]{64}$/.test(response.headers.get('x-graphgoblin-instance') ?? ''),
        phase: response.headers.get('x-graphgoblin-phase'),
      };
    } catch (error) {
      return { status: null, error: error?.cause?.code ?? error?.name ?? 'error' };
    }
  }
  /** Exact handle to a gateway reported by health, verified alive at a later health answer. */
  async openGateway(role = 'real-gateway') {
    const first = await this.health();
    const pid = Number(first.pid);
    if (!Number.isSafeInteger(pid) || pid < 1) {
      this.fault('gateway-pid-unavailable', first);
      return null;
    }
    const record = await shared.registry.open(this.id, role, pid, 'health');
    const second = await this.health();
    const state = await shared.registry.state(record);
    record.verified = record.opened.ok && /^node\.exe$/i.test(record.opened.image ?? '') &&
      String(second.pid) === String(pid) && state.alive === true;
    if (!record.verified) this.fault('gateway-handle-unverified', { opened: record.opened, second });
    return record;
  }
  lockSnapshot(path) {
    if (!existsSync(path)) return { exists: false };
    const stats = statSync(path, { bigint: true });
    return { exists: true, sha256: fileHash(path), size: Number(stats.size), fileId: `${stats.dev}:${stats.ino}` };
  }
  /** Exit classification from the owned handle and fixture events; never from timing alone. */
  classify(record, state) {
    if (!state || state.error) return 'unobserved';
    if (state.alive) return 'alive';
    const code = state.exitCode;
    if (code === WATCHDOG_CODE) return 'driver-watchdog';
    if (code === DOTNET_KILL_CODE) return 'terminated-dotnet-process-kill';
    if (code === CODES.released) return 'driver-release';
    if (code === CODES.driverGone) return 'driver-gone';
    if (code === CODES.setupFault) return 'fixture-setup-fault';
    if (record.role.startsWith('identity-') || record.role.startsWith('store-state-')) {
      const logged = this.events().find((event) => event.event === 'helper-exit' && event.pid === record.pid);
      return logged && logged.code === code ? 'natural' : 'terminated-other';
    }
    if (record.role.startsWith('gateway-')) {
      const logged = this.events().find((event) => event.event === 'gateway-exit' && event.pid === record.pid);
      return logged && logged.code === code ? 'natural' : 'terminated-other';
    }
    if (record.naturalCodes.includes(code)) return 'natural';
    if (record.role === 'real-gateway' || record.role === 'contender') return 'exited';
    return 'terminated-other';
  }
  /** Relation of an owned process to one launcher invocation, at a named sample. */
  relation(record, invocation, sample) {
    const state = record?.samples?.[sample];
    if (!record) return { role: null, observed: 'no-handshake' };
    const launcherExit = invocation.osExitedAtMs;
    const exitedBeforeLauncher =
      state && !state.alive && state.exitedAtMs !== null && launcherExit !== null
        ? state.exitedAtMs <= launcherExit + EXIT_SLACK_MS
        : false;
    return {
      role: record.role,
      sample,
      alive: state?.alive ?? null,
      exitCode: state?.exitCode ?? null,
      exitedRelativeToLauncherExitMs:
        state && !state.alive && state.exitedAtMs !== null && launcherExit !== null
          ? state.exitedAtMs - launcherExit
          : null,
      exitedBeforeLauncherExit: exitedBeforeLauncher,
      classification: this.classify(record, state),
    };
  }
  /** Terminated by launcher collection: exited by launcher exit with a non-natural, non-driver code. */
  terminatedByLauncher(record, invocation, sample) {
    const relation = this.relation(record, invocation, sample);
    const terminated = ['terminated-dotnet-process-kill', 'terminated-other'].includes(relation.classification);
    const codeMatches =
      jobExitCode === null || relation.classification === 'terminated-dotnet-process-kill'
        ? true
        : relation.exitCode === jobExitCode;
    return { pass: relation.exitedBeforeLauncherExit && terminated && codeMatches, relation };
  }
  check(id, { kind, text, expected, actual, pass, baseline }) {
    this.assertions.push({ id, kind, text, expected, actual, pass: Boolean(pass), baselineExpectation: baseline });
  }
  sentinelAlive() {
    const latest = shared.sentinelSamples.filter((sample) => sample.case === this.id).at(-1);
    return latest?.alive === true;
  }
  /** The driver's own teardown, recorded separately from launcher collection. */
  async teardown() {
    const records = shared.registry.forCase(this.id).filter((record) => record.opened.ok);
    for (const record of records) {
      const state = await shared.registry.state(record);
      if (!state.alive) {
        record.teardown = { action: 'none-already-exited' };
        continue;
      }
      if (record.role.startsWith('gateway-') || record.role === 'real-gateway') {
        const port = this.prepared.port;
        const body = record.role === 'real-gateway' ? JSON.stringify({ action: 'drain' }) : '{}';
        const result = await fetch(`http://127.0.0.1:${port}/system/shutdown`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          signal: AbortSignal.timeout(3000),
        }).then((response) => response.status, (error) => error?.name ?? 'error');
        record.teardown = { action: 'http-drain', atMs: Date.now(), response: result };
      } else if (record.role === 'contender') {
        record.contender?.stdin.end();
        record.teardown = { action: 'stdin-release', atMs: Date.now() };
      } else if (record.socket && !record.socket.destroyed) {
        record.socket.write('{"cmd":"release"}\n');
        record.teardown = { action: 'release-request', atMs: Date.now() };
      } else record.teardown = { action: 'no-release-channel', atMs: Date.now() };
    }
    const deadline = Date.now() + 20_000;
    for (const record of records) {
      if (record.teardown?.action === 'none-already-exited') continue;
      const wait = record.teardown?.action === 'http-drain' ? deadline : Math.min(deadline, Date.now() + 4000);
      let state = await shared.registry.state(record);
      while (state.alive && Date.now() < wait) {
        await sleep(100);
        state = await shared.registry.state(record);
      }
      if (state.alive) {
        const reply = await shared.witness.call('terminate', record.tag, WATCHDOG_CODE);
        record.teardown = { ...record.teardown, watchdog: { ...pickState(reply), terminateCalled: reply.terminateCalled ?? null } };
        this.mark('driver-watchdog-terminate', { role: record.role });
      }
    }
    for (const record of records) {
      const state = await shared.registry.state(record);
      record.samples.final = state;
      record.finalClassification = this.classify(record, state);
      if (record.socket && !record.socket.destroyed) record.socket.destroy();
    }
    for (const server of this.listeners) await new Promise((done) => server.close(done));
    for (const invocation of this.invocations) {
      const t = performance.now();
      const closedAt = await Promise.race([invocation.closed, sleep(3000).then(() => null)]);
      invocation.callerEofAfterTeardown = closedAt === null ? 'still-open-3000ms' : Math.round(Math.max(0, closedAt - t));
    }
  }
}

// ---------------------------------------------------------------- setup
async function compile(args, outFile) {
  const compiler = join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  const result = execFileSync(compiler, args, { encoding: 'utf8', windowsHide: true });
  return { output: result.trim(), sha256: fileHash(outFile) };
}

function privateDirectory(path) {
  mkdirSync(path, { recursive: true });
  const system = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
  const sid = /"(S-1-[0-9-]+)"/.exec(
    execFileSync(join(system, 'whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true }),
  )?.[1];
  if (!sid) throw new Error('current user SID unavailable');
  // Same private-root fixture procedure as the existing native acceptance suite.
  execFileSync(
    join(system, 'icacls.exe'),
    [path, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F'],
    { windowsHide: true, stdio: 'ignore' },
  );
}

function buildFixtureRepo(root) {
  const put = (relative, content) => {
    const path = join(root, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  };
  const fixture = (name) => readFileSync(join(driverDir, 'fixtures', name));
  put('package.json', '{"private":true,"type":"module"}\n');
  put('apps/api/dist/instance-identity.js', fixture('helper.mjs'));
  put('apps/api/dist/main.js', fixture('gateway.mjs'));
  put('apps/api/dist/windows-log/guard.js', 'export {};\n');
  put('apps/web/dist/index.html', '<!doctype html><title>QA459 fixture</title>\n');
  put('qa/handshake.mjs', fixture('handshake.mjs'));
  put('qa/member.mjs', fixture('member.mjs'));
  put('qa/ps-query.ps1', fixture('ps-query.ps1'));
}

function git(argsList) {
  try {
    return execFileSync('git', ['-C', checkout, ...argsList], { encoding: 'utf8', windowsHide: true }).trim();
  } catch (error) {
    return `unavailable:${error?.code ?? 'error'}`;
  }
}

function driverHashes() {
  const files = ['qa459-driver.mjs', 'qa459-cases.mjs', 'README.md', 'witness/QaWitness.cs',
    ...readdirSync(join(driverDir, 'fixtures')).map((name) => `fixtures/${name}`)];
  return Object.fromEntries(files.filter((file) => existsSync(join(driverDir, file))).map((file) => [file, fileHash(join(driverDir, file))]));
}

// ---------------------------------------------------------------- serialisation
function serialiseRecord(record) {
  const { socket: _socket, contender: _contender, ...rest } = record;
  return rest;
}

function verdictFor(context) {
  if (context.setupFaults.length) return 'setup-fault';
  if (label === 'baseline') {
    const matched = context.assertions.every((assertion) =>
      assertion.baselineExpectation === 'observe' ? true : (assertion.baselineExpectation === 'pass') === assertion.pass,
    );
    const anyExpectedFailure = context.assertions.some((assertion) => assertion.baselineExpectation === 'fail');
    if (!matched) return 'unexpected-baseline-behaviour';
    return anyExpectedFailure ? 'expected-baseline-failure-observed' : 'baseline-control-pass';
  }
  return context.assertions.filter((assertion) => assertion.kind !== 'info').every((assertion) => assertion.pass)
    ? 'candidate-pass'
    : 'candidate-fail';
}

function writeCase(context, startedAtMs, error) {
  const rawDir = join(outDir, 'raw-private', context.id);
  mkdirSync(rawDir, { recursive: true });
  for (const invocation of context.invocations) {
    // Unscrubbed original bytes, kept private; public JSON carries scrubbed text only.
    writeFileSync(join(rawDir, `${invocation.name}.launcher.stdout.bin`), Buffer.concat(invocation.stdoutChunks));
    writeFileSync(join(rawDir, `${invocation.name}.launcher.stderr.bin`), Buffer.concat(invocation.stderrChunks));
  }
  for (const name of ['events.ndjson', 'launcher.log', 'launcher.log.1', 'gateway.log', 'scenario.json', 'launcher.json'])
    if (existsSync(join(context.dir, name))) copyFileSync(join(context.dir, name), join(rawDir, name));
  const leaks = context.privacyLeaks();
  const result = {
    schema: 'gg459-native-qa-case/1',
    runId,
    label,
    case: context.id,
    title: context.def.title,
    lane: context.def.lane,
    category: context.def.category,
    planRow: context.def.planRow,
    startedAtMs,
    durationMs: Date.now() - startedAtMs,
    prepared: context.prepared
      ? { repo: context.prepared.repo, timeoutSeconds: context.prepared.timeoutSeconds, marker: context.prepared.marker }
      : null,
    invocations: context.invocations.map((invocation) => ({
      name: invocation.name,
      pid: invocation.pid,
      exitCode: invocation.exitCode,
      exitKind: invocation.exitKind,
      watchdog: invocation.watchdog,
      elapsedMs: invocation.elapsedMs,
      osElapsedMs: invocation.osElapsedMs,
      osCreatedAtMs: invocation.osCreatedAtMs,
      osExitedAtMs: invocation.osExitedAtMs,
      callerEofAfterExitMs: invocation.callerEofAfterExitMs,
      callerEofAfterTeardown: invocation.callerEofAfterTeardown ?? null,
      code: invocation.code,
      diagnostic: invocation.diagnostic,
      diagnosticFinal: shared.classifyDiagnostic(Buffer.concat(invocation.stderrChunks).toString('utf8')),
      launcherLogRecords: invocation.launcherLogRecords,
      stdoutBytesAtExit: invocation.stdoutBytes.length,
      stderrBytesAtExit: invocation.stderrBytes.length,
      stdoutBytes: Buffer.concat(invocation.stdoutChunks).length,
      stderrBytes: Buffer.concat(invocation.stderrChunks).length,
      stdoutText: Buffer.concat(invocation.stdoutChunks).toString('utf8'),
      stderrText: Buffer.concat(invocation.stderrChunks).toString('utf8'),
    })),
    processes: shared.registry.forCase(context.id).map(serialiseRecord),
    helperEvents: context.events(),
    privacy: { checked: true, leaks },
    timeline: context.timeline,
    assertions: context.assertions,
    setupFaults: context.setupFaults,
    notes: context.notes,
    error: error ? { name: error.name, message: error.message } : null,
  };
  result.verdict = verdictFor(context);
  writeFileSync(join(outDir, 'cases', `${context.id}.json`), JSON.stringify(scrubValue(result), null, 2) + '\n');
  return result;
}

// ---------------------------------------------------------------- main
async function main() {
  if (existsSync(outDir)) throw new Error('refusing to overwrite an existing run output');
  mkdirSync(join(outDir, 'cases'), { recursive: true });
  mkdirSync(join(runDir, 'bin'), { recursive: true });
  privateDirectory(join(runDir, 'cases'));
  shared.ports = new PortPool(Number(args['port-start']));
  const { classifyDiagnostic } = await import(
    pathToFileURL(join(checkout, 'tooling/scripts/windows-launcher-evidence.mjs')).href
  );
  shared.classifyDiagnostic = classifyDiagnostic;

  const launcherSource = join(checkout, 'apps/windows-launcher/Launcher.cs');
  shared.launcherExe = join(runDir, 'bin', 'GraphGoblin.exe');
  const launcherBuild = await compile(
    ['/nologo', '/target:winexe', '/optimize+', '/platform:x64', '/reference:System.Windows.Forms.dll',
      '/reference:System.Web.Extensions.dll', `/out:${shared.launcherExe}`, launcherSource],
    shared.launcherExe,
  );
  const witnessExe = join(runDir, 'bin', 'QaWitness.exe');
  const witnessBuild = await compile(
    ['/nologo', '/target:exe', '/optimize+', '/platform:x64', '/reference:System.Web.Extensions.dll',
      `/out:${witnessExe}`, join(driverDir, 'witness', 'QaWitness.cs')],
    witnessExe,
  );
  shared.fixtureRepo = join(runDir, 'fixture-repo');
  buildFixtureRepo(shared.fixtureRepo);
  shared.notNode = join(runDir, 'bin', 'not-node.exe');
  writeFileSync(shared.notNode, 'QA459 fixture: not an executable image\r\n');

  shared.witness = new Witness(witnessExe);
  shared.registry = new Registry(shared.witness, shared.token);
  await shared.registry.listen(shared.pipe);
  const witnessInfo = await shared.witness.call('info');
  shared.sentinelSamples = [];

  // Same-executable sentinel outside every launcher: must stay alive through every case.
  mkdirSync(join(runDir, 'run'), { recursive: true });
  const sentinelSpec = Buffer.from(
    JSON.stringify({ role: 'sentinel', lifetimeMs: 3_600_000, naturalCode: CODES.sentinel, caseDir: join(runDir, 'run') }),
  ).toString('base64url');
  const sentinelChild = spawn(process.execPath, [join(shared.fixtureRepo, 'qa', 'member.mjs'), sentinelSpec], {
    env: { ...baseEnvironment(), QA459_PIPE: shared.pipe, QA459_TOKEN: shared.token, QA459_CASE: 'run' },
    stdio: 'ignore',
    windowsHide: true,
  });
  const findSentinel = () => shared.registry.forCase('run').find((record) => record.role === 'sentinel');
  for (let i = 0; i < 200 && !findSentinel(); i++) await sleep(50);
  shared.sentinel = findSentinel();
  if (!shared.sentinel?.opened.ok) throw new Error('sentinel handshake failed');
  // Host context only: the driver's own process is observed, never signalled.
  const driverSelf = await shared.registry.open('run', 'driver-self', process.pid, 'self');

  const identity = {
    schema: 'gg459-native-qa-run/1',
    runId,
    label,
    startedAt: new Date().toISOString(),
    checkout: {
      head: git(['rev-parse', 'HEAD']),
      tree: git(['rev-parse', 'HEAD^{tree}']),
      trackedChanges: git(['status', '--porcelain=v1', '--untracked-files=no']),
      launcherSourceSha256: fileHash(launcherSource),
      launcherSourceBlob: git(['rev-parse', 'HEAD:apps/windows-launcher/Launcher.cs']),
      dist: Object.fromEntries(
        ['apps/api/dist/instance-identity.js', 'apps/api/dist/main.js', 'apps/api/dist/windows-process-identity.js',
          'apps/api/dist/data-dir-lock.js', 'apps/api/dist/windows-log/guard.js']
          .filter((file) => existsSync(join(checkout, file)))
          .map((file) => [file, fileHash(join(checkout, file))]),
      ),
      evidenceModuleSha256: fileHash(join(checkout, 'tooling/scripts/windows-launcher-evidence.mjs')),
    },
    build: {
      compiler: 'Framework64/v4.0.30319/csc.exe',
      launcherFlags: '/nologo /target:winexe /optimize+ /platform:x64 /reference:System.Windows.Forms.dll /reference:System.Web.Extensions.dll',
      launcherExeSha256: launcherBuild.sha256,
      compilerOutput: launcherBuild.output,
      witnessExeSha256: witnessBuild.sha256,
    },
    runtime: {
      node: process.version,
      nodeExecutableSha256: fileHash(process.execPath),
      os: { platform: process.platform, release: os.release(), version: os.version(), arch: os.arch() },
      clr: witnessInfo.clr,
      witnessOs: witnessInfo.os,
    },
    driver: driverHashes(),
    constants: { WATCHDOG_CODE, DOTNET_KILL_CODE, CODES, GRACE_MS, EXIT_SLACK_MS, jobExitCode },
    launcherHost: args['launcher-host'],
    driverProcess: { image: driverSelf.opened.image, inAnyJob: driverSelf.opened.inAnyJob },
    invocation: '<launcher.exe> --config <case>\\launcher.json --ensure-gateway (quiet; no dialog, no PWA)',
    sentinel: { pid: shared.sentinel.pid, image: shared.sentinel.opened.image },
  };
  writeFileSync(join(outDir, 'run.json'), JSON.stringify(scrubValue(identity), null, 2) + '\n');
  console.log(JSON.stringify({ qa459: 'run-started', runId, head: identity.checkout.head }));

  const selected = args.cases ? new Set(args.cases.split(',')) : null;
  const summary = [];
  try {
    for (const def of CASES) {
      if (selected && !selected.has(def.id)) continue;
      const context = new CaseContext(def);
      const startedAtMs = Date.now();
      let error = null;
      try {
        await def.run(context);
      } catch (caught) {
        error = caught;
        context.fault('case-exception', caught?.message ?? String(caught));
      }
      try {
        await context.teardown();
      } catch (caught) {
        context.fault('teardown-exception', caught?.message ?? String(caught));
      }
      const result = writeCase(context, startedAtMs, error);
      const line = {
        case: def.id,
        verdict: result.verdict,
        durationMs: result.durationMs,
        failed: result.assertions.filter((assertion) => !assertion.pass).map((assertion) => assertion.id),
        setupFaults: result.setupFaults.map((fault) => fault.reason),
      };
      summary.push(line);
      console.log(JSON.stringify(line));
    }
  } finally {
    shared.sentinelFinal = await shared.registry.state(shared.sentinel);
    shared.sentinel.socket?.write('{"cmd":"release"}\n');
    const sentinelExit = await Promise.race([new Promise((done) => sentinelChild.once('exit', done)), sleep(4000)]);
    const sentinelAfter = await shared.registry.state(shared.sentinel);
    if (sentinelAfter.alive) await shared.witness.call('terminate', shared.sentinel.tag, WATCHDOG_CODE);
    writeFileSync(
      join(outDir, 'summary.json'),
      JSON.stringify(
        scrubValue({
          schema: 'gg459-native-qa-summary/1',
          runId,
          label,
          finishedAt: new Date().toISOString(),
          sentinel: {
            aliveBeforeRelease: shared.sentinelFinal.alive,
            releaseExit: sentinelExit ?? null,
            finalState: await shared.registry.state(shared.sentinel),
            samples: shared.sentinelSamples,
          },
          rejectedHandshakes: shared.registry.rejected,
          cases: summary,
        }),
        null,
        2,
      ) + '\n',
    );
    shared.witness.close();
    shared.registry.server.close();
    console.log(JSON.stringify({ qa459: 'run-finished', runId, out: scrub(outDir) }));
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ qa459: 'run-failed', error: scrub(error?.stack ?? String(error)) }));
  process.exitCode = 1;
});
