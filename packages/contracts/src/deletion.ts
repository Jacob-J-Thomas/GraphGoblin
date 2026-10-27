import { z } from 'zod';
import { TimestampSchema, UlidSchema } from './common.js';

/** A confirmation covers these records only, never future history. */
export const DeletionApprovalSchema = z.strictObject({
  confirmedAt: TimestampSchema,
  confirmedBy: z.strictObject({
    ownerId: z.string().min(1).max(128),
    kind: z.string().min(1).max(128),
    id: z.string().min(1).max(256),
  }),
});
export type DeletionApproval = z.infer<typeof DeletionApprovalSchema>;

export const DeletionSelectionSchema = z.strictObject({
  runIds: z
    .array(UlidSchema)
    .min(1)
    .max(500)
    .refine((ids) => new Set(ids).size === ids.length, 'Select each run only once.'),
});
export const DeletionPreviewSchema = z.strictObject({
  token: z.string().regex(/^[a-f0-9]{64}$/),
  items: z.array(
    z.strictObject({
      runId: UlidSchema,
      approval: DeletionApprovalSchema.optional(),
      reasons: z.array(z.string()),
    }),
  ),
});
export type DeletionPreview = z.infer<typeof DeletionPreviewSchema>;
export const DeletionConfirmationSchema = DeletionSelectionSchema.extend({
  token: z.string().regex(/^[a-f0-9]{64}$/),
  action: z.enum(['mark', 'withdraw']),
  confirmed: z.literal(true),
});
export type DeletionConfirmation = z.infer<typeof DeletionConfirmationSchema>;
