import { EventEmitter } from 'node:events';
import type { RunEvent } from '@graphgoblin/contracts';
import { AppendConflictError } from '@graphgoblin/engine';
import type { ClockPort, EventDraft, EventStorePort } from '@graphgoblin/engine';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import type { Database } from './db.js';
import { runEvents, runs } from './schema.js';

type Row = typeof runEvents.$inferSelect;

function toEvent(row: Row): RunEvent {
  return {
    ...row.payload,
    runId: row.runId,
    seq: row.seq,
    ts: row.ts,
    type: row.type,
    ...(row.nodeId ? { nodeId: row.nodeId } : {}),
  } as RunEvent;
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
    options: { expectedLastSeq?: number } = {},
  ): Promise<RunEvent[]> {
    if (drafts.length === 0) return [];
    const ts = this.clock.now().toISOString();
    const stored = await this.db.transaction(async (tx) => {
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
        const { type, ...rest } = draft as { type: string; nodeId?: string } & Record<
          string,
          unknown
        >;
        const { nodeId, ...payload } = rest;
        rows.push({
          runId,
          seq,
          ts,
          type,
          nodeId: typeof nodeId === 'string' ? nodeId : null,
          payload,
        });
        events.push({
          ...payload,
          runId,
          seq,
          ts,
          type,
          ...(typeof nodeId === 'string' ? { nodeId } : {}),
        } as RunEvent);
      }
      await tx.insert(runEvents).values(rows);
      await tx.update(runs).set({ lastEventSeq: seq }).where(eq(runs.id, runId));
      return events;
    });
    for (const event of stored) this.emitter.emit(runId, event);
    return stored;
  }

  async read(runId: string, afterSeq = 0, limit?: number): Promise<RunEvent[]> {
    const base = this.db
      .select()
      .from(runEvents)
      .where(and(eq(runEvents.runId, runId), gt(runEvents.seq, afterSeq)))
      .orderBy(asc(runEvents.seq));
    const rows = limit ? await base.limit(limit) : await base;
    return rows.map(toEvent);
  }

  subscribe(runId: string, listener: (event: RunEvent) => void): () => void {
    this.emitter.on(runId, listener);
    return () => {
      this.emitter.off(runId, listener);
    };
  }
}
