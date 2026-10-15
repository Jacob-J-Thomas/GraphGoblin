import { afterEach, expect, it } from 'vitest';
import { CURRENT_DEFINITION_FORMAT } from '@graphgoblin/contracts';
import { minimalLoop, FIXTURE_IDS, FIXTURE_TS } from '@graphgoblin/contracts/testing';
import { openMemoryDatabase, type DatabaseHandle } from './db.js';
import { guardDatabaseUpgrade } from './upgrade.js';
import { currentStoreReadiness } from './readiness.js';

const handles: DatabaseHandle[] = [];
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
});

it.each([
  ['missing table', 'DROP TABLE template_instances'],
  ['missing column', 'ALTER TABLE loops DROP COLUMN description'],
  [
    'ledger hash mismatch',
    "UPDATE __drizzle_migrations SET hash='wrong' WHERE created_at=(SELECT min(created_at) FROM __drizzle_migrations)",
  ],
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
  const readiness = currentStoreReadiness();
  expect(readiness.marker.format_version).toBe(CURRENT_DEFINITION_FORMAT);
  expect(
    (await handle.client.execute('SELECT format_version FROM gg_upgrade_state')).rows[0]
      ?.format_version,
  ).toBe(CURRENT_DEFINITION_FORMAT);
  expect(
    (
      await handle.client.execute(
        'SELECT hash,created_at FROM __drizzle_migrations ORDER BY created_at',
      )
    ).rows,
  ).toEqual(readiness.ledger);
});
