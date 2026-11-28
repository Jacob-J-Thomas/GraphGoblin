import {
  constants,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Effort, HarnessDefaults, ModelCatalogEntry } from '@graphgoblin/contracts';
import { FakeHarness } from '@graphgoblin/engine/testing';
import {
  DEFAULT_MODEL_CATALOG,
  SqliteModelCatalog,
  databaseView,
  openDatabase,
  openReadOnlyDatabaseClient,
  readPreMigrationModelCatalog,
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

/**
 * Seeds a checkpointed store at an unused staging path, then copies only its main DB to the fresh
 * `dbFile`. A closed writer's native cleanup may still remove its WAL/SHM after `close()` returns,
 * so the writer never opens the inspected path and none of its sidecars are shared with it.
 * The writer applies `migrationsFolder` when given, otherwise every shipped migration.
 */
async function stagedStore(dbFile: string, rows: ModelCatalogEntry[], migrationsFolder?: string) {
  await mkdir(dirname(dbFile), { recursive: true });
  const staged = join(await mkdtemp(join(dir, 'fixture-writer-')), basename(dbFile));
  const handle = openDatabase({
    url: pathToFileURL(staged).href,
    ...(migrationsFolder === undefined ? {} : { migrationsFolder }),
  });
  try {
    await handle.migrate();
    await new SqliteModelCatalog(handle.db).seed(rows);
    const [checkpoint] = (await handle.client.execute('PRAGMA wal_checkpoint(TRUNCATE)')).rows;
    // A busy or partial checkpoint (or a non-WAL store, which reports -1) fails before copying.
    expect({
      busy: checkpoint?.['busy'],
      log: checkpoint?.['log'],
      checkpointed: checkpoint?.['checkpointed'],
    }).toEqual({ busy: 0, log: 0, checkpointed: 0 });
  } finally {
    handle.close();
  }
  await copyFile(staged, dbFile, constants.COPYFILE_EXCL);
}

/** A current store with every shipped migration applied and `rows` seeded. */
async function fixture(dbFile: string, rows = DEFAULT_MODEL_CATALOG) {
  await stagedStore(dbFile, rows);
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
  const dbName = basename(dbFile);
  expect(after[dbName]?.equals(before[dbName]!)).toBe(true);
  const walName = `${dbName}-wal`;
  const existingWal = before[walName];
  if (existingWal !== undefined) {
    expect(after[walName]?.equals(existingWal)).toBe(true);
  } else {
    // A reader may create an empty WAL, but cannot add frames to stored data.
    expect(after[walName]?.length ?? 0).toBe(0);
  }
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

/** A real shipped migration prefix through `0026_chat`; later shipped migrations stay pending. */
async function migrationPrefix(): Promise<string> {
  const source = fileURLToPath(
    new URL('../../../packages/infrastructure/drizzle/', import.meta.url),
  );
  const folder = join(dir, 'migrations');
  await mkdir(join(folder, 'meta'), { recursive: true });
  const journal = JSON.parse(await readFile(join(source, 'meta', '_journal.json'), 'utf8')) as {
    entries: { tag: string }[];
  };
  const last = journal.entries.findIndex((entry) => entry.tag === '0026_chat');
  expect(journal.entries.length - last - 1).toBe(3);
  journal.entries = journal.entries.slice(0, last + 1);
  await writeFile(join(folder, 'meta', '_journal.json'), JSON.stringify(journal));
  await Promise.all(
    journal.entries.map((entry) =>
      copyFile(join(source, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`)),
    ),
  );
  return folder;
}

/** A current-format store whose last start predates the shipped migrations after the prefix. */
async function pendingFixture(dbFile: string, rows: ModelCatalogEntry[]) {
  await stagedStore(dbFile, rows, await migrationPrefix());
}

/** Stored rows as startup reads them before pending migrations add the discovery tables. */
async function preMigrationCatalog(dbFile: string) {
  const client = openReadOnlyDatabaseClient(dbFile);
  try {
    return await readPreMigrationModelCatalog(databaseView(client));
  } finally {
    client.close();
  }
}

function sortedRows(rows: readonly ModelCatalogEntry[]) {
  const key = (row: ModelCatalogEntry) => `${row.harness}\u0000${row.model}`;
  return [...rows].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

function withRow(harness: string, model: string, change: Partial<ModelCatalogEntry>) {
  return DEFAULT_MODEL_CATALOG.map((entry) =>
    entry.harness === harness && entry.model === model ? { ...entry, ...change } : entry,
  );
}

/** Ordinary startup with the same environment: its refusal, or the started container. */
async function startup(environment: Record<string, string>) {
  return createContainer(loadConfig(environment), adapters()).then(
    (container) => ({ container }),
    (error: unknown) => ({ error }),
  );
}

function line(status: 'ok' | 'WARN' | 'FAIL', label: string, text: string) {
  return new RegExp(
    `${status}\\s+${label}\\s+${text.replace(/[.*+?^${}()|[\]\\]/g, (match) => `\\${match}`)}`,
  );
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
    // Codex preflight refuses an unsupported effort as startup does (#545).
    {
      harness: 'codex',
      model: 'gpt-5.5',
      effort: 'none',
      status: 'FAIL',
      code: 1,
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

describe('Codex GG_DEFAULTS effort (#545)', () => {
  it.each(
    (['migrated', 'missing', 'empty'] as const).flatMap((store) => [
      { store, effort: 'none', status: 'FAIL', code: 1 } as const,
      { store, effort: 'low', status: 'ok', code: 0 } as const,
      { store, effort: undefined, status: 'WARN', code: 0 } as const,
    ]),
  )(
    'matches startup for a $store store (effort=$effort, status=$status)',
    async ({ store, effort, status, code }) => {
      const dbFile = join(dir, 'store', 'gateway.db');
      if (store === 'migrated') await fixture(dbFile);
      if (store === 'empty') {
        await mkdir(dirname(dbFile));
        await writeFile(dbFile, Buffer.alloc(0));
      }
      const environment = env(dbFile, {
        byHarness: { codex: { model: 'gpt-5.5', ...(effort ? { effort } : {}) } },
      });
      const before = store === 'missing' ? undefined : await storeBytes(dbFile);
      const report = await cli(environment);
      expect(report.code, report.out).toBe(code);
      const where =
        store === 'migrated' ? 'the model catalog' : 'the default catalog seeded on first start';
      expect(report.out).toMatch(
        line(
          status,
          'Default model',
          status === 'FAIL'
            ? `GG_DEFAULTS.byHarness.codex.effort "none" is not supported by gpt-5.5 in ${where} (EFFORT_UNSUPPORTED); start refuses it. Pick an effort the model lists`
            : status === 'ok'
              ? `gpt-5.5 (codex) is in ${where} and supports effort low`
              : `gpt-5.5 (codex) is in ${where}, but GG_DEFAULTS.byHarness.codex.effort is not set; runs need a supported effort from the loop or Settings defaults`,
        ),
      );
      // An invalid declaration stays separate from the harness prerequisite.
      expect(report.out).toMatch(
        line('ok', 'Harness codex', 'codex fake is installed and logged in'),
      );
      if (before) expectStoreUnchanged(dbFile, before, await storeBytes(dbFile));
      else await expect(stat(dirname(dbFile))).rejects.toMatchObject({ code: 'ENOENT' });

      const outcome = await startup(environment);
      if ('error' in outcome) {
        expect(status).toBe('FAIL');
        expect(outcome.error).toMatchObject({
          code: 'EVALUATION_INVALID_CONFIGURATION',
          details: {
            code: 'EFFORT_UNSUPPORTED',
            path: 'effort',
            level: 'process',
            harness: 'codex',
          },
        });
        if (before) expectStoreUnchanged(dbFile, before, await storeBytes(dbFile));
        else await expect(stat(dirname(dbFile))).rejects.toMatchObject({ code: 'ENOENT' });
        return;
      }
      try {
        expect(status).not.toBe('FAIL');
        await outcome.container.start();
        expect(await outcome.container.repos.catalog.findOne('codex', 'gpt-5.5')).toMatchObject({
          enabled: true,
        });
      } finally {
        await outcome.container.stop();
      }
    },
  );
});

const STORED_ONLY: ModelCatalogEntry = {
  harness: 'codex',
  source: 'harness',
  model: 'gpt-stored-fixture',
  displayName: 'Stored fixture',
  efforts: ['low', 'medium'],
  defaultEffort: 'low',
  enabled: true,
};

describe('a current store with pending migrations (#546)', () => {
  const codex = (model: string, effort: Effort): HarnessDefaults => ({
    byHarness: { codex: { model, effort } },
  });

  it.each([
    {
      name: 'a stored-only Codex model',
      rows: [...DEFAULT_MODEL_CATALOG, STORED_ONLY],
      defaults: codex('gpt-stored-fixture', 'low'),
      expected: line(
        'ok',
        'Default model',
        'gpt-stored-fixture (codex) is in the model catalog and supports effort low',
      ),
      code: 0,
      started: { harness: 'codex', model: 'gpt-stored-fixture', enabled: true },
    },
    {
      name: 'a stored disabled Codex row',
      rows: withRow('codex', 'gpt-6.1-terra', { enabled: false }),
      defaults: codex('gpt-6.1-terra', 'medium'),
      expected: line('WARN', 'Default model', 'gpt-6.1-terra is in the model catalog but disabled'),
      code: 0,
      started: { harness: 'codex', model: 'gpt-6.1-terra', enabled: false },
    },
    {
      name: 'stored Codex efforts without the configured effort',
      rows: withRow('codex', 'gpt-6.1-terra', { efforts: ['medium'] }),
      defaults: codex('gpt-6.1-terra', 'low'),
      expected: line(
        'FAIL',
        'Default model',
        'GG_DEFAULTS.byHarness.codex.effort "low" is not supported by gpt-6.1-terra in the model catalog (EFFORT_UNSUPPORTED)',
      ),
      code: 1,
      refusal: 'EFFORT_UNSUPPORTED',
    },
    {
      name: 'a stored disabled Claude row',
      rows: withRow('claude', 'claude-opus-5-5', { enabled: false }),
      defaults: {
        byHarness: {
          codex: { model: 'gpt-6-luna', effort: 'low' },
          claude: { model: 'claude-opus-5-5', effort: 'high' },
        },
      } satisfies HarnessDefaults,
      expected: line('FAIL', 'Claude default model', 'The configured Claude model is disabled'),
      code: 1,
      started: { harness: 'claude', model: 'claude-opus-5-5', enabled: false },
    },
    {
      name: 'a shipped seed the store lacks',
      rows: DEFAULT_MODEL_CATALOG.filter((entry) => entry.model !== 'gpt-6.1-terra'),
      defaults: codex('gpt-6.1-terra', 'medium'),
      expected: line(
        'ok',
        'Default model',
        'gpt-6.1-terra (codex) is in the model catalog and supports effort medium',
      ),
      code: 0,
      started: { harness: 'codex', model: 'gpt-6.1-terra', enabled: true },
    },
  ] as const)('admits $name as startup does, without changing the store', async (test) => {
    const dbFile = join(dir, 'gateway.db');
    await pendingFixture(dbFile, [...test.rows]);
    const environment = env(dbFile, test.defaults);
    const migrations = await storedMigrations(dbFile);
    const before = await storeBytes(dbFile);
    const report = await cli(environment);
    expect(report.code, report.out).toBe(test.code);
    expect(report.out).toMatch(
      line('WARN', 'Database', '3 migration(s) pending; they are applied on the next start'),
    );
    expect(report.out).toMatch(test.expected);
    expect(report.out).not.toContain('seeded on first start');
    // Provider checks and the Jev deferral keep their results while migrations are pending.
    expect(report.out).toMatch(
      line('ok', 'Harness codex', 'codex fake is installed and logged in'),
    );
    expect(report.out).toMatch(
      line('ok', 'Harness claude', 'claude fake is installed and logged in'),
    );
    expect(report.out).toMatch(/WARN\s+Codex plugins/);
    expect(report.out).toMatch(line('WARN', 'Jev', 'not checked until the database is migrated'));
    expectStoreUnchanged(dbFile, before, await storeBytes(dbFile));
    expect(await preMigrationCatalog(dbFile)).toEqual(sortedRows(test.rows));
    expect(await storedMigrations(dbFile)).toEqual(migrations);

    const outcome = await startup(environment);
    if ('refusal' in test) {
      expect(outcome).toMatchObject({
        error: {
          code: 'EVALUATION_INVALID_CONFIGURATION',
          details: { code: test.refusal, harness: 'codex' },
        },
      });
      expectStoreUnchanged(dbFile, before, await storeBytes(dbFile));
      return;
    }
    if ('error' in outcome) throw outcome.error;
    try {
      await outcome.container.start();
      expect(
        await outcome.container.repos.catalog.findOne(test.started.harness, test.started.model),
      ).toMatchObject({ enabled: test.started.enabled });
      expect(await outcome.container.handle.pendingMigrations()).toBe(0);
    } finally {
      await outcome.container.stop();
    }
  });

  it('reads committed WAL frames without changing the database or the existing WAL', async () => {
    const original = join(dir, 'gateway.db');
    await pendingFixture(original, DEFAULT_MODEL_CATALOG);
    const copy = join(dir, 'copy');
    await mkdir(copy);
    // Copy a WAL-backed store while its writer is open, so the change exists only as WAL frames.
    const holder = openDatabase({ url: pathToFileURL(original).href });
    try {
      await holder.client.execute('PRAGMA journal_mode = WAL');
      await holder.client.execute(
        "UPDATE model_catalog SET enabled = 0 WHERE harness = 'codex' AND model = 'gpt-6.1-terra'",
      );
      for (const suffix of ['', '-wal', '-shm'])
        await copyFile(`${original}${suffix}`, join(copy, `gateway.db${suffix}`));
    } finally {
      holder.close();
    }
    const dbFile = join(copy, 'gateway.db');
    const before = await storeBytes(dbFile);
    expect(before['gateway.db-wal']!.length).toBeGreaterThan(0);
    const environment = env(dbFile, codex('gpt-6.1-terra', 'medium'));
    const migrations = await storedMigrations(dbFile);
    const report = await cli(environment);
    expect(report.code, report.out).toBe(0);
    expect(report.out).toMatch(
      line('WARN', 'Database', '3 migration(s) pending; they are applied on the next start'),
    );
    expect(report.out).toMatch(
      line('WARN', 'Default model', 'gpt-6.1-terra is in the model catalog but disabled'),
    );
    expectStoreUnchanged(dbFile, before, await storeBytes(dbFile));
    expect((await readdir(copy)).sort()).toEqual([
      'gateway.db',
      'gateway.db-shm',
      'gateway.db-wal',
    ]);
    expect(await storedMigrations(dbFile)).toEqual(migrations);
    expectStoreUnchanged(dbFile, before, await storeBytes(dbFile));

    const outcome = await startup(environment);
    if ('error' in outcome) throw outcome.error;
    try {
      await outcome.container.start();
      expect(await outcome.container.repos.catalog.findOne('codex', 'gpt-6.1-terra')).toMatchObject(
        { enabled: false },
      );
    } finally {
      await outcome.container.stop();
    }
  });

  it.each(['unsupported', 'corrupt'] as const)(
    'reports the inspection limit of an existing %s store instead of a seed-backed result',
    async (state) => {
      const dbFile = join(dir, 'gateway.db');
      if (state === 'corrupt') {
        await writeFile(dbFile, Buffer.alloc(4096, 'x'));
      } else {
        // Downgrade a private store, then copy only its checkpointed main DB to the unused
        // `dbFile`: as in `stagedStore`, no fixture writer opens the inspected path.
        const setup = join(await mkdtemp(join(dir, 'fixture-writer-')), basename(dbFile));
        await fixture(setup);
        const writer = openDatabase({ url: pathToFileURL(setup).href });
        try {
          await writer.client.execute('UPDATE gg_upgrade_state SET format_version = 3');
          const [checkpoint] = (await writer.client.execute('PRAGMA wal_checkpoint(TRUNCATE)'))
            .rows;
          // A busy or partial checkpoint, or a non-WAL store (-1), fails before copying.
          expect({
            busy: checkpoint?.['busy'],
            log: checkpoint?.['log'],
            checkpointed: checkpoint?.['checkpointed'],
          }).toEqual({ busy: 0, log: 0, checkpointed: 0 });
        } finally {
          writer.close();
        }
        await copyFile(setup, dbFile, constants.COPYFILE_EXCL);
      }
      const environment = env(dbFile, {
        byHarness: {
          codex: { model: 'gpt-6-luna', effort: 'low' },
          claude: { model: 'claude-opus-5-5', effort: 'high' },
        },
      });
      const before = await storeBytes(dbFile);
      const report = await cli(environment);
      expect(report.code, report.out).toBe(1);
      expect(report.out).toMatch(
        state === 'unsupported'
          ? line('FAIL', 'Database', 'The store is format 3; this build reads only format 4')
          : /FAIL\s+Database\s+not reachable: /,
      );
      expect(report.out).toMatch(
        line(
          'WARN',
          'Default model',
          'The configured Codex model and effort are not checked until the database is current and readable',
        ),
      );
      expect(report.out).toMatch(
        line(
          'WARN',
          'Claude default model',
          'The configured Claude model and effort are not checked until the database is current and readable',
        ),
      );
      expect(report.out).not.toMatch(/ok\s+(Claude )?[Dd]efault model/);
      expect(report.out).not.toContain('seeded on first start');
      expect(report.out).toMatch(
        line('ok', 'Harness codex', 'codex fake is installed and logged in'),
      );
      expect(report.out).toMatch(line('WARN', 'Jev', 'not checked until the database is migrated'));
      expectStoreUnchanged(dbFile, before, await storeBytes(dbFile));

      const outcome = await startup(environment);
      if ('container' in outcome) {
        await outcome.container.stop();
        throw new Error('startup accepted a store preflight could not inspect');
      }
      if (state === 'unsupported')
        expect(outcome.error).toMatchObject({
          code: 'STORE_UNSUPPORTED',
          refusal: { foundFormat: 3 },
        });
      expectStoreUnchanged(dbFile, before, await storeBytes(dbFile));
    },
  );
});
