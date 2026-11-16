import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const root = String.raw`C:\Users\98jak\.codex\worktrees\gg-20261115-runtime\GraphGoblin`;
function read(file) { return JSON.parse(readFileSync(file, 'utf8')); }
const errors = {};
const source = read('windows-log-connector-response.json').structuredContent.content;
const buffer = Buffer.from(source, 'utf8');
assert.equal(buffer.toString('utf8'), source);
assert.ok(source.endsWith('\r\n'));
assert.notEqual(source.slice(-3), '\n\r\n');
assert.notEqual(source.slice(-3), '\r\n\n');

assert.deepEqual(readFileSync('windows-job.decoded.log'), buffer);
const jobs = read('windows-terminal-jobs-connector-response.json').structuredContent.jobs;
const job = jobs.find(({ id }) => id === 133039259616);
assert.equal(job.status, 'completed');
assert.equal(job.conclusion, 'failure');
assert.equal(job.steps.find(({ name }) => name === 'Build').conclusion, 'success');
assert.equal(job.steps.find(({ name }) => name === 'Native Windows launcher acceptance').conclusion, 'failure');
const lines = source.split(/\r?\n/);
assert.ok(lines.some((line) => line.includes('07738c4dfe978d19669e4505e8fed5ae440825ea')));
assert.ok(lines.some((line) => line.includes('HEAD is now at 07738c4d Merge 08e60a0ae6d6b7cae853326825365760166f3ad3 into 9fa8b2474c7290adb800c5e26be73511095cae25')));
const aliases = lines.filter((line) => line.includes('# {"evidence":"windows-launcher-checkout-alias"')).map((line) => {
  const i = line.indexOf('# {');
  return { utc: line.slice(0, line.indexOf(' ')), data: JSON.parse(line.slice(i + 2).replace(/\\\\/g, '\\')) };
});
assert.equal(aliases.length, 2);
assert.deepEqual(aliases.map(({data}) => [data.kind, data.reparse.linkType]), [['junction', 'Junction'], ['dir', 'SymbolicLink']]);
for (const { data } of aliases) {
  assert.deepEqual([data.reparse.directory, data.reparse.reparsePoint], [true,true]);
  assert.deepEqual(data.commands['direct-identity'].code, 0);
  assert.match(data.commands['direct-identity'].stdout, /^[0-9a-f]{64}\n$/);
  assert.equal(data.commands['direct-identity'].stderr, '');
  for (const label of ['alias-identity', 'alias-store-state', 'alias-import']) {
    assert.deepEqual(data.commands[label], { code: 0, signal: null, stdout: '', stderr: '' });
  }
  const cold = data.commands['alias-cold'];
  assert.deepEqual([cold.code, cold.signal, cold.stdout], [1,null,'']);
  assert.match(cold.stderr, /runtime, launcher configuration or store ownership could not be checked/);
  assert.deepEqual(data.cold, [{ spelling: 'alias', release: 'no-gateway-spawned' }]);
  assert.equal(data.storeEntriesBeforeCold, 0);
  assert.equal(data.aliasUnlinked, true);
  assert.deepEqual(data.failure, { stage: 'assert-cli', code: 'ERR_ASSERTION' });
}
const outcomes = lines.filter((line) =>
  /(?:# (?:tests|pass|fail|skipped) \d+|(?:not )?ok [1-3] - (?:native Windows launcher |independent API processes)|^.*    not ok [12] - cold and warm native launcher|\#\#\[error\]Process completed with exit code 1)/.test(line));
assert.equal(outcomes.filter((line) => line.includes('not ok')).length, 3);
assert.ok(outcomes.some((line) => line.includes('ok 1 - native Windows launcher readiness')));
assert.ok(outcomes.some((line) => line.includes('ok 3 - independent API processes')));
assert.ok(outcomes.some((line) => line.endsWith('# pass 14')));
assert.ok(outcomes.some((line) => line.endsWith('# fail 3')));
assert.ok(outcomes.some((line) => line.endsWith('# skipped 0')));
const git = (...args) => execFileSync('git.exe', ['-C',root,...args], { env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, windowsHide:true });
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const head = '08e60a0ae6d6b7cae853326825365760166f3ad3';
const target = '9fa8b2474c7290adb800c5e26be73511095cae25';
const tree = '1796a01ad3b9abe39e4e9775cc6ae339897e6b37';
const merge = '07738c4dfe978d19669e4505e8fed5ae440825ea';
assert.equal(git('show','-s','--format=%H %P %T',head).toString().trim(), [head,target,tree].join(' '));
assert.equal(git('diff','--name-only',target,head).toString().trim(),'tooling/scripts/windows-launcher.acceptance.mjs');
const contentHash = (rev, path) => hash(git('cat-file','blob',rev+':'+path));
const regressionHash = contentHash(head,'tooling/scripts/windows-launcher.acceptance.mjs');
assert.equal(regressionHash,'4cac8f617ebe4d96e8b54c4ba0bfe3c5a4647e284480b97f77fe0e847281c4ee');
const helperSourceHash = contentHash(head,'apps/api/src/instance-identity.ts');
assert.equal(helperSourceHash,contentHash(target,'apps/api/src/instance-identity.ts'));
if (!errors['checkout-merge.json']) {
  const checked = read('checkout-merge.json');
  assert.equal(checked.sha, merge);
  assert.equal(checked.tree.sha,tree);
  assert.deepEqual(checked.parents.map(({sha})=>sha),[target,head]);
}
if (!errors['windows-job.json']) {
  const checked = read('windows-job.json');
  assert.deepEqual([checked.id,checked.run_id,checked.name,checked.status,checked.conclusion],
    [133039259616,43787801176,'Windows launcher','completed','failure']);
}
if (!errors['actions-run.json']) {
  const checked = read('actions-run.json');
  assert.deepEqual([checked.id,checked.run_number,checked.run_attempt,checked.head_sha],[43787801176,889,1,head]);
}
const phases = {
  buildTasks: lines.find((line) => line.includes('Tasks:    12 successful, 12 total')),
  runnerImage: lines.find((line) => line.includes('Image: windows-')),
  node: lines.find((line) => line.includes('node: v22.23.4')),
  artifactWarning: lines.find((line) => line.includes('No files were found with the provided path')),
};
assert.ok(phases.buildTasks);
assert.ok(phases.node);
writeFileSync('independent-readback.json', JSON.stringify({
  repo: 'Jacob-J-Thomas/GraphGoblin', pullRequest: 492,
  run:43787801176, runNumber:889, attempt:1, windowsJob:job, head, tree, target, merge,
  regressionHash, helperSourceHash, logfile:{bytes:buffer.length,sha256:hash(buffer),terminalBytes: [...buffer.subarray(-2)]},
  phases, aliases, outcomes, metadataReadErrors: errors,
}, null, 2) + '\n', { flag:'wx' });
process.stdout.write(JSON.stringify({bytes:buffer.length,sha:hash(buffer),errors,helperSourceHash}) + '\n');
