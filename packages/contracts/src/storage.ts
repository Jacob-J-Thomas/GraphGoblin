import { z } from 'zod';
import { TimestampSchema } from './common.js';

/** Cached observation only. Reading storage never grants consent or starts cleanup. */
export const StorageStatusSchema = z.strictObject({
  state: z.enum(['adequate', 'pressure', 'no-eligible', 'unavailable']),
  checkedAt: TimestampSchema.nullable(),
  volumes: z.array(
    z.strictObject({
      name: z.enum(['data', 'database']),
      totalBytes: z.number().int().nonnegative(),
      availableBytes: z.number().int().nonnegative(),
    }),
  ),
  cleaning: z.boolean(),
  deletedRuns: z.number().int().nonnegative(),
  removedFileBytes: z.number().int().nonnegative(),
  reusableDatabaseBytes: z.number().int().nonnegative(),
  pendingResources: z.number().int().nonnegative(),
  preservedResources: z.number().int().nonnegative(),
});
export type StorageStatus = z.infer<typeof StorageStatusSchema>;
