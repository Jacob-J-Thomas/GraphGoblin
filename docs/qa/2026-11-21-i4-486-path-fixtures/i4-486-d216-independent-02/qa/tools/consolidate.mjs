// Read-only consolidation of D216 raw records into qa/RESULTS.json (derived from
// reference-tools/consolidate.mjs, sha256 f1f0316d...). Every check below reads only raw
// records; expectation labels come from the brief's six criteria and D216's stated predictions.
import fs from 'node:fs';
import path from 'node:path';

const QA = 'G:\\ggq\\delivery-evidence\\2026-11-17-five-intents\\i4-486-d216-independent-02\\qa';
const RAW = path.join(QA, 'raw');
const j = (n) => JSON.parse(fs.readFileSync(path.join(RAW, n), 'utf8'));
const BASE = 'b8012a8676b26641c845b78b94f2419cd1f225ece0e8eb417874215646db9e41';
const CAND = '723d73337c4a25ded1758c7d154a63656f96b3ad6c3431411744a33ad449baeb';
const rows = [
  ['1', 's1a-baseline6de-upper-g-temp-engine-temp-recordonly', 'baseline', { temp: 'fs.test.ts:143:52' }],
  ['1', 's1b-candidate-e630-upper-g-temp-engine-temp-recordonly', 'corrected', 'pass'],
  ['2', 's2a-baseline6de-c-short-temp-engine-fixed-temp-template-recordonly', 'baseline', { fixed: 'fs.test.ts:147:29', temp: 'fs.test.ts:143:52', template: 'fs.test.ts:147:29' }],
  ['2', 's2b-candidate-e630-c-short-temp-engine-fixed-temp-template-recordonly', 'corrected', 'pass'],
  ['2', 's2c-candidate-e630-c-short-temp-engine-fixed-temp-template-tapped', 'corrected', 'pass'],
  ['3', 's3-candidate-e630-ordinary-g-temp-full-fs-file-recordonly', 'corrected', 'pass'],
  ['4', 's4-candidate-e630-junction-g-temp-engine-fixed-temp-template-tapped', 'corrected', 'pass'],
  ['5', 's5a-candidate-e630-c-long-temp-adapter-mixed-tapped', 'corrected', 'pass'],
  ['5', 's5b-candidate-e630-c-long-temp-engine-relative-tapped', 'corrected', 'pass'],
];
const kindOf = (name) => (name.match(/uses real (\w+) paths/) ?? [])[1] ?? name;
const quoted = (m, label) => (m.match(new RegExp(`${label}: "([^"]*)"`)) ?? [])[1];
const scenarios = rows.map(([criterion, id, fixture, expected]) => {
  const s = j(`${id}.summary.json`);
  const worker = s.processes.find((p) => p.role === 'vitest-fork-worker');
  const v = s.vitest;
  const executed = v.executed.map((e) => ({
    name: e.fullName,
    kind: kindOf(e.fullName),
    status: e.status,
    firstFailureLocation: e.failureLocations[0] ?? null,
    expectedValue: e.failureMessages[0] ? quoted(e.failureMessages[0], 'Expected') ?? null : null,
    receivedValue: e.failureMessages[0] ? quoted(e.failureMessages[0], 'Received') ?? null : null,
  }));
  let matchesExpectation;
  if (expected === 'pass') matchesExpectation = v.numFailedTests === 0 && v.numPassedTests === executed.length && executed.length > 0;
  else
    matchesExpectation =
      executed.length === Object.keys(expected).length &&
      executed.every((e) => e.status === 'failed' && expected[e.kind] === e.firstFailureLocation);
  const wantSha = fixture === 'baseline' ? BASE : CAND;
  return {
    criterion,
    id,
    fixture,
    instrumentation: s.prepost.instrumentation,
    expected,
    matchesExpectation,
    exitCode: s.invocation.exitCode,
    timedOut: s.invocation.timedOut,
    counts: {
      totalInFile: v.numTotalTests,
      executed: executed.length,
      passed: v.numPassedTests,
      failed: v.numFailedTests,
      skippedByFilterOrPending: v.skippedCount,
    },
    executed,
    worker: {
      version: worker.version,
      cwd: worker.cwd,
      cwdDev: worker.cwdDev,
      TEMP: worker.TEMP,
      inheritedTEMP: worker.inheritedTemp?.TEMP,
      workerTempApplied: worker.workerTempApplied,
      tmpdir: worker.tmpdir,
      tmpdirDev: worker.tmpdirDev,
      tmpdirRealpathNative: worker.tmpdirRealpathNative,
      tmpdirRealpathJs: worker.tmpdirRealpathJs,
      tapsInstalled: worker.tapsInstalled,
      fixtureSha256AtStart: worker.fixtureSha256AtStart,
      fixtureMatchesIntended: worker.fixtureSha256AtStart === wantSha,
    },
    processRoles: s.processes.map((p) => p.role),
    taps: s.taps.map((t) => ({
      kind: t.kind,
      input: t.input ?? t.prefix ?? t.to ?? t.segments,
      from: t.from,
      out: t.out,
      outIsAbsolute: t.outIsAbsolute,
      outRealpathNative: t.outRealpathNative,
      callSite: t.callSite,
    })),
    watchedResultFiles: {
      tempPhysicalRoot: s.watch['temp-physical-root']?.resultFileEvents ?? [],
      checkoutPackage: s.watch['checkout-package']?.resultFileEvents ?? [],
    },
    watcherErrors: Object.values(s.watch).flatMap((w) => w.watcherErrors),
    swap: s.swap ?? null,
    tempPostListingEmpty: s.prepost.postTempListing.length === 0,
    mainGTempPostListingEmpty: s.prepost.postMainGTempListing ? s.prepost.postMainGTempListing.length === 0 : null,
    checkoutLeftoversAfter: s.prepost.postLeftovers,
    statusAfter: s.prepost.postStatus,
    fixtureAfter: s.prepost.postFixtureSha256,
  };
});
const pre = j('00-preflight.json');
const fx = j('01-fixtures.json');
const cset = j('20-c-setup.json');
const p1 = JSON.parse(fs.readFileSync(path.join(RAW, 'p1-upper-g-temp-resolver-probe.stdout.json'), 'utf8'));
const p2 = JSON.parse(fs.readFileSync(path.join(RAW, 'p2-c-short-temp-resolver-probe.stdout.json'), 'utf8'));
const p5 = JSON.parse(fs.readFileSync(path.join(RAW, 'p5-c-long-temp-resolver-probe.stdout.json'), 'utf8'));
const after = j('50-after.json');
const events = fs.readFileSync(path.join(RAW, 'runner-events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const probeView = (p) => ({
  envTEMP: p.envTEMP,
  tmpdir: p.tmpdir,
  instrumentation: p.instrumentation,
  nodeOptionsPresent: p.nodeOptionsPresent,
  child: p.childLexical,
  jsRealpathSync: p.childRecord.jsRealpathSync,
  nativeRealpathSync: p.childRecord.nativeRealpathSync,
  promisesRealpath: p.childRecord.promisesRealpath,
  nativeEqualsPromises: p.childRecord.nativeEqualsPromises,
  jsEqualsInputLexical: p.childRecord.jsEqualsInputLexical,
  nativeEqualsInputLexical: p.childRecord.nativeEqualsInputLexical,
  inputAndNativeSameDevIno: p.childRecord.inputAndNativeSameDevIno,
  markerWrittenViaLexicalReadViaNative: p.markerWrittenViaLexicalReadViaNative,
  childRemoved: p.childRemoved,
});
const out = {
  head: 'e630bb83679bdb055bdd90d2b30e25fbf60571ac',
  tree: '0713eef9779a14e68b8ca0461f784538ba116c9f',
  parent: '6de50cb8e22b92bfed5d6fe7bf14a2a10b95cd08',
  baselineFixtureSha256: BASE,
  correctedFixtureSha256: CAND,
  platform: pre.platform,
  node: pre.runner.node,
  pnpm: pre.pnpmVersion.stdout,
  preflight: {
    sourceBeforeMatchesBinding: pre.sourceBeforeMatchesBinding,
    entriesDifferingFromParent: pre.productionIdentity.entriesDifferingFromBase,
    dependencyMetadataMatchesBinding: pre.productionIdentity.dependencyMetadataMatchesBinding,
    deltaProof: pre.deltaProof,
    observerMatchesReference: pre.observer.matchesReference,
  },
  uppercaseFixture: fx.upper,
  junctionFixture: fx.junction,
  probes: { p1UpperG: probeView(p1), p2ShortC: probeView(p2), p5LongC: probeView(p5) },
  shortName: {
    method: cset.shortNameProbe.method,
    query: Object.fromEntries(Object.entries(cset.shortNameProbe.shortQuery).map(([k, v]) => [k, v.value])),
    fsutil8dot3Query: { status: cset.shortNameProbe.fsutil8dot3Query.status, stdout: cset.shortNameProbe.fsutil8dot3Query.stdout },
    cShort: cset.shortNameProbe.cShort,
  },
  scenarios,
  allScenariosMatchExpectation: scenarios.every((s) => s.matchesExpectation),
  allWorkersRanIntendedFixture: scenarios.every((s) => s.worker.fixtureMatchesIntended),
  allSwapsRestored: scenarios.filter((s) => s.swap).every((s) => s.swap.restoredIsCorrected && s.swap.statusAfterRestore === ''),
  allPostStatesClean: scenarios.every((s) => s.statusAfter === '' && s.fixtureAfter === CAND && s.checkoutLeftoversAfter.length === 0 && s.tempPostListingEmpty),
  noWatcherErrors: scenarios.every((s) => s.watcherErrors.length === 0),
  cSetup: { croot: cset.croot, capacityBefore: cset.capacityBefore, capacityAfterCreate: cset.capacityAfterCreate, volumes: cset.volumes },
  cCleanup: j('29-c-cleanup.json'),
  cleanup: j('40-cleanup.json'),
  after: {
    sourceAfterMatchesBinding: after.sourceAfterMatchesBinding,
    checkoutRelativeLeftovers: after.checkoutRelativeLeftovers,
    dependencyMetadataMatchesBinding: after.dependencyMetadataMatchesBinding,
    cParentEntriesMatchingPrefix: after.cParentEntriesMatchingPrefix,
    scratchListing: after.scratchListing,
    observerSha256: after.observer.sha256,
  },
  runnerEvents: {
    phaseErrors: events.filter((e) => e.kind === 'phase-error'),
    runnerShas: [...new Set(events.filter((e) => e.runnerSha256).map((e) => e.runnerSha256))],
    invocations: events.filter((e) => e.kind === 'invoke-end').map((e) => [e.id, e.exitCode, e.timedOut]),
  },
};
fs.writeFileSync(path.join(QA, 'RESULTS.json'), JSON.stringify(out, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(scenarios.map((s) => [s.id.slice(0, 4), s.matchesExpectation, s.exitCode, s.counts, s.worker.fixtureMatchesIntended, s.instrumentation])));
console.log(JSON.stringify({ all: out.allScenariosMatchExpectation, fixtures: out.allWorkersRanIntendedFixture, swaps: out.allSwapsRestored, post: out.allPostStatesClean, watch: out.noWatcherErrors, phaseErrors: out.runnerEvents.phaseErrors.length, runnerShas: out.runnerEvents.runnerShas }));
