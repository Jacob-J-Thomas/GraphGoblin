import type { LoopDefinition, LoopRecord, LoopVersionRecord } from '@graphgoblin/contracts';
import type { ClockPort, IdPort, LoopRepository } from '@graphgoblin/engine';
import { and, asc, desc, eq, isNotNull } from 'drizzle-orm';
import type { Database } from './db.js';
import { loopVersions, loops } from './schema.js';

type LoopRow = typeof loops.$inferSelect;
type VersionRow = typeof loopVersions.$inferSelect;

function toLoop(row: LoopRow): LoopRecord {
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    ...(row.description ? { description: row.description } : {}),
    ...(row.currentVersionId ? { currentVersionId: row.currentVersionId } : {}),
    ...(row.draftVersionId ? { draftVersionId: row.draftVersionId } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toVersion(row: VersionRow): LoopVersionRecord {
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

export class SqliteLoopRepository implements LoopRepository {
  constructor(
    private readonly db: Database,
    private readonly clock: ClockPort,
    private readonly ids: IdPort,
  ) {}

  // ---------------------------------------------------------------------------
  // Engine port
  // ---------------------------------------------------------------------------

  async getVersion(versionId: string): Promise<LoopVersionRecord | undefined> {
    const row = await this.db.query.loopVersions.findFirst({
      where: eq(loopVersions.id, versionId),
    });
    return row ? toVersion(row) : undefined;
  }

  async getLatestPublished(loopId: string): Promise<LoopVersionRecord | undefined> {
    const row = await this.db.query.loopVersions.findFirst({
      where: and(eq(loopVersions.loopId, loopId), eq(loopVersions.status, 'published')),
      orderBy: desc(loopVersions.version),
    });
    return row ? toVersion(row) : undefined;
  }

  async getPublished(loopId: string, version: number): Promise<LoopVersionRecord | undefined> {
    const row = await this.db.query.loopVersions.findFirst({
      where: and(
        eq(loopVersions.loopId, loopId),
        eq(loopVersions.version, version),
        eq(loopVersions.status, 'published'),
      ),
    });
    return row ? toVersion(row) : undefined;
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

  /** Every loop with a published version, across owners; used to re-arm triggers at boot. */
  async listPublished(): Promise<LoopRecord[]> {
    const rows = await this.db
      .select()
      .from(loops)
      .where(isNotNull(loops.currentVersionId))
      .orderBy(asc(loops.createdAt));
    return rows.map(toLoop);
  }

  async listVersions(loopId: string): Promise<LoopVersionRecord[]> {
    const rows = await this.db
      .select()
      .from(loopVersions)
      .where(eq(loopVersions.loopId, loopId))
      .orderBy(desc(loopVersions.version));
    return rows.map(toVersion);
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
      await tx.delete(loopVersions).where(eq(loopVersions.loopId, loopId));
      return tx.delete(loops).where(eq(loops.id, loopId)).returning({ id: loops.id });
    });
    return deleted.length > 0;
  }
}
