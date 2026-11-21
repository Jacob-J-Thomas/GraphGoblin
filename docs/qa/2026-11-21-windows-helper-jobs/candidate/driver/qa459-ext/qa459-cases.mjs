// GraphGoblin #459 independent native QA: case table.
//
// Every assertion states the reviewed #459 acceptance semantics (kind `requirement`) or an existing
// safety/positive behaviour that must hold on both baseline and candidate (kind `control`), plus the
// behaviour this QA expects on the unmodified baseline (`baseline`: pass | fail | observe). A
// candidate run must pass every requirement and control; a baseline run is judged on whether each
// observation matched its stated baseline expectation.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const WORK_MS = 15_000;
const CLEANUP_MS = 2_000;
const SLACK_MS = 1_500; // launcher startup, JIT, synchronous OS calls and FILETIME granularity
const FIRST_CHECK_BOUND_MS = WORK_MS + CLEANUP_MS + SLACK_MS;
const RESERVE_MS = 2_000;

const accepted = (invocation) => invocation.code === 'foreign-listener';
const spawnsOf = (ctx) => ctx.events().filter((event) => event.event === 'gateway-start').length;
const storeCalls = (ctx) =>
  ctx.events().filter((event) => event.event === 'helper-start' && event.kind === 'store-state');

function rootNatural(ctx, role, invocation, code) {
  const record = ctx.process(role);
  const relation = ctx.relation(record, invocation, 'afterGrace');
  return {
    relation,
    pass:
      relation.classification === 'natural' && relation.exitCode === code && relation.exitedBeforeLauncherExit,
  };
}

function identityCase({ id, title, category, planRow, identity, marker = true, checks }) {
  return {
    id,
    title,
    lane: 'fixture',
    category,
    planRow,
    async run(ctx) {
      await ctx.prepare({ marker, scenario: { identity } });
      const invocation = await ctx.launch('click');
      await ctx.sleep(ctx.grace);
      await ctx.snapshot('afterGrace');
      checks(ctx, invocation);
    },
  };
}

function memberTerminated(ctx, invocation, role, baseline, text) {
  const result = ctx.terminatedByLauncher(ctx.process(role), invocation, 'afterGrace');
  ctx.check(`${role}-terminated-by-launcher`, {
    kind: 'requirement',
    text: text ?? `${role} is terminated by launcher collection before the launcher exits (non-natural, non-driver exit code)`,
    expected: { exitedBeforeLauncherExit: true, classification: 'terminated-*' },
    actual: result.relation,
    pass: result.pass,
    baseline,
  });
}

/** Caller pipes close when the launcher exits unless another process inherited them. */
function callerEof(ctx, invocation, baseline) {
  ctx.check('caller-eof-at-launcher-exit', {
    kind: 'requirement',
    text: 'the caller\'s launcher stdout/stderr reach EOF within 1500 ms of launcher exit (no helper descendant holds an inherited launcher stdio handle)',
    expected: '<= 1500',
    actual: { afterExitMs: invocation.callerEofAfterExitMs, afterDriverTeardown: invocation.callerEofAfterTeardown ?? 'pending' },
    pass: invocation.callerEofAfterExitMs !== null && invocation.callerEofAfterExitMs <= 1500,
    baseline,
  });
}

function sentinelControl(ctx) {
  ctx.check('sentinel-alive', {
    kind: 'control',
    text: 'same-executable sentinel outside the launcher (also the PowerShell-queried process) remains alive',
    expected: true,
    actual: ctx.sentinelAlive(),
    pass: ctx.sentinelAlive(),
    baseline: 'pass',
  });
}

function privacyControl(ctx) {
  const leaks = ctx.privacyLeaks();
  ctx.check('stderr-sentinel-private', {
    kind: 'control',
    text: 'synthetic stderr sentinel never reaches launcher stdout/stderr, launcher.log(.1) or gateway.log',
    expected: [],
    actual: leaks,
    pass: leaks.length === 0,
    baseline: 'pass',
  });
}

function lockFixture(ctx) {
  mkdirSync(ctx.prepared.dataDir, { recursive: true });
  const path = join(ctx.prepared.dataDir, 'graphgoblin.lock');
  writeFileSync(path, JSON.stringify({ pid: 4, windowsCreationTime: '134000000000000000', token: 'qa459-synthetic-owner' }));
  return { path, before: ctx.lockSnapshot(path) };
}

function lockUnchanged(ctx, lock) {
  const after = ctx.lockSnapshot(lock.path);
  ctx.check('lock-unchanged', {
    kind: 'control',
    text: 'store lock bytes and file identity are read back unchanged (never deleted or replaced)',
    expected: lock.before,
    actual: after,
    pass: after.exists && after.sha256 === lock.before.sha256 && after.fileId === lock.before.fileId,
    baseline: 'pass',
  });
}

function noSpawn(ctx) {
  const spawns = spawnsOf(ctx);
  ctx.check('no-gateway-spawn', {
    kind: 'control',
    text: 'no gateway process is spawned',
    expected: 0,
    actual: spawns,
    pass: spawns === 0,
    baseline: 'pass',
  });
}

export const CASES = [
  {
    id: 'quick-success-fixture-gateway',
    title: 'Clean quick completion: identity + free store sample, one detached fixture gateway, warm reuse',
    lane: 'fixture',
    category: 'positive-control',
    planRow: 'Clean quick completion; independent gateway (fixture lane)',
    async run(ctx) {
      await ctx.prepare({ timeoutSeconds: 10, scenario: { identity: { stdout: 'identity' }, storeStateDefault: { stdout: 'free' } } });
      const cold = await ctx.launch('cold');
      const coldHealth = await ctx.health();
      const warm = await ctx.launch('warm');
      const warmHealth = await ctx.health();
      await ctx.sleep(ctx.grace);
      await ctx.snapshot('afterGrace');
      const gateway = ctx.process('gateway-1');
      ctx.check('cold-exit-zero', { kind: 'control', text: 'cold click exits 0', expected: 0, actual: cold.exitCode, pass: cold.exitCode === 0, baseline: 'pass' });
      ctx.check('one-gateway-spawn', { kind: 'control', text: 'exactly one fixture gateway spawn', expected: 1, actual: spawnsOf(ctx), pass: spawnsOf(ctx) === 1, baseline: 'pass' });
      const reuse = {
        warmExit: warm.exitCode,
        coldPidMatchesHandle: String(gateway?.pid) === coldHealth.pid,
        warmPidSame: coldHealth.pid !== null && coldHealth.pid === warmHealth.pid,
        gatewayAliveAfterWarm: gateway?.samples['atExit:warm']?.alive ?? null,
        identityMatchesFixture: coldHealth.identityMatchesFixture,
      };
      ctx.check('warm-reuse-same-gateway', {
        kind: 'control',
        text: 'warm click exits 0 and reuses the same live gateway (exact handle still alive)',
        expected: { warmExit: 0, coldPidMatchesHandle: true, warmPidSame: true, gatewayAliveAfterWarm: true, identityMatchesFixture: true },
        actual: reuse,
        pass: reuse.warmExit === 0 && reuse.coldPidMatchesHandle && reuse.warmPidSame && reuse.gatewayAliveAfterWarm === true && reuse.identityMatchesFixture,
        baseline: 'pass',
      });
      const roots = [['identity-1', cold], ['store-state-1', cold], ['identity-2', warm]].map(([role, invocation]) => rootNatural(ctx, role, invocation, 0));
      ctx.check('helper-roots-natural-zero', {
        kind: 'control',
        text: 'each helper root exits naturally with 0 before its launcher exits',
        expected: 'natural 0 x3',
        actual: roots.map((root) => root.relation),
        pass: roots.every((root) => root.pass),
        baseline: 'pass',
      });
      ctx.check('caller-eof-prompt', {
        kind: 'control',
        text: 'caller stdout/stderr reach EOF within 1500 ms of the cold launcher exit (gateway holds only NUL stdio)',
        expected: '<= 1500',
        actual: cold.callerEofAfterExitMs,
        pass: cold.callerEofAfterExitMs !== null && cold.callerEofAfterExitMs <= 1500,
        baseline: 'pass',
      });
    },
  },
  identityCase({
    id: 'delayed-success',
    title: 'Slow successful work: valid identity after 3 s',
    category: 'positive-control',
    planRow: 'Clean quick completion, ordinary delayed exit (slow successful work witness)',
    identity: { stdout: 'identity', delayMs: 3000 },
    checks(ctx, invocation) {
      ctx.check('identity-accepted', { kind: 'control', text: 'identity accepted (next stage refuses the plain-health marker listener)', expected: 'foreign-listener', actual: invocation.code, pass: accepted(invocation), baseline: 'pass' });
      const root = rootNatural(ctx, 'identity-1', invocation, 0);
      ctx.check('root-natural-zero', { kind: 'control', text: 'helper root exits naturally with 0', expected: 'natural 0', actual: root.relation, pass: root.pass, baseline: 'pass' });
      ctx.check('elapsed-reflects-slow-work', { kind: 'control', text: 'launcher waited for slow valid work and stayed inside the 15 s budget', expected: '3000..15000 ms', actual: invocation.osElapsedMs, pass: invocation.osElapsedMs >= 3000 && invocation.osElapsedMs < 15_000, baseline: 'pass' });
    },
  }),
  identityCase({
    id: 'stderr-flood-success',
    title: 'Flood: 1 MiB stderr then a valid identity and natural exit 0',
    category: 'regression',
    planRow: 'Blocking/full pipes: a large stderr flood that completes in time succeeds',
    identity: { stdout: 'identity', stderrFloodBytes: 1 << 20 },
    checks(ctx, invocation) {
      ctx.check('identity-accepted', { kind: 'requirement', text: 'valid result after a large stderr flood is accepted', expected: 'foreign-listener', actual: invocation.code, pass: accepted(invocation), baseline: 'fail' });
      const root = rootNatural(ctx, 'identity-1', invocation, 0);
      ctx.check('root-natural-zero', { kind: 'requirement', text: 'flooding helper root completes and exits naturally with 0', expected: 'natural 0', actual: root.relation, pass: root.pass, baseline: 'fail' });
      ctx.check('within-work-budget', { kind: 'requirement', text: 'flooding helper completes well inside the 15 s work budget', expected: '< 15000 ms', actual: invocation.osElapsedMs, pass: invocation.osElapsedMs < 15_000, baseline: 'fail' });
      privacyControl(ctx);
    },
  }),
  identityCase({
    id: 'eof-short-child',
    title: 'Both EOF: root exits at once, a short detached child holds stdout+stderr for 2 s',
    category: 'positive-control',
    planRow: 'Ordinary delayed console/child exit; both EOF',
    identity: { stdout: 'identity', members: [{ role: 'short-both', stdio: 'both', lifetimeMs: 2000 }] },
    checks(ctx, invocation) {
      ctx.check('identity-accepted', { kind: 'control', text: 'identity accepted after both pipes reach EOF', expected: 'foreign-listener', actual: invocation.code, pass: accepted(invocation), baseline: 'pass' });
      const relation = ctx.relation(ctx.process('short-both'), invocation, 'afterGrace');
      ctx.check('short-child-natural-before-exit', { kind: 'control', text: 'short pipe-holding child exits naturally (41) before the launcher exits', expected: { classification: 'natural', exitCode: 41, exitedBeforeLauncherExit: true }, actual: relation, pass: relation.classification === 'natural' && relation.exitCode === 41 && relation.exitedBeforeLauncherExit, baseline: 'pass' });
      const root = rootNatural(ctx, 'identity-1', invocation, 0);
      ctx.check('root-natural-zero', { kind: 'control', text: 'helper root exits naturally with 0', expected: 'natural 0', actual: root.relation, pass: root.pass, baseline: 'pass' });
    },
  }),
  identityCase({
    id: 'no-pipe-short-child',
    title: 'Quiescence: root exits at once, a short detached child with no launcher pipe lives 2 s',
    category: 'regression',
    planRow: 'Wait for normal short-lived members to quiesce',
    identity: { stdout: 'identity', members: [{ role: 'short-none', stdio: 'none', lifetimeMs: 2000 }] },
    checks(ctx, invocation) {
      ctx.check('identity-accepted', { kind: 'control', text: 'identity accepted', expected: 'foreign-listener', actual: invocation.code, pass: accepted(invocation), baseline: 'pass' });
      const relation = ctx.relation(ctx.process('short-none'), invocation, 'afterGrace');
      ctx.check('short-child-quiesced-before-exit', { kind: 'requirement', text: 'launcher waits for the short no-pipe member to quiesce naturally before success', expected: { classification: 'natural', exitedBeforeLauncherExit: true }, actual: relation, pass: relation.classification === 'natural' && relation.exitedBeforeLauncherExit, baseline: 'fail' });
      ctx.check('short-child-natural', { kind: 'control', text: 'short no-pipe member exits naturally (41) within the grace window', expected: 41, actual: relation.exitCode, pass: relation.classification === 'natural' && relation.exitCode === 41, baseline: 'pass' });
    },
  }),
  identityCase({
    id: 'deadline-running-root',
    title: 'Helper deadline: running root, real PowerShell query with nested child, detached stdout holder',
    category: 'regression',
    planRow: 'Running Node, real PowerShell query fixture and nested child',
    marker: false,
    identity: {
      hang: true,
      maxLifeMs: 90_000,
      members: [{ role: 'held-stdout', stdio: 'stdout', lifetimeMs: 60_000 }],
      psQuery: { role: 'ps-query', lifetimeMs: 60_000, nested: { role: 'ps-nested', lifetimeMs: 60_000 } },
    },
    checks(ctx, invocation) {
      ctx.check('helper-timeout', { kind: 'requirement', text: 'identity stage refuses with helper-timeout', expected: 'helper-timeout', actual: invocation.code, pass: invocation.code === 'helper-timeout', baseline: 'pass' });
      ctx.check('first-check-bound', { kind: 'requirement', text: `launcher returns within ${FIRST_CHECK_BOUND_MS} ms (15 s work + 2 s cleanup + slack)`, expected: `<= ${FIRST_CHECK_BOUND_MS}`, actual: invocation.osElapsedMs, pass: invocation.osElapsedMs <= FIRST_CHECK_BOUND_MS, baseline: 'pass' });
      memberTerminated(ctx, invocation, 'identity-1', 'pass');
      memberTerminated(ctx, invocation, 'ps-query', 'pass', 'ps-query (non-detached PowerShell child of the root) is terminated before the launcher exits; on baseline the predicted mechanism is the root Node\'s own libuv kill-on-close job, not launcher collection');
      memberTerminated(ctx, invocation, 'ps-nested', 'fail');
      memberTerminated(ctx, invocation, 'held-stdout', 'fail');
      callerEof(ctx, invocation, 'fail');
      const query = ctx.process('ps-query')?.messages.find((message) => message.event === 'query-done');
      ctx.check('real-query-ran', { kind: 'control', text: 'the PowerShell fixture completed one real WMI query of the sentinel before stalling', expected: true, actual: query ?? null, pass: query?.queried === true, baseline: 'pass' });
      sentinelControl(ctx);
    },
  }),
  identityCase({
    id: 'held-stdout-root-exits',
    title: 'Held pipe: root exits at once with a valid identity, detached child holds stdout for 25 s',
    category: 'regression',
    planRow: 'Immediate Node exit and a member holding stdout only',
    identity: { stdout: 'identity', members: [{ role: 'held-stdout', stdio: 'stdout', lifetimeMs: 25_000 }] },
    checks(ctx, invocation) {
      ctx.check('first-check-bound', { kind: 'requirement', text: `launcher returns within ${FIRST_CHECK_BOUND_MS} ms despite the held stdout`, expected: `<= ${FIRST_CHECK_BOUND_MS}`, actual: invocation.osElapsedMs, pass: invocation.osElapsedMs <= FIRST_CHECK_BOUND_MS, baseline: 'fail' });
      ctx.check('helper-timeout', { kind: 'requirement', text: 'missing stdout EOF refuses with helper-timeout', expected: 'helper-timeout', actual: invocation.code, pass: invocation.code === 'helper-timeout', baseline: 'fail' });
      memberTerminated(ctx, invocation, 'held-stdout', 'fail');
      callerEof(ctx, invocation, 'pass');
      const root = rootNatural(ctx, 'identity-1', invocation, 0);
      ctx.check('root-keeps-natural-exit', { kind: 'control', text: 'immediately exited root retains its own natural exit code 0', expected: 'natural 0', actual: root.relation, pass: root.pass, baseline: 'pass' });
      sentinelControl(ctx);
    },
  }),
  identityCase({
    id: 'held-stderr-root-exits',
    title: 'Held pipe: root exits at once with a valid identity, detached child holds stderr for 40 s',
    category: 'regression',
    planRow: 'Immediate Node exit and a member holding stderr only',
    identity: { stdout: 'identity', members: [{ role: 'held-stderr', stdio: 'stderr', lifetimeMs: 40_000 }] },
    checks(ctx, invocation) {
      ctx.check('helper-timeout', { kind: 'requirement', text: 'missing stderr EOF refuses with helper-timeout', expected: 'helper-timeout', actual: invocation.code, pass: invocation.code === 'helper-timeout', baseline: 'fail' });
      memberTerminated(ctx, invocation, 'held-stderr', 'fail');
      callerEof(ctx, invocation, 'fail');
      ctx.check('first-check-bound', { kind: 'requirement', text: `launcher returns within ${FIRST_CHECK_BOUND_MS} ms`, expected: `<= ${FIRST_CHECK_BOUND_MS}`, actual: invocation.osElapsedMs, pass: invocation.osElapsedMs <= FIRST_CHECK_BOUND_MS, baseline: 'pass' });
      const root = rootNatural(ctx, 'identity-1', invocation, 0);
      ctx.check('root-keeps-natural-exit', { kind: 'control', text: 'immediately exited root retains its own natural exit code 0', expected: 'natural 0', actual: root.relation, pass: root.pass, baseline: 'pass' });
      sentinelControl(ctx);
    },
  }),
  identityCase({
    id: 'no-pipe-root-exits',
    title: 'No-pipe descendant: root exits at once with a valid identity, detached child without launcher pipes lives 40 s',
    category: 'regression',
    planRow: 'Immediate Node exit and a member holding neither pipe',
    identity: { stdout: 'identity', members: [{ role: 'held-none', stdio: 'none', lifetimeMs: 40_000 }] },
    checks(ctx, invocation) {
      ctx.check('helper-timeout', { kind: 'requirement', text: 'a member that never quiesces refuses with helper-timeout', expected: 'helper-timeout', actual: invocation.code, pass: invocation.code === 'helper-timeout', baseline: 'fail' });
      memberTerminated(ctx, invocation, 'held-none', 'fail');
      callerEof(ctx, invocation, 'fail');
      ctx.check('first-check-bound', { kind: 'requirement', text: `launcher returns within ${FIRST_CHECK_BOUND_MS} ms`, expected: `<= ${FIRST_CHECK_BOUND_MS}`, actual: invocation.osElapsedMs, pass: invocation.osElapsedMs <= FIRST_CHECK_BOUND_MS, baseline: 'pass' });
      const root = rootNatural(ctx, 'identity-1', invocation, 0);
      ctx.check('root-keeps-natural-exit', { kind: 'control', text: 'immediately exited root retains its own natural exit code 0', expected: 'natural 0', actual: root.relation, pass: root.pass, baseline: 'pass' });
      sentinelControl(ctx);
    },
  }),
  identityCase({
    id: 'privacy-refused',
    title: 'Stderr sentinel privacy with a nonzero helper exit',
    category: 'positive-control',
    planRow: 'Nonzero exit; synthetic privacy sentinels on stderr, bounded log and typed evidence',
    marker: false,
    identity: { stdout: 'none', stderrSentinel: true, exitCode: 1 },
    checks(ctx, invocation) {
      ctx.check('helper-refused', { kind: 'control', text: 'nonzero helper exit refuses with helper-refused', expected: 'helper-refused', actual: invocation.code, pass: invocation.code === 'helper-refused', baseline: 'pass' });
      privacyControl(ctx);
      const root = rootNatural(ctx, 'identity-1', invocation, 1);
      ctx.check('root-natural-one', { kind: 'control', text: 'helper root exits naturally with its own code 1', expected: 'natural 1', actual: root.relation, pass: root.pass, baseline: 'pass' });
      noSpawn(ctx);
    },
  }),
  identityCase({
    id: 'privacy-success',
    title: 'Stderr sentinel privacy with a valid identity',
    category: 'positive-control',
    planRow: 'Synthetic privacy sentinels on stderr with a successful helper',
    identity: { stdout: 'identity', stderrSentinel: true },
    checks(ctx, invocation) {
      ctx.check('identity-accepted', { kind: 'control', text: 'identity accepted despite stderr text', expected: 'foreign-listener', actual: invocation.code, pass: accepted(invocation), baseline: 'pass' });
      privacyControl(ctx);
    },
  }),
  identityCase({
    id: 'malformed-stdout',
    title: 'Malformed stdout with exit 0',
    category: 'outcome-taxonomy',
    planRow: 'Invalid protocol returns helper-invalid',
    marker: false,
    identity: { stdout: 'malformed' },
    checks(ctx, invocation) {
      ctx.check('helper-invalid', { kind: 'requirement', text: 'malformed protocol refuses with helper-invalid (reviewed plan taxonomy)', expected: 'helper-invalid', actual: invocation.code, pass: invocation.code === 'helper-invalid', baseline: 'fail' });
      ctx.check('refused', { kind: 'control', text: 'malformed protocol is refused (exit 1)', expected: 1, actual: invocation.exitCode, pass: invocation.exitCode === 1, baseline: 'pass' });
      noSpawn(ctx);
    },
  }),
  identityCase({
    id: 'invalid-utf8-stdout',
    title: 'Invalid UTF-8 stdout with exit 0',
    category: 'outcome-taxonomy',
    planRow: 'Invalid UTF-8 returns helper-invalid',
    marker: false,
    identity: { stdout: 'invalid-utf8' },
    checks(ctx, invocation) {
      ctx.check('helper-invalid', { kind: 'requirement', text: 'invalid UTF-8 refuses with helper-invalid (reviewed plan taxonomy)', expected: 'helper-invalid', actual: invocation.code, pass: invocation.code === 'helper-invalid', baseline: 'fail' });
      ctx.check('refused', { kind: 'control', text: 'invalid UTF-8 is refused (exit 1)', expected: 1, actual: invocation.exitCode, pass: invocation.exitCode === 1, baseline: 'pass' });
      noSpawn(ctx);
    },
  }),
  {
    id: 'creation-failure',
    title: 'Creation failure: configured Node path is an existing non-executable file',
    lane: 'fixture',
    category: 'positive-control',
    planRow: 'helper-unavailable covers a distinct known runtime-start failure',
    async run(ctx) {
      await ctx.prepare({ node: ctx.notNode, scenario: { identity: { stdout: 'identity' } } });
      const invocation = await ctx.launch('click');
      await ctx.sleep(500);
      await ctx.snapshot('afterGrace');
      ctx.check('helper-unavailable', { kind: 'control', text: 'runtime start failure refuses with helper-unavailable', expected: 'helper-unavailable', actual: invocation.code, pass: invocation.code === 'helper-unavailable', baseline: 'pass' });
      ctx.check('prompt-refusal', { kind: 'control', text: 'refusal is prompt (< 5000 ms)', expected: '< 5000', actual: invocation.osElapsedMs, pass: invocation.osElapsedMs < 5000, baseline: 'pass' });
      const helpers = ctx.processes('identity-').length;
      ctx.check('no-helper-started', { kind: 'control', text: 'no helper process ran', expected: 0, actual: helpers, pass: helpers === 0, baseline: 'pass' });
      noSpawn(ctx);
    },
  },
  {
    id: 'held-store-recheck-stalls',
    title: 'Held store, enough room for a recheck that stalls inside a PowerShell query (9 s release wait)',
    lane: 'fixture',
    category: 'regression',
    planRow: 'Held store with enough room for a shortened final recheck that stalls inside a query',
    async run(ctx) {
      // 9 s leaves room for the recheck even when Node startup makes the first sample ~2.5 s.
      const releaseMs = 9000;
      await ctx.prepare({
        timeoutSeconds: releaseMs / 1000,
        scenario: {
          identity: { stdout: 'identity' },
          storeState: [{ stdout: 'held' }, { stdout: 'held', psQuery: { role: 'ps-query', lifetimeMs: 60_000, await: true } }],
          storeStateDefault: { stdout: 'held' },
        },
      });
      const lock = lockFixture(ctx);
      const invocation = await ctx.launch('click');
      await ctx.sleep(ctx.grace);
      await ctx.snapshot('afterGrace');
      const first = ctx.process('store-state-1')?.opened.createdAtMs ?? null;
      const bound = first === null ? null : first + releaseMs + SLACK_MS;
      const firstSampleMs = (() => {
        const record = ctx.process('store-state-1');
        const state = record?.samples.afterGrace;
        return state && !state.alive ? state.exitedAtMs - record.opened.createdAtMs : null;
      })();
      ctx.check('recheck-had-room', { kind: 'info', text: 'first sample duration left room for a recheck (window = remaining - 2 s reserve >= sample)', expected: null, actual: { firstSampleMs, releaseMs }, pass: true, baseline: 'observe' });
      ctx.check('store-held-retained', { kind: 'requirement', text: 'an inconclusive stalled recheck keeps the last held reason (store-held)', expected: 'store-held', actual: invocation.code, pass: invocation.code === 'store-held', baseline: 'fail' });
      ctx.check('release-wait-bound', { kind: 'requirement', text: 'launcher exits within the 9 s release wait measured from the first ownership sample (+ slack)', expected: bound === null ? null : `exit <= first sample + ${releaseMs + SLACK_MS} ms`, actual: { launcherExitAfterFirstSampleMs: first === null ? null : invocation.osExitedAtMs - first, storeStateCalls: storeCalls(ctx).length }, pass: bound !== null && invocation.osExitedAtMs <= bound, baseline: 'fail' });
      memberTerminated(ctx, invocation, 'store-state-2', 'pass');
      memberTerminated(ctx, invocation, 'ps-query', 'pass', 'stalled PowerShell query is terminated before the launcher exits; on baseline the predicted mechanism is the root Node\'s own libuv kill-on-close job');
      noSpawn(ctx);
      lockUnchanged(ctx, lock);
      sentinelControl(ctx);
    },
  },
  {
    id: 'held-store-too-little-time',
    title: 'Held store, each ownership sample takes 4 s (6 s release wait): no room for a recheck',
    lane: 'fixture',
    category: 'regression',
    planRow: 'Held store with too little time to start a recheck',
    async run(ctx) {
      await ctx.prepare({ timeoutSeconds: 6, scenario: { identity: { stdout: 'identity' }, storeStateDefault: { stdout: 'held', delayMs: 4000 } } });
      const lock = lockFixture(ctx);
      const invocation = await ctx.launch('click');
      await ctx.sleep(ctx.grace);
      await ctx.snapshot('afterGrace');
      const roots = ctx.processes('store-state-');
      const first = roots[0]?.opened.createdAtMs ?? null;
      const starts = roots.map((record) => (first === null ? null : record.opened.createdAtMs - first));
      ctx.check('single-ownership-sample', { kind: 'requirement', text: 'no recheck starts when the window (remaining - 2 s reserve) cannot fit the measured 4 s sample', expected: 1, actual: { storeStateCalls: roots.length, startOffsetsMs: starts }, pass: roots.length === 1, baseline: 'fail' });
      const late = starts.filter((offset) => offset !== null && offset > 6000 - RESERVE_MS);
      ctx.check('no-unbudgeted-final-query', { kind: 'requirement', text: 'no ownership helper starts after the release window minus the 2 s reserve', expected: [], actual: late, pass: late.length === 0, baseline: 'fail' });
      const firstExit = roots[0]?.samples.afterGrace?.exitedAtMs ?? null;
      ctx.check('prompt-after-single-sample', { kind: 'requirement', text: 'launcher exits within 1500 ms after the first (only) ownership sample completes', expected: '<= 1500 ms after first sample exit', actual: { launcherExitAfterFirstSampleExitMs: firstExit === null ? null : invocation.osExitedAtMs - firstExit, firstSampleMs: firstExit === null ? null : firstExit - first }, pass: firstExit !== null && invocation.osExitedAtMs - firstExit <= 1500, baseline: 'fail' });
      ctx.check('store-held', { kind: 'control', text: 'refuses with store-held guidance', expected: 'store-held', actual: invocation.code, pass: invocation.code === 'store-held', baseline: 'pass' });
      noSpawn(ctx);
      lockUnchanged(ctx, lock);
    },
  },
  {
    id: 'held-store-to-free',
    title: 'Held store then a conclusive free sample permits exactly one cold start',
    lane: 'fixture',
    category: 'positive-control',
    planRow: 'Clean held-to-free transition',
    async run(ctx) {
      await ctx.prepare({ timeoutSeconds: 6, scenario: { identity: { stdout: 'identity' }, storeState: [{ stdout: 'held' }], storeStateDefault: { stdout: 'free' } } });
      const lock = lockFixture(ctx);
      const invocation = await ctx.launch('click');
      await ctx.sleep(ctx.grace);
      await ctx.snapshot('afterGrace');
      const outputs = ctx.events().filter((event) => event.event === 'helper-output-written' && event.kind === 'store-state').map((event) => event.stdout);
      ctx.check('exit-zero', { kind: 'control', text: 'launcher exits 0 after the store becomes free', expected: 0, actual: invocation.exitCode, pass: invocation.exitCode === 0, baseline: 'pass' });
      ctx.check('one-gateway-spawn', { kind: 'control', text: 'exactly one gateway spawn', expected: 1, actual: spawnsOf(ctx), pass: spawnsOf(ctx) === 1, baseline: 'pass' });
      ctx.check('held-then-free', { kind: 'control', text: 'first sample held, final sample free', expected: 'held ... free', actual: outputs, pass: outputs[0] === 'held' && outputs.at(-1) === 'free', baseline: 'pass' });
      lockUnchanged(ctx, lock);
    },
  },
  {
    id: 'real-helper-direct-timing',
    title: 'Unmodified built helper invoked directly: identity x3, free store x2, live owner x2',
    lane: 'real',
    category: 'positive-control',
    planRow: 'Real WMI identity: first checks and warm repeats (fresh-process measurement; prior WMI use unknown, not cold)',
    async run(ctx) {
      const prepared = await ctx.prepare({ repo: 'checkout', timeoutSeconds: 3 });
      mkdirSync(prepared.dataDir, { recursive: true });
      const results = [];
      for (let i = 1; i <= 3; i++) results.push(await ctx.runRealHelper(`identity-${i}`, []));
      for (let i = 1; i <= 2; i++) results.push(await ctx.runRealHelper(`store-free-${i}`, ['--store-state']));
      const owner = await ctx.startContender(prepared.dataDir);
      if (owner) for (let i = 1; i <= 2; i++) results.push(await ctx.runRealHelper(`store-held-${i}`, ['--store-state']));
      await ctx.snapshot('afterGrace');
      const of = (prefix) => results.filter((result) => result.name.startsWith(prefix));
      ctx.check('identity-digest', { kind: 'control', text: 'each identity run exits 0 with one lowercase digest line', expected: 'digest x3', actual: of('identity-').map((r) => [r.exitCode, r.result]), pass: of('identity-').length === 3 && of('identity-').every((r) => r.exitCode === 0 && r.result === 'digest'), baseline: 'pass' });
      ctx.check('store-free', { kind: 'control', text: 'an unowned store reports free', expected: 'free x2', actual: of('store-free-').map((r) => [r.exitCode, r.result]), pass: of('store-free-').length === 2 && of('store-free-').every((r) => r.exitCode === 0 && r.result?.state === 'free'), baseline: 'pass' });
      ctx.check('store-held-live-owner', { kind: 'control', text: 'a live owner (real WMI identity match) reports held', expected: 'held x2', actual: of('store-held-').map((r) => [r.exitCode, r.result]), pass: of('store-held-').length === 2 && of('store-held-').every((r) => r.exitCode === 0 && r.result?.state === 'held' && r.result.detailPrefix?.startsWith('another GraphGoblin process holds this store')), baseline: 'pass' });
      ctx.check('real-helper-durations', { kind: 'info', text: 'OS-recorded creation-to-exit durations of the shipped helper (fresh processes; prior WMI/disk cache use unknown)', expected: null, actual: results.map((r) => ({ name: r.name, ms: r.osElapsedMs, settled: r.settled })), pass: true, baseline: 'observe' });
    },
  },
  {
    id: 'real-cold-warm-reuse',
    title: 'Unmodified built API/helper: real gateway cold start, detached lifetime and warm reuse',
    lane: 'real',
    category: 'positive-control',
    planRow: 'Independent gateway: cold-starts, stays healthy after launcher exit/caller EOF, same PID on warm reuse',
    async run(ctx) {
      await ctx.prepare({ repo: 'checkout', timeoutSeconds: 60 });
      const cold = await ctx.launch('cold', { watchdogMs: 120_000 });
      const gateway = cold.exitCode === 0 ? await ctx.openGateway('real-gateway') : null;
      const warm = await ctx.launch('warm', { watchdogMs: 60_000 });
      const warmHealth = await ctx.health();
      await ctx.sleep(ctx.grace);
      await ctx.snapshot('afterGrace');
      ctx.check('cold-exit-zero', { kind: 'control', text: 'cold click exits 0', expected: 0, actual: cold.exitCode, pass: cold.exitCode === 0, baseline: 'pass' });
      ctx.check('gateway-exact-handle', { kind: 'control', text: 'gateway PID from health is witnessed by an exact live handle', expected: true, actual: gateway ? { verified: gateway.verified, image: gateway.opened.image, parentIsColdLauncher: gateway.opened.parentPid === cold.pid, inAnyJob: gateway.opened.inAnyJob } : null, pass: gateway?.verified === true, baseline: 'pass' });
      const reuse = { warmExit: warm.exitCode, samePid: gateway !== null && String(gateway.pid) === warmHealth.pid, aliveAfterWarm: gateway?.samples['atExit:warm']?.alive ?? null, aliveAfterGrace: gateway?.samples.afterGrace?.alive ?? null };
      ctx.check('warm-reuse-same-pid', { kind: 'control', text: 'warm click exits 0 and the same gateway process stays alive after both launchers exit', expected: { warmExit: 0, samePid: true, aliveAfterWarm: true, aliveAfterGrace: true }, actual: reuse, pass: reuse.warmExit === 0 && reuse.samePid && reuse.aliveAfterWarm === true && reuse.aliveAfterGrace === true, baseline: 'pass' });
      ctx.check('caller-eof-prompt', { kind: 'control', text: 'caller pipes reach EOF within 1500 ms of the cold launcher exit', expected: '<= 1500', actual: cold.callerEofAfterExitMs, pass: cold.callerEofAfterExitMs !== null && cold.callerEofAfterExitMs <= 1500, baseline: 'pass' });
      ctx.check('real-timings', { kind: 'info', text: 'real helper + gateway timings (WMI prior use unknown; not a cold measurement)', expected: null, actual: { coldMs: cold.osElapsedMs, warmMs: warm.osElapsedMs }, pass: true, baseline: 'observe' });
    },
  },
  {
    id: 'real-held-store',
    title: 'Unmodified built API/helper with real WMI: a live owner holds the store',
    lane: 'real',
    category: 'positive-control',
    planRow: 'Real WMI identity and refusal (matching live owner); bounded collection, no second spawn',
    async run(ctx) {
      const prepared = await ctx.prepare({ repo: 'checkout', timeoutSeconds: 3 });
      mkdirSync(prepared.dataDir, { recursive: true });
      const contender = await ctx.startContender(prepared.dataDir);
      if (!contender) return;
      const lockPath = join(prepared.dataDir, 'graphgoblin.lock');
      const lock = { path: lockPath, before: ctx.lockSnapshot(lockPath) };
      const invocation = await ctx.launch('click', { watchdogMs: 90_000 });
      await ctx.sleep(ctx.grace);
      await ctx.snapshot('afterGrace');
      ctx.check('store-held', { kind: 'control', text: 'real helper refuses with store-held for a live matching owner', expected: 'store-held', actual: invocation.code, pass: invocation.code === 'store-held', baseline: 'pass' });
      lockUnchanged(ctx, lock);
      const gatewayLog = ctx.lockSnapshot(join(ctx.dir, 'gateway.log'));
      ctx.check('no-gateway-spawn', { kind: 'control', text: 'no gateway was started (no gateway.log created)', expected: false, actual: gatewayLog.exists, pass: !gatewayLog.exists, baseline: 'pass' });
      const owner = ctx.process('contender');
      ctx.check('owner-alive', { kind: 'control', text: 'the live owner process is untouched', expected: true, actual: owner?.samples.afterGrace?.alive ?? null, pass: owner?.samples.afterGrace?.alive === true, baseline: 'pass' });
      ctx.check('real-timings', { kind: 'info', text: 'real WMI refusal timing (prior WMI use unknown)', expected: null, actual: { elapsedMs: invocation.osElapsedMs, timeoutSeconds: 3 }, pass: true, baseline: 'observe' });
    },
  },
];
