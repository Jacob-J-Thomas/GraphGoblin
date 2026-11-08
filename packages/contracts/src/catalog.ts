import { z } from 'zod';
import { EffortSchema, ModelNameSchema, TimestampSchema } from './common.js';

export const ModelCatalogAvailabilitySchema = z.strictObject({
  state: z.enum(['available', 'missing', 'unsupported']),
  checkedAt: TimestampSchema,
  reason: z.string().max(512).optional(),
});
export type ModelCatalogAvailability = z.infer<typeof ModelCatalogAvailabilitySchema>;

/** Ownership of catalog metadata; enabled is always an owner preference. */
export const ModelCatalogSourceSchema = z.enum(['harness', 'litellm']);
export const ModelCatalogEntrySchema = z.object({
  harness: z.string(),
  model: ModelNameSchema,
  source: ModelCatalogSourceSchema,
  displayName: z.string(),
  efforts: z.array(EffortSchema),
  defaultEffort: EffortSchema,
  enabled: z.boolean(),
  availability: ModelCatalogAvailabilitySchema.optional(),
});
export type ModelCatalogEntry = z.infer<typeof ModelCatalogEntrySchema>;
