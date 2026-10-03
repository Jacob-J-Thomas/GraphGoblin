import { z } from 'zod';
import {
  ExpressionSchema,
  JsonPointerSchema,
  JsonSchemaSchema,
  RepairPolicySchema,
  TemplateSchema,
  ValueSourceSchema,
} from './common.js';
import { MessageRoleSchema } from './thread.js';

/**
 * Operations that change the context thread. One vocabulary serves the context-mutation node
 * and the input and output transforms of inferencing nodes. See docs/04-node-catalog.md.
 */

const InjectedMessageSchema = z.strictObject({
  role: MessageRoleSchema.default('note'),
  content: TemplateSchema,
  tags: z.array(z.string().max(64)).max(32).optional(),
});
export type InjectedMessage = z.infer<typeof InjectedMessageSchema>;

const MessageSelectionSchema = z.union([
  z.literal('none'),
  z.literal('last'),
  z.literal('all'),
  z.number().int().positive(),
  z.strictObject({ where: ExpressionSchema }),
]);
export type MessageSelection = z.infer<typeof MessageSelectionSchema>;

const CollectionSelectionSchema = z.union([
  z.literal('none'),
  z.literal('all'),
  z.strictObject({ where: ExpressionSchema }),
]);
export type CollectionSelection = z.infer<typeof CollectionSelectionSchema>;

export const MutationOperationSchema = z.discriminatedUnion('op', [
  z.strictObject({
    op: z.literal('set'),
    path: JsonPointerSchema,
    value: ValueSourceSchema,
  }),
  z.strictObject({
    op: z.literal('delete'),
    path: JsonPointerSchema,
  }),
  z.strictObject({
    op: z.literal('append-message'),
    role: MessageRoleSchema.default('note'),
    content: TemplateSchema,
    tags: z.array(z.string().max(64)).max(32).optional(),
  }),
  z.strictObject({
    op: z.literal('inject'),
    position: z.union([z.literal('start'), z.literal('end'), z.number().int().nonnegative()]),
    messages: z.array(InjectedMessageSchema).min(1).max(64),
  }),
  z.strictObject({
    op: z.literal('truncate'),
    keep: z
      .strictObject({
        first: z.number().int().nonnegative().optional(),
        last: z.number().int().nonnegative().optional(),
        maxEstimatedTokens: z.number().int().positive().optional(),
      })
      .refine(
        (k) => k.first !== undefined || k.last !== undefined || k.maxEstimatedTokens !== undefined,
        'truncate.keep needs at least one of first, last, or maxEstimatedTokens',
      ),
    where: ExpressionSchema.optional(),
  }),
  z.strictObject({
    op: z.literal('drop'),
    target: z.enum(['messages', 'artifacts']),
    where: ExpressionSchema,
  }),
  z.strictObject({
    op: z.literal('replace'),
    target: z.enum(['messages', 'vars']),
    where: ExpressionSchema.optional(),
    pattern: z.string().min(1).max(4096),
    flags: z
      .string()
      .regex(/^[gimsuy]*$/)
      .default('g'),
    replacement: z.string().max(4096),
  }),
  z.strictObject({
    op: z.literal('redact'),
    target: z.enum(['messages', 'vars', 'all']).default('all'),
    patterns: z.array(z.string().min(1).max(4096)).min(1).max(64),
    replacement: z.string().max(256).default('[REDACTED]'),
  }),
  z.strictObject({
    op: z.literal('coerce'),
    source: JsonPointerSchema,
    jsonSchema: JsonSchemaSchema,
    repair: RepairPolicySchema.prefault({}),
    target: JsonPointerSchema,
  }),
]);
export type MutationOperation = z.infer<typeof MutationOperationSchema>;
export type MutationOperationInput = z.input<typeof MutationOperationSchema>;

export const MutationListSchema = z.array(MutationOperationSchema).max(128);
export type MutationList = z.infer<typeof MutationListSchema>;

export { MessageSelectionSchema, CollectionSelectionSchema, InjectedMessageSchema };
