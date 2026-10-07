import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const hash = (value) => createHash('sha256').update(value).digest('hex');
export const assert = (ok, reason) => {
  if (!ok) throw new Error(reason);
};
export const sha = (value) => /^[a-f0-9]{40}$/.test(value);
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
    matches.sort((a, b) => b.id - a.id);
    const c = matches[0];
    const s = statuses.find((x) => x.context === name && x.sha === head);
    const state = c
      ? c.status !== 'completed'
        ? 'pending'
        : c.conclusion === 'success'
          ? 'pass'
          : c.conclusion === 'cancelled'
            ? 'cancelled'
            : 'fail'
      : s
        ? s.state === 'success'
          ? 'pass'
          : s.state === 'pending'
            ? 'pending'
            : 'fail'
        : 'missing';
    return { name, sha: head, state, evidence: [] };
  });
}
export function validateReview(review, implementation, config) {
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
}
export function validateQa(qa, mergeSha, checklist, root) {
  assert(qa.executionSha === mergeSha && sha(mergeSha), 'QA_STALE_SHA');
  assert(qa.checklistHash === hash(JSON.stringify(checklist)), 'QA_CHECKLIST_MISMATCH');
  assert(new Set(qa.results.map((x) => x.id)).size === qa.results.length, 'QA_DUPLICATE_RESULT');
  for (const c of checklist) {
    const result = qa.results.find((x) => x.id === c.id);
    assert(result, 'QA_CRITERION_MISSING');
    verifyProof(root, result.evidence);
    if (qa.verdict === 'pass') assert(result.status === 'pass', 'QA_FALSE_PASS');
  }
  assert(qa.proofComplete, 'QA_PROOF_INCOMPLETE');
}
