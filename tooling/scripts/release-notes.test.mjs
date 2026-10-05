import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
test('release and non-QA documentation never mention the migration ledger table', () => {
  const docs = join(root, 'docs');
  const files = readdirSync(docs, { recursive: true }).filter(
    (name) => name.endsWith('.md') && !/^qa[\\/]/u.test(name),
  );
  for (const [name, content] of [
    ['CHANGELOG.md', changelog],
    ...files.map((name) => [name, readFileSync(join(docs, name), 'utf8')]),
  ]) {
    assert.doesNotMatch(content, /__drizzle_migrations/u, name);
  }
});
