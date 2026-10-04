import { z } from 'zod';
import { HarnessIdSchema } from './common.js';
import { LoopDefinitionSchema, LoopExportSchema, LoopSettingsSchema } from './loop.js';
import { InferenceConfigSchema, NodeSchema } from './nodes.js';

/** Internal normalisation shared with tests that exercise future harness inheritance. */
export function resolveLegacyHarness<
  T extends {
    settings: { defaults: { harness?: string | undefined } };
    nodes: { kind: string; config: Record<string, unknown> }[];
  },
>(input: T) {
  const { harness, ...defaults } = input.settings.defaults;
  return {
    ...input,
    settings: { ...input.settings, defaults },
    nodes: input.nodes.map((node) =>
      node.kind === 'inference' && node.config['harness'] === undefined && harness !== undefined
        ? { ...node, config: { ...node.config, harness } }
        : node,
    ),
  };
}

// No harness default here: omission must survive until legacy inheritance is resolved.
const CompatibilityNodeSchema = z.discriminatedUnion('kind', [
  NodeSchema.options[2].extend({
    config: InferenceConfigSchema.extend({ harness: HarnessIdSchema.optional() }),
  }),
  ...NodeSchema.options.filter((_, index) => index !== 2),
]);

/** Accept deprecated loop harness input, then return only the canonical definition. */
export const LoopDefinitionCompatibilitySchema = LoopDefinitionSchema.extend({
  settings: LoopSettingsSchema.extend({
    defaults: LoopSettingsSchema.shape.defaults
      .unwrap()
      .extend({
        harness: HarnessIdSchema.optional().meta({
          deprecated: true,
          description: 'Legacy input only; inherited by inference nodes without a harness.',
        }),
      })
      .prefault({}),
  }).prefault({}),
  nodes: z.array(CompatibilityNodeSchema).min(1).max(500),
})
  .transform((input): unknown => resolveLegacyHarness(input))
  .pipe(LoopDefinitionSchema);

/** Portable input envelope; responses and exports use the canonical LoopExportSchema. */
export const LoopExportCompatibilitySchema = LoopExportSchema.extend({
  loop: LoopDefinitionCompatibilitySchema,
});
