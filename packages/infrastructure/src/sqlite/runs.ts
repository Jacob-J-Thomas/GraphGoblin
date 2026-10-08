import { TERMINAL_RUN_STATUSES } from '@graphgoblin/contracts';
import type { ContextThread, RunRecord, RunStatus } from '@graphgoblin/contracts';
import type { RunRecordChanges, RunRepository } from '@graphgoblin/engine';
import { and, desc, eq, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm';
import type { Database } from './db.js';
import { runs } from './schema.js';
import { TemplateTransaction } from './templates.js';
export type BeforeRunTransition = (
  store: TemplateTransaction,
  current: RunRecord,
  changes: RunRecordChanges,
) => Promise<void>;

import { runRecordFromRow } from './run-row.js';
export { runRecordFromRow } from './run-row.js';

/** Map record changes onto column values; `undefined` becomes NULL so fields can be cleared. */
function toColumns(changes: RunRecordChanges): Partial<typeof runs.$inferInsert> {
  const out: Record<string, unknown> = {};
  const map: Record<keyof RunRecordChanges, keyof typeof runs.$inferInsert> = {
    id: 'id',
    ownerId: 'ownerId',
    loopId: 'loopId',
    versionId: 'versionId',
    parentRunId: 'parentRunId',
    invocationId: 'invocationId',
    status: 'status',
    currentNodeId: 'currentNodeId',
    iteration: 'iteration',
    waiting: 'waiting',
    cancelRequestedAt: 'cancelRequestedAt',
    pausedAt: 'pausedAt',
    failure: 'failure',
    outcome: 'outcome',
    result: 'result',
    createdAt: 'createdAt',
    startedAt: 'startedAt',
    finishedAt: 'finishedAt',
    lastEventSeq: 'lastEventSeq',
  };
  for (const [key, value] of Object.entries(changes) as [keyof RunRecordChanges, unknown][]) {
    out[map[key]] = value === undefined ? null : value;
  }
  return out;
}

export function runInsert(run: RunRecord, initialThread: ContextThread): typeof runs.$inferInsert {
  return {
    id: run.id,
    ownerId: run.ownerId,
    loopId: run.loopId,
    versionId: run.versionId,
    parentRunId: run.parentRunId ?? null,
    invocationId: run.invocationId,
    status: run.status,
    currentNodeId: run.currentNodeId ?? null,
    iteration: run.iteration,
    waiting: run.waiting ?? null,
    cancelRequestedAt: run.cancelRequestedAt ?? null,
    pausedAt: run.pausedAt ?? null,
    failure: run.failure ?? null,
    outcome: run.outcome ?? null,
    result: run.result ?? null,
    createdAt: run.createdAt,
    startedAt: run.startedAt ?? null,
    finishedAt: run.finishedAt ?? null,
    lastEventSeq: run.lastEventSeq,
    initialThread,
    threadSnapshot: initialThread,
  };
}

export interface RunListFilter {
  ownerId?: string;
  loopId?: string;
  status?: RunStatus[];
  parentRunId?: string | null;
  /** Return runs created before this ISO timestamp (cursor). */
  before?: string;
  limit?: number;
}

export class SqliteRunRepository implements RunRepository {
  constructor(
    private readonly db: Database,
    private readonly beforeTransition?: BeforeRunTransition,
  ) {}

  async create(run: RunRecord, initialThread: ContextThread): Promise<void> {
    await this.db.insert(runs).values(runInsert(run, initialThread));
  }

  async get(runId: string): Promise<RunRecord | undefined> {
    const row = await this.db.query.runs.findFirst({ where: eq(runs.id, runId) });
    return row ? runRecordFromRow(row) : undefined;
  }

  async update(runId: string, changes: RunRecordChanges): Promise<RunRecord> {
    const columns = toColumns(changes);
    if (Object.keys(columns).length === 0) {
      const current = await this.get(runId);
      if (!current) throw new Error(`run ${runId} not found`);
      return current;
    }
    const updated = await this.db.update(runs).set(columns).where(eq(runs.id, runId)).returning();
    const row = updated[0];
    if (!row) throw new Error(`run ${runId} not found`);
    return runRecordFromRow(row);
  }

  async transition(
    runId: string,
    from: readonly RunStatus[],
    changes: RunRecordChanges,
  ): Promise<RunRecord | undefined> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(runs).where(eq(runs.id, runId)).limit(1);
      if (!row) throw new Error(`run ${runId} not found`);
      const current = runRecordFromRow(row);
      if (!from.includes(current.status)) return undefined;
      const columns = toColumns(changes);
      if (Object.keys(columns).length === 0) return current;
      await this.beforeTransition?.(new TemplateTransaction(tx), current, changes);
      const [updated] = await tx
        .update(runs)
        .set(columns)
        .where(and(eq(runs.id, runId), inArray(runs.status, [...from])))
        .returning();
      return updated ? runRecordFromRow(updated) : undefined;
    });
  }

  async claimCancel(
    runId: string,
    from: readonly RunStatus[],
    at: string,
  ): Promise<RunRecord | undefined> {
    const updated = await this.db
      .update(runs)
      .set({ cancelRequestedAt: at })
      .where(
        and(eq(runs.id, runId), isNull(runs.cancelRequestedAt), inArray(runs.status, [...from])),
      )
      .returning();
    const row = updated[0];
    return row ? runRecordFromRow(row) : undefined;
  }

  async markFinalized(runId: string): Promise<void> {
    await this.db
      .update(runs)
      .set({ finalizedAt: new Date().toISOString() })
      .where(eq(runs.id, runId));
  }

  async clearFinalized(runId: string): Promise<void> {
    await this.db.update(runs).set({ finalizedAt: null }).where(eq(runs.id, runId));
  }

  async listUnfinalized(): Promise<RunRecord[]> {
    const rows = await this.db
      .select()
      .from(runs)
      .where(and(isNull(runs.finalizedAt), inArray(runs.status, [...TERMINAL_RUN_STATUSES])))
      .orderBy(runs.createdAt);
    return rows.map(runRecordFromRow);
  }

  async listByStatus(statuses: readonly RunStatus[]): Promise<RunRecord[]> {
    if (statuses.length === 0) return [];
    const rows = await this.db
      .select()
      .from(runs)
      .where(inArray(runs.status, [...statuses]))
      .orderBy(runs.createdAt);
    return rows.map(runRecordFromRow);
  }

  async listChildren(parentRunId: string): Promise<RunRecord[]> {
    const rows = await this.db
      .select()
      .from(runs)
      .where(eq(runs.parentRunId, parentRunId))
      .orderBy(runs.createdAt);
    return rows.map(runRecordFromRow);
  }

  async list(filter: RunListFilter = {}): Promise<RunRecord[]> {
    const conditions: SQL[] = [];
    if (filter.ownerId) conditions.push(eq(runs.ownerId, filter.ownerId));
    if (filter.loopId) conditions.push(eq(runs.loopId, filter.loopId));
    if (filter.status?.length) conditions.push(inArray(runs.status, filter.status));
    if (filter.parentRunId === null) conditions.push(sql`${runs.parentRunId} IS NULL`);
    else if (filter.parentRunId) conditions.push(eq(runs.parentRunId, filter.parentRunId));
    if (filter.before) conditions.push(lt(runs.createdAt, filter.before));
    const query = this.db
      .select()
      .from(runs)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(runs.createdAt), desc(runs.id))
      .limit(Math.min(filter.limit ?? 50, 500));
    return (await query).map(runRecordFromRow);
  }

  async getInitialThread(runId: string): Promise<ContextThread | undefined> {
    const row = await this.db.query.runs.findFirst({
      where: eq(runs.id, runId),
      columns: { initialThread: true },
    });
    return row?.initialThread ?? undefined;
  }

  async getThread(runId: string): Promise<ContextThread | undefined> {
    const row = await this.db.query.runs.findFirst({
      where: eq(runs.id, runId),
      columns: { threadSnapshot: true },
    });
    return row?.threadSnapshot ?? undefined;
  }

  async saveThread(runId: string, thread: ContextThread, seq?: number): Promise<void> {
    await this.db
      .update(runs)
      .set({ threadSnapshot: thread, threadSnapshotSeq: seq ?? null })
      .where(eq(runs.id, runId));
  }

  async getThreadCheckpoint(
    runId: string,
  ): Promise<{ thread: ContextThread; seq: number } | undefined> {
    const row = await this.db.query.runs.findFirst({
      where: eq(runs.id, runId),
      columns: { threadSnapshot: true, threadSnapshotSeq: true },
    });
    return row?.threadSnapshot && row.threadSnapshotSeq !== null
      ? { thread: row.threadSnapshot, seq: row.threadSnapshotSeq }
      : undefined;
  }

  /**
   * Whether a trigger node of a loop has already started a run with this dedupe key. Reads the
   * trigger envelope stored in each run's initial thread, so it survives restarts.
   */
  async hasTriggerDedupe(
    loopId: string,
    triggerNodeId: string,
    dedupeKey: string,
  ): Promise<boolean> {
    const [row] = await this.db
      .select({ id: runs.id })
      .from(runs)
      .where(
        and(
          eq(runs.loopId, loopId),
          sql`json_extract(${runs.initialThread}, '$.invocation.trigger.nodeId') = ${triggerNodeId}`,
          sql`json_extract(${runs.initialThread}, '$.invocation.trigger.dedupeKey') = ${dedupeKey}`,
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  /** Batched owner-loop/trigger dedupe for the complete validated poll candidate set. */
  async findTriggerDedupeKeys(
    loopId: string,
    triggerNodeId: string,
    keys: readonly string[],
  ): Promise<Set<string>> {
    if (keys.length === 0) return new Set();
    const key = sql<string>`json_extract(${runs.initialThread}, '$.invocation.trigger.dedupeKey')`;
    const found = await this.db
      .select({ key })
      .from(runs)
      .where(
        and(
          eq(runs.loopId, loopId),
          sql`json_extract(${runs.initialThread}, '$.invocation.trigger.nodeId') = ${triggerNodeId}`,
          inArray(key, [...keys]),
        ),
      );
    return new Set(found.map((row) => row.key));
  }
  /** Test and maintenance helper: drop the snapshot so the thread is rebuilt from the log. */
  async clearThreadSnapshot(runId: string): Promise<void> {
    await this.db
      .update(runs)
      .set({ threadSnapshot: null, threadSnapshotSeq: null })
      .where(eq(runs.id, runId));
  }
}
