import { z } from 'zod';

/** Crockford base32 ULID, 26 characters. All persisted entity ids use this. */
export const UlidSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'must be a ULID');
export type Ulid = z.infer<typeof UlidSchema>;

/** Identifier for nodes, ports, routes, variables, and other names authored inside a loop. */
export const SlugSchema = z
  .string()
  .regex(
    /^[A-Za-z][A-Za-z0-9_-]{0,63}$/,
    'must start with a letter and use letters, digits, _ or -',
  );
export type Slug = z.infer<typeof SlugSchema>;

/** UTC ISO-8601 timestamp. */
export const TimestampSchema = z.iso.datetime({ offset: true });
export type Timestamp = z.infer<typeof TimestampSchema>;

/** Any JSON-encodable value. */
export const JsonValueSchema = z.json();
export type JsonValue = z.infer<typeof JsonValueSchema>;

/** A JSON Schema document. Kept loose on purpose; validated by a JSON Schema validator in domain. */
export const JsonSchemaSchema = z.record(z.string(), z.unknown());
export type JsonSchema = z.infer<typeof JsonSchemaSchema>;

/** A LiquidJS template string. Rendered against a view of the context thread. */
export const TemplateSchema = z.string().max(100_000);
export type Template = z.infer<typeof TemplateSchema>;

/** A JSONata expression string. Evaluated against the context thread or a documented view. */
export const ExpressionSchema = z.string().min(1).max(100_000);
export type Expression = z.infer<typeof ExpressionSchema>;

/** RFC 6901 JSON Pointer. */
export const JsonPointerSchema = z
  .string()
  .regex(/^(\/([^/~]|~0|~1)*)*$/, 'must be an RFC 6901 JSON Pointer');
export type JsonPointer = z.infer<typeof JsonPointerSchema>;

/** Canonical reasoning-effort scale. Adapters map it onto what their harness accepts. */
export const EffortSchema = z.enum(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
export type Effort = z.infer<typeof EffortSchema>;

/** Harness families; models and native session ids remain scoped to the selected family. */
export const HarnessIdSchema = z.enum(['codex', 'claude']);
export type HarnessId = z.infer<typeof HarnessIdSchema>;

/** Shared bound for configured model names and the execution evidence that records them. */
export const MAX_MODEL_NAME_LENGTH = 256;
export const ModelNameSchema = z.string().min(1).max(MAX_MODEL_NAME_LENGTH);

/**
 * How a value that fails schema validation is repaired.
 * Used by inferencing-node output schemas and by the `coerce` mutation operation.
 */
export const RepairPolicySchema = z.strictObject({
  enabled: z.boolean().default(true),
  maxAttempts: z.number().int().min(0).max(10).default(1),
  prompt: TemplateSchema.optional(),
  onFailure: z.enum(['fail-run', 'continue-raw']).default('fail-run'),
});
export type RepairPolicy = z.infer<typeof RepairPolicySchema>;
export type RepairPolicyInput = z.input<typeof RepairPolicySchema>;

/**
 * A value source used wherever configuration may be literal, templated, or computed.
 */
export const ValueSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('literal'), value: JsonValueSchema }),
  z.strictObject({ kind: z.literal('template'), template: TemplateSchema }),
  z.strictObject({ kind: z.literal('expression'), jsonata: ExpressionSchema }),
]);
export type ValueSource = z.infer<typeof ValueSourceSchema>;
