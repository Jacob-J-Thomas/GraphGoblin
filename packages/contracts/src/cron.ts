import { z } from 'zod';
import { TimestampSchema } from './common.js';

/** Read-only schedule preview. The API computes slots with the scheduler's implementation. */
export const CronPreviewRequestSchema = z.strictObject({
  expression: z.string().max(256),
  timezone: z.string().max(64),
  count: z.number().int().min(1).max(10).default(5),
  from: TimestampSchema.optional(),
});
export type CronPreviewRequestInput = z.input<typeof CronPreviewRequestSchema>;

export const CronPreviewResponseSchema = z.strictObject({ next: z.array(TimestampSchema) });
