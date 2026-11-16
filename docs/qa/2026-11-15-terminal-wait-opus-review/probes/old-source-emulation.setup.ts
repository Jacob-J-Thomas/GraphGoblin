// Review probe (#410 scan 1). Not product code; lives outside the checkout.
// With PROBE_EMULATE_PRE_410=1 it reproduces the exact pre-#410 arguments of the two edited call
// sites (failRun and the run.failed branch of completeFromLog): both passed a `status: 'failed'`
// change object WITHOUT an own `waiting` member. Candidate source adds `waiting: undefined`; this
// shim removes only that explicitly present undefined member, and only for failed transitions.
import { InMemoryRunRepository } from 'C:/Users/98jak/.codex/worktrees/gg-20261115-runtime/GraphGoblin/packages/engine/src/testing/fakes.ts';

const emulate = process.env.PROBE_EMULATE_PRE_410 === '1';
process.stderr.write(`[probe] setup loaded; emulate pre-#410 failed projection = ${emulate}\n`);

if (emulate) {
  const proto = InMemoryRunRepository.prototype;
  const original = proto.transition;
  proto.transition = function (this: InMemoryRunRepository, runId, from, changes, ...rest) {
    if (
      changes &&
      changes.status === 'failed' &&
      Object.hasOwn(changes, 'waiting') &&
      changes.waiting === undefined
    ) {
      const { waiting: _dropped, ...preFix } = changes;
      process.stderr.write(`[probe] stripped explicit waiting member from failed transition of ${runId}\n`);
      return original.call(this, runId, from, preFix, ...rest);
    }
    return original.call(this, runId, from, changes, ...rest);
  } as typeof original;
}
