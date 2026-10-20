import { describe, expect, it } from 'vitest';
import { isJsonValue } from './json-value.js';

describe('iterative JSON validation', () => {
  it('accepts JSON scalars, arrays, records, null prototypes and shared acyclic values', () => {
    const shared = { a: [1, false, null] };
    const nullPrototype: unknown = Object.create(null);
    for (const value of [null, 'text', true, 1, [], {}, nullPrototype, [shared, shared]])
      expect(isJsonValue(value)).toBe(true);
  });
  it('refuses non-JSON leaves, sparse arrays, class instances and cycles', () => {
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    for (const value of [
      undefined,
      Infinity,
      NaN,
      () => true,
      1n,
      Symbol('x'),
      new Date(),
      new Array<unknown>(1),
      { nested: { bad: undefined } },
      cycle,
    ])
      expect(isJsonValue(value)).toBe(false);
  });
  it('validates very deep parsed JSON without a recursive schema or call-stack limit', () => {
    const value: unknown = JSON.parse('['.repeat(15000) + '1' + ']'.repeat(15000));
    expect(isJsonValue(value)).toBe(true);
  });
});
