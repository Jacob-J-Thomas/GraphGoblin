import { expect, it } from 'vitest';
import { originalWorker } from './worker.js';

it('removes interrupted-run trailing markers and preserves the real worker bytes', () => {
  const source = 'self.addEventListener("install", () => {});\n';
  expect(originalWorker(source)).toBe(source);
  expect(originalWorker(`${source}\n// E2E build 1\n`)).toBe(source);
  expect(originalWorker(`${source}\n// E2E build 1\n\n// E2E build 2\n`)).toBe(source);
  expect(originalWorker('// E2E build 1\nself.skipWaiting();')).toBe(
    '// E2E build 1\nself.skipWaiting();',
  );
});
