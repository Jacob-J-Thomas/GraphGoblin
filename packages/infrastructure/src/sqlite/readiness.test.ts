import { afterEach, expect, it } from 'vitest';
import { CURRENT_DEFINITION_FORMAT } from '@graphgoblin/contracts';
import { minimalLoop, FIXTURE_IDS, FIXTURE_TS } from '@graphgoblin/contracts/testing';
import { openDatabase, openMemoryDatabase, type DatabaseHandle } from './db.js';
import { guardDatabaseUpgrade } from './upgrade.js';
import { currentStoreReadiness, SHIPPED_MIGRATIONS } from './readiness.js';

const handles: DatabaseHandle[] = [];
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
});

it.each([
  ['missing table', 'DROP TABLE webhook_receipts'],
  ['missing column', 'ALTER TABLE loops DROP COLUMN description'],
  [
    'ledger timestamp mismatch',
    'UPDATE __drizzle_migrations SET created_at=created_at+1 WHERE created_at=(SELECT min(created_at) FROM __drizzle_migrations)',
  ],
  [
    'missing ledger entry',
    'DELETE FROM __drizzle_migrations WHERE created_at=(SELECT min(created_at) FROM __drizzle_migrations)',
  ],
  ['wrong marker', 'UPDATE gg_upgrade_state SET format_version=99'],
])('refuses %s before any startup write', async (_name, sql) => {
  const handle = await openMemoryDatabase();
  handles.push(handle);
  await handle.client.execute(sql);
  const statements: string[] = [];
  await expect(
    guardDatabaseUpgrade({
      execute: (query) => {
        statements.push(typeof query === 'string' ? query : query.sql);
        return handle.client.execute(query);
      },
    }),
  ).rejects.toMatchObject({ code: 'DATA_UPGRADE_REQUIRED' });
  expect(statements.every((sql) => /^(SELECT|PRAGMA (table_info|index_list))/i.test(sql))).toBe(
    true,
  );
});

it('refuses malformed stored definitions before any startup write', async () => {
  const handle = await openMemoryDatabase();
  handles.push(handle);
  await handle.client.execute({
    sql: 'INSERT INTO loop_versions(id,loop_id,version,status,definition,created_at) VALUES (?,?,1,?,?,?)',
    args: [
      FIXTURE_IDS.version,
      FIXTURE_IDS.loop,
      'published',
      JSON.stringify({ ...minimalLoop(), removedField: true }),
      FIXTURE_TS,
    ],
  });
  const statements: string[] = [];
  await expect(
    guardDatabaseUpgrade({
      execute: (query) => {
        statements.push(typeof query === 'string' ? query : query.sql);
        return handle.client.execute(query);
      },
    }),
  ).rejects.toMatchObject({ code: 'DATA_UPGRADE_REQUIRED' });
  expect(statements.some((sql) => /journal_mode|busy_timeout/i.test(sql))).toBe(false);
});

it('derives current readiness and the fresh marker from the format constant and shipped ledger', async () => {
  const handle = await openMemoryDatabase();
  handles.push(handle);
  const readiness = await currentStoreReadiness();
  expect(readiness.marker.format_version).toBe(CURRENT_DEFINITION_FORMAT);
  expect(
    (await handle.client.execute('SELECT format_version FROM gg_upgrade_state')).rows[0]
      ?.format_version,
  ).toBe(CURRENT_DEFINITION_FORMAT);
  expect(
    (await handle.client.execute('SELECT created_at FROM __drizzle_migrations ORDER BY created_at'))
      .rows,
  ).toEqual(readiness.ledger);
});

it('accepts historical applied hashes because Drizzle identifies migrations by timestamp', async () => {
  const handle = await openMemoryDatabase();
  handles.push(handle);
  await handle.client.execute("UPDATE __drizzle_migrations SET hash='historically-edited-sql'");
  await expect(handle.migrate()).resolves.toBeUndefined();
});

import { readMigrationFiles } from 'drizzle-orm/migrator';
async function through(index: number) {
  const handle = openDatabase({ url: ':memory:' });
  handles.push(handle);
  await handle.client.execute(
    'CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT, created_at INTEGER)',
  );
  const migrations = readMigrationFiles({ migrationsFolder: SHIPPED_MIGRATIONS });
  for (const migration of migrations.slice(0, index + 1)) {
    for (const statement of migration.sql) await handle.client.execute(statement);
    await handle.client.execute({
      sql: 'INSERT INTO __drizzle_migrations(hash,created_at) VALUES (?,?)',
      args: [migration.hash, migration.folderMillis],
    });
  }
  await handle.client.execute(
    'CREATE TABLE gg_upgrade_state (id INTEGER PRIMARY KEY,format_version INTEGER,status TEXT)',
  );
  await handle.client.execute({
    sql: "INSERT INTO gg_upgrade_state VALUES (1,?,'complete')",
    args: [CURRENT_DEFINITION_FORMAT],
  });
  return handle;
}
it.each([8, 9, 10, 11])(
  'refuses a format-4 marker whose ledger stops before the baseline at migration %s',
  async (index) => {
    const handle = await through(index);
    const before = (await handle.client.execute('SELECT * FROM __drizzle_migrations')).rows;
    const schema = (await handle.client.execute('SELECT * FROM sqlite_master ORDER BY name')).rows;
    await expect(guardDatabaseUpgrade(handle.client)).rejects.toMatchObject({
      code: 'DATA_UPGRADE_REQUIRED',
    });
    await expect(handle.migrate()).rejects.toMatchObject({ code: 'DATA_UPGRADE_REQUIRED' });
    expect((await handle.client.execute('SELECT * FROM __drizzle_migrations')).rows).toEqual(
      before,
    );
    expect((await handle.client.execute('SELECT * FROM sqlite_master ORDER BY name')).rows).toEqual(
      schema,
    );
  },
);
it('refuses a head ledger with missing additive structure after a no-op migration', async () => {
  const handle = await openMemoryDatabase();
  handles.push(handle);
  await handle.client.execute('DROP TABLE classifier_models');
  await expect(guardDatabaseUpgrade(handle.client)).rejects.toMatchObject({
    code: 'DATA_UPGRADE_REQUIRED',
  });
  const before = (await handle.client.execute('SELECT * FROM __drizzle_migrations')).rows;
  await expect(handle.migrate()).rejects.toThrow('Missing current-store table: classifier_models');
  expect((await handle.client.execute('SELECT * FROM __drizzle_migrations')).rows).toEqual(before);
});
it('requires the shipped baseline constraint names as well as their expressions', async () => {
  const handle = await through(12);
  const ddl = (
    await handle.client.execute("SELECT sql FROM sqlite_master WHERE name='webhook_receipts'")
  ).rows[0]!.sql;
  if (typeof ddl !== 'string') throw new Error('Expected table SQL');
  await handle.client.execute('DROP TABLE webhook_receipts');
  await handle.client.execute(ddl.replace('webhook_receipt_status_check', 'wrong_constraint'));
  await expect(guardDatabaseUpgrade(handle.client)).rejects.toThrow(
    'Stored constraints are incomplete',
  );
});
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
it('derives dropped and IF NOT EXISTS indexes from the executed migration catalogue', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'gg-readiness-indexes-'));
  const handle = openDatabase({ url: ':memory:', migrationsFolder: folder });
  try {
    await cp(SHIPPED_MIGRATIONS, folder, { recursive: true });
    const path = join(folder, 'meta/_journal.json');
    const journal = JSON.parse(await readFile(path, 'utf8')) as {
      entries: { idx: number; when: number; tag: string; version: string; breakpoints: boolean }[];
    };
    const last = journal.entries.at(-1)!;
    journal.entries.push({
      ...last,
      idx: last.idx + 1,
      when: last.when + 1,
      tag: '0013_index_probe',
    });
    await writeFile(path, JSON.stringify(journal));
    await writeFile(
      join(folder, '0013_index_probe.sql'),
      'DROP INDEX runs_parent_idx;\n--> statement-breakpoint\nCREATE INDEX IF NOT EXISTS gate_probe_idx ON runs(id);\n--> statement-breakpoint\nCREATE INDEX IF NOT EXISTS gate_probe_idx ON runs(id);',
    );
    const descriptor = await currentStoreReadiness(folder);
    const indexes = descriptor.head
      .find((table) => table.name === 'runs')!
      .indexes.map((index) => index.name);
    expect(indexes).not.toContain('runs_parent_idx');
    expect(indexes).toContain('gate_probe_idx');
    expect(indexes).not.toContain('IF');
    await handle.migrate();
    expect(await handle.pendingMigrations()).toBe(0);
  } finally {
    handle.close();
    await rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

it('refuses a complete format-3 marker at 0011 without applying cutover SQL', async () => {
  const handle = await through(11);
  await handle.client.execute('UPDATE gg_upgrade_state SET format_version=3');
  const before = (await handle.client.execute('SELECT * FROM gg_upgrade_state')).rows;
  const schema = (await handle.client.execute('SELECT * FROM sqlite_master ORDER BY name')).rows;
  await expect(handle.migrate()).rejects.toMatchObject({ code: 'DATA_UPGRADE_REQUIRED' });
  expect((await handle.client.execute('SELECT * FROM gg_upgrade_state')).rows).toEqual(before);
  expect((await handle.client.execute('SELECT * FROM sqlite_master ORDER BY name')).rows).toEqual(
    schema,
  );
});
