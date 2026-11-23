// C1: public ClaudeHarness default turn (built dist, default runner) after successful native
// prerequisites, timeoutMs:null, no watchdog or external abort, genuine native no-PID refusal of
// the turn (missing working directory) and controlled delivery of the post-refusal stat results.
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ctl,
  install,
  URLS,
  CANARY,
  TEXT,
  TEMP_ROOT,
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
  freshRoot,
  removeOwnedRoot,
  fileStats,
  writeObservations,
  realSetTimeout,
} from './lib/qa.mjs';

const guard = realSetTimeout(() => {
  process.stdout.write('instrumentation guard: driver exceeded 120 s\n');
  writeObservations('c1-public-turn-guard-abort', { guard: true });
  process.exit(3);
}, 120_000);
const selfCheck = install();
const { ClaudeHarness } = await import(URLS.claudeIndex);
const testing = await import(URLS.engineTesting);
const harnessText = readFileSync(fileURLToPath(URLS.harness), 'utf8');
eq('setup', 'seams bound for candidate process.js (fs, child, kill)',
  ctl.redirects.filter((r) => r.from === 'candidate').map((r) => r.specifier).sort(),
  ['../process/index.js', 'node:child_process', 'node:fs/promises']);
check('setup', 'built harness passes timeoutMs: null for turns', /timeoutMs: null,/.test(harnessText), null, true);
eq('setup', 'TEMP/TMP canonical backslash spelling', [process.env.TEMP, process.env.TMP], [TEMP_ROOT, TEMP_ROOT]);

const BIN = process.execPath;
const ROOT = freshRoot('c1');
let WD = '';
ctl.classify = (path) => {
  if (path === BIN) return 'binary';
  if (path === `${BIN}.com`) return 'binary.com';
  if (path === `${BIN}.exe`) return 'binary.exe';
  if (path === WD) return 'cwd';
  if (typeof path === 'string' && path.includes('gg-claude-probe-')) return 'probe-dir';
  return 'other';
};
const harness = () => new ClaudeHarness({ binary: BIN, platform: 'win32' });
const results = {};

function startTurn(claude, signal) {
  const out = { events: [], eventsClosedMs: null, settledMs: null, outcome: null, sessionId: null };
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
    for await (const event of session.events) out.events.push({ atMs: now(), event });
    out.eventsClosedMs = now();
  })();
  session.result.then(
    (value) => ((out.settledMs = now()), (out.outcome = { ok: true, value })),
    (error) => ((out.settledMs = now()), (out.outcome = { ok: false, error: publicError(error) })),
  );
  session.sessionId.then(
    (id) => (out.sessionId = { ok: true, id }),
    (error) => (out.sessionId = { ok: false, error: publicError(error) }),
  );
  return out;
}
const caseSpawns = (id) => ctl.spawnCalls.filter((s) => s.caseId === id);
const turnSpawn = (id) => caseSpawns(id).find((s) => s.kind === 'turn');
const errorEvent = (code, message) => ({
  type: 'error',
  code,
  message,
  retriable: false,
  submission: 'definitely-not-submitted',
});
const snapshot = (id, out) =>
  JSON.stringify({
    events: out.events.map((e) => e.event),
    outcome: out.outcome,
    sessionId: out.sessionId,
    spawns: caseSpawns(id).length,
    kills: ctl.killCalls.filter((k) => k.caseId === id).length,
    stats: ctl.statCalls.filter((s) => s.caseId === id).map((s) => s.target),
  });

/** Common terminal assertions for a refused default turn. */
function assertRefusedTurn(id, out, { code, message, minMs, maxMs }) {
  const spawns = caseSpawns(id);
  eq(id, 'spawn sequence: three probes then exactly one turn attempt', spawns.map((s) => s.kind), ['version', 'help', 'auth', 'turn']);
  check(id, 'probes started natively (pid) and closed 0', spawns.slice(0, 3).every((s) => s.pidAtReturn && s.closes[0]?.code === 0), spawns.slice(0, 3).map((s) => ({ pid: s.pidAtReturn, close: s.closes[0]?.code })), 'pid + close 0');
  const turn = turnSpawn(id);
  check(id, 'turn spawn genuinely refused natively: no pid, spawn ENOENT error', turn && !turn.pidAtReturn && turn.error?.code === 'ENOENT' && turn.error.syscallIsSpawn && !turn.error.pidAtError, turn && { pid: turn.pidAtReturn, error: turn.error }, 'no pid, ENOENT, spawn syscall');
  const elapsed = out.settledMs - turn.error.atMs;
  results[id].elapsedFromRefusalMs = elapsed;
  check(id, `settled ${minMs}-${maxMs} ms after the native refusal`, elapsed >= minMs && elapsed <= maxMs, elapsed, [minMs, maxMs]);
  eq(id, 'public events: exactly the fixed error with definite non-submission', out.events.map((e) => e.event), [errorEvent(code, message)]);
  eq(id, 'result rejects with the same fixed failure', out.outcome, {
    ok: false,
    error: { name: 'ClaudeHarnessError', constructor: 'ClaudeHarnessError', code, message, retriable: false },
  });
  check(id, 'sessionId rejects with the same code', out.sessionId?.ok === false && out.sessionId.error.code === code, out.sessionId, code);
  check(id, 'no false timeout or cancellation', out.outcome.error.code !== 'HARNESS_TIMEOUT' && out.outcome.error.name !== 'AbortError' && !/timed out|cancel/i.test(out.outcome.error.message), out.outcome.error, 'not timeout/abort');
  check(id, 'event queue closed with the result', out.eventsClosedMs !== null && out.eventsClosedMs - out.settledMs < 50, out.eventsClosedMs === null ? null : out.eventsClosedMs - out.settledMs, '< 50 ms');
  eq(id, 'no kill was requested (no process existed)', ctl.killCalls.filter((k) => k.caseId === id).length, 0);
  const turnTimers = ctl.timers.filter((t) => t.caseId === id && t.phase === 'turn');
  check(id, 'no request timer for the turn (timeoutMs:null): no runner timer before the refusal', turnTimers.every((t) => t.createdMs >= turn.error.atMs), turnTimers, 'all turn timers created at/after refusal');
  eq(id, 'no runner timer pending after settlement', pendingTimers(id), []);
  eq(id, 'no process/harness abort listener left attached', attachedListeners(id).map((l) => l.owner), []);
  check(id, 'runner added and removed its abort listener on the turn signal', ctl.listeners.some((l) => l.caseId === id && l.owner === 'process' && l.phase === 'turn' && l.removedMs !== null), ctl.listeners.filter((l) => l.caseId === id).map((l) => ({ owner: l.owner, phase: l.phase, removed: l.removedMs !== null })), 'process listener removed');
  privacy(id, 'events and result', { events: out.events.map((e) => e.event), outcome: out.outcome, sessionId: out.sessionId });
}

/** Release late metadata after settlement and verify nothing changes. */
async function lateRelease(id, out, holdUntilMs) {
  const turn = turnSpawn(id);
  await waitFor(() => now() >= turn.error.atMs + holdUntilMs, holdUntilMs + 1000);
  const before = snapshot(id, out);
  const statsBefore = ctl.statCalls.filter((s) => s.caseId === id).length;
  const held = ctl.held.filter((h) => h.rec.caseId === id).map((h) => h.rec);
  results[id].heldBeforeRelease = held.map((r) => ({ target: r.target, mode: r.mode, nativeCompletedBeforeRelease: r.nativeCompletedMs !== null, nativeOutcome: r.nativeOutcome }));
  check(id, 'held metadata still undelivered at release time (pending past the budget)', held.length > 0 && held.every((r) => r.deliveredMs === null), held.length, '> 0 undelivered');
  const released = releaseHeld((rec) => rec.caseId === id);
  results[id].releasedAtMsFromRefusal = now() - turn.error.atMs;
  await sleep(300);
  eq(id, 'late metadata delivered', ctl.statCalls.filter((s) => s.caseId === id && held.includes(s)).every((s) => s.deliveredMs !== null), true);
  eq(id, 'immutable result/events/spawns/kills after late metadata', snapshot(id, out), before);
  eq(id, 'no follow-on metadata lookup after late delivery', ctl.statCalls.filter((s) => s.caseId === id).length, statsBefore);
  eq(id, 'no unhandled rejection', ctl.unhandled.filter((u) => u.caseId === id), []);
  return released;
}

async function refusedCase(id, policy, expected, late) {
  ctl.caseId = id;
  results[id] = {};
  WD = join(ROOT, id, `${CANARY}-missing`);
  (await import('node:fs')).mkdirSync(join(ROOT, id));
  ctl.statPolicy = policy;
  const external = new AbortController();
  const out = startTurn(harness(), external.signal);
  const settled = await waitFor(() => out.settledMs !== null, 6000);
  check(id, 'turn reached a terminal result without any external abort', settled, settled, true);
  if (!settled) return out;
  await sleep(20);
  check(id, 'external signal never aborted', !external.signal.aborted, external.signal.aborted, false);
  assertRefusedTurn(id, out, expected);
  results[id].statTargets = ctl.statCalls.filter((s) => s.caseId === id).map((s) => ({ target: s.target, mode: s.mode, deliveredMs: s.deliveredMs }));
  if (late) results[id].released = await lateRelease(id, out, late.holdUntilMs);
  results[id].events = out.events;
  results[id].outcome = out.outcome;
  return out;
}

// P0: timely native control (real stat delivered at once).
await refusedCase('P0-timely-native', () => ({ kind: 'pass' }), {
  code: 'HARNESS_INVALID_CONFIGURATION',
  message: TEXT.MISSING_DIR_TURN,
  minMs: 0,
  maxMs: 999,
});
eq('P0-timely-native', 'timely metadata: executable names then working directory', ctl.statCalls.filter((s) => s.caseId === 'P0-timely-native').map((s) => s.target), ['binary', 'binary.com', 'binary.exe', 'cwd']);

// P1: executable-name stats held (native stats issued, delivery withheld) past the budget.
await refusedCase(
  'P1-hold-executable-names',
  (target) => (target.startsWith('binary') ? { kind: 'hold' } : { kind: 'pass' }),
  { code: 'HARNESS_TURN_FAILED', message: TEXT.UNKNOWN_TURN, minMs: 999, maxMs: 1300 },
  { holdUntilMs: 2500 },
);
eq('P1-hold-executable-names', 'only the executable-name lookups were issued; no working-directory lookup ever', ctl.statCalls.filter((s) => s.caseId === 'P1-hold-executable-names').map((s) => s.target), ['binary', 'binary.com', 'binary.exe']);
eq('P1-hold-executable-names', 'late real outcomes were one success and two rejections', ctl.statCalls.filter((s) => s.caseId === 'P1-hold-executable-names').map((s) => s.delivered), ['stats:non-directory', 'error:ENOENT', 'error:ENOENT']);

// P2: working-directory stat held; its real late ENOENT would have meant MISSING_DIR_TURN.
await refusedCase(
  'P2-hold-working-directory',
  (target) => (target === 'cwd' ? { kind: 'hold' } : { kind: 'pass' }),
  { code: 'HARNESS_TURN_FAILED', message: TEXT.UNKNOWN_TURN, minMs: 999, maxMs: 1300 },
  { holdUntilMs: 2500 },
);
eq('P2-hold-working-directory', 'late real working-directory outcome was a rejection (ENOENT)', ctl.statCalls.filter((s) => s.caseId === 'P2-hold-working-directory' && s.target === 'cwd').map((s) => s.delivered), ['error:ENOENT']);

// P3: working-directory stat held with a late success override (a file: would mean NOT_DIR_TURN).
const fileStat = fileStats();
await refusedCase(
  'P3-hold-wd-late-success',
  (target) => (target === 'cwd' ? { kind: 'hold', override: { ok: true, v: fileStat } } : { kind: 'pass' }),
  { code: 'HARNESS_TURN_FAILED', message: TEXT.UNKNOWN_TURN, minMs: 999, maxMs: 1300 },
  { holdUntilMs: 2500 },
);
eq('P3-hold-wd-late-success', 'late working-directory outcome was a success (non-directory stats)', ctl.statCalls.filter((s) => s.caseId === 'P3-hold-wd-late-success' && s.target === 'cwd').map((s) => s.delivered), ['stats:non-directory']);

// P4: public engine default loop (in-memory fake ports; real harness) with no watchdog/deadline.
{
  const id = 'P4-engine-default-loop';
  ctl.caseId = id;
  results[id] = {};
  WD = join(ROOT, id, `${CANARY}-missing`);
  (await import('node:fs')).mkdirSync(join(ROOT, id));
  ctl.statPolicy = (target) => (target === 'cwd' ? { kind: 'hold' } : { kind: 'pass' });
  const engine = await testing.createTestEngine({
    defaults: {
      byHarness: {
        codex: { model: 'gpt-6-luna', effort: 'low' },
        claude: { model: 'claude-opus-5-5', effort: 'high' },
      },
    },
  });
  engine.ports.harnesses.claude = harness();
  engine.ports.modelCatalog.entries.push({
    harness: 'claude',
    model: 'claude-opus-5-5',
    source: 'harness',
    displayName: 'Opus',
    efforts: ['high'],
    defaultEffort: 'high',
    enabled: true,
  });
  const version = engine.publish({
    ...testing.singleNodeLoop('d203-qa-default-loop', {
      id: 'infer',
      kind: 'inference',
      label: 'Infer',
      config: {
        harness: 'claude',
        prompt: { template: `${CANARY} task` },
        harnessOptions: { sandbox: 'read-only', approval: 'never' },
      },
    }),
    settings: { workingDirectory: { kind: 'fixed', path: WD } },
  });
  const node = version.definition.nodes.find((n) => n.id === 'infer');
  eq(id, 'loop runDeadlineSeconds is the null default', version.definition.settings.runDeadlineSeconds, null);
  eq(id, 'inference node has no watchdog (timeoutSeconds absent)', node.config.timeoutSeconds, undefined);
  let record;
  let runDoneMs = null;
  const run = engine.runToIdle(version.loopId).then((r) => ((record = r), (runDoneMs = now())));
  const finished = await waitFor(() => runDoneMs !== null, 8000);
  check(id, 'default run reached a terminal record without abort or deadline', finished, finished, true);
  if (finished) {
    const turn = turnSpawn(id);
    eq(id, 'spawn sequence: three probes then exactly one turn attempt', caseSpawns(id).map((s) => s.kind), ['version', 'help', 'auth', 'turn']);
    check(id, 'turn spawn genuinely refused natively', turn && !turn.pidAtReturn && turn.error?.code === 'ENOENT', turn?.error, 'ENOENT, no pid');
    const elapsed = runDoneMs - turn.error.atMs;
    results[id].elapsedFromRefusalMs = elapsed;
    check(id, 'run terminal 999-1500 ms after the native refusal', elapsed >= 999 && elapsed <= 1500, elapsed, [999, 1500]);
    eq(id, 'run status failed', record.status, 'failed');
    const failure = record.failure;
    results[id].failure = failure;
    results[id].pinnedLimits = record.pinned?.limits;
    eq(id, 'engine failure mapping', {
      code: failure?.code,
      message: failure?.message,
      resumable: failure?.resumable,
      adapterCode: failure?.details?.adapterCode,
      submission: failure?.inference?.submission,
    }, {
      code: 'HARNESS_TURN_FAILED',
      message: `harness turn failed: ${TEXT.UNKNOWN_TURN}`,
      resumable: false,
      adapterCode: 'HARNESS_TURN_FAILED',
      submission: 'definitely-not-submitted',
    });
    eq(id, 'pinned run deadline null', record.pinned?.limits?.runDeadlineSeconds, null);
    eq(id, 'no kill requested', ctl.killCalls.filter((k) => k.caseId === id).length, 0);
    eq(id, 'no runner timer pending', pendingTimers(id), []);
    eq(id, 'no process/harness abort listener left attached', attachedListeners(id).map((l) => l.owner), []);
    privacy(id, 'engine failure', failure);
    await waitFor(() => now() >= turn.error.atMs + 2500, 4000);
    const before = JSON.stringify({ status: record.status, failure, spawns: caseSpawns(id).length });
    releaseHeld((rec) => rec.caseId === id);
    await sleep(300);
    const again = await engine.ports.runs.get(record.id);
    eq(id, 'run record unchanged after late metadata; no further turn', JSON.stringify({ status: again.status, failure: again.failure, spawns: caseSpawns(id).length }), before);
    eq(id, 'no follow-on stat after late delivery', ctl.statCalls.filter((s) => s.caseId === id).map((s) => s.target), ['binary', 'binary.com', 'binary.exe', 'cwd']);
    results[id].eventTypes = engine.eventTypes(record.id);
  }
  await run.catch(() => undefined);
}

// Cleanup: release anything still held, remove only this driver's scratch root.
ctl.caseId = 'cleanup';
const leftover = releaseHeld();
await sleep(200);
eq('cleanup', 'no controlled stat left held at exit (released after observation)', ctl.held.length, 0);
const fixturesClosed = ctl.spawnCalls.filter((s) => s.pidAtReturn).every((s) => s.closes.length > 0);
eq('cleanup', 'every started native fixture process closed', fixturesClosed, true);
eq('cleanup', 'no unhandled rejection in this driver', ctl.unhandled, []);
const removed = removeOwnedRoot(ROOT);
realClear();
function realClear() {
  clearTimeout(guard);
}
const failed = writeObservations('c1-public-turn', { selfCheck, results, leftoverReleasedAtCleanup: leftover, scratchRootRemoved: removed });
process.exitCode = failed ? 1 : 0;
