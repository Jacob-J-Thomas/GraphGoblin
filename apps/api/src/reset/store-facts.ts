import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
const ReaderResultSchema = z.union([StoreFactsSchema, z.object({ copyFailure: z.string() })]);

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

/** The reader process's arguments before the source path and parent PID: the adjacent built entry. */
export function defaultReaderArguments(): string[] {
  return [fileURLToPath(new URL('./store-facts-reader.js', import.meta.url))];
}

export interface ReadStoreOptions {
  /** Node arguments that run the reader entry; tests run the TypeScript source through tsx. */
  readerArguments?: string[];
  timeoutMs?: number;
}

/**
 * A separate process group is essential on Windows: non-detached children are killed when the
 * CLI's libuv job closes. Retain pipes and await close on normal reads; detachment only lets the
 * copy owner finish its cleanup after a killed CLI. Keep the existing 120 s / 64 MiB bounds.
 */
function readerOutput(databaseFile: string, options: ReadStoreOptions): Promise<string> {
  const child = spawn(
    process.execPath,
    [...(options.readerArguments ?? defaultReaderArguments()), databaseFile, String(process.pid)],
    { detached: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stdout = '',
    stderr = '';
  let stdoutBytes = 0,
    stderrBytes = 0;
  let failure: Error | undefined;
  const limit = 64 * 1024 * 1024;
  child.stdout.setEncoding('utf8').on('data', (text: string) => {
    stdoutBytes += Buffer.byteLength(text);
    if (stdoutBytes <= limit) stdout += text;
    else {
      failure ??= new Error('store reader stdout exceeded 64 MiB');
      child.kill();
    }
  });
  child.stderr.setEncoding('utf8').on('data', (text: string) => {
    stderrBytes += Buffer.byteLength(text);
    if (stderrBytes <= limit) stderr += text;
    else {
      failure ??= new Error('store reader stderr exceeded 64 MiB');
      child.kill();
    }
  });
  child.on('error', (error) => {
    failure ??= error;
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      failure ??= new Error('store reader timed out');
      child.kill();
    }, options.timeoutMs ?? STORE_READ_TIMEOUT_MS);
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (failure || code !== 0)
        reject(
          failure ?? new Error(stderr || `store reader exited with ${signal ?? String(code)}`),
        );
      else resolve(stdout);
    });
  });
}

/**
 * Read the facts of `databaseFile` without touching it or its directory: copy it (and its WAL, so
 * committed but uncheckpointed rows count) into a private temporary directory, read the copy in a
 * child copy owner, which waits for its SQLite worker to exit and removes the copy. Opening even a
 * read-only SQLite connection creates or updates `-wal`/`-shm` files beside the database, so the
 * original is never opened. A store that cannot be read reports why instead of failing.
 */
export async function readStoreFacts(
  databaseFile: string,
  options: ReadStoreOptions = {},
): Promise<StoreFacts> {
  let result: z.infer<typeof ReaderResultSchema>;
  try {
    const stdout = await readerOutput(databaseFile, options);
    result = ReaderResultSchema.parse(JSON.parse(stdout));
  } catch (error) {
    return { readable: false, reason: message(error) };
  }
  // A cleanup failure must refuse the reset, not downgrade to an unreadable store and proceed.
  if ('copyFailure' in result) throw new Error(result.copyFailure);
  return result;
}
