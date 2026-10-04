import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { originalWorker } from './worker.js';

await test('removes interrupted-run trailing markers and preserves the real worker bytes', () => {
  const source = 'self.addEventListener("install", () => {});\n';
  assert.equal(originalWorker(source), source);
  assert.equal(originalWorker(`${source}\n// E2E build 1\n`), source);
  assert.equal(originalWorker(`${source}\n// E2E build 1\n\n// E2E build 2\n`), source);
  assert.equal(
    originalWorker('// E2E build 1\nself.skipWaiting();'),
    '// E2E build 1\nself.skipWaiting();',
  );
});
