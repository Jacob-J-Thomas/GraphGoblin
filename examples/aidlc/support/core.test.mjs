import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  hash,
  repositoryGuard,
  safeFile,
  verifyProof,
  exactChecks,
  validateQa,
  validateReview,
  validatePlan,
} from './core.mjs';
import { recordsFromEvents } from './attempts.mjs';

test('GitHub guard refuses owner product repository and unapproved destinations', () => {
  assert.throws(
    () => repositoryGuard('Jacob-J-Thomas/GraphGoblin', 'Jacob-J-Thomas/GraphGoblin'),
    /REPOSITORY_NOT_AUTHORIZED/,
  );
  repositoryGuard('Jacob-J-Thomas/gg-aidlc-scratch', 'Jacob-J-Thomas/gg-aidlc-scratch');
});
test('required CI checks every run on the exact head; missing and skipped never pass', () => {
  const head = 'a'.repeat(40);
  const checks = [
    { id: 1, name: 'aidlc-test', head_sha: head, status: 'completed', conclusion: 'success' },
    { id: 2, name: 'aidlc-test', head_sha: head, status: 'completed', conclusion: 'failure' },
  ];
  assert.equal(exactChecks(head, ['aidlc-test'], checks)[0].state, 'fail');
  assert.equal(exactChecks('b'.repeat(40), ['aidlc-test'], checks)[0].state, 'missing');
  assert.equal(
    exactChecks(head, ['aidlc-test'], [{ ...checks[0], conclusion: 'skipped' }])[0].state,
    'fail',
  );
});
test('proof and QA reject changed bytes, traversal, wrong SHA, missing criterion and false pass', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aidlc-proof-test-'));
  const file = path.join(root, 'aidlc-proof.txt');
  const head = 'a'.repeat(40);
  const context = {
    repository: 'Jacob-J-Thomas/gg-aidlc-scratch',
    issueNumber: 1,
    taskId: 'aidlc-task',
    qaRunId: 'aidlc-qa',
    allowUnsandboxedChecks: true,
  };
  const contents = JSON.stringify({
    ...context,
    executionSha: head,
    criterionId: 'required',
    sandbox: 'unsandboxed-explicit',
    exitCode: 0,
  });
  fs.writeFileSync(file, contents);
  const evidence = [
    {
      path: 'aidlc-proof.txt',
      sha256: hash(contents),
      kind: 'log',
      executionSha: head,
      qaRunId: context.qaRunId,
      criterionId: 'required',
    },
  ];
  context.checkEvidence = evidence;
  verifyProof(root, evidence);
  assert.throws(() => safeFile(root, '../elsewhere'), /ESCAPE/);
  const checklist = [{ id: 'required' }];
  const qa = {
    ...context,
    verdict: 'pass',
    executionSha: head,
    checklistHash: hash(JSON.stringify(checklist)),
    results: [{ id: 'required', status: 'pass', evidence }],
    proofComplete: true,
  };
  validateQa(qa, head, checklist, root, context);
  assert.throws(() => validateQa(qa, 'b'.repeat(40), checklist, root, context), /STALE/);
  assert.throws(
    () => validateQa({ ...qa, results: [] }, head, checklist, root, context),
    /MISSING/,
  );
  assert.throws(
    () =>
      validateQa(
        { ...qa, results: [{ ...qa.results[0], status: 'fail' }] },
        head,
        checklist,
        root,
        context,
      ),
    /FALSE_PASS/,
  );
  fs.writeFileSync(file, 'changed');
  assert.throws(() => verifyProof(root, evidence), /HASH_MISMATCH/);
});
test('family policy, stale reviews and blocking exceptions fail closed', () => {
  const implementation = { headSha: 'a'.repeat(40), implementer: { family: 'openai' } };
  const config = {
    mode: 'codex-only',
    familyMap: { openai: 'reviewer' },
    roles: { reviewer: { family: 'openai' } },
    policy: { allowedWontFixIds: [], allowNonblockingFutureIssues: true },
  };
  const review = {
    verdict: 'pass',
    reviewedHeadSha: implementation.headSha,
    implementerFamily: 'openai',
    reviewerFamily: 'openai',
    acceptanceCoverage: [{ covered: true }],
    findings: [],
  };
  validateReview(review, implementation, config);
  assert.throws(
    () => validateReview(review, implementation, { ...config, mode: 'full' }),
    /SAME_FAMILY/,
  );
  assert.throws(
    () => validateReview({ ...review, reviewedHeadSha: 'b'.repeat(40) }, implementation, config),
    /STALE_HEAD/,
  );
  assert.throws(
    () =>
      validateReview(
        {
          ...review,
          findings: [
            { id: 'x', severity: 'blocking', disposition: 'future-issue', rationale: 'later' },
          ],
        },
        implementation,
        config,
      ),
    /BLOCKING_DEFERRAL/,
  );
  assert.throws(
    () =>
      validateReview(
        {
          ...review,
          findings: [{ id: 'x', severity: 'blocking', disposition: 'wont-fix', rationale: 'skip' }],
        },
        implementation,
        config,
      ),
    /EXCEPTION_NOT_AUTHORIZED/,
  );
});
test('plans preserve locked criteria and bounded acyclic dependency order', () => {
  const checklist = [{ id: 'x' }];
  const plan = {
    status: 'ready',
    checklist,
    tasks: [{ id: 'first', acceptanceCriteria: ['x'], dependsOn: [] }],
  };
  validatePlan(plan, checklist, 1);
  assert.throws(() => validatePlan({ ...plan, checklist: [] }, checklist, 1), /CHANGED/);
  assert.throws(
    () =>
      validatePlan({ ...plan, tasks: [{ ...plan.tasks[0], dependsOn: ['future'] }] }, checklist, 1),
    /DEPENDENCY/,
  );
});
test('attempt reader uses persisted node outputs, ignoring comments and inbound event prose', () => {
  const record = {
    repository: 'Jacob-J-Thomas/gg-aidlc-scratch',
    issueNumber: 1,
    attempt: 2,
    runId: 'aidlc-run',
  };
  const events = [
    { type: 'node.progress', seq: 1, progress: 'Issue comment says attempt 999' },
    {
      type: 'node.finished',
      seq: 2,
      patch: [{ op: 'add', path: '/outputs/attempt-record', value: { value: record } }],
    },
  ];
  assert.deepEqual(recordsFromEvents(events), [{ ...record, seq: 2 }]);
});
