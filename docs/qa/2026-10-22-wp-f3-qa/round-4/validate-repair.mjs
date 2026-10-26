// Verify retained observations without starting an app or rerunning behavior tests.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, writeFile, readdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
const here = fileURLToPath(new URL('./', import.meta.url));
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const json = async (name) =>
  JSON.parse((await readFile(join(here, name), 'utf8')).replace(/^\uFEFF/, ''));
const audit = await json('record-audit-results.json');
assert(audit.rootReportUnchanged && audit.round3ApiJsonUnchanged);
assert.equal(audit.committedRound3Count, 45);
assert.equal(audit.committedLogs.length, 12);
assert(audit.committedLogs.every((p) => p.exists && p.directlyLinked));
assert(audit.everyCommittedFileDirectlyLinked);
assert(
  Object.values(audit.ownMarkdownLinks)
    .flat()
    .every((p) => p.resolves),
);
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const result = await json('api-results.json');
assert.equal(result.head, '9f654e7f7cfe4180dd8d1258174cc4a2d2a30110');
assert.equal(result.results.length, 12);
assert(result.results.every((r) => r.status === 'PASS'));
assert.equal(result.lifecycle.length, 3);
assert(result.lifecycle.every((p) => p.exitObserved && p.confirmedExited));
assert.deepEqual(
  result.lifecycle.slice(0, 2).map((p) => [p.exitCode, p.signalCode]),
  [
    [null, 'SIGTERM'],
    [null, 'SIGTERM'],
  ],
);
assert.deepEqual([result.lifecycle[2].exitCode, result.lifecycle[2].signalCode], [0, null]);
assert.deepEqual(
  result.cleanup.processes,
  result.lifecycle.map(({ forced, ...p }) => p),
);
assert(result.cleanup.processConfirmedExited && result.cleanup.removed);
assert.equal(
  await access(join(tmpdir(), result.cleanup.store)).then(
    () => true,
    () => false,
  ),
  false,
);
const remaining = (await readdir(tmpdir())).filter((n) => n.startsWith('gg-qa-f3-r4-'));
assert.deepEqual(remaining, []);
const changed = git('diff', '--name-only').split('\n').filter(Boolean);
assert(changed.every((p) => p.startsWith('docs/qa/2026-10-22-wp-f3-qa/')));
assert.equal(git('diff', '--cached', '--name-only'), '');
const syntax = [];
for (const name of [
  ...changed.filter((p) => p.endsWith('.mjs')),
  ...(await readdir(here))
    .filter((n) => n.endsWith('.mjs'))
    .map((n) => 'docs/qa/2026-10-22-wp-f3-qa/round-4/' + n),
]) {
  const check = spawnSync(process.execPath, ['--check', join(root, name)], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(check.status, 0, name);
  syntax.push({ file: name, exitCode: check.status });
}
for (const name of changed.filter((p) => p.endsWith('.mjs'))) {
  assert(
    !/removeStore\([^\n]*,\s*true\)/.test(await readFile(join(root, name), 'utf8')),
    'Literal cleanup assertion: ' + name,
  );
}
const privacy = [];
for (const name of await readdir(here)) {
  if (name === 'verification-results.json') continue;
  assert(
    !/[A-Z]:[\\/]+Users[\\/]+[^\\/\s]+/i.test(await readFile(join(here, name), 'utf8')),
    'Local user path: ' + name,
  );
  privacy.push(name);
}
const readme = await readFile(join(here, 'README.md'), 'utf8');
const artifactNames = [...new Set([...(await readdir(here)), 'verification-results.json'])].sort();
assert(
  artifactNames.every((n) => readme.includes(`](${n})`)),
  'Unlinked round-4 artifact',
);
await writeFile(
  join(here, 'cleanup-results.json'),
  JSON.stringify(
    {
      head: result.head,
      store: result.cleanup.store,
      observedProcesses: result.lifecycle,
      cleanup: result.cleanup,
      storeAbsent: true,
      remainingRound4Stores: remaining,
      couldNotRemove: [],
    },
    null,
    2,
  ) + '\n',
);
await writeFile(
  join(here, 'verification-results.json'),
  JSON.stringify(
    {
      head: result.head,
      apiChecks: 12,
      lifecycleMatchesCleanup: true,
      historicalRecord: '../round-3/api-results.json',
      currentResult: 'api-results.json',
      noLiteralCleanupArguments: true,
      allActualMarkdownLinksResolve: true,
      syntax,
      noLocalUserPaths: privacy,
      allRound4ArtifactsLinked: true,
      artifactNames,
      productionDiff: [],
      indexDiff: [],
      changedQaFiles: changed,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  'PASS: 12 API checks; observed exits match cleanup; store absent; syntax, privacy, QA-only diff and retention checked.',
);
