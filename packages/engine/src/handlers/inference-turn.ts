import type { PromptProvenance, RunEvent } from '@graphgoblin/contracts';
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
      pending.submission = event.submission;
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
  state: PromptProvenance['submission'],
  marker?: Extract<HarnessEvent, { type: 'submitted' }>['marker'],
): Promise<void> {
  // Once accepted, a later refusal cannot make resending this turn safe.
  pending.submission =
    pending.accepted && state === 'definitely-not-submitted' ? 'delivery-uncertain' : state;
  pending.accepted ||= marker !== undefined;
  await ctx.services.record({
    type: 'harness.submission',
    nodeId: ctx.node.id,
    visitId: pending.turn.visitId,
    turnId: pending.turn.turnId,
    submission: pending.submission,
    ...(marker ? { marker } : {}),
  });
}

export function recoveryFailure(pending: PendingTurn, nodeId: string): RunFailureError {
  const missing = pending.submission === 'session-missing';
  return new RunFailureError(
    missing ? 'HARNESS_SESSION_MISSING' : 'HARNESS_DELIVERY_UNCERTAIN',
    missing
      ? 'The recorded provider session is missing or refused. An explicit fresh-session choice is required.'
      : 'Prompt delivery is uncertain and no provider session was recorded. An explicit owner recovery choice is required.',
    { nodeId, resumable: false, inference: provenance(pending) },
  );
}
