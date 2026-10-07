import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { openDatabase, openMemoryDatabase, type DatabaseHandle } from './db.js';
import { DEFAULT_MODEL_CATALOG, SqliteModelCatalog } from './settings.js';

function previousMigrations(dir: string, count: number): string {
  const folder = join(dir, 'migrations');
  mkdirSync(join(folder, 'meta'), { recursive: true });
  const source = fileURLToPath(new URL('../../drizzle/', import.meta.url));
  const journal = JSON.parse(readFileSync(join(source, 'meta/_journal.json'), 'utf8')) as {
    entries: { idx: number; tag: string }[];
  };
  journal.entries = journal.entries.filter((entry) => entry.idx < count);
  writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify(journal));
  for (const entry of journal.entries)
    copyFileSync(join(source, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  return folder;
}

async function upgrade(check: (db: DatabaseHandle) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'gg-catalog-'));
  // 1.0.0 database: checkpoint migration is present, max-effort/source migrations are absent.
  const folder = previousMigrations(dir, 3);
  const url = `file:${join(dir, 'legacy.db').replace(/\\/g, '/')}`;
  const old = openDatabase({ url, migrationsFolder: folder });
  try {
    await old.migrate();
    for (const [model, displayName, efforts, defaultEffort, enabled] of [
      ['gpt-6-luna', 'GPT-6 Luna', '["minimal","low","medium","high","xhigh"]', 'low', 1],
      ['gpt-6-sol', 'Edited Sol', '["low"]', 'low', 0],
      ['hand-added', 'Custom', '["high"]', 'high', 0],
    ] as const) {
      await old.client.execute({
        sql: 'INSERT INTO model_catalog (harness, model, display_name, efforts, default_effort, enabled) VALUES (?, ?, ?, ?, ?, ?)',
        args: ['codex', model, displayName, efforts, defaultEffort, enabled],
      });
    }
  } finally {
    old.close();
  }
  const current = openDatabase({ url });
  try {
    expect(await current.pendingMigrations()).toBe(5);
    await current.migrate();
    await check(current);
    expect(await current.pendingMigrations()).toBe(0);
    const before = await current.client.execute('SELECT * FROM model_catalog');
    await current.migrate();
    expect((await current.client.execute('SELECT * FROM model_catalog')).rows).toEqual(before.rows);
  } finally {
    current.close();
    // Windows can retain libsql's file handles briefly after close; retry cleanup as in db tests.
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }).catch(
      () => undefined,
    );
  }
}

describe('model catalog source migration and repository', () => {
  it('adds source on a fresh database and defaults direct legacy inserts to harness', async () => {
    const handle = await openMemoryDatabase();
    try {
      const columns = (await handle.client.execute('PRAGMA table_info(model_catalog)')).rows;
      expect(columns.find((row) => row['name'] === 'source')).toMatchObject({
        notnull: 1,
        dflt_value: "'harness'",
      });
      const catalog = new SqliteModelCatalog(handle.db);
      expect(await catalog.seed()).toBe(DEFAULT_MODEL_CATALOG.length);
      expect((await catalog.list()).every((row) => row.source === 'harness')).toBe(true);
      expect(await catalog.findOne('codex', 'missing')).toBeUndefined();
      expect(await catalog.setEnabled('codex', 'missing', true)).toBeUndefined();
      const before = (await catalog.findOne('codex', 'gpt-6-luna'))!;
      expect(await catalog.setEnabled('codex', before.model, false)).toEqual({
        ...before,
        enabled: false,
      });
      expect(await catalog.setEnabled('codex', before.model, true)).toEqual(before);
    } finally {
      handle.close();
    }
  });

  it('preserves seeded, edited, and hand-added 1.0.0 rows, then refreshes only seed metadata', async () => {
    await upgrade(async (handle) => {
      const catalog = new SqliteModelCatalog(handle.db);
      const rows = await catalog.list();
      expect(rows).toHaveLength(3);
      expect(rows.every((row) => row.source === 'harness')).toBe(true);
      expect(await catalog.findOne('codex', 'gpt-6-sol')).toMatchObject({
        displayName: 'Edited Sol',
        efforts: ['low'],
        defaultEffort: 'low',
        enabled: false,
      });
      const hand = await catalog.findOne('codex', 'hand-added');
      expect(hand).toMatchObject({
        displayName: 'Custom',
        efforts: ['high'],
        defaultEffort: 'high',
        enabled: false,
      });
      await catalog.seed();
      expect(await catalog.findOne('codex', 'gpt-6-sol')).toEqual({
        ...DEFAULT_MODEL_CATALOG.find((row) => row.model === 'gpt-6-sol')!,
        enabled: false,
      });
      expect(await catalog.findOne('codex', 'hand-added')).toEqual(hand);
      await catalog.setEnabled('codex', 'gpt-6-luna', false);
      expect(await catalog.seed()).toBe(0);
      expect((await catalog.findOne('codex', 'gpt-6-luna'))?.enabled).toBe(false);
    });
  });

  it('runs the previous release without SQL rollback and retains provenance on re-upgrade', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gg-catalog-rollback-'));
    const folder = previousMigrations(dir, 4);
    const url = `file:${join(dir, 'rollback.db').replace(/\\/g, '/')}`;
    let handle = openDatabase({ url });
    try {
      await handle.migrate();
      const catalog = new SqliteModelCatalog(handle.db);
      await catalog.seed();
      await catalog.setEnabled('codex', 'gpt-6-luna', false);
      await catalog.upsert({
        harness: 'local',
        model: 'local-model',
        source: 'litellm',
        displayName: 'Local',
        efforts: ['low'],
        defaultEffort: 'low',
        enabled: false,
      });
      const rows = (await handle.client.execute('SELECT * FROM model_catalog')).rows;
      const ledger = (await handle.client.execute('SELECT * FROM __drizzle_migrations')).rows;
      handle.close();
      handle = openDatabase({ url, migrationsFolder: folder });
      expect(await handle.pendingMigrations()).toBe(0);
      await handle.migrate();
      expect((await handle.client.execute('SELECT * FROM model_catalog')).rows).toEqual(rows);
      expect((await handle.client.execute('SELECT * FROM __drizzle_migrations')).rows).toEqual(
        ledger,
      );
      await handle.client.execute({
        sql: 'INSERT INTO model_catalog (harness, model, display_name, efforts, default_effort, enabled) VALUES (?, ?, ?, ?, ?, ?)',
        args: ['codex', 'old-insert', 'Old insert', '["low"]', 'low', 0],
      });
      const after = (await handle.client.execute('SELECT * FROM model_catalog')).rows;
      handle.close();
      handle = openDatabase({ url });
      expect(await handle.pendingMigrations()).toBe(0);
      await handle.migrate();
      expect((await handle.client.execute('SELECT * FROM model_catalog')).rows).toEqual(after);
      expect((await handle.client.execute('SELECT * FROM __drizzle_migrations')).rows).toEqual(
        ledger,
      );
      const upgraded = new SqliteModelCatalog(handle.db);
      expect(await upgraded.findOne('local', 'local-model')).toMatchObject({
        source: 'litellm',
        enabled: false,
      });
      expect(await upgraded.findOne('codex', 'old-insert')).toMatchObject({
        source: 'harness',
        enabled: false,
      });
      expect(await upgraded.findOne('codex', 'gpt-6-luna')).toMatchObject({ enabled: false });
    } finally {
      handle.close();
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }).catch(
        () => undefined,
      );
    }
  });

  it('never refreshes a LiteLLM row that shares a seed key and toggles either source', async () => {
    const handle = await openMemoryDatabase();
    try {
      const catalog = new SqliteModelCatalog(handle.db);
      const local = {
        ...DEFAULT_MODEL_CATALOG[0]!,
        source: 'litellm' as const,
        displayName: 'Local',
        efforts: ['high' as const],
        defaultEffort: 'high' as const,
        enabled: false,
      };
      await catalog.upsert(local);
      await catalog.seed();
      expect(await catalog.findOne(local.harness, local.model)).toEqual(local);
      expect(await catalog.setEnabled(local.harness, local.model, true)).toEqual({
        ...local,
        enabled: true,
      });
    } finally {
      handle.close();
    }
  });

  it('can roll back the column and migration record without losing model data', async () => {
    const handle = await openMemoryDatabase();
    try {
      const catalog = new SqliteModelCatalog(handle.db);
      await catalog.seed();
      const rows = (await catalog.list()).map(({ source: _source, ...row }) => row);
      await handle.client.execute('ALTER TABLE model_catalog DROP COLUMN source');
      await handle.client.execute('DROP TABLE classifier_models');
      await handle.client.execute(
        'DELETE FROM __drizzle_migrations WHERE created_at >= 1791136800000',
      );
      expect(await handle.pendingMigrations()).toBe(4);
      await handle.migrate();
      expect(await catalog.list()).toEqual(rows.map((row) => ({ ...row, source: 'harness' })));
    } finally {
      handle.close();
    }
  });
});
