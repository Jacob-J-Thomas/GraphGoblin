import type { JsonValue } from '@graphgoblin/contracts';
import type { ClockPort, IdPort } from '@graphgoblin/engine';
import { and, asc, desc, eq, gte, inArray, lt, lte, ne, sql, type SQL } from 'drizzle-orm';
import type {
  ScheduleAdvance,
  ScheduleRecord,
  ScheduleStore,
} from '../scheduler/schedule-store.js';
import type { Database } from './db.js';
import { inboundEvents, schedules, webhookEndpoints, webhookReceipts } from './schema.js';

// -----------------------------------------------------------------------------
// Schedules
// -----------------------------------------------------------------------------

type ScheduleRow = typeof schedules.$inferSelect;

function toSchedule(row: ScheduleRow): ScheduleRecord {
  return {
    id: row.id,
    ownerId: row.ownerId,
    loopId: row.loopId,
    versionId: row.versionId,
    triggerNodeId: row.triggerNodeId,
    expression: row.expression,
    timezone: row.timezone,
    missedFirePolicy: row.missedFirePolicy,
    enabled: row.enabled,
    ...(row.nextFireAt ? { nextFireAt: row.nextFireAt } : {}),
    ...(row.lastFiredAt ? { lastFiredAt: row.lastFiredAt } : {}),
    createdAt: row.createdAt,
  };
}

/** What the trigger service asks for, one per cron trigger node of a published version. */
export interface ScheduleDraft {
  ownerId: string;
  triggerNodeId: string;
  expression: string;
  timezone: string;
  missedFirePolicy: ScheduleRecord['missedFirePolicy'];
  enabled: boolean;
  nextFireAt: string | undefined;
}

/** Cron schedules in the `schedules` table. Satisfies the scheduler's `ScheduleStore`. */
export class SqliteScheduleStore implements ScheduleStore {
  constructor(
    private readonly db: Database,
    private readonly clock: ClockPort,
    private readonly ids: IdPort,
  ) {}

  /**
   * Make `versionId` the loop's armed version: rows of every other version are disabled, and a row
   * is inserted for each draft whose trigger node has none yet. Existing rows of the version keep
   * their next fire time, so re-arming at boot does not hide missed fires.
   */
  async replaceForVersion(
    loopId: string,
    versionId: string,
    drafts: readonly ScheduleDraft[],
  ): Promise<ScheduleRecord[]> {
    const now = this.clock.now().toISOString();
    await this.db.transaction(async (tx) => {
      await tx
        .update(schedules)
        .set({ enabled: false })
        .where(and(eq(schedules.loopId, loopId), ne(schedules.versionId, versionId)));
      const existing = await tx
        .select({ triggerNodeId: schedules.triggerNodeId })
        .from(schedules)
        .where(and(eq(schedules.loopId, loopId), eq(schedules.versionId, versionId)));
      const have = new Set(existing.map((r) => r.triggerNodeId));
      const rows = drafts
        .filter((d) => !have.has(d.triggerNodeId))
        .map((d) => ({
          id: this.ids.next(),
          ownerId: d.ownerId,
          loopId,
          versionId,
          triggerNodeId: d.triggerNodeId,
          expression: d.expression,
          timezone: d.timezone,
          missedFirePolicy: d.missedFirePolicy,
          enabled: d.enabled,
          nextFireAt: d.nextFireAt ?? null,
          createdAt: now,
        }));
      if (rows.length > 0) await tx.insert(schedules).values(rows);
    });
    return this.listForLoop(loopId);
  }

  /** Every row of a loop, armed version first. */
  async listForLoop(loopId: string): Promise<ScheduleRecord[]> {
    const rows = await this.db
      .select()
      .from(schedules)
      .where(eq(schedules.loopId, loopId))
      .orderBy(desc(schedules.enabled), desc(schedules.createdAt), asc(schedules.triggerNodeId));
    return rows.map(toSchedule);
  }

  async disableLoop(loopId: string): Promise<void> {
    await this.db.update(schedules).set({ enabled: false }).where(eq(schedules.loopId, loopId));
  }

  async listEnabled(): Promise<ScheduleRecord[]> {
    const rows = await this.db
      .select()
      .from(schedules)
      .where(eq(schedules.enabled, true))
      .orderBy(asc(schedules.createdAt));
    return rows.map(toSchedule);
  }

  async listDue(now: Date, limit = 100): Promise<ScheduleRecord[]> {
    const rows = await this.db
      .select()
      .from(schedules)
      .where(and(eq(schedules.enabled, true), lte(schedules.nextFireAt, now.toISOString())))
      .orderBy(asc(schedules.nextFireAt))
      .limit(limit);
    return rows.map(toSchedule);
  }

  async markFired(id: string, advance: ScheduleAdvance): Promise<void> {
    await this.db
      .update(schedules)
      .set({
        nextFireAt: advance.nextFireAt ?? null,
        ...(advance.lastFiredAt ? { lastFiredAt: advance.lastFiredAt } : {}),
      })
      .where(eq(schedules.id, id));
  }
}

// -----------------------------------------------------------------------------
// Webhook endpoints
// -----------------------------------------------------------------------------

export interface WebhookEndpointRecord {
  id: string;
  ownerId: string;
  loopId: string;
  versionId: string;
  triggerNodeId: string;
  token: string;
  secretRef: string;
  signatureHeader: string;
  signatureScheme: 'hmac-sha256' | 'hmac-sha256-body';
  replayWindowSeconds: number | null;
  enabled: boolean;
  createdAt: string;
}

export interface WebhookEndpointDraft {
  ownerId: string;
  triggerNodeId: string;
  secretRef: string;
  signatureHeader: string;
  signatureScheme: 'hmac-sha256' | 'hmac-sha256-body';
  replayWindowSeconds: number | null;
}

type EndpointRow = typeof webhookEndpoints.$inferSelect;

function toEndpoint(row: EndpointRow): WebhookEndpointRecord {
  return { ...row };
}

/** Webhook receivers in the `webhook_endpoints` table. */
export class SqliteWebhookEndpoints {
  constructor(
    private readonly db: Database,
    private readonly clock: ClockPort,
    private readonly ids: IdPort,
  ) {}

  /**
   * Make `versionId` the loop's armed version: rows of every other version are disabled, and a row
   * is inserted for each draft whose trigger node has none yet. A trigger node keeps its token
   * across versions, so publishing does not change the public URL; `newToken` mints one for a
   * trigger node seen for the first time.
   */
  async replaceForVersion(
    loopId: string,
    versionId: string,
    drafts: readonly WebhookEndpointDraft[],
    newToken: () => string,
  ): Promise<WebhookEndpointRecord[]> {
    const now = this.clock.now().toISOString();
    await this.db.transaction(async (tx) => {
      await tx
        .update(webhookEndpoints)
        .set({ enabled: false })
        .where(and(eq(webhookEndpoints.loopId, loopId), ne(webhookEndpoints.versionId, versionId)));
      const previous = await tx
        .select()
        .from(webhookEndpoints)
        .where(eq(webhookEndpoints.loopId, loopId))
        .orderBy(desc(webhookEndpoints.createdAt));
      const current = new Set(
        previous.filter((r) => r.versionId === versionId).map((r) => r.triggerNodeId),
      );
      const tokens = new Map<string, string>();
      for (const row of previous) {
        if (!tokens.has(row.triggerNodeId)) tokens.set(row.triggerNodeId, row.token);
      }
      const rows = drafts
        .filter((d) => !current.has(d.triggerNodeId))
        .map((d) => ({
          id: this.ids.next(),
          ownerId: d.ownerId,
          loopId,
          versionId,
          triggerNodeId: d.triggerNodeId,
          token: tokens.get(d.triggerNodeId) ?? newToken(),
          secretRef: d.secretRef,
          signatureHeader: d.signatureHeader,
          signatureScheme: d.signatureScheme,
          replayWindowSeconds: d.replayWindowSeconds,
          enabled: true,
          createdAt: now,
        }));
      if (rows.length > 0) await tx.insert(webhookEndpoints).values(rows);
    });
    return this.listForLoop(loopId);
  }

  /** The endpoint behind a token: the enabled row when there is one, else the newest disabled row. */
  async findByToken(token: string): Promise<WebhookEndpointRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.token, token))
      .orderBy(desc(webhookEndpoints.enabled), desc(webhookEndpoints.createdAt))
      .limit(1);
    return row ? toEndpoint(row) : undefined;
  }

  async listForLoop(loopId: string): Promise<WebhookEndpointRecord[]> {
    const rows = await this.db
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.loopId, loopId))
      .orderBy(
        desc(webhookEndpoints.enabled),
        desc(webhookEndpoints.createdAt),
        asc(webhookEndpoints.triggerNodeId),
      );
    return rows.map(toEndpoint);
  }

  async disableLoop(loopId: string): Promise<void> {
    await this.db
      .update(webhookEndpoints)
      .set({ enabled: false })
      .where(eq(webhookEndpoints.loopId, loopId));
  }
}

// -----------------------------------------------------------------------------
// Inbound events
// -----------------------------------------------------------------------------

export interface InboundEventRecord {
  id: string;
  ownerId: string;
  type: string;
  payload: JsonValue;
  dedupeKey?: string;
  /** `api`, `run:<runId>`, or `webhook:<endpointId>`. */
  source: string;
  receivedAt: string;
  /** Runs this event started; empty when it was filtered out or matched nothing. */
  runIds: string[];
  delivery?: {
    state: 'filtered' | 'deduplicated' | 'pending' | 'admitted' | 'failed';
    attempts: number;
    nextAttemptAt?: string;
    failureCode?: string;
  };
}

export interface InboundEventDedupeQuery {
  ownerId: string;
  dedupeKey: string;
  type?: string;
  source?: string;
  /** Only events received at or after this instant count. */
  since?: string;
}

type EventRow = typeof inboundEvents.$inferSelect;

function toInboundEvent(row: EventRow): InboundEventRecord {
  return {
    id: row.id,
    ownerId: row.ownerId,
    type: row.type,
    payload: JSON.parse(row.payload) as JsonValue,
    ...(row.dedupeKey !== null ? { dedupeKey: row.dedupeKey } : {}),
    source: row.source,
    receivedAt: row.receivedAt,
    runIds: row.runIds,
  };
}

function toRow(event: InboundEventRecord): typeof inboundEvents.$inferInsert {
  return {
    id: event.id,
    ownerId: event.ownerId,
    type: event.type,
    payload: JSON.stringify(event.payload),
    dedupeKey: event.dedupeKey ?? null,
    source: event.source,
    receivedAt: event.receivedAt,
    runIds: event.runIds,
  };
}

/** The `inbound_events` table: every event and webhook delivery, and what it started. */
export class SqliteInboundEvents {
  constructor(private readonly db: Database) {}

  async insert(event: InboundEventRecord): Promise<InboundEventRecord> {
    await this.db.insert(inboundEvents).values(toRow(event));
    return event;
  }

  async setRunIds(id: string, runIds: readonly string[]): Promise<void> {
    await this.db
      .update(inboundEvents)
      .set({ runIds: [...runIds] })
      .where(eq(inboundEvents.id, id));
  }

  async get(id: string): Promise<InboundEventRecord | undefined> {
    const row = await this.db.query.inboundEvents.findFirst({ where: eq(inboundEvents.id, id) });
    if (!row) return undefined;
    return (await this.withDelivery([toInboundEvent(row)]))[0];
  }

  /** Newest first, owner-scoped. `before` pages by `receivedAt`. */
  async list(
    ownerId: string,
    options: { limit?: number; type?: string; before?: string } = {},
  ): Promise<InboundEventRecord[]> {
    const filters: SQL[] = [eq(inboundEvents.ownerId, ownerId)];
    if (options.type) filters.push(eq(inboundEvents.type, options.type));
    if (options.before) filters.push(lt(inboundEvents.receivedAt, options.before));
    const rows = await this.db
      .select()
      .from(inboundEvents)
      .where(and(...filters))
      .orderBy(desc(inboundEvents.receivedAt), desc(sql`rowid`))
      .limit(options.limit ?? 100);
    return this.withDelivery(rows.map(toInboundEvent));
  }

  private async withDelivery(records: InboundEventRecord[]): Promise<InboundEventRecord[]> {
    if (!records.length) return records;
    const receipts = await this.db
      .select()
      .from(webhookReceipts)
      .where(
        inArray(
          webhookReceipts.inboundId,
          records.map((r) => r.id),
        ),
      );
    return records.map((record) => {
      const receipt = receipts.find((r) => r.inboundId === record.id);
      return receipt
        ? {
            ...record,
            delivery: {
              state: receipt.status,
              attempts: receipt.attempts,
              ...(receipt.nextAttemptAt ? { nextAttemptAt: receipt.nextAttemptAt } : {}),
              ...(receipt.failureCode ? { failureCode: receipt.failureCode } : {}),
            },
          }
        : record;
    });
  }

  /** The most recent event with the same dedupe key in the given scope. */
  async findDuplicate(query: InboundEventDedupeQuery): Promise<InboundEventRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(inboundEvents)
      .where(dedupeFilter(query))
      .orderBy(desc(inboundEvents.receivedAt))
      .limit(1);
    return row ? toInboundEvent(row) : undefined;
  }

  /**
   * Insert `event` unless an event matching `dedupe` already exists, atomically. Returns the
   * existing event as `duplicate` when there is one.
   */
  async insertUnlessDuplicate(
    event: InboundEventRecord,
    dedupe: InboundEventDedupeQuery | undefined,
  ): Promise<{ event: InboundEventRecord; duplicate?: InboundEventRecord }> {
    return this.db.transaction(async (tx) => {
      if (dedupe) {
        const [row] = await tx
          .select()
          .from(inboundEvents)
          .where(dedupeFilter(dedupe))
          .orderBy(desc(inboundEvents.receivedAt))
          .limit(1);
        if (row) return { event, duplicate: toInboundEvent(row) };
      }
      await tx.insert(inboundEvents).values(toRow(event));
      return { event };
    });
  }
}

function dedupeFilter(query: InboundEventDedupeQuery): SQL | undefined {
  const filters: SQL[] = [
    eq(inboundEvents.ownerId, query.ownerId),
    eq(inboundEvents.dedupeKey, query.dedupeKey),
  ];
  if (query.type !== undefined) filters.push(eq(inboundEvents.type, query.type));
  if (query.source !== undefined) filters.push(eq(inboundEvents.source, query.source));
  if (query.since !== undefined) filters.push(gte(inboundEvents.receivedAt, query.since));
  return and(...filters);
}
