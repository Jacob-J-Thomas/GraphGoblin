import { copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import { fakeUlid, FIXTURE_TS, minimalLoop } from '@graphgoblin/contracts/testing';
import { describe, expect, it } from 'vitest';
import { openDatabase } from './db.js';

describe('inference-node harness data migration', () => {
  it('restores a full pre-upgrade backup after 0006 and reapplies every migration on re-upgrade', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gg-backup-reupgrade-'));
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
      await handle.migrate();
      expect(await stored()).toEqual(canonical);
      expect((await handle.client.execute('SELECT * FROM __drizzle_migrations')).rows).toHaveLength(
        8,
      );
      await stopDatabase();

      // Restore the whole stopped data directory into an empty destination, including its ledger.
      await cp(backup, restored, { recursive: true });
      handle = openDatabase({ url: databaseUrl(restored), migrationsFolder: migrations });
      await handle.migrate();
      expect(await stored()).toEqual(legacy);
      expect((await handle.client.execute('SELECT * FROM __drizzle_migrations')).rows).toEqual(
        ledger,
      );
      await stopDatabase();
      handle = openDatabase({ url: databaseUrl(restored) });
      expect(await handle.pendingMigrations()).toBe(5);
      await handle.migrate();
      expect(LoopDefinitionSchema.parse(await stored())).toEqual(canonical);
      expect(await handle.pendingMigrations()).toBe(0);
      expect((await handle.client.execute('SELECT * FROM __drizzle_migrations')).rows).toHaveLength(
        8,
      );
      expect((await handle.client.execute('SELECT * FROM classifier_models')).rows).toEqual([]);
    } finally {
      await stopDatabase();
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }, 45_000);
  it('rewrites the removed field once, preserves canonical rows and version metadata', async () => {
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
        settings: { ...canonical.settings, defaults: { harness: 'codex' } },
      };
      const versionId = fakeUlid('rewrite');
      const canonicalId = fakeUlid('unchanged');
      // Raw pre-upgrade JSON bypasses every contracts parser and repository write.
      for (const [id, definition] of [
        [versionId, preChange],
        [canonicalId, canonical],
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
      await handle.migrate();
      const after = (await handle.client.execute('SELECT * FROM loop_versions ORDER BY id')).rows;
      const rewritten = after.find((row) => row['id'] === versionId)!;
      const stored = rewritten['definition'];
      if (typeof stored !== 'string') throw new Error('expected stored definition JSON');
      expect(LoopDefinitionSchema.parse(JSON.parse(stored))).toEqual(canonical);
      expect(after.find((row) => row['id'] === canonicalId)).toEqual(
        before.find((row) => row['id'] === canonicalId),
      );
      expect({ ...rewritten, definition: undefined }).toEqual({
        ...before.find((row) => row['id'] === versionId),
        definition: undefined,
      });
      const ledger = (await handle.client.execute('SELECT * FROM __drizzle_migrations')).rows;
      await handle.migrate();
      expect((await handle.client.execute('SELECT * FROM loop_versions ORDER BY id')).rows).toEqual(
        after,
      );
      expect((await handle.client.execute('SELECT * FROM __drizzle_migrations')).rows).toEqual(
        ledger,
      );
      const migration = journal.entries.find((entry) => entry.idx === 5)!;
      expect(
        (await handle.client.execute(await readFile(join(source, `${migration.tag}.sql`), 'utf8')))
          .rowsAffected,
      ).toBe(0);
    } finally {
      handle.close();
      await rm(folder, { recursive: true, force: true });
    }
  });
});
