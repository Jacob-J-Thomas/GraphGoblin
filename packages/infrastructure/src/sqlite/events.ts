import { EventEmitter } from 'node:events';
import { RunEventSchema, type RunEvent } from '@graphgoblin/contracts';
import {
  AppendConflictError,
  UnreadableRunHistoryError,
  validateGeneratedEvent,
} from '@graphgoblin/engine';
import type { ClockPort, EventDraft, EventStorePort } from '@graphgoblin/engine';
import { and, asc, desc, eq, gt, lt, sql } from 'drizzle-orm';
import type { Database } from './db.js';
import { runEvents, runs } from './schema.js';

type Row = Omit<typeof runEvents.$inferSelect, 'payload'> & { payload: string };

/** A stored row violates the current contract. Reject the entire page without exposing payloads. */
export class InvalidStoredRunEventError extends UnreadableRunHistoryError {
  constructor(
    runId: string,
    readonly seq: number,
    readonly eventType: string,
  ) {
    super(runId, `Stored run event does not conform: run ${runId}, seq ${seq}, type ${eventType}`);
    this.name = 'InvalidStoredRunEventError';
  }
}

function toEvent(row: Row): RunEvent {
  let payload: unknown;
  try {
    payload = JSON.parse(row.payload);
  } catch {
    throw new InvalidStoredRunEventError(row.runId, row.seq, row.type);
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload))
    throw new InvalidStoredRunEventError(row.runId, row.seq, row.type);
  const parsed = RunEventSchema.safeParse({
    ...payload,
    runId: row.runId,
    seq: row.seq,
    ts: row.ts,
    type: row.type,
    ...(row.nodeId !== null ? { nodeId: row.nodeId } : {}),
  });
  if (!parsed.success) throw new InvalidStoredRunEventError(row.runId, row.seq, row.type);
  return parsed.data;
}

/**
 * Append-only event log in SQLite. `seq` is assigned inside a write transaction so it is strictly
 * increasing per run even with concurrent appends from the API and the executor. Live subscribers
 * are in-process; a second process would need a notification channel, which is post-1.0.
 */
export class SqliteEventStore implements EventStorePort {
  private readonly emitter = new EventEmitter({ captureRejections: false });

  constructor(
    private readonly db: Database,
    private readonly clock: ClockPort,
  ) {
    this.emitter.setMaxListeners(0);
  }

  async append(
    runId: string,
    drafts: readonly EventDraft[],
    options: { expectedLastSeq?: number; requireRun?: boolean } = {},
  ): Promise<RunEvent[]> {
    if (drafts.length === 0) return [];
    const ts = this.clock.now().toISOString();
    const stored = await this.db.transaction(async (tx) => {
      if (options.requireRun) {
        const [run] = await tx.select({ id: runs.id }).from(runs).where(eq(runs.id, runId));
        if (!run) return [];
      }
      const [current] = await tx
        .select({ max: sql<number>`coalesce(max(${runEvents.seq}), 0)` })
        .from(runEvents)
        .where(eq(runEvents.runId, runId));
      let seq = Number(current?.max ?? 0);
      if (options.expectedLastSeq !== undefined && options.expectedLastSeq !== seq) {
        throw new AppendConflictError(runId, options.expectedLastSeq, seq);
      }
      const events: RunEvent[] = [];
      const rows: (typeof runEvents.$inferInsert)[] = [];
      for (const draft of drafts) {
        seq += 1;
        const event = validateGeneratedEvent({ ...draft, runId, seq, ts });
        const nodeId = 'nodeId' in event ? event.nodeId : undefined;
        const { type, runId: _runId, seq: _seq, ts: _ts, ...rest } = event;
        const { nodeId: _nodeId, ...payload } = { ...rest, nodeId };
        rows.push({ runId, seq, ts, type, nodeId: nodeId ?? null, payload });
        events.push(event);
      }
      await tx.insert(runEvents).values(rows);
      await tx.update(runs).set({ lastEventSeq: seq }).where(eq(runs.id, runId));
      return events;
    });
    this.notifyCommitted(stored);
    return stored;
  }

  /** Also used by atomic admission, always after its transaction committed. */
  notifyCommitted(events: readonly RunEvent[]): void {
    for (const event of events) {
      for (const listener of this.emitter.listeners(event.runId)) {
        try {
          (listener as (event: RunEvent) => void)(event);
        } catch {
          /* Subscriber failures cannot roll back durable events. */
        }
      }
    }
  }

  async read(runId: string, afterSeq = 0, limit?: number): Promise<RunEvent[]> {
    return (await this.readRows(runId, afterSeq, limit)).map(toEvent);
  }

  /**
   * Latest lifecycle marker, including the started/resumed markers that invalidate an older
   * terminal outcome (RunManager's terminalEvent rule). Finalization can append delivery audit
   * rows after a terminal event, so the last row alone is insufficient. One statement performs
   * five MAX seeks using run_events_delivery_idx (run_id, type, seq), then one primary-key
   * lookup/decoding: bounded work even with arbitrarily much history or delivery bookkeeping.
   */
  async lastLifecycleEvent(runId: string): Promise<RunEvent | undefined> {
    const types = ['run.finished', 'run.failed', 'run.cancelled', 'run.started', 'run.resumed'];
    const latestSeq = sql<number>`max(${sql.join(
      types.map(
        (type) => sql`coalesce((select max(${runEvents.seq}) from ${runEvents}
        where ${runEvents.runId} = ${runId} and ${runEvents.type} = ${type}), 0)`,
      ),
      sql`, `,
    )})`;
    const [row] = await this.db
      .select({
        runId: runEvents.runId,
        seq: runEvents.seq,
        ts: runEvents.ts,
        type: runEvents.type,
        nodeId: runEvents.nodeId,
        payload: sql<string>`${runEvents.payload}`,
      })
      .from(runEvents)
      .where(and(eq(runEvents.runId, runId), eq(runEvents.seq, latestSeq)))
      .limit(1);
    return row ? toEvent(row) : undefined;
  }

  /** Decode only the requested page: corruption in lookahead must not hide healthy history. */
  async page(
    runId: string,
    afterSeq: number,
    limit: number,
  ): Promise<{ items: RunEvent[]; nextAfter: number; hasMore: boolean }> {
    const rows = await this.readRows(runId, afterSeq, limit + 1);
    const items = rows.slice(0, limit).map(toEvent);
    return { items, nextAfter: items.at(-1)?.seq ?? afterSeq, hasMore: rows.length > limit };
  }

  /** A bounded, sequence-ordered browser window. Timestamps never determine membership. */
  async window(runId: string, seq: number, direction: 'older' | 'newer', limit: number) {
    const rows = await this.db
      .select({
        runId: runEvents.runId,
        seq: runEvents.seq,
        ts: runEvents.ts,
        type: runEvents.type,
        nodeId: runEvents.nodeId,
        payload: sql<string>`${runEvents.payload}`,
      })
      .from(runEvents)
      .where(
        and(
          eq(runEvents.runId, runId),
          direction === 'older' ? lt(runEvents.seq, seq) : gt(runEvents.seq, seq),
        ),
      )
      .orderBy(direction === 'older' ? desc(runEvents.seq) : asc(runEvents.seq))
      .limit(limit);
    if (direction === 'older') rows.reverse();
    const items = rows.map(toEvent);
    // The exclusive bounds of the neighbouring pages. An empty page still splits the log at its
    // seek position, and the side it did not read is bounded by the log's own first or last event,
    // never by a position outside it, so every continuation it offers is a valid cursor.
    const edge = async (side: 'first' | 'last') =>
      (
        await this.db
          .select({ seq: runEvents.seq })
          .from(runEvents)
          .where(eq(runEvents.runId, runId))
          .orderBy(side === 'first' ? asc(runEvents.seq) : desc(runEvents.seq))
          .limit(1)
      )[0]?.seq;
    let olderThan: number;
    let newerThan: number;
    if (items.length > 0) {
      olderThan = items[0]!.seq;
      newerThan = items.at(-1)!.seq;
    } else if (direction === 'older') {
      olderThan = seq;
      newerThan = ((await edge('first')) ?? 1) - 1;
    } else {
      olderThan = ((await edge('last')) ?? 0) + 1;
      newerThan = seq;
    }
    const exists = async (bound: number, side: 'older' | 'newer') =>
      (
        await this.db
          .select({ seq: runEvents.seq })
          .from(runEvents)
          .where(
            and(
              eq(runEvents.runId, runId),
              side === 'older' ? lt(runEvents.seq, bound) : gt(runEvents.seq, bound),
            ),
          )
          .limit(1)
      ).length > 0;
    return {
      items,
      hasOlder: await exists(olderThan, 'older'),
      hasNewer: await exists(newerThan, 'newer'),
      olderThan,
      newerThan,
    };
  }

  /** Latest matching evidence, independent of the browser window; indexed by run/type/seq. */
  async latestGate(runId: string): Promise<RunEvent | undefined> {
    // One indexed type scan, not one SQL round trip per ungated decision. Malformed JSON is
    // selected too, so decoding reports corruption instead of silently treating it as no gate.
    const [row] = await this.db
      .select({
        runId: runEvents.runId,
        seq: runEvents.seq,
        ts: runEvents.ts,
        type: runEvents.type,
        nodeId: runEvents.nodeId,
        payload: sql<string>`${runEvents.payload}`,
      })
      .from(runEvents)
      .where(
        and(
          eq(runEvents.runId, runId),
          eq(runEvents.type, 'decision.made'),
          sql`case when json_valid(${runEvents.payload}) then json_type(${runEvents.payload}, '$.gate') is not null else 1 end`,
        ),
      )
      .orderBy(desc(runEvents.seq))
      .limit(1);
    return row ? toEvent(row) : undefined;
  }

  async latest(
    runId: string,
    type: RunEvent['type'],
    before = Number.MAX_SAFE_INTEGER,
  ): Promise<RunEvent | undefined> {
    const [row] = await this.db
      .select({
        runId: runEvents.runId,
        seq: runEvents.seq,
        ts: runEvents.ts,
        type: runEvents.type,
        nodeId: runEvents.nodeId,
        payload: sql<string>`${runEvents.payload}`,
      })
      .from(runEvents)
      .where(and(eq(runEvents.runId, runId), eq(runEvents.type, type), lt(runEvents.seq, before)))
      .orderBy(desc(runEvents.seq))
      .limit(1);
    return row ? toEvent(row) : undefined;
  }

  private async readRows(runId: string, afterSeq: number, limit?: number): Promise<Row[]> {
    const base = this.db
      .select({
        runId: runEvents.runId,
        seq: runEvents.seq,
        ts: runEvents.ts,
        type: runEvents.type,
        nodeId: runEvents.nodeId,
        // Read JSON as text so malformed JSON also reports the row's identity, safely.
        payload: sql<string>`${runEvents.payload}`,
      })
      .from(runEvents)
      .where(and(eq(runEvents.runId, runId), gt(runEvents.seq, afterSeq)))
      .orderBy(asc(runEvents.seq));
    return limit ? base.limit(limit) : base;
  }

  subscribe(runId: string, listener: (event: RunEvent) => void): () => void {
    this.emitter.on(runId, listener);
    return () => {
      this.emitter.off(runId, listener);
    };
  }
}
