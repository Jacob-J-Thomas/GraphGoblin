import { link, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { acquireDatabaseLock, databaseLockState } from './data-dir-lock.js';
import { canonicalPath } from './canonical-path.js';
import { loadConfig } from './config.js';
import { createApiKey } from './create-api-key.js';
import { resetDataDirectory } from './reset/reset.js';
import { createTestApp, type TestApp } from './testing/test-app.js';
import { instanceIdentity } from './instance-identity.js';

const apps: TestApp[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});

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
  const base = await mkdtemp(join(tmpdir(), 'gg-database-alias-'));
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

it('refuses reset previews and confirmations while another data directory owns that database', async () => {
  const base = await mkdtemp(join(tmpdir(), 'gg-database-reset-'));
  const database = join(base, 'store.db');
  await writeFile(database, 'keep');
  const lock = await acquireDatabaseLock(database);
  try {
    for (const confirmed of [false, true]) {
      await expect(
        resetDataDirectory(
          { dataDir: base, dbUrl: 'file:' + database.replaceAll('\\', '/') },
          { confirmed, dataDir: base },
          {
            write: () => undefined,
            readStore: () =>
              Promise.resolve({ readable: true, format: 4, status: 'complete', runIds: [] }),
          },
        ),
      ).rejects.toThrow(/another GraphGoblin process holds/);
    }
    expect(await readFile(database, 'utf8')).toBe('keep');
  } finally {
    await lock.release();
  }
});
