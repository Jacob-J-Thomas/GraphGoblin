import type { RunEvent } from '@graphgoblin/contracts';
import { RunFailureError } from '../errors.js';

export const SCRIPT_UNCERTAIN_MESSAGE =
  'The previous script attempt may already have produced its effect. Its outcome was not recorded. Resume runs the script again and may repeat that effect; Replay starts a new run from this node.';

/**
 * A node.finished ends a visit; run.failed disposes an attempt without ending that visit.
 * Only an explicit resume can leave the failure. A later interrupted dispatch is uncertain
 * again, even if an earlier dispatch on the same visit has a recorded disposition.
 */
export function scriptVisit(events: readonly RunEvent[], runId: string, nodeId: string) {
  let firstStarted: number | undefined;
  let pending: Extract<RunEvent, { type: 'script.dispatched' }> | undefined;
  for (const event of events) {
    if (event.type === 'node.finished' && event.nodeId === nodeId) {
      firstStarted = undefined;
      pending = undefined;
    } else if (event.type === 'node.started' && event.nodeId === nodeId) {
      firstStarted ??= event.seq;
    } else if (event.type === 'script.dispatched' && event.nodeId === nodeId) {
      pending = event;
    } else if (event.type === 'run.failed') {
      pending = undefined;
    }
  }
  if (pending) {
    throw new RunFailureError('SCRIPT_OUTCOME_UNCERTAIN', SCRIPT_UNCERTAIN_MESSAGE, {
      nodeId,
      script: {
        visitId: pending.visitId,
        dispatchId: pending.dispatchId,
        state: 'outcome-uncertain',
      },
    });
  }
  if (firstStarted === undefined) throw new Error('Script visit has no node.started event');
  return `${runId}:${firstStarted}`;
}
