import { z } from 'zod';

/** Installation-local catalog id. `jev` is reserved for the system-managed built-in. */
export const ClassifierModelIdSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/);
export const ClassifierSecretRefSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/);
export const ClassifierPrimitiveSchema = z.enum(['choice', 'noul', 'score']);
export const ClassifierPrimitivesSchema = z
  .array(ClassifierPrimitiveSchema)
  .min(1)
  .max(3)
  .refine((values) => new Set(values).size === values.length, 'primitives must be unique');
export const ClassifierEndpointSchema = z
  .url({ protocol: /^https?$/ })
  .max(4096)
  .refine(
    (value) => /^https?:\/\/[^/?#@]+(?:\/[^?#]*)?$/i.test(value),
    'endpoint must be an HTTP(S) API root without credentials, query, or fragment',
  );

const Metadata = {
  displayName: z.string().trim().min(1).max(120),
  providerModel: z.string().trim().min(1).max(256),
  primitives: ClassifierPrimitivesSchema,
  endpoint: ClassifierEndpointSchema,
  secretRef: ClassifierSecretRefSchema.optional(),
};

export const ClassifierModelEntrySchema = z
  .strictObject({
    id: ClassifierModelIdSchema,
    ...Metadata,
    source: z.enum(['builtin', 'custom']),
    provider: z.enum(['typesafe', 'http']),
    enabled: z.boolean(),
  })
  .refine(
    (entry) =>
      entry.source === 'builtin'
        ? entry.id === 'jev' && entry.provider === 'typesafe'
        : entry.id !== 'jev' && entry.provider === 'http',
    'jev/typesafe is system-managed; custom entries must use HTTP and another id',
  );

export const ClassifierModelSummarySchema = ClassifierModelEntrySchema.safeExtend({
  configured: z.boolean(),
  configurationReason: z.string().optional(),
});
/** PUT replaces custom metadata; credentials, ownership, and enabled state are never input. */
export const ClassifierModelPutSchema = z.strictObject({
  ...Metadata,
  provider: z.literal('http'),
});
export const ClassifierModelPatchSchema = z.strictObject({ enabled: z.boolean() });

/** Minimum Choice response; providers may attach model and usage metadata. */
export const ClassifierChoiceResponseSchema = z.object({
  model: z.string().optional(),
  usage: z.unknown().optional(),
  answers: z.object({
    answer: z.object({
      type: z.literal('choice'),
      choice: z.string(),
      confidence: z.number().min(0).max(1).optional(),
      probabilities: z.record(z.string(), z.number().min(0).max(1)),
    }),
  }),
});

export type ClassifierModelId = z.infer<typeof ClassifierModelIdSchema>;
export type ClassifierModelEntry = z.infer<typeof ClassifierModelEntrySchema>;
export type ClassifierModelSummary = z.infer<typeof ClassifierModelSummarySchema>;
export type ClassifierModelPut = z.infer<typeof ClassifierModelPutSchema>;
