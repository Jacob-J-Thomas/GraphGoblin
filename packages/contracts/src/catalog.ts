import { z } from 'zod';
import { EffortSchema } from './common.js';

/** Ownership of catalog metadata; enabled is always an owner preference. */
export const ModelCatalogSourceSchema = z.enum(['harness', 'litellm']);
export const ModelCatalogEntrySchema = z.object({
  harness: z.string(),
  model: z.string(),
  source: ModelCatalogSourceSchema,
  displayName: z.string(),
  efforts: z.array(EffortSchema),
  defaultEffort: EffortSchema,
  enabled: z.boolean(),
});
export type ModelCatalogEntry = z.infer<typeof ModelCatalogEntrySchema>;
