import { afterEach, describe, expect, it } from 'vitest';
import { CURRENT_DEFINITION_FORMAT } from '@graphgoblin/contracts';
import type { Client } from '@libsql/client';
import { openDatabase, openMemoryDatabase, type DatabaseHandle } from './db.js';
import { rows } from './readiness.js';
import { guardCurrentStore, UnsupportedStoreError, verifyStoreHead } from './store-format.js';

const handles: DatabaseHandle[] = [];
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
});

async function snapshot(client: Client) {
  const names = (
    await rows(client, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
  ).map((row) => String(row.name));
  return {
    schema: (await client.execute('SELECT * FROM sqlite_master ORDER BY name')).rows,
    rows: await Promise.all(
      names.map(async (name) => [
        name,
        await rows(client, 'SELECT * FROM "' + name + '" ORDER BY rowid'),
      ]),
    ),
  };
}

const damaged = (detail: string) =>
  'The format-' + String(CURRENT_DEFINITION_FORMAT) + ' store is damaged: ' + detail;

describe('current-format store guard', () => {
  it.each([
    [
      "UPDATE gg_upgrade_state SET status='pending'",
      CURRENT_DEFINITION_FORMAT,
      'The store format marker records an unfinished change (status "pending")',
    ],
    ['DELETE FROM gg_upgrade_state', undefined, 'The store format marker is missing or malformed'],
    [
      'DROP TABLE gg_upgrade_state',
      undefined,
      'The store has no format marker; an older GraphGoblin build wrote it',
    ],
    [
      "UPDATE gg_upgrade_state SET format_version='four'",
      undefined,
      'The store format marker is missing or malformed',
    ],
    [
      'UPDATE gg_upgrade_state SET format_version=3',
      3,
      'The store is format 3; this build reads only format ' + String(CURRENT_DEFINITION_FORMAT),
    ],
    [
      'UPDATE gg_upgrade_state SET format_version=99',
      99,
      'The store is format 99; this build reads only format ' + String(CURRENT_DEFINITION_FORMAT),
    ],
    [
      'DROP INDEX runs_parent_idx',
      CURRENT_DEFINITION_FORMAT,
      damaged('incomplete indexes in runs'),
    ],
    [
      'CREATE TABLE template_instances (id TEXT)',
      CURRENT_DEFINITION_FORMAT,
      damaged('retired template storage is still present'),
    ],
    [
      'ALTER TABLE runs ADD COLUMN template_subject TEXT',
      CURRENT_DEFINITION_FORMAT,
      damaged('retired template storage is still present'),
    ],
    [
      'DELETE FROM __drizzle_migrations WHERE created_at=(SELECT max(created_at) FROM __drizzle_migrations)',
      CURRENT_DEFINITION_FORMAT,
      damaged('the migration ledger is behind the store structure'),
    ],
    [
      "INSERT INTO settings VALUES ('local','defaultModel','\"gpt-6-luna\"','2026-10-17T00:00:00.000Z')",
      CURRENT_DEFINITION_FORMAT,
      damaged('owner settings use the retired defaultModel/defaultEffort keys'),
    ],
    [
      "INSERT INTO settings VALUES ('local','defaults','not JSON','2026-10-17T00:00:00.000Z')",
      CURRENT_DEFINITION_FORMAT,
      damaged('owner harness defaults are invalid'),
    ],
    [
      "INSERT INTO loop_versions(id,loop_id,version,status,definition,created_at) VALUES ('v1','loop',1,'draft','{\"schemaVersion\":3}','2026-10-17T00:00:00.000Z')",
      CURRENT_DEFINITION_FORMAT,
      damaged('stored loop version v1 is not a valid definition'),
    ],
  ] as const)(
    'refuses %s before any startup write and names what it found',
    async (sql, foundFormat, reason) => {
      const handle = await openMemoryDatabase();
      handles.push(handle);
      await handle.client.execute(sql);
      const before = await snapshot(handle.client);
      const refusal = await handle.migrate().then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(refusal).toBeInstanceOf(UnsupportedStoreError);
      expect(refusal).toMatchObject({
        code: 'STORE_UNSUPPORTED',
        message: reason,
        reason,
        foundFormat,
        requiredFormat: CURRENT_DEFINITION_FORMAT,
      });
      expect(await snapshot(handle.client)).toEqual(before);
    },
  );

  it('refuses a recorded ledger without application tables and permits a truly empty ledger', async () => {
    const handle = openDatabase({ url: ':memory:' });
    handles.push(handle);
    await handle.client.execute(
      'CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY,hash TEXT,created_at NUMERIC)',
    );
    expect(await guardCurrentStore(handle.client)).toBe('fresh');
    await handle.client.execute("INSERT INTO __drizzle_migrations VALUES(1,'old',1)");
    await expect(guardCurrentStore(handle.client)).rejects.toMatchObject({
      code: 'STORE_UNSUPPORTED',
      reason: 'The store records applied migrations but has no application tables',
    });
  });

  it('accepts a complete current store at the head and refuses a fresh store as a head', async () => {
    const handle = await openMemoryDatabase();
    handles.push(handle);
    await expect(verifyStoreHead(handle.client)).resolves.toBeUndefined();
    const empty = openDatabase({ url: ':memory:' });
    handles.push(empty);
    await expect(verifyStoreHead(empty.client)).rejects.toMatchObject({
      code: 'STORE_UNSUPPORTED',
      reason: 'Migrations did not produce a current store',
    });
  });
});
