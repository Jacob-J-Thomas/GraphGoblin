import { mkdir, mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  databaseFilePath,
  openDatabase,
  openReadOnlyDatabaseClient,
} from '@graphgoblin/infrastructure/sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { macosDatabaseFile } from './macos-local-key.js';

const roots: string[] = [];
afterEach(async () => {
  // Windows keeps a SQLite file open until its closed native statements are collected.
  globalThis.gc?.();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

async function temporaryRoot(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'gg-config-db-')));
  roots.push(root);
  return root;
}

/** Every file and directory under `root`, as sorted relative paths. */
async function tree(root: string): Promise<string[]> {
  return (await readdir(root, { recursive: true })).sort();
}

/** Write a marker through the URL exactly as the API opens it: no migration, no providers. */
async function writeThrough(url: string, marker: string): Promise<void> {
  const handle = openDatabase({ url });
  try {
    await handle.client.execute('CREATE TABLE config_marker (value TEXT NOT NULL)');
    await handle.client.execute({ sql: 'INSERT INTO config_marker VALUES (?)', args: [marker] });
  } finally {
    handle.close();
  }
}

/** Read the marker back from a plain file path; refuses, never creates, a missing file. */
async function readMarker(file: string): Promise<unknown[]> {
  const client = openReadOnlyDatabaseClient(file);
  try {
    const result = await client.execute('SELECT value FROM config_marker');
    return result.rows.map((row) => row['value']);
  } finally {
    client.close();
  }
}

/** The SQLite file and its transient side files are the only entries a store open may add. */
async function expectOnlyStoreCreated(root: string, before: string[], store: string) {
  const created = (await tree(root)).filter((entry) => !before.includes(entry));
  const name = relative(root, store);
  const allowed = new Set(['', '-journal', '-wal', '-shm'].map((suffix) => name + suffix));
  expect(created.filter((entry) => !allowed.has(entry))).toEqual([]);
  expect(created).toContain(name);
}

interface DefaultStoreCase {
  label: string;
  /** Path segments of the data directory under a fresh temporary root. */
  dataDir: string[];
  /**
   * Directories the previous string-built URL resolved to instead, created empty beforehand so a
   * wrong URL silently opens a store there rather than failing for a missing directory.
   */
  decoys: string[][];
  /** Pass GG_DATA_DIR relative to the working directory. */
  relative?: boolean;
}

async function proveDefaultStore(testCase: DefaultStoreCase): Promise<void> {
  const root = await temporaryRoot();
  const dataDir = join(root, ...testCase.dataDir);
  const store = join(dataDir, 'graphgoblin.db');
  await mkdir(dataDir, { recursive: true });
  for (const decoy of testCase.decoys) await mkdir(join(root, ...decoy), { recursive: true });
  const before = await tree(root);
  const marker = `marker for ${testCase.label}`;
  const cwd = process.cwd();
  // Vitest runs this package in forked processes, where the working directory may change. It stays
  // inside the temporary root while the store is opened, so no relative mistake escapes it.
  if (testCase.relative) process.chdir(root);
  try {
    const config = loadConfig({
      GG_DATA_DIR: testCase.relative ? join(...testCase.dataDir) : dataDir,
    });
    expect(config.dataDir).toBe(dataDir);

    await writeThrough(config.dbUrl, marker);
    globalThis.gc?.();

    await expectOnlyStoreCreated(root, before, store);
    for (const decoy of testCase.decoys) expect(await readdir(join(root, ...decoy))).toEqual([]);
    expect(await readMarker(store)).toEqual([marker]);
    // The API's own resolver and the Mac launcher's default-store check name the same file.
    const resolved = databaseFilePath(config.dbUrl);
    expect(resolved).toBe(store);
    expect(await macosDatabaseFile(config.dataDir, config.dbUrl, resolved)).toBe(store);
  } finally {
    process.chdir(cwd);
  }
}

describe('loadConfig default database URL', () => {
  // Names every supported platform can hold, Windows included.
  it.each<DefaultStoreCase>([
    {
      label: 'space, Unicode, percent escape and hash in one name',
      dataDir: ['QA data ü %41 #1'],
      decoys: [],
    },
    {
      label: 'a percent escape spelling another existing directory',
      dataDir: ['QA data ü %41'],
      decoys: [['QA data ü A']],
    },
    {
      label: 'decomposed Unicode beside an escaped percent sign',
      dataDir: ['café %2541'],
      decoys: [['café %41']],
    },
    {
      label: 'a relative data directory',
      dataDir: ['nested ü', 'rel %41 x'],
      decoys: [['nested ü', 'rel A x']],
      relative: true,
    },
  ])('opens the data directory store for $label', proveDefaultStore);

  describe.skipIf(process.platform === 'win32')('names only POSIX file systems can hold', () => {
    it.each<DefaultStoreCase>([
      {
        label: 'a backslash, an ordinary name character outside Windows',
        dataDir: ['back\\slash'],
        decoys: [['back', 'slash']],
      },
      { label: 'a question mark', dataDir: ['ask?mode=ro'], decoys: [] },
    ])('opens the data directory store for $label', proveDefaultStore);
  });

  it('uses an explicit GG_DB_URL verbatim and leaves the default store unopened', async () => {
    const root = await temporaryRoot();
    const dataDir = join(root, 'data ü %41 #1');
    const chosen = join(root, 'chosen café %41 #2', 'elsewhere.db');
    await mkdir(dataDir);
    await mkdir(dirname(chosen));
    const before = await tree(root);
    // An equivalent spelling the default never produces: localhost authority, lower-case escapes.
    const url = pathToFileURL(chosen)
      .href.replace('file://', 'file://localhost')
      .replace(/%[0-9A-F]{2}/g, (escape) => escape.toLowerCase());

    const config = loadConfig({ GG_DATA_DIR: dataDir, GG_DB_URL: url });
    expect(config.dbUrl).toBe(url);
    expect(config.dataDir).toBe(dataDir);

    await writeThrough(config.dbUrl, 'explicit');
    globalThis.gc?.();

    await expectOnlyStoreCreated(root, before, chosen);
    expect(await readdir(dataDir)).toEqual([]);
    expect(await readMarker(chosen)).toEqual(['explicit']);
    expect(databaseFilePath(config.dbUrl)).toBe(chosen);

    // Raw, unescaped and decomposed text is not re-encoded or normalized either.
    const raw = 'file:relative café ü %41.db';
    expect(loadConfig({ GG_DATA_DIR: dataDir, GG_DB_URL: raw }).dbUrl).toBe(raw);
  });
});
