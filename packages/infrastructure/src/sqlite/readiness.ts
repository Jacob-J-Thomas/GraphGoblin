import { CURRENT_DEFINITION_FORMAT } from '@graphgoblin/contracts';
import { createClient } from '@libsql/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { fileURLToPath } from 'node:url';
import { rows, quote, type UpgradeReader } from './upgrade-scan.js';

export const SHIPPED_MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url));
// Moving the current format also requires an explicit format/SQL baseline decision.
export const FORMAT_BASELINES = {
  3: '0008_github_triggers',
  4: '0013_trigger_configuration',
} satisfies Record<typeof CURRENT_DEFINITION_FORMAT | 3, string>;
export const normalizeStoreSql = (sql: string) =>
  sql
    .toLowerCase()
    .replace(/\bif\s+not\s+exists\s+/g, '')
    .replace(/[\s"`]/g, '');

/** Read CHECK expressions with balanced parentheses, including nested JSON/function calls. */
function checks(sql: string): string[] {
  const found: string[] = [];
  const pattern = /\bCHECK\s*\(/gi;
  for (let match = pattern.exec(sql); match; match = pattern.exec(sql)) {
    let depth = 1;
    let index = pattern.lastIndex;
    let quoted = false;
    while (depth && index < sql.length) {
      const character = sql[index++];
      if (character === "'") {
        if (quoted && sql[index] === "'") index += 1;
        else quoted = !quoted;
      } else if (!quoted) {
        if (character === '(') depth += 1;
        if (character === ')') depth -= 1;
      }
    }
    found.push(normalizeStoreSql(sql.slice(match.index, index)));
    pattern.lastIndex = index;
  }
  return found;
}
export async function storeStructure(client: UpgradeReader) {
  const tables = [];
  for (const table of await rows(
    client,
    "SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  )) {
    const name = String(table.name);
    const ddl = String(table.sql);
    tables.push({
      name,
      columns: (await rows(client, 'PRAGMA table_info(' + quote(name) + ')')).map((column) => ({
        name: String(column.name),
        notNull: Number(column.notnull),
        pk: Number(column.pk),
      })),
      checks: checks(ddl),
      constraints: [...ddl.matchAll(/\bCONSTRAINT\s+["`]?([\w]+)["`]?/gi)].map(
        (match) => match[1]!,
      ),
      indexes: (
        await rows(
          client,
          "SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL ORDER BY name",
          [name],
        )
      ).map((index) => ({ name: String(index.name), sql: normalizeStoreSql(String(index.sql)) })),
    });
  }
  return tables;
}
async function migrationStructure(migrations: ReturnType<typeof readMigrationFiles>) {
  const client = createClient({ url: ':memory:' });
  try {
    for (const migration of migrations)
      for (const statement of migration.sql) await client.execute(statement);
    return await storeStructure(client);
  } finally {
    client.close();
  }
}
async function describe(migrationsFolder: string) {
  const journal = JSON.parse(
    readFileSync(join(SHIPPED_MIGRATIONS, 'meta/_journal.json'), 'utf8'),
  ) as {
    entries: { tag: string; when: number }[];
  };
  const baselineTag = FORMAT_BASELINES[CURRENT_DEFINITION_FORMAT];
  const baselineTime = journal.entries.find((entry) => entry.tag === baselineTag)!.when;
  const shipped = readMigrationFiles({ migrationsFolder: SHIPPED_MIGRATIONS });
  const selected = readMigrationFiles({ migrationsFolder });
  // An extension folder can contain only migrations newer than the shipped set. Historical
  // prefix folders used by SQL fixtures still describe their own earlier target.
  const migrations = selected.some(
    (migration) => migration.folderMillis > shipped.at(-1)!.folderMillis,
  )
    ? [
        ...new Map(
          [...shipped, ...selected].map((migration) => [migration.folderMillis, migration]),
        ).values(),
      ].sort((a, b) => a.folderMillis - b.folderMillis)
    : selected;
  return {
    marker: { format_version: CURRENT_DEFINITION_FORMAT, status: 'complete' },
    baselineTag,
    baseline: await migrationStructure(
      shipped.filter((migration) => migration.folderMillis <= baselineTime),
    ),
    head: await migrationStructure(migrations),
    ledger: migrations.map((migration) => ({ created_at: migration.folderMillis })),
    requiredLedgerLength: shipped.filter((migration) => migration.folderMillis <= baselineTime)
      .length,
  };
}
let shippedDescriptor: ReturnType<typeof describe> | undefined;
/** Catalogues come from executing shipped SQL, so rename/drop/IF NOT EXISTS follow SQLite itself. */
export function currentStoreReadiness(migrationsFolder = SHIPPED_MIGRATIONS) {
  if (migrationsFolder !== SHIPPED_MIGRATIONS) return describe(migrationsFolder);
  return (shippedDescriptor ??= describe(migrationsFolder));
}
