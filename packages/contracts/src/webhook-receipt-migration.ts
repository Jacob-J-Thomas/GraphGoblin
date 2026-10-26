// Frozen inputs to current-format migration 0015 (#246), independent of live delivery policy.
// These describe only its webhook receipts; historical definition formats remain unsupported.
import { z } from 'zod';

const channel = z.strictObject({
  kind: z.literal('webhook'),
  url: z.url(),
  secretRef: z.string().max(128).optional(),
});
const base = {
  runId: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),
  seq: z.number().int().positive(),
  ts: z.iso.datetime({ offset: true }),
};
export const PreJournalWebhookDeliveredReceiptSchema = z.strictObject({
  ...base,
  type: z.literal('return.delivered'),
  channel,
  target: z.string().max(4096).optional(),
});
export const PreJournalWebhookFailedReceiptSchema = z.strictObject({
  ...base,
  type: z.literal('return.failed'),
  channel,
  error: z.string().max(4000),
});
