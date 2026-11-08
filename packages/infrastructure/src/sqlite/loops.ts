import type {
  LoopDefinition,
  LoopRecord,
  LoopVersionRecord,
  RunRecord,
} from '@graphgoblin/contracts';
import {
  stableHash,
  stableStringify,
  systemChatIssues,
  systemChatLockedIssues,
} from '@graphgoblin/domain';
import type { ClockPort, IdPort, LoopRepository } from '@graphgoblin/engine';
import { UnreadableRunHistoryError } from '@graphgoblin/engine';
import { and, asc, desc, eq, inArray, isNotNull, ne, sql, getTableColumns } from 'drizzle-orm';
import { physicalDirectory } from '../fs/physical-path.js';
import { recordWorkspacePhysical } from './workspace-references.js';
import type { Database, SqliteTransaction } from './db.js';
import { deleteRuns } from './delete-runs.js';
import { SqliteEventStore } from './events.js';
import { decodeRunRecord, decodeStoredThread, rawRunColumns } from './run-decoding.js';
import {
  loopVersions,
  settings,
  chatBindings,
  loops,
  runs,
  schedules,
  webhookEndpoints,
  webhookReceipts,
  eventReceipts,
} from './schema.js';

type LoopRow = typeof loops.$inferSelect;
type VersionRow = typeof loopVersions.$inferSelect;

function toLoop(row: LoopRow, system?: LoopRecord['system']): LoopRecord {
  return {
    ...(system ? { system } : {}),
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

function systemOf(
  binding: typeof chatBindings.$inferSelect | null | undefined,
): LoopRecord['system'] {
  if (!binding) return undefined;
  if (
    binding.protocol !== 'graphgoblin.chat.v1' ||
    (binding.audienceKey !== 'gateway' && !binding.audienceKey.startsWith('device:'))
  )
    throw new SystemChatStorageError('SYSTEM_CHAT_CONTRACT_INVALID', 'Invalid system chat binding');
  return {
    kind: 'chat',
    protocol: 'graphgoblin.chat.v1',
    audience:
      binding.audienceKey === 'gateway'
        ? { kind: 'gateway' }
        : { kind: 'device', deviceId: binding.audienceKey.slice(7) },
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
    // Decode only the stored definition here, outside Drizzle's JSON column decoder. A syntax
    // error makes this definition unavailable; SQL/transport errors must still propagate.
    const [row] = await this.db
      .select({
        ...getTableColumns(loopVersions),
        definition: sql<string>`${loopVersions.definition}`,
      })
      .from(loopVersions)
      .where(eq(loopVersions.id, versionId))
      .limit(1);
    if (!row) return undefined;
    let definition: LoopDefinition;
    try {
      definition = JSON.parse(row.definition) as LoopDefinition;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      return undefined;
    }
    // Schema validation and retired-definition diagnostics remain with the engine's policy.
    return loopVersionFromRow({ ...row, definition });
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
    const working = definition.settings.workingDirectory;
    const physical = working.kind === 'fixed' ? await physicalDirectory(working.path) : null;
    const now = this.clock.now().toISOString();
    const loopId = this.ids.next();
    const draftId = this.ids.next();
    await this.db.transaction(async (tx) => {
      await insertLoopWithVersion(tx, {
        ownerId,
        loopId,
        versionId: draftId,
        definition,
        now,
        published: false,
        physical,
      });
    });
    const loop = await this.getLoop(loopId);
    const draft = await this.getVersion(draftId);
    if (!loop || !draft) throw new Error('loop creation did not persist');
    return { loop, draft };
  }

  async getLoop(loopId: string): Promise<LoopRecord | undefined> {
    const [row] = await this.db
      .select({ loop: loops, binding: chatBindings })
      .from(loops)
      .leftJoin(
        chatBindings,
        and(eq(chatBindings.loopId, loops.id), eq(chatBindings.ownerId, loops.ownerId)),
      )
      .where(eq(loops.id, loopId))
      .limit(1);
    return row ? toLoop(row.loop, systemOf(row.binding)) : undefined;
  }

  async listLoops(ownerId: string): Promise<LoopRecord[]> {
    const rows = await this.db
      .select({ loop: loops, binding: chatBindings })
      .from(loops)
      .leftJoin(
        chatBindings,
        and(eq(chatBindings.loopId, loops.id), eq(chatBindings.ownerId, loops.ownerId)),
      )
      .where(eq(loops.ownerId, ownerId))
      .orderBy(desc(loops.updatedAt));
    return rows.map((row) => toLoop(row.loop, systemOf(row.binding)));
  }

  getSystemChatBinding(loopId: string) {
    return this.classification(loopId);
  }
  private async classification(loopId: string): Promise<LoopRecord['system']> {
    const [binding] = await this.db
      .select()
      .from(chatBindings)
      .where(eq(chatBindings.loopId, loopId));
    return systemOf(binding);
  }
  private async assertSystemDefinition(loopId: string, definition: LoopDefinition, draft = false) {
    if (
      (await this.classification(loopId)) &&
      (draft ? systemChatLockedIssues(definition) : systemChatIssues(definition)).length
    )
      throw new SystemChatStorageError(
        'SYSTEM_CHAT_CONTRACT_INVALID',
        'The system chat boundary is protected',
      );
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
        chatBinding: chatBindings,
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
        chatBindings,
        and(eq(chatBindings.loopId, loops.id), eq(chatBindings.ownerId, loops.ownerId)),
      )
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
        ...toLoop(row, systemOf(row.chatBinding)),
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
      .select({ loop: loops, binding: chatBindings })
      .from(loops)
      .leftJoin(
        chatBindings,
        and(eq(chatBindings.loopId, loops.id), eq(chatBindings.ownerId, loops.ownerId)),
      )
      .where(isNotNull(loops.currentVersionId))
      .orderBy(asc(loops.createdAt));
    return rows.map((row) => toLoop(row.loop, systemOf(row.binding)));
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
  async saveDraft(
    loopId: string,
    definition: LoopDefinition,
    compare?: { ownerId: string; definitionHash: string; voiceConfigRevision: number },
  ): Promise<LoopVersionRecord> {
    await this.assertSystemDefinition(loopId, definition, true);
    const loop = await this.getLoop(loopId);
    if (!loop) throw new LoopNotFoundError(loopId);
    const now = this.clock.now().toISOString();
    const working = definition.settings.workingDirectory;
    const physical = working.kind === 'fixed' ? await physicalDirectory(working.path) : null;
    const existingDraftId = loop.draftVersionId;
    let draftId = existingDraftId ?? this.ids.next();
    await this.db.transaction(async (tx) => {
      if (compare) {
        const [current] = await tx
          .select()
          .from(loops)
          .where(and(eq(loops.id, loopId), eq(loops.ownerId, compare.ownerId)));
        const versionId = current?.draftVersionId ?? current?.currentVersionId;
        const [version] = versionId
          ? await tx.select().from(loopVersions).where(eq(loopVersions.id, versionId))
          : [];
        const [voice] = await tx
          .select()
          .from(settings)
          .where(and(eq(settings.ownerId, compare.ownerId), eq(settings.key, 'chat.voice.v1')));
        const config: unknown = voice ? JSON.parse(voice.value) : { revision: 0 };
        if (
          !current ||
          !version ||
          (current.draftVersionId ?? undefined) !== loop.draftVersionId ||
          (current.currentVersionId ?? undefined) !== loop.currentVersionId ||
          stableHash(version.definition) !== compare.definitionHash ||
          !config ||
          typeof config !== 'object' ||
          !('revision' in config) ||
          config.revision !== compare.voiceConfigRevision
        )
          throw new SystemChatStorageError(
            'VOICE_DRAFT_STALE',
            'The loop or voice configuration changed. Refresh and review a new preview.',
          );
      }
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
      if (working.kind === 'fixed')
        await recordWorkspacePhysical(tx, 'version:' + draftId, working.path, physical);
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
  async publish(
    loopId: string,
    expectedDefinition?: LoopDefinition,
  ): Promise<LoopVersionRecord | undefined> {
    const loop = await this.getLoop(loopId);
    if (!loop) throw new LoopNotFoundError(loopId);
    if (!loop.draftVersionId) return undefined;
    const now = this.clock.now().toISOString();
    const draftId = loop.draftVersionId;
    const draft = await this.getVersion(draftId);
    if (draft) await this.assertSystemDefinition(loopId, draft.definition);
    const working = draft?.definition.settings.workingDirectory;
    const physical = working?.kind === 'fixed' ? await physicalDirectory(working.path) : null;
    // The status flip and the loop pointers change together, and only while the row is a draft.
    const published = await this.db.transaction(async (tx) => {
      const [system] = await tx
        .select({ id: chatBindings.loopId })
        .from(chatBindings)
        .where(eq(chatBindings.loopId, loopId));
      if (system) {
        const [current] = await tx
          .select()
          .from(loopVersions)
          .where(and(eq(loopVersions.id, draftId), eq(loopVersions.status, 'draft')));
        if (
          current &&
          (systemChatIssues(current.definition).length ||
            stableStringify(current.definition) !==
              stableStringify(expectedDefinition ?? draft?.definition))
        )
          throw new SystemChatStorageError(
            'SYSTEM_CHAT_CONTRACT_INVALID',
            'The chat draft changed or has an invalid boundary; review it and publish again',
          );
      }
      const flipped = await tx
        .update(loopVersions)
        .set({ status: 'published', publishedAt: now })
        .where(and(eq(loopVersions.id, draftId), eq(loopVersions.status, 'draft')))
        .returning({ id: loopVersions.id });
      if (flipped.length === 0) return false;
      if (working?.kind === 'fixed')
        await recordWorkspacePhysical(tx, 'version:' + draftId, working.path, physical);
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
      const [binding] = await tx
        .select({ id: chatBindings.loopId })
        .from(chatBindings)
        .where(eq(chatBindings.loopId, loopId));
      if (binding)
        throw new SystemChatStorageError(
          'SYSTEM_LOOP_PROTECTED',
          'System chat loops cannot be deleted',
        );
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

export class SystemChatStorageError extends Error {
  constructor(
    readonly code: 'SYSTEM_CHAT_CONTRACT_INVALID' | 'SYSTEM_LOOP_PROTECTED' | 'VOICE_DRAFT_STALE',
    message: string,
  ) {
    super(message);
    this.name = 'SystemChatStorageError';
  }
}
/** Native creation semantics shared by ordinary create, system seed and pairing claim. */
export async function insertLoopWithVersion(
  tx: SqliteTransaction,
  input: {
    ownerId: string;
    loopId: string;
    versionId: string;
    definition: LoopDefinition;
    now: string;
    published: boolean;
    physical?: string | null;
  },
) {
  const { ownerId, loopId, versionId, definition, now, published } = input;
  await tx.insert(loops).values({
    id: loopId,
    ownerId,
    name: definition.name,
    description: definition.description ?? null,
    currentVersionId: published ? versionId : null,
    draftVersionId: published ? null : versionId,
    createdAt: now,
    updatedAt: now,
  });
  await tx.insert(loopVersions).values({
    id: versionId,
    loopId,
    version: 1,
    status: published ? 'published' : 'draft',
    definition,
    createdAt: now,
    ...(published ? { publishedAt: now } : {}),
  });
  const working = definition.settings.workingDirectory;
  if (working.kind === 'fixed')
    await recordWorkspacePhysical(
      tx,
      'version:' + versionId,
      working.path,
      input.physical !== undefined ? input.physical : await physicalDirectory(working.path),
    );
}
