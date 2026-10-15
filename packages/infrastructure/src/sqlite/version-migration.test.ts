import { CURRENT_DEFINITION_FORMAT } from '@graphgoblin/contracts';
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import { fakeUlid, FIXTURE_TS, minimalLoop } from '@graphgoblin/contracts/testing';
import { describe, expect, it } from 'vitest';
import { openDatabase } from './db.js';
import { inspectDatabaseUpgrade, applyDatabaseUpgrade } from './upgrade.js';
async function offlineUpgrade(handle: ReturnType<typeof openDatabase>, migrationsFolder?: string) {
  const inventory = await inspectDatabaseUpgrade(handle.client);
  return applyDatabaseUpgrade(
    handle.client,
    {
      format: 'graphgoblin-upgrade-manifest',
      targetVersion: CURRENT_DEFINITION_FORMAT,
      sourceHash: inventory.sourceHash,
      approvedBy: 'test-owner',
      approvedAt: FIXTURE_TS,
      versions: Object.fromEntries(
        inventory.versions.map((version) => [
          version.id,
          { definitionHash: version.definitionHash, resolutions: {} },
        ]),
      ),
      failedRuns: {},
    },
    migrationsFolder ? { migrationsFolder } : {},
  );
}

describe('inference-node harness data migration', () => {
  it('preserves a full pre-upgrade backup and refuses apply until format-4 conversion exists', async () => {
    await mkdir(fileURLToPath(new URL('../../../../.tmp/', import.meta.url)), { recursive: true });
    const root = await mkdtemp(
      fileURLToPath(new URL('../../../../.tmp/gg-backup-reupgrade-', import.meta.url)),
    );
    const source = fileURLToPath(new URL('../../drizzle/', import.meta.url));
    const migrations = join(root, 'previous-migrations');
    const data = join(root, 'data');
    const backup = join(root, 'backup');
    const restored = join(root, 'restored');
    const journal = JSON.parse(await readFile(join(source, 'meta/_journal.json'), 'utf8')) as {
      entries: { idx: number; tag: string }[];
    };
    await mkdir(join(migrations, 'meta'), { recursive: true });
    await mkdir(data);
    for (const entry of journal.entries.filter((entry) => entry.idx < 3)) {
      await copyFile(join(source, `${entry.tag}.sql`), join(migrations, `${entry.tag}.sql`));
    }
    await writeFile(
      join(migrations, 'meta/_journal.json'),
      JSON.stringify({
        ...journal,
        entries: journal.entries.filter((entry) => entry.idx < 3),
      }),
    );
    const canonical = LoopDefinitionSchema.parse(minimalLoop());
    const legacy = {
      ...canonical,
      schemaVersion: 1,
      settings: { ...canonical.settings, defaults: { harness: 'codex' } },
    };
    const databaseUrl = (directory: string) =>
      `file:${join(directory, 'db.sqlite').replace(/\\/g, '/')}`;
    let handle = openDatabase({ url: databaseUrl(data), migrationsFolder: migrations });
    const stored = async () => {
      const row = (await handle.client.execute('SELECT definition FROM loop_versions')).rows[0];
      const definition = row?.['definition'];
      if (typeof definition !== 'string') throw new Error('expected stored definition JSON');
      return JSON.parse(definition) as unknown;
    };
    const stopDatabase = async () => {
      // Checkpoint and release WAL files before copying or removing this Windows file fixture.
      await handle.client.execute('PRAGMA journal_mode = DELETE');
      handle.close();
    };
    try {
      await handle.migrate();
      await handle.client.execute({
        sql: 'INSERT INTO loop_versions (id, loop_id, version, status, definition, created_at, published_at) VALUES (?, ?, 1, ?, ?, ?, ?)',
        args: [
          fakeUlid('backup-version'),
          fakeUlid('backup-loop'),
          'published',
          JSON.stringify(legacy),
          FIXTURE_TS,
          FIXTURE_TS,
        ],
      });
      const ledger = (await handle.client.execute('SELECT * FROM __drizzle_migrations')).rows;
      expect(ledger).toHaveLength(3);
      await stopDatabase();
      await cp(data, backup, { recursive: true });
      handle = openDatabase({ url: databaseUrl(data) });
      await expect(handle.migrate()).rejects.toMatchObject({ code: 'DATA_UPGRADE_REQUIRED' });
      const source = (await inspectDatabaseUpgrade(handle.client)).sourceHash;
      await expect(offlineUpgrade(handle)).rejects.toMatchObject({ code: 'DATA_UPGRADE_REQUIRED' });
      expect((await inspectDatabaseUpgrade(handle.client)).sourceHash).toBe(source);
      expect(await stored()).toEqual(legacy);
      await stopDatabase();
      await cp(backup, restored, { recursive: true });
      handle = openDatabase({ url: databaseUrl(restored) });
      expect(await stored()).toEqual(legacy);
      expect((await handle.client.execute('SELECT * FROM __drizzle_migrations')).rows).toEqual(
        ledger,
      );
      await expect(offlineUpgrade(handle)).rejects.toMatchObject({ code: 'DATA_UPGRADE_REQUIRED' });
      expect(await handle.pendingMigrations()).toBe(9);
    } finally {
      await stopDatabase();
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }, 45_000);
  it('refuses historical field rewrites without changing version metadata or the migration ledger', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'gg-version-migrations-'));
    const source = fileURLToPath(new URL('../../drizzle/', import.meta.url));
    const journal = JSON.parse(await readFile(join(source, 'meta/_journal.json'), 'utf8')) as {
      entries: { idx: number; tag: string }[];
    };
    await mkdir(join(folder, 'meta'));
    for (const entry of journal.entries) {
      await copyFile(join(source, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
    }
    await writeFile(
      join(folder, 'meta/_journal.json'),
      JSON.stringify({ ...journal, entries: journal.entries.filter((entry) => entry.idx < 5) }),
    );
    const handle = openDatabase({ url: ':memory:', migrationsFolder: folder });
    try {
      await handle.migrate();
      const canonical = LoopDefinitionSchema.parse(minimalLoop());
      const preChange = {
        ...canonical,
        schemaVersion: 1,
        settings: { ...canonical.settings, defaults: { harness: 'codex' } },
      };
      const versionId = fakeUlid('rewrite');
      const canonicalId = fakeUlid('unchanged');
      // Raw pre-upgrade JSON bypasses every contracts parser and repository write.
      for (const [id, definition] of [
        [versionId, preChange],
        [
          canonicalId,
          { ...canonical, schemaVersion: 1, settings: { ...canonical.settings, defaults: {} } },
        ],
      ] as const) {
        await handle.client.execute({
          sql: 'INSERT INTO loop_versions (id, loop_id, version, status, definition, created_at, published_at) VALUES (?, ?, 7, ?, ?, ?, ?)',
          args: [
            id,
            fakeUlid('loop'),
            'published',
            JSON.stringify(definition),
            FIXTURE_TS,
            FIXTURE_TS,
          ],
        });
      }
      const before = (await handle.client.execute('SELECT * FROM loop_versions ORDER BY id')).rows;
      await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(journal));
      const ledger = (await handle.client.execute('SELECT * FROM __drizzle_migrations')).rows;
      await expect(offlineUpgrade(handle, folder)).rejects.toMatchObject({
        code: 'DATA_UPGRADE_REQUIRED',
      });
      expect((await handle.client.execute('SELECT * FROM loop_versions ORDER BY id')).rows).toEqual(
        before,
      );
      expect((await handle.client.execute('SELECT * FROM __drizzle_migrations')).rows).toEqual(
        ledger,
      );
    } finally {
      handle.close();
      await rm(folder, { recursive: true, force: true });
    }
  });
});
