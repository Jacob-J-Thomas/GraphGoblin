import { z } from 'zod';
import {
  JsonValueSchema,
  TemplateManifestSchema,
  TemplateSettingsSchema,
  UlidSchema,
  type LoopDefinition,
} from '@graphgoblin/contracts';
import { stableHash } from '@graphgoblin/domain';
import { TemplateError } from './errors.js';
export const TemplateBindingSchema = z.strictObject({
  instanceId: UlidSchema,
  ownerId: z.string().min(1),
  manifest: TemplateManifestSchema,
  settings: TemplateSettingsSchema,
  loops: z.array(
    z.strictObject({
      key: z.string(),
      loopId: UlidSchema,
      versionId: UlidSchema,
      hash: z.string(),
      nodes: z.record(z.string(), z.strictObject({ kind: z.string(), configHash: z.string() })),
    }),
  ),
  support: z.strictObject({ path: z.string(), hash: z.string() }).optional(),
});
export type TemplateBinding = z.infer<typeof TemplateBindingSchema>;
export function executionHash(definition: LoopDefinition): string {
  return stableHash({
    settings: definition.settings,
    variables: definition.variables,
    nodes: definition.nodes.map(({ id, kind, config }) => ({ id, kind, config })),
    edges: definition.edges.map(({ id, from, to }) => ({ id, from, to })),
  });
}
export function bindingJson(binding: TemplateBinding) {
  return JsonValueSchema.parse(binding);
}
export function assertBoundVersion(
  binding: TemplateBinding,
  loopId: string,
  versionId: string,
  definition: LoopDefinition,
) {
  const bound = binding.loops.find((loop) => loop.loopId === loopId);
  if (!bound || bound.versionId !== versionId || bound.hash !== executionHash(definition))
    throw new TemplateError(
      'TEMPLATE_BINDING_CHANGED',
      'This template definition differs from its immutable instance binding; instantiate a new template.',
    );
  return bound;
}
