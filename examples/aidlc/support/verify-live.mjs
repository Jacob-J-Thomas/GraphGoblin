// Assert observed live acceptance, using captured REST results and owner-process inventory.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const control = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../.tmp/aidlc-control',
);
const ledger = JSON.parse(fs.readFileSync(path.join(control, 'aidlc-live-ledger.json')));
const inventory = JSON.parse(fs.readFileSync(path.join(control, 'aidlc-github-inventory.json')));
const read = (id) => JSON.parse(fs.readFileSync(path.join(control, `aidlc-run-${id}.json`)));
const scenario = (name) => {
  const root = ledger.roots.find((x) => x.scenario === name);
  assert(root, `Missing scenario ${name}`);
  const record = read(root.id);
  assert.equal(record.run.status, 'succeeded');
  return record;
};
const positive = scenario('positive');
assert.equal(positive.run.result.status, 'complete');
assert.deepEqual(positive.run.result.remainingTaskIds, []);
const children = positive.events
  .filter((e) => e.type === 'child_run.started')
  .map((e) => read(e.childRunId));
assert.equal(children.length, 6);
assert(children.every((x) => x.run.status === 'succeeded'));
const merged = children.find((x) => x.run.result?.status === 'merged').run.result;
const qa = children.find((x) => x.run.result?.qa).run.result;
const closed = children.find((x) => x.run.result?.status === 'closed').run.result;
assert.equal(qa.qa.verdict, 'pass');
assert.equal(qa.qa.executionSha, merged.mergeSha);
assert.equal(closed.executionSha, merged.mergeSha);
assert.equal(merged.approvedHeadSha, null);
assert(qa.proofLinks.length >= 2 && qa.qa.proofComplete);
assert(
  inventory.pulls.some(
    (x) =>
      x.number === merged.prNumber &&
      x.merged &&
      x.headSha === merged.headSha &&
      x.mergeSha === merged.mergeSha,
  ),
);
assert.equal(inventory.issues.find((x) => x.url === closed.issueUrl).state, 'closed');
const injection = scenario('fix-now-injection');
const rejection = scenario('fix-now-rejection');
const repair = scenario('fix-now-repair');
const rereview = scenario('fix-now-rereview');
assert.equal(rejection.run.result.verdict, 'changes-required');
assert.equal(rejection.run.result.reviewedHeadSha, injection.run.result.headSha);
assert(rejection.events.some((e) => e.type === 'decision.made' && e.route === 'fix-now'));
assert(
  rejection.run.result.findings.some(
    (x) => x.disposition === 'fix-now' && x.severity === 'blocking',
  ),
);
assert.equal(
  repair.thread.invocation.trigger.payload.feedback.reviewedHeadSha,
  injection.run.result.headSha,
);
assert.notEqual(repair.run.result.headSha, injection.run.result.headSha);
assert.equal(rereview.run.result.reviewedHeadSha, repair.run.result.headSha);
assert.equal(rereview.run.result.verdict, 'pass');
const futureImplementation = scenario('future-issue-implementation');
const future = scenario('future-issue-review');
assert.equal(future.run.result.verdict, 'pass');
assert.equal(future.run.result.reviewedHeadSha, futureImplementation.run.result.headSha);
assert(future.events.some((e) => e.type === 'decision.made' && e.route === 'future-issue'));
const findings = future.run.result.findings.filter((x) => x.disposition === 'future-issue');
assert(findings.length > 0);
for (const f of findings) {
  assert.equal(f.severity, 'nonblocking');
  assert.equal(f.state, 'deferred');
  assert(f.rationale.trim() && f.requestedChange.trim());
  const issue = inventory.issues.find((x) => x.url === f.issueUrl);
  assert(issue && issue.state === 'open' && issue.body.includes('Acceptance criteria:'));
  assert(issue.body.includes(futureImplementation.run.result.headSha));
}
assert(
  inventory.workspaces.every(
    (x) => x.trackedStatus === '' && x.checklistMatchesInput && /\bR\b/.test(x.checklistAttributes),
  ),
);
const results = [
  {
    name: 'positive',
    passed: true,
    runIds: [positive.run.id, ...children.map((x) => x.run.id)],
    prUrls: positive.run.result.prUrls,
    issueUrl: closed.issueUrl,
    headSha: merged.headSha,
    mergeSha: merged.mergeSha,
    proofLinks: qa.proofLinks,
  },
  {
    name: 'fix-now',
    passed: true,
    runIds: [injection, rejection, repair, rereview].map((x) => x.run.id),
    rejectedHeadSha: injection.run.result.headSha,
    repairedHeadSha: repair.run.result.headSha,
    finalVerdict: rereview.run.result.verdict,
  },
  {
    name: 'future-issue',
    passed: true,
    runIds: [futureImplementation.run.id, future.run.id],
    headSha: futureImplementation.run.result.headSha,
    finalVerdict: future.run.result.verdict,
    deferredIssueUrls: findings.map((x) => x.issueUrl),
  },
];
fs.writeFileSync(path.join(control, 'aidlc-scenarios.json'), JSON.stringify(results, null, 2));
console.log(
  JSON.stringify({
    scenarios: results.map((x) => ({ name: x.name, passed: x.passed })),
    counts: ledger.counts,
  }),
);
