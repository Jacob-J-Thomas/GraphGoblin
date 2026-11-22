// C2: built runClaudeProcess (dist) with independently controlled child/stat/time seams (T3).
// Synthetic absolute paths; every stat outcome is an explicit override (no native stat issued).
import {
  ctl,
  install,
  URLS,
  now,
  sleep,
  waitFor,
  check,
  eq,
  pendingTimers,
  attachedListeners,
  releaseHeld,
  scriptedChild,
  fault,
  fileStats,
  directoryStats,
  clockJump,
  clockRate,
  realPerf,
  shiftWallClock,
  writeObservations,
  realSetTimeout,
} from './lib/qa.mjs';

const guard = realSetTimeout(() => {
  process.stdout.write('instrumentation guard: driver exceeded 120 s\n');
  writeObservations('c2-runner-guard-abort', { guard: true });
  process.exit(3);
}, 120_000);
const selfCheck = install();
const { runClaudeProcess } = await import(URLS.process);
eq('setup', 'seams bound for candidate process.js (fs, child, kill)',
  ctl.redirects.filter((r) => r.from === 'candidate').map((r) => r.specifier).sort(),
  ['../process/index.js', 'node:child_process', 'node:fs/promises']);
{
  const d0 = performance.now() - realPerf();
  clockJump(1);
  const d1 = performance.now() - realPerf();
  check('setup', 'virtual monotonic clock seam moves performance.now()', d1 - d0 > 0.9 && d1 - d0 < 1.1, d1 - d0, 1);
}

const BIN = 'Z:\\d203-qa-synthetic\\claude.exe';
const WD = 'Z:\\d203-qa-synthetic\\workspace';
ctl.classify = (path) =>
  path === BIN ? 'binary' : path === `${BIN}.com` ? 'binary.com' : path === `${BIN}.exe` ? 'binary.exe' : path === WD ? 'cwd' : 'other';
const ENOENT = () => ({ ok: false, e: fault('ENOENT') });
const EPERM = () => ({ ok: false, e: fault('EPERM') });
const FILE = () => ({ ok: true, v: fileStats() });
const DIR = () => ({ ok: true, v: directoryStats() });
const results = {};
const REFUSED_KEYS = ['exitCode', 'stdout', 'timedOut', 'aborted', 'overflow', 'spawnCode'];
const baseRefused = { exitCode: null, stdout: '', timedOut: false, aborted: false, overflow: false, spawnCode: 'ENOENT' };

function refusal({ code = 'ENOENT', afterMs = 0, then } = {}) {
  return {
    kind: 'scripted',
    make: () => {
      const child = scriptedChild();
      realSetTimeout(() => {
        child.emit('error', fault(code));
        then?.(child);
      }, afterMs);
      return child;
    },
  };
}
function begin(id, { plan, policy, timeoutMs = null, signal, onRefusal = null }) {
  ctl.caseId = id;
  ctl.spawnPlan = () => plan;
  ctl.statPolicy = policy;
  ctl.onRefusal = onRefusal;
  const out = { startMs: now(), settledMs: null, result: null };
  results[id] = out;
  void runClaudeProcess({
    binary: BIN,
    args: ['--print'],
    cwd: WD,
    env: {},
    stdin: 'qa stdin',
    signal: signal ?? new AbortController().signal,
    timeoutMs,
    maxOutputBytes: 4096,
  }).then((result) => {
    out.settledMs = now();
    out.result = result;
  });
  return out;
}
const spawnOf = (id) => ctl.spawnCalls.find((s) => s.caseId === id);
const refusalAt = (id) => spawnOf(id)?.error?.atMs;
const statTargets = (id) => ctl.statCalls.filter((s) => s.caseId === id).map((s) => s.target);
const diagTimers = (id) => ctl.timers.filter((t) => t.caseId === id && t.delay === 1000);
async function settle(id, out, limit = 4000) {
  const ok = await waitFor(() => out.settledMs !== null, limit);
  check(id, 'runner settled', ok, ok, true);
  return ok;
}
function cleanupChecks(id) {
  eq(id, 'no runner timer pending after settlement', pendingTimers(id), []);
  eq(id, 'runner abort listener removed', attachedListeners(id).length, 0);
  eq(id, 'no kill requested for a refused start', ctl.killCalls.filter((k) => k.caseId === id).length, 0);
}

// R1: monotonic deadline passed (virtual clock) before the delayed timer callback; timely-looking
// "all names missing" metadata then arrives and must be rejected at acceptance.
{
  const id = 'R1-virtual-delayed-callback';
  const out = begin(id, {
    plan: refusal(),
    policy: (t) => (t.startsWith('binary') ? { kind: 'hold', override: ENOENT() } : { kind: 'pass', override: ENOENT() }),
  });
  await waitFor(() => refusalAt(id) !== undefined, 1000);
  await sleep(50);
  clockJump(1500);
  const releaseMs = now();
  releaseHeld((r) => r.caseId === id);
  if (await settle(id, out, 2000)) {
    eq(id, 'result: refusal with unknown cause', out.result, baseRefused);
    check(id, 'settled promptly at acceptance, before the real 1,000 ms timer', out.settledMs - releaseMs < 30 && out.settledMs - refusalAt(id) < 900, { afterRelease: out.settledMs - releaseMs, afterRefusal: out.settledMs - refusalAt(id) }, '< 30 ms after release, < 900 ms after refusal');
    eq(id, 'diagnostic timer cleared, never fired', diagTimers(id).map((t) => ({ fired: t.firedMs !== null, cleared: t.clearedMs !== null })), [{ fired: false, cleared: true }]);
    eq(id, 'no follow-on working-directory lookup', statTargets(id), ['binary', 'binary.com', 'binary.exe']);
    cleanupChecks(id);
  }
}

// R2: genuine event-loop block on the real clock; late metadata delivered in the same callback
// that ends the block, i.e. before the timers phase could run the diagnostic callback.
{
  const id = 'R2-real-event-loop-block';
  let blockEndMs = null;
  const out = begin(id, {
    plan: refusal(),
    policy: (t) => (t.startsWith('binary') ? { kind: 'hold', override: ENOENT() } : { kind: 'pass', override: ENOENT() }),
    onRefusal: () => {
      const target = realPerf() + 1150;
      setImmediate(() => {
        while (realPerf() < target) {
          /* deliberate synchronous block */
        }
        blockEndMs = now();
        releaseHeld((r) => r.caseId === id);
      });
    },
  });
  if (await settle(id, out)) {
    eq(id, 'result: late metadata rejected at acceptance (unknown cause)', out.result, baseRefused);
    check(id, 'settled right after the block ended (1,150 ms)', out.settledMs - blockEndMs < 30 && out.settledMs - refusalAt(id) >= 1149, { afterBlock: out.settledMs - blockEndMs, afterRefusal: out.settledMs - refusalAt(id) }, '< 30 ms after block, >= 1,150 ms after refusal');
    eq(id, 'diagnostic timer cleared before it could fire', diagTimers(id).map((t) => ({ fired: t.firedMs !== null, cleared: t.clearedMs !== null })), [{ fired: false, cleared: true }]);
    eq(id, 'no follow-on working-directory lookup', statTargets(id), ['binary', 'binary.com', 'binary.exe']);
    cleanupChecks(id);
  }
}

// R3: timer fires before the monotonic budget has elapsed (clock at 0.7x); it must re-check.
{
  const id = 'R3-early-timer-slow-clock';
  const out = begin(id, {
    plan: refusal(),
    policy: (t) => (t.startsWith('binary') ? { kind: 'hold', override: ENOENT() } : { kind: 'pass', override: ENOENT() }),
    onRefusal: () => clockRate(0.7),
  });
  const ok = await settle(id, out, 4000);
  clockRate(1);
  if (ok) {
    const elapsed = out.settledMs - refusalAt(id);
    results[id].elapsedFromRefusalMs = elapsed;
    check(id, 'settled near 1,000/0.7 ms real, not at the first timer', elapsed >= 1380 && elapsed <= 1700, elapsed, [1380, 1700]);
    const timers = ctl.timers.filter((t) => t.caseId === id);
    check(id, 'first diagnostic timer fired early and was re-armed', timers.length >= 2 && timers[0].firedMs !== null && out.settledMs - timers[0].firedMs > 300, timers.map((t) => ({ delay: t.delay, fired: t.firedMs })), '>= 2 timers, first fired > 300 ms before settle');
    eq(id, 'result: unknown cause', out.result, baseRefused);
    cleanupChecks(id);
    const snapshot = JSON.stringify(out.result);
    releaseHeld((r) => r.caseId === id);
    await sleep(100);
    eq(id, 'late delivery leaves result unchanged', JSON.stringify(out.result), snapshot);
    eq(id, 'no follow-on working-directory lookup', statTargets(id), ['binary', 'binary.com', 'binary.exe']);
  }
}

// R4: the budget starts at the refusal, not at the runner call.
{
  const id = 'R4-budget-from-refusal';
  const out = begin(id, {
    plan: refusal({ afterMs: 700 }),
    policy: (t) => (t.startsWith('binary') ? { kind: 'delay', ms: 500, override: ENOENT() } : { kind: 'pass', override: ENOENT() }),
  });
  if (await settle(id, out)) {
    eq(id, 'timely executable-missing retained', out.result, { ...baseRefused, startRefusal: 'executable-missing' });
    const fromRefusal = out.settledMs - refusalAt(id);
    const fromStart = out.settledMs - out.startMs;
    check(id, 'settled ~500 ms after refusal, >1,000 ms after the call', fromRefusal >= 495 && fromRefusal < 800 && fromStart > 1100, { fromRefusal, fromStart }, '495-800 / > 1,100');
    cleanupChecks(id);
  }
}

// R5: timely specific causes with controlled delays below the budget, and code-specific lookups.
const timely = [
  ['R5a-executable-missing-400ms', {}, (t) => (t.startsWith('binary') ? { kind: 'delay', ms: 400, override: ENOENT() } : { kind: 'pass', override: DIR() }), { ...baseRefused, startRefusal: 'executable-missing' }, ['binary', 'binary.com', 'binary.exe'], [395, 700]],
  ['R5b-wd-missing-850ms', {}, (t) => (t === 'binary' ? { kind: 'pass', override: FILE() } : t.startsWith('binary') ? { kind: 'pass', override: ENOENT() } : { kind: 'delay', ms: 850, override: ENOENT() }), { ...baseRefused, startRefusal: 'working-directory-missing' }, ['binary', 'binary.com', 'binary.exe', 'cwd'], [845, 999]],
  ['R5c-wd-not-directory', {}, (t) => (t === 'binary' ? { kind: 'pass', override: FILE() } : t.startsWith('binary') ? { kind: 'pass', override: ENOENT() } : { kind: 'pass', override: FILE() }), { ...baseRefused, startRefusal: 'working-directory-not-directory' }, ['binary', 'binary.com', 'binary.exe', 'cwd'], [0, 100]],
  ['R5d-wd-directory-no-cause', {}, (t) => (t === 'binary' ? { kind: 'pass', override: FILE() } : t.startsWith('binary') ? { kind: 'pass', override: ENOENT() } : { kind: 'pass', override: DIR() }), baseRefused, ['binary', 'binary.com', 'binary.exe', 'cwd'], [0, 100]],
  ['R5e-eacces-wd-missing', { code: 'EACCES' }, () => ({ kind: 'pass', override: ENOENT() }), { ...baseRefused, spawnCode: 'EACCES', startRefusal: 'working-directory-missing' }, ['cwd'], [0, 100]],
  ['R5f-unknown-code-stat-fault', { code: 'EPERM' }, () => ({ kind: 'pass', override: EPERM() }), { ...baseRefused, spawnCode: 'UNKNOWN' }, ['cwd'], [0, 100]],
];
for (const [id, refusalOptions, policy, expected, lookups, [lo, hi]] of timely) {
  const out = begin(id, { plan: refusal(refusalOptions), policy });
  if (await settle(id, out)) {
    eq(id, 'result', out.result, expected);
    eq(id, 'lookups', statTargets(id), lookups);
    const elapsed = out.settledMs - refusalAt(id);
    check(id, `settled ${lo}-${hi} ms after refusal`, elapsed >= lo && elapsed <= hi, elapsed, [lo, hi]);
    cleanupChecks(id);
  }
}

// R6: wall-clock jumps do not affect the monotonic budget.
{
  const id = 'R6a-wall-clock-forward-timely';
  const out = begin(id, {
    plan: refusal(),
    policy: (t) => (t.startsWith('binary') ? { kind: 'delay', ms: 300, override: ENOENT() } : { kind: 'pass', override: DIR() }),
    onRefusal: () => realSetTimeout(() => shiftWallClock(2 * 3600 * 1000), 50),
  });
  if (await settle(id, out)) eq(id, 'timely cause retained despite +2 h wall clock', out.result, { ...baseRefused, startRefusal: 'executable-missing' });
}
{
  const id = 'R6b-wall-clock-backward-bounded';
  const out = begin(id, {
    plan: refusal(),
    policy: (t) => (t.startsWith('binary') ? { kind: 'hold', override: ENOENT() } : { kind: 'pass', override: DIR() }),
    onRefusal: () => realSetTimeout(() => shiftWallClock(-4 * 3600 * 1000), 50),
  });
  if (await settle(id, out)) {
    const elapsed = out.settledMs - refusalAt(id);
    check(id, 'bounded at ~1,000 ms despite -4 h wall clock', elapsed >= 999 && elapsed <= 1300, elapsed, [999, 1300]);
    eq(id, 'unknown cause', out.result, baseRefused);
    cleanupChecks(id);
  }
  shiftWallClock(2 * 3600 * 1000);
}

// R7: secondary events after refusal do not settle early or add flags; late success and late
// rejection leave the resolved object unchanged; no follow-on lookup.
{
  const id = 'R7a-secondary-events-late-success';
  const out = begin(id, {
    plan: refusal({
      then: (child) =>
        realSetTimeout(() => {
          child.emit('close', -4058);
          child.stdout.emit('error', fault('ENOTCONN'));
          child.stderr.emit('error', fault('ENOTCONN'));
          child.emit('error', fault('EACCES'));
        }, 5),
    }),
    policy: (t) =>
      t === 'binary' ? { kind: 'hold', override: FILE() } : t.startsWith('binary') ? { kind: 'hold', override: ENOENT() } : { kind: 'pass', override: ENOENT() },
  });
  await waitFor(() => refusalAt(id) !== undefined, 1000);
  await waitFor(() => now() >= refusalAt(id) + 500, 1000);
  eq(id, 'not settled by close/pipe faults/second error (at +500 ms)', out.settledMs, null);
  if (await settle(id, out)) {
    const elapsed = out.settledMs - refusalAt(id);
    check(id, 'settled at the budget', elapsed >= 999 && elapsed <= 1300, elapsed, [999, 1300]);
    eq(id, 'exact refusal result: no outputFailed/stdinFailed/cause', out.result, baseRefused);
    eq(id, 'secondary events were delivered to the child', { close: spawnOf(id).closes.map((c) => c.code), later: spawnOf(id).laterErrors.map((e) => e.code) }, { close: [-4058], later: ['EACCES'] });
    cleanupChecks(id);
    const frozen = structuredClone(out.result);
    const same = out.result;
    await waitFor(() => now() >= refusalAt(id) + 1500, 1000);
    releaseHeld((r) => r.caseId === id);
    await sleep(200);
    eq(id, 'late success+rejection: same resolved object, deep-equal', { same: out.result === same, value: out.result }, { same: true, value: frozen });
    eq(id, 'no follow-on working-directory lookup after late success', statTargets(id), ['binary', 'binary.com', 'binary.exe']);
  }
}
{
  const id = 'R7b-late-wd-rejection';
  const out = begin(id, {
    plan: refusal(),
    policy: (t) =>
      t === 'binary' ? { kind: 'pass', override: FILE() } : t.startsWith('binary') ? { kind: 'pass', override: ENOENT() } : { kind: 'hold', override: ENOENT() },
  });
  if (await settle(id, out)) {
    eq(id, 'unknown cause at the budget', out.result, baseRefused);
    const frozen = structuredClone(out.result);
    releaseHeld((r) => r.caseId === id);
    await sleep(200);
    eq(id, 'late wd rejection leaves result unchanged', out.result, frozen);
    eq(id, 'lookups', statTargets(id), ['binary', 'binary.com', 'binary.exe', 'cwd']);
    cleanupChecks(id);
  }
}

// R8: earlier request deadline and abort keep priority; pre-aborted signal starts nothing.
{
  const id = 'R8a-request-deadline-15ms';
  const out = begin(id, {
    plan: refusal(),
    timeoutMs: 15,
    policy: (t) => (t.startsWith('binary') ? { kind: 'hold', override: ENOENT() } : { kind: 'pass', override: ENOENT() }),
  });
  if (await settle(id, out)) {
    eq(id, 'refusal without cause; a refused start is not a timeout', out.result, baseRefused);
    const fromStart = out.settledMs - out.startMs;
    check(id, 'settled at the 15 ms request deadline', fromStart >= 14 && fromStart < 100, fromStart, [14, 100]);
    eq(id, 'request timer fired; diagnostic timer cleared', ctl.timers.filter((t) => t.caseId === id).map((t) => ({ delay: t.delay, fired: t.firedMs !== null, cleared: t.clearedMs !== null })), [{ delay: 15, fired: true, cleared: false }, { delay: 1000, fired: false, cleared: true }]);
    cleanupChecks(id);
  }
}
{
  const id = 'R8b-abort-200ms';
  const controller = new AbortController();
  let abortMs = null;
  const out = begin(id, {
    plan: refusal(),
    signal: controller.signal,
    policy: (t) => (t.startsWith('binary') ? { kind: 'hold', override: ENOENT() } : { kind: 'pass', override: ENOENT() }),
    onRefusal: () => realSetTimeout(() => ((abortMs = now()), controller.abort()), 200),
  });
  if (await settle(id, out)) {
    eq(id, 'aborted refusal without cause', out.result, { ...baseRefused, aborted: true });
    check(id, 'settled within 50 ms of abort', out.settledMs - abortMs >= 0 && out.settledMs - abortMs < 50, out.settledMs - abortMs, [0, 50]);
    eq(id, 'diagnostic timer cleared', diagTimers(id).map((t) => ({ fired: t.firedMs !== null, cleared: t.clearedMs !== null })), [{ fired: false, cleared: true }]);
    cleanupChecks(id);
  }
}
{
  const id = 'R8c-pre-aborted';
  const controller = new AbortController();
  controller.abort();
  const out = begin(id, { plan: refusal(), signal: controller.signal, policy: () => ({ kind: 'pass', override: ENOENT() }) });
  if (await settle(id, out)) {
    eq(id, 'aborted without spawning', { result: out.result, spawns: ctl.spawnCalls.filter((s) => s.caseId === id).length }, { result: { exitCode: null, stdout: '', timedOut: false, aborted: true, overflow: false }, spawns: 0 });
  }
}

// R9: a process that actually started keeps its unbounded behavior.
{
  const id = 'R9a-started-unbounded';
  const out = begin(id, {
    plan: {
      kind: 'scripted',
      make: () => {
        const child = scriptedChild({ pid: 90001 });
        realSetTimeout(() => child.stdout.emit('data', Buffer.from('chunk')), 100);
        realSetTimeout(() => child.emit('close', 0), 1500);
        return child;
      },
    },
    policy: () => ({ kind: 'pass', override: ENOENT() }),
  });
  if (await settle(id, out, 4000)) {
    eq(id, 'completed normally', out.result, { exitCode: 0, stdout: 'chunk', timedOut: false, aborted: false, overflow: false });
    const fromStart = out.settledMs - out.startMs;
    check(id, 'not cut at 1,000 ms; settled at close (~1,500 ms)', fromStart >= 1490 && fromStart < 1800, fromStart, [1490, 1800]);
    eq(id, 'no metadata lookup and no runner timer', { stats: statTargets(id), timers: ctl.timers.filter((t) => t.caseId === id).length }, { stats: [], timers: 0 });
    eq(id, 'no kill', ctl.killCalls.filter((k) => k.caseId === id).length, 0);
  }
}
{
  const id = 'R9b-started-later-error';
  const out = begin(id, {
    plan: {
      kind: 'scripted',
      make: () => {
        const child = scriptedChild({ pid: 90002 });
        realSetTimeout(() => child.emit('error', fault('EPERM')), 100);
        realSetTimeout(() => child.emit('close', 0), 200);
        return child;
      },
    },
    policy: () => ({ kind: 'pass', override: ENOENT() }),
  });
  if (await settle(id, out)) {
    eq(id, 'later error of a started child is not a refusal', out.result, { exitCode: 0, stdout: '', timedOut: false, aborted: false, overflow: false });
    eq(id, 'no metadata lookup', statTargets(id), []);
  }
}

ctl.caseId = 'cleanup';
const leftover = releaseHeld();
await sleep(100);
eq('cleanup', 'no controlled stat left held', ctl.held.length, 0);
eq('cleanup', 'no unhandled rejection', ctl.unhandled, []);
clearTimeout(guard);
const failed = writeObservations('c2-runner', { selfCheck, results, leftoverReleasedAtCleanup: leftover, refusedKeys: REFUSED_KEYS });
process.exitCode = failed ? 1 : 0;
