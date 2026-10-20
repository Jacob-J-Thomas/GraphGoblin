import { z } from 'zod';
import { TimestampSchema } from './common.js';
import { WebhookReturnChannelSchema } from './thread.js';

export const DeliveryErrorSchema = z.strictObject({
  code: z.enum([
    'invalid_destination',
    'http',
    'connection_refused',
    'timeout',
    'transport',
    'interrupted',
    'historical_failure',
  ]),
  message: z.string().max(4000),
  retryable: z.boolean(),
  acknowledgement: z.enum(['unknown', 'not_sent', 'rejected']),
  httpStatus: z.number().int().min(100).max(599).optional(),
});
export type DeliveryError = z.infer<typeof DeliveryErrorSchema>;

/** A webhook's execution-independent delivery journal projection. */
export const WebhookDeliverySchema = z.strictObject({
  id: z.string().min(1).max(128),
  channel: WebhookReturnChannelSchema,
  status: z.enum(['pending', 'delivered', 'failed']),
  attempts: z.number().int().min(0).max(5),
  maxAttempts: z.number().int().min(1).max(5),
  inFlight: z.boolean(),
  acknowledgement: z.enum(['accepted', 'unknown', 'not_sent', 'rejected']),
  /** Sticky: an uncertain earlier attempt remains uncertain after a later acknowledgement. */
  effectMayHaveHappened: z.boolean(),
  nextAttemptAt: TimestampSchema.optional(),
  lastError: DeliveryErrorSchema.optional(),
});
export type WebhookDelivery = z.infer<typeof WebhookDeliverySchema>;

export type WebhookAttemptResult = { ok: true } | { ok: false; error: DeliveryError };
