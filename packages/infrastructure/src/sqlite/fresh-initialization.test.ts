import { createClient, type Client, type Transaction, type TransactionMode } from '@libsql/client';
import type * as Libsql from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, type DatabaseHandle } from './db.js';
import { guardDatabaseUpgrade, initializeFreshDatabase } from './upgrade.js';

vi.mock('@libsql/client', async (importOriginal) => {
  const actual = await importOriginal<typeof Libsql>();
  return { ...actual, createClient: vi.fn(actual.createClient) };
});

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));
const shipped = readMigrationFiles({ migrationsFolder });
const handles: DatabaseHandle[] = [];
const directories: string[] = [];

// Release all test references before retried removal on Windows. Collect only when the worker
// was already started with gc exposed; cleanup must succeed rather than silently leak stores.
afterEach(async () => {
  for (const handle of handles.splice(0)) handle.close();
  vi.mocked(createClient).mockClear();
  await new Promise<void>((resolve) => setImmediate(resolve));
  globalThis.gc?.();
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    expect(existsSync(directory)).toBe(false);
  }
});

function storeUrl(): string {
  const directory = mkdtempSync(join(tmpdir(), 'gg-fresh-init-'));
  directories.push(directory);
  return pathToFileURL(join(directory, 'test.db')).href;
}
function open(url: string): DatabaseHandle {
  const handle = openDatabase({ url });
  handles.push(handle);
  return handle;
}
async function tableNames(client: Pick<Client, 'execute'>): Promise<string[]> {
  return (
    await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
  ).rows.map((row) => {
    if (typeof row.name !== 'string') throw new Error('Expected a table name');
    return row.name;
  });
}
async function snapshot(client: Client) {
  const schema = (await client.execute('SELECT * FROM sqlite_master ORDER BY name')).rows;
  const contents = [];
  for (const name of await tableNames(client)) {
    const result = await client.execute('SELECT * FROM "' + name.replaceAll('"', '""') + '"');
    contents.push([name, result.rows]);
  }
  return { schema, contents };
}

type Boundary =
  'after schema persistence' | 'before marker creation' | 'before marker-row persistence';
async function failAt(boundary: Boundary, rollbackError?: Error) {
  const actual = await vi.importActual<typeof Libsql>('@libsql/client');
  const error = new Error('Interrupted ' + boundary);
  let failures = 0;
  let rollbackFailures = 0;
  vi.mocked(createClient).mockImplementationOnce((options) => {
    const inner = actual.createClient(options);
    return new Proxy(inner, {
      get(target, prop, receiver) {
        if (prop === 'transaction')
          return async (mode?: TransactionMode) => {
            const tx = await target.transaction(mode);
            return new Proxy(tx, {
              get(transaction, key, txReceiver) {
                if (key === 'rollback' && rollbackError)
                  return () => {
                    rollbackFailures += 1;
                    return Promise.reject(rollbackError);
                  };
                if (key === 'execute')
                  return async (statement: Parameters<Transaction['execute']>[0]) => {
                    const sql = typeof statement === 'string' ? statement : statement.sql;
                    const afterSchema =
                      boundary === 'after schema persistence' &&
                      sql.startsWith('INSERT INTO __drizzle_migrations') &&
                      typeof statement !== 'string' &&
                      Array.isArray(statement.args) &&
                      statement.args[1] === shipped.at(-1)?.folderMillis;
                    const beforeMarker =
                      boundary === 'before marker creation' &&
                      sql.startsWith('CREATE TABLE IF NOT EXISTS gg_upgrade_state');
                    const beforeRow =
                      boundary === 'before marker-row persistence' &&
                      sql.startsWith('INSERT INTO gg_upgrade_state');
                    if (afterSchema) await transaction.execute(statement);
                    if (afterSchema || beforeMarker || beforeRow) {
                      expect(await tableNames(transaction)).toContain('loops');
                      expect(
                        (await transaction.execute('SELECT * FROM __drizzle_migrations')).rows,
                      ).toHaveLength(shipped.length);
                      if (beforeRow)
                        expect(
                          (await transaction.execute('SELECT * FROM gg_upgrade_state')).rows,
                        ).toEqual([]);
                      else expect(await tableNames(transaction)).not.toContain('gg_upgrade_state');
                      failures += 1;
                      throw error;
                    }
                    return transaction.execute(statement);
                  };
                const value: unknown = Reflect.get(transaction, key, txReceiver);
                return typeof value === 'function'
                  ? (value as (...args: unknown[]) => unknown).bind(transaction)
                  : value;
              },
            });
          };
        const value: unknown = Reflect.get(target, prop, receiver);
        return typeof value === 'function'
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value;
      },
    });
  });
  return { error, failures: () => failures, rollbackFailures: () => rollbackFailures };
}

describe('atomic fresh SQLite initialisation', () => {
  it.each<Boundary>([
    'after schema persistence',
    'before marker creation',
    'before marker-row persistence',
  ])('rolls back an interruption %s and recovers on restart', async (boundary) => {
    const failure = await failAt(boundary);
    const url = storeUrl();
    const interrupted = open(url);
    await expect(interrupted.migrate()).rejects.toBe(failure.error);
    expect(failure.failures()).toBe(1);
    expect(await tableNames(interrupted.client)).toEqual([]);
    interrupted.close();

    const restarted = open(url);
    expect(await tableNames(restarted.client)).toEqual([]);
    await restarted.migrate();
    expect(await guardDatabaseUpgrade(restarted.client)).toBe('current');
    expect((await restarted.client.execute('SELECT * FROM gg_upgrade_state')).rows).toMatchObject([
      {
        id: 1,
        format_version: 3,
        status: 'complete',
        source_hash: 'fresh',
        manifest_hash: 'fresh',
      },
    ]);
    expect(
      (await restarted.client.execute('SELECT hash, created_at FROM __drizzle_migrations')).rows,
    ).toEqual(
      shipped.map((migration) => ({ hash: migration.hash, created_at: migration.folderMillis })),
    );
    const completed = await snapshot(restarted.client);
    await restarted.migrate();
    expect(await snapshot(restarted.client)).toEqual(completed);
  });

  it('applies pending ordinary migrations when another initialiser wins the write-lock race', async () => {
    const url = storeUrl();
    const folder = fileURLToPath(new URL('migrations/', url));
    mkdirSync(join(folder, 'meta'), { recursive: true });
    writeFileSync(
      join(folder, 'meta/_journal.json'),
      JSON.stringify({
        version: '7',
        dialect: 'sqlite',
        entries: [
          {
            idx: 0,
            version: '6',
            when: shipped.at(-1)!.folderMillis + 1,
            tag: '0000_after_race',
            breakpoints: true,
          },
        ],
      }),
    );
    writeFileSync(
      join(folder, '0000_after_race.sql'),
      'CREATE TABLE startup_migration_effect (id INTEGER PRIMARY KEY);\n--> statement-breakpoint\nINSERT INTO startup_migration_effect VALUES (1);',
    );
    const actual = await vi.importActual<typeof Libsql>('@libsql/client');
    let races = 0;
    vi.mocked(createClient).mockImplementationOnce((options) => {
      const inner = actual.createClient(options);
      return new Proxy(inner, {
        get(target, prop, receiver) {
          if (prop === 'transaction')
            return async (mode?: TransactionMode) => {
              // The first guard saw an empty store. Complete the other initialiser just before
              // this one acquires its write lock, leaving a later ordinary migration pending.
              races += 1;
              const winner = open(url);
              await expect(initializeFreshDatabase(winner.client)).resolves.toBe('fresh');
              return target.transaction(mode);
            };
          const value: unknown = Reflect.get(target, prop, receiver);
          return typeof value === 'function'
            ? (value as (...args: unknown[]) => unknown).bind(target)
            : value;
        },
      });
    });
    const handle = openDatabase({ url, migrationsFolder: folder });
    handles.push(handle);
    await handle.migrate();
    expect(races).toBe(1);
    expect(await handle.pendingMigrations()).toBe(0);
    expect((await handle.client.execute('SELECT * FROM startup_migration_effect')).rows).toEqual([
      { id: 1 },
    ]);
    expect((await handle.client.execute('SELECT * FROM __drizzle_migrations')).rows).toHaveLength(
      shipped.length + 1,
    );
    const completed = await snapshot(handle.client);
    await handle.migrate();
    expect(await snapshot(handle.client)).toEqual(completed);
  });

  it('preserves the original initialisation error when rollback also fails', async () => {
    const failure = await failAt('before marker-row persistence', new Error('Lost connection'));
    const url = storeUrl();
    const interrupted = open(url);
    await expect(interrupted.migrate()).rejects.toBe(failure.error);
    expect(failure.failures()).toBe(1);
    expect(failure.rollbackFailures()).toBe(1);
    // Closing the unsettled transaction still releases the real local connection and its writes.
    expect(await tableNames(interrupted.client)).toEqual([]);
    interrupted.close();
    const restarted = open(url);
    await restarted.migrate();
    expect(await guardDatabaseUpgrade(restarted.client)).toBe('current');
  });

  it('initialises once and preserves schema, ledger, marker and data across repeated starts', async () => {
    const url = storeUrl();
    const first = open(url);
    expect(await first.pendingMigrations()).toBe(shipped.length);
    await first.migrate();
    expect(await first.pendingMigrations()).toBe(0);
    await first.client.execute(
      "INSERT INTO settings (owner_id,key,value,updated_at) VALUES ('o','retained','1','now')",
    );
    const completed = await snapshot(first.client);
    await first.migrate();
    // A second initializer that observed freshness before the first committed must do nothing.
    await expect(initializeFreshDatabase(first.client)).resolves.toBe('current');
    expect(await snapshot(first.client)).toEqual(completed);
    first.close();
    const restarted = open(url);
    await restarted.migrate();
    await restarted.migrate();
    expect(await snapshot(restarted.client)).toEqual(completed);
  });

  it('accepts an empty migration ledger without treating recorded history as fresh', async () => {
    const handle = open(storeUrl());
    await handle.client.execute(
      'CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)',
    );
    await handle.migrate();
    expect(await guardDatabaseUpgrade(handle.client)).toBe('current');
    expect(await handle.pendingMigrations()).toBe(0);
  });

  it.each([
    'unmarked schema with empty application tables',
    'populated unmarked store',
    'marker table without its row',
    'incomplete upgrade state',
    'old complete format marker',
    'recorded migration-only damaged store',
  ])('refuses a %s without changing it on either start', async (state) => {
    const url = storeUrl();
    const prepared = open(url);
    if (state === 'recorded migration-only damaged store') {
      await prepared.client.execute(
        'CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)',
      );
      await prepared.client.execute({
        sql: 'INSERT INTO __drizzle_migrations(hash,created_at) VALUES (?,?)',
        args: [shipped[0]!.hash, shipped[0]!.folderMillis],
      });
    } else if (state === 'incomplete upgrade state' || state === 'old complete format marker') {
      await prepared.migrate();
      await prepared.client.execute(
        state === 'incomplete upgrade state'
          ? "UPDATE gg_upgrade_state SET status='applying'"
          : 'UPDATE gg_upgrade_state SET format_version=2',
      );
    } else {
      // Reproduce schema persistence without the fresh stamp using Drizzle's real migrator.
      await migrate(drizzle(prepared.client), { migrationsFolder });
      if (state === 'populated unmarked store')
        await prepared.client.execute(
          "INSERT INTO settings (owner_id,key,value,updated_at) VALUES ('o','retained','1','now')",
        );
      if (state === 'marker table without its row')
        await prepared.client.execute(
          'CREATE TABLE gg_upgrade_state (id INTEGER PRIMARY KEY CHECK(id=1), format_version INTEGER NOT NULL, status TEXT NOT NULL, source_hash TEXT NOT NULL, manifest_hash TEXT NOT NULL)',
        );
    }
    const original = await snapshot(prepared.client);
    await expect(prepared.migrate()).rejects.toMatchObject({ code: 'DATA_UPGRADE_REQUIRED' });
    expect(await snapshot(prepared.client)).toEqual(original);
    prepared.close();
    const restarted = open(url);
    await expect(restarted.migrate()).rejects.toMatchObject({ code: 'DATA_UPGRADE_REQUIRED' });
    expect(await snapshot(restarted.client)).toEqual(original);
  });

  it('rechecks freshness under the write lock and refuses an unmarked schema', async () => {
    const handle = open(storeUrl());
    expect(await guardDatabaseUpgrade(handle.client)).toBe('fresh');
    await handle.client.execute('CREATE TABLE unknown_store (value TEXT)');
    const original = await snapshot(handle.client);
    await expect(initializeFreshDatabase(handle.client)).rejects.toMatchObject({
      code: 'DATA_UPGRADE_REQUIRED',
    });
    expect(await snapshot(handle.client)).toEqual(original);
  });
});
