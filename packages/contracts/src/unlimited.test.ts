import { describe, expect, it } from 'vitest';
import { LoopSettingsSchema } from './loop.js';
import { DecisionConfigSchema } from './evaluation.js';

describe('visible execution limits (#243)', () => {
  it('applies visible defaults to an empty definition settings object', () => {
    expect(LoopSettingsSchema.parse({})).toMatchObject({
      maxNodeVisits: 10,
      runDeadlineSeconds: null,
    });
  });
  it('accepts explicit unlimited guards', () => {
    expect(
      LoopSettingsSchema.parse({ maxNodeVisits: null, runDeadlineSeconds: null }),
    ).toMatchObject({ maxNodeVisits: null, runDeadlineSeconds: null });
    expect(
      DecisionConfigSchema.safeParse({
        kind: 'expression',
        jsonata: '"again"',
        routes: [
          { id: 'again', label: 'Again', repeat: true },
          { id: 'done', label: 'Done' },
        ],
        maxPasses: null,
      }).success,
    ).toBe(true);
  });
  it.each([0, -1, 1.5, Infinity])('refuses invalid deadlines %s', (runDeadlineSeconds) => {
    expect(LoopSettingsSchema.safeParse({ runDeadlineSeconds }).success).toBe(false);
  });
});
