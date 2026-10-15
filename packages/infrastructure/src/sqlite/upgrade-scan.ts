/** Offline-upgrade scans only: bounded SQLite reads and a disk-backed canonical hash sort. */
import type { Client, InValue } from '@libsql/client';
import { createHash } from 'node:crypto';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { stableStringify } from '@graphgoblin/domain';

export type UpgradeRow = Record<string, unknown>;
export type UpgradeReader = Pick<Client, 'execute'>;
export const UPGRADE_BATCH_SIZE = 500;
export const quote = (name: string): string => '"' + name.replaceAll('"', '""') + '"';
export async function rows(
  client: UpgradeReader,
  sql: string,
  args: InValue[] = [],
): Promise<UpgradeRow[]> {
  const result = await client.execute({ sql, args });
  return result.rows.map((row) =>
    Object.fromEntries(result.columns.map((column) => [column, row[column]])),
  );
}
export async function tableNames(client: UpgradeReader): Promise<string[]> {
  return (await rows(client, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"))
    .map((row) => String(row.name))
    .filter((name) => !name.startsWith('sqlite_'));
}
export async function* tableBatches(
  client: UpgradeReader,
  table: string,
): AsyncGenerator<UpgradeRow[]> {
  let after: number | undefined;
  for (;;) {
    const batch = await rows(
      client,
      'SELECT rowid AS __gg_rowid,* FROM ' +
        quote(table) +
        (after === undefined ? '' : ' WHERE rowid>?') +
        ' ORDER BY rowid LIMIT ?',
      after === undefined ? [UPGRADE_BATCH_SIZE] : [after, UPGRADE_BATCH_SIZE],
    );
    if (!batch.length) return;
    after = Number(batch.at(-1)!.__gg_rowid);
    for (const row of batch) delete row.__gg_rowid;
    yield batch;
    // Local libsql promises can settle without returning to the event loop. Give native
    // statement finalizers a turn between batches, including inside the offline transaction.
    await yieldToEventLoop();
  }
}

/** Pull only one small buffer at a time. readline's eager line queue can retain an entire
 * 500-row chunk for every open reader; an explicitly pulled decoder avoids that read-ahead. */
async function* chunkLines(file: string): AsyncGenerator<string, void> {
  const handle = await open(file, 'r');
  try {
    const decoder = new StringDecoder('utf8');
    const buffer = Buffer.alloc(4096);
    let pending = '';
    for (;;) {
      const newline = pending.indexOf('\n');
      if (newline !== -1) {
        yield pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        continue;
      }
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) return; // every chunk was written with a final newline
      pending += decoder.write(buffer.subarray(0, bytesRead));
    }
  } finally {
    await handle.close();
  }
}

/** Preserve the original canonical whole-store hash byte for byte. Spill sorted batches as
 * newline-delimited canonical JSON (embedded newlines are escaped), then merge one row per
 * chunk. Only offline inventory uses this narrowly scoped disk sort. */
export async function hashUpgradeStore(client: UpgradeReader, names: string[]): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'gg-upgrade-hash-'));
  try {
    const digest = createHash('sha256').update('{');
    let firstTable = true;
    for (const name of [...names].sort()) {
      const files: string[] = [];
      for await (const batch of tableBatches(client, name)) {
        const file = join(directory, String(files.length) + '.jsonl');
        await writeFile(
          file,
          batch
            .map((row) => stableStringify(row))
            .sort()
            .join('\n') + '\n',
        );
        files.push(file);
      }
      digest.update((firstTable ? '' : ',') + JSON.stringify(name) + ':[');
      firstTable = false;
      const readers = files.map((file) => chunkLines(file));
      try {
        const heads = await Promise.all(readers.map((reader) => reader.next()));
        let firstRow = true;
        for (;;) {
          let next = -1;
          for (let index = 0; index < heads.length; index += 1) {
            const head = heads[index]!;
            if (!head.done && (next === -1 || head.value < heads[next]!.value)) next = index;
          }
          if (next === -1) break;
          digest.update((firstRow ? '' : ',') + heads[next]!.value);
          firstRow = false;
          heads[next] = await readers[next]!.next();
        }
      } finally {
        await Promise.all(readers.map((reader) => reader.return(undefined)));
      }
      for (const file of files) await rm(file);
      digest.update(']');
    }
    return digest.update('}').digest('hex');
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
