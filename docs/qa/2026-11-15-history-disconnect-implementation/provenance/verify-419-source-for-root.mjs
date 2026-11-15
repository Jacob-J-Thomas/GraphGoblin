import assert from 'node:assert/strict';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
const batch = 'C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch';
const checkout = 'C:/Users/98jak/.codex/worktrees/gg-20261115-runtime/GraphGoblin';
const input = join(batch, 'runtime-419-implementation');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = path => hash(readFileSync(path));
const git = (...args) => execFileSync('git.exe', ['-C', checkout, ...args], { env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
const expected = ['CHANGELOG.md', 'apps/api/src/routes/runs.ts', 'apps/api/src/routes/thread-disconnect.test.ts', 'apps/api/src/run-history.ts', 'docs/07-api-and-streaming.md'].sort();
const candidate = json(join(input, 'candidate-source.json'));
assert.equal(candidate.base, '98692c8a8c7b519e8c83e585e026d595cedc0550');
assert.equal(git('rev-parse', 'HEAD').toString().trim(), candidate.base);
assert.equal(git('diff', '--cached', '--name-only').toString(), '');
assert.deepEqual(candidate.files.map(f => f.path).sort(), expected);
for (const file of candidate.files) {
  for (const path of [join(checkout, file.path), join(input, file.copy)]) {
    assert.equal(statSync(path).size, file.bytes, path);
    assert.equal(digest(path), file.sha256, path);
  }
}
const red = json(join(input, 'focused-red-source.json'));
assert.equal(red.head, candidate.base);
for (const file of red.paths) {
  if (file.path.endsWith('thread-disconnect.test.ts')) {
    assert.equal(digest(join(checkout, file.path)), file.sha256);
    assert.equal(digest(join(input, 'final-test-red.ts.txt')), file.sha256);
  } else {
    assert.equal(hash(git('show', candidate.base + ':' + file.path)), file.sha256, file.path);
  }
}
const receipts = {};
for (const [name, expectedExit] of Object.entries({
  'focused-final-red': 1, 'focused-green': 0, 'candidate-typecheck': 0,
  'candidate-lint': 0, 'candidate-final-format': 0, 'api-coverage': 1,
  'reset-tree-isolated-diagnostic': 0,
})) {
  const path = join(input, name + '.json');
  const value = json(path);
  assert.equal(value.exitCode, expectedExit, name);
  assert.equal(value.node, 'v22.23.4', name);
  receipts[name] = { ...value, sha256: digest(path) };
}
assert.equal(git('diff', candidate.base, '--', 'apps/api/src/reset').toString(), '');
const record = {
  state: 'accepted-source-for-native-candidate-and-ci', at: new Date().toISOString(),
  headBeforeCommit: candidate.base, candidateSourceSha256: digest(join(input, 'candidate-source.json')),
  files: candidate.files, finalTestMatchesLiteralBaselineRed: true, oldProductionGitBlobsMatchRed: true,
  sourceReview: 'Root read complete production diff, test and relevant API/CHANGELOG changes; no source correction identified.',
  receipts,
  coverageDisposition: 'The local full API coverage run remains failed and emitted no totals. Its only failure was EPERM during unchanged reset/tree.test.ts rename setup before product assertions. Isolated unchanged reset suite passed 7/7. Cause is unestablished; no filesystem/source/test/threshold change or full local retry is admitted. Exact-head full CI coverage is still mandatory before formal review and merge.',
  remainingGates: ['independent compiled native candidate QA', 'current-head CI including coverage floors', 'Claude Opus xhigh opposite-family review', 'fresh Astra max exact-head/target audit'],
};
const output = join(batch, 'runtime-419-source-root-acceptance.json');
writeFileSync(output, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(JSON.stringify({ path: output, sha256: digest(output), candidateSourceSha256: record.candidateSourceSha256, files: candidate.files.length }) + '\n');
