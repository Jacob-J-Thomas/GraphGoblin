// C4: finite old-source control (T4). The candidate dist is used unchanged except that
// harness.js's './process.js' import resolves to the scratch build of the exact parent
// (580aded6) process.ts. Same seams, fixture, default runner and held working-directory stat as
// candidate cases P2/P4. Observe a bounded window, then release the controlled stat.
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  ctl,
  install,
  URLS,
  CANARY,
  TEXT,
  SCRATCH,
  now,
  sleep,
  waitFor,
  check,
  eq,
  publicError,
  releaseHeld,
  freshRoot,
  removeOwnedRoot,
  writeObservations,
  realSetTimeout,
} from './lib/qa.mjs';

const guard = realSetTimeout(() => {
  process.stdout.write('instrumentation guard: driver exceeded 90 s\n');
  writeObservations('c4-old-source-guard-abort', { guard: true });
  process.exit(3);
}, 90_000);
const OLD = pathToFileURL(join(SCRATCH, 'old-build', 'claude', 'process.js')).href;
const selfCheck = install({ oldProcessURL: OLD });
const { ClaudeHarness } = await import(URLS.claudeIndex);
const testing = await import(URLS.engineTesting);
eq('setup', 'harness.js bound to the scratch parent process.js; seams bound for it; candidate process.js not loaded',
  {
    harness: ctl.redirects.filter((r) => r.from === 'harness').length,
    old: ctl.redirects.filter((r) => r.from === 'old').map((r) => r.specifier).sort(),
    candidate: ctl.redirects.filter((r) => r.from === 'candidate').length,
  },
  { harness: 1, old: ['../process/index.js', 'node:child_process', 'node:fs/promises'], candidate: 0 });

const BIN = process.execPath;
const ROOT = freshRoot('c4');
let WD = '';
ctl.classify = (path) => {
  if (path === BIN) return 'binary';
  if (path === `${BIN}.com`) return 'binary.com';
  if (path === `${BIN}.exe`) return 'binary.exe';
  if (path === WD) return 'cwd';
  if (typeof path === 'string' && path.includes('gg-claude-probe-')) return 'probe-dir';
  return 'other';
};
ctl.statPolicy = (target) => (target === 'cwd' ? { kind: 'hold' } : { kind: 'pass' });
const harness = () => new ClaudeHarness({ binary: BIN, platform: 'win32' });
const turnSpawn = (id) => ctl.spawnCalls.find((s) => s.caseId === id && s.kind === 'turn');
const results = {};

// O1: old public default turn with the working-directory stat held.
{
  const id = 'O1-old-public-default-turn';
  ctl.caseId = id;
  WD = join(ROOT, id, `${CANARY}-missing`);
  mkdirSync(join(ROOT, id));
  const out = { events: [], eventsClosedMs: null, settledMs: null, outcome: null };
  const session = harness().start(
    {
      workingDirectory: WD,
      model: 'claude-opus-5-5',
      effort: 'high',
      options: { sandbox: 'read-only', approval: 'never' },
      turn: { prompt: `${CANARY} prompt` },
    },
    new AbortController().signal,
  );
  void (async () => {
    for await (const event of session.events) out.events.push(event);
    out.eventsClosedMs = now();
  })();
  session.result.then(
    () => ((out.settledMs = now()), (out.outcome = { ok: true })),
    (error) => ((out.settledMs = now()), (out.outcome = { ok: false, error: publicError(error) })),
  );
  await waitFor(() => turnSpawn(id)?.error, 6000);
  const turn = turnSpawn(id);
  check(id, 'turn genuinely refused natively (no pid, ENOENT)', turn && !turn.pidAtReturn && turn.error?.code === 'ENOENT', turn?.error, 'ENOENT');
  const windows = [];
  for (const at of [1500, 3000]) {
    await waitFor(() => now() >= turn.error.atMs + at, at + 500);
    windows.push({ atMsFromRefusal: at, settled: out.settledMs !== null, events: out.events.length, queueClosed: out.eventsClosedMs !== null });
  }
  results[id] = { windows };
  eq(id, 'old source: still pending at +1,500 and +3,000 ms (no result, no event, queue open)', windows.map((w) => [w.settled, w.events, w.queueClosed]), [[false, 0, false], [false, 0, false]]);
  eq(id, 'old source: no diagnostic timer and no request timer for the turn', ctl.timers.filter((t) => t.caseId === id && t.phase === 'turn').length, 0);
  const releaseMs = now();
  releaseHeld((r) => r.caseId === id);
  const settled = await waitFor(() => out.settledMs !== null && out.eventsClosedMs !== null, 2000);
  check(id, 'old source settles only after the controlled release', settled && out.settledMs - releaseMs < 50, settled ? out.settledMs - releaseMs : null, '< 50 ms after release');
  eq(id, 'old source accepts the late metadata as the cause', out.events, [{ type: 'error', code: 'HARNESS_INVALID_CONFIGURATION', message: TEXT.MISSING_DIR_TURN, retriable: false, submission: 'definitely-not-submitted' }]);
  results[id].settledMsFromRefusal = out.settledMs - turn.error.atMs;
  results[id].events = out.events;
}

// O2: old engine default run (in-memory fake ports, real harness), no watchdog/deadline.
{
  const id = 'O2-old-engine-default-run';
  ctl.caseId = id;
  WD = join(ROOT, id, `${CANARY}-missing`);
  mkdirSync(join(ROOT, id));
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
    ...testing.singleNodeLoop('d203-qa-old-default-loop', {
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
  const run = await engine.start(version.loopId);
  await waitFor(() => turnSpawn(id)?.error, 6000);
  const turn = turnSpawn(id);
  check(id, 'turn genuinely refused natively (no pid, ENOENT)', turn && !turn.pidAtReturn && turn.error?.code === 'ENOENT', turn?.error, 'ENOENT');
  await waitFor(() => now() >= turn.error.atMs + 3000, 3500);
  const during = await engine.ports.runs.get(run.id);
  results[id] = { statusAt3000: during.status, pinnedLimits: during.pinned?.limits };
  check(id, 'old source: run still non-terminal at +3,000 ms', ['queued', 'running', 'waiting'].includes(during.status), during.status, 'queued/running/waiting');
  eq(id, 'default run deadline null', during.pinned?.limits?.runDeadlineSeconds, null);
  const releaseMs = now();
  releaseHeld((r) => r.caseId === id);
  let finalRecord;
  const done = await Promise.race([engine.settle(run.id).then((r) => (finalRecord = r)), sleep(3000).then(() => undefined)]);
  check(id, 'old run terminal after the release', done !== undefined && finalRecord?.status === 'failed', finalRecord?.status, 'failed');
  results[id].terminalMsAfterRelease = now() - releaseMs;
  const failure = finalRecord?.failure;
  results[id].failure = failure;
  eq(id, 'old source: late cause becomes the run failure', {
    code: failure?.code,
    message: failure?.message,
    adapterCode: failure?.details?.adapterCode,
    submission: failure?.inference?.submission,
  }, {
    code: 'HARNESS_TURN_FAILED',
    message: `harness turn failed: ${TEXT.MISSING_DIR_TURN}`,
    adapterCode: 'HARNESS_INVALID_CONFIGURATION',
    submission: 'definitely-not-submitted',
  });
  eq(id, 'one turn attempt', ctl.spawnCalls.filter((s) => s.caseId === id && s.kind === 'turn').length, 1);
}

ctl.caseId = 'cleanup';
const leftover = releaseHeld();
await sleep(200);
eq('cleanup', 'no controlled stat left held', ctl.held.length, 0);
eq('cleanup', 'every started native fixture process closed', ctl.spawnCalls.filter((s) => s.pidAtReturn).every((s) => s.closes.length > 0), true);
eq('cleanup', 'no unhandled rejection', ctl.unhandled, []);
const removed = removeOwnedRoot(ROOT);
clearTimeout(guard);
const failed = writeObservations('c4-old-source', { selfCheck, oldProcessURL: OLD, results, leftoverReleasedAtCleanup: leftover, scratchRootRemoved: removed });
process.exitCode = failed ? 1 : 0;
