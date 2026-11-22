// C3: public failure/submission mapping, privacy, F1/F2 preservation and normal completed checks
// through the built ClaudeHarness with its default runner and genuine native fixture processes.
import { join } from 'node:path';
import { copyFileSync, mkdirSync, readFileSync, renameSync, rmdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  ctl,
  install,
  URLS,
  CANARY,
  TEXT,
  now,
  sleep,
  waitFor,
  check,
  eq,
  privacy,
  publicError,
  pendingTimers,
  attachedListeners,
  releaseHeld,
  scriptedChild,
  fault,
  freshRoot,
  removeOwnedRoot,
  writeObservations,
  realSetTimeout,
} from './lib/qa.mjs';

const guard = realSetTimeout(() => {
  process.stdout.write('instrumentation guard: driver exceeded 150 s\n');
  writeObservations('c3-public-mapping-guard-abort', { guard: true });
  process.exit(3);
}, 150_000);
const selfCheck = install();
const { ClaudeHarness } = await import(URLS.claudeIndex);
eq('setup', 'seams bound for candidate process.js (fs, child, kill)',
  ctl.redirects.filter((r) => r.from === 'candidate').map((r) => r.specifier).sort(),
  ['../process/index.js', 'node:child_process', 'node:fs/promises']);

const ROOT = freshRoot('c3');
const NODE = process.execPath;
let BIN = NODE;
let WD = '';
ctl.classify = (path) => {
  if (path === BIN) return 'binary';
  if (path === `${BIN}.com`) return 'binary.com';
  if (path === `${BIN}.exe`) return 'binary.exe';
  if (path === WD) return 'cwd';
  if (typeof path === 'string' && path.includes('gg-claude-probe-')) return 'probe-dir';
  return 'other';
};
const results = {};
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const caseSpawns = (id) => ctl.spawnCalls.filter((s) => s.caseId === id);
const statsOf = (id) => ctl.statCalls.filter((s) => s.caseId === id);
const problem = (detail) => `${detail} ${TEXT.CHECK_ACTION}`;
function setCase(id, { binary = NODE, wd = '', policy = () => ({ kind: 'pass' }), plan = () => ({ kind: 'native' }), onRefusal = null } = {}) {
  ctl.caseId = id;
  BIN = binary;
  WD = wd;
  ctl.statPolicy = policy;
  ctl.spawnPlan = plan;
  ctl.onRefusal = onRefusal;
  results[id] = {};
}
function startTurn(claude, signal) {
  const out = { events: [], eventsClosedMs: null, settledMs: null, outcome: null, sessionId: null, value: null };
  const session = claude.start(
    {
      workingDirectory: WD,
      model: 'claude-opus-5-5',
      effort: 'high',
      options: { sandbox: 'read-only', approval: 'never' },
      turn: { prompt: `${CANARY} prompt` },
    },
    signal,
  );
  void (async () => {
    for await (const event of session.events) out.events.push(event);
    out.eventsClosedMs = now();
  })();
  session.result.then(
    (value) => ((out.settledMs = now()), (out.outcome = { ok: true }), (out.value = value)),
    (error) => ((out.settledMs = now()), (out.outcome = { ok: false, error: publicError(error) })),
  );
  session.sessionId.then(
    (id) => (out.sessionId = { ok: true, id }),
    (error) => (out.sessionId = { ok: false, error: publicError(error) }),
  );
  return out;
}
const harness = (options = {}) => new ClaudeHarness({ binary: BIN, platform: 'win32', ...options });
const fixedError = (code, message) => ({ type: 'error', code, message, retriable: false, submission: 'definitely-not-submitted' });
async function refusedTurn(id, code, message) {
  const out = startTurn(harness(), new AbortController().signal);
  const ok = await waitFor(() => out.settledMs !== null && out.eventsClosedMs !== null, 6000);
  check(id, 'turn terminal', ok, ok, true);
  const turn = caseSpawns(id).find((s) => s.kind === 'turn');
  eq(id, 'three successful probes then one refused turn', caseSpawns(id).map((s) => [s.kind, s.pidAtReturn]), [['version', true], ['help', true], ['auth', true], ['turn', false]]);
  check(id, 'turn refused natively with ENOENT', turn?.error?.code === 'ENOENT' && turn.error.syscallIsSpawn, turn?.error, 'ENOENT spawn');
  eq(id, 'public event mapping with definite non-submission', out.events, [fixedError(code, message)]);
  eq(id, 'result error mapping', out.outcome, { ok: false, error: { name: 'ClaudeHarnessError', constructor: 'ClaudeHarnessError', code, message, retriable: false } });
  results[id].elapsedFromRefusalMs = out.settledMs - turn.error.atMs;
  check(id, 'timely diagnosis settled well within the budget', results[id].elapsedFromRefusalMs < 500, results[id].elapsedFromRefusalMs, '< 500 ms');
  eq(id, 'no runner timer pending; no listener left; no kill', { timers: pendingTimers(id).length, listeners: attachedListeners(id).length, kills: ctl.killCalls.filter((k) => k.caseId === id).length }, { timers: 0, listeners: 0, kills: 0 });
  privacy(id, 'events, result and sessionId', { events: out.events, outcome: out.outcome, sessionId: out.sessionId });
  results[id].events = out.events;
  return out;
}

// M1b: working directory is a file (genuine native refusal, real stat).
{
  const id = 'M1b-wd-is-file';
  mkdirSync(join(ROOT, id));
  const file = join(ROOT, id, `${CANARY}-file.txt`);
  writeFileSync(file, 'qa');
  setCase(id, { wd: file });
  await refusedTurn(id, 'HARNESS_INVALID_CONFIGURATION', TEXT.NOT_DIR_TURN);
  eq(id, 'timely lookups', statsOf(id).map((s) => [s.target, s.delivered]), [['binary', 'stats:non-directory'], ['binary.com', 'error:ENOENT'], ['binary.exe', 'error:ENOENT'], ['cwd', 'stats:non-directory']]);
}

// M1c: executable removed only for the turn spawn (scratch copy of node.exe renamed away).
{
  const id = 'M1c-executable-missing-at-turn';
  mkdirSync(join(ROOT, id, 'workspace'), { recursive: true });
  mkdirSync(join(ROOT, 'bin'));
  const copy = join(ROOT, 'bin', 'claude-qa.exe');
  copyFileSync(NODE, copy);
  results.binaryCopy = { sha256: sha(copy), nodeSha256: sha(NODE) };
  ctl.fixtureBinaries.add(copy);
  let renameAttempts = 0;
  setCase(id, {
    binary: copy,
    wd: join(ROOT, id, 'workspace'),
    plan: (rec) =>
      rec.kind === 'turn'
        ? {
            kind: 'native',
            before: () => {
              for (;;) {
                renameAttempts += 1;
                try {
                  renameSync(copy, `${copy}.away`);
                  return;
                } catch (error) {
                  if (renameAttempts >= 40) throw error;
                  sleepSync(25);
                }
              }
            },
          }
        : { kind: 'native' },
  });
  await refusedTurn(id, 'HARNESS_NOT_INSTALLED', TEXT.MISSING_EXE_TURN);
  results[id].renameAttempts = renameAttempts;
  eq(id, 'timely lookups: every executable name absent', statsOf(id).map((s) => [s.target, s.delivered]), [['binary', 'error:ENOENT'], ['binary.com', 'error:ENOENT'], ['binary.exe', 'error:ENOENT']]);
  renameSync(`${copy}.away`, copy);
  results.binaryCopy.restoredSha256 = sha(copy);
}

// M2a: earlier request deadline (preflightTimeoutMs 50) with held metadata; no false timeout.
{
  const id = 'M2a-preflight-request-deadline';
  mkdirSync(join(ROOT, id));
  setCase(id, {
    binary: join(ROOT, id, `${CANARY}-missing-cli.exe`),
    policy: (t) => (t.startsWith('binary') ? { kind: 'hold' } : { kind: 'pass' }),
  });
  const start = now();
  const preflight = await harness({ preflightTimeoutMs: 50 }).preflight();
  const elapsed = now() - start;
  results[id] = { elapsedMs: elapsed, preflight };
  eq(id, 'preflight facts', { state: preflight.state, ok: preflight.ok, problems: preflight.problems, authMethod: preflight.authMethod, version: preflight.version, authenticated: preflight.authenticated }, { state: 'unknown', ok: false, problems: [problem(TEXT.PROBE_UNKNOWN)], authMethod: null, version: undefined, authenticated: undefined });
  check(id, 'settled by the 50 ms request deadlines, far below the 1,000 ms budget', elapsed < 600, elapsed, '< 600 ms');
  eq(id, 'probes refused natively (version, then auth)', caseSpawns(id).map((s) => [s.kind, s.pidAtReturn, s.error?.code]), [['version', false, 'ENOENT'], ['auth', false, 'ENOENT']]);
  eq(id, 'request timers fired; diagnostic timers cleared', ctl.timers.filter((t) => t.caseId === id).map((t) => [t.delay, t.firedMs !== null, t.clearedMs !== null]), [[50, true, false], [1000, false, true], [50, true, false], [1000, false, true]]);
  const before = statsOf(id).length;
  releaseHeld((r) => r.caseId === id);
  await sleep(200);
  eq(id, 'late metadata starts no follow-on lookup', statsOf(id).length, before);
  privacy(id, 'preflight', preflight);
}

// M2b: external abort during held metadata keeps cancellation priority.
{
  const id = 'M2b-external-abort';
  mkdirSync(join(ROOT, id));
  const controller = new AbortController();
  let abortMs = null;
  setCase(id, {
    wd: join(ROOT, id, `${CANARY}-missing`),
    policy: (t) => (t === 'cwd' ? { kind: 'hold' } : { kind: 'pass' }),
    onRefusal: () => realSetTimeout(() => ((abortMs = now()), controller.abort()), 200),
  });
  const out = startTurn(harness(), controller.signal);
  const ok = await waitFor(() => out.settledMs !== null && out.eventsClosedMs !== null, 4000);
  check(id, 'terminal', ok, ok, true);
  eq(id, 'cancellation result, no error event', { events: out.events, name: out.outcome?.error?.name, message: out.outcome?.error?.message, sessionId: out.sessionId?.error?.name }, { events: [], name: 'AbortError', message: 'Claude turn cancelled', sessionId: 'AbortError' });
  check(id, 'settled within 50 ms of abort (before the 1,000 ms budget)', out.settledMs - abortMs >= 0 && out.settledMs - abortMs < 50, out.settledMs - abortMs, [0, 50]);
  eq(id, 'one turn attempt, no kill, timers/listeners released', { turns: caseSpawns(id).filter((s) => s.kind === 'turn').length, kills: ctl.killCalls.filter((k) => k.caseId === id).length, timers: pendingTimers(id).length, listeners: attachedListeners(id).length }, { turns: 1, kills: 0, timers: 0, listeners: 0 });
  releaseHeld((r) => r.caseId === id);
  await sleep(200);
  eq(id, 'late metadata leaves cancellation unchanged', out.outcome.error.name, 'AbortError');
  privacy(id, 'cancellation outcome', { events: out.events, outcome: out.outcome });
}

// M3: F1 preservation — auth output loss is unknown, never a sign-out; completed sign-out is auth.
const scriptedAuth = (variant) => ({
  kind: 'scripted',
  make: () => {
    const child = scriptedChild({ pid: 70001 });
    realSetTimeout(() => {
      const stream = variant === 'stdout' ? child.stdout : child.stderr;
      stream.emit('data', Buffer.from('Not logged in\n'));
      stream.emit('error', fault(variant === 'stdout' ? 'EPIPE' : 'ECONNRESET'));
      child.emit('close', variant === 'stdout' ? 1 : null);
    }, 5);
    return child;
  },
});
for (const variant of ['stdout', 'stderr']) {
  const id = `M3-output-loss-${variant}`;
  setCase(id, { plan: (rec) => (rec.kind === 'auth' ? scriptedAuth(variant) : { kind: 'native' }) });
  const preflight = await harness().preflight();
  results[id] = { preflight };
  eq(id, 'output loss is unknown with no signed-out fact', { state: preflight.state, ok: preflight.ok, problems: preflight.problems, hasAuthenticated: 'authenticated' in preflight, version: preflight.version }, { state: 'unknown', ok: false, problems: [problem(TEXT.PROBE_OUTPUT_LOST)], hasAuthenticated: false, version: '2.1.290' });
  eq(id, 'owned-tree shutdown requested once for the started check', ctl.killCalls.filter((k) => k.caseId === id).map((k) => [k.pidPresent, k.scripted]), [[true, true]]);
  privacy(id, 'preflight', preflight);
}
{
  const id = 'M3-completed-sign-out';
  setCase(id, { plan: (rec) => (rec.kind === 'auth' ? { kind: 'native', fixtureMode: 'signed-out' } : { kind: 'native' }) });
  const preflight = await harness().preflight();
  results[id] = { preflight };
  eq(id, 'completed sign-out is auth', { state: preflight.state, problems: preflight.problems, authenticated: preflight.authenticated }, { state: 'auth', problems: [TEXT.SIGNED_OUT], authenticated: false });
  privacy(id, 'preflight', preflight);
}

// M4: F2 preservation — a help-only start refusal keeps its own cause (native check folder).
for (const held of [false, true]) {
  const id = held ? 'M4b-help-refused-held-past-budget' : 'M4a-help-refused-timely';
  setCase(id, {
    policy: (t) => (held && t === 'probe-dir' ? { kind: 'hold' } : { kind: 'pass' }),
    plan: (rec) =>
      rec.kind === 'help'
        ? { kind: 'native', before: (_r, options) => rmdirSync(options.cwd) }
        : rec.kind === 'auth'
          ? { kind: 'native', before: (_r, options) => mkdirSync(options.cwd) }
          : { kind: 'native' },
  });
  const preflight = await harness().preflight();
  const help = caseSpawns(id).find((s) => s.kind === 'help');
  const helpTimer = ctl.timers.find((t) => t.caseId === id && t.phase === 'probe-help' && t.delay === 1000);
  results[id] = { preflight, helpDiagnosticTimer: helpTimer };
  eq(id, 'help-only cause kept; version and auth succeed', { state: preflight.state, problems: preflight.problems, version: preflight.version, authMethod: preflight.authMethod, authenticated: preflight.authenticated }, { state: 'unknown', problems: [problem(held ? TEXT.PROBE_UNKNOWN : TEXT.PROBE_DIR_MISSING)], version: '2.1.290', authMethod: 'claude.ai', authenticated: true });
  check(id, 'not rewritten as a versioned option failure', !preflight.problems.some((p) => p.includes('--max-turns/--help')), preflight.problems, 'no versioned rewrite');
  eq(id, 'help probe refused natively', [help?.pidAtReturn, help?.error?.code], [false, 'ENOENT']);
  if (held) check(id, 'help diagnosis expired at the budget (timer fired)', helpTimer?.firedMs !== null && helpTimer.firedMs - help.error.atMs >= 999 && helpTimer.firedMs - help.error.atMs < 1300, helpTimer && helpTimer.firedMs - help.error.atMs, [999, 1300]);
  releaseHeld((r) => r.caseId === id);
  await sleep(100);
  privacy(id, 'preflight', preflight);
}

// M5: normal completed checks and ordinary started turns (no budget for started processes).
{
  const id = 'M5a-ready-preflight';
  setCase(id);
  const preflight = await harness().preflight();
  results[id] = { preflight };
  eq(id, 'ready', { state: preflight.state, ok: preflight.ok, problems: preflight.problems, authMethod: preflight.authMethod, authenticated: preflight.authenticated, version: preflight.version }, { state: 'ready', ok: true, problems: [], authMethod: 'claude.ai', authenticated: true, version: '2.1.290' });
  eq(id, 'no metadata lookup', statsOf(id).length, 0);
}
for (const slow of [false, true]) {
  const id = slow ? 'M5c-slow-started-turn' : 'M5b-ordinary-turn';
  mkdirSync(join(ROOT, id, 'workspace'), { recursive: true });
  setCase(id, {
    wd: join(ROOT, id, 'workspace'),
    plan: (rec) => (rec.kind === 'turn' ? { kind: 'native', fixtureMode: slow ? 'slow' : 'success' } : { kind: 'native' }),
  });
  const out = startTurn(harness(), new AbortController().signal);
  const ok = await waitFor(() => out.settledMs !== null && out.eventsClosedMs !== null, 8000);
  check(id, 'terminal', ok, ok, true);
  const turn = caseSpawns(id).find((s) => s.kind === 'turn');
  const types = out.events.map((e) => e.type);
  results[id] = { eventTypes: types, finalText: out.value?.finalText, elapsedFromSpawnMs: out.settledMs - turn.issuedMs };
  check(id, 'completed successfully', out.outcome?.ok === true && out.value?.finalText === 'QA_D203_TURN_OK', { outcome: out.outcome, finalText: out.value?.finalText }, 'QA_D203_TURN_OK');
  check(id, 'events include session/submitted/usage/turn-complete, no error', ['session', 'submitted', 'usage', 'turn-complete'].every((t) => types.includes(t)) && !types.includes('error'), types, 'complete stream');
  eq(id, 'turn started natively and closed 0', [turn?.pidAtReturn, turn?.closes[0]?.code], [true, 0]);
  eq(id, 'no metadata lookup and no runner timer for the unbounded turn', { stats: statsOf(id).length, turnTimers: ctl.timers.filter((t) => t.caseId === id && t.phase === 'turn').length }, { stats: 0, turnTimers: 0 });
  if (slow) check(id, 'started turn ran past 1,000 ms (>= 1,500 ms) and still completed', results[id].elapsedFromSpawnMs >= 1500, results[id].elapsedFromSpawnMs, '>= 1500 ms');
  privacy(id, 'events and outcome', { events: out.events, outcome: out.outcome });
}

ctl.caseId = 'cleanup';
const leftover = releaseHeld();
await sleep(200);
eq('cleanup', 'no controlled stat left held', ctl.held.length, 0);
eq('cleanup', 'every started native fixture process closed', ctl.spawnCalls.filter((s) => s.pidAtReturn && s.mode === 'native').every((s) => s.closes.length > 0), true);
eq('cleanup', 'no unhandled rejection', ctl.unhandled, []);
const removed = removeOwnedRoot(ROOT);
clearTimeout(guard);
const failed = writeObservations('c3-public-mapping', { selfCheck, results, leftoverReleasedAtCleanup: leftover, scratchRootRemoved: removed });
process.exitCode = failed ? 1 : 0;
