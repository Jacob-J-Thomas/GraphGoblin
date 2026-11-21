// GraphGoblin #459 independent native QA, extension qa459-ext/1: remaining ADR-0086 native acceptance.
//
// Same conventions as qa459-cases.mjs: `requirement` = reviewed #459 / ADR-0086 semantics,
// `control` = must hold on baseline and candidate, `info` = recorded observation only; `baseline`
// states the expectation on unmodified main (pass | fail | observe).
//
// Harness jobs are disposable jobs the extended witness creates and holds open until teardown.
// A launcher placed in one is created suspended with NUL stdin and two private capture pipes,
// assigned to the job, then resumed. Creator death terminates the exact launcher handle with
// CREATOR_KILL_CODE at an acknowledged boundary while the harness job stays open, so descendant
// completion before harness teardown can only come from the launcher's own private job. An
// OS-assigned kill-on-close code is expected there; the 0xE0470459 assertion applies only where
// the launcher itself terminates its job (deadline, invalid output).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const WORK_MS = 15_000;
const CLEANUP_MS = 2_000;
const SLACK_MS = 1_500;
const FIRST_CHECK_BOUND_MS = WORK_MS + CLEANUP_MS + SLACK_MS;
const EXIT_SLACK_MS = 32;
const CAP = 262_144;
const ALL_UI = 0xff;

const accepted = (invocation) => invocation.code === 'foreign-listener';
const spawnsOf = (ctx) => ctx.events().filter((event) => event.event === 'gateway-start').length;
const helperStarts = (ctx, kind) => ctx.events().filter((event) => event.event === 'helper-start' && (!kind || event.kind === kind)).length;

function rootNatural(ctx, role, invocation, code, sample = 'afterGrace') {
  const relation = ctx.relation(ctx.process(role), invocation, sample);
  return { relation, pass: relation.classification === 'natural' && relation.exitCode === code && relation.exitedBeforeLauncherExit };
}

function memberTerminated(ctx, invocation, role, baseline, text) {
  const result = ctx.terminatedByLauncher(ctx.process(role), invocation, 'afterGrace');
  ctx.check(`${role}-terminated-by-launcher`, {
    kind: 'requirement',
    text: text ?? `${role} is terminated by the launcher's job before the launcher exits${ctx.jobExitCode === null ? '' : ` with ${ctx.jobExitCode}`}`,
    expected: { exitedBeforeLauncherExit: true, classification: 'terminated-*', exitCode: ctx.jobExitCode ?? 'non-natural' },
    actual: result.relation,
    pass: result.pass,
    baseline,
  });
}

/** Creator death: the process ended within the cleanup allowance after the launcher died, with a non-natural, non-driver code. */
function diedWithCreator(ctx, invocation, role, baseline) {
  const record = ctx.process(role);
  const relation = ctx.relation(record, invocation, 'afterCleanup');
  const delta = relation.exitedRelativeToLauncherExitMs;
  const pass = relation.alive === false && relation.classification === 'terminated-other' && delta !== null &&
    delta >= -EXIT_SLACK_MS && delta <= CLEANUP_MS;
  ctx.check(`${role}-ended-with-creator`, {
    kind: 'requirement',
    text: `${role} ends within ${CLEANUP_MS} ms after the launcher is killed, while the harness job is still open (private job kill-on-close, not harness teardown); exit code is OS-assigned and recorded`,
    expected: { alive: false, classification: 'terminated-other', exitedRelativeToLauncherExitMs: `0..${CLEANUP_MS}` },
    actual: relation,
    pass,
    baseline,
  });
  return relation;
}

function sentinelControl(ctx) {
  ctx.check('sentinel-alive', {
    kind: 'control',
    text: 'same-executable run sentinel outside every launcher and job remains alive',
    expected: true,
    actual: ctx.sentinelAlive(),
    pass: ctx.sentinelAlive(),
    baseline: 'pass',
  });
}

function siblingControl(ctx, sample = 'afterGrace') {
  const sibling = ctx.process('job-sibling');
  const state = sibling?.samples?.[sample];
  ctx.check('job-sibling-alive', {
    kind: 'control',
    text: 'an unrelated same-executable member of the same enclosing job remains alive after the launcher exits',
    expected: true,
    actual: state ?? null,
    pass: state?.alive === true,
    baseline: 'pass',
  });
}

function noSpawn(ctx) {
  const spawns = spawnsOf(ctx);
  ctx.check('no-gateway-spawn', { kind: 'control', text: 'no gateway process is spawned', expected: 0, actual: spawns, pass: spawns === 0, baseline: 'pass' });
}

function callerEof(ctx, invocation, baseline, kind = 'requirement') {
  ctx.check('caller-eof-at-launcher-exit', {
    kind,
    text: 'the caller\'s launcher stdout/stderr reach EOF within 1500 ms of launcher exit',
    expected: '<= 1500',
    actual: { afterExitMs: invocation.callerEofAfterExitMs, afterDriverTeardown: invocation.callerEofAfterTeardown ?? 'pending' },
    pass: invocation.callerEofAfterExitMs !== null && invocation.callerEofAfterExitMs <= 1500,
    baseline,
  });
}

/** Accounting of the open harness job with observer handles retained, then after they close. */
async function accountingWithObservers(ctx, job, baseline, label) {
  const retained = await ctx.jobAccounting(job, `${label}:observers-retained`);
  const closed = await ctx.closeExitedObservers();
  const after = await ctx.jobAccounting(job, `${label}:observers-closed`);
  const actual = {
    observersRetained: { active: retained.activeProcesses ?? null, total: retained.totalProcesses ?? null, activePids: retained.activePids ?? null },
    observersClosed: { active: after.activeProcesses ?? null, total: after.totalProcesses ?? null, activePids: after.activePids ?? null, closedRoles: closed },
    harnessJobOpen: job.open,
  };
  return { retained, after, actual };
}

function lockFixture(ctx) {
  mkdirSync(ctx.prepared.dataDir, { recursive: true });
  const path = join(ctx.prepared.dataDir, 'graphgoblin.lock');
  writeFileSync(path, JSON.stringify({ pid: 4, windowsCreationTime: '134000000000000000', token: 'qa459-synthetic-owner' }));
  return { path, before: ctx.lockSnapshot(path) };
}

function probeInfo(ctx, probe) {
  ctx.check('in-job-probe', {
    kind: 'info',
    text: 'in-job probe: own job UI restrictions read from inside, nested CreateProcess(JOB_LIST) and AssignProcessToJobObject outcomes',
    expected: null,
    actual: probe,
    pass: true,
    baseline: 'observe',
  });
}

const EXT_DEADLINE_SCENARIO = {
  hang: true,
  maxLifeMs: 90_000,
  members: [
    { role: 'held-stdout', stdio: 'stdout', lifetimeMs: 60_000 },
    { role: 'held-none', stdio: 'none', lifetimeMs: 60_000 },
  ],
  psQuery: { role: 'ps-query', lifetimeMs: 60_000, nested: { role: 'ps-nested', lifetimeMs: 60_000 } },
};
const DEADLINE_TREE = ['identity-1', 'ps-query', 'ps-nested', 'held-stdout', 'held-none'];

export const EXT_CASES = [
  {
    id: 'ext-compatible-job-success',
    title: 'Compatible enclosing job (kill-on-close, no breakaway, no UI limits): nested helper, short members quiesce, accounting with observers',
    lane: 'fixture',
    category: 'enclosing-job',
    planRow: 'Compatible enclosing jobs; ordinary short members quiesce; job accounting with observer handles retained and closed',
    async run(ctx) {
      await ctx.prepare({ marker: true, scenario: { identity: { stdout: 'identity', members: [{ role: 'short-both', stdio: 'both', lifetimeMs: 2000 }, { role: 'short-none', stdio: 'none', lifetimeMs: 2000 }] } } });
      const job = await ctx.harnessJob('harness', { limitFlags: ctx.killOnClose });
      const probe = await ctx.nestProbe(job);
      if (!probe.nestingSupported) ctx.fault('harness-job-not-compatible', probe);
      const invocation = await ctx.launchJob('click', job);
      await ctx.sleep(ctx.grace);
      await ctx.snapshot('afterGrace');
      const root = ctx.process('identity-1');
      const membership = {
        launcherInHarness: invocation.ext.host.inHarnessJob,
        launcherInAnyJobBeforeAssignment: invocation.ext.host.preAssignInAnyJob,
        rootInHarness: await ctx.inJob(root, job),
        shortBothInHarness: await ctx.inJob(ctx.process('short-both'), job),
        shortNoneInHarness: await ctx.inJob(ctx.process('short-none'), job),
      };
      const accounting = await accountingWithObservers(ctx, job, 'pass', 'afterGrace');
      probeInfo(ctx, probe);
      ctx.check('identity-accepted', { kind: 'requirement', text: 'identity accepted inside a compatible enclosing job (next stage refuses the plain-health marker)', expected: 'foreign-listener', actual: invocation.code, pass: accepted(invocation), baseline: 'pass' });
      ctx.check('helper-nested-in-enclosing-job', { kind: 'requirement', text: 'the launcher ran inside the harness job and its helper root and members are members of that job (private job nested under it)', expected: { launcherInHarness: true, launcherInAnyJobBeforeAssignment: false, rootInHarness: true, shortBothInHarness: true, shortNoneInHarness: true }, actual: membership, pass: membership.launcherInHarness === true && membership.launcherInAnyJobBeforeAssignment === false && membership.rootInHarness === true && membership.shortBothInHarness === true && membership.shortNoneInHarness === true, baseline: 'pass' });
      const rootResult = rootNatural(ctx, 'identity-1', invocation, 0);
      ctx.check('root-natural-zero', { kind: 'requirement', text: 'helper root exits naturally with 0 before the launcher exits', expected: 'natural 0', actual: rootResult.relation, pass: rootResult.pass, baseline: 'pass' });
      for (const role of ['short-both', 'short-none']) {
        const relation = ctx.relation(ctx.process(role), invocation, 'afterGrace');
        ctx.check(`${role}-quiesced-before-exit`, { kind: 'requirement', text: `${role} exits naturally (41) before the launcher accepts`, expected: { classification: 'natural', exitCode: 41, exitedBeforeLauncherExit: true }, actual: relation, pass: relation.classification === 'natural' && relation.exitCode === 41 && relation.exitedBeforeLauncherExit, baseline: role === 'short-none' ? 'fail' : 'pass' });
      }
      ctx.check('accounting-empty-with-and-without-observers', {
        kind: 'requirement',
        text: 'open harness job reports zero active processes after the launcher exits, with witness handles retained and again after they close (observer handles do not keep members active)',
        expected: { observersRetained: { active: 0 }, observersClosed: { active: 0, total: 'unchanged' }, harnessJobOpen: true },
        actual: accounting.actual,
        pass: accounting.retained.activeProcesses === 0 && accounting.after.activeProcesses === 0 && accounting.after.totalProcesses === accounting.retained.totalProcesses && job.open === true,
        baseline: 'pass',
      });
      callerEof(ctx, invocation, 'observe', 'control');
      sentinelControl(ctx);
    },
  },
  {
    id: 'ext-compatible-job-deadline',
    title: 'Compatible enclosing job held open: running root, real PowerShell query with nested child, stdout holder and no-pipe member reach the 15 s deadline',
    lane: 'fixture',
    category: 'enclosing-job',
    planRow: '15 s work budget, 2 s cleanup allowance and 0xE0470459 job termination inside a compatible enclosing job',
    async run(ctx) {
      await ctx.prepare({ marker: false, scenario: { identity: EXT_DEADLINE_SCENARIO } });
      const job = await ctx.harnessJob('harness', { limitFlags: ctx.killOnClose });
      const probe = await ctx.nestProbe(job);
      if (!probe.nestingSupported) ctx.fault('harness-job-not-compatible', probe);
      const invocation = await ctx.launchJob('click', job, { watchdogMs: 45_000 });
      await ctx.sleep(ctx.grace);
      await ctx.snapshot('afterGrace');
      const accounting = await accountingWithObservers(ctx, job, 'fail', 'afterGrace');
      ctx.check('helper-timeout', { kind: 'requirement', text: 'identity stage refuses with helper-timeout', expected: 'helper-timeout', actual: invocation.code, pass: invocation.code === 'helper-timeout', baseline: 'pass' });
      ctx.check('work-window-honoured', { kind: 'requirement', text: `launcher returned after the full 15 s work window and within ${FIRST_CHECK_BOUND_MS} ms`, expected: `${WORK_MS}..${FIRST_CHECK_BOUND_MS}`, actual: invocation.osElapsedMs, pass: invocation.osElapsedMs >= WORK_MS && invocation.osElapsedMs <= FIRST_CHECK_BOUND_MS, baseline: 'pass' });
      for (const role of DEADLINE_TREE) memberTerminated(ctx, invocation, role, role === 'identity-1' || role === 'ps-query' ? 'pass' : 'fail');
      const exits = DEADLINE_TREE.map((role) => ctx.process(role)?.samples?.afterGrace).filter((state) => state && !state.alive && state.exitedAtMs);
      const first = exits.length ? Math.min(...exits.map((state) => state.exitedAtMs)) : null;
      const last = exits.length ? Math.max(...exits.map((state) => state.exitedAtMs)) : null;
      const created = invocation.osCreatedAtMs;
      const cleanup = { terminatedCount: exits.length, firstTerminationAfterLauncherStartMs: first === null ? null : first - created, launcherExitAfterFirstTerminationMs: first === null ? null : invocation.osExitedAtMs - first, terminationSpreadMs: first === null ? null : last - first };
      ctx.check('cleanup-within-allowance', { kind: 'requirement', text: `all ${DEADLINE_TREE.length} helper-tree processes end after the work window and the launcher exits within the ${CLEANUP_MS} ms cleanup allowance of the first termination`, expected: { terminatedCount: DEADLINE_TREE.length, firstTerminationAfterLauncherStartMs: `>= ${WORK_MS}`, launcherExitAfterFirstTerminationMs: `<= ${CLEANUP_MS}` }, actual: cleanup, pass: exits.length === DEADLINE_TREE.length && cleanup.firstTerminationAfterLauncherStartMs >= WORK_MS && cleanup.launcherExitAfterFirstTerminationMs <= CLEANUP_MS, baseline: 'fail' });
      ctx.check('accounting-empty-harness-open', { kind: 'requirement', text: 'open harness job reports zero active processes after collection, with observer handles retained and after they close', expected: { observersRetained: { active: 0 }, observersClosed: { active: 0 }, harnessJobOpen: true }, actual: accounting.actual, pass: accounting.retained.activeProcesses === 0 && accounting.after.activeProcesses === 0 && job.open === true, baseline: 'fail' });
      callerEof(ctx, invocation, 'fail');
      const query = ctx.process('ps-query')?.messages.find((message) => message.event === 'query-done');
      ctx.check('real-query-ran', { kind: 'control', text: 'the PowerShell fixture completed one real WMI query of the sentinel before stalling', expected: true, actual: query ?? null, pass: query?.queried === true, baseline: 'pass' });
      probeInfo(ctx, probe);
      sentinelControl(ctx);
    },
  },
  {
    id: 'ext-creator-death-helper-ready',
    title: 'Creator death at helper-ready: running root with real PowerShell query, nested child, stdout holder and no-pipe member; exact launcher handle terminated; harness job held open',
    lane: 'fixture',
    category: 'creator-death',
    planRow: 'Creator death at an acknowledged point (helper and descendants ready)',
    async run(ctx) {
      await ctx.prepare({ marker: false, scenario: { identity: EXT_DEADLINE_SCENARIO } });
      const job = await ctx.harnessJob('harness', { limitFlags: ctx.killOnClose });
      const probe = await ctx.nestProbe(job);
      if (!probe.nestingSupported) ctx.fault('harness-job-not-compatible', probe);
      const boundary = {
        name: 'helper-ready',
        async check(context) {
          const ready = context.events().find((event) => event.event === 'helper-members-ready' && event.role === 'identity-1');
          if (!ready) return null;
          const state = await context.stateOf(context.process('identity-1'));
          return state.alive === true ? { rootAlive: true, membersReadyAt: ready.at } : null;
        },
      };
      const invocation = await ctx.launchJob('click', job, { watchdogMs: 45_000, boundary });
      await ctx.sleep(Math.max(0, invocation.osExitedAtMs + CLEANUP_MS - Date.now()));
      await ctx.snapshot('afterCleanup');
      const cleanupAccounting = await ctx.jobAccounting(job, 'afterCleanup');
      await ctx.sleep(ctx.grace);
      await ctx.snapshot('afterGrace');
      const accounting = await accountingWithObservers(ctx, job, 'fail', 'afterGrace');
      ctx.check('boundary-reached-launcher-killed', { kind: 'requirement', text: 'the helper-ready boundary was reached while the launcher was alive and the exact launcher handle was terminated with the creator-kill code', expected: { reached: true, launcherExitCode: ctx.creatorKillCode }, actual: { boundary: invocation.ext.boundary, killed: invocation.ext.killed, launcherExitCode: invocation.exitCode }, pass: invocation.ext.boundary?.reached === true && invocation.ext.killed?.terminateCalled === true && invocation.exitCode === ctx.creatorKillCode, baseline: 'pass' });
      const relations = DEADLINE_TREE.map((role) => diedWithCreator(ctx, invocation, role, 'fail'));
      ctx.check('harness-open-and-empty-after-cleanup', { kind: 'requirement', text: `${CLEANUP_MS} ms after the launcher died the still-open harness job reports zero active processes (completion observed before any harness teardown)`, expected: { active: 0, harnessJobOpen: true }, actual: { cleanup: cleanupAccounting, harnessJobOpen: job.open }, pass: cleanupAccounting.activeProcesses === 0 && job.open === true, baseline: 'fail' });
      ctx.check('accounting-observers', { kind: 'info', text: 'harness accounting after grace with observer handles retained, then closed', expected: null, actual: accounting.actual, pass: true, baseline: 'observe' });
      ctx.check('creator-death-exit-codes', { kind: 'info', text: 'OS-assigned exit codes of the helper tree after creator death (no 0xE0470459 assertion: the launcher never called TerminateJobObject)', expected: null, actual: relations.map((relation) => ({ role: relation.role, exitCode: relation.exitCode, deltaMs: relation.exitedRelativeToLauncherExitMs })), pass: true, baseline: 'observe' });
      callerEof(ctx, invocation, 'fail');
      probeInfo(ctx, probe);
      sentinelControl(ctx);
    },
  },
  {
    id: 'ext-creator-death-root-exited',
    title: 'Creator death after the root exited naturally: stdout holder and no-pipe member ready; exact launcher handle terminated; harness job held open',
    lane: 'fixture',
    category: 'creator-death',
    planRow: 'Creator death at an acknowledged point (root exited, descendants ready)',
    async run(ctx) {
      await ctx.prepare({ marker: true, scenario: { identity: { stdout: 'identity', members: [{ role: 'held-stdout', stdio: 'stdout', lifetimeMs: 60_000 }, { role: 'held-none', stdio: 'none', lifetimeMs: 60_000 }] } } });
      const job = await ctx.harnessJob('harness', { limitFlags: ctx.killOnClose });
      const probe = await ctx.nestProbe(job);
      if (!probe.nestingSupported) ctx.fault('harness-job-not-compatible', probe);
      const boundary = {
        name: 'root-exited-descendants-ready',
        async check(context) {
          const exited = context.events().find((event) => event.event === 'helper-exit' && event.role === 'identity-1');
          const ready = ['held-stdout', 'held-none'].every((role) => context.process(role)?.opened.ok);
          if (!exited || !ready) return null;
          const state = await context.stateOf(context.process('identity-1'));
          if (state.alive !== false) return null;
          const members = await Promise.all(['held-stdout', 'held-none'].map((role) => context.stateOf(context.process(role))));
          return members.every((member) => member.alive === true) ? { rootExitCode: state.exitCode, rootExitedAtMs: state.exitedAtMs } : null;
        },
      };
      const invocation = await ctx.launchJob('click', job, { watchdogMs: 45_000, boundary });
      await ctx.sleep(Math.max(0, invocation.osExitedAtMs + CLEANUP_MS - Date.now()));
      await ctx.snapshot('afterCleanup');
      const cleanupAccounting = await ctx.jobAccounting(job, 'afterCleanup');
      await ctx.sleep(ctx.grace);
      await ctx.snapshot('afterGrace');
      const accounting = await accountingWithObservers(ctx, job, 'fail', 'afterGrace');
      ctx.check('boundary-reached-launcher-killed', { kind: 'requirement', text: 'the root-exited boundary was reached while the launcher was alive and the exact launcher handle was terminated with the creator-kill code', expected: { reached: true, launcherExitCode: ctx.creatorKillCode }, actual: { boundary: invocation.ext.boundary, killed: invocation.ext.killed, launcherExitCode: invocation.exitCode }, pass: invocation.ext.boundary?.reached === true && invocation.ext.killed?.terminateCalled === true && invocation.exitCode === ctx.creatorKillCode, baseline: 'pass' });
      const root = rootNatural(ctx, 'identity-1', invocation, 0);
      ctx.check('root-keeps-natural-exit', { kind: 'control', text: 'the root exited naturally with 0 before the launcher was killed', expected: 'natural 0', actual: root.relation, pass: root.pass, baseline: 'pass' });
      for (const role of ['held-stdout', 'held-none']) diedWithCreator(ctx, invocation, role, 'fail');
      ctx.check('harness-open-and-empty-after-cleanup', { kind: 'requirement', text: `${CLEANUP_MS} ms after the launcher died the still-open harness job reports zero active processes`, expected: { active: 0, harnessJobOpen: true }, actual: { cleanup: cleanupAccounting, harnessJobOpen: job.open }, pass: cleanupAccounting.activeProcesses === 0 && job.open === true, baseline: 'fail' });
      ctx.check('accounting-observers', { kind: 'info', text: 'harness accounting after grace with observer handles retained, then closed', expected: null, actual: accounting.actual, pass: true, baseline: 'observe' });
      callerEof(ctx, invocation, 'fail');
      probeInfo(ctx, probe);
      sentinelControl(ctx);
    },
  },
  {
    id: 'ext-ui-restricted-job',
    title: 'Enclosing job with all eight UI restrictions (read back from inside): launcher outcome follows the host\'s verified nesting capability',
    lane: 'fixture',
    category: 'enclosing-job',
    planRow: 'Outer job with a UI restriction (incompatible host refusal only where nesting is actually refused)',
    async run(ctx) {
      await ctx.prepare({ marker: true, scenario: { identity: { stdout: 'identity' } } });
      const job = await ctx.harnessJob('ui-restricted', { limitFlags: ctx.killOnClose, uiFlags: ALL_UI });
      await ctx.spawnInJob(job, 'job-sibling');
      const probe = await ctx.nestProbe(job);
      const invocation = await ctx.launchJob('click', job);
      await ctx.sleep(ctx.grace);
      await ctx.snapshot('afterGrace');
      const rootInHarness = await ctx.inJob(ctx.process('identity-1'), job);
      const accounting = await ctx.jobAccounting(job, 'afterGrace');
      probeInfo(ctx, probe);
      const effective = { readBack: job.readBack?.uiRestrictions ?? null, fromInside: probe.report?.ownJobUiRestrictions ?? null };
      ctx.check('ui-restriction-effective', { kind: 'control', text: 'all UI restrictions are effective: read back on the job and from a process inside it', expected: { readBack: ALL_UI, fromInside: ALL_UI }, actual: effective, pass: effective.readBack === ALL_UI && effective.fromInside === ALL_UI, baseline: 'pass' });
      ctx.check('ui-restriction-prevents-nesting', { kind: 'info', text: 'whether this UI-restricted job actually refuses a nested job (in-job CreateProcess with JOB_LIST); the brief\'s premise', expected: null, actual: { nestingSupported: probe.nestingSupported ?? null, error: probe.report?.jobListCreateProcessError ?? null }, pass: true, baseline: 'observe' });
      const outcome = probe.nestingSupported
        ? { expected: 'foreign-listener (nested helper ran)', pass: accepted(invocation) && rootInHarness === true }
        : { expected: 'helper-containment before any helper', pass: invocation.code === 'helper-containment' && helperStarts(ctx) === 0 };
      ctx.check('outcome-matches-host-capability', { kind: 'requirement', text: 'the launcher refuses only when the enclosing job actually refuses nesting; otherwise its nested helper runs normally', expected: outcome.expected, actual: { code: invocation.code, exitCode: invocation.exitCode, helperStarts: helperStarts(ctx), rootInHarness, nestingSupported: probe.nestingSupported ?? null, accounting }, pass: outcome.pass, baseline: 'pass' });
      siblingControl(ctx);
      sentinelControl(ctx);
    },
  },
  {
    id: 'ext-incompatible-job-cold',
    title: 'Incompatible enclosing job (verified from inside: nested and plain creation refused): cold click refuses with helper-containment before any helper exists',
    lane: 'fixture',
    category: 'enclosing-job',
    planRow: 'Refusal on an incompatible host before the first helper executes; actionable containment diagnostic; unrelated sentinel survival',
    async run(ctx) {
      await ctx.prepare({ marker: true, scenario: { identity: { stdout: 'identity' } } });
      const job = await ctx.harnessJob('incompatible', { limitFlags: ctx.killOnClose });
      await ctx.spawnInJob(job, 'job-sibling');
      await ctx.restrictToOneFreeSlot(job, 1); // the sibling + one free slot
      const probe = await ctx.nestProbe(job);
      const verified = probe.spawned === true && probe.report?.jobListCreateProcess === false;
      if (!verified) ctx.fault('incompatible-job-not-verified', probe);
      const invocation = await ctx.launchJob('click', job);
      await ctx.sleep(ctx.grace);
      await ctx.snapshot('afterGrace');
      const before = invocation.ext.accountingBefore;
      const atExit = invocation.ext.accountingAtExit;
      probeInfo(ctx, probe);
      ctx.check('helper-containment', { kind: 'requirement', text: 'an enclosing job that refuses the helper\'s job-assigned creation refuses with helper-containment (exit 1, launcher.log code)', expected: { code: 'helper-containment', exitCode: 1 }, actual: { code: invocation.code, exitCode: invocation.exitCode }, pass: invocation.code === 'helper-containment' && invocation.exitCode === 1, baseline: 'fail' });
      const added = (atExit.totalProcesses ?? 0) - (before.totalProcesses ?? 0);
      ctx.check('refused-before-first-helper', { kind: 'requirement', text: 'no helper process ever existed: no helper-start event, no helper handshake, and the enclosing job gained exactly one process (the launcher) across the click', expected: { helperStarts: 0, helperHandshakes: 0, processesAddedToJob: 1 }, actual: { helperStarts: helperStarts(ctx), helperHandshakes: ctx.processes('identity-').length, processesAddedToJob: added, before, atExit }, pass: helperStarts(ctx) === 0 && ctx.processes('identity-').length === 0 && added === 1, baseline: 'pass' });
      const stderr = Buffer.concat(invocation.stderrChunks).toString('utf8');
      const guidance = {
        classified: invocation.diagnostic,
        namesIsolation: /Windows could not start an isolated launcher check/.test(stderr),
        namesRuntimeAndJobPolicy: /Verify the configured runtime and the host's job policy/.test(stderr),
        namesRequirement: /Windows 10 or Windows Server 2016 or later with compatible nested jobs is required/.test(stderr),
        noGatewayStarted: /No gateway was started/.test(stderr),
        noExceptionText: !/Exception|\bat [A-Za-z_.]+\(/.test(stderr),
        noSentinel: !stderr.includes(ctx.privacy),
      };
      ctx.check('actionable-containment-diagnostic', { kind: 'requirement', text: 'the closed containment diagnostic names isolation, runtime and host job policy, the Windows/nesting requirement and that no gateway started, without exception text', expected: { classified: 'helper-containment', namesIsolation: true, namesRuntimeAndJobPolicy: true, namesRequirement: true, noGatewayStarted: true, noExceptionText: true, noSentinel: true }, actual: { ...guidance, stderr }, pass: guidance.classified === 'helper-containment' && Object.entries(guidance).every(([key, value]) => key === 'classified' || value === true), baseline: 'fail' });
      ctx.check('prompt-refusal', { kind: 'requirement', text: 'refusal is prompt (< 5000 ms)', expected: '< 5000', actual: invocation.osElapsedMs, pass: invocation.osElapsedMs < 5000, baseline: 'pass' });
      noSpawn(ctx);
      siblingControl(ctx);
      sentinelControl(ctx);
    },
  },
  {
    id: 'ext-incompatible-job-warm-click',
    title: 'Incompatible enclosing job, warm click: a live reusable gateway exists, yet the click refuses with helper-containment; the gateway stays directly callable',
    lane: 'fixture',
    category: 'enclosing-job',
    planRow: 'Every click starts the identity helper before reuse, so an incompatible host refuses even a warm click; an existing gateway remains callable directly',
    async run(ctx) {
      await ctx.prepare({ timeoutSeconds: 10, scenario: { identity: { stdout: 'identity' }, storeStateDefault: { stdout: 'free' } } });
      const cold = await ctx.launch('cold');
      const coldHealth = await ctx.health();
      const gateway = ctx.process('gateway-1');
      const job = await ctx.harnessJob('incompatible', { limitFlags: ctx.killOnClose });
      await ctx.spawnInJob(job, 'job-sibling');
      await ctx.restrictToOneFreeSlot(job, 1); // the sibling + one free slot
      const probe = await ctx.nestProbe(job);
      if (!(probe.spawned === true && probe.report?.jobListCreateProcess === false)) ctx.fault('incompatible-job-not-verified', probe);
      const startsBefore = helperStarts(ctx, 'identity');
      const warm = await ctx.launchJob('warm', job);
      const warmHealth = await ctx.health();
      await ctx.sleep(ctx.grace);
      await ctx.snapshot('afterGrace');
      probeInfo(ctx, probe);
      ctx.check('cold-exit-zero', { kind: 'control', text: 'detached cold click outside the job exits 0 and starts one gateway', expected: { exitCode: 0, spawns: 1 }, actual: { exitCode: cold.exitCode, spawns: spawnsOf(ctx) }, pass: cold.exitCode === 0 && spawnsOf(ctx) === 1, baseline: 'pass' });
      const added = (warm.ext.accountingAtExit.totalProcesses ?? 0) - (warm.ext.accountingBefore.totalProcesses ?? 0);
      ctx.check('warm-click-refuses', { kind: 'requirement', text: 'the warm click in the incompatible job refuses with helper-containment before any identity helper runs, although a matching gateway is listening', expected: { code: 'helper-containment', exitCode: 1, newIdentityHelpers: 0, processesAddedToJob: 1 }, actual: { code: warm.code, exitCode: warm.exitCode, newIdentityHelpers: helperStarts(ctx, 'identity') - startsBefore, processesAddedToJob: added, diagnostic: warm.diagnostic }, pass: warm.code === 'helper-containment' && warm.exitCode === 1 && helperStarts(ctx, 'identity') === startsBefore && added === 1, baseline: 'fail' });
      const direct = { coldPid: coldHealth.pid, warmPid: warmHealth.pid, status: warmHealth.status, identityMatchesFixture: warmHealth.identityMatchesFixture, gatewayAliveAfterGrace: gateway?.samples.afterGrace?.alive ?? null, spawns: spawnsOf(ctx) };
      ctx.check('gateway-still-callable', { kind: 'control', text: 'the existing gateway is untouched and answers directly with the same PID after the refused click', expected: { status: 200, samePid: true, gatewayAliveAfterGrace: true, spawns: 1 }, actual: direct, pass: direct.status === 200 && direct.coldPid !== null && direct.coldPid === direct.warmPid && direct.gatewayAliveAfterGrace === true && direct.spawns === 1, baseline: 'pass' });
      siblingControl(ctx);
      sentinelControl(ctx);
    },
  },
  {
    id: 'ext-stdout-over-cap-running',
    title: 'Stdout over the 256 KiB cap from a still-running root (300 KiB then hang)',
    lane: 'fixture',
    category: 'outcome-taxonomy',
    planRow: 'Stdout retention capped at 256 KiB; oversized output refuses inside the work window',
    async run(ctx) {
      await ctx.prepare({ marker: false, scenario: { identity: { stdout: 'filler', bytes: 300 * 1024, hang: true, maxLifeMs: 60_000 } } });
      const invocation = await ctx.launch('click');
      await ctx.sleep(ctx.grace);
      await ctx.snapshot('afterGrace');
      ctx.check('helper-invalid', { kind: 'requirement', text: 'oversized stdout refuses with helper-invalid', expected: 'helper-invalid', actual: invocation.code, pass: invocation.code === 'helper-invalid', baseline: 'fail' });
      ctx.check('refused-before-deadline', { kind: 'requirement', text: 'the cap is enforced while reading: refusal well before the 15 s work window ends (root still running)', expected: '< 10000 ms', actual: invocation.osElapsedMs, pass: invocation.osElapsedMs < 10_000, baseline: 'fail' });
      memberTerminated(ctx, invocation, 'identity-1', 'pass');
      const stdout = Buffer.concat(invocation.stdoutChunks).length;
      const stderr = Buffer.concat(invocation.stderrChunks).toString('utf8');
      ctx.check('no-helper-bytes-forwarded', { kind: 'control', text: 'helper output never reaches launcher stdout/stderr', expected: { launcherStdoutBytes: 0, fillerInStderr: false }, actual: { launcherStdoutBytes: stdout, fillerInStderr: stderr.includes('xxxxxxxxxxxxxxxx') }, pass: stdout === 0 && !stderr.includes('xxxxxxxxxxxxxxxx'), baseline: 'pass' });
      callerEof(ctx, invocation, 'pass', 'control');
      noSpawn(ctx);
    },
  },
  {
    id: 'ext-stdout-at-cap-valid',
    title: 'Stdout exactly at the 256 KiB cap: a valid identity line padded with spaces to 262144 bytes, natural exit 0',
    lane: 'fixture',
    category: 'outcome-taxonomy',
    planRow: 'Stdout retention bound: exactly 256 KiB is retained and validated',
    async run(ctx) {
      await ctx.prepare({ marker: true, scenario: { identity: { stdout: 'identity-padded', padTo: CAP } } });
      const invocation = await ctx.launch('click');
      await ctx.sleep(ctx.grace);
      await ctx.snapshot('afterGrace');
      ctx.check('identity-accepted', { kind: 'requirement', text: 'a valid result of exactly 262144 bytes is retained, trimmed and accepted', expected: 'foreign-listener', actual: invocation.code, pass: accepted(invocation), baseline: 'fail' });
      const root = rootNatural(ctx, 'identity-1', invocation, 0);
      ctx.check('root-natural-zero', { kind: 'requirement', text: 'the root completes its 256 KiB write and exits naturally with 0', expected: 'natural 0', actual: root.relation, pass: root.pass, baseline: 'fail' });
    },
  },
  {
    id: 'ext-stdout-cap-plus-one',
    title: 'Stdout one byte over the cap: the same valid identity padded to 262145 bytes, natural exit 0',
    lane: 'fixture',
    category: 'outcome-taxonomy',
    planRow: 'Stdout retention bound: 256 KiB + 1 refuses as invalid',
    async run(ctx) {
      await ctx.prepare({ marker: false, scenario: { identity: { stdout: 'identity-padded', padTo: CAP + 1 } } });
      const invocation = await ctx.launch('click');
      await ctx.sleep(ctx.grace);
      await ctx.snapshot('afterGrace');
      ctx.check('helper-invalid', { kind: 'requirement', text: 'one byte over the cap refuses with helper-invalid', expected: 'helper-invalid', actual: invocation.code, pass: invocation.code === 'helper-invalid', baseline: 'fail' });
      ctx.check('prompt', { kind: 'requirement', text: 'refusal comes from the bound, not the deadline (< 10000 ms)', expected: '< 10000', actual: invocation.osElapsedMs, pass: invocation.osElapsedMs < 10_000, baseline: 'fail' });
      const relation = ctx.relation(ctx.process('identity-1'), invocation, 'afterGrace');
      ctx.check('root-ended-before-launcher-exit', { kind: 'requirement', text: 'the root ended (naturally or by the launcher\'s job) before the launcher exited', expected: { exitedBeforeLauncherExit: true }, actual: relation, pass: relation.exitedBeforeLauncherExit === true, baseline: 'pass' });
      noSpawn(ctx);
    },
  },
  {
    id: 'ext-strict-utf8-ownership',
    title: 'Strict UTF-8: an otherwise valid held ownership answer with one invalid byte inside its path string',
    lane: 'fixture',
    category: 'outcome-taxonomy',
    planRow: 'Strict UTF-8 validation of the stage protocol (a lenient decoder would accept this as held)',
    async run(ctx) {
      await ctx.prepare({ timeoutSeconds: 6, scenario: { identity: { stdout: 'identity' }, storeStateDefault: { stdout: 'held-bad-utf8' } } });
      const lock = lockFixture(ctx);
      const invocation = await ctx.launch('click');
      await ctx.sleep(ctx.grace);
      await ctx.snapshot('afterGrace');
      ctx.check('helper-invalid', { kind: 'requirement', text: 'invalid UTF-8 inside a JSON string refuses with helper-invalid (strict decoding), not store-held', expected: 'helper-invalid', actual: { code: invocation.code, storeStateCalls: helperStarts(ctx, 'store-state') }, pass: invocation.code === 'helper-invalid', baseline: 'fail' });
      const after = ctx.lockSnapshot(lock.path);
      ctx.check('lock-unchanged', { kind: 'control', text: 'store lock bytes and file identity unchanged', expected: lock.before, actual: after, pass: after.exists && after.sha256 === lock.before.sha256 && after.fileId === lock.before.fileId, baseline: 'pass' });
      noSpawn(ctx);
    },
  },
];
