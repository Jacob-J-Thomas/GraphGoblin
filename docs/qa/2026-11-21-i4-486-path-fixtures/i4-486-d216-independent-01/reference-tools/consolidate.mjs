// Read-only consolidation of per-scenario summaries into qa/RESULTS.json. Interprets nothing that
// is not in the raw records; expectation labels come from the brief's six scenarios.
import fs from 'node:fs';
import path from 'node:path';

const QA = 'G:\\ggq\\delivery-evidence\\2026-11-17-five-intents\\i4-486-d215-independent-01\\qa';
const RAW = path.join(QA, 'raw');
const j = (n) => JSON.parse(fs.readFileSync(path.join(RAW, n), 'utf8'));
const BASE = '82039a8f984b276faafa3936db0753b06f79064420f9b863f9be2f2562bdd21c';
const CAND = 'b8012a8676b26641c845b78b94f2419cd1f225ece0e8eb417874215646db9e41';
const rows = [
  ['1', 's1-baseline-ordinary-g-temp-engine-temp', 'baseline', 'pass (positive control)'],
  ['2', 's2-baseline-junction-g-temp-engine-temp', 'baseline', 'fail at original cwd check (control)'],
  ['3', 's3-corrected-ordinary-g-temp-full-fs-file', 'corrected', 'pass'],
  ['4', 's4-corrected-junction-g-temp-engine-temp', 'corrected', 'pass'],
  ['5a', 's5a-corrected-c-temp-adapter-mixed', 'corrected', 'pass'],
  ['5b', 's5b-corrected-c-temp-engine-relative', 'corrected', 'pass'],
  ['6a', 's6a-corrected-junction-g-temp-engine-fixed', 'corrected', 'pass'],
  ['6b', 's6b-corrected-junction-g-temp-engine-template', 'corrected', 'pass'],
];
const scenarios = rows.map(([n, id, fixture, expected]) => {
  const s = j(`${id}.summary.json`);
  const worker = s.processes.find((p) => p.role === 'vitest-fork-worker');
  const v = s.vitest;
  const observed =
    v.numFailedTests === 0 && v.numPassedTests > 0
      ? 'pass'
      : v.numFailedTests > 0
        ? 'fail'
        : 'none-executed';
  const wantSha = fixture === 'baseline' ? BASE : CAND;
  return {
    scenario: n,
    id,
    fixture,
    expected,
    observed,
    exitCode: s.invocation.exitCode,
    timedOut: s.invocation.timedOut,
    counts: {
      total: v.numTotalTests,
      passed: v.numPassedTests,
      failed: v.numFailedTests,
      skippedOrPending: v.numPendingTests,
    },
    executed: v.executed.map((e) => ({ name: e.fullName, status: e.status })),
    failureMessages: v.executed.flatMap((e) => e.failureMessages),
    worker: {
      version: worker.version,
      cwd: worker.cwd,
      cwdDev: worker.cwdDev,
      tmpdir: worker.tmpdir,
      tmpdirDev: worker.tmpdirDev,
      tmpdirRealpathNative: worker.tmpdirRealpathNative,
      tmpdirLexicalEqualsPhysical: worker.tmpdirLexicalEqualsPhysical,
      workerTempApplied: worker.workerTempApplied ?? false,
      fixtureSha256AtStart: worker.fixtureSha256AtStart,
      fixtureMatchesIntended: worker.fixtureSha256AtStart === wantSha,
    },
    taps: s.taps.map((t) => ({
      kind: t.kind,
      input: t.input ?? t.prefix ?? t.to ?? t.segments,
      out: t.out,
      outIsAbsolute: t.outIsAbsolute,
      differs: t.differs,
      oldCrossDriveControl: t.oldCrossDriveControl,
      callSite: t.callSite,
    })),
    tempPostListingEmpty: s.prepost.postTempListing.length === 0,
    checkoutLeftoversAfter: s.prepost.postLeftovers,
    statusAfter: s.prepost.postStatus,
    fixtureAfter: s.prepost.postFixtureSha256,
  };
});
const out = {
  head: '6de50cb8e22b92bfed5d6fe7bf14a2a10b95cd08',
  tree: '34b80f155c8434abc69fc72105ae7462fc460377',
  parent: 'b8126de18080b76b15cbbbbc00fd791030fec3e1',
  baselineFixtureSha256: BASE,
  correctedFixtureSha256: CAND,
  scenarios,
  allObservedMatchExpected: scenarios.every((s) =>
    s.expected.startsWith('fail') ? s.observed === 'fail' : s.observed === 'pass',
  ),
  allWorkersRanIntendedFixture: scenarios.every((s) => s.worker.fixtureMatchesIntended),
  gates: {
    typecheckNoEmit: j('g1-infrastructure-typecheck-tests-noemit.invocation.json').exitCode,
    eslintFsTest: j('g2-eslint-fs-test.invocation.json').exitCode,
    prettierFsTest: j('g3-prettier-check-fs-test.invocation.json').exitCode,
    gitDiffCheck: j('g4-git-diff-check.json').exit,
    coverageConfirmation: j('g-coverage-confirmation.json'),
  },
  crossSetup: j('20-cross-setup.json'),
  crossCleanup: j('29-cross-cleanup.json'),
  cleanup: j('40-cleanup.json'),
  sourceAfterMatchesBinding: j('50-after.json').sourceAfterMatchesBinding,
  residualRealpathProbe: j('60-residual-realpath-probe.json'),
};
fs.writeFileSync(path.join(QA, 'RESULTS.json'), JSON.stringify(out, null, 2) + '\n', { flag: 'wx' });
console.log(
  JSON.stringify(
    scenarios.map((s) => [s.scenario, s.expected, s.observed, s.exitCode, s.counts, s.worker.fixtureMatchesIntended]),
  ),
);
console.log(JSON.stringify({ all: out.allObservedMatchExpected, fixtures: out.allWorkersRanIntendedFixture }));
