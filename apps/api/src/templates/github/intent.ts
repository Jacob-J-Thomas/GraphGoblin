import { z } from 'zod';
import { NodeOutputSchema, type LoopDefinition, type RunEvent } from '@graphgoblin/contracts';
import type { TemplateBinding } from '../binding.js';
import { TemplateError } from '../errors.js';
import { ShaSchema } from './protocol.js';
export const PrIntentSchema = z.strictObject({
  type: z.literal('PrIntent'),
  head: ShaSchema,
  branch: z.string().min(1).max(255),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(65536),
});
/** Only the paired immutable pr-intent script output may justify a remote-effect report. */
export function readImplementationIntent(
  binding: TemplateBinding,
  loopId: string,
  definition: LoopDefinition,
  events: readonly RunEvent[],
) {
  const bound = binding.loops.find((loop) => loop.loopId === loopId);
  const pending = new Map<string, Extract<RunEvent, { type: 'node.started' }>>();
  const intents: ReturnType<typeof PrIntentSchema.parse>[] = [];
  for (const event of events) {
    if (event.type === 'node.started') {
      pending.set(event.nodeId, event);
      continue;
    }
    if (event.type !== 'node.finished') continue;
    const started = pending.get(event.nodeId);
    pending.delete(event.nodeId);
    const node = definition.nodes.find((node) => node.id === event.nodeId);
    if (
      node?.kind !== 'script' ||
      node.config.command !== 'graphgoblin-template-support' ||
      node.config.args.length !== 1 ||
      node.config.args[0] !== 'pr-intent'
    )
      continue;
    if (
      !started ||
      started.kind !== 'script' ||
      started.configHash !== bound?.nodes[node.id]?.configHash
    )
      throw new TemplateError('AUTHORITY_CONFLICT', 'PR intent provenance conflicts.');
    const operation = event.patch.find(
      (op) => (op.op === 'add' || op.op === 'replace') && op.path === '/outputs/' + node.id,
    );
    if (!operation || !('value' in operation))
      throw new TemplateError('AUTHORITY_CONFLICT', 'PR intent output is missing.');
    const output = NodeOutputSchema.parse(operation.value);
    if (output.nodeId !== node.id)
      throw new TemplateError('AUTHORITY_CONFLICT', 'PR intent output identity conflicts.');
    // A refused intent is not a license to create or report a remote effect.
    const intent = PrIntentSchema.safeParse(output.value);
    if (intent.success) intents.push(intent.data);
    else if (!(
      output.value &&
      typeof output.value === 'object' &&
      !Array.isArray(output.value) &&
      output.value['type'] === 'SupportBlocked'
    ))
      throw new TemplateError('AUTHORITY_CONFLICT', 'PR intent output is invalid.');
  }
  if (intents.length > 1)
    throw new TemplateError('AUTHORITY_CONFLICT', 'PR intent history conflicts.');
  return intents[0];
}
