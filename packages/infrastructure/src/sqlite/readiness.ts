import { CURRENT_DEFINITION_FORMAT } from '@graphgoblin/contracts';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { getTableConfig, SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { fileURLToPath } from 'node:url';
import { schema } from './schema.js';

export const SHIPPED_MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url));
const normalize = (sql: string) => sql.toLowerCase().replace(/[\s"`]/g, '');
const dialect = new SQLiteSyncDialect();

/** One description of current storage, including hand-written migration indexes. No dates here. */
export function currentStoreReadiness(migrationsFolder = SHIPPED_MIGRATIONS) {
  const shipped = readMigrationFiles({ migrationsFolder: SHIPPED_MIGRATIONS });
  const migrations = [
    ...new Map(
      [...shipped, ...readMigrationFiles({ migrationsFolder })].map((migration) => [
        migration.folderMillis,
        migration,
      ]),
    ).values(),
  ].sort((a, b) => a.folderMillis - b.folderMillis);
  return {
    marker: { format_version: CURRENT_DEFINITION_FORMAT, status: 'complete' },
    tables: Object.values(schema).map((table) => {
      const config = getTableConfig(table);
      return {
        name: config.name,
        columns: config.columns.map((column) => ({ name: column.name, notNull: column.notNull })),
        checks: config.checks.map((check) =>
          normalize(
            'CHECK(' +
              dialect.sqlToQuery(check.value).sql.replaceAll('"' + config.name + '".', '') +
              ')',
          ),
        ),
      };
    }),
    indexes: migrations.flatMap((migration) =>
      migration.sql.flatMap((statement) => {
        const match = /CREATE\s+(UNIQUE\s+)?INDEX\s+["`]?([\w]+)["`]?\s+ON\s+["`]?([\w]+)/i.exec(
          statement,
        );
        return match ? [{ name: match[2]!, table: match[3]!, unique: Boolean(match[1]) }] : [];
      }),
    ),
    ledger: migrations.map((migration) => ({
      hash: migration.hash,
      created_at: migration.folderMillis,
    })),
    // Ordinary trailing data migrations can still run after admission. Every structural migration
    // must already be present; otherwise the owner must use the offline tool.
    requiredLedgerLength: migrations.reduce(
      (count, migration, index) =>
        migration.sql.some((sql) =>
          /\b(?:CREATE|ALTER|DROP)\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\b/i.test(sql),
        )
          ? index + 1
          : count,
      0,
    ),
    normalize,
  };
}
