import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { CURRENT_DEFINITION_FORMAT } from '@graphgoblin/contracts';
import { createClient, type Client, type InValue } from '@libsql/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { fileURLToPath } from 'node:url';

export type StoreReader = Pick<Client, 'execute'>;
export type StoreRow = Record<string, unknown>;

export const quote = (name: string): string => '"' + name.replaceAll('"', '""') + '"';

/** Plain row objects keyed by column name. */
export async function rows(
  client: StoreReader,
  sql: string,
  args: InValue[] = [],
): Promise<StoreRow[]> {
  const result = await client.execute({ sql, args });
  return result.rows.map((row) =>
    Object.fromEntries(result.columns.map((column) => [column, row[column]])),
  );
}

export const SHIPPED_MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url));
// The shipped migration that completes the current format's structure. Changing the format is an
// explicit decision that moves this baseline; older stores are reset, not converted (ADR-0042).
export const FORMAT_BASELINES = {
  4: '0013_trigger_configuration',
} satisfies Record<typeof CURRENT_DEFINITION_FORMAT, string>;
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
export async function storeStructure(client: StoreReader) {
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

/** Rows per keyset batch when the guard parses every stored definition. */
const STORE_BATCH_SIZE = 500;

/** Keyset batches by rowid, yielding to the event loop between batches. */
export async function* tableBatches(
  client: StoreReader,
  table: string,
  selection: { where?: string } = {},
): AsyncGenerator<StoreRow[]> {
  let after: number | undefined;
  for (;;) {
    const batch = await rows(
      client,
      'SELECT rowid AS __gg_rowid,* FROM ' +
        quote(table) +
        ' WHERE ' +
        (selection.where ? '(' + selection.where + ') AND ' : '') +
        (after === undefined ? '1' : 'rowid>?') +
        ' ORDER BY rowid LIMIT ?',
      after === undefined ? [STORE_BATCH_SIZE] : [after, STORE_BATCH_SIZE],
    );
    if (!batch.length) return;
    after = Number(batch.at(-1)!.__gg_rowid);
    for (const row of batch) delete row.__gg_rowid;
    yield batch;
    // Local libsql promises can settle without returning to the event loop. Give native
    // statement finalizers and other work a turn between batches.
    await yieldToEventLoop();
  }
}
