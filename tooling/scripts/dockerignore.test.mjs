import { execFileSync } from 'node:child_process';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
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
    'apps/web/dist-goblin/index.html',
    'packages/engine/coverage/index.html',
    'apps/web/test-results/a.png',
    'apps/web/playwright-report/index.html',
    'docs/README.md',
    'pnpm-debug.log',
    'apps/api/graphgoblin.db-journal',
    'packages/infrastructure/graphgoblin.db.backup',
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
    'apps/web/goblin/index.html',
    'apps/web/src/goblin/main.tsx',
    'apps/web/vite.goblin.config.ts',
    'apps/web/src/database-view.tsx',
  ]) {
    assert.equal(isExcluded(rules, path), false, `${path} should be included`);
  }
});

test('the Goblin HTML alias resolves without rewriting absolute container source paths', () => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const dockerfile = readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');
  const buildStage = dockerfile.split(/^FROM .+ AS runtime$/m)[0];
  const workdir = buildStage.match(/^WORKDIR (\S+)$/m)?.[1];
  assert.ok(workdir, 'the build stage needs an absolute working directory');
  assert.equal(posix.isAbsolute(workdir), true);
  assert.match(buildStage, /^COPY apps \.\/apps$/m);

  const entry = 'apps/web/goblin/index.html';
  assert.equal(isExcluded(rules, entry), false);
  const htmlEntry = readFileSync(new URL(`../../${entry}`, import.meta.url), 'utf8').match(
    /<script type="module" src="([^"]+)"/,
  )?.[1];
  assert.ok(htmlEntry, 'the Goblin HTML must declare its module entry');
  const containerEntry = posix.join(workdir, entry);
  const absoluteEntries = [
    containerEntry,
    '/src/apps/web/goblin/index.html',
    '/src/apps/web/src/goblin/main.tsx',
  ];
  // Exercise Vite's actual alias hook: HTML's URL must resolve, while /src on a container
  // filesystem must not be mistaken for that URL and rewritten into a missing path.
  const resolved = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { resolveConfig } from 'vite';
const config = await resolveConfig({ configFile: 'vite.goblin.config.ts', logLevel: 'silent' }, 'build');
const plugin = config.plugins.find((plugin) => plugin.name === 'alias');
const hook = typeof plugin.resolveId === 'function' ? plugin.resolveId : plugin.resolveId.handler;
const resolved = await Promise.all(process.argv.slice(1).map(async (entry) => {
  const resolved = await hook.call({ resolve: async () => null, warn() {} }, entry, undefined, { isEntry: true });
  return resolved?.id ?? entry;
}));
process.stdout.write(JSON.stringify(resolved));`,
      ...absoluteEntries,
      htmlEntry,
    ],
    { cwd: posix.join(root, 'apps/web'), encoding: 'utf8' },
  );
  assert.deepEqual(JSON.parse(resolved), [
    ...absoluteEntries,
    fileURLToPath(new URL('../../apps/web/src/goblin/main.tsx', import.meta.url)),
  ]);
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

test('trailing double-star and escaped punctuation preserve Docker path boundaries', () => {
  const rules = parseDockerignore('assets/**\n!assets/keep.txt\na+b(1).txt');
  assert.equal(isExcluded(rules, 'assets/deep/file.txt'), true);
  assert.equal(isExcluded(rules, 'assets/keep.txt'), false);
  assert.equal(isExcluded(rules, 'a+b(1).txt'), true);
  assert.equal(isExcluded(rules, 'aaab1.txt'), false);
});
