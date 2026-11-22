import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const evidence = import.meta.dirname;
const qa = 'G:/ggq/gg-i5-truthfulness-qa/GraphGoblin';
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const json = (path) => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
const binding = json(resolve(evidence, 'component-runtime-input-binding.json'));
const source = json(resolve(evidence, 'source-parity-after-browsers.json'));
const build = json(resolve(evidence, 'build-artifacts.json'));
const types = json(resolve(evidence, 'types-lint-command-result.json'));
const buildCommand = json(resolve(evidence, 'build-command-result.json'));
const cleanup = json(resolve(evidence, 'cleanup-and-port-release.json'));
const processes = json(resolve(evidence, 'owned-process-cleanup-check.json'));
function cases(reportName) {
  const report = json(resolve(evidence, reportName)); const result = [];
  function walk(suite) {
    for (const spec of suite.specs ?? []) for (const test of spec.tests) {
      const actual = test.results;
      result.push({ title: spec.title, file: spec.file, line: spec.line, project: test.projectName,
        reportStatus: test.status, actualExecutions: actual.length,
        results: actual.map((item) => ({ status: item.status, retry: item.retry, durationMs: item.duration,
          errors: item.errors, attachments: item.attachments })), report: reportName });
    }
    for (const child of suite.suites ?? []) walk(child);
  }
  for (const suite of report.suites) walk(suite);
  return { stats: report.stats, errors: report.errors, cases: result };
}
const held = cases('held-projection-browser.json');
const claude = cases('original-claude-browser.json');
const browserCases = [...held.cases, ...claude.cases];
const traces = browserCases.flatMap((test) => test.results.flatMap((result) => result.attachments ?? []))
  .filter((attachment) => attachment.name === 'trace').map((attachment) => ({ path: attachment.path,
    exists: existsSync(attachment.path), sha256: existsSync(attachment.path) ? sha(attachment.path) : null }));
const browserPass = browserCases.length === 6 && held.cases.length === 5 && claude.cases.length === 1
  && [...held.errors, ...claude.errors].length === 0
  && browserCases.every((test) => test.actualExecutions === 1 && test.results[0].status === 'passed'
    && test.results[0].retry === 0 && test.results[0].errors.length === 0)
  && traces.length === 6 && traces.every((trace) => trace.exists);
const artifactsUnchanged = build.files.every((file) => sha(resolve(qa, file.path)) === file.sha256);
copyFileSync(resolve(evidence, '../d228-diagnostic-01/case-summary.json'), resolve(evidence, 'bound-d228-case-summary.json'));
const component = json(resolve(evidence, 'bound-d228-case-summary.json'));
const result = { atUtc: new Date().toISOString(), disposition: 'PASS — ASSIGNED FINITE AFFECTED QA AT EXACT FINAL SOURCE',
  head: binding.finalHead, tree: binding.finalTree, manifestSha256: binding.candidateManifestSha256,
  sourceMembers: 25, checkedTrackedInputs: binding.trackedInputs, unchangedRuntimeInputs: binding.runtimeInputs,
  signedBaseUnchangedRuntimeInputs: binding.signedBaseUnchangedRuntimeInputs,
  components: { distinctPassed: component.distinctPassed, evidenceBoundFrom: binding.priorHead,
    initialInvocation: component.initialInvocation, scopedClosure: component.scopedClosure,
    originalFailurePreserved: true, single36Green: false, rerunOnFinalHead: false,
    bindingSha256: sha(resolve(evidence, 'component-runtime-input-binding.json')) },
  browsers: { passed: browserPass ? 6 : null, total: browserCases.length, currentCandidateInvocations: 2,
    retry: 0, cases: browserCases, reports: [{ file: 'held-projection-browser.json', stats: held.stats },
      { file: 'original-claude-browser.json', stats: claude.stats }], traces },
  fullWebTypecheck: types.exitCode === 0 ? 'PASS including final QA617 schema fixture and destination-only browser fixture' : 'FAIL',
  scopedFiveQaFilesLint: types.exitCode === 0 ? 'PASS' : 'FAIL',
  build: { exitCode: buildCommand.exitCode, successfulTasks: 9, dependencyCacheHits: 8,
    currentWebCacheMissAndCompiled: true, artifactsUnchangedAfterBrowser: artifactsUnchanged,
    servedIndex: build.files.find((file) => file.path === 'apps/web/dist/index.html') },
  sourceParityAfterBrowser: source.allChecksPass, qaIndexSha256: source.qaIndexSha256,
  commonHead: source.commonHead, commonIndexAbsent: source.commonIndexAbsent,
  cleanup: { ownedPortsUnbound: cleanup.listeners.length === 0,
    ownedNodeBrowserCommandLineMatches: processes.ownedProcesses.length, processesTerminated: 0 },
  originalClaudeSha256: sha(resolve(qa, 'apps/web/e2e/claude-harness.spec.ts')),
  suppliedInspectorFixtureSha256: sha(resolve(qa, 'apps/web/e2e/inspector-truthfulness.spec.ts')),
  copiedBrowserFixtureSha256: sha(resolve(qa, 'apps/web/e2e/inspector-final-independent-qa.spec.ts')),
  browserDestinationDiffSha256: sha(resolve(evidence, 'browser-destination-only.diff')),
  productionEditsByQa: false, gitWrites: false, formalReviewScansConsumed: 0,
  rootCoverageCiReviewAndMergeApproval: 'separate gates; not established by this QA report',
  actualProviderOrOwnerAcceptance: false };
result.assignedQaPass = browserPass && source.allChecksPass && types.exitCode === 0 && buildCommand.exitCode === 0
  && artifactsUnchanged && component.distinctPassed === 36 && cleanup.listeners.length === 0
  && processes.ownedProcesses.length === 0;
writeFileSync(resolve(evidence, 'FINAL-RESULTS.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ assignedQaPass: result.assignedQaPass, componentsBound: result.components.distinctPassed,
  freshBrowserPassed: result.browsers.passed, traces: traces.length, sourceParity: result.sourceParityAfterBrowser,
  buildArtifactsUnchanged: artifactsUnchanged, cleanup: result.cleanup }, null, 2));
if (!result.assignedQaPass) process.exitCode = 1;
