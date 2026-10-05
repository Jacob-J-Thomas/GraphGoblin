import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  LoopDefinitionSchema,
  type ClassifierModelEntry,
  type ClassifierModelPut,
} from '@graphgoblin/contracts';
import { fakeUlid, FIXTURE_TS, minimalLoop, sampleThread } from '@graphgoblin/contracts/testing';
import { openDatabase, openMemoryDatabase } from './db.js';
import { ClassifierManagedError, SqliteClassifierModels } from './classifiers.js';
import { SqliteSecrets } from './secrets.js';

const builtin: ClassifierModelEntry = {
  id: 'jev',
  displayName: 'Jev',
  source: 'builtin',
  provider: 'typesafe',
  providerModel: 'jev-latest',
  primitives: ['choice', 'noul', 'score'],
  endpoint: 'https://api.typesafe.ai',
  secretRef: 'jev-api-key',
  enabled: true,
};
const metadata: ClassifierModelPut = {
  displayName: 'Kev',
  provider: 'http',
  providerModel: 'kev-latest',
  primitives: ['choice'],
  endpoint: 'http://127.0.0.1:8008',
  secretRef: 'kev-key',
};
describe('classifier repository', () => {
  it('scopes rows by owner, preserves enabled on edits/seeds, clears optional auth, protects the built-in', async () => {
    const handle = await openMemoryDatabase();
    const repo = new SqliteClassifierModels(handle.db);
    try {
      await repo.seedBuiltin('local', builtin);
      await repo.setEnabled('local', 'jev', false);
      await repo.seedBuiltin('local', { ...builtin, displayName: 'Refreshed' });
      expect(await repo.findOne('local', 'jev')).toEqual({
        ...builtin,
        displayName: 'Refreshed',
        enabled: false,
      });
      await repo.seedBuiltin('other', builtin);
      expect(await repo.findOne('other', 'jev')).toEqual(builtin);
      expect(await repo.upsert('local', 'kev', metadata)).toEqual({
        id: 'kev',
        source: 'custom',
        ...metadata,
        enabled: false,
      });
      await repo.setEnabled('local', 'kev', true);
      const { secretRef: _secret, ...noAuth } = metadata;
      const edited = await repo.upsert('local', 'kev', { ...noAuth, displayName: 'Edited' });
      expect(edited).toMatchObject({ id: 'kev', enabled: true, displayName: 'Edited' });
      expect(edited).not.toHaveProperty('secretRef');
      expect(await repo.list('local')).toEqual([await repo.findOne('local', 'jev'), edited]);
      for (const id of ['zebra', 'alpha', 'beta']) await repo.upsert('local', id, metadata);
      expect((await repo.list('local')).map((model) => model.id)).toEqual([
        'jev',
        'alpha',
        'beta',
        'kev',
        'zebra',
      ]);
      expect((await repo.list('other')).map((model) => model.id)).toEqual(['jev']);
      expect(await repo.findOne('other', 'kev')).toBeUndefined();
      expect(await repo.setEnabled('other', 'kev', false)).toBeUndefined();
      expect(await repo.delete('other', 'kev')).toBe(false);
      await expect(repo.upsert('local', 'jev', metadata)).rejects.toBeInstanceOf(
        ClassifierManagedError,
      );
      await expect(repo.delete('local', 'jev')).rejects.toMatchObject({
        code: 'CLASSIFIER_MANAGED_BY_SYSTEM',
      });
      await expect(
        repo.seedBuiltin('local', { id: 'custom', source: 'custom', ...metadata, enabled: false }),
      ).rejects.toBeInstanceOf(ClassifierManagedError);
      expect(await repo.delete('local', 'kev')).toBe(true);
      expect(await repo.delete('local', 'kev')).toBe(false);
    } finally {
      handle.close();
    }
  });
  it.each([3, 6])(
    'upgrades a database at %i migrations without rewriting existing data and reruns idempotently',
    async (count) => {
      const dir = await mkdtemp(join(tmpdir(), 'gg-classifier-migration-'));
      const source = fileURLToPath(new URL('../../drizzle/', import.meta.url));
      const journal = JSON.parse(await readFile(join(source, 'meta/_journal.json'), 'utf8')) as {
        entries: { idx: number; tag: string }[];
      };
      await mkdir(join(dir, 'meta'));
      for (const migration of journal.entries)
        await copyFile(join(source, `${migration.tag}.sql`), join(dir, `${migration.tag}.sql`));
      await writeFile(
        join(dir, 'meta/_journal.json'),
        JSON.stringify({ ...journal, entries: journal.entries.slice(0, count) }),
      );
      const handle = openDatabase({ url: ':memory:', migrationsFolder: dir });
      try {
        await handle.migrate();
        const definition = JSON.stringify(LoopDefinitionSchema.parse(minimalLoop()));
        await handle.client.execute({
          sql: 'INSERT INTO loop_versions (id, loop_id, version, status, definition, created_at, published_at) VALUES (?, ?, 1, ?, ?, ?, ?)',
          args: [
            fakeUlid('version'),
            fakeUlid('loop'),
            'published',
            definition,
            FIXTURE_TS,
            FIXTURE_TS,
          ],
        });
        await handle.client.execute({
          sql: 'INSERT INTO runs (id, owner_id, loop_id, version_id, invocation_id, status, iteration, created_at, initial_thread) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)',
          args: [
            fakeUlid('run'),
            'local',
            fakeUlid('loop'),
            fakeUlid('version'),
            fakeUlid('invocation'),
            'waiting',
            FIXTURE_TS,
            JSON.stringify(sampleThread()),
          ],
        });
        await handle.client.execute({
          sql: 'INSERT INTO model_catalog (harness, model, display_name, efforts, default_effort, enabled) VALUES (?, ?, ?, ?, ?, ?)',
          args: ['codex', 'local-only', 'Unchanged', '["low"]', 'low', 0],
        });
        const secrets = new SqliteSecrets(
          handle.db,
          { now: () => new Date(FIXTURE_TS) },
          Buffer.alloc(32, 9),
          'local',
        );
        await secrets.set('kev-key', 'retained');
        const versions = (await handle.client.execute('SELECT * FROM loop_versions')).rows;
        const secretRows = (await handle.client.execute('SELECT * FROM secrets')).rows;
        const runs = (await handle.client.execute('SELECT * FROM runs')).rows;
        await writeFile(join(dir, 'meta/_journal.json'), JSON.stringify(journal));
        expect(await handle.pendingMigrations()).toBe(7 - count);
        await handle.migrate();
        expect((await handle.client.execute('SELECT * FROM loop_versions')).rows).toEqual(versions);
        expect((await handle.client.execute('SELECT * FROM runs')).rows).toEqual(runs);
        expect((await handle.client.execute('SELECT * FROM secrets')).rows).toEqual(secretRows);
        expect((await handle.client.execute('SELECT * FROM model_catalog')).rows[0]).toMatchObject({
          model: 'local-only',
          display_name: 'Unchanged',
          efforts: '["low"]',
          default_effort: 'low',
          enabled: 0,
          source: 'harness',
        });
        const repo = new SqliteClassifierModels(handle.db);
        await repo.seedBuiltin('local', builtin);
        await repo.setEnabled('local', 'jev', false);
        const ledger = (await handle.client.execute('SELECT * FROM __drizzle_migrations')).rows;
        await handle.migrate();
        await repo.seedBuiltin('local', builtin);
        expect(await handle.pendingMigrations()).toBe(0);
        expect((await handle.client.execute('SELECT * FROM __drizzle_migrations')).rows).toEqual(
          ledger,
        );
        expect((await repo.findOne('local', 'jev'))?.enabled).toBe(false);
        expect(await secrets.resolve('kev-key')).toBe('retained');
      } finally {
        handle.close();
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
});
