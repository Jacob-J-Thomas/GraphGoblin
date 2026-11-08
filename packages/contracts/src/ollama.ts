import { z } from 'zod';
import { EffortSchema, ModelNameSchema, TimestampSchema } from './common.js';
import { ModelCatalogAvailabilitySchema } from './catalog.js';

/** Fixed-endpoint HTTP service origin; credentials and arbitrary endpoint paths are unsupported. */
export const OllamaBaseUrlSchema = z
  .url({ protocol: /^https?$/ })
  .refine(
    (value) => /^https?:\/\/(?:\[[0-9a-fA-F:.]+\]|[^/@?#:]+)(?::[0-9]+)?\/?$/i.test(value),
    'Ollama URL must be an HTTP(S) origin without credentials, path, query or fragment',
  );
export const OllamaConnectionUpdateSchema = z.strictObject({
  enabled: z.boolean(),
  baseUrl: OllamaBaseUrlSchema,
});
export type OllamaConnectionUpdate = z.infer<typeof OllamaConnectionUpdateSchema>;
export const OllamaConnectionSchema = OllamaConnectionUpdateSchema.extend({
  revision: z.number().int().positive(),
});
export type OllamaConnection = z.infer<typeof OllamaConnectionSchema>;
export const OllamaDiscoveryErrorSchema = z.strictObject({
  code: z.string().min(1).max(100),
  message: z.string().min(1).max(512),
});
export const OllamaDiscoveryStatusSchema = z.strictObject({
  state: z.enum(['idle', 'refreshing', 'ready', 'error']),
  lastAttemptAt: TimestampSchema.optional(),
  lastSuccessAt: TimestampSchema.optional(),
  error: OllamaDiscoveryErrorSchema.optional(),
});
export type OllamaDiscoveryStatus = z.infer<typeof OllamaDiscoveryStatusSchema>;
export const OllamaConnectionViewSchema = z.strictObject({
  connection: OllamaConnectionSchema,
  discovery: OllamaDiscoveryStatusSchema,
});
export type OllamaConnectionView = z.infer<typeof OllamaConnectionViewSchema>;
export const OllamaModelDiscoverySchema = z.strictObject({
  model: ModelNameSchema,
  digest: z.string().min(1).max(256),
  connectionRevision: z.number().int().positive(),
  availability: ModelCatalogAvailabilitySchema,
  thinkingByEffort: z.partialRecord(
    EffortSchema,
    z.union([z.literal(false), z.string().min(1).max(32)]),
  ),
});
export type OllamaModelDiscovery = z.infer<typeof OllamaModelDiscoverySchema>;
