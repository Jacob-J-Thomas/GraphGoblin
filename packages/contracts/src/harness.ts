import { z } from 'zod';
import { EffortSchema, ModelNameSchema } from './common.js';
/** Native Windows tool restrictions; these facts do not establish OS/read-path confinement. */
export const ClaudePolicySchema = z.strictObject({
  sandbox: z.enum(['read-only', 'danger-full-access']),
  approval: z.literal('never'),
  permissionMode: z.literal('dontAsk'),
  tools: z.array(z.string()).max(6).readonly(),
  authMethod: z.literal('claude.ai'),
  billingMode: z.literal('claude.ai-account'),
  billingStatus: z.literal('account-dependent'),
  boundary: z.enum(['builtin-tools', 'unconfined']),
  network: z.literal('unconfined'),
});
export type ClaudePolicy = z.infer<typeof ClaudePolicySchema>;
/** Read-only adapter capabilities; enabled catalog preferences cannot authorize paid usage. */
export const ClaudeModelCapabilitySchema = z.strictObject({
  model: ModelNameSchema,
  efforts: z.array(EffortSchema).min(1).max(6),
  admission: z.enum(['supported', 'blocked']),
  reasonCode: z.literal('BILLING_UNVERIFIED').nullable(),
  billingStatus: z.enum(['account-dependent', 'unverified']),
});
export type ClaudeModelCapability = z.infer<typeof ClaudeModelCapabilitySchema>;
/** Safe public preflight facts; raw provider/auth status is never part of this response. */
export const HarnessPreflightSchema = z.strictObject({
  ok: z.boolean(),
  version: z.string().optional(),
  authenticated: z.boolean(),
  problems: z.array(z.string()),
  authMethod: z.literal('claude.ai').nullable().optional(),
  billingMode: z.literal('claude.ai-account').optional(),
  billingStatus: z.literal('account-dependent').optional(),
  supportedPolicies: z.array(ClaudePolicySchema).max(2).optional(),
  models: z.array(ClaudeModelCapabilitySchema).max(16).optional(),
});
export type HarnessPreflight = z.infer<typeof HarnessPreflightSchema>;
