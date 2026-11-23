import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const evidence = import.meta.dirname;
const qa = 'G:/ggq/gg-i5-truthfulness-qa/GraphGoblin';
const common = 'G:/ggq/gg-delivery-next-independent/GraphGoblin';
const shaBytes = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sha = (path) => shaBytes(readFileSync(path));
const json = (path) => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
const gitBytes = (cwd, ...args) => execFileSync('git', ['--no-optional-locks', ...args], {
  cwd, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1' }, maxBuffer: 4 * 1024 * 1024,
});
const git = (cwd, ...args) => gitBytes(cwd, ...args).toString('utf8').trim();
const admission = json(resolve(evidence, 'apply-source-parity.json'));
const manifest = json(resolve(evidence, 'CANDIDATE.json'));
const correction = json(resolve(evidence, 'r2-2-schema-fixture-closure-01/fixture-correction-receipt.json'));
const sources = manifest.files.map((file) => ({ path: file.path, sha256: sha(resolve(qa, file.path)),
  matchesCandidate: sha(resolve(qa, file.path)) === file.sha256,
  matchesGit: shaBytes(gitBytes(qa, 'cat-file', 'blob', `${manifest.head}:${file.path}`)) === file.sha256 }));
const qaSources = admission.after.qaFiles.map((file) => {
  const expected = file.path.endsWith('/RunInspectorPage.review2-independent-qa.test.tsx') ? correction.newSourceSha256 : file.sha256;
  return { path: file.path, initialSha256: file.sha256, currentSha256: sha(resolve(qa, file.path)),
    expectedSha256: expected, matches: sha(resolve(qa, file.path)) === expected };
});
const beforeQa = readFileSync(resolve(evidence, 'r2-2-schema-fixture-closure-01/before-RunInspectorPage.review2-independent-qa.test.tsx'), 'utf8');
const afterQa = readFileSync(resolve(qa, 'apps/web/src/runs/RunInspectorPage.review2-independent-qa.test.tsx'), 'utf8');
const provenance = { atUtc: new Date().toISOString(), status: 'D228 PARTIAL DIAGNOSTIC ONLY; UNACCEPTED',
  head: manifest.head, tree: manifest.tree, candidateManifestSha256: sha(resolve(evidence, 'CANDIDATE.json')),
  sources, qaSources, exactApprovedSchemaReplacementOnly: beforeQa.replaceAll('RunRecordSchema', 'RunSnapshotSchema') === afterQa,
  qaHead: git(qa, 'rev-parse', 'HEAD'), qaIndexSha256: sha(resolve(qa, '.git/index')),
  commonHead: git(common, 'rev-parse', 'HEAD'), commonIndexAbsent: !existsSync(resolve(common, '.git/index')),
  browserRun: false, buildRun: false, coverageRun: false, productEditsByQa: false };
provenance.allChecksPass = sources.every((file) => file.matchesCandidate && file.matchesGit)
  && qaSources.every((file) => file.matches) && provenance.exactApprovedSchemaReplacementOnly
  && provenance.qaHead === admission.after.qaHead && provenance.qaIndexSha256 === admission.after.qaIndexSha256
  && provenance.commonHead === admission.after.commonHead && provenance.commonIndexAbsent;
writeFileSync(resolve(evidence, 'post-run-source-provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
const initial = json(resolve(evidence, 'components.json'));
const closure = json(resolve(evidence, 'r2-2-schema-fixture-closure-01/component.json'));
const cases = initial.testResults.flatMap((file) => file.assertionResults.map((test) => ({
  file: file.name.replace(qa + '/', ''), name: test.fullName ?? test.title,
  initialStatus: test.status, durationMs: test.duration,
})));
const closureCases = closure.testResults.flatMap((file) => file.assertionResults).filter((test) => test.status === 'passed');
if (closureCases.length !== 1) throw new Error('Scoped closure did not execute exactly one passing case');
for (const test of cases) {
  const scoped = closureCases.find((result) => (result.fullName ?? result.title) === test.name);
  if (scoped) { test.closureStatus = scoped.status; test.closureDurationMs = scoped.duration;
    test.qualification = 'Initial fixture stopped before foreign body; root-approved exact schema correction, then this case alone passed'; }
  test.finalDiagnosticStatus = test.closureStatus ?? test.initialStatus;
}
const summary = { atUtc: new Date().toISOString(), disposition: '36 DISTINCT DESIRED CASES PASSED ACROSS QUALIFIED DIAGNOSTIC INVOCATIONS; PARTIAL SOURCE UNACCEPTED',
  head: manifest.head, tree: manifest.tree, sourceMembers: sources.length,
  initialInvocation: { cases: cases.length, passed: cases.filter((test) => test.initialStatus === 'passed').length,
    failed: cases.filter((test) => test.initialStatus === 'failed').length, retries: 0 },
  scopedClosure: { actualCases: 1, passed: 1, otherUnselectedCases: 4, retries: 0, rootApproval: 'D229-Q1' },
  distinctPassed: cases.filter((test) => test.finalDiagnosticStatus === 'passed').length,
  single36Green: false, initialInvocationRemainsFailed: true,
  typecheckAndScopedLint: 'PASS on initial65d87 QA source; exact two-identifier schema fix followed without broader repeat',
  fixtureCauseCapture: 'r2-2-schema-cause.json; isolated FakeApi+schema evaluation, zero Vitest/network/listeners',
  confirmedNewProductDefects: 0, browserRun: false, buildRun: false, finalAcceptance: false, cases };
writeFileSync(resolve(evidence, 'case-summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ allChecksPass: provenance.allChecksPass, initial: summary.initialInvocation,
  distinctPassed: summary.distinctPassed, single36Green: false, qaIndexSha256: provenance.qaIndexSha256 }, null, 2));
if (!provenance.allChecksPass || summary.distinctPassed !== 36) process.exitCode = 1;
