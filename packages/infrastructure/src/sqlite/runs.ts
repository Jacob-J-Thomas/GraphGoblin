import type { ReplayState, ThreadCheckpoint } from '@graphgoblin/domain';
import { RunRecordSchema, TERMINAL_RUN_STATUSES } from '@graphgoblin/contracts';
import type { ContextThread, RunRecord, RunStatus } from '@graphgoblin/contracts';
import type { RunRecordChanges, RunRepository } from '@graphgoblin/engine';
import { UnreadableRunHistoryError } from '@graphgoblin/engine';
import { and, desc, eq, gte, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type { Database } from './db.js';
import { loopVersions, loops, runs } from './schema.js';
import { deleteRuns } from './delete-runs.js';

import {
  rawRunColumns,
  decodeRunRecord,
  decodeStoredReplayState,
  decodeStoredThread,
} from './run-decoding.js';
export { runRecordFromRow } from './run-row.js';

/** Map record changes onto column values; `undefined` becomes NULL so fields can be cleared. */
function toColumns(changes: RunRecordChanges): Partial<typeof runs.$inferInsert> {
  const out: Record<string, unknown> = {};
  const map: Record<keyof RunRecordChanges, keyof typeof runs.$inferInsert> = {
    id: 'id',
    ownerId: 'ownerId',
    loopId: 'loopId',
    versionId: 'versionId',
    pinned: 'pinned',
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
    out[map[key]] = value === undefined ? null : key === 'result' ? JSON.stringify(value) : value;
  }
  return out;
}

export function runInsert(run: RunRecord, initialThread: ContextThread): typeof runs.$inferInsert {
  return {
    id: run.id,
    ownerId: run.ownerId,
    loopId: run.loopId,
    versionId: run.versionId,
    pinned: run.pinned,
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
    result: run.result === undefined ? null : JSON.stringify(run.result),
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

export interface RunPageFilter extends RunListFilter {
  ownerId: string;
  cursor?: Pick<RunRecord, 'createdAt' | 'id'>;
}

export class SqliteRunRepository implements RunRepository {
  constructor(private readonly db: Database) {}

  /**
   * Offline cutover use only: safe only with the API stopped, because orphan runs are deleted
   * regardless of status. Repairs old loop deletion; not invoked by ordinary upgrades.
   */
  async deleteOrphans(): Promise<number> {
    return this.db.transaction((tx) =>
      deleteRuns(
        tx,
        sql`NOT EXISTS (SELECT 1 FROM ${loops} WHERE ${loops.id} = ${runs.loopId})
          OR NOT EXISTS (SELECT 1 FROM ${loopVersions} WHERE ${loopVersions.id} = ${runs.versionId})`,
      ),
    );
  }

  async create(run: RunRecord, initialThread: ContextThread): Promise<void> {
    await this.db.insert(runs).values(runInsert(RunRecordSchema.parse(run), initialThread));
  }

  async get(runId: string): Promise<RunRecord | undefined> {
    const [row] = await this.db.select(rawRunColumns).from(runs).where(eq(runs.id, runId)).limit(1);
    return row ? decodeRunRecord(row) : undefined;
  }

  async update(runId: string, changes: RunRecordChanges): Promise<RunRecord> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.select(rawRunColumns).from(runs).where(eq(runs.id, runId)).limit(1);
      if (!row) throw new Error(`run ${runId} not found`);
      const current = decodeRunRecord(row);
      // Validate before encoding: JSON.stringify would silently turn NaN/Infinity into null.
      RunRecordSchema.parse({ ...current, ...changes });
      const columns = toColumns(changes);
      if (Object.keys(columns).length === 0) return current;
      const [updated] = await tx
        .update(runs)
        .set(columns)
        .where(eq(runs.id, runId))
        .returning(rawRunColumns);
      if (!updated) throw new Error(`run ${runId} not found`);
      return decodeRunRecord(updated);
    });
  }

  async transition(
    runId: string,
    from: readonly RunStatus[],
    changes: RunRecordChanges,
    guard?: { waitId: string },
  ): Promise<RunRecord | undefined> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.select(rawRunColumns).from(runs).where(eq(runs.id, runId)).limit(1);
      if (!row) throw new Error(`run ${runId} not found`);
      const current = decodeRunRecord(row);
      if (!from.includes(current.status) || (guard && current.waiting?.waitId !== guard.waitId))
        return undefined;
      RunRecordSchema.parse({ ...current, ...changes });
      const columns = toColumns(changes);
      if (Object.keys(columns).length === 0) return current;
      const [updated] = await tx
        .update(runs)
        .set(columns)
        .where(
          and(
            eq(runs.id, runId),
            inArray(runs.status, [...from]),
            guard ? sql`json_extract(${runs.waiting}, '$.waitId') = ${guard.waitId}` : undefined,
          ),
        )
        .returning(rawRunColumns);
      return updated ? decodeRunRecord(updated) : undefined;
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
      .returning(rawRunColumns);
    const row = updated[0];
    return row ? decodeRunRecord(row) : undefined;
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

  /** Raw identities keep one malformed JSON column from aborting the recovery scan. */
  async listRecoveryCandidates(): Promise<{ id: string; terminal: boolean }[]> {
    const rows = await this.db
      .select({ id: runs.id, status: runs.status })
      .from(runs)
      .where(
        or(
          isNull(runs.finalizedAt),
          inArray(runs.status, ['queued', 'running', 'waiting', 'paused']),
        ),
      )
      .orderBy(runs.createdAt);
    return rows.map(({ id, status }) => ({
      id,
      terminal: TERMINAL_RUN_STATUSES.some((s) => s === status),
    }));
  }

  /** Minimal owner-scoped identities remain readable even when a run row is damaged. */
  async listIdentities(ownerId: string, atOrAfter?: string): Promise<{ id: string }[]> {
    return this.db
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.ownerId, ownerId), atOrAfter ? gte(runs.id, atOrAfter) : undefined))
      .orderBy(runs.id)
      .limit(21);
  }

  async listChildren(parentRunId: string): Promise<RunRecord[]> {
    const rows = await this.db
      .select(rawRunColumns)
      .from(runs)
      .where(eq(runs.parentRunId, parentRunId))
      .orderBy(runs.createdAt);
    return rows.map(decodeRunRecord);
  }

  async list(filter: RunListFilter = {}): Promise<RunRecord[]> {
    return this.listRows(filter, Math.min(filter.limit ?? 50, 500));
  }

  /** Owner-scoped ordinary paging; a single lookahead row decides whether there is a next page. */
  async page(filter: RunPageFilter): Promise<{
    items: RunRecord[];
    next: Pick<RunRecord, 'createdAt' | 'id'> | null;
  }> {
    const limit = Math.max(1, Math.min(filter.limit ?? 100, 500));
    const rows = await this.rawListRows(filter, limit + 1, filter.cursor);
    const page = rows.slice(0, limit);
    const items = this.readableRows(page);
    const last = page.at(-1)!;
    return {
      items,
      next: rows.length > limit ? { createdAt: last.createdAt, id: last.id } : null,
    };
  }

  private readableRows(rows: Parameters<typeof decodeRunRecord>[0][]): RunRecord[] {
    return rows.flatMap((row) => {
      try {
        return [decodeRunRecord(row)];
      } catch (error) {
        if (!(error instanceof UnreadableRunHistoryError)) throw error;
        // The diagnostics endpoint reports the skipped row; never hide database/I/O errors.
        return [];
      }
    });
  }

  private async listRows(filter: RunListFilter, limit: number): Promise<RunRecord[]> {
    return this.readableRows(await this.rawListRows(filter, limit));
  }

  async listRunReferences(
    statuses: readonly RunStatus[],
  ): Promise<Pick<RunRecord, 'id' | 'loopId' | 'versionId'>[]> {
    if (!statuses.length) return [];
    return this.db
      .select({ id: runs.id, loopId: runs.loopId, versionId: runs.versionId })
      .from(runs)
      .where(inArray(runs.status, [...statuses]));
  }

  private async rawListRows(
    filter: RunListFilter,
    limit: number,
    cursor?: RunPageFilter['cursor'],
  ): Promise<Parameters<typeof decodeRunRecord>[0][]> {
    const conditions: SQL[] = [];
    if (filter.ownerId !== undefined) conditions.push(eq(runs.ownerId, filter.ownerId));
    if (filter.loopId) conditions.push(eq(runs.loopId, filter.loopId));
    if (filter.status?.length) conditions.push(inArray(runs.status, filter.status));
    if (filter.parentRunId === null) conditions.push(sql`${runs.parentRunId} IS NULL`);
    else if (filter.parentRunId) conditions.push(eq(runs.parentRunId, filter.parentRunId));
    if (filter.before) conditions.push(lt(runs.createdAt, filter.before));
    if (cursor)
      conditions.push(sql`(${runs.createdAt}, ${runs.id}) < (${cursor.createdAt}, ${cursor.id})`);
    const query = this.db
      .select(rawRunColumns)
      .from(runs)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(runs.createdAt), desc(runs.id))
      .limit(limit);
    return await query;
  }

  async getInitialThread(runId: string): Promise<ContextThread | undefined> {
    const [row] = await this.db
      .select({ value: sql<string>`${runs.initialThread}` })
      .from(runs)
      .where(eq(runs.id, runId))
      .limit(1);
    return row ? decodeStoredThread(runId, 'initial_thread', row.value) : undefined;
  }

  async getThread(runId: string): Promise<ContextThread | undefined> {
    const [row] = await this.db
      .select({ value: sql<string | null>`${runs.threadSnapshot}` })
      .from(runs)
      .where(eq(runs.id, runId))
      .limit(1);
    return row?.value !== null && row?.value !== undefined
      ? decodeStoredThread(runId, 'thread_snapshot', row.value)
      : undefined;
  }

  async saveThread(
    runId: string,
    thread: ContextThread,
    seq: number,
    replayState: ReplayState,
  ): Promise<void> {
    await this.db
      .update(runs)
      .set({
        threadSnapshot: thread,
        threadSnapshotSeq: seq,
        threadSnapshotReplayState: replayState,
      })
      .where(eq(runs.id, runId));
  }

  async getThreadCheckpoint(runId: string): Promise<ThreadCheckpoint | undefined> {
    const [row] = await this.db
      .select({
        thread: sql<string | null>`${runs.threadSnapshot}`,
        seq: runs.threadSnapshotSeq,
        replayState: sql<string | null>`${runs.threadSnapshotReplayState}`,
      })
      .from(runs)
      .where(eq(runs.id, runId))
      .limit(1);
    if (row?.thread === null || row?.thread === undefined) return undefined;
    const thread = decodeStoredThread(runId, 'thread_snapshot', row.thread);
    return row.seq === null
      ? undefined
      : {
          thread,
          seq: row.seq,
          ...(row.replayState === null
            ? {}
            : { replayState: decodeStoredReplayState(runId, row.replayState) }),
        };
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
      .set({ threadSnapshot: null, threadSnapshotSeq: null, threadSnapshotReplayState: null })
      .where(eq(runs.id, runId));
  }
}
