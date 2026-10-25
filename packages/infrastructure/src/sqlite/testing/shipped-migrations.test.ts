import { expect, it } from 'vitest';
import { openStoreBefore, shippedSqlMigrationsFrom } from './shipped-migrations.js';

it('refuses a tag that no shipped migration carries', async () => {
  await expect(shippedSqlMigrationsFrom('9999_missing')).rejects.toThrow(
    'No shipped migration is tagged 9999_missing',
  );
  await expect(openStoreBefore(':memory:', '9999_missing')).rejects.toThrow(
    'No shipped migration is tagged 9999_missing',
  );
});

it('counts the shipped suffix from a tag', async () => {
  expect(await shippedSqlMigrationsFrom('0000_init')).toBeGreaterThan(1);
});
