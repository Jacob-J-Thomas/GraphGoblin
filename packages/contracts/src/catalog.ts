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

/** API validation issues include optional field paths for warnings and errors. */
export const LoopIssueSchema = z.object({
  code: z.string(),
  severity: z.enum(['error', 'warning']),
  message: z.string(),
  nodeId: z.string().optional(),
  edgeId: z.string().optional(),
  path: z.string().optional(),
});
export type LoopIssue = z.infer<typeof LoopIssueSchema>;
