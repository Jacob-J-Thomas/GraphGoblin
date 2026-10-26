/** Test-only SQL migration fixture: deliberately incomplete/invalid legacy rows are not deployable stores.
 * Production startup and offline upgrade guards remain tested separately; this helper exercises
 * the shipped historical SQL itself without pretending those fixtures passed admission. */
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { openDatabase, type DatabaseHandle } from '../db.js';
const SHIPPED_SQL = fileURLToPath(new URL('../../../drizzle', import.meta.url));

/** Counts entries rather than assuming migration numbers are contiguous. */
export function shippedSqlMigrationCount(): number {
  return readMigrationFiles({ migrationsFolder: SHIPPED_SQL }).length;
}

interface Journal {
  entries: { tag: string }[];
}

async function shippedJournal(): Promise<Journal> {
  return JSON.parse(await readFile(join(SHIPPED_SQL, 'meta/_journal.json'), 'utf8')) as Journal;
}

async function shippedIndexOf(tag: string): Promise<{ journal: Journal; index: number }> {
  const journal = await shippedJournal();
  const index = journal.entries.findIndex((entry) => entry.tag === tag);
  if (index < 0) throw new Error(`No shipped migration is tagged ${tag}`);
  return { journal, index };
}

/** How many shipped migrations a store opened by `openStoreBefore(url, tag)` still needs. */
export async function shippedSqlMigrationsFrom(tag: string): Promise<number> {
  const { journal, index } = await shippedIndexOf(tag);
  return journal.entries.length - index;
}

/**
 * Opens a genuine historical store at `url`, migrated through the shipped chain before `tag`.
 * Reopening the same `url` with the shipped folder applies `tag` and every later migration, so
 * an upgrade fixture seeded here keeps exercising its migration after newer ones land. The
 * returned handle is for seeding only: its truncated migration folder is already removed.
 */
export async function openStoreBefore(url: string, tag: string): Promise<DatabaseHandle> {
  const { journal, index } = await shippedIndexOf(tag);
  const folder = await mkdtemp(join(tmpdir(), 'gg-historical-migrations-'));
  try {
    await mkdir(join(folder, 'meta'));
    const entries = journal.entries.slice(0, index);
    for (const entry of entries)
      await copyFile(join(SHIPPED_SQL, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
    await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
    const handle = openDatabase({ url, migrationsFolder: folder });
    await handle.migrate();
    return handle;
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

export async function applyShippedSqlToHistoricalTestFixture(
  handle: DatabaseHandle,
  folder = SHIPPED_SQL,
): Promise<void> {
  const tx = await handle.client.transaction('write');
  try {
    const result = await tx.execute(
      'SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1',
    );
    const last = Number(result.rows[0]?.created_at ?? 0);
    for (const migration of readMigrationFiles({ migrationsFolder: folder })) {
      if (migration.folderMillis <= last) continue;
      for (const statement of migration.sql) await tx.execute(statement);
      await tx.execute({
        sql: 'INSERT INTO __drizzle_migrations(hash,created_at) VALUES (?,?)',
        args: [migration.hash, migration.folderMillis],
      });
    }
    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}
