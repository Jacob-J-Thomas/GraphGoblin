import { createClient } from '@libsql/client';
import { createHash } from 'node:crypto';
import { stableStringify } from '@graphgoblin/domain';
import { expect, it } from 'vitest';
import { hashUpgradeStore, rows, tableBatches, UPGRADE_BATCH_SIZE } from './upgrade-scan.js';

it('matches the old hash across batches, duplicate rows and UTF-16/control-character ordering', async () => {
  const client = createClient({ url: ':memory:' });
  try {
    await client.execute('CREATE TABLE facts(value TEXT, number INTEGER)');
    const values = ['??', '\ue000', '\n\r\t"\\\u0000', 'same', 'same'];
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
