import type { PromptProvenance, RunEvent, TurnSubmission } from '@graphgoblin/contracts';
import type { NodeContext } from '../handler.js';
import type { HarnessEvent } from '../ports.js';
import { RunFailureError } from '../errors.js';

type Turn = Extract<RunEvent, { type: 'harness.turn' }>;
export interface PendingTurn {
  turn: Pick<Turn, 'visitId' | 'turnId' | 'prompt' | 'promptKind' | 'resumeSessionId' | 'harness'>;
  submission: PromptProvenance['submission'];
  sessionId?: string;
  accepted: boolean;
}

/** The first start since this node last finished identifies one visit across retries/restarts. */
export function visitTurn(
  events: readonly RunEvent[],
  nodeId: string,
): { visitId: string; pending?: PendingTurn } {
  let visitId = '';
  let pending: PendingTurn | undefined;
  for (const event of events) {
    if (!('nodeId' in event) || event.nodeId !== nodeId) continue;
    if (event.type === 'node.finished') {
      visitId = '';
      pending = undefined;
    }
    if (event.type === 'node.started' && !visitId) visitId = event.runId + ':' + event.seq;
    if (event.type === 'harness.turn' && event.visitId === visitId) {
      pending = {
        turn: {
          visitId: event.visitId,
          turnId: event.turnId,
          prompt: event.prompt,
          promptKind: event.promptKind,
          harness: event.harness,
          ...(event.resumeSessionId ? { resumeSessionId: event.resumeSessionId } : {}),
        },
        submission: 'delivery-uncertain',
        accepted: false,
        ...(event.resumeSessionId ? { sessionId: event.resumeSessionId } : {}),
      };
    }
    if (pending && event.type === 'harness.session') pending.sessionId = event.sessionId;
    if (pending && event.type === 'harness.submission' && event.turnId === pending.turn.turnId) {
      pending.submission =
        event.submission === 'submitted' ? 'delivery-uncertain' : event.submission;
      pending.accepted ||= event.marker !== undefined;
    }
  }
  return { visitId, ...(pending ? { pending } : {}) };
}

export function provenance(pending: PendingTurn): PromptProvenance {
  return {
    visitId: pending.turn.visitId,
    turnId: pending.turn.turnId,
    promptKind: pending.turn.promptKind,
    submission: pending.submission,
    ...(pending.sessionId ? { sessionId: pending.sessionId } : {}),
  };
}

export async function submission(
  ctx: NodeContext<'inference'>,
  pending: PendingTurn,
  state: TurnSubmission,
  marker?: Extract<HarnessEvent, { type: 'submitted' }>['marker'],
): Promise<void> {
  // Once accepted, a later refusal cannot make resending this turn safe.
  pending.submission =
    state === 'submitted' || (pending.accepted && state === 'definitely-not-submitted')
      ? 'delivery-uncertain'
      : state;
  await ctx.services.record({
    type: 'harness.submission',
    nodeId: ctx.node.id,
    visitId: pending.turn.visitId,
    turnId: pending.turn.turnId,
    submission: state === 'submitted' ? 'submitted' : pending.submission,
    ...(marker ? { marker } : {}),
  });
  // Recovery eligibility must use durable acceptance, including if this append fails.
  pending.accepted ||= marker !== undefined;
}

/** An inherited handle alone cannot establish this authored task's conversation (D-022). */
export function canContinueTurn(pending: PendingTurn): boolean {
  return (
    !!pending.sessionId &&
    (pending.accepted ||
      pending.turn.promptKind !== 'authored' ||
      pending.sessionId !== pending.turn.resumeSessionId)
  );
}

export function recoveryFailure(pending: PendingTurn, nodeId: string): RunFailureError {
  const missing = pending.submission === 'session-missing';
  return new RunFailureError(
    missing ? 'HARNESS_SESSION_MISSING' : 'HARNESS_DELIVERY_UNCERTAIN',
    missing
      ? 'The recorded provider session is missing or refused. An explicit fresh-session choice is required.'
      : 'Prompt delivery is uncertain and no usable session was established for this task. An inherited conversation without durable acceptance cannot be continued. Use Replay from the node for a deliberate new attempt.',
    { nodeId, resumable: false, inference: provenance(pending) },
  );
}
