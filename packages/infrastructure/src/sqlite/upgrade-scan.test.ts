import { createClient } from '@libsql/client';
import { createHash } from 'node:crypto';
import { stableStringify } from '@graphgoblin/domain';
import { expect, it } from 'vitest';
import { hashUpgradeStore, rows, tableBatches, UPGRADE_BATCH_SIZE } from './upgrade-scan.js';

it('matches the old hash across batches, duplicate rows and UTF-16/control-character ordering', async () => {
  const client = createClient({ url: ':memory:' });
  try {
    await client.execute('CREATE TABLE facts(value TEXT, number INTEGER)');
    const values = ['\u{10000}', '\ue000', '\n\r\t"\\\u0000', 'same', 'same'];
    for (let start = 0; start < 1_200; start += UPGRADE_BATCH_SIZE)
      await client.batch(
        Array.from({ length: Math.min(UPGRADE_BATCH_SIZE, 1_200 - start) }, (_, offset) => ({
          sql: 'INSERT INTO facts(value,number) VALUES (?,?)',
          args: [values[(start + offset) % values.length]!, (start + offset) % 11],
        })),
        'write',
      );
    const sizes: number[] = [];
    for await (const batch of tableBatches(client, 'facts')) sizes.push(batch.length);
    expect(sizes).toEqual([500, 500, 200]);
    const canonical = (await rows(client, 'SELECT * FROM facts'))
      .map((row) => stableStringify(row))
      .sort();
    const reference = '{"facts":[' + canonical.join(',') + ']}';
    expect(await hashUpgradeStore(client, ['facts'])).toBe(
      createHash('sha256').update(reference).digest('hex'),
    );
  } finally {
    client.close();
  }
});

it('propagates a failed inventory read while cleaning up its temporary sort', async () => {
  const error = new Error('inventory read interrupted');
  await expect(hashUpgradeStore({ execute: () => Promise.reject(error) }, ['facts'])).rejects.toBe(
    error,
  );
});
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { vi } from 'vitest';
vi.mock('node:fs/promises', { spy: true });
it('merges multiple bounded fan-in passes with hash parity and removes all spill files', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'gg-sort-test-'));
  const client = createClient({ url: ':memory:' });
  try {
    await client.execute('CREATE TABLE facts(value TEXT)');
    for (let index = 0; index < 181; index += 1)
      await client.execute({
        sql: 'INSERT INTO facts VALUES (?)',
        args: [
          index === 0
            ? 'x'.repeat(80_000)
            : ['\u{10000}', '\ue000', '\n\u0000', 'duplicate'][index % 4]! + (index % 17),
        ],
      });
    const reference =
      '{"facts":[' +
      (await rows(client, 'SELECT * FROM facts')).map(stableStringify).sort().join(',') +
      ']}';
    const { open: actualOpen } = await vi.importActual<typeof fs>('node:fs/promises');
    let live = 0,
      peak = 0;
    vi.spyOn(fs, 'open').mockImplementation(async (path, flags, mode) => {
      const handle = await actualOpen(path, flags, mode);
      if (flags === 'r') {
        peak = Math.max(peak, ++live);
        const close = handle.close.bind(handle);
        vi.spyOn(handle, 'close').mockImplementation(async () => {
          live -= 1;
          await close();
        });
      }
      return handle;
    });
    expect(
      await hashUpgradeStore(client, ['facts'], { chunkSize: 3, fanIn: 3, temporaryRoot: root }),
    ).toBe(createHash('sha256').update(reference).digest('hex'));
    expect(await fs.readdir(root)).toEqual([]);
    expect(peak).toBe(3);
    expect(live).toBe(0);
  } finally {
    vi.restoreAllMocks();
    client.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
it('closes merge readers and cleans intermediate output when a merge read fails', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'gg-sort-failure-'));
  const client = createClient({ url: ':memory:' });
  const { open: originalOpen } = await vi.importActual<typeof fs>('node:fs/promises');
  try {
    await client.execute('CREATE TABLE facts(value TEXT)');
    for (let index = 0; index < 7; index += 1)
      await client.execute("INSERT INTO facts VALUES ('x')");
    let reads = 0;
    vi.spyOn(fs, 'open').mockImplementation((path, flags, mode) => {
      if (flags === 'r' && ++reads === 2)
        return Promise.reject(new Error('merge read interrupted'));
      return originalOpen(path, flags, mode);
    });
    await expect(
      hashUpgradeStore(client, ['facts'], { chunkSize: 1, fanIn: 2, temporaryRoot: root }),
    ).rejects.toThrow('merge read interrupted');
    expect(await fs.readdir(root)).toEqual([]);
  } finally {
    vi.restoreAllMocks();
    client.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
it.each([
  { chunkSize: 0 },
  { chunkSize: 1.5 },
  { fanIn: 1 },
  { fanIn: 64 },
  { fanIn: 65 },
  { fanIn: 2.5 },
])('rejects invalid sort bounds %j', async (options) => {
  await expect(
    hashUpgradeStore({ execute: () => Promise.reject(new Error('must not read')) }, [], options),
  ).rejects.toThrow('Upgrade sort requires');
});
