import { describe, expect, it } from 'vitest';
import { stableHash, stableStringify, validateJson } from './json-schema.js';

describe('validateJson', () => {
  it('validates with formats and reports paths', () => {
    const schema = {
      type: 'object',
      required: ['email', 'n'],
      properties: {
        email: { type: 'string', format: 'email' },
        n: { type: 'integer', minimum: 1 },
      },
    };
    expect(validateJson(schema, { email: 'a@b.co', n: 2 })).toEqual({ ok: true, errors: [] });
    const bad = validateJson(schema, { email: 'nope', n: 0 });
    expect(bad.ok).toBe(false);
    expect(bad.errors.join('\n')).toMatch(/\/email/);
    expect(bad.errors.join('\n')).toMatch(/\/n/);
  });

  it('reports root-level failures with "/"', () => {
    const bad = validateJson({ type: 'string' }, 5);
    expect(bad.errors[0]).toMatch(/^\/ /);
  });

  it('reports invalid schemas as validation errors', () => {
    const result = validateJson({ type: 'not-a-type' }, 1);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/invalid schema/);
  });

  it('reuses compiled schemas and evicts beyond the cache limit', () => {
    for (let i = 0; i < 260; i += 1) {
      expect(
        validateJson({ type: 'object', properties: { [`k${i}`]: { type: 'number' } } }, {}).ok,
      ).toBe(true);
    }
    expect(validateJson({ type: 'object', properties: { k0: { type: 'number' } } }, {}).ok).toBe(
      true,
    );
  });
});

describe('stableStringify / stableHash', () => {
  it('sorts keys and drops undefined', () => {
    expect(stableStringify({ b: 1, a: [2, { d: undefined, c: 3 }] })).toBe(
      '{"a":[2,{"c":3}],"b":1}',
    );
    expect(stableStringify(undefined)).toBe('undefined');
    expect(stableStringify(null)).toBe('null');
  });

  it('hashes equal structures equally regardless of key order', () => {
    expect(stableHash({ a: 1, b: 2 })).toBe(stableHash({ b: 2, a: 1 }));
    expect(stableHash({ a: 1 })).not.toBe(stableHash({ a: 2 }));
    expect(stableHash({ a: 1 })).toMatch(/^[0-9a-f]{16}$/);
  });
});
