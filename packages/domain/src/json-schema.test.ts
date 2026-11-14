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
    expect(validateJson(schema, { email: 'a@b.co', n: 2 })).toEqual({
      ok: true,
      errors: [],
      issues: [],
    });
    const bad = validateJson(schema, { email: 'nope', n: 0 });
    expect(bad.ok).toBe(false);
    expect(bad.errors.join('\n')).toMatch(/\/email/);
    expect(bad.errors.join('\n')).toMatch(/\/n/);
    expect(bad.issues).toEqual([
      { path: ['email'], message: 'must match format "email"' },
      { path: ['n'], message: 'must be >= 1' },
    ]);
  });

  it('locates issues: a missing property at itself, nested paths unescaped', () => {
    const schema = {
      type: 'object',
      required: ['approved', 'review status'],
      properties: {
        'a/b~c': { type: 'array', items: { type: 'string' } },
      },
    };
    const bad = validateJson(schema, { 'a/b~c': ['x', 2] });
    expect(bad.errors).toContain("/ must have required property 'approved'");
    expect(bad.issues).toEqual([
      { path: ['approved'], message: 'is required' },
      { path: ['review status'], message: 'is required' },
      { path: ['a/b~c', '1'], message: 'must be string' },
    ]);
  });

  it('reports root-level failures with "/"', () => {
    const bad = validateJson({ type: 'string' }, 5);
    expect(bad.errors[0]).toMatch(/^\/ /);
    expect(bad.issues).toEqual([{ path: [], message: 'must be string' }]);
  });

  it('reports invalid schemas as validation errors', () => {
    const result = validateJson({ type: 'not-a-type' }, 1);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/invalid schema/);
    expect(result.issues[0]).toEqual({ path: [], message: result.errors[0] });
  });

  it.each(['integer', 'string'] as const)(
    'compiles both versions of one schema ID starting with %s',
    (first) => {
      const id = `https://example.test/${first}/input`;
      const types = [first, first === 'integer' ? 'string' : 'integer'] as const;
      for (const type of types) {
        const schema = {
          $id: id,
          definitions: { value: { $id: 'value', type } },
          properties: { value: { $ref: 'value' } },
        };
        const input = type === 'integer' ? 2 : 'word';
        expect(validateJson(schema, { value: input }).ok).toBe(true);
        expect(validateJson(schema, { value: false }).issues).toEqual([
          { path: ['value'], message: `must be ${type}` },
        ]);
        expect(validateJson({ ...schema }, { value: input }).ok).toBe(true);
      }
    },
  );

  it('rejects references outside the current schema even after compiling their target', () => {
    const id = 'https://example.test/other-schema';
    expect(
      validateJson(
        {
          $id: id,
          definitions: { number: { $id: 'number', type: 'integer' } },
          $ref: 'number',
        },
        2,
      ).ok,
    ).toBe(true);
    for (const ref of [id, new URL('number', id).href]) {
      const result = validateJson({ properties: { value: { $ref: ref } } }, { value: 2 });
      expect(result.issues).toEqual([
        { path: [], message: expect.stringContaining(`can't resolve reference ${ref}`) },
      ]);
    }
  });

  it('clears IDs registered by a failed compilation', () => {
    const id = 'https://example.test/failure';
    const missing = 'https://example.test/missing';
    const attempted = {
      $id: id,
      definitions: { number: { $id: 'failed-number', type: 'integer' } },
      $ref: missing,
    };
    expect(validateJson(attempted, 2).errors[0]).toContain(`can't resolve reference ${missing}`);
    const nestedId = new URL('failed-number', id).href;
    expect(validateJson({ $ref: nestedId }, 2).errors[0]).toContain(
      `can't resolve reference ${nestedId}`,
    );
    expect(validateJson({ ...attempted, $ref: 'failed-number' }, 2).ok).toBe(true);
  });

  it('keeps local recursion in cached validators across compiles with the same ID', () => {
    const schema = {
      $id: 'https://example.test/chain',
      type: 'object',
      properties: { next: { $ref: '#' }, value: { type: 'integer' } },
    };
    expect(validateJson(schema, { next: { value: 2 } }).ok).toBe(true);
    expect(validateJson({ $id: schema.$id, type: 'string' }, 'independent').ok).toBe(true);
    expect(validateJson({ ...schema }, { next: { value: 'wrong' } }).issues).toEqual([
      { path: ['next', 'value'], message: 'must be integer' },
    ]);
  });

  it('retains local pointer references and treats reference-shaped examples as data', () => {
    const schema = {
      $schema: 'http://json-schema.org/schema',
      $id: 'https://example.test/own-schema',
      definitions: { value: { type: 'string', minLength: 1 } },
      examples: [{ $ref: 'https://example.test/only-an-example' }],
      properties: { value: { $ref: '#/definitions/value' } },
    };
    expect(validateJson(schema, { value: 'ok' }).ok).toBe(true);
    expect(validateJson(schema, { value: '' }).issues).toEqual([
      { path: ['value'], message: 'must NOT have fewer than 1 characters' },
    ]);
  });

  it('keeps a cached validator tied to the original schema content after caller edits', () => {
    const schema = { $id: 'https://example.test/constant', const: { value: 1 } };
    expect(validateJson(schema, { value: 1 }).ok).toBe(true);
    schema.const.value = 2;
    expect(validateJson(schema, { value: 2 }).ok).toBe(true);
    const original = { ...schema, const: { value: 1 } };
    expect(validateJson(original, { value: 1 }).ok).toBe(true);
    expect(validateJson(original, { value: 2 }).ok).toBe(false);
  });

  it('reuses compiled schemas and evicts beyond the cache limit', () => {
    const draftUris = ['http://json-schema.org/schema', 'http://json-schema.org/draft-07/schema#'];
    for (let i = 0; i < 260; i += 1) {
      expect(
        validateJson(
          {
            $schema: draftUris[i % draftUris.length],
            type: 'object',
            properties: { [`k${i}`]: { type: 'number' } },
          },
          {},
        ).ok,
      ).toBe(true);
    }
    expect(
      validateJson(
        {
          $schema: draftUris[0],
          type: 'object',
          properties: { k0: { type: 'number' } },
        },
        {},
      ).ok,
    ).toBe(true);
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
