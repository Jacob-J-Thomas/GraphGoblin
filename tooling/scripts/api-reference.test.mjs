import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  operationsByTag,
  operationsWithoutSummary,
  renderApiReference,
  schemaName,
} from './api-reference.mjs';
import { staleFiles } from './gen-docs.mjs';

const document = {
  info: { title: 'GraphGoblin API', version: '1.2.3' },
  tags: [
    { name: 'runs', description: 'Runs' },
    { name: 'empty', description: 'Nothing here' },
  ],
  paths: {
    '/runs/{id}/replay': {
      post: {
        tags: ['runs'],
        summary: 'Fork | replay',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object', properties: { nodeId: {} }, required: ['nodeId'] },
            },
          },
        },
        responses: { 202: {}, 409: {} },
      },
    },
    '/hooks/{token}': {
      post: {
        tags: ['hooks'],
        summary: 'Receive',
        parameters: [{ name: 'token', in: 'path' }],
        requestBody: { content: { 'text/plain': { schema: { type: 'string' } } } },
        responses: { 202: {} },
      },
    },
    '/healthz': { get: { summary: 'Health', responses: { 200: {} } } },
  },
};

test('schemaName names components and summarises inline bodies', () => {
  assert.equal(schemaName(undefined), '-');
  assert.equal(
    schemaName({ $ref: '#/components/schemas/LoopDefinitionInput' }),
    '`LoopDefinitionInput`',
  );
  assert.equal(
    schemaName({ type: 'array', items: { $ref: '#/components/schemas/X' } }),
    'array of `X`',
  );
  assert.equal(
    schemaName({ type: 'object', properties: { a: {}, b: {} }, required: ['a'] }),
    '`{ a, b? }`',
  );
  assert.equal(schemaName({ type: 'string' }), '`string`');
  assert.equal(schemaName({}), 'any');
});

test('operations are grouped by first tag in document order, untagged last', () => {
  const groups = operationsByTag(document);
  assert.deepEqual([...groups.keys()], ['runs', 'empty', 'hooks', 'other']);
  assert.equal(groups.get('runs')?.[0]?.path, '/runs/{id}/replay');
  assert.deepEqual(operationsByTag({}).size, 0);
});

test('renders a table per tag with parameters, body, and responses', () => {
  const md = renderApiReference(document);
  assert.match(md, /^# API reference/);
  assert.match(md, /GraphGoblin API 1\.2\.3/);
  assert.match(md, /## runs\n\nRuns\./);
  assert.match(
    md,
    /\| POST \| `\/runs\/\{id\}\/replay` \| Fork \\\| replay \| `id`: string \(path, required\) \| `\{ nodeId \}` \| 202, 409 \|/,
  );
  assert.match(md, /\| `token` \(path\) \| `string` as `text\/plain` \| 202 \|/);
  assert.match(md, /\| GET \| `\/healthz` \| Health \| - \| - \| 200 \|/);
  assert.doesNotMatch(md, /## empty/);
});

test('an operation without a summary fails the render', () => {
  const missing = { paths: { '/x': { get: { responses: {} }, delete: { summary: 'ok' } } } };
  assert.deepEqual(operationsWithoutSummary(missing), ['GET /x']);
  assert.throws(() => renderApiReference(missing), /GET \/x/);
  assert.match(
    renderApiReference({
      paths: { '/y': { put: { summary: 'S', requestBody: { content: {} } } } },
    }),
    /\| PUT \| `\/y` \| S \| - \| - \| {2}\|/,
  );
});

test('staleFiles reports changed and missing files, ignoring CRLF', () => {
  const files = { a: 'one\ntwo\n', b: 'same\n', c: 'new\n' };
  const disk = { a: 'one\r\nthree\r\n', b: 'same\r\n' };
  const read = (path) => {
    if (!(path in disk)) throw new Error('ENOENT');
    return disk[path];
  };
  assert.deepEqual(staleFiles(files, read), ['a', 'c']);
});
