import { expect, it } from 'vitest';
import { StorageStatusSchema } from './storage.js';
it('requires a finite, explicit cached storage observation with honest separate accounting', () => {
  const status = {
    state: 'pressure',
    checkedAt: null,
    volumes: [{ name: 'data', totalBytes: 100, availableBytes: 1 }],
    cleaning: false,
    deletedRuns: 1,
    removedFileBytes: 5,
    reusableDatabaseBytes: 4096,
    pendingResources: 1,
    preservedResources: 1,
  };
  expect(StorageStatusSchema.parse(status)).toEqual(status);
  expect(StorageStatusSchema.safeParse({ ...status, removedFileBytes: -1 }).success).toBe(false);
  expect(StorageStatusSchema.safeParse({ ...status, consentForFutureRuns: true }).success).toBe(
    false,
  );
});
