import { expect, it } from 'vitest';
import { fakeUlid } from './testing/index.js';
import {
  DeletionApprovalSchema,
  DeletionConfirmationSchema,
  DeletionSelectionSchema,
} from './deletion.js';

it('requires an explicit unique selection and a real confirmation, never a future-history preference', () => {
  const runIds = [fakeUlid('one'), fakeUlid('two')];
  expect(DeletionSelectionSchema.parse({ runIds })).toEqual({ runIds });
  expect(DeletionSelectionSchema.safeParse({ runIds: [runIds[0], runIds[0]] }).success).toBe(false);
  expect(DeletionSelectionSchema.safeParse({ runIds, futureHistory: true }).success).toBe(false);
  expect(
    DeletionConfirmationSchema.safeParse({
      runIds,
      token: 'a'.repeat(64),
      action: 'mark',
      confirmed: false,
    }).success,
  ).toBe(false);
  expect(
    DeletionConfirmationSchema.parse({
      runIds,
      token: 'a'.repeat(64),
      action: 'withdraw',
      confirmed: true,
    }).action,
  ).toBe('withdraw');
  expect(
    DeletionApprovalSchema.safeParse({
      confirmedAt: '2026-10-25T00:00:00.000Z',
      confirmedBy: { ownerId: 'local', kind: 'user', id: 'local' },
    }).success,
  ).toBe(true);
});
