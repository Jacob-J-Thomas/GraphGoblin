import { LoopDefinitionSchema, type LoopDefinition } from '@graphgoblin/contracts';
import { DomainError } from './errors.js';
import { validateLoop } from './graph.js';

export class TemplateBundleError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('TEMPLATE_INVALID_BUNDLE', message, details);
  }
}
/** Shipped starting points are manual workflows, without packaged repository effects. */
export function validateTemplateDraft(input: unknown): LoopDefinition {
  const parsed = LoopDefinitionSchema.safeParse(input);
  if (!parsed.success)
    throw new TemplateBundleError('template draft schema is invalid', parsed.error.issues);
  const definition = parsed.data;
  const errors = validateLoop(definition).filter((issue) => issue.severity === 'error');
  if (errors.length) throw new TemplateBundleError('template draft graph is invalid', errors);
  requireIntegrity(
    definition.nodes.every((node) =>
      node.kind === 'trigger'
        ? node.config.subtype === 'manual'
        : node.kind !== 'script' && node.kind !== 'subloop' && node.kind !== 'heartbeat',
    ),
    'template drafts must be manual workflows without scripts, subloops or heartbeat probes',
  );
  requireIntegrity(
    definition.nodes.every(
      (node) =>
        node.kind !== 'exit' ||
        node.config.destinations.every((channel) => channel.kind === 'caller'),
    ),
    'template drafts must return results only to the caller',
  );
  return definition;
}

function requireIntegrity(condition: unknown, message: string): asserts condition {
  if (!condition) throw new TemplateBundleError(message);
}
