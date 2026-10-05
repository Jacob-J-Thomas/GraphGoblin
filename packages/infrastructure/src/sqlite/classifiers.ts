import {
  ClassifierModelEntrySchema,
  ClassifierModelPutSchema,
  type ClassifierModelEntry,
  type ClassifierModelPut,
} from '@graphgoblin/contracts';
import { and, desc, eq } from 'drizzle-orm';
import type { Database } from './db.js';
import { classifierModels } from './schema.js';

export class ClassifierManagedError extends Error {
  readonly code = 'CLASSIFIER_MANAGED_BY_SYSTEM';
  constructor() {
    super('Built-in Jev can only be enabled or disabled');
  }
}

function entry(row: typeof classifierModels.$inferSelect): ClassifierModelEntry {
  const { ownerId: _owner, secretRef, ...metadata } = row;
  return { ...metadata, ...(secretRef === null ? {} : { secretRef }) };
}

/** Owner-scoped classifier metadata. No secret values or loop definitions live here. */
export class SqliteClassifierModels {
  constructor(private readonly db: Database) {}

  async list(ownerId: string): Promise<ClassifierModelEntry[]> {
    return (
      await this.db
        .select()
        .from(classifierModels)
        .where(eq(classifierModels.ownerId, ownerId))
        .orderBy(desc(eq(classifierModels.source, 'builtin')), classifierModels.id)
    ).map(entry);
  }

  async findOne(ownerId: string, id: string): Promise<ClassifierModelEntry | undefined> {
    const row = await this.db.query.classifierModels.findFirst({
      where: and(eq(classifierModels.ownerId, ownerId), eq(classifierModels.id, id)),
    });
    return row ? entry(row) : undefined;
  }

  /** Seed before recovery. Refresh managed metadata atomically, preserving enabled. */
  async seedBuiltin(ownerId: string, builtin: ClassifierModelEntry): Promise<void> {
    const parsed = ClassifierModelEntrySchema.parse(builtin);
    if (parsed.source !== 'builtin') throw new ClassifierManagedError();
    const { enabled: _enabled, ...metadata } = parsed;
    await this.db
      .insert(classifierModels)
      .values({ ownerId, ...parsed })
      .onConflictDoUpdate({
        target: [classifierModels.ownerId, classifierModels.id],
        set: { ...metadata, secretRef: parsed.secretRef ?? null },
      });
  }

  async upsert(
    ownerId: string,
    id: string,
    input: ClassifierModelPut,
  ): Promise<ClassifierModelEntry> {
    if (id === 'jev') throw new ClassifierManagedError();
    const metadata = ClassifierModelPutSchema.parse(input);
    const parsed = ClassifierModelEntrySchema.parse({
      id,
      source: 'custom',
      ...metadata,
      enabled: false,
    });
    const rows = await this.db
      .insert(classifierModels)
      .values({ ownerId, ...parsed })
      .onConflictDoUpdate({
        target: [classifierModels.ownerId, classifierModels.id],
        set: { ...metadata, secretRef: metadata.secretRef ?? null },
      })
      .returning();
    return entry(rows[0]!);
  }

  async setEnabled(
    ownerId: string,
    id: string,
    enabled: boolean,
  ): Promise<ClassifierModelEntry | undefined> {
    const rows = await this.db
      .update(classifierModels)
      .set({ enabled })
      .where(and(eq(classifierModels.ownerId, ownerId), eq(classifierModels.id, id)))
      .returning();
    return rows[0] ? entry(rows[0]) : undefined;
  }

  async delete(ownerId: string, id: string): Promise<boolean> {
    if (id === 'jev') throw new ClassifierManagedError();
    const rows = await this.db
      .delete(classifierModels)
      .where(and(eq(classifierModels.ownerId, ownerId), eq(classifierModels.id, id)))
      .returning({ id: classifierModels.id });
    return rows.length > 0;
  }
}
