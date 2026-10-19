import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { openDatabase, type DatabaseHandle } from '@graphgoblin/infrastructure/sqlite';
import { z } from 'zod';

/**
 * What a reset needs to know about a store, in any format: its format marker, for the manifest,
 * and its run IDs, which select the run workspaces it removes. Nothing here interprets or
 * converts stored data.
 */
export const StoreFactsSchema = z.discriminatedUnion('readable', [
  z.object({
    readable: z.literal(true),
    /** The stored format marker's version, when the store has a marker row. */
    format: z.number().optional(),
    status: z.string().optional(),
    runIds: z.array(z.string()),
  }),
  z.object({ readable: z.literal(false), reason: z.string() }),
]);
export type StoreFacts = z.infer<typeof StoreFactsSchema>;

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Read the facts from a private copy of a database file in this process. The copy is opened
 * read-write so SQLite can recover a copied WAL; nothing is written to it. libsql releases a file
 * only when its native statements are garbage collected, so on Windows the file stays locked after
 * `close()`: never pass the store a reset removes (see `readStoreFacts`).
 */
export async function readStoreFactsFromFile(file: string): Promise<StoreFacts> {
  let client: DatabaseHandle['client'] | undefined;
  try {
    client = openDatabase({ url: pathToFileURL(file).href }).client;
    const text = (value: unknown): string[] => (typeof value === 'string' ? [value] : []);
    const tables = new Set(
      (await client.execute("SELECT name FROM sqlite_master WHERE type='table'")).rows.flatMap(
        (row) => text(row.name),
      ),
    );
    const marker = tables.has('gg_upgrade_state')
      ? (await client.execute('SELECT format_version, status FROM gg_upgrade_state WHERE id = 1'))
          .rows[0]
      : undefined;
    // Run IDs are text; only a text name can match a workspace directory.
    const runIds = tables.has('runs')
      ? (await client.execute('SELECT id FROM runs ORDER BY id')).rows.flatMap((row) =>
          text(row.id),
        )
      : [];
    return {
      readable: true,
      ...(typeof marker?.format_version === 'number' ? { format: marker.format_version } : {}),
      ...(typeof marker?.status === 'string' ? { status: marker.status } : {}),
      runIds,
    };
  } catch (error) {
    return { readable: false, reason: message(error) };
  } finally {
    client?.close();
  }
}

/** How long the reader process may take before its store counts as unreadable. */
export const STORE_READ_TIMEOUT_MS = 120_000;

/** The reader process's arguments before the copy's path: the built entry beside this module. */
export function defaultReaderArguments(): string[] {
  return [fileURLToPath(new URL('./store-facts-reader.js', import.meta.url))];
}

export interface ReadStoreOptions {
  /** Node arguments that run the reader entry; tests run the TypeScript source through tsx. */
  readerArguments?: string[];
  timeoutMs?: number;
}

/**
 * Read the facts of `databaseFile` without touching it or its directory: copy it (and its WAL, so
 * committed but uncheckpointed rows count) into a private temporary directory, read the copy in a
 * child process whose exit releases every native handle, then remove the copy. Opening even a
 * read-only SQLite connection creates or updates `-wal`/`-shm` files beside the database, so the
 * original is never opened. A store that cannot be read reports why instead of failing.
 */
export async function readStoreFacts(
  databaseFile: string,
  options: ReadStoreOptions = {},
): Promise<StoreFacts> {
  const directory = await mkdtemp(join(tmpdir(), 'gg-reset-store-'));
  try {
    const copy = join(directory, 'store.db');
    await copyFile(databaseFile, copy, constants.COPYFILE_EXCL);
    await copyFile(databaseFile + '-wal', copy + '-wal', constants.COPYFILE_EXCL).catch(
      (error: unknown) => {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      },
    );
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [...(options.readerArguments ?? defaultReaderArguments()), copy],
      {
        timeout: options.timeoutMs ?? STORE_READ_TIMEOUT_MS,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
      },
    );
    return StoreFactsSchema.parse(JSON.parse(stdout));
  } catch (error) {
    return { readable: false, reason: message(error) };
  } finally {
    // The reader has exited, so nothing holds the copy; a failure here would leave a copy of the
    // store in the temporary directory, which the caller must hear about.
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
