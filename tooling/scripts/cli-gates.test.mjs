import { test } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVitestConfig } from '../vitest.shared.mjs';

const run = (file, args = []) =>
  spawnSync(process.execPath, [fileURLToPath(new URL(file, import.meta.url)), ...args], {
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  });
// Preserve disposable fixture directories for inspection; no repository files are changed.
const temporary = () => mkdtempSync(join(tmpdir(), 'gg-wp-a5b-gate-cli-'));
const json = (path, value) => writeFileSync(path, JSON.stringify(value));

test('layer CLI loads package manifests, accepts allowed imports and rejects a forbidden import', () => {
  const root = temporary();
  for (const directory of ['tooling', 'packages/contracts', 'apps/api', 'apps/no-manifest'])
    mkdirSync(join(root, directory), { recursive: true });
  writeFileSync(join(root, 'apps/ignored-file'), 'ignored');
  json(join(root, 'tooling/layers.json'), {
    scope: '@graphgoblin/',
    ignore: [],
    layers: [
      { name: 'contracts', match: '^@graphgoblin/contracts$', allow: [] },
      { name: 'api', match: '^@graphgoblin/api$', allow: '*' },
    ],
  });
  json(join(root, 'packages/contracts/package.json'), { name: '@graphgoblin/contracts' });
  json(join(root, 'apps/api/package.json'), {
    name: '@graphgoblin/api',
    dependencies: { '@graphgoblin/contracts': 'workspace:*' },
  });
  let result = run('./check-layers.mjs', ['--root', root]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /Layer rules: OK/);
  json(join(root, 'packages/contracts/package.json'), {
    name: '@graphgoblin/contracts',
    dependencies: { '@graphgoblin/api': 'workspace:*' },
  });
  result = run('./check-layers.mjs', ['--root', root]);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /contracts.*api/s);
  assert.equal(run('./check-layers.mjs', ['--bad']).status, 1);
});

test('licence CLI checks supplied pnpm metadata, rejects forbidden and empty trees, and reports collection failure', () => {
  const root = temporary();
  const policy = join(root, 'policy.json'),
    licenses = join(root, 'licenses.json');
  json(policy, { allowed: ['MIT'], exceptions: {} });
  json(licenses, { MIT: [{ name: 'allowed', versions: ['1.2.3'] }] });
  const args = ['--policy', policy, '--licenses', licenses];
  let result = run('./check-licenses.mjs', args);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /1 packages checked/);
  json(licenses, { 'GPL-3.0-only': [{ name: 'forbidden' }] });
  result = run('./check-licenses.mjs', args);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /forbidden@unknown version.*GPL-3.0-only/);
  json(licenses, {});
  assert.equal(run('./check-licenses.mjs', args).status, 2);
  result = run('./check-licenses.mjs', ['--policy', policy, '--licenses', join(root, 'absent')]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Failed to run/);
  assert.equal(run('./check-licenses.mjs', ['--bad']).status, 1);
});

test('shared config preserves numerical policy, source fixtures and generated exclusions when extending includes', () => {
  const config = createVitestConfig({
    test: { include: ['scripts/**/*.test.mjs'], coverage: { include: ['scripts/**/*.mjs'] } },
  });
  assert.equal(createVitestConfig().test.coverage.thresholds.branches, 90);
  assert.deepEqual(config.test.coverage.thresholds, {
    lines: 90,
    branches: 90,
    functions: 90,
    statements: 90,
  });
  assert.equal(config.test.coverage.provider, 'v8');
  assert.ok(config.test.coverage.include.includes('src/**/*.ts'));
  assert.ok(config.test.coverage.include.includes('scripts/**/*.mjs'));
  assert.ok(config.test.coverage.exclude.includes('src/**/__fixtures__/**'));
  assert.ok(config.test.coverage.exclude.includes('src/**/generated/**'));
  assert.ok(!config.test.coverage.exclude.includes('src/testing/**'));
});

test('reference generator writes formatted outputs, detects stale output and refuses a missing destination', () => {
  const root = temporary();
  const output = join(root, 'reference');
  let result = run('./gen-docs.mjs', ['--output', output]);
  assert.equal(result.status, 0, result.stderr);
  result = run('./gen-docs.mjs', ['--output', output, '--check']);
  assert.equal(result.status, 0, result.stderr);
  writeFileSync(join(output, 'api.md'), '# stale reference');
  result = run('./gen-docs.mjs', ['--output', output, '--check']);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /out of date/);
  assert.equal(run('./gen-docs.mjs', ['--output']).status, 2);
}, 180_000);

test('licence CLI collects the installed production dependency tree through pnpm', () => {
  const result = run('./check-licenses.mjs');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /Licence allowlist: OK \(\d+ packages checked\)/);
});

test('migration CLI confirms the installed schema without mutating the shipped ledger', () => {
  const result = run('./check-migrations.mjs');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Drizzle generation is a no-op/);
});

test('layer CLI tolerates absent workspace folders and reports an unnamed manifest', () => {
  const root = temporary();
  mkdirSync(join(root, 'tooling'));
  json(join(root, 'tooling/layers.json'), { scope: '@graphgoblin/', ignore: [], layers: [] });
  assert.equal(run('./check-layers.mjs', ['--root', root]).status, 0);
  mkdirSync(join(root, 'packages/unnamed'), { recursive: true });
  json(join(root, 'packages/unnamed/package.json'), {});
  const result = run('./check-layers.mjs', ['--root', root]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unnamed/);
});
