import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const out = new URL('.', import.meta.url);
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
const head = git('rev-parse', 'HEAD');
assert.equal(head, 'a44744f11d5c37000fe8354754fb3d8a82e3a4fa');
const names = git('diff', '--name-only', '23f809ea..HEAD').split(/\r?\n/);
assert.deepEqual(names, ['apps/api/src/script-restart.test.ts']);
const changed = await fs.readFile(
  new URL('../../../../apps/api/src/script-restart.test.ts', import.meta.url),
  'utf8',
);
const child = await fs.readFile(
  new URL('../../../../apps/api/src/child-creation-restart.test.ts', import.meta.url),
  'utf8',
);
assert.match(changed, /portRange: \[5930, 5939\]/);
assert.match(child, /portRange: \[5910, 5919\]/);
const search = await fs.readFile(new URL('port-search.txt', out), 'utf8');
const hits = search.split(/\r?\n/).filter((line) => /\b593\d\b/.test(line));
assert.equal(hits.length, 1);
assert.match(hits[0], /script-restart\.test\.ts/);
const previousRuntimeChanges = git(
  'diff',
  '--name-only',
  '2c675ce2..HEAD',
  '--',
  'apps',
  'packages',
  'tooling',
).split(/\r?\n/);
const result = {
  head,
  status: 'PASS',
  steps:
    'Diff against 23f809ea; search portRange and literal ports under apps/api; inspect shared allocator.',
  expected: 'Only script restart file changes; 5930–5939 has no other API source declaration.',
  actual: {
    changedFiles: names,
    newRange: [5930, 5939],
    childRange: [5910, 5919],
    defaultRange: [5600, 5699],
    newRangeHits: hits,
    previousRuntimeChanges,
    anchorNote:
      'The two admission files already differ at 23f809ea; they are not changed by this port-fix commit.',
  },
  environment: {
    node: process.version,
    pnpm: '12.8.1',
    availableParallelism: availableParallelism(),
  },
  fixtureNote:
    'freePort closes its probe before the API child binds. The new range separates this pair, but is not a cross-process port reservation.',
};
await fs.writeFile(new URL('static-results.json', out), JSON.stringify(result, null, 2) + '\n');
process.stdout.write('PASS: one-file delta and exclusive new API test range.\n');
