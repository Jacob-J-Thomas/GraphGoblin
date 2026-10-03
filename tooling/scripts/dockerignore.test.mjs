import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isExcluded, parseDockerignore } from './dockerignore.mjs';

const rules = parseDockerignore(
  readFileSync(fileURLToPath(new URL('../../.dockerignore', import.meta.url)), 'utf8'),
);

test('the build context leaves out local data, keys, scratch files, and secrets', () => {
  for (const path of [
    '.tmp/master.key',
    '.tmp/probe/graphgoblin.db',
    'apps/api/.tmp/scratch.txt',
    'master.key',
    'apps/api/data/master.key',
    'apps/api/data/graphgoblin.db',
    'data/graphgoblin.db',
    'packages/infrastructure/test.db',
    'packages/infrastructure/test.db-wal',
    'apps/api/local.sqlite',
    'apps/api/local.sqlite3',
    'apps/api/local.sqlite-journal',
    'some/dir/master.key',
    '.env',
    '.env.local',
    'apps/api/.env.production',
    '.claude/settings.local.json',
    '.claude/worktrees/x/package.json',
    '.git/HEAD',
    'node_modules/zod/package.json',
    'apps/web/node_modules/react/index.js',
    'apps/web/dist/index.html',
    'packages/engine/coverage/index.html',
    'apps/web/test-results/a.png',
    'apps/web/playwright-report/index.html',
    'docs/README.md',
    'pnpm-debug.log',
  ]) {
    assert.equal(isExcluded(rules, path), true, `${path} should be excluded`);
  }
});

test('the build context keeps the sources and manifests the image needs', () => {
  for (const path of [
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    '.npmrc',
    'turbo.json',
    'tsconfig.base.json',
    'tooling/package.json',
    'tooling/scripts/dockerignore.mjs',
    'packages/infrastructure/drizzle/0000_init.sql',
    'packages/infrastructure/src/sqlite/db.ts',
    'packages/contracts/src/run.ts',
    'apps/api/src/main.ts',
    'apps/web/src/main.tsx',
    'apps/web/index.html',
    'apps/web/src/database-view.tsx',
  ]) {
    assert.equal(isExcluded(rules, path), false, `${path} should be included`);
  }
});

test('every tracked source file the image builds from stays in the context', () => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const tracked = execFileSync('git', ['ls-files', 'apps', 'packages', 'tooling'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\n')
    .filter((path) => path !== '');
  assert.ok(tracked.length > 100);
  assert.deepEqual(
    tracked.filter((path) => isExcluded(rules, path)),
    [],
  );
});

test('the evaluator follows Docker semantics for the forms it supports', () => {
  const custom = parseDockerignore(
    ['# comment', '', '/build/', '*.md', '!README.md', 'a?c', 'x/**/y'].join('\n'),
  );
  assert.equal(isExcluded(custom, 'build/out.js'), true);
  assert.equal(isExcluded(custom, 'src/build/out.js'), false);
  assert.equal(isExcluded(custom, 'notes.md'), true);
  assert.equal(isExcluded(custom, 'docs/notes.md'), false);
  assert.equal(isExcluded(custom, 'README.md'), false);
  assert.equal(isExcluded(custom, 'abc'), true);
  assert.equal(isExcluded(custom, 'abbc'), false);
  assert.equal(isExcluded(custom, 'x/y'), true);
  assert.equal(isExcluded(custom, 'x/1/2/y/z'), true);
  assert.equal(isExcluded(custom, './build/a'), true);
});
