import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NODE_DOCS,
  discriminator,
  fieldRows,
  renderNodeReference,
  typeOf,
  undocumentedFields,
} from './node-reference.mjs';

test('typeOf renders the common JSON Schema shapes briefly', () => {
  assert.equal(typeOf(undefined), 'any');
  assert.equal(typeOf({}), 'any');
  assert.equal(typeOf({ type: 'string' }), 'string');
  assert.equal(typeOf({ type: ['string', 'null'] }), 'string | null');
  assert.equal(typeOf({ const: 'codex' }), '`"codex"`');
  assert.equal(typeOf({ enum: ['a', 'b'] }), '`"a"` | `"b"`');
  assert.equal(typeOf({ $ref: '#/$defs/__schema0' }), 'JSON value');
  assert.equal(typeOf({ $ref: '#/$defs/Other' }), 'object');
  assert.equal(typeOf({ type: 'array', items: { type: 'string' } }), 'string[]');
  assert.equal(typeOf({ type: 'array', items: { enum: ['x', 'y'] } }), 'array of (`"x"` | `"y"`)');
  assert.equal(typeOf({ type: 'object' }), 'object');
  assert.equal(typeOf({ type: 'object', additionalProperties: {} }), 'object');
  assert.equal(
    typeOf({ type: 'object', additionalProperties: { type: 'string' } }),
    'map of string',
  );
  assert.equal(
    typeOf({ type: 'object', properties: { a: {}, b: {} }, required: ['a'] }),
    '{ a, b? }',
  );
  assert.equal(
    typeOf({ type: 'object', properties: { a: {}, b: {}, c: {}, d: {}, e: {} } }),
    'object',
  );
  assert.equal(typeOf({ anyOf: [{ type: 'string' }, { type: 'number' }] }), 'string | number');
  assert.equal(
    typeOf({
      oneOf: [
        { type: 'object', properties: { kind: { const: 'a' } } },
        { type: 'object', properties: { kind: { const: 'b' } } },
      ],
    }),
    'one of `"a"` | `"b"` by `kind`',
  );
});

test('discriminator finds the shared const property', () => {
  assert.equal(discriminator([]), undefined);
  assert.equal(
    discriminator([{ properties: { x: { type: 'string' } } }, { properties: { x: {} } }]),
    undefined,
  );
  assert.deepEqual(
    discriminator([{ properties: { m: { const: 1 } } }, { properties: { m: { const: 2 } } }]),
    { key: 'm', values: [1, 2] },
  );
});

test('fieldRows lists name, type, required, default, and description', () => {
  const rows = fieldRows(
    {
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'boolean', default: true }, c: {} },
      required: ['a'],
    },
    { a: 'The a.' },
    new Set(['c']),
  );
  assert.deepEqual(rows, [
    { name: 'a', type: 'string', required: true, default: '', description: 'The a.' },
    { name: 'b', type: 'boolean', required: false, default: '`true`', description: '' },
  ]);
  assert.deepEqual(fieldRows({}, {}), []);
});

test('undocumented fields and kinds are reported, and the renderer refuses them', () => {
  const schemas = {
    mutate: { type: 'object', properties: { operations: {}, extra: {} } },
    mystery: { type: 'object' },
  };
  assert.deepEqual(undocumentedFields(schemas), ['mutate.extra', 'mystery']);
  assert.throws(() => renderNodeReference(schemas), /mutate\.extra, mystery/);
});

test('renders one section per kind, with a table per variant of a union', () => {
  const md = renderNodeReference({
    mutate: { type: 'object', properties: { operations: { type: 'array' } } },
    wait: {
      oneOf: [
        {
          type: 'object',
          properties: { mode: { const: 'duration' }, seconds: { type: 'integer' } },
          required: ['mode', 'seconds'],
        },
      ],
    },
  });
  assert.match(md, /^# Node reference/);
  assert.match(md, /## Context mutation \(`mutate`\)/);
  assert.match(md, /\| `operations` \| any\[\] \| no \|/);
  assert.match(md, /### `mode: "duration"`/);
  assert.match(md, /\| `seconds` \| integer \| yes \|/);
  assert.doesNotMatch(md, /\| `mode` \|/);
  assert.doesNotMatch(md, /## Trigger/);
});

test('every catalog kind has a title, purpose, ports, and field descriptions', () => {
  for (const [kind, docs] of Object.entries(NODE_DOCS)) {
    assert.ok(docs.title && docs.purpose && docs.ports, kind);
    assert.ok(Object.keys(docs.fields).length > 0, kind);
  }
});
