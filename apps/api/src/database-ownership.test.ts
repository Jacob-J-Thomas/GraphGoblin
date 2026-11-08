import {
  access,
  link,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  DEFAULT_MODEL_CATALOG,
  openDatabase,
  SqliteModelCatalog,
} from '@graphgoblin/infrastructure/sqlite';
import { acquireDatabaseLock, databaseLockState } from './data-dir-lock.js';
import * as ownership from './data-dir-lock.js';
import { canonicalPath } from './canonical-path.js';
import { loadConfig } from './config.js';
import { createApiKey } from './create-api-key.js';
import { resetDataDirectory } from './reset/reset.js';
import { createTestApp, type TestApp } from './testing/test-app.js';
import { instanceIdentity } from './instance-identity.js';
import { createContainer } from './container.js';

const apps: TestApp[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  vi.restoreAllMocks();
});

it.each([
  { model: 'not-in-catalog', effort: 'low' },
  { model: 'gpt-5.5', effort: 'none' },
])(
  'refuses fresh process defaults $model/$effort before creating an external database parent',
  async (defaults) => {
    const base = await mkdtemp(join(tmpdir(), 'gg-database-admission-'));
    const parent = join(base, 'external');
    await expect(
      createContainer(
        loadConfig({
          GG_DATA_DIR: join(base, 'data'),
          GG_DB_URL: 'file:' + join(parent, 'store.db').replaceAll('\\', '/'),
          GG_DEFAULTS: JSON.stringify({ byHarness: { codex: defaults } }),
        }),
        { startTimers: false },
      ),
    ).rejects.toMatchObject({ code: 'EVALUATION_INVALID_CONFIGURATION' });
    await expect(access(parent)).rejects.toMatchObject({ code: 'ENOENT' });
  },
);

it.each(['catalog', 'format'])(
  'rechecks %s created by a writer before database ownership is acquired',
  async (kind) => {
    const base = await mkdtemp(join(tmpdir(), 'gg-database-admission-race-'));
    const database = join(base, 'external', 'store.db');
    const url = 'file:' + database.replaceAll('\\', '/');
    const acquire = ownership.acquireDatabaseLock;
    let before: Buffer | undefined;
    vi.spyOn(ownership, 'acquireDatabaseLock').mockImplementationOnce(async (file) => {
      // The second actor creates its store after fresh pure admission but before the first actor
      // can own the file. Actual SQLite and the real exclusive lock exercise both race outcomes.
      const writer = await acquire(file);
      try {
        const handle = openDatabase({ url });
        try {
          if (kind === 'catalog') {
            await handle.migrate();
            const seed = DEFAULT_MODEL_CATALOG.find(
              (entry) => entry.harness === 'codex' && entry.model === 'gpt-6-luna',
            )!;
            await new SqliteModelCatalog(handle.db).upsert({
              ...seed,
              source: 'litellm',
              efforts: ['high'],
              defaultEffort: 'high',
            });
            await handle.client.execute('PRAGMA journal_mode=DELETE');
          } else {
            await handle.client.execute('CREATE TABLE old_data(id TEXT)');
          }
        } finally {
          handle.close();
        }
        before = await readFile(database);
      } finally {
        await writer.release();
      }
      return acquire(file);
    });
    await expect(
      createContainer(loadConfig({ GG_DATA_DIR: join(base, 'data'), GG_DB_URL: url }), {
        startTimers: false,
      }),
    ).rejects.toMatchObject({
      code: kind === 'catalog' ? 'EVALUATION_INVALID_CONFIGURATION' : 'STORE_UNSUPPORTED',
    });
    expect(before).toBeDefined();
    expect(await readFile(database)).toEqual(before);
    await expect(access(join(base, 'data', 'master.key'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  },
);

it('refuses multiply hard-linked databases before acquiring a writer lock', async () => {
  const base = await mkdtemp(join(tmpdir(), 'gg-database-hardlink-'));
  const database = join(base, 'store.db');
  const alias = join(base, 'alias.db');
  await writeFile(database, 'keep');
  await link(database, alias);
  await expect(acquireDatabaseLock(database)).rejects.toThrow(/multiple hard links/);
  await expect(acquireDatabaseLock(alias)).rejects.toThrow(/multiple hard links/);
  expect(await readFile(database, 'utf8')).toBe('keep');
  expect(await databaseLockState(database)).toEqual({ state: 'free' });
});

it('locks the same external SQLite file across data directories and refuses an offline key writer', async () => {
  const base = await mkdtemp(join(tmpdir(), 'gg-database-owner-'));
  const database = join(base, 'external.db');
  const url = 'file:' + database.replaceAll('\\', '/');
  const app = await createTestApp({ env: { GG_DB_URL: url } });
  apps.push(app);
  const before = await readFile(database);
  expect((await databaseLockState(database)).state).toBe('held');
  await expect(createTestApp({ env: { GG_DB_URL: url } })).rejects.toThrow(
    /another GraphGoblin process holds .*external.db.graphgoblin.lock/,
  );
  await expect(
    createApiKey(loadConfig({ GG_DATA_DIR: join(base, 'other'), GG_DB_URL: url }), {
      label: 'refused',
      scopes: ['system:read'],
    }),
  ).rejects.toThrow(/external.db.graphgoblin.lock/);
  expect(await readFile(database)).toEqual(before);
  await app.close();
  apps.pop();
  expect(await databaseLockState(database)).toEqual({ state: 'free' });
  const next = await createTestApp({ env: { GG_DB_URL: url } });
  apps.push(next);
});

it('canonicalizes directory aliases, future database paths and the health identity without writing', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'gg-database-alias-')));
  const physical = join(base, 'physical');
  const alias = join(base, 'alias');
  await mkdir(physical);
  await symlink(physical, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const future = join(physical, 'future', 'store.db');
  expect(canonicalPath(join(alias, 'future', 'store.db'))).toBe(future);
  const lock = await acquireDatabaseLock(future);
  try {
    await expect(acquireDatabaseLock(join(alias, 'future', 'store.db'))).rejects.toThrow(
      /another GraphGoblin process holds/,
    );
    const first = loadConfig({
      GG_DATA_DIR: physical,
      GG_DB_URL: 'file:' + future.replaceAll('\\', '/'),
    });
    const second = {
      ...first,
      dataDir: alias,
      dbUrl: 'file:' + join(alias, 'future', 'store.db').replaceAll('\\', '/'),
    };
    expect(instanceIdentity(second)).toBe(instanceIdentity(first));
  } finally {
    await lock.release();
  }
  const next = await acquireDatabaseLock(future);
  await next.release();
});

it.each([false, true])(
  'refuses reset before store reads while a writer owns the database (file exists: %s)',
  async (exists) => {
    const base = await mkdtemp(join(tmpdir(), 'gg-database-reset-'));
    const database = join(base, 'store.db');
    if (exists) await writeFile(database, 'keep');
    const readStore = vi
      .fn()
      .mockResolvedValue({ readable: true, format: 4, status: 'complete', runIds: [] });
    const lock = await acquireDatabaseLock(database);
    try {
      for (const confirmed of [false, true]) {
        await expect(
          resetDataDirectory(
            { dataDir: base, dbUrl: 'file:' + database.replaceAll('\\', '/') },
            { confirmed, dataDir: base },
            {
              write: () => undefined,
              readStore,
            },
          ),
        ).rejects.toThrow(/another GraphGoblin process holds/);
      }
      expect(readStore).not.toHaveBeenCalled();
      if (exists) expect(await readFile(database, 'utf8')).toBe('keep');
      else await expect(access(database)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await lock.release();
    }
  },
);
