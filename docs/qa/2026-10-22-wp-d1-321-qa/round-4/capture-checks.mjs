import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const out = new URL('.', import.meta.url);
const repo = fileURLToPath(new URL('../../../../', out));
const target = 'docs\\qa\\2026-10-22-wp-d1-321-qa';
const treeTarget = target.replaceAll('\\', '/');
assert(process.env.QA_REF_CHECKER, 'Pass the supplied external checker path in QA_REF_CHECKER.');
const source = await fs.readFile(process.env.QA_REF_CHECKER, 'utf8');
await fs.writeFile(new URL('orchestrator-checker.mjs.txt', out), source);
const checker = spawnSync(process.execPath, [process.env.QA_REF_CHECKER, target], {
  cwd: repo,
  encoding: 'utf8',
});
if (checker.error) throw checker.error;
const tree = spawnSync('git', ['ls-tree', '-r', '--name-only', 'HEAD', treeTarget], {
  cwd: repo,
  encoding: 'utf8',
});
if (tree.error) throw tree.error;
assert.equal(tree.status, 0);
await fs.writeFile(new URL('orchestrator-check.log.txt', out), checker.stdout + checker.stderr);
await fs.writeFile(new URL('committed-tree.log.txt', out), tree.stdout + tree.stderr);
const results = {
  node: process.version,
  orchestratorChecker: {
    command: 'node <supplied-orchestrator-checker> ' + target,
    exitCode: checker.status,
    sha256: createHash('sha256').update(source).digest('hex'),
    output: 'orchestrator-check.log.txt',
    limitation:
      'Filesystem/basename Markdown checker; does not interpret explicit original-not-kept dispositions, inspect JSON, or establish HEAD membership.',
  },
  committedTree: {
    command: 'git ls-tree -r --name-only HEAD ' + treeTarget,
    exitCode: tree.status,
    paths: tree.stdout.trim().split(/\r?\n/).filter(Boolean).length,
    output: 'committed-tree.log.txt',
    limitation:
      'Immutable supplied HEAD before orchestrator commit; repaired records and round-4 files are uncommitted.',
  },
};
await fs.writeFile(new URL('check-results.json', out), JSON.stringify(results, null, 2) + '\n');
console.log(checker.stdout.trim());
console.log(JSON.stringify(results));
