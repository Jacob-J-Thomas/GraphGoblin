import type { LoopDefinition, RunEvent } from '@graphgoblin/contracts';
import { stableHash, validateJson } from '@graphgoblin/domain';
import type { TemplateBinding } from '../binding.js';
import { TemplateError } from '../errors.js';
import { ReviewWakeSchema, type ReviewWake } from './review-protocol.js';

/** Only persisted wake events for an immutable mapped input-wait visit grant human/timeout authority. */
export function readReviewWake(
  binding: TemplateBinding,
  loopId: string,
  definition: LoopDefinition,
  events: readonly RunEvent[],
  beforeSeq: number,
): ReviewWake | null {
  if (binding.manifest.kind !== 'review' || binding.manifest.id !== 'review') return null;
  const wake = events.findLast((event) => event.type === 'run.woken' && event.seq < beforeSeq);
  if (wake?.type !== 'run.woken' || !['input', 'timeout'].includes(wake.reason)) return null;
  const node = definition.nodes.find((node) => node.id === wake.nodeId);
  if (
    !node ||
    node.kind !== 'wait' ||
    node.config.mode !== 'input' ||
    !['human-wait', 'human-wait-capped'].includes(node.id) ||
    !node.config.inputSchema
  )
    return null;
  const parked = events.findLast((event) => event.type === 'run.waiting' && event.seq < wake.seq);
  const started = events.findLast(
    (event) => event.type === 'node.started' && event.nodeId === node.id && event.seq < wake.seq,
  );
  const mapped = binding.loops.find((loop) => loop.loopId === loopId)?.nodes[node.id];
  const refuse = () => {
    throw new TemplateError('AUTHORITY_CONFLICT', 'The mapped review wait evidence conflicts.');
  };
  if (
    parked?.type !== 'run.waiting' ||
    parked.nodeId !== node.id ||
    parked.wait.kind !== 'input' ||
    parked.wait.nodeId !== node.id ||
    started?.type !== 'node.started' ||
    started.kind !== 'wait' ||
    started.configHash !== mapped?.configHash ||
    parked.wait.startedSeq !== started.seq
  )
    return refuse();
  if (wake.reason === 'timeout')
    return ReviewWakeSchema.parse({
      reason: 'timeout',
      nodeId: node.id,
      startedSeq: started.seq,
      seq: wake.seq,
    });
  const input = events.find((event) => event.seq === wake.seq - 1);
  if (
    input?.type !== 'input.received' ||
    input.nodeId !== node.id ||
    input.seq < parked.seq ||
    stableHash(input.payload) !== stableHash(wake.payload) ||
    !validateJson(node.config.inputSchema, input.payload).ok
  )
    return refuse();
  return ReviewWakeSchema.parse({
    reason: 'input',
    nodeId: node.id,
    startedSeq: started.seq,
    inputSeq: input.seq,
    seq: wake.seq,
    payload: input.payload,
  });
}
