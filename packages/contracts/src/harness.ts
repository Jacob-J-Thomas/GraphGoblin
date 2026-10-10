import { z } from 'zod';
import { EffortSchema, ModelNameSchema } from './common.js';
/** Native Windows tool restrictions; these facts do not establish OS/read-path confinement. */
export const ClaudePolicySchema = z.strictObject({
  sandbox: z.enum(['read-only', 'danger-full-access']),
  approval: z.literal('never'),
  permissionMode: z.literal('dontAsk'),
  tools: z.array(z.string()).max(6).readonly(),
  authMethod: z.literal('claude.ai'),
  boundary: z.enum(['builtin-tools', 'unconfined']),
  network: z.literal('unconfined'),
});
export type ClaudePolicy = z.infer<typeof ClaudePolicySchema>;
/** Exact model identities and requested efforts supported by the adapter. */
export const ClaudeModelCapabilitySchema = z.strictObject({
  model: ModelNameSchema,
  efforts: z.array(EffortSchema).min(1).max(6),
});
export type ClaudeModelCapability = z.infer<typeof ClaudeModelCapabilitySchema>;
/** Safe public preflight facts; raw provider/auth status is never part of this response. */
export const HarnessPreflightSchema = z.strictObject({
  ok: z.boolean(),
  version: z.string().optional(),
  authenticated: z.boolean(),
  problems: z.array(z.string()),
  authMethod: z.literal('claude.ai').nullable().optional(),
  supportedPolicies: z.array(ClaudePolicySchema).max(2).optional(),
  models: z.array(ClaudeModelCapabilitySchema).max(16).optional(),
});
export type HarnessPreflight = z.infer<typeof HarnessPreflightSchema>;
