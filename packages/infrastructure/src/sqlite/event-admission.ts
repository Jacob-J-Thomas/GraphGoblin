import { and, asc, eq, getTableColumns, inArray, lte, sql } from 'drizzle-orm';
import { isJsonValue } from '@graphgoblin/domain';
import {
  AdmissionConflictError,
  assertEventClaim,
  parseRunAdmission,
  type EventAdmissionPort,
  type EventClaim,
  type EventFailureCode,
  type EventReceipt,
  type RunAdmission,
} from '@graphgoblin/engine';
import type { RunRecord } from '@graphgoblin/contracts';
import type { Database } from './db.js';
import { eventReceipts, inboundEvents, runs, webhookReceipts } from './schema.js';

type Row = Omit<typeof eventReceipts.$inferSelect, 'intent'> & { intent: unknown };
const columns = {
  ...getTableColumns(eventReceipts),
  intent: sql<string | null>`${eventReceipts.intent}`,
};
/** Receipt metadata remains readable even when a saved intent is corrupt. */
export class SqliteEventAdmission implements EventAdmissionPort {
  constructor(
    private readonly db: Database,
    readonly create: (intent: RunAdmission, receiptId: string) => Promise<RunRecord>,
  ) {}

  private decode(
    row: Row,
    inbound: typeof inboundEvents.$inferSelect | null,
    includeIntent = true,
  ): EventReceipt {
    if (!inbound) throw new AdmissionConflictError();
    let payload: unknown;
    try {
      payload = JSON.parse(inbound.payload);
    } catch {
      throw new AdmissionConflictError();
    }
    if (!isJsonValue(payload)) throw new AdmissionConflictError();
    let intent: RunAdmission | undefined;
    if (includeIntent && row.intent !== null) {
      try {
        intent = parseRunAdmission(
          typeof row.intent === 'string' ? JSON.parse(row.intent) : row.intent,
        );
      } catch {
        throw new AdmissionConflictError();
      }
    }
    return {
      id: row.id,
      ownerId: row.ownerId,
      loopId: row.loopId,
      versionId: row.versionId,
      triggerNodeId: row.triggerNodeId,
      status: row.status,
      attempts: row.attempts,
      inbound: {
        id: inbound.id,
        ownerId: inbound.ownerId,
        type: inbound.type,
        payload,
        source: inbound.source,
        receivedAt: inbound.receivedAt,
        runIds: inbound.runIds,
        ...(inbound.dedupeKey !== null ? { dedupeKey: inbound.dedupeKey } : {}),
      },
      ...(intent ? { intent } : {}),
      ...(row.nextAttemptAt ? { nextAttemptAt: row.nextAttemptAt } : {}),
      ...(row.failureCode ? { failureCode: row.failureCode } : {}),
    };
  }
  async find(ownerId: string, loopId: string, type: string, key: string, nodeId?: string) {
    const rows = await this.db
      .select({ receipt: columns, inbound: getTableColumns(inboundEvents) })
      .from(eventReceipts)
      .leftJoin(inboundEvents, eq(eventReceipts.inboundId, inboundEvents.id))
      .where(
        and(
          eq(eventReceipts.ownerId, ownerId),
          eq(eventReceipts.loopId, loopId),
          eq(eventReceipts.eventType, type),
          eq(eventReceipts.requestKey, key),
          ...(nodeId ? [eq(eventReceipts.triggerNodeId, nodeId)] : []),
        ),
      )
      .limit(2);
    return rows.map((row) => this.decode(row.receipt, row.inbound, false));
  }
  async claim(input: EventClaim, authored: RunAdmission) {
    const intent = parseRunAdmission(authored);
    assertEventClaim(input, intent);
    const result = await this.db.transaction(async (tx) => {
      const key = input.inbound.dedupeKey;
      const [prior] = key
        ? await tx
            .select({ receipt: columns, inbound: getTableColumns(inboundEvents) })
            .from(eventReceipts)
            .leftJoin(inboundEvents, eq(eventReceipts.inboundId, inboundEvents.id))
            .where(
              and(
                eq(eventReceipts.ownerId, input.ownerId),
                eq(eventReceipts.loopId, input.loopId),
                eq(eventReceipts.triggerNodeId, input.triggerNodeId),
                eq(eventReceipts.eventType, input.inbound.type),
                eq(eventReceipts.requestKey, key),
              ),
            )
            .limit(1)
        : [];
      if (prior) return { receipt: this.decode(prior.receipt, prior.inbound), duplicate: true };
      const nodeKey = intent.initialThread.invocation.trigger.dedupeKey;
      const [reserved] = input.nodeDedupeKey
        ? await tx
            .select({ id: eventReceipts.id })
            .from(eventReceipts)
            .where(
              and(
                eq(eventReceipts.ownerId, input.ownerId),
                eq(eventReceipts.loopId, input.loopId),
                eq(eventReceipts.triggerNodeId, input.triggerNodeId),
                eq(eventReceipts.nodeKey, input.nodeDedupeKey),
                inArray(eventReceipts.status, ['pending', 'admitted']),
              ),
            )
            .limit(1)
        : [];
      const [committed] =
        input.nodeDedupeKey && !reserved
          ? await tx
              .select({ id: runs.id })
              .from(runs)
              .where(
                and(
                  eq(runs.ownerId, input.ownerId),
                  eq(runs.loopId, input.loopId),
                  sql`json_extract(${runs.initialThread}, '$.invocation.trigger.nodeId') = ${input.triggerNodeId}`,
                  sql`json_extract(${runs.initialThread}, '$.invocation.trigger.dedupeKey') = ${nodeKey}`,
                ),
              )
              .limit(1)
          : [];
      const [webhook] =
        input.nodeDedupeKey && !reserved && !committed
          ? await tx
              .select({ id: webhookReceipts.id })
              .from(webhookReceipts)
              .innerJoin(inboundEvents, eq(inboundEvents.id, webhookReceipts.inboundId))
              .where(
                and(
                  eq(webhookReceipts.ownerId, input.ownerId),
                  eq(webhookReceipts.loopId, input.loopId),
                  eq(webhookReceipts.triggerNodeId, input.triggerNodeId),
                  eq(inboundEvents.dedupeKey, input.nodeDedupeKey),
                ),
              )
              .limit(1)
          : [];
      const duplicate = !!(reserved || committed || webhook);
      await tx
        .insert(inboundEvents)
        .values({ ...input.inbound, payload: JSON.stringify(input.inbound.payload), runIds: [] });
      const [row] = await tx
        .insert(eventReceipts)
        .values({
          id: input.id,
          ownerId: input.ownerId,
          loopId: input.loopId,
          versionId: input.versionId,
          triggerNodeId: input.triggerNodeId,
          inboundId: input.inbound.id,
          eventType: input.inbound.type,
          requestKey: key ?? null,
          nodeKey: nodeKey ?? null,
          status: duplicate ? 'deduplicated' : 'pending',
          intent: duplicate ? null : intent,
          nextAttemptAt: duplicate ? null : input.inbound.receivedAt,
        })
        .returning();
      if (!row) throw new AdmissionConflictError();
      return {
        receipt: this.decode(row, {
          ...input.inbound,
          payload: JSON.stringify(input.inbound.payload),
          dedupeKey: input.inbound.dedupeKey ?? null,
          runIds: [],
        }),
        duplicate: false,
      };
    });
    return result;
  }
  async get(id: string) {
    const [row] = await this.db
      .select({ receipt: columns, inbound: getTableColumns(inboundEvents) })
      .from(eventReceipts)
      .leftJoin(inboundEvents, eq(eventReceipts.inboundId, inboundEvents.id))
      .where(eq(eventReceipts.id, id));
    return row ? this.decode(row.receipt, row.inbound) : undefined;
  }
  async due(now: string, limit: number) {
    return this.db
      .select({ id: eventReceipts.id, attempts: eventReceipts.attempts })
      .from(eventReceipts)
      .where(and(eq(eventReceipts.status, 'pending'), lte(eventReceipts.nextAttemptAt, now)))
      .orderBy(asc(eventReceipts.nextAttemptAt), asc(eventReceipts.id))
      .limit(Math.max(0, Math.min(5, limit)));
  }
  async failed(id: string, code: EventFailureCode, nextAttemptAt?: string) {
    await this.db
      .update(eventReceipts)
      .set({
        status: nextAttemptAt ? 'pending' : 'failed',
        failureCode: code,
        attempts: sql`${eventReceipts.attempts}+1`,
        nextAttemptAt: nextAttemptAt ?? null,
      })
      .where(and(eq(eventReceipts.id, id), eq(eventReceipts.status, 'pending')));
  }
  async hasPendingPin(loopId: string) {
    const [row] = await this.db
      .select({ id: eventReceipts.id })
      .from(eventReceipts)
      .where(
        and(
          eq(eventReceipts.status, 'pending'),
          sql`EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(${eventReceipts.intent}) THEN ${eventReceipts.intent} ELSE '{}' END, '$.pinnedLoopIds') WHERE value = ${loopId})`,
        ),
      )
      .limit(1);
    return row !== undefined;
  }
}
