/** Test-only SQL migration fixture: deliberately incomplete/invalid legacy rows are not deployable stores.
 * Production startup and offline upgrade guards remain tested separately; this helper exercises
 * the shipped historical SQL itself without pretending those fixtures passed admission. */
import { fileURLToPath } from 'node:url';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import type { DatabaseHandle } from '../db.js';
export async function applyShippedSqlToHistoricalTestFixture(
  handle: DatabaseHandle,
  folder = fileURLToPath(new URL('../../../drizzle', import.meta.url)),
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
