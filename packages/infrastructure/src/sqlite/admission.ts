import { ContextThreadSchema, RunEventSchema, RunRecordSchema } from '@graphgoblin/contracts';
import { stableStringify } from '@graphgoblin/domain';
import {
  AdmissionConflictError,
  assertAdmissionIdentity,
  assertWebhookClaim,
  parseRunAdmission,
  pollAdmissionIdentity,
  queuedEvent,
  type RunAdmission,
  type TriggerAdmissionPort,
  type WebhookClaim,
  type WebhookReceipt,
  type WebhookFailureCode,
} from '@graphgoblin/engine';
import { and, asc, eq, getTableColumns, lte, sql } from 'drizzle-orm';
import type { Database } from './db.js';
import { inboundEvents, runEvents, runs, webhookReceipts } from './schema.js';
import { runInsert, runRecordFromRow } from './runs.js';
import type { SqliteEventStore } from './events.js';

function runKeyScope(ownerId: string, loopId: string, nodeId: string, key: string) {
  return and(
    eq(runs.ownerId, ownerId),
    eq(runs.loopId, loopId),
    sql`json_extract(${runs.initialThread}, '$.invocation.trigger.nodeId') = ${nodeId}`,
    sql`json_extract(${runs.initialThread}, '$.invocation.trigger.dedupeKey') = ${key}`,
  );
}
type ReceiptRow = typeof webhookReceipts.$inferSelect;
function receiptOf(row: ReceiptRow): WebhookReceipt {
  return {
    id: row.id,
    ownerId: row.ownerId,
    loopId: row.loopId,
    triggerNodeId: row.triggerNodeId,
    contentHash: row.contentHash,
    inboundId: row.inboundId,
    status: row.status,
    attempts: row.attempts,
    ...(row.intent ? { intent: parseRunAdmission(row.intent) } : {}),
    ...(row.nextAttemptAt ? { nextAttemptAt: row.nextAttemptAt } : {}),
    ...(row.failureCode ? { failureCode: row.failureCode } : {}),
  };
}
/** Run row, first event, receipt state and inbound link commit together. */
export class SqliteTriggerAdmission implements TriggerAdmissionPort {
  constructor(
    private readonly db: Database,
    private readonly events: SqliteEventStore,
  ) {}
  async create(authored: RunAdmission, receiptId?: string) {
    const run = await this.commit(authored, receiptId);
    if (!run) throw new AdmissionConflictError();
    return run;
  }
  createPollItem(authored: RunAdmission) {
    return this.commit(authored, undefined, true);
  }
  private async commit(authored: RunAdmission, receiptId?: string, pollItem = false) {
    const input = parseRunAdmission(authored);
    const poll = pollItem ? pollAdmissionIdentity(input) : undefined;
    const committed = await this.db.transaction(async (tx) => {
      if (poll) {
        const [runKey] = await tx
          .select({ id: runs.id })
          .from(runs)
          .where(runKeyScope(input.run.ownerId, input.run.loopId, poll.nodeId, poll.dedupeKey))
          .limit(1);
        const [pendingKey] = runKey
          ? []
          : await tx
              .select({ id: webhookReceipts.id })
              .from(webhookReceipts)
              .where(
                and(
                  eq(webhookReceipts.ownerId, input.run.ownerId),
                  eq(webhookReceipts.loopId, input.run.loopId),
                  eq(webhookReceipts.triggerNodeId, poll.nodeId),
                  eq(webhookReceipts.status, 'pending'),
                  sql`json_extract(${webhookReceipts.intent}, '$.initialThread.invocation.trigger.dedupeKey') = ${poll.dedupeKey}`,
                ),
              )
              .limit(1);
        if (runKey || pendingKey) return { run: undefined, event: undefined };
      }
      if (receiptId) {
        const [receipt] = await tx
          .select()
          .from(webhookReceipts)
          .where(eq(webhookReceipts.id, receiptId));
        if (
          !receipt ||
          !['pending', 'admitted'].includes(receipt.status) ||
          !receipt.intent ||
          stableStringify(parseRunAdmission(receipt.intent)) !== stableStringify(input)
        )
          throw new AdmissionConflictError();
        const [inbound] = await tx
          .select({ id: inboundEvents.id })
          .from(inboundEvents)
          .where(eq(inboundEvents.id, receipt.inboundId));
        if (!inbound) throw new AdmissionConflictError();
      }
      const [prior] = await tx.select().from(runs).where(eq(runs.id, input.run.id));
      const [first] = await tx
        .select()
        .from(runEvents)
        .where(eq(runEvents.runId, input.run.id))
        .orderBy(asc(runEvents.seq))
        .limit(1);
      let run;
      let event;
      if (prior) {
        const stored = first
          ? RunEventSchema.safeParse({
              ...first.payload,
              runId: first.runId,
              seq: first.seq,
              ts: first.ts,
              type: first.type,
              ...(first.nodeId ? { nodeId: first.nodeId } : {}),
            })
          : undefined;
        const record = RunRecordSchema.safeParse(runRecordFromRow(prior));
        const thread = ContextThreadSchema.safeParse(prior.initialThread);
        if (!stored?.success || !record.success || !thread.success)
          throw new AdmissionConflictError();
        run = record.data;
        assertAdmissionIdentity(input, run, thread.data, stored.data);
      } else {
        if (first) throw new AdmissionConflictError();
        run = { ...input.run, lastEventSeq: 1 };
        event = queuedEvent(input);
        await tx.insert(runs).values(runInsert(run, input.initialThread));
        const { runId, seq, ts, type, ...payload } = event;
        await tx.insert(runEvents).values({ runId, seq, ts, type, payload });
      }
      if (receiptId) {
        const [receipt] = await tx
          .update(webhookReceipts)
          .set({ status: 'admitted', nextAttemptAt: null, failureCode: null })
          .where(eq(webhookReceipts.id, receiptId))
          .returning();
        if (!receipt) throw new AdmissionConflictError();
        await tx
          .update(inboundEvents)
          .set({ runIds: [run.id] })
          .where(eq(inboundEvents.id, receipt.inboundId));
      }
      return { run, event };
    });
    if (committed.event) this.events.notifyCommitted([committed.event]);
    return committed.run;
  }
  async claim(
    input: WebhookClaim,
    intent?: RunAdmission,
  ): Promise<{ receipt: WebhookReceipt; duplicate: boolean }> {
    const frozen = intent ? parseRunAdmission(intent) : undefined;
    assertWebhookClaim(input, frozen);
    return this.db.transaction(async (tx) => {
      const [prior] = await tx
        .select()
        .from(webhookReceipts)
        .where(
          and(
            eq(webhookReceipts.ownerId, input.ownerId),
            eq(webhookReceipts.loopId, input.loopId),
            eq(webhookReceipts.triggerNodeId, input.triggerNodeId),
            eq(webhookReceipts.contentHash, input.contentHash),
          ),
        );
      if (prior) return { receipt: receiptOf(prior), duplicate: true };
      // Raw content is checked first. A new body always gets its own consumed receipt, even
      // when its authored identity was filtered or failed before any run existed.
      let keySeen = false;
      if (input.dedupeByKey && input.inbound.dedupeKey) {
        const [receiptKey] = await tx
          .select({ id: webhookReceipts.id })
          .from(webhookReceipts)
          .innerJoin(inboundEvents, eq(webhookReceipts.inboundId, inboundEvents.id))
          .where(
            and(
              eq(webhookReceipts.ownerId, input.ownerId),
              eq(webhookReceipts.loopId, input.loopId),
              eq(webhookReceipts.triggerNodeId, input.triggerNodeId),
              eq(inboundEvents.dedupeKey, input.inbound.dedupeKey),
            ),
          )
          .limit(1);
        const [runKey] = receiptKey
          ? []
          : await tx
              .select({ id: runs.id })
              .from(runs)
              .where(
                runKeyScope(
                  input.ownerId,
                  input.loopId,
                  input.triggerNodeId,
                  input.inbound.dedupeKey,
                ),
              )
              .limit(1);
        keySeen = receiptKey !== undefined || runKey !== undefined;
      }
      await tx
        .insert(inboundEvents)
        .values({ ...input.inbound, payload: JSON.stringify(input.inbound.payload), runIds: [] });
      const [row] = await tx
        .insert(webhookReceipts)
        .values({
          id: input.id,
          ownerId: input.ownerId,
          loopId: input.loopId,
          triggerNodeId: input.triggerNodeId,
          contentHash: input.contentHash,
          inboundId: input.inbound.id,
          status: keySeen ? 'deduplicated' : frozen ? 'pending' : 'filtered',
          intent: keySeen ? null : (frozen ?? null),
          attempts: 0,
          nextAttemptAt: !keySeen && frozen ? input.inbound.receivedAt : null,
        })
        .returning();
      if (!row) throw new AdmissionConflictError();
      return { receipt: receiptOf(row), duplicate: false };
    });
  }
  async get(id: string): Promise<WebhookReceipt | undefined> {
    const [row] = await this.db
      .select({
        ...getTableColumns(webhookReceipts),
        intent: sql<string | null>`${webhookReceipts.intent}`,
      })
      .from(webhookReceipts)
      .where(eq(webhookReceipts.id, id));
    if (!row) return undefined;
    let intent: RunAdmission | null = null;
    if (row.intent !== null) {
      try {
        intent = parseRunAdmission(JSON.parse(row.intent));
      } catch {
        throw new AdmissionConflictError();
      }
    }
    return receiptOf({ ...row, intent });
  }
  async due(now: string, limit: number): Promise<Pick<WebhookReceipt, 'id' | 'attempts'>[]> {
    const rows = await this.db
      .select({ id: webhookReceipts.id, attempts: webhookReceipts.attempts })
      .from(webhookReceipts)
      .where(and(eq(webhookReceipts.status, 'pending'), lte(webhookReceipts.nextAttemptAt, now)))
      .orderBy(asc(webhookReceipts.nextAttemptAt), asc(webhookReceipts.id))
      .limit(Math.max(0, Math.min(5, limit)));
    return rows;
  }
  async failed(id: string, code: WebhookFailureCode, nextAttemptAt?: string): Promise<void> {
    await this.db
      .update(webhookReceipts)
      .set({
        status: nextAttemptAt ? 'pending' : 'failed',
        failureCode: code,
        attempts: sql`${webhookReceipts.attempts}+1`,
        nextAttemptAt: nextAttemptAt ?? null,
      })
      .where(and(eq(webhookReceipts.id, id), eq(webhookReceipts.status, 'pending')));
  }
  async hasPendingPin(loopId: string): Promise<boolean> {
    const [found] = await this.db
      .select({ id: webhookReceipts.id })
      .from(webhookReceipts)
      .where(
        and(
          eq(webhookReceipts.status, 'pending'),
          sql`EXISTS (SELECT 1 FROM json_each(${webhookReceipts.intent}, '$.pinnedLoopIds') WHERE value = ${loopId})`,
        ),
      )
      .limit(1);
    return found !== undefined;
  }
}
