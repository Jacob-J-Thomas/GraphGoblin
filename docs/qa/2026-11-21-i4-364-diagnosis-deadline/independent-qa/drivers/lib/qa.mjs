// Shared D203 QA instrumentation. Independent of the author's Vitest mocks: product code is the
// built dist, loaded by plain Node. Only the imports of claude/process.js are redirected to seams;
// everything else here observes (timers, abort listeners, clock, unhandled rejections).
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { getEventListeners } from 'node:events';
import { ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { existsSync, mkdirSync, rmSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export const REPO = 'G:\\ggq\\gg-i4-364-deadline-qa\\GraphGoblin';
export const EVIDENCE =
  'G:\\ggq\\delivery-evidence\\2026-11-17-five-intents\\i4-364-deadline-independent-01';
export const TEMP_ROOT = 'G:\\ggq\\qa-scratch\\i4-364-deadline-independent-01';
export const SCRATCH = join(TEMP_ROOT, 'work');
export const FIXTURE = join(EVIDENCE, 'fixtures', 'qa-cli.mjs');
export const CANARY = 'PRIVATE_QA_CANARY_D203';
const pkg = (rel) => pathToFileURL(join(REPO, 'packages', ...rel.split('/'))).href;
export const URLS = {
  process: pkg('infrastructure/dist/claude/process.js'),
  harness: pkg('infrastructure/dist/claude/harness.js'),
  claudeIndex: pkg('infrastructure/dist/claude/index.js'),
  engineTesting: pkg('engine/dist/testing/index.js'),
};
const SEAMS = {
  fs: new URL('./seam-fs.mjs', import.meta.url).href,
  child: new URL('./seam-child.mjs', import.meta.url).href,
  kill: new URL('./seam-kill.mjs', import.meta.url).href,
};

// ---------- real time ----------
const T0 = process.hrtime.bigint();
export const now = () => Number(process.hrtime.bigint() - T0) / 1e6;
export const realSetTimeout = globalThis.setTimeout;
export const realClearTimeout = globalThis.clearTimeout;
export const sleep = (ms) => new Promise((resolve) => realSetTimeout(resolve, ms));
export async function waitFor(condition, limitMs) {
  const start = now();
  while (!condition()) {
    if (now() - start > limitMs) return false;
    await sleep(2);
  }
  return true;
}

// ---------- controller ----------
export const ctl = {
  caseId: 'init',
  phase: 'init',
  redirects: [],
  statCalls: [],
  spawnCalls: [],
  killCalls: [],
  timers: [],
  listeners: [],
  unhandled: [],
  held: [],
  nativePids: [],
  scripted: new WeakSet(),
  fixtureBinaries: new Set([process.execPath]),
  fixtureMode: () => 'success',
  classify: () => 'other',
  statPolicy: () => ({ kind: 'pass' }),
  spawnPlan: () => ({ kind: 'native' }),
  onRefusal: null,
};
globalThis.__d203 = ctl;
process.on('unhandledRejection', (reason) => {
  ctl.unhandled.push({ caseId: ctl.caseId, name: reason?.name ?? null, code: reason?.code ?? null });
});

const outcomeSummary = (o) =>
  o.ok ? (o.v.isDirectory() ? 'stats:directory' : 'stats:non-directory') : `error:${o.e?.code ?? 'none'}`;
ctl.statSeam = (realStat, path, ...rest) => {
  const rec = {
    id: ctl.statCalls.length + 1,
    caseId: ctl.caseId,
    phase: ctl.phase,
    target: ctl.classify(path),
    issuedMs: now(),
    mode: null,
    native: false,
    nativeCompletedMs: null,
    nativeOutcome: null,
    deliveredMs: null,
    delivered: null,
  };
  ctl.statCalls.push(rec);
  const policy = ctl.statPolicy(rec.target, rec) ?? { kind: 'pass' };
  rec.mode = policy.kind + (policy.override ? ':override' : ':native');
  let native;
  if (!policy.override) {
    rec.native = true;
    native = realStat(path, ...rest).then(
      (v) => ({ ok: true, v }),
      (e) => ({ ok: false, e }),
    );
    void native.then((o) => {
      rec.nativeCompletedMs = now();
      rec.nativeOutcome = outcomeSummary(o);
    });
  }
  return new Promise((resolve, reject) => {
    let done = false;
    const deliverOutcome = (o) => {
      if (done) return;
      done = true;
      rec.deliveredMs = now();
      rec.delivered = outcomeSummary(o);
      if (o.ok) resolve(o.v);
      else reject(o.e);
    };
    // An override is delivered synchronously; a native outcome after its real completion.
    const deliver = () => (policy.override ? deliverOutcome(policy.override) : native.then(deliverOutcome));
    if (policy.kind === 'pass') deliver();
    else if (policy.kind === 'delay') realSetTimeout(deliver, policy.ms);
    else if (policy.kind === 'hold') ctl.held.push({ rec, deliver });
    else throw new Error(`instrumentation: unknown stat policy ${policy.kind}`);
  });
};
export function releaseHeld(filter = () => true) {
  const selected = ctl.held.filter((entry) => filter(entry.rec));
  ctl.held = ctl.held.filter((entry) => !selected.includes(entry));
  for (const entry of selected) {
    entry.rec.releasedMs = now();
    entry.deliver();
  }
  return selected.length;
}
const commandKind = (args) =>
  args.includes('--print')
    ? 'turn'
    : args.includes('--version')
      ? 'version'
      : args.includes('--help')
        ? 'help'
        : args.includes('auth')
          ? 'auth'
          : 'other';
ctl.spawnSeam = (realSpawn, command, args, options) => {
  const kind = commandKind(args);
  ctl.phase = kind === 'turn' ? 'turn' : `probe-${kind}`;
  const rec = {
    id: ctl.spawnCalls.length + 1,
    caseId: ctl.caseId,
    kind,
    command: ctl.classify(command),
    cwd: ctl.classify(options?.cwd),
    shell: options?.shell ?? null,
    issuedMs: now(),
    mode: null,
    fixtureMode: null,
    pidAtReturn: null,
    pid: null,
    error: null,
    laterErrors: [],
    exits: [],
    closes: [],
  };
  ctl.spawnCalls.push(rec);
  const plan = ctl.spawnPlan(rec, options) ?? { kind: 'native' };
  rec.mode = plan.kind;
  let child;
  if (plan.kind === 'scripted') {
    child = plan.make(rec);
    ctl.scripted.add(child);
  } else {
    plan.before?.(rec, options);
    const fixture = ctl.fixtureBinaries.has(command);
    if (fixture) rec.fixtureMode = plan.fixtureMode ?? ctl.fixtureMode(rec);
    child = realSpawn(command, fixture ? [FIXTURE, rec.fixtureMode, ...args] : args, options);
  }
  rec.pidAtReturn = child.pid !== undefined;
  rec.pid = child.pid ?? null;
  if (rec.pid !== null && plan.kind !== 'scripted') ctl.nativePids.push(rec.pid);
  child.on('error', (error) => {
    const entry = {
      code: error?.code ?? null,
      syscallIsSpawn: typeof error?.syscall === 'string' && error.syscall.startsWith('spawn'),
      atMs: now(),
      pidAtError: child.pid !== undefined,
    };
    if (rec.error === null) {
      rec.error = entry;
      if (!rec.pidAtReturn) ctl.onRefusal?.(rec);
    } else rec.laterErrors.push(entry);
  });
  child.on('exit', (code) => rec.exits.push({ code, atMs: now() }));
  child.on('close', (code) => rec.closes.push({ code, atMs: now() }));
  return child;
};
ctl.killSeam = (realKill, child, ...rest) => {
  const rec = {
    caseId: ctl.caseId,
    phase: ctl.phase,
    atMs: now(),
    pidPresent: child?.pid !== undefined,
    scripted: ctl.scripted.has(child),
  };
  ctl.killCalls.push(rec);
  return rec.scripted ? Promise.resolve(true) : realKill(child, ...rest);
};

/** A scripted ChildProcess for runner-level cases (T3). */
export function scriptedChild({ pid } = {}) {
  const child = new ChildProcess();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  if (pid !== undefined) Object.assign(child, { pid });
  return child;
}
export const fault = (code) => Object.assign(new Error('qa synthetic fault'), { code });

// ---------- timer and listener observation ----------
const timerOf = new Map();
globalThis.setTimeout = function qaSetTimeout(fn, delay, ...args) {
  const stack = new Error().stack ?? '';
  if (!stack.includes('/claude/process.js')) return realSetTimeout(fn, delay, ...args);
  const rec = {
    id: ctl.timers.length + 1,
    caseId: ctl.caseId,
    phase: ctl.phase,
    delay,
    createdMs: now(),
    firedMs: null,
    clearedMs: null,
  };
  ctl.timers.push(rec);
  const handle = realSetTimeout(() => {
    rec.firedMs = now();
    fn(...args);
  }, delay);
  timerOf.set(handle, rec);
  return handle;
};
globalThis.clearTimeout = function qaClearTimeout(handle) {
  const rec = handle === undefined ? undefined : timerOf.get(handle);
  if (rec && rec.firedMs === null && rec.clearedMs === null) rec.clearedMs = now();
  return realClearTimeout(handle);
};
export const pendingTimers = (caseId) =>
  ctl.timers.filter((t) => t.caseId === caseId && t.firedMs === null && t.clearedMs === null);
const realAdd = EventTarget.prototype.addEventListener;
const realRemove = EventTarget.prototype.removeEventListener;
EventTarget.prototype.addEventListener = function qaAdd(type, listener, options) {
  if (type === 'abort' && this instanceof AbortSignal) {
    const stack = new Error().stack ?? '';
    const owner = stack.includes('/claude/process.js')
      ? 'process'
      : stack.includes('/claude/harness.js')
        ? 'harness'
        : null;
    if (owner)
      ctl.listeners.push({
        caseId: ctl.caseId,
        phase: ctl.phase,
        owner,
        signal: this,
        listener,
        addedMs: now(),
        removedMs: null,
      });
  }
  return realAdd.call(this, type, listener, options);
};
EventTarget.prototype.removeEventListener = function qaRemove(type, listener, options) {
  if (type === 'abort')
    for (const rec of ctl.listeners)
      if (rec.signal === this && rec.listener === listener && rec.removedMs === null)
        rec.removedMs = now();
  return realRemove.call(this, type, listener, options);
};
export const attachedListeners = (caseId) =>
  ctl.listeners.filter(
    (rec) => rec.caseId === caseId && getEventListeners(rec.signal, 'abort').includes(rec.listener),
  );

// ---------- clock ----------
const realPerfNow = performance.now.bind(performance);
let clock = (real) => real;
Object.defineProperty(performance, 'now', {
  value: () => clock(realPerfNow()),
  configurable: true,
  writable: true,
});
export const realPerf = realPerfNow;
/** Jump the monotonic clock forward (never backwards). */
export function clockJump(ms) {
  const previous = clock;
  clock = (real) => previous(real) + ms;
}
/** Continue from the current value at `rate` real speed (rate 1 restores normal speed). */
export function clockRate(rate) {
  const r0 = realPerfNow();
  const v0 = clock(r0);
  clock = (real) => v0 + Math.max(0, real - r0) * rate;
}
const realDateNow = Date.now;
let dateShift = 0;
Date.now = () => realDateNow() + dateShift;
export const shiftWallClock = (ms) => {
  dateShift += ms;
};

// ---------- hooks ----------
const isProcessModule = (url, oldProcessURL) =>
  typeof url === 'string' &&
  (url.toLowerCase() === URLS.process.toLowerCase() ||
    (oldProcessURL !== undefined && url.toLowerCase() === oldProcessURL.toLowerCase()));
export function install({ oldProcessURL } = {}) {
  registerHooks({
    resolve(specifier, context, next) {
      const parent = context.parentURL;
      if (isProcessModule(parent, oldProcessURL)) {
        const seam =
          specifier === 'node:fs/promises'
            ? SEAMS.fs
            : specifier === 'node:child_process'
              ? SEAMS.child
              : specifier === '../process/index.js'
                ? SEAMS.kill
                : undefined;
        if (seam) {
          ctl.redirects.push({ from: parent === URLS.process ? 'candidate' : 'old', specifier });
          return { url: seam, shortCircuit: true };
        }
        if (oldProcessURL !== undefined && parent.toLowerCase() === oldProcessURL.toLowerCase())
          return next(specifier, { ...context, parentURL: URLS.process });
      }
      if (
        oldProcessURL !== undefined &&
        specifier === './process.js' &&
        parent?.toLowerCase() === URLS.harness.toLowerCase()
      ) {
        ctl.redirects.push({ from: 'harness', specifier, to: 'old' });
        return { url: oldProcessURL, shortCircuit: true };
      }
      return next(specifier, context);
    },
  });
  return {
    performanceNowReplaced: performance.now() > 0 && typeof performance.now === 'function',
    setTimeoutWrapped: globalThis.setTimeout !== realSetTimeout,
    dateNowWrapped: Date.now !== realDateNow,
  };
}

// ---------- predicates and output ----------
export const predicates = [];
export function check(caseId, name, pass, observed, expected) {
  predicates.push({ caseId, name, pass: Boolean(pass), observed, expected });
  if (!pass) process.stdout.write(`FAIL [${caseId}] ${name}: ${JSON.stringify(observed)}\n`);
}
export const eq = (caseId, name, actual, expected) =>
  check(caseId, name, isDeepStrictEqual(actual, expected), actual, expected);
export const publicError = (error) =>
  error === undefined
    ? undefined
    : {
        name: error?.name ?? null,
        constructor: error?.constructor?.name ?? null,
        code: error?.code ?? null,
        message: error?.message ?? null,
        retriable: error?.retriable ?? null,
      };
const FORBIDDEN = [
  CANARY,
  'PRIVATE_QA_',
  'qa-scratch',
  'i4-364-deadline-independent',
  'qa-cli',
  'node-v22',
  'node.exe',
  'claude-qa',
  'gg-claude-probe',
  'spawn ',
  'errno',
  'syscall',
  'ENOENT:',
  'qa synthetic',
];
export function privacy(caseId, label, value) {
  const text = JSON.stringify(value) ?? '';
  const found = FORBIDDEN.filter((fragment) => text.includes(fragment));
  check(caseId, `privacy: ${label} has no canary, path or native diagnostic text`, found.length === 0, found, []);
}
export function serializable() {
  return {
    redirects: ctl.redirects,
    statCalls: ctl.statCalls,
    spawnCalls: ctl.spawnCalls,
    killCalls: ctl.killCalls,
    timers: ctl.timers,
    listeners: ctl.listeners.map(({ signal, listener, ...rest }) => ({
      ...rest,
      stillAttached: getEventListeners(signal, 'abort').includes(listener),
    })),
    unhandled: ctl.unhandled,
    heldStillUndelivered: ctl.held.map((entry) => entry.rec.id),
    nativeFixturePids: ctl.nativePids,
  };
}
export function writeObservations(name, extra = {}) {
  const passed = predicates.filter((p) => p.pass).length;
  const failed = predicates.length - passed;
  const body = {
    driver: name,
    utc: new Date(realDateNow()).toISOString(),
    node: process.version,
    execPath: process.execPath,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    passed,
    failed,
    predicates,
    ...extra,
    instrumentation: serializable(),
  };
  const file = join(EVIDENCE, 'observations', `${name}.json`);
  if (existsSync(file)) throw new Error(`refusing to overwrite ${file}`);
  writeFileSync(file, JSON.stringify(body, null, 2) + '\n');
  process.stdout.write(`${name}: ${passed} pass, ${failed} fail\n`);
  return failed;
}
/** A fresh owned scratch root; refuses reuse so earlier evidence is never overwritten. */
export function freshRoot(name) {
  const root = join(SCRATCH, name);
  if (existsSync(root)) throw new Error(`scratch root already exists: ${name}`);
  mkdirSync(root, { recursive: true });
  return realpathSync(root);
}
export function removeOwnedRoot(root) {
  const resolved = realpathSync(root);
  if (!resolved.toLowerCase().startsWith(SCRATCH.toLowerCase() + '\\'))
    throw new Error('refusing to remove a root outside the scratch work folder');
  rmSync(resolved, { recursive: true, force: true });
  return !existsSync(resolved);
}
export const fileStats = () => statSync(FIXTURE);
export const directoryStats = () => statSync(SCRATCH);
export const TEXT = {
  UNKNOWN_TURN:
    "Claude could not be started (ENOENT); check the Claude executable's path and permissions and the working directory",
  MISSING_DIR_TURN:
    'Claude could not be started because the working directory does not exist; check the working directory setting',
  NOT_DIR_TURN:
    'Claude could not be started because the working directory is not a folder; check the working directory setting',
  MISSING_EXE_TURN:
    'The Claude executable was not found at its configured path; install the Claude CLI or correct its path',
  CHECK_ACTION: 'Check that the Claude CLI starts and responds, then retry preflight.',
  PROBE_UNKNOWN: 'Claude CLI could not be started (ENOENT).',
  PROBE_DIR_MISSING:
    'Claude CLI could not be started because its temporary check folder does not exist.',
  PROBE_OUTPUT_LOST: 'Claude CLI check output could not be read.',
  SIGNED_OUT: 'Claude is not signed in. Run claude auth login, then retry preflight.',
};
