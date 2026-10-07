import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const hash = (value) => createHash('sha256').update(value).digest('hex');
export const assert = (ok, reason) => {
  if (!ok) throw new Error(reason);
};
export const sha = (value) => /^[a-f0-9]{40}$/.test(value);
export function checkPermission(config) {
  assert(config.allowUnsandboxedChecks === true, 'SANDBOXED_CHECKS_UNAVAILABLE');
}
export function implementationGuard(implementation, config) {
  branchGuard(implementation.branch, config);
  assert(sha(implementation.headSha) && sha(implementation.baseSha), 'IMPLEMENTATION_SHA_INVALID');
}
export function branchGuard(branch, config) {
  assert(
    typeof branch === 'string' &&
      /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(branch) &&
      !branch.includes('..') &&
      new RegExp(config.branchPattern).test(branch) &&
      branch !== config.baseBranch &&
      !['main', 'master'].includes(branch),
    'BRANCH_NOT_AUTHORIZED',
  );
  return branch;
}
export function remoteGuard(fetchUrls, pushUrls, repository) {
  const allowed = [`https://github.com/${repository}`, `https://github.com/${repository}.git`];
  assert(
    fetchUrls.length > 0 &&
      pushUrls.length > 0 &&
      [...fetchUrls, ...pushUrls].every((url) => allowed.includes(url)),
    'REMOTE_NOT_AUTHORIZED',
  );
}
export function rejectClosingKeywords(...texts) {
  const keyword =
    /\b(?:close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)\b[\s\S]*?(?:#\d+|https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+)/i;
  assert(
    texts.every((text) => typeof text === 'string' && !keyword.test(text)),
    'AUTO_CLOSE_FORBIDDEN',
  );
}
export function reviewCoverage(review, checklist) {
  const coverage = review.acceptanceCoverage;
  assert(
    new Set(coverage.map((x) => x.criterion)).size === coverage.length &&
      checklist.every((c) =>
        coverage.some(
          (x) =>
            x.criterion === c.id &&
            (review.verdict !== 'pass' || (x.covered && x.evidence.length > 0)),
        ),
      ),
    'REVIEW_CHECKLIST_INCOMPLETE',
  );
}
export function runProvenance(run, thread, expected, loopId) {
  const p = thread.invocation.trigger.payload;
  assert(
    run.id === expected.runId &&
      run.loopId === loopId &&
      run.status === 'succeeded' &&
      run.outcome === 'success' &&
      p.repository === expected.repository &&
      p.issueNumber === expected.issueNumber &&
      p.task?.id === expected.taskId &&
      JSON.stringify(p.checklist) === JSON.stringify(expected.checklist),
    'RUN_PROVENANCE_MISMATCH',
  );
  return p;
}
export function boundReview(run, thread, expected, loopId, implementation, config) {
  const payload = runProvenance(run, thread, expected, loopId);
  assert(
    JSON.stringify(payload.implementation) === JSON.stringify(implementation),
    'REVIEW_IMPLEMENTATION_MISMATCH',
  );
  validateReview(run.result, implementation, config, expected.checklist);
  assert(run.result.verdict === 'pass', 'REVIEW_NOT_PASSED');
  return run.result;
}
export function boundQa(run, thread, expected, loopId, mergeSha) {
  const payload = runProvenance(run, thread, expected, loopId);
  assert(
    payload.prCi?.mergeSha === mergeSha &&
      run.result.qa.executionSha === mergeSha &&
      run.result.qa.qaRunId === expected.runId,
    'CLOSURE_QA_MERGE_OR_RUN_MISMATCH',
  );
  return run.result.qa;
}
export function repositoryGuard(repository, allowed) {
  assert(
    repository === allowed && repository === 'Jacob-J-Thomas/gg-aidlc-scratch',
    'REPOSITORY_NOT_AUTHORIZED',
  );
}
export function safeFile(root, relative) {
  assert(typeof relative === 'string' && !path.isAbsolute(relative), 'PROOF_PATH_INVALID');
  const result = path.resolve(root, relative);
  assert(result.startsWith(path.resolve(root) + path.sep), 'PROOF_PATH_ESCAPE');
  let current = result;
  while (current !== path.resolve(root)) {
    if (fs.existsSync(current))
      assert(!fs.lstatSync(current).isSymbolicLink(), 'PROOF_LINK_FORBIDDEN');
    current = path.dirname(current);
  }
  return result;
}
export function verifyProof(root, evidence) {
  assert(Array.isArray(evidence) && evidence.length > 0, 'PROOF_MISSING');
  for (const item of evidence) {
    const file = safeFile(root, item.path);
    assert(
      fs.existsSync(file) && fs.statSync(file).isFile() && fs.statSync(file).size > 0,
      'PROOF_EMPTY',
    );
    assert(hash(fs.readFileSync(file)) === item.sha256, 'PROOF_HASH_MISMATCH');
  }
}
export function validatePlan(plan, checklist, maxTasks) {
  assert(plan.status === 'ready', 'PLAN_NOT_READY');
  assert(JSON.stringify(plan.checklist) === JSON.stringify(checklist), 'CHECKLIST_CHANGED');
  assert(plan.tasks.length > 0 && plan.tasks.length <= maxTasks, 'TASK_BOUND');
  const seen = new Set();
  for (const task of plan.tasks) {
    assert(/^[a-z0-9-]+$/.test(task.id) && !seen.has(task.id), 'TASK_ID_INVALID');
    assert(
      task.dependsOn.every((id) => seen.has(id)),
      'TASK_DEPENDENCY_NOT_PREVIOUS',
    );
    assert(task.acceptanceCriteria.length > 0, 'TASK_ACCEPTANCE_EMPTY');
    seen.add(task.id);
  }
}
export function exactChecks(head, required, checks, statuses = []) {
  return required.map((name) => {
    const matches = checks.filter((c) => c.name === name && c.head_sha === head);
    const statusMatches = statuses.filter((x) => x.context === name && x.sha === head);
    const states = [
      ...matches.map((c) =>
        c.status !== 'completed'
          ? 'pending'
          : c.conclusion === 'success'
            ? 'pass'
            : c.conclusion === 'cancelled'
              ? 'cancelled'
              : 'fail',
      ),
      ...statusMatches.map((s) =>
        s.state === 'success' ? 'pass' : s.state === 'pending' ? 'pending' : 'fail',
      ),
    ];
    const state = states.includes('fail')
      ? 'fail'
      : states.includes('cancelled')
        ? 'cancelled'
        : states.includes('pending')
          ? 'pending'
          : states.length > 1
            ? 'fail'
            : (states[0] ?? 'missing');
    return { name, sha: head, state, evidence: [] };
  });
}
export function validateReview(review, implementation, config, checklist) {
  assert(review.reviewedHeadSha === implementation.headSha, 'REVIEW_STALE_HEAD');
  const role = config.roles[config.familyMap[implementation.implementer.family]];
  assert(
    role &&
      review.implementerFamily === implementation.implementer.family &&
      review.reviewerFamily === role.family,
    'REVIEW_FAMILY_MISMATCH',
  );
  assert(
    config.mode === 'codex-only' || role.family !== implementation.implementer.family,
    'SAME_FAMILY_FORBIDDEN',
  );
  assert(
    new Set(review.findings.map((f) => f.id)).size === review.findings.length,
    'DUPLICATE_FINDING',
  );
  for (const f of review.findings) {
    if (['wont-fix', 'future-issue'].includes(f.disposition))
      assert(f.rationale.trim().length > 0, 'DISPOSITION_RATIONALE_REQUIRED');
    if (f.disposition === 'wont-fix')
      assert(config.policy.allowedWontFixIds.includes(f.id), 'EXCEPTION_NOT_AUTHORIZED');
    if (f.disposition === 'future-issue')
      assert(
        f.severity === 'nonblocking' && config.policy.allowNonblockingFutureIssues,
        'BLOCKING_DEFERRAL_FORBIDDEN',
      );
  }
  if (review.verdict === 'pass') {
    assert(
      review.acceptanceCoverage.length > 0 && review.acceptanceCoverage.every((x) => x.covered),
      'REVIEW_COVERAGE_INCOMPLETE',
    );
    assert(
      !review.findings.some(
        (f) =>
          (f.disposition === 'fix-now' && f.state !== 'fixed') ||
          (f.severity === 'blocking' && f.state !== 'fixed' && f.disposition !== 'wont-fix'),
      ),
      'REVIEW_UNRESOLVED',
    );
  }
  if (checklist) reviewCoverage(review, checklist);
}
export function validateQa(qa, mergeSha, checklist, root, context) {
  assert(qa.executionSha === mergeSha && sha(mergeSha), 'QA_STALE_SHA');
  assert(
    context &&
      qa.repository === context.repository &&
      qa.issueNumber === context.issueNumber &&
      qa.taskId === context.taskId &&
      qa.qaRunId === context.qaRunId,
    'QA_CONTEXT_MISMATCH',
  );
  assert(qa.checklistHash === hash(JSON.stringify(checklist)), 'QA_CHECKLIST_MISMATCH');
  assert(new Set(qa.results.map((x) => x.id)).size === qa.results.length, 'QA_DUPLICATE_RESULT');
  for (const c of checklist) {
    const result = qa.results.find((x) => x.id === c.id);
    assert(result, 'QA_CRITERION_MISSING');
    verifyProof(root, result.evidence);
    for (const evidence of result.evidence) {
      assert(
        evidence.executionSha === mergeSha &&
          evidence.qaRunId === context.qaRunId &&
          evidence.criterionId === c.id,
        'QA_EVIDENCE_BINDING_MISMATCH',
      );
      assert(
        context.checkEvidence?.some(
          (trusted) => JSON.stringify(trusted) === JSON.stringify(evidence),
        ),
        'QA_ARTIFACT_NOT_FROM_CHECK_EXECUTION',
      );
      const actual = JSON.parse(fs.readFileSync(safeFile(root, evidence.path), 'utf8'));
      assert(
        actual.repository === context.repository &&
          actual.issueNumber === context.issueNumber &&
          actual.taskId === context.taskId &&
          actual.executionSha === mergeSha &&
          actual.qaRunId === context.qaRunId &&
          actual.criterionId === c.id &&
          actual.sandbox === 'unsandboxed-explicit' &&
          context.allowUnsandboxedChecks === true &&
          Number.isInteger(actual.exitCode),
        'QA_ARTIFACT_PROVENANCE_MISMATCH',
      );
      if (qa.verdict === 'pass') assert(actual.exitCode === 0, 'QA_CHECK_COMMAND_FAILED');
    }
    if (qa.verdict === 'pass') assert(result.status === 'pass', 'QA_FALSE_PASS');
  }
  assert(qa.proofComplete, 'QA_PROOF_INCOMPLETE');
}
