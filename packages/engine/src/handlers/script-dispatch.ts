import type { RunEvent, RunFailure } from '@graphgoblin/contracts';
import { RunFailureError } from '../errors.js';

export const SCRIPT_UNCERTAIN_MESSAGE =
  'The previous script attempt may already have produced its effect. Its outcome was not recorded. Resume runs the script again and may repeat that effect; Replay starts a new run from this node.';

/** A failure disposes a dispatch only when it records that exact script attempt. */
function matches(failure: RunFailure, nodeId: string, visitId: string, dispatchId?: string) {
  return (
    failure.nodeId === nodeId &&
    failure.script?.visitId === visitId &&
    failure.script.dispatchId === dispatchId
  );
}

function visitEvidence(events: readonly RunEvent[], runId: string, nodeId: string) {
  let firstStarted: number | undefined;
  let pending: Extract<RunEvent, { type: 'script.dispatched' }> | undefined;
  let unfinishedStart = false;
  let interrupted = false;
  for (const event of events) {
    if (event.type === 'node.finished' && event.nodeId === nodeId) {
      firstStarted = undefined;
      pending = undefined;
      unfinishedStart = false;
      interrupted = false;
    } else if (event.type === 'node.started' && event.nodeId === nodeId) {
      firstStarted ??= event.seq;
      // The executor appends a start for this entry before invoking the handler. A previous
      // unfinished start is ambiguous even without a marker (including pre-#321 histories).
      interrupted ||= unfinishedStart;
      unfinishedStart = true;
    } else if (event.type === 'script.dispatched' && event.nodeId === nodeId) {
      pending = event;
    } else if (
      event.type === 'run.failed' &&
      (!pending || matches(event.failure, nodeId, pending.visitId, pending.dispatchId))
    ) {
      pending = undefined;
      unfinishedStart = false;
      interrupted = false;
    }
  }
  if (firstStarted === undefined) throw new Error('Script visit has no node.started event');
  return { visitId: `${runId}:${firstStarted}`, pending, interrupted };
}

function uncertain(nodeId: string, evidence: ReturnType<typeof visitEvidence>) {
  return new RunFailureError('SCRIPT_OUTCOME_UNCERTAIN', SCRIPT_UNCERTAIN_MESSAGE, {
    nodeId,
    script: {
      visitId: evidence.pending?.visitId ?? evidence.visitId,
      ...(evidence.pending ? { dispatchId: evidence.pending.dispatchId } : {}),
      state: 'outcome-uncertain',
    },
  });
}

/** A fresh entry is safe; an interrupted entry needs a recorded outcome and explicit retry. */
export function scriptVisit(events: readonly RunEvent[], runId: string, nodeId: string) {
  const evidence = visitEvidence(events, runId, nodeId);
  if (evidence.pending || evidence.interrupted) throw uncertain(nodeId, evidence);
  return evidence.visitId;
}

/** Preserve uncertainty when progress/completion persistence escapes either executor catch. */
export function classifyScriptFailure(
  events: readonly RunEvent[],
  runId: string,
  failure: RunFailure,
): RunFailure {
  const lastNode = events.findLast(
    (event) => event.type === 'node.started' || event.type === 'node.finished',
  );
  if (lastNode?.type !== 'node.started' || lastNode.kind !== 'script') return failure;
  const evidence = visitEvidence(events, runId, lastNode.nodeId);
  if (
    (evidence.pending || evidence.interrupted) &&
    !matches(
      failure,
      lastNode.nodeId,
      evidence.pending?.visitId ?? evidence.visitId,
      evidence.pending?.dispatchId,
    )
  ) {
    const uncertainty = uncertain(lastNode.nodeId, evidence).toFailure();
    // Stop/deadline policy remains non-resumable even when the script's external effect is
    // uncertain. Keep both the authoritative cause and its dispatch evidence.
    if (failure.code === 'RUN_INTERRUPTED_BY_STOP' || failure.code === 'RUN_DEADLINE_EXCEEDED')
      return { ...failure, script: uncertainty.script };
    return uncertainty;
  }
  return failure;
}
