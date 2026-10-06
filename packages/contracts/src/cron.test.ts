import { describe, expect, it } from 'vitest';
import { CronPreviewRequestSchema, CronPreviewResponseSchema } from './index.js';

describe('cron preview contracts', () => {
  it('defaults to five slots and permits an offset timestamp', () => {
    expect(CronPreviewRequestSchema.parse({ expression: '0 9 * * *', timezone: 'UTC' }).count).toBe(
      5,
    );
    expect(
      CronPreviewRequestSchema.parse({
        expression: '* * * * *',
        timezone: 'UTC',
        count: 10,
        from: '2026-03-28T09:00:00+01:00',
      }).count,
    ).toBe(10);
    expect(CronPreviewResponseSchema.parse({ next: [] })).toEqual({ next: [] });
  });
  it.each([
    { count: 0 },
    { count: 11 },
    { count: 1.5 },
    { from: 'tomorrow' },
    { expression: 'x'.repeat(257) },
    { timezone: 'x'.repeat(65) },
    { extra: true },
  ])('rejects malformed or unbounded requests: %j', (overrides) => {
    expect(
      CronPreviewRequestSchema.safeParse({ expression: '* * * * *', timezone: 'UTC', ...overrides })
        .success,
    ).toBe(false);
  });
});
