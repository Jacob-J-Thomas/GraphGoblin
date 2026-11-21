// GraphGoblin #459 independent native QA: cross-run analysis (reads scrubbed case evidence only).
// Usage: node analyze.mjs <qa root> <output json>
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [root, output] = process.argv.slice(2);
const RUNS = {
  baselineFormal: 'i3-459-native-qa/baseline/baseline-20261121T013403Z-b281ea',
  matched: 'i3-459-native-qa-candidate/matched/candidate-20261121T014803Z-3edac9',
  jobHost: 'i3-459-native-qa-candidate/job-host/candidate-20261121T015345Z-4619c4',
  ext: 'i3-459-native-qa-candidate/ext/candidate-20261121T020839Z-081d57',
  extBaseline: 'i3-459-native-qa-candidate/ext-baseline/baseline-20261121T021033Z-3c576e',
};
const JOB_CODE = 3762750553;
const load = (relative) => {
  const dir = join(root, relative);
  const cases = Object.fromEntries(
    readdirSync(join(dir, 'cases')).map((name) => [name.replace(/\.json$/, ''), JSON.parse(readFileSync(join(dir, 'cases', name), 'utf8'))]),
  );
  return { run: JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')), summary: JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8')), cases };
};
const runs = Object.fromEntries(Object.entries(RUNS).map(([key, relative]) => [key, load(relative)]));
const countBy = (items, key) => items.reduce((acc, item) => ((acc[key(item)] = (acc[key(item)] ?? 0) + 1), acc), {});

function compare(baseline, candidate, others = {}) {
  const rows = [];
  for (const [id, base] of Object.entries(baseline.cases)) {
    const cand = candidate.cases[id];
    for (const assertion of base.assertions) {
      const c = cand?.assertions.find((item) => item.id === assertion.id);
      const row = { case: id, assertion: assertion.id, kind: assertion.kind, baselineExpectation: assertion.baselineExpectation, baselinePass: assertion.pass, candidatePass: c?.pass ?? null };
      for (const [name, run] of Object.entries(others)) row[`${name}Pass`] = run.cases[id]?.assertions.find((item) => item.id === assertion.id)?.pass ?? null;
      rows.push(row);
    }
  }
  const judged = rows.filter((row) => row.kind !== 'info');
  return {
    caseVerdicts: Object.keys(baseline.cases).map((id) => ({
      case: id,
      baseline: baseline.cases[id].verdict,
      candidate: candidate.cases[id]?.verdict ?? null,
      ...Object.fromEntries(Object.entries(others).map(([name, run]) => [name, run.cases[id]?.verdict ?? null])),
    })),
    assertionTotals: {
      judged: judged.length,
      baselineExpectedFailures: judged.filter((row) => row.baselineExpectation === 'fail').length,
      baselineExpectedFailuresObserved: judged.filter((row) => row.baselineExpectation === 'fail' && row.baselinePass === false).length,
      flippedToPass: judged.filter((row) => row.baselineExpectation === 'fail' && row.baselinePass === false && row.candidatePass === true).length,
      baselinePassingStillPass: judged.filter((row) => row.baselinePass === true && row.candidatePass === true).length,
      baselinePassing: judged.filter((row) => row.baselinePass === true).length,
      candidateFailures: judged.filter((row) => row.candidatePass !== true).map((row) => `${row.case}/${row.assertion}`),
      baselinePredictionMismatches: judged.filter((row) => row.baselineExpectation !== 'observe' && (row.baselineExpectation === 'pass') !== row.baselinePass).map((row) => `${row.case}/${row.assertion}`),
      ...Object.fromEntries(Object.keys(others).map((name) => [`${name}Failures`, judged.filter((row) => row[`${name}Pass`] !== true).map((row) => `${row.case}/${row.assertion}`)])),
    },
    rows,
  };
}

/** The driver's own natural-exit rule: helper roots and gateways only by their logged exit event. */
function natural(item, record, code) {
  if (record.role.startsWith('identity-') || record.role.startsWith('store-state-'))
    return item.helperEvents.some((event) => event.event === 'helper-exit' && event.pid === record.pid && event.code === code);
  if (record.role.startsWith('gateway-'))
    return item.helperEvents.some((event) => event.event === 'gateway-exit' && event.pid === record.pid && event.code === code);
  return (record.naturalCodes ?? []).includes(code);
}

/** Per-run process facts from launcher collection samples (never teardown). */
function processFacts(run) {
  const terminated = [];
  const teardown = [];
  const eof = [];
  const leaks = [];
  const gateways = [];
  const deadlines = [];
  for (const [id, item] of Object.entries(run.cases)) {
    if (item.privacy?.leaks?.length) leaks.push({ case: id, leaks: item.privacy.leaks });
    for (const invocation of item.invocations) eof.push({ case: id, invocation: invocation.name, code: invocation.code, exitKind: invocation.exitKind, afterExitMs: invocation.callerEofAfterExitMs, afterTeardown: invocation.callerEofAfterTeardown });
    const launchers = item.processes.filter((record) => record.role.startsWith('launcher-'));
    for (const record of item.processes) {
      if (record.role.startsWith('launcher-') || record.role === 'driver-self' || record.role.startsWith('nest-probe-')) continue;
      const sample = record.samples.afterCleanup ?? record.samples.afterGrace ?? record.samples.exit;
      if (record.teardown && !['none-already-exited'].includes(record.teardown.action))
        teardown.push({ case: id, role: record.role, action: record.teardown.action, watchdog: Boolean(record.teardown.watchdog), aliveAtCollection: sample?.alive ?? null, final: record.finalClassification ?? null });
      if (sample && sample.alive === false && sample.exitCode !== null && !record.role.startsWith('real-') && record.role !== 'contender') {
        const launcher = launchers.find((l) => l.samples.exit?.exitedAtMs && l.samples.exit.createdAtMs <= sample.exitedAtMs + 32 && sample.exitedAtMs <= l.samples.exit.exitedAtMs + 32);
        const driverCode = [47, 48, 97, 0xa459].includes(sample.exitCode);
        if (launcher && !driverCode && !natural(item, record, sample.exitCode))
          terminated.push({ case: id, role: record.role, exitCode: sample.exitCode, beforeLauncherExitMs: launcher.samples.exit.exitedAtMs - sample.exitedAtMs, afterLauncherStartMs: sample.exitedAtMs - launcher.samples.exit.createdAtMs, launcher: launcher.role });
      }
      if (record.role === 'real-gateway' || record.role.startsWith('gateway-'))
        gateways.push({ case: id, role: record.role, inAnyJob: record.opened.inAnyJob, parentIsLauncher: launchers.some((l) => l.pid === record.opened.parentPid), aliveAfterGrace: record.samples.afterGrace?.alive ?? null, teardown: record.teardown?.action ?? null });
    }
    for (const invocation of item.invocations.filter((inv) => inv.code === 'helper-timeout')) {
      const exits = terminated.filter((t) => t.case === id && t.launcher === `launcher-${invocation.name}`);
      deadlines.push({ case: id, invocation: invocation.name, osElapsedMs: invocation.osElapsedMs, terminated: exits.length, codes: [...new Set(exits.map((t) => t.exitCode))], firstTerminationAfterStartMs: exits.length ? Math.min(...exits.map((t) => t.afterLauncherStartMs)) : null, launcherExitAfterFirstTerminationMs: exits.length ? Math.max(...exits.map((t) => t.beforeLauncherExitMs)) : null });
    }
  }
  return {
    terminatedByCode: countBy(terminated, (t) => String(t.exitCode)),
    terminated,
    deadlines,
    teardownActions: teardown,
    teardownOfHelperTree: teardown.filter((t) => !['sentinel', 'contender', 'real-gateway', 'job-sibling'].includes(t.role) && !t.role.startsWith('gateway-')),
    callerEof: eof,
    privacyLeaks: leaks,
    gateways,
    sentinel: { aliveBeforeRelease: run.summary.sentinel.aliveBeforeRelease, samples: run.summary.sentinel.samples.length, aliveInAllSamples: run.summary.sentinel.samples.every((sample) => sample.alive === true), final: run.summary.sentinel.finalState },
    rejectedHandshakes: run.summary.rejectedHandshakes.length,
    setupFaults: Object.values(run.cases).flatMap((item) => item.setupFaults.map((fault) => ({ case: item.case, reason: fault.reason }))),
  };
}

function realLane(run) {
  const get = (id, assertion) => run.cases[id]?.assertions.find((item) => item.id === assertion)?.actual ?? null;
  return {
    helperDurations: get('real-helper-direct-timing', 'real-helper-durations'),
    coldWarm: get('real-cold-warm-reuse', 'real-timings'),
    gatewayHandle: get('real-cold-warm-reuse', 'gateway-exact-handle'),
    warmReuse: get('real-cold-warm-reuse', 'warm-reuse-same-pid'),
    heldStore: get('real-held-store', 'real-timings'),
  };
}

function heldStore(run) {
  const pick = (id) => run.cases[id] && Object.fromEntries(run.cases[id].assertions.map((item) => [item.id, { pass: item.pass, actual: item.actual }]));
  return { recheckStalls: pick('held-store-recheck-stalls'), tooLittleTime: pick('held-store-too-little-time'), toFree: pick('held-store-to-free') };
}

const result = {
  schema: 'gg459-native-qa-analysis/1',
  runs: Object.fromEntries(Object.entries(runs).map(([key, run]) => [key, {
    runId: run.run.runId, label: run.run.label, head: run.run.checkout.head, tree: run.run.checkout.tree, trackedChanges: run.run.checkout.trackedChanges,
    launcherSourceSha256: run.run.checkout.launcherSourceSha256, launcherExeSha256: run.run.build.launcherExeSha256, witnessExeSha256: run.run.build.witnessExeSha256,
    launcherHost: run.run.launcherHost, suite: run.run.suite ?? 'base', driverVersion: run.run.driverVersion ?? 'qa459 baseline', jobExitCode: run.run.constants.jobExitCode,
    driverQa459DriverSha256: run.run.driver['qa459-driver.mjs'], verdicts: countBy(Object.values(run.cases), (item) => item.verdict), cases: Object.keys(run.cases).length,
  }])),
  base: compare(runs.baselineFormal, runs.matched, { jobHost: runs.jobHost }),
  ext: compare(runs.extBaseline, runs.ext),
  facts: Object.fromEntries(Object.entries(runs).map(([key, run]) => [key, processFacts(run)])),
  realLane: { baselineFormal: realLane(runs.baselineFormal), matched: realLane(runs.matched), jobHost: realLane(runs.jobHost) },
  heldStore: { baselineFormal: heldStore(runs.baselineFormal), matched: heldStore(runs.matched), jobHost: heldStore(runs.jobHost) },
  jobExitCode: JOB_CODE,
};
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
const digest = {
  runs: result.runs,
  baseTotals: result.base.assertionTotals,
  extTotals: result.ext.assertionTotals,
  terminatedByCode: Object.fromEntries(Object.entries(result.facts).map(([key, facts]) => [key, facts.terminatedByCode])),
  deadlines: Object.fromEntries(Object.entries(result.facts).map(([key, facts]) => [key, facts.deadlines])),
  helperTreeTeardown: Object.fromEntries(Object.entries(result.facts).map(([key, facts]) => [key, facts.teardownOfHelperTree.length])),
  leaks: Object.fromEntries(Object.entries(result.facts).map(([key, facts]) => [key, facts.privacyLeaks.length])),
  sentinel: Object.fromEntries(Object.entries(result.facts).map(([key, facts]) => [key, facts.sentinel])),
  setupFaults: Object.fromEntries(Object.entries(result.facts).map(([key, facts]) => [key, facts.setupFaults.length])),
  gateways: Object.fromEntries(Object.entries(result.facts).map(([key, facts]) => [key, facts.gateways])),
  realLane: result.realLane,
};
console.log(JSON.stringify(digest, null, 1));
