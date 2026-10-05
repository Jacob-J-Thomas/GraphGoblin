import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
const unreleased = changelog.split('## Unreleased\n')[1]?.split('\n## ')[0];

test('upgrade guidance links to full backup restoration without migration-ledger SQL', () => {
  assert.ok(unreleased?.includes('docs/guide/06-settings-and-secrets.md#back-up-and-restore'));
  const docs = join(root, 'docs');
  const files = readdirSync(docs, { recursive: true }).filter((name) => name.endsWith('.md'));
  for (const [name, content] of [
    ['CHANGELOG.md', changelog],
    ...files.map((name) => [name, readFileSync(join(docs, name), 'utf8')]),
  ]) {
    assert.doesNotMatch(
      content,
      /\b(?:DELETE\s+FROM|UPDATE|INSERT\s+INTO)\s+__drizzle_migrations\b/iu,
      name,
    );
  }
  const guide = readFileSync(join(docs, 'guide/06-settings-and-secrets.md'), 'utf8');
  assert.match(
    guide,
    /restore the pre-upgrade backup of the entire data directory before running the previous release/u,
  );
  assert.match(guide, /There is no partial rollback/u);
});

test('Unreleased includes the editor and app changes in their user-facing sections', () => {
  assert.ok(unreleased);
  for (const [section, issues] of [
    ['Added', [15, 45]],
    ['Changed', [8, 59]],
    ['Fixed', [53, 55, 56]],
  ]) {
    const body = unreleased.split(`### ${section}\n`)[1]?.split('\n### ')[0];
    assert.ok(body, section);
    for (const issue of issues) assert.ok(body.includes(`(#${issue})`), `${section}: #${issue}`);
    assert.doesNotMatch(body, /\b(?:pull request|pipeline|repository)\b/iu);
  }
});
