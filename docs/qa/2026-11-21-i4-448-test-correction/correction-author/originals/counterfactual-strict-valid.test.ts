import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { HarnessDefaults, ModelCatalogEntry } from '@graphgoblin/contracts';
import { FakeHarness } from '@graphgoblin/engine/testing';
import {
  DEFAULT_MODEL_CATALOG,
  SqliteModelCatalog,
  databaseView,
  openDatabase,
  openReadOnlyDatabaseClient,
} from '@graphgoblin/infrastructure/sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { createContainer } from './container.js';
import { runPreflightCli } from './preflight.js';

const KEY = Buffer.alloc(32, 8).toString('base64');
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gg-preflight-catalog-'));
});

afterEach(async () => {
  globalThis.gc?.();
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function adapters() {
  return {
    harnesses: { codex: new FakeHarness(), claude: new FakeHarness([], 'claude') },
    deciders: [],
    startTimers: false,
  };
}

function env(dbFile: string, defaults: HarnessDefaults): Record<string, string> {
  return {
    GG_DATA_DIR: join(dir, 'data'),
    GG_DB_URL: pathToFileURL(dbFile).href,
    GG_MASTER_KEY: KEY,
    GG_DEFAULTS: JSON.stringify(defaults),
    GG_OLLAMA_ENABLED: 'false',
  };
}

async function cli(environment: Record<string, string>) {
  let out = '';
  const code = await runPreflightCli({
    env: environment,
    ...adapters(),
    write: (text) => {
      out += text;
    },
  });
  return { code, out };
}

async function fixture(dbFile: string, rows = DEFAULT_MODEL_CATALOG) {
  await mkdir(dirname(dbFile), { recursive: true });
  const handle = openDatabase({ url: pathToFileURL(dbFile).href });
  try {
    await handle.migrate();
    await new SqliteModelCatalog(handle.db).seed(rows);
    await handle.client.execute('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally {
    handle.close();
  }
}

/** SQLite readers update -shm read marks; only DB/WAL contain the stored data. */
async function storeBytes(dbFile: string) {
  const names = (await readdir(dirname(dbFile))).filter(
    (name) => name === basename(dbFile) || name === `${basename(dbFile)}-wal`,
  );
  return Object.fromEntries(
    await Promise.all(
      names.map(async (name): Promise<[string, Buffer]> => [
        name,
        await readFile(join(dirname(dbFile), name)),
      ]),
    ),
  );
}

function expectStoreUnchanged(
  dbFile: string,
  before: Record<string, Buffer>,
  after: Record<string, Buffer>,
) {
  expect(after).toEqual(before);
}
async function storedCatalog(dbFile: string) {
  const client = openReadOnlyDatabaseClient(dbFile);
  try {
    return await new SqliteModelCatalog(databaseView(client)).list();
  } finally {
    client.close();
  }
}

async function storedMigrations(dbFile: string) {
  const client = openReadOnlyDatabaseClient(dbFile);
  try {
    return (await client.execute('SELECT * FROM __drizzle_migrations ORDER BY id')).rows;
  } finally {
    client.close();
  }
}

describe('offline startup catalog admission', () => {
  it.each([
    ['codex', 'gpt-6.1-terra', 'medium'],
    ['claude', 'claude-opus-5-5', 'high'],
  ] as const)(
    'accepts a missing shipped %s seed without storing it',
    async (harness, model, effort) => {
      // The DB is outside GG_DATA_DIR and its URL is percent-encoded: both paths use startup's
      // projected catalog. This simulates a current-format store before its first upgrade start.
      const dbFile = join(dir, 'external store', 'gateway.db');
      await fixture(
        dbFile,
        DEFAULT_MODEL_CATALOG.filter(
          (entry) => !(entry.harness === harness && entry.model === model),
        ),
      );
      const defaults: HarnessDefaults = {
        byHarness: { codex: { model: 'gpt-6-luna', effort: 'low' }, [harness]: { model, effort } },
      };
      const environment = env(dbFile, defaults);
      const before = await storeBytes(dbFile);
      const report = await cli(environment);
      expect(report.code, report.out).toBe(0);
      expect(report.out).toMatch(/ok\s+Database\s+reachable and migrated/);
      expect(report.out).toMatch(
        harness === 'codex'
          ? /ok\s+Default model\s+gpt-6.1-terra \(codex\) is in the model catalog/
          : /ok\s+Claude default model\s+Exact Claude model and effort are configured/,
      );
      expectStoreUnchanged(dbFile, before, await storeBytes(dbFile));
      expect(
        (await storedCatalog(dbFile)).some((row) => row.harness === harness && row.model === model),
      ).toBe(false);
      await expect(readdir(environment['GG_DATA_DIR']!)).rejects.toMatchObject({ code: 'ENOENT' });

      const container = await createContainer(loadConfig(environment), adapters());
      try {
        await container.start();
        expect(await container.repos.catalog.findOne(harness, model)).toMatchObject({
          enabled: true,
        });
      } finally {
        await container.stop();
      }
    },
  );

  it.each([
    {
      harness: 'codex',
      model: 'gpt-6.1-terra',
      effort: 'medium',
      enabled: false,
      status: 'WARN',
      code: 0,
      refusal: undefined,
    },
    {
      harness: 'claude',
      model: 'claude-opus-5-5',
      effort: 'high',
      enabled: false,
      status: 'FAIL',
      code: 1,
      refusal: undefined,
    },
    {
      harness: 'codex',
      model: 'unknown-model',
      effort: 'low',
      status: 'FAIL',
      code: 1,
      refusal: 'MODEL_NOT_IN_CATALOG',
    },
    {
      harness: 'codex',
      model: 'claude-opus-5-5',
      effort: 'high',
      status: 'FAIL',
      code: 1,
      refusal: 'MODEL_HARNESS_MISMATCH',
    },
    {
      harness: 'claude',
      model: 'gpt-6-luna',
      effort: 'low',
      status: 'FAIL',
      code: 1,
      refusal: 'MODEL_HARNESS_MISMATCH',
    },
    {
      harness: 'claude',
      model: 'claude-opus-5-5',
      effort: 'none',
      status: 'FAIL',
      code: 1,
      refusal: 'EFFORT_UNSUPPORTED',
    },
    {
      harness: 'claude',
      model: 'claude-opus-5-5',
      effort: 'low',
      efforts: ['high'],
      status: 'FAIL',
      code: 1,
      refusal: 'EFFORT_UNSUPPORTED',
    },
    // Codex preflight currently checks membership/enabled, while startup also checks effort.
    {
      harness: 'codex',
      model: 'gpt-5.5',
      effort: 'none',
      status: 'ok',
      code: 0,
      refusal: 'EFFORT_UNSUPPORTED',
    },
  ] as const)(
    'preserves $harness $model defaults (effort=$effort, status=$status)',
    async (test) => {
      const dbFile = join(dir, 'gateway.db');
      const rows: ModelCatalogEntry[] = DEFAULT_MODEL_CATALOG.map((entry) =>
        entry.harness === test.harness && entry.model === test.model
          ? {
              ...entry,
              ...('enabled' in test ? { enabled: test.enabled } : {}),
              ...('efforts' in test ? { efforts: [...test.efforts] } : {}),
            }
          : entry,
      );
      await fixture(dbFile, rows);
      const defaults: HarnessDefaults = {
        byHarness: {
          codex: { model: 'gpt-6-luna', effort: 'low' },
          [test.harness]: { model: test.model, effort: test.effort },
        },
      };
      const environment = env(dbFile, defaults);
      const before = await storeBytes(dbFile);
      const report = await cli(environment);
      expect(report.code, report.out).toBe(test.code);
      expect(report.out).toMatch(
        new RegExp(
          `${test.status}\\s+${test.harness === 'codex' ? 'Default model' : 'Claude default model'}\\s+`,
        ),
      );
      expect(await storedCatalog(dbFile)).toEqual(
        [...rows].sort(
          (a, b) => a.harness.localeCompare(b.harness) || a.model.localeCompare(b.model),
        ),
      );
      expectStoreUnchanged(dbFile, before, await storeBytes(dbFile));
      if (test.refusal) {
        const outcome: unknown = await createContainer(loadConfig(environment), adapters()).then(
          async (unexpected) => {
            await unexpected.stop();
            return undefined;
          },
          (error: unknown) => error,
        );
        expect(outcome).toMatchObject({
          code: 'EVALUATION_INVALID_CONFIGURATION',
          details: { code: test.refusal, harness: test.harness },
        });
        expectStoreUnchanged(dbFile, before, await storeBytes(dbFile));
      } else {
        // A disabled model is unavailable to execution, but is not malformed configuration:
        // ordinary boot must leave Settings available for correcting the selection.
        const container = await createContainer(loadConfig(environment), adapters());
        try {
          await container.start();
          expect(await container.repos.catalog.findOne(test.harness, test.model)).toMatchObject({
            enabled: false,
          });
          expect(
            await container.repos.catalog.isAllowed(test.harness, test.model, test.effort),
          ).toBe(false);
        } finally {
          await container.stop();
        }
      }
    },
  );

  it.each(['absent', 'empty'] as const)(
    'preserves rows and migrations with an initially %s WAL',
    async (initialWal) => {
      const dbFile = join(dir, 'gateway.db');
      const rows = DEFAULT_MODEL_CATALOG.filter((entry) => entry.model !== 'gpt-6.1-terra');
      const original = join(dir, 'source.db');
      await fixture(original, rows);
      const migrations = await storedMigrations(original);
      // Copy only the checkpointed DB to a fresh path with no previous SQLite connections.
      // Native cleanup of the source's closed clients cannot create or remove these sidecars.
      await copyFile(original, dbFile);
      const walFile = `${dbFile}-wal`;
      if (initialWal === 'empty') await writeFile(walFile, Buffer.alloc(0));
      const before = await storeBytes(dbFile);
      if (initialWal === 'absent') {
        expect(before['gateway.db-wal']).toBeUndefined();
      } else {
        expect(before['gateway.db-wal']).toEqual(Buffer.alloc(0));
      }

      const report = await cli(
        env(dbFile, { byHarness: { codex: { model: 'gpt-6.1-terra', effort: 'medium' } } }),
      );
      expect(report.code, report.out).toBe(0);
      expect(report.out).toMatch(/ok\s+Database\s+reachable and migrated/);
      expect(report.out).toMatch(/ok\s+Default model\s+gpt-6.1-terra/);
      expectStoreUnchanged(dbFile, before, await storeBytes(dbFile));
      expect(await storedCatalog(dbFile)).toEqual(
        [...rows].sort(
          (a, b) => a.harness.localeCompare(b.harness) || a.model.localeCompare(b.model),
        ),
      );
      expect(await storedMigrations(dbFile)).toEqual(migrations);
      expectStoreUnchanged(dbFile, before, await storeBytes(dbFile));
    },
  );

  it('projects a missing seed from a WAL-backed store without checkpointing or writing it', async () => {
    const original = join(dir, 'gateway.db');
    await fixture(original);
    const copy = join(dir, 'copy');
    await mkdir(copy);
    const holder = openDatabase({ url: pathToFileURL(original).href });
    try {
      await holder.client.execute('PRAGMA journal_mode = WAL');
      await holder.client.execute(
        "DELETE FROM model_catalog WHERE harness = 'codex' AND model = 'gpt-6.1-terra'",
      );
      for (const suffix of ['', '-wal', '-shm'])
        await copyFile(`${original}${suffix}`, join(copy, `gateway.db${suffix}`));
    } finally {
      holder.close();
    }
    const dbFile = join(copy, 'gateway.db');
    const before = await storeBytes(dbFile);
    expect(Object.keys(before)).toContain('gateway.db-wal');
    expect(before['gateway.db-wal']!.length).toBeGreaterThan(0);
    const report = await cli(
      env(dbFile, { byHarness: { codex: { model: 'gpt-6.1-terra', effort: 'medium' } } }),
    );
    expect(report.code, report.out).toBe(0);
    expect(report.out).toMatch(/ok\s+Default model\s+gpt-6.1-terra/);
    expect((await storedCatalog(dbFile)).some((row) => row.model === 'gpt-6.1-terra')).toBe(false);
    expectStoreUnchanged(dbFile, before, await storeBytes(dbFile));
    expect((await readdir(copy)).sort()).toEqual([
      'gateway.db',
      'gateway.db-shm',
      'gateway.db-wal',
    ]);
  });

  it('rejects database changes, existing WAL changes or removal, and new WAL frames', async () => {
    const dbFile = join(dir, 'gateway.db');
    const original = join(dir, 'source.db');
    await fixture(original);
    await copyFile(original, dbFile);
    const walFile = `${dbFile}-wal`;
    const absent = await storeBytes(dbFile);
    expect(absent['gateway.db-wal']).toBeUndefined();

    const changedDb = Buffer.from(absent['gateway.db']!);
    changedDb[0] = changedDb[0]! ^ 1;
    await writeFile(dbFile, changedDb);
    const databaseMutation = await storeBytes(dbFile);
    expect(() => expectStoreUnchanged(dbFile, absent, databaseMutation)).toThrow();
    await writeFile(dbFile, absent['gateway.db']!);

    await writeFile(walFile, Buffer.alloc(0));
    const empty = await storeBytes(dbFile);
    expectStoreUnchanged(dbFile, absent, empty);
    await rm(walFile);
    const removedEmpty = await storeBytes(dbFile);
    expect(() => expectStoreUnchanged(dbFile, empty, removedEmpty)).toThrow();

    // Produce genuine SQLite frames while keeping the checkpointed database bytes fixed.
    const writer = openDatabase({ url: pathToFileURL(dbFile).href });
    try {
      await writer.client.execute('PRAGMA journal_mode = WAL');
      await writer.client.execute(
        "DELETE FROM model_catalog WHERE harness = 'codex' AND model = 'gpt-6.1-terra'",
      );
      const frames = await storeBytes(dbFile);
      expect(frames['gateway.db']).toEqual(absent['gateway.db']);
      expect(frames['gateway.db-wal']!.length).toBeGreaterThan(0);
      expect(() => expectStoreUnchanged(dbFile, absent, frames)).toThrow();
      expect(() => expectStoreUnchanged(dbFile, empty, frames)).toThrow();

      const frozenFile = join(dir, 'frozen', 'gateway.db');
      await mkdir(dirname(frozenFile));
      for (const suffix of ['', '-wal', '-shm'])
        await copyFile(`${dbFile}${suffix}`, `${frozenFile}${suffix}`);
      const frozen = await storeBytes(frozenFile);
      const frozenWal = `${frozenFile}-wal`;
      const changedWal = Buffer.from(frozen['gateway.db-wal']!);
      changedWal[changedWal.length - 1] = changedWal[changedWal.length - 1]! ^ 1;
      await writeFile(frozenWal, changedWal);
      const walMutation = await storeBytes(frozenFile);
      expect(() => expectStoreUnchanged(frozenFile, frozen, walMutation)).toThrow();
      await rm(frozenWal);
      const removedWal = await storeBytes(frozenFile);
      expect(() => expectStoreUnchanged(frozenFile, frozen, removedWal)).toThrow();
      await writeFile(frozenWal, Buffer.alloc(0));
      const truncatedWal = await storeBytes(frozenFile);
      expect(() => expectStoreUnchanged(frozenFile, frozen, truncatedWal)).toThrow();
    } finally {
      writer.close();
    }
  });
});
