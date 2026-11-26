import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as sqlite from '@graphgoblin/infrastructure/sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonicalPath } from './canonical-path.js';
import { loadConfig } from './config.js';
import { createContainer } from './container.js';
import { acquireDataDirLock, acquireDatabaseLock } from './data-dir-lock.js';
import { MacosKeySourceError, requireMacosLocalKey } from './macos-local-key.js';
import { startupFailureCause } from './serve.js';

const roots: string[] = [];
const attest = { attestLocalArtifact: true } as const;
const options = { localKeySource: 'macos', startTimers: false } as const;
const databaseName = 'graphgoblin.db';
const keyName = 'master.key';

async function scratch() {
  const root = await mkdtemp(join(tmpdir(), 'gg-mac-key-'));
  roots.push(root);
  const dir = canonicalPath(root);
  const database = join(dir, databaseName);
  const config = loadConfig({
    GG_DATA_DIR: dir,
    GG_DB_URL: pathToFileURL(database).href,
    GG_OLLAMA_ENABLED: 'false',
  });
  return { dir, config, database, key: join(dir, keyName) };
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const dir of roots.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe.runIf(typeof process.geteuid === 'function')('attested writer artifacts', () => {
  it('proves the exact live acquisition and makes proof unavailable as soon as release starts', async () => {
    const { dir } = await scratch();
    const lease = await acquireDataDirLock(dir, undefined, attest);
    const path = join(dir, 'graphgoblin.lock');
    const { dev, ino } = await lstat(path, { bigint: true });
    expect(await lease.verifyOwnedArtifact()).toEqual({ path, dev, ino });
    const pendingProof = lease.verifyOwnedArtifact();
    const release = lease.release();
    expect(await lease.verifyOwnedArtifact()).toBeUndefined();
    expect(await pendingProof).toBeUndefined();
    await release;
    expect(await lease.verifyOwnedArtifact()).toBeUndefined();
  });

  it('cannot use an exact token-bearing copy at a different inode', async () => {
    const { dir } = await scratch();
    const lease = await acquireDataDirLock(dir, undefined, attest);
    try {
      const path = join(dir, 'graphgoblin.lock');
      const old = path + '.old';
      await rename(path, old);
      await writeFile(path, await readFile(old), { mode: 0o600, flag: 'wx' });
      expect((await lstat(path, { bigint: true })).ino).not.toBe(
        (await lstat(old, { bigint: true })).ino,
      );
      expect(await lease.verifyOwnedArtifact()).toBeUndefined();
    } finally {
      await lease.release();
    }
  });

  it.each(['record', 'link', 'mode'] as const)(
    'refuses changed %s on the original locked inode',
    async (change) => {
      const { dir, database } = await scratch();
      const lease = await acquireDatabaseLock(database, attest);
      const path = database + '.graphgoblin.lock';
      try {
        expect(await lease.verifyOwnedArtifact()).toMatchObject({ path });
        if (change === 'link') await link(path, join(dir, 'other-link'));
        else if (change === 'mode') await chmod(path, 0o644);
        else {
          const record = await readFile(path);
          await writeFile(path, Buffer.concat([record, Buffer.from('\n')]));
        }
        expect(await lease.verifyOwnedArtifact()).toBeUndefined();
      } finally {
        await lease.release();
      }
    },
  );

  it('does not attach a proof to ordinary leases', async () => {
    const { dir, database } = await scratch();
    const ordinary = await acquireDataDirLock(dir);
    const sidecar = await acquireDatabaseLock(database);
    try {
      expect(ordinary).not.toHaveProperty('verifyOwnedArtifact');
      expect(sidecar).not.toHaveProperty('verifyOwnedArtifact');
    } finally {
      await sidecar.release();
      await ordinary.release();
    }
  });
});

describe.runIf(typeof process.geteuid === 'function')('Mac-managed store startup', () => {
  it('creates a local key only after actual fresh lease admission', async () => {
    const { config, key } = await scratch();
    const owner = await createContainer(config, options);
    try {
      expect(owner.masterKey).toHaveLength(32);
      expect(Buffer.from((await readFile(key, 'utf8')).trim(), 'base64')).toEqual(owner.masterKey);
    } finally {
      await owner.stop();
    }
    const reopened = await createContainer(config, options);
    try {
      expect(reopened.masterKey).toEqual(owner.masterKey);
    } finally {
      await reopened.stop();
    }
  });

  it('allows admissible key metadata and leaves key decoding to the normal loader', async () => {
    const { config, key } = await scratch();
    await writeFile(key, 'invalid key', { mode: 0o600 });
    await expect(createContainer(config, options)).rejects.toThrow(
      'does not contain a 32-byte key',
    );
  });

  it.each([
    'database',
    'wal',
    'reclaim',
    'other',
    'key-directory',
    'key-symlink',
    'override',
  ] as const)('refuses %s before any SQLite connection or key generation', async (kind) => {
    const { config, dir, key, database } = await scratch();
    if (kind === 'database') await writeFile(database, 'existing database bytes');
    if (kind === 'wal') await writeFile(database + '-wal', 'existing sidecar');
    if (kind === 'reclaim') await mkdir(join(dir, 'unrelated.lock.reclaim'));
    if (kind === 'other') await writeFile(join(dir, 'other'), 'existing data');
    if (kind === 'key-directory') await mkdir(key);
    if (kind === 'key-symlink') await symlink(join(dir, 'unknown-key'), key);

    const readonly = vi.spyOn(sqlite, 'openReadOnlyDatabaseClient');
    const mutable = vi.spyOn(sqlite, 'openDatabase');
    const local = kind === 'override' ? { ...config, masterKey: 'shell-only' } : config;
    const before = (await readdir(dir)).sort();
    await expect(createContainer(local, options)).rejects.toBeInstanceOf(MacosKeySourceError);
    expect(readonly).not.toHaveBeenCalled();
    expect(mutable).not.toHaveBeenCalled();
    expect((await readdir(dir)).sort()).toEqual(before);
    if (kind === 'database')
      expect(await readFile(database, 'utf8')).toBe('existing database bytes');
  });

  it('requires proof from both exact leases and refuses a second filename-only exemption', async () => {
    const { dir, database } = await scratch();
    const directoryLease = await acquireDataDirLock(dir, undefined, attest);
    const databaseLease = await acquireDatabaseLock(database, attest);
    try {
      await expect(
        requireMacosLocalKey(dir, directoryLease, databaseLease, false),
      ).resolves.toBeUndefined();
      const copied = { ...databaseLease, verifyOwnedArtifact: () => Promise.resolve(undefined) };
      await expect(requireMacosLocalKey(dir, directoryLease, copied, false)).rejects.toBeInstanceOf(
        MacosKeySourceError,
      );
      await expect(
        requireMacosLocalKey(dir, directoryLease, directoryLease, false),
      ).rejects.toBeInstanceOf(MacosKeySourceError);
    } finally {
      await databaseLease.release();
      await directoryLease.release();
    }
  });

  it('refuses external or option-bearing SQLite URLs without touching another store', async () => {
    const { config, dir } = await scratch();
    for (const dbUrl of [
      ':memory:',
      pathToFileURL(join(dir, 'external.db')).href,
      config.dbUrl + '?x=1',
    ]) {
      await expect(createContainer({ ...config, dbUrl }, options)).rejects.toBeInstanceOf(
        MacosKeySourceError,
      );
    }
    expect(await readdir(dir)).toEqual([]);
  });

  it('does not follow a local database name that points at a different store', async () => {
    const { config, dir, database } = await scratch();
    await symlink(join(dir, 'elsewhere'), database);
    await expect(createContainer(config, options)).rejects.toBeInstanceOf(MacosKeySourceError);
    expect(await readdir(dir)).toEqual([databaseName]);
  });
});

it('reports key refusal as a fixed closed startup cause', () => {
  expect(startupFailureCause('store', new MacosKeySourceError())).toBe('key-source-unavailable');
});
