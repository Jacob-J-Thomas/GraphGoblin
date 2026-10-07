// Explicit result-only handoffs for the two isolated live negative experiments.
import fs from 'node:fs';
const [mode, source, runId, destination] = process.argv.slice(2);
const response = await fetch(`http://127.0.0.1:4747/runs/${runId}`);
if (!response.ok) throw new Error('RUN_READ_FAILED');
const run = await response.json();
if (run.status !== 'succeeded' || !run.result) throw new Error('CHILD_NOT_SUCCEEDED');
const p = JSON.parse(fs.readFileSync(source));
if (mode === 'review') {
  if (run.result.status !== 'complete') throw new Error('IMPLEMENTATION_NOT_COMPLETE');
  p.implementation = run.result;
} else if (mode === 'fix') {
  if (
    run.result.verdict !== 'changes-required' ||
    run.result.reviewedHeadSha !== p.implementation.headSha
  )
    throw new Error('FEEDBACK_NOT_HEAD_BOUND');
  p.feedback = run.result;
  p.task.description =
    'The controlled fault-injection stage is over. Restore reversed-interval RangeError and its regression test. Address every fix-now finding at the supplied reviewed head, preserving normal and equal-bounds clamping and the locked checklist.';
  p.task.acceptanceCriteria = p.checklist.map((x) => `${x.id}: ${x.expected}`);
  p.reviewHints =
    'This is the repaired candidate. Independently verify the locked checklist and all prior fix-now findings. Pass only if the blocking reversed-interval regression is actually fixed.';
} else throw new Error('HANDOFF_MODE_INVALID');
fs.writeFileSync(destination, JSON.stringify(p, null, 2));
console.log(
  JSON.stringify({
    mode,
    sourceRunId: runId,
    destination,
    headSha: p.implementation.headSha,
    feedbackHeadSha: p.feedback?.reviewedHeadSha,
  }),
);
