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
  batchSize = UPGRADE_BATCH_SIZE,
  selection: { columns?: string; where?: string } = {},
): AsyncGenerator<UpgradeRow[]> {
  let after: number | undefined;
  for (;;) {
    const batch = await rows(
      client,
      'SELECT rowid AS __gg_rowid,' +
        (selection.columns ?? '*') +
        ' FROM ' +
        quote(table) +
        ' WHERE ' +
        (selection.where ? '(' + selection.where + ') AND ' : '') +
        (after === undefined ? '1' : 'rowid>?') +
        ' ORDER BY rowid LIMIT ?',
      after === undefined ? [batchSize] : [after, batchSize],
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

/** Binary min-heap compares strings with JavaScript's UTF-16 code-unit ordering. */
class Heads {
  private readonly values: { value: string; reader: number }[] = [];
  push(head: { value: string; reader: number }): void {
    let index = this.values.length;
    this.values.push(head);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.values[parent]!.value <= head.value) break;
      this.values[index] = this.values[parent]!;
      index = parent;
    }
    this.values[index] = head;
  }
  pop(): { value: string; reader: number } | undefined {
    const first = this.values[0];
    const last = this.values.pop();
    if (this.values.length) {
      let index = 0;
      while (index * 2 + 1 < this.values.length) {
        let child = index * 2 + 1;
        if (
          child + 1 < this.values.length &&
          this.values[child + 1]!.value < this.values[child]!.value
        )
          child += 1;
        if (last!.value <= this.values[child]!.value) break;
        this.values[index] = this.values[child]!;
        index = child;
      }
      this.values[index] = last!;
    }
    return first;
  }
}
async function* mergeChunks(files: string[]): AsyncGenerator<string> {
  const readers = files.map((file) => chunkLines(file));
  try {
    const heap = new Heads();
    for (let index = 0; index < readers.length; index += 1) {
      const head = await readers[index]!.next();
      if (!head.done) heap.push({ value: head.value, reader: index });
    }
    for (;;) {
      const head = heap.pop();
      if (!head) return;
      yield head.value;
      const next = await readers[head.reader]!.next();
      if (!next.done) heap.push({ value: next.value, reader: head.reader });
    }
  } finally {
    await Promise.all(readers.map((reader) => reader.return(undefined)));
  }
}
async function mergeToFile(files: string[], output: string): Promise<void> {
  const handle = await open(output, 'w');
  try {
    let buffer = '';
    for await (const line of mergeChunks(files)) {
      buffer += line + '\n';
      if (buffer.length >= 64 * 1024) {
        await handle.writeFile(buffer);
        buffer = '';
      }
    }
    await handle.writeFile(buffer);
  } finally {
    await handle.close();
  }
}
export interface UpgradeSortOptions {
  chunkSize?: number;
  fanIn?: number;
  temporaryRoot?: string;
}
/** Shared only by offline hash/provenance scans. The supplied batches remain bounded. */
export async function* canonicalUpgradeRows(
  batches: AsyncIterable<UpgradeRow[]>,
  options: UpgradeSortOptions = {},
): AsyncGenerator<string> {
  // Reserve one descriptor for the intermediate output: at most 64 spill files open.
  const fanIn = options.fanIn ?? 63;
  if (!Number.isInteger(fanIn) || fanIn < 2 || fanIn > 63)
    throw new Error('Upgrade sort requires a positive chunk size and fan-in between 2 and 63');
  const directory = await mkdtemp(join(options.temporaryRoot ?? tmpdir(), 'gg-upgrade-hash-'));
  try {
    let files: string[] = [];
    let serial = 0;
    const nextFile = () => join(directory, String(serial++) + '.jsonl');
    for await (const batch of batches) {
      const file = nextFile();
      await writeFile(
        file,
        batch
          .map((row) => stableStringify(row))
          .sort()
          .join('\n') + '\n',
      );
      files.push(file);
    }
    while (files.length > fanIn) {
      const merged: string[] = [];
      for (let start = 0; start < files.length; start += fanIn) {
        const inputs = files.slice(start, start + fanIn);
        const output = nextFile();
        await mergeToFile(inputs, output);
        for (const file of inputs) await rm(file);
        merged.push(output);
      }
      files = merged;
    }
    yield* mergeChunks(files);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
/** Preserve the original canonical hash with at most 64 spill files open and a binary heap. */
export async function hashUpgradeStore(
  client: UpgradeReader,
  names: string[],
  options: UpgradeSortOptions = {},
): Promise<string> {
  const chunkSize = options.chunkSize ?? UPGRADE_BATCH_SIZE;
  if (!Number.isInteger(chunkSize) || chunkSize < 1)
    throw new Error('Upgrade sort requires a positive chunk size and fan-in between 2 and 63');
  // Validate fan-in even for a store without tables.
  if (
    options.fanIn !== undefined &&
    (!Number.isInteger(options.fanIn) || options.fanIn < 2 || options.fanIn > 63)
  )
    throw new Error('Upgrade sort requires a positive chunk size and fan-in between 2 and 63');
  const digest = createHash('sha256').update('{');
  let firstTable = true;
  for (const name of [...names].sort()) {
    digest.update((firstTable ? '' : ',') + JSON.stringify(name) + ':[');
    firstTable = false;
    let firstRow = true;
    for await (const value of canonicalUpgradeRows(
      tableBatches(client, name, chunkSize),
      options,
    )) {
      digest.update((firstRow ? '' : ',') + value);
      firstRow = false;
    }
    digest.update(']');
  }
  return digest.update('}').digest('hex');
}
