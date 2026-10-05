import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NODE_DOCS,
  advancedMarker,
  discriminator,
  fieldRows,
  nodeFieldDocs,
  renderNodeReference,
  typeOf,
  undocumentedFields,
} from './node-reference.mjs';

/** A stand-in for a Zod 4 schema: only `_zod.def` is read. */
const zod = (def) => ({ _zod: { def } });
const object = (shape) => zod({ type: 'object', shape });
const optional = (inner) => zod({ type: 'optional', innerType: inner });
const prefault = (inner) => zod({ type: 'prefault', innerType: inner });

/** A stand-in for the contracts' `fieldMeta`: metadata by schema, `{}` when none. */
function metaReader(entries) {
  const map = new Map(entries);
  return (schema) => map.get(schema) ?? {};
}

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

test('advancedMarker says yes, nothing, or which fields of a split object stay basic', () => {
  const plain = zod({ type: 'string' });
  const advanced = optional(zod({ type: 'number' }));
  const sandbox = zod({ type: 'enum' });
  const approval = zod({ type: 'enum' });
  const split = prefault(object({ sandbox, approval }));
  const allAdvanced = prefault(object({ approval }));
  const quiet = object({ sandbox });
  const read = metaReader([
    [advanced, { advanced: true }],
    [approval, { advanced: true }],
  ]);
  assert.equal(advancedMarker(plain, read), '');
  assert.equal(advancedMarker(advanced, read), 'yes');
  assert.equal(advancedMarker(split, read), 'all but `sandbox`');
  assert.equal(advancedMarker(allAdvanced, read), 'yes');
  assert.equal(advancedMarker(quiet, read), '');
  assert.equal(advancedMarker(prefault(zod({ type: 'object' })), read), '');
});

test('nodeFieldDocs reads each field of each variant with the metadata reader', () => {
  const command = zod({ type: 'string' });
  const env = optional(zod({ type: 'record' }));
  const seconds = zod({ type: 'number' });
  const name = zod({ type: 'string' });
  const read = metaReader([
    [command, { description: 'Program to run.' }],
    [env, { description: 'Extra environment.', advanced: true }],
    [seconds, { description: 'How long.' }],
  ]);
  const docs = nodeFieldDocs(
    {
      script: object({ command, env }),
      wait: zod({
        type: 'union',
        options: [object({ mode: zod({ type: 'literal' }), seconds }), object({ name })],
      }),
    },
    read,
  );
  assert.deepEqual(docs['script'], [
    {
      command: { description: 'Program to run.', advanced: '' },
      env: { description: 'Extra environment.', advanced: 'yes' },
    },
  ]);
  assert.deepEqual(docs['wait'], [
    {
      mode: { description: undefined, advanced: '' },
      seconds: { description: 'How long.', advanced: '' },
    },
    { name: { description: undefined, advanced: '' } },
  ]);
  assert.deepEqual(nodeFieldDocs({ mutate: zod({ type: 'string' }) }, read), { mutate: [{}] });
});

test('fieldRows lists name, type, required, default, Advanced, and description', () => {
  const rows = fieldRows(
    {
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'boolean', default: true }, c: {} },
      required: ['a'],
    },
    { a: { description: 'The a.', advanced: 'yes' } },
    new Set(['c']),
  );
  assert.deepEqual(rows, [
    {
      name: 'a',
      type: 'string',
      required: true,
      default: '',
      advanced: 'yes',
      description: 'The a.',
    },
    {
      name: 'b',
      type: 'boolean',
      required: false,
      default: '`true`',
      advanced: '',
      description: '',
    },
  ]);
  assert.deepEqual(fieldRows({}, {}), []);
});

test('undocumented fields and kinds are reported, and the renderer refuses them', () => {
  const schemas = {
    mutate: { type: 'object', properties: { operations: {}, extra: {} } },
    wait: { oneOf: [{ properties: { mode: { const: 'duration' }, seconds: {} } }] },
    mystery: { type: 'object' },
  };
  const docs = {
    mutate: [{ operations: { description: 'Ops.' } }],
    wait: [{ seconds: { description: '' } }],
  };
  assert.deepEqual(undocumentedFields(schemas, docs), ['mutate.extra', 'wait.seconds', 'mystery']);
  assert.deepEqual(undocumentedFields({ exit: { properties: { criteria: {} } } }, {}), [
    'exit.criteria',
  ]);
  assert.throws(
    () => renderNodeReference(schemas, docs),
    /describe mutate\.extra, wait\.seconds, mystery with \.meta\(field/,
  );
});

test('renders one section per kind, with a table per variant and Advanced only when used', () => {
  const md = renderNodeReference(
    {
      mutate: { type: 'object', properties: { operations: { type: 'array' } } },
      script: {
        type: 'object',
        properties: { command: { type: 'string' }, env: { type: 'object' } },
        required: ['command'],
      },
      wait: {
        oneOf: [
          {
            type: 'object',
            properties: { mode: { const: 'duration' }, seconds: { type: 'integer' } },
            required: ['mode', 'seconds'],
          },
        ],
      },
    },
    {
      mutate: [{ operations: { description: 'Ops | in order.', advanced: '' } }],
      script: [
        {
          command: { description: 'Program to run.', advanced: '' },
          env: { description: 'Extra environment.', advanced: 'yes' },
        },
      ],
      wait: [{ seconds: { description: 'How long to wait.', advanced: '' } }],
    },
  );
  assert.match(md, /^# Node reference/);
  assert.match(md, /\*\*Advanced\*\* marks the fields/);
  assert.match(md, /## Context mutation \(`mutate`\)/);
  assert.match(md, /\| Field \| Type \| Required \| Default \| Description \|\n\| --- \|/);
  assert.match(md, /\| `operations` \| any\[\] \| no \|  \| Ops \\\| in order\. \|/);
  assert.match(md, /\| Field \| Type \| Required \| Default \| Advanced \| Description \|/);
  assert.match(md, /\| `command` \| string \| yes \|  \|  \| Program to run\. \|/);
  assert.match(md, /\| `env` \| object \| no \|  \| yes \| Extra environment\. \|/);
  assert.match(md, /### `mode: "duration"`/);
  assert.match(md, /\| `seconds` \| integer \| yes \|  \| How long to wait\. \|/);
  assert.doesNotMatch(md, /\| `mode` \|/);
  assert.doesNotMatch(md, /## Trigger/);
});

test('every catalog kind has a title, purpose, and ports', () => {
  for (const [kind, docs] of Object.entries(NODE_DOCS)) {
    assert.ok(docs.title && docs.purpose && docs.ports, kind);
  }
});
