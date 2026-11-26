import { access, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspect } from 'node:util';
import * as sqlite from '@graphgoblin/infrastructure/sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from './config.js';
import { createContainer } from './container.js';
import * as locks from './data-dir-lock.js';
import { ProcessDefaultsRefusedError } from './defaults-refusal.js';
import { MacosKeySourceError } from './macos-local-key.js';
import * as masterKey from './master-key.js';
import { shellFailureOutput, startupFailureCause } from './serve.js';
import { cleanupStep, StartupCleanupError } from './startup-cleanup.js';
import { StoreRefusedError } from './store-refusal.js';

// #560: createContainer setup cleanup after a failure. Only these seams are interposed: the real
// SQLite clients' close, the real leases' release and, to fail after every resource is acquired,
// the master-key load. Stores, lock files and leases are real and disposable.
vi.mock('@graphgoblin/infrastructure/sqlite', async (original) => {
  const actual = await original<typeof sqlite>();
  return {
    ...actual,
    openDatabase: vi.fn(actual.openDatabase),
    openReadOnlyDatabaseClient: vi.fn(actual.openReadOnlyDatabaseClient),
  };
});
vi.mock('./data-dir-lock.js', async (original) => {
  const actual = await original<typeof locks>();
  return {
    ...actual,
    acquireDataDirLock: vi.fn(actual.acquireDataDirLock),
    acquireDatabaseLock: vi.fn(actual.acquireDatabaseLock),
  };
});
vi.mock('./master-key.js', async (original) => {
  const actual = await original<typeof masterKey>();
  return { ...actual, loadMasterKey: vi.fn(actual.loadMasterKey) };
});
const actualSqlite = await vi.importActual<typeof sqlite>('@graphgoblin/infrastructure/sqlite');
const actualLocks = await vi.importActual<typeof locks>('./data-dir-lock.js');

type Fault =
  | 'readonly-database-close'
  | 'database-close'
  | 'database-lease-release'
  | 'directory-lease-release';
const injected = (fault: Fault) =>
  Object.assign(new Error(`synthetic ${fault} refusal`), { code: 'EIO' });

let dataDir: string;
let database: string;
let faults: Map<Fault, Error>;
let calls: string[];
const held: locks.DataDirLock[] = [];

/** Each fault is injected once, and a failed release keeps its real lease held. */
function arm(...armed: Fault[]) {
  for (const fault of armed) faults.set(fault, injected(fault));
  return faults;
}

function wrapLease(kind: 'database' | 'directory', lease: locks.DataDirLock): locks.DataDirLock {
  held.push(lease);
  return {
    ...lease,
    async release() {
      const step: Fault = `${kind}-lease-release`;
      calls.push(step);
      const fault = faults.get(step);
      if (fault) throw fault;
      return lease.release();
    },
  };
}

beforeEach(async () => {
  dataDir = await realpath(await mkdtemp(join(tmpdir(), 'gg-startup-cleanup-')));
  database = join(dataDir, 'graphgoblin.db');
  faults = new Map();
  calls = [];
  vi.mocked(sqlite.openReadOnlyDatabaseClient).mockImplementation((file) => {
    const client = actualSqlite.openReadOnlyDatabaseClient(file);
    return new Proxy(client, {
      get(target, key) {
        if (key === 'close')
          return () => {
            calls.push('readonly-database-close');
            // The fixture really closes first; startup must still treat the close as unconfirmed.
            target.close();
            const fault = faults.get('readonly-database-close');
            if (fault) throw fault;
          };
        const value: unknown = Reflect.get(target, key, target);
        const forwarded: unknown = typeof value === 'function' ? value.bind(target) : value;
        return forwarded;
      },
    });
  });
  vi.mocked(sqlite.openDatabase).mockImplementation((options) => {
    const handle = actualSqlite.openDatabase(options);
    return {
      ...handle,
      close() {
        calls.push('database-close');
        handle.close();
        const fault = faults.get('database-close');
        if (fault) throw fault;
      },
    };
  });
  vi.mocked(locks.acquireDataDirLock).mockImplementation(
    async (directory: string, filename?: string, attestation?: { attestLocalArtifact: true }) =>
      wrapLease(
        'directory',
        attestation
          ? await actualLocks.acquireDataDirLock(directory, filename, attestation)
          : await actualLocks.acquireDataDirLock(directory, filename),
      ),
  );
  vi.mocked(locks.acquireDatabaseLock).mockImplementation(
    async (file: string, attestation?: { attestLocalArtifact: true }) =>
      wrapLease(
        'database',
        attestation
          ? await actualLocks.acquireDatabaseLock(file, attestation)
          : await actualLocks.acquireDatabaseLock(file),
      ),
  );
});

afterEach(async () => {
  // Leases a failed startup retained are this fixture's own; release them for the next case.
  for (const lease of held.splice(0)) await lease.release().catch(() => undefined);
  vi.mocked(masterKey.loadMasterKey).mockReset();
  vi.mocked(sqlite.openDatabase).mockReset();
  vi.mocked(sqlite.openReadOnlyDatabaseClient).mockReset();
  vi.mocked(locks.acquireDataDirLock).mockReset();
  vi.mocked(locks.acquireDatabaseLock).mockReset();
  globalThis.gc?.();
  await rm(dataDir, { recursive: true, force: true, maxRetries: 5 }).catch(() => undefined);
});

function config(env: Record<string, string> = {}) {
  return loadConfig({
    GG_DATA_DIR: dataDir,
    GG_DB_URL: pathToFileURL(database).href,
    GG_SWAGGER_UI: 'false',
    GG_MASTER_KEY: Buffer.alloc(32, 7).toString('base64'),
    GG_OLLAMA_ENABLED: 'false',
    ...env,
  });
}

/** Fail at the master-key load: after both leases, any read-only check and the SQLite open. */
function failAtMasterKey() {
  const primary = Object.assign(new Error('synthetic master key failure'), { code: 'EACCES' });
  vi.mocked(masterKey.loadMasterKey).mockRejectedValueOnce(primary);
  return primary;
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('startup unexpectedly succeeded');
    },
    (error: unknown) => error,
  );
}

const directoryLock = () => join(dataDir, 'graphgoblin.lock');
const databaseLock = () => `${database}.graphgoblin.lock`;
const present = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

/** Whether each lease is still held: its real record names this process. */
async function expectHeld(expected: { directory: boolean; database: boolean }) {
  for (const [path, isHeld] of [
    [directoryLock(), expected.directory],
    [databaseLock(), expected.database],
  ] as const) {
    expect(await present(path)).toBe(isHeld);
    if (isHeld)
      expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ pid: process.pid });
  }
  expect(await actualLocks.dataDirLockState(dataDir)).toMatchObject({
    state: expected.directory ? 'held' : 'free',
  });
}

function expectTagged(
  error: unknown,
  primary: unknown,
  steps: [string, string][],
  retained: { resource: string; path: string }[],
) {
  expect(error).toBeInstanceOf(StartupCleanupError);
  const tagged = error as StartupCleanupError;
  expect(tagged.primary).toBe(primary);
  expect(tagged.errors[0]).toBe(primary);
  expect(tagged.cause).toBe(primary);
  expect(tagged.cleanup.map(({ operation, code }) => [operation, code])).toEqual(steps);
  tagged.cleanup.forEach(({ error: secondary }, index) => {
    expect(tagged.errors[index + 1]).toBe(secondary);
    if (faults.has(steps[index]![0] as Fault))
      expect(secondary).toBe(faults.get(steps[index]![0] as Fault));
  });
  expect(tagged.retained).toEqual(retained);
  return tagged;
}

const retainedBoth = () => [
  { resource: 'database-lease', path: database },
  { resource: 'directory-lease', path: dataDir },
];

describe('mutable SQLite setup failure cleanup', () => {
  it('returns the exact original failure when every cleanup step succeeds', async () => {
    const primary = failAtMasterKey();
    arm();
    const error = await failure(createContainer(config(), { startTimers: false }));
    expect(error).toBe(primary);
    expect(calls).toEqual(['database-close', 'database-lease-release', 'directory-lease-release']);
    await expectHeld({ directory: false, database: false });
    expect(shellFailureOutput(error)).toBe(error);
    expect(startupFailureCause('store', error)).toBe('store-unavailable');
  });

  it('retains both leases and releases neither after an unconfirmed database close', async () => {
    const primary = failAtMasterKey();
    // The release faults are armed too: neither release may even be attempted.
    arm('database-close', 'database-lease-release', 'directory-lease-release');
    const error = await failure(createContainer(config(), { startTimers: false }));
    const tagged = expectTagged(error, primary, [['database-close', 'EIO']], retainedBoth());
    expect(calls).toEqual(['database-close']);
    await expectHeld({ directory: true, database: true });
    await expect(createContainer(config(), { startTimers: false })).rejects.toThrow(
      `another GraphGoblin process holds ${directoryLock()}`,
    );
    const output = shellFailureOutput(error) as string;
    expect(output).toBe(
      `${inspect(primary)}\ncleanup also failed: database-close (EIO); ownership retained: database lease ${database}, data-directory lease ${dataDir}`,
    );
    expect(output).not.toContain('synthetic database-close refusal');
    expect(tagged.detail).toBe(output.split('\n').at(-1));
    expect(startupFailureCause('store', error)).toBe('store-unavailable');
  });

  it.each([
    [
      'the database lease',
      ['database-lease-release'],
      { directory: false, database: true },
      ['database-lease'],
    ],
    [
      'the directory lease',
      ['directory-lease-release'],
      { directory: true, database: false },
      ['directory-lease'],
    ],
    [
      'both leases',
      ['database-lease-release', 'directory-lease-release'],
      { directory: true, database: true },
      ['database-lease', 'directory-lease'],
    ],
  ] as const)(
    'attempts each lease release once, in order, when releasing %s fails',
    async (_name, armed, stillHeld, kept) => {
      const primary = failAtMasterKey();
      arm(...armed);
      const error = await failure(createContainer(config(), { startTimers: false }));
      expect(calls).toEqual([
        'database-close',
        'database-lease-release',
        'directory-lease-release',
      ]);
      expectTagged(
        error,
        primary,
        armed.map((step) => [step, 'EIO']),
        retainedBoth().filter(({ resource }) => (kept as readonly string[]).includes(resource)),
      );
      await expectHeld(stillHeld);
      expect(startupFailureCause('store', error)).toBe('store-unavailable');
    },
  );
});

describe('setup failure cleanup without a database lease', () => {
  it.each([
    ['a directory lease release failure', ['directory-lease-release'], ['directory-lease-release']],
    ['an unconfirmed in-memory database close', ['database-close'], []],
  ] as const)('reports %s for an in-memory store', async (_name, armed, released) => {
    const primary = failAtMasterKey();
    arm(...armed);
    const error = await failure(
      createContainer(config({ GG_DB_URL: ':memory:' }), { startTimers: false }),
    );
    expect(calls).toEqual(['database-close', ...released]);
    expectTagged(
      error,
      primary,
      armed.map((step) => [step, 'EIO']),
      [{ resource: 'directory-lease', path: dataDir }],
    );
    await expectHeld({ directory: true, database: false });
  });

  it('keeps a GG_DEFAULTS refusal before any database lease as the classified primary', async () => {
    arm('directory-lease-release');
    const error = await failure(
      createContainer(
        config({
          GG_DEFAULTS: JSON.stringify({
            byHarness: { codex: { model: 'missing', effort: 'low' } },
          }),
        }),
        { startTimers: false },
      ),
    );
    expect(calls).toEqual(['directory-lease-release']);
    const tagged = error as StartupCleanupError;
    expect(tagged.primary).toBeInstanceOf(ProcessDefaultsRefusedError);
    expectTagged(
      error,
      tagged.primary,
      [['directory-lease-release', 'EIO']],
      [{ resource: 'directory-lease', path: dataDir }],
    );
    expect(startupFailureCause('store', error)).toBe('defaults-refused');
    expect(shellFailureOutput(error)).toBe(
      `${(tagged.primary as Error).message}\ncleanup also failed: directory-lease-release (EIO); ownership retained: data-directory lease ${dataDir}`,
    );
    expect(await present(database)).toBe(false);
  });

  it('keeps a held database lock refusal first and releases the directory lease', async () => {
    const other = await actualLocks.acquireDatabaseLock(database);
    try {
      arm('directory-lease-release');
      const error = await failure(createContainer(config(), { startTimers: false }));
      expect(calls).toEqual(['directory-lease-release']);
      const tagged = error as StartupCleanupError;
      expect(tagged.primary).toBeInstanceOf(locks.StoreOwnershipRefusedError);
      expectTagged(
        error,
        tagged.primary,
        [['directory-lease-release', 'EIO']],
        [{ resource: 'directory-lease', path: dataDir }],
      );
      expect(startupFailureCause('store', error)).toBe('store-held');
      expect(shellFailureOutput(error)).toBe(
        `another GraphGoblin process holds ${databaseLock()}; check its port/configuration; wait for the owning process to finish or stop it before retrying\ncleanup also failed: directory-lease-release (EIO); ownership retained: data-directory lease ${dataDir}`,
      );
    } finally {
      await other.release();
    }
  });
});

describe('read-only SQLite setup close', () => {
  async function oldStore() {
    const handle = actualSqlite.openDatabase({ url: pathToFileURL(database).href });
    await handle.client.execute('CREATE TABLE old_data(id TEXT)');
    handle.close();
  }

  it('keeps the exact store refusal when its read-only close and lease releases succeed', async () => {
    await oldStore();
    const error = await failure(createContainer(config(), { startTimers: false }));
    expect(error).toBeInstanceOf(StoreRefusedError);
    expect(calls).toEqual([
      'readonly-database-close',
      'database-lease-release',
      'directory-lease-release',
    ]);
    await expectHeld({ directory: false, database: false });
  });

  it('keeps a store refusal first and retains both leases when the read-only close also fails', async () => {
    await oldStore();
    arm('readonly-database-close');
    const error = await failure(createContainer(config(), { startTimers: false }));
    expect(calls).toEqual(['readonly-database-close']);
    const tagged = error as StartupCleanupError;
    expect(tagged.primary).toBeInstanceOf(StoreRefusedError);
    expectTagged(error, tagged.primary, [['readonly-database-close', 'EIO']], retainedBoth());
    await expectHeld({ directory: true, database: true });
    expect(startupFailureCause('store', error)).toBe('store-refused');
    const output = shellFailureOutput(error) as string;
    expect(output).toBe(
      `${(tagged.primary as Error).message}\ncleanup also failed: readonly-database-close (EIO); ownership retained: database lease ${database}, data-directory lease ${dataDir}`,
    );
    expect(output).not.toContain('synthetic readonly-database-close refusal');
    expect(await readFile(database)).toBeInstanceOf(Buffer);
  });

  it('makes a read-only close-only failure its own primary with retained ownership', async () => {
    const current = actualSqlite.openDatabase({ url: pathToFileURL(database).href });
    await current.migrate();
    current.close();
    arm('readonly-database-close');
    const error = await failure(createContainer(config(), { startTimers: false }));
    expect(calls).toEqual(['readonly-database-close']);
    const primary = faults.get('readonly-database-close');
    const tagged = expectTagged(error, primary, [], retainedBoth());
    expect(tagged.message).toBe(
      `synthetic readonly-database-close refusal; ownership retained: database lease ${database}, data-directory lease ${dataDir}`,
    );
    expect(vi.mocked(sqlite.openDatabase)).not.toHaveBeenCalled();
    await expectHeld({ directory: true, database: true });
    expect(startupFailureCause('store', error)).toBe('store-unavailable');
    expect(shellFailureOutput(error)).toBe(
      `${inspect(primary)}\nownership retained: database lease ${database}, data-directory lease ${dataDir}`,
    );
  });
});

describe('Mac-managed setup cleanup', () => {
  const mac = () => ({ localKeySource: 'macos', startTimers: false }) as const;

  it('releases both attested leases and keeps the exact key-source refusal', async () => {
    const error = await failure(createContainer(config(), mac()));
    expect(error).toBeInstanceOf(MacosKeySourceError);
    expect(calls).toEqual(['database-lease-release', 'directory-lease-release']);
    await expectHeld({ directory: false, database: false });
    expect(startupFailureCause('store', error)).toBe('key-source-unavailable');
  });

  it('keeps the key-source refusal classified when a lease release also fails', async () => {
    arm('database-lease-release');
    const error = await failure(createContainer(config(), mac()));
    const tagged = error as StartupCleanupError;
    expect(tagged.primary).toBeInstanceOf(MacosKeySourceError);
    expectTagged(
      error,
      tagged.primary,
      [['database-lease-release', 'EIO']],
      [{ resource: 'database-lease', path: database }],
    );
    expect(calls).toEqual(['database-lease-release', 'directory-lease-release']);
    await expectHeld({ directory: false, database: true });
    expect(startupFailureCause('store', error)).toBe('key-source-unavailable');
    expect(shellFailureOutput(error)).toBe(
      `${inspect(tagged.primary)}\ncleanup also failed: database-lease-release (EIO); ownership retained: database lease ${database}`,
    );
  });
});

describe('a tagged lease failure', () => {
  function taggedDatabaseFailure() {
    const original = Object.assign(new Error('synthetic record write refusal'), {
      code: 'ENOSPC',
    });
    const unlink = Object.assign(new Error('synthetic record unlink refusal'), { code: 'EACCES' });
    const tagged = new StartupCleanupError(
      original,
      [cleanupStep('main-record-unlink', unlink)],
      [{ resource: 'lock-record', path: databaseLock() }],
    );
    vi.mocked(locks.acquireDatabaseLock).mockRejectedValueOnce(tagged);
    return { original, unlink, tagged };
  }

  it('passes through unchanged when the directory lease release succeeds', async () => {
    const { tagged } = taggedDatabaseFailure();
    const error = await failure(createContainer(config(), { startTimers: false }));
    expect(error).toBe(tagged);
    expect(calls).toEqual(['directory-lease-release']);
    await expectHeld({ directory: false, database: false });
  });

  it('is flattened in causal order when the directory lease release also fails', async () => {
    const { original, unlink } = taggedDatabaseFailure();
    arm('directory-lease-release');
    const error = await failure(createContainer(config(), { startTimers: false }));
    const tagged = expectTagged(
      error,
      original,
      [
        ['main-record-unlink', 'EACCES'],
        ['directory-lease-release', 'EIO'],
      ],
      [
        { resource: 'lock-record', path: databaseLock() },
        { resource: 'directory-lease', path: dataDir },
      ],
    );
    expect(tagged.errors).toEqual([original, unlink, faults.get('directory-lease-release')]);
    expect(tagged.errors.some((entry) => entry instanceof StartupCleanupError)).toBe(false);
  });
});
