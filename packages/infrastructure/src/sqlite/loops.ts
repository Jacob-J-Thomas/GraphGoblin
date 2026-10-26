import type {
  LoopDefinition,
  LoopRecord,
  LoopVersionRecord,
  RunRecord,
} from '@graphgoblin/contracts';
import type { ClockPort, IdPort, LoopRepository } from '@graphgoblin/engine';
import { UnreadableRunHistoryError } from '@graphgoblin/engine';
import { and, asc, desc, eq, inArray, isNotNull, ne, sql, getTableColumns } from 'drizzle-orm';
import type { Database } from './db.js';
import { deleteRuns } from './delete-runs.js';
import { SqliteEventStore } from './events.js';
import { decodeRunRecord, decodeStoredThread, rawRunColumns } from './run-decoding.js';
import {
  loopVersions,
  loops,
  runs,
  schedules,
  webhookEndpoints,
  webhookReceipts,
  eventReceipts,
} from './schema.js';

type LoopRow = typeof loops.$inferSelect;
type VersionRow = typeof loopVersions.$inferSelect;

function toLoop(row: LoopRow): LoopRecord {
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    ...(row.description !== null ? { description: row.description } : {}),
    ...(row.currentVersionId ? { currentVersionId: row.currentVersionId } : {}),
    ...(row.draftVersionId ? { draftVersionId: row.draftVersionId } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function loopVersionFromRow(row: VersionRow): LoopVersionRecord {
  return {
    id: row.id,
    loopId: row.loopId,
    version: row.version,
    status: row.status,
    definition: row.definition,
    createdAt: row.createdAt,
    ...(row.publishedAt ? { publishedAt: row.publishedAt } : {}),
  };
}

export class LoopNotFoundError extends Error {
  constructor(loopId: string) {
    super(`loop ${loopId} not found`);
    this.name = 'LoopNotFoundError';
  }
}

export class LoopInUseError extends Error {
  constructor(loopId: string) {
    super(`loop ${loopId} has active runs (queued, running, waiting or paused); cancel them first`);
    this.name = 'LoopInUseError';
  }
}

export class SqliteLoopRepository implements LoopRepository {
  private readonly events: SqliteEventStore;
  private readonly eventReadability = new Map<
    string,
    { runId: string; count: number; readable: boolean }
  >();

  constructor(
    private readonly db: Database,
    private readonly clock: ClockPort,
    private readonly ids: IdPort,
  ) {
    this.events = new SqliteEventStore(db, clock);
  }

  // ---------------------------------------------------------------------------
  // Engine port
  // ---------------------------------------------------------------------------

  async getVersion(versionId: string): Promise<LoopVersionRecord | undefined> {
    const row = await this.db.query.loopVersions.findFirst({
      where: eq(loopVersions.id, versionId),
    });
    return row ? loopVersionFromRow(row) : undefined;
  }

  async getLatestPublished(loopId: string): Promise<LoopVersionRecord | undefined> {
    const row = await this.db.query.loopVersions.findFirst({
      where: and(eq(loopVersions.loopId, loopId), eq(loopVersions.status, 'published')),
      orderBy: desc(loopVersions.version),
    });
    return row ? loopVersionFromRow(row) : undefined;
  }

  async getPublished(loopId: string, version: number): Promise<LoopVersionRecord | undefined> {
    const row = await this.db.query.loopVersions.findFirst({
      where: and(
        eq(loopVersions.loopId, loopId),
        eq(loopVersions.version, version),
        eq(loopVersions.status, 'published'),
      ),
    });
    return row ? loopVersionFromRow(row) : undefined;
  }

  // ---------------------------------------------------------------------------
  // API operations
  // ---------------------------------------------------------------------------

  /** Create a loop with its first draft version. */
  async create(
    ownerId: string,
    definition: LoopDefinition,
  ): Promise<{ loop: LoopRecord; draft: LoopVersionRecord }> {
    const now = this.clock.now().toISOString();
    const loopId = this.ids.next();
    const draftId = this.ids.next();
    await this.db.transaction(async (tx) => {
      await tx.insert(loops).values({
        id: loopId,
        ownerId,
        name: definition.name,
        description: definition.description ?? null,
        draftVersionId: draftId,
        createdAt: now,
        updatedAt: now,
      });
      await tx
        .insert(loopVersions)
        .values({ id: draftId, loopId, version: 1, status: 'draft', definition, createdAt: now });
    });
    const loop = await this.getLoop(loopId);
    const draft = await this.getVersion(draftId);
    if (!loop || !draft) throw new Error('loop creation did not persist');
    return { loop, draft };
  }

  async getLoop(loopId: string): Promise<LoopRecord | undefined> {
    const row = await this.db.query.loops.findFirst({ where: eq(loops.id, loopId) });
    return row ? toLoop(row) : undefined;
  }

  async listLoops(ownerId: string): Promise<LoopRecord[]> {
    const rows = await this.db
      .select()
      .from(loops)
      .where(eq(loops.ownerId, ownerId))
      .orderBy(desc(loops.updatedAt));
    return rows.map(toLoop);
  }

  /** One statement selects each owner loop's exact count and deterministic latest run. */
  async listWithRunSummaries(ownerId: string): Promise<
    (LoopRecord & {
      latestRun: Pick<RunRecord, 'id' | 'status' | 'createdAt'> | null;
      runCount: number;
    })[]
  > {
    const rows = await this.db
      .select({
        ...getTableColumns(loops),
        latestRun: {
          ...rawRunColumns,
          initialThread: sql<string>`${runs.initialThread}`,
          threadSnapshot: sql<string | null>`${runs.threadSnapshot}`,
          eventCount:
            sql<number>`(SELECT count(*) FROM run_events e WHERE e.run_id = ${runs.id})`.mapWith(
              Number,
            ),
        },
        runCount:
          sql<number>`(SELECT count(*) FROM runs r WHERE r.loop_id = ${loops.id} AND r.owner_id = ${loops.ownerId})`.mapWith(
            Number,
          ),
      })
      .from(loops)
      .leftJoin(
        runs,
        sql`${runs.id} = (
      SELECT r.id FROM runs r WHERE r.loop_id = ${loops.id} AND r.owner_id = ${loops.ownerId}
      ORDER BY r.created_at DESC, r.id DESC LIMIT 1
    )`,
      )
      .where(eq(loops.ownerId, ownerId))
      .orderBy(desc(loops.updatedAt));
    const summaries = [];
    for (const row of rows) {
      let latestRun: Pick<RunRecord, 'id' | 'status' | 'createdAt'> | null = null;
      if (row.latestRun) {
        try {
          // A valid status alone can be stale when a damaged snapshot could not be updated.
          // Use the same strict decoder as every other run read before showing a badge.
          const { id, status, createdAt } = decodeRunRecord(row.latestRun);
          // Recovery refuses damaged threads before repairing a stale status. A readable
          // summary must validate both too; an absent cached snapshot is valid, not damage.
          decodeStoredThread(id, 'initial_thread', row.latestRun.initialThread);
          if (row.latestRun.threadSnapshot !== null)
            decodeStoredThread(id, 'thread_snapshot', row.latestRun.threadSnapshot);
          if (await this.hasReadableEvents(row.id, id, row.latestRun.eventCount))
            latestRun = { id, status, createdAt };
        } catch (error) {
          if (!(error instanceof UnreadableRunHistoryError)) throw error;
        }
      }
      summaries.push({
        ...toLoop(row),
        runCount: row.runCount,
        // A positive count with no readable latest summary means unavailable, not never run.
        latestRun,
      });
    }
    return summaries;
  }

  private async hasReadableEvents(loopId: string, runId: string, count: number): Promise<boolean> {
    // Recovery also refuses unreadable events before repairing status. It only logs failures;
    // diagnostics scans on demand, so neither supplies a shared set. Check the same strict
    // event decoder in batches, stopping at the first bad row. Cache one identity/count per
    // loop: polling unchanged histories does no JSON decoding, even for long finished runs.
    // Count bounds a scan of an active run; appends invalidate the result on the next read.
    // Out-of-band repairs/edits with unchanged count require restarting this cache's process.
    const cached = this.eventReadability.get(loopId);
    if (cached?.runId === runId && cached.count === count) return cached.readable;
    let readable = true;
    try {
      let after = 0;
      for (let remaining = count; remaining > 0;) {
        const events = await this.events.read(runId, after, Math.min(100, remaining));
        if (events.length === 0) break;
        after = events.at(-1)!.seq;
        remaining -= events.length;
      }
    } catch (error) {
      if (!(error instanceof UnreadableRunHistoryError)) throw error;
      readable = false;
    }
    this.eventReadability.set(loopId, { runId, count, readable });
    return readable;
  }

  /** Every loop with a published version, across owners; used to re-arm triggers at boot. */
  async listPublished(): Promise<LoopRecord[]> {
    const rows = await this.db
      .select()
      .from(loops)
      .where(isNotNull(loops.currentVersionId))
      .orderBy(asc(loops.createdAt));
    return rows.map(toLoop);
  }

  /**
   * The version history: published versions and the draft. Draft snapshots pinned by draft runs
   * are run history, not versions (ADR-0041); `getVersion` still reads them by id.
   */
  async listVersions(loopId: string): Promise<LoopVersionRecord[]> {
    const rows = await this.db
      .select()
      .from(loopVersions)
      .where(and(eq(loopVersions.loopId, loopId), ne(loopVersions.status, 'snapshot')))
      .orderBy(desc(loopVersions.version));
    return rows.map(loopVersionFromRow);
  }

  /**
   * Save the draft definition, creating a new draft version when the loop has none. The update of
   * an existing draft row only applies while that row is still a draft: if a publish froze it after
   * the loop was read, a new draft version is created instead, so a published version is never
   * modified (ADR-0008).
   */
  async saveDraft(loopId: string, definition: LoopDefinition): Promise<LoopVersionRecord> {
    const loop = await this.getLoop(loopId);
    if (!loop) throw new LoopNotFoundError(loopId);
    const now = this.clock.now().toISOString();
    const existingDraftId = loop.draftVersionId;
    let draftId = existingDraftId ?? this.ids.next();
    await this.db.transaction(async (tx) => {
      const updated = existingDraftId
        ? await tx
            .update(loopVersions)
            .set({ definition })
            .where(and(eq(loopVersions.id, existingDraftId), eq(loopVersions.status, 'draft')))
            .returning({ id: loopVersions.id })
        : [];
      if (updated.length === 0) {
        if (existingDraftId) draftId = this.ids.next();
        const [latest] = await tx
          .select({ version: loopVersions.version })
          .from(loopVersions)
          .where(eq(loopVersions.loopId, loopId))
          .orderBy(desc(loopVersions.version))
          .limit(1);
        await tx.insert(loopVersions).values({
          id: draftId,
          loopId,
          version: (latest?.version ?? 0) + 1,
          status: 'draft',
          definition,
          createdAt: now,
        });
      }
      await tx
        .update(loops)
        .set({
          name: definition.name,
          description: definition.description ?? null,
          draftVersionId: draftId,
          updatedAt: now,
        })
        .where(eq(loops.id, loopId));
    });
    const draft = await this.getVersion(draftId);
    if (!draft) throw new Error('draft did not persist');
    return draft;
  }

  /** Freeze the draft as the current published version. Returns undefined when there is no draft. */
  async publish(loopId: string): Promise<LoopVersionRecord | undefined> {
    const loop = await this.getLoop(loopId);
    if (!loop) throw new LoopNotFoundError(loopId);
    if (!loop.draftVersionId) return undefined;
    const now = this.clock.now().toISOString();
    const draftId = loop.draftVersionId;
    // The status flip and the loop pointers change together, and only while the row is a draft.
    const published = await this.db.transaction(async (tx) => {
      const flipped = await tx
        .update(loopVersions)
        .set({ status: 'published', publishedAt: now })
        .where(and(eq(loopVersions.id, draftId), eq(loopVersions.status, 'draft')))
        .returning({ id: loopVersions.id });
      if (flipped.length === 0) return false;
      await tx
        .update(loops)
        .set({ currentVersionId: draftId, draftVersionId: null, updatedAt: now })
        .where(and(eq(loops.id, loopId), eq(loops.draftVersionId, draftId)));
      return true;
    });
    return published ? this.getVersion(draftId) : undefined;
  }

  async delete(loopId: string): Promise<boolean> {
    const deleted = await this.db.transaction(async (tx) => {
      const [active] = await tx
        .select({ id: runs.id })
        .from(runs)
        .where(
          and(
            eq(runs.loopId, loopId),
            inArray(runs.status, ['queued', 'running', 'waiting', 'paused']),
          ),
        )
        .limit(1);
      if (active) throw new LoopInUseError(loopId);
      await deleteRuns(tx, eq(runs.loopId, loopId));
      await tx.delete(schedules).where(eq(schedules.loopId, loopId));
      await tx.delete(webhookEndpoints).where(eq(webhookEndpoints.loopId, loopId));
      await tx.delete(webhookReceipts).where(eq(webhookReceipts.loopId, loopId));
      await tx.delete(eventReceipts).where(eq(eventReceipts.loopId, loopId));
      await tx.delete(loopVersions).where(eq(loopVersions.loopId, loopId));
      return tx.delete(loops).where(eq(loops.id, loopId)).returning({ id: loops.id });
    });
    return deleted.length > 0;
  }
}
