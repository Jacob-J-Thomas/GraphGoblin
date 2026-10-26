import {
  WebhookDeliverySchema,
  PreJournalWebhookDeliveredReceiptSchema as deliveredReceipt,
  PreJournalWebhookFailedReceiptSchema as failedReceipt,
  type WebhookDelivery,
} from '@graphgoblin/contracts';
import type { Transaction } from '@libsql/client';
import { tableBatches } from './readiness.js';

// Frozen current-format migration identity and receipt shape from before #246. These two
// webhook receipts are all 0015 rewrites; no historical definition/conversion contract is needed.
export const WEBHOOK_JOURNAL_MIGRATION_TIME = 1792454400000;
const envelope = { runId: true, seq: true, ts: true, type: true } as const;
const receipts = [
  { schema: deliveredReceipt, payload: deliveredReceipt.omit(envelope) },
  { schema: failedReceipt, payload: failedReceipt.omit(envelope) },
];

/** One-off 0015 rewrite, inside the same transaction as SQL and its ledger entry.
 * SQLite cannot implement the frozen z.url() or count code points past embedded NULs.
 * Validate the payload separately so stored envelope fields cannot hide unexpected evidence.
 */
export async function convertHistoricalWebhookReceipts(tx: Transaction): Promise<void> {
  for await (const batch of tableBatches(tx, 'run_events', {
    where: "type IN ('return.delivered','return.failed')",
  })) {
    for (const row of batch) {
      const receipt = receipts.find(({ schema }) => schema.shape.type.value === row.type)!;
      let payload: unknown;
      try {
        payload = JSON.parse(String(row.payload));
      } catch {
        continue;
      }
      const parsedPayload = receipt.payload.safeParse(payload);
      if (!parsedPayload.success) continue;
      const parsed = receipt.schema.safeParse({
        ...parsedPayload.data,
        runId: row.run_id,
        seq: row.seq,
        ts: row.ts,
        type: row.type,
        ...(row.node_id === null ? {} : { nodeId: row.node_id }),
      });
      if (!parsed.success) continue;
      const originalPayload = payload as typeof parsedPayload.data;
      const event = parsed.data;
      const failed = event.type === 'return.failed';
      // Validation can normalize a URL. Keep the validated input channel verbatim, like the old
      // SQL rewrite, so receipt evidence and the following pending-channel lookup stay aligned.
      const delivery: WebhookDelivery = {
        id: `${event.runId}:return:${event.seq}`,
        channel: originalPayload.channel,
        status: failed ? 'failed' : 'delivered',
        attempts: 1,
        maxAttempts: 1,
        inFlight: false,
        acknowledgement: failed ? 'unknown' : 'accepted',
        effectMayHaveHappened: true,
        acknowledgementUncertain: failed,
        ...(event.type === 'return.failed'
          ? {
              lastError: {
                code: 'historical_failure',
                message: event.error,
                retryable: false,
                acknowledgement: 'unknown',
              },
            }
          : {}),
      };
      WebhookDeliverySchema.parse(delivery);
      await tx.execute({
        sql: "UPDATE run_events SET type='delivery.finished',payload=? WHERE run_id=? AND seq=?",
        args: [JSON.stringify({ delivery }), event.runId, event.seq],
      });
    }
  }
}
