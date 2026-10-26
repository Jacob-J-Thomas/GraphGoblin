import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { openDatabase } from '@graphgoblin/infrastructure/sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  defaultReaderArguments,
  readStoreFacts,
  readStoreFactsFromFile,
  StoreFactsSchema,
} from './store-facts.js';
import {
  READER_ARGUMENTS,
  SEEDED_RUN_IDS,
  seedStores,
  snapshotTree,
} from './__fixtures__/stores.js';

let seeded: string;
beforeAll(async () => {
  seeded = await mkdtemp(join(tmpdir(), 'gg-store-facts-'));
  await seedStores(seeded);
}, 240_000);
afterAll(async () => {
  await rm(seeded, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(
    () => undefined,
  );
});

const read = (store: string) =>
  readStoreFacts(join(seeded, store, 'graphgoblin.db'), { readerArguments: READER_ARGUMENTS });

describe('reading a store for a reset', () => {
  it('reads the format marker and run IDs of current and older stores from a private copy', async () => {
    const before = await snapshotTree(seeded);
    expect(await read('current')).toEqual({
      readable: true,
      format: 4,
      status: 'complete',
      runIds: SEEDED_RUN_IDS,
    });
    expect(await read('format-3')).toEqual({
      readable: true,
      format: 3,
      status: 'complete',
      runIds: SEEDED_RUN_IDS,
    });
    expect(await read('unmarked')).toEqual({ readable: true, runIds: SEEDED_RUN_IDS });
    // Opening SQLite, even read-only, writes -wal/-shm beside a database: the originals are
    // copied, so every file of every store is byte for byte as it was.
    expect(await snapshotTree(seeded)).toEqual(before);
  }, 240_000);

  it('reports an unreadable store with the reason instead of failing', async () => {
    const corrupt = await read('corrupt');
    expect(corrupt).toMatchObject({ readable: false });
    expect(corrupt.readable ? '' : corrupt.reason).toMatch(/not a database|SQLITE/i);
    const missing = await readStoreFacts(join(seeded, 'none', 'graphgoblin.db'), {
      readerArguments: READER_ARGUMENTS,
    });
    expect(missing).toMatchObject({ readable: false, reason: expect.stringContaining('ENOENT') });
  }, 120_000);

  it('treats a reader that does not answer in time as unreadable', async () => {
    const result = await readStoreFacts(join(seeded, 'current', 'graphgoblin.db'), {
      readerArguments: ['-e', 'setTimeout(() => {}, 60000)'],
      timeoutMs: 200,
    });
    expect(result).toMatchObject({ readable: false });
  });

  it('refuses reader output that is not a facts record', async () => {
    const result = await readStoreFacts(join(seeded, 'current', 'graphgoblin.db'), {
      readerArguments: ['-e', 'process.stdout.write(JSON.stringify({ readable: true }))'],
    });
    expect(result).toMatchObject({ readable: false });
  });

  it.each(['stdout', 'stderr'] as const)(
    'bounds the reader %s stream',
    async (stream) => {
      const script = `const stream = process.${stream}; const chunk = 'x'.repeat(65536); function write() { while (stream.write(chunk)) {} stream.once('drain', write); } write();`;
      const result = await readStoreFacts(join(seeded, 'current', 'graphgoblin.db'), {
        readerArguments: ['-e', script],
      });
      expect(result).toEqual({ readable: false, reason: `store reader ${stream} exceeded 64 MiB` });
    },
    60_000,
  );

  it('reports the stderr of a reader that exits unsuccessfully', async () => {
    expect(
      await readStoreFacts(join(seeded, 'current', 'graphgoblin.db'), {
        readerArguments: ['-e', 'process.stderr.write("reader failure"); process.exitCode = 2'],
      }),
    ).toEqual({ readable: false, reason: 'reader failure' });
  });

  it('surfaces a private-copy cleanup failure instead of proceeding with an unreadable store', async () => {
    await expect(
      readStoreFacts(join(seeded, 'current', 'graphgoblin.db'), {
        readerArguments: [
          '-e',
          'process.stdout.write(JSON.stringify({ copyFailure: "private copy could not be removed" }))',
        ],
      }),
    ).rejects.toThrow('private copy could not be removed');
  });

  it('reads a copy in this process and reports a reader started without a path', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gg-store-facts-copy-'));
    try {
      await copyFile(join(seeded, 'unmarked', 'graphgoblin.db'), join(directory, 'copy.db'));
      await copyFile(
        join(seeded, 'unmarked', 'graphgoblin.db-wal'),
        join(directory, 'copy.db-wal'),
      );
      expect(await readStoreFactsFromFile(join(directory, 'copy.db'))).toEqual({
        readable: true,
        runIds: SEEDED_RUN_IDS,
      });
      const { stdout } = await promisify(execFile)(process.execPath, READER_ARGUMENTS, {
        timeout: 120_000,
      });
      expect(StoreFactsSchema.parse(JSON.parse(stdout))).toEqual({
        readable: false,
        reason: 'no database path was given',
      });
    } finally {
      // This process's copy stays locked on Windows until its statements are collected.
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  }, 120_000);

  it('ignores a malformed marker and run IDs that are not text', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gg-store-facts-odd-'));
    try {
      const file = join(directory, 'odd.db');
      const writer = openDatabase({ url: pathToFileURL(file).href });
      await writer.client.execute('CREATE TABLE gg_upgrade_state (id, format_version, status)');
      await writer.client.execute("INSERT INTO gg_upgrade_state VALUES (1, 'four', 7)");
      await writer.client.execute('CREATE TABLE runs (id)');
      await writer.client.execute("INSERT INTO runs VALUES (42), ('01JTEXTRUNID0000000000000A')");
      writer.close();
      expect(await readStoreFactsFromFile(file)).toEqual({
        readable: true,
        runIds: ['01JTEXTRUNID0000000000000A'],
      });
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it('runs the built reader beside this module by default', () => {
    const [entry] = defaultReaderArguments();
    expect(entry).toMatch(/store-facts-reader\.js$/);
  });
});
