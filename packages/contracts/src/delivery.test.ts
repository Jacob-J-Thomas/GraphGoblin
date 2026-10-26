import { expect, it } from 'vitest';
import { RunEventSchema } from './events.js';

it.each(['return.delivered', 'return.failed'])(
  'rejects the retired webhook %s event shape',
  (type) => {
    expect(
      RunEventSchema.safeParse({
        runId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        seq: 1,
        ts: '2026-10-20T12:00:00.000Z',
        type,
        channel: { kind: 'webhook', url: 'https://example.test' },
        ...(type === 'return.failed' ? { error: 'old failure' } : {}),
      }).success,
    ).toBe(false);
  },
);
