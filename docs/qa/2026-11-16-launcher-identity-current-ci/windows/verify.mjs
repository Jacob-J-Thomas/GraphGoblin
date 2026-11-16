import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { win32 as path } from 'node:path';

const checkout = String.raw`C:\Users\98jak\.codex\worktrees\gg-20261115-runtime\GraphGoblin`;
const head = '6f383da798872aa0e6bd1e0de1fdcd4e702de9ae';
const tree = 'decd1ca26c9bd63d942e939e65e2b2604d7f2652';
const target = '9fa8b2474c7290adb800c5e26be73511095cae25';
const localProduct = 'c75e277695dae260f0e14279cff8705bab84ef4c';
const oldTestHead = '08e60a0ae6d6b7cae853326825365760166f3ad3';
const merge = '5e386d5cc9ed4b022d15ade32d04fcd89c367688';
const runId = 43790735875;
const jobId = 133048320156;
const repo = 'Jacob-J-Thomas/GraphGoblin';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
const api = (file) => read(file);
const run = api('actions-run.json', 'actions/runs/' + runId);
const job = api('windows-job.json', 'actions/jobs/' + jobId);
const commit = api('checkout-merge.json', 'git/commits/' + merge);
const artifacts = api('actions-artifacts.json', 'actions/runs/' + runId + '/artifacts?per_page=100');
assert.deepEqual([run.id, run.head_sha, run.run_number, run.run_attempt], [runId, head, 890, 1]);
assert.deepEqual([job.id, job.run_id, job.name, job.status, job.conclusion],
  [jobId, runId, 'Windows launcher', 'completed', 'success']);
assert.ok(!artifacts.artifacts.some(({name}) => name === 'windows-launcher'));
assert.deepEqual([commit.sha, commit.tree.sha, ...commit.parents.map(({sha}) => sha)], [merge, tree, target, head]);
const jobsConnector = read('windows-terminal-jobs-connector-response.json').structuredContent.jobs;
const windowsConnector = jobsConnector.find(({ id }) => id === jobId);
assert.deepEqual([windowsConnector.status, windowsConnector.conclusion], ['completed', 'success']);
for (const name of ['Build', 'Native Windows launcher acceptance']) {
  const rest = job.steps.find((step) => step.name === name);
  const connector = windowsConnector.steps.find((step) => step.name === name);
  assert.equal(rest.conclusion, 'success');
  assert.equal(connector.conclusion, 'success');
}
const response = read('windows-log-connector-response.json');
assert.equal(response.isError, false);
const source = response.structuredContent.content;
const rootLog = read('../435-hosted-candidate-root-job-log-response.json').structuredContent.content;
const buffer = Buffer.from(source, 'utf8');
assert.deepEqual(buffer, Buffer.from(rootLog, 'utf8'));
assert.deepEqual([...buffer.subarray(0,3)],[239,187,191]);
assert.deepEqual([...buffer.subarray(-2)],[13,10]);
assert.equal(buffer.toString('utf8'), source);

assert.deepEqual(readFileSync('windows-job.decoded.log'), buffer);
const lines = source.split(/\r?\n/);
assert.ok(lines.some((line) => line.includes(merge)));
assert.ok(lines.some((line) => line.includes('HEAD is now at ' + merge.slice(0,8) +
  ' Merge ' + head + ' into ' + target)));
assert.ok(lines.some((line) => line.includes('node: v22.23.4')));
assert.ok(lines.some((line) => line.includes('Tasks:    12 successful, 12 total')));
const artifactWarning = lines.find((line) => line.includes('No files were found with the provided path: .tmp/windows-launcher-*/'));
assert.ok(artifactWarning);

const git = (...args) => execFileSync('git.exe', ['-C', checkout, ...args],
  { env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, windowsHide: true });
assert.equal(git('show','-s','--format=%H %P %T', head).toString().trim(), [head, localProduct, tree].join(' '));
assert.ok(git('diff','--name-only',localProduct,head).toString().trim().split(/\r?\n/)
  .every((name) => /^(docs\/qa\/|docs\/delivery\/)/.test(name)));
const digestPath = (rev, file) => hash(git('cat-file','blob',rev + ':' + file));
const testHash = digestPath(head, 'tooling/scripts/windows-launcher.acceptance.mjs');
assert.equal(testHash, '4cac8f617ebe4d96e8b54c4ba0bfe3c5a4647e284480b97f77fe0e847281c4ee');
assert.equal(testHash, digestPath(oldTestHead, 'tooling/scripts/windows-launcher.acceptance.mjs'));
const sourceHelper = digestPath(head, 'apps/api/src/instance-identity.ts');
assert.equal(sourceHelper, digestPath(localProduct, 'apps/api/src/instance-identity.ts'));
assert.notEqual(sourceHelper, digestPath(oldTestHead, 'apps/api/src/instance-identity.ts'));
assert.ok(sourceHelper.startsWith('3f294'));

assert.equal(process.version, 'v22.23.4');
const reporter = process.binding('natives')['internal/test_runner/reporter/tap'];
const reporterLines = reporter.split('\n');
const escapeIndex = reporterLines.findIndex((line) => line.trim() === 'function tapEscape(input) {');
const escapeSource = reporterLines.slice(escapeIndex, escapeIndex+11).join('\n');
const tapEscape = new Function('StringPrototypeReplaceAll', escapeSource + '\nreturn tapEscape;')(
  (value, input, output) => value.replaceAll(input, output));
const aliases = lines.filter((line) => line.includes('# {"evidence":"windows-launcher-checkout-alias"'))
  .map((line) => {
    const output = line.slice(line.indexOf('# {') + 2);
    const original = output.replace(/\\\\/g, '\\');
    assert.equal(tapEscape(original), output);
    return { utc: line.split(' ', 1)[0], data: JSON.parse(original) };
  });
assert.equal(aliases.length, 2);
assert.deepEqual(aliases.map(({data}) => [data.kind, data.reparse.linkType]),
  [['junction', 'Junction'], ['dir', 'SymbolicLink']]);
const processPairs = new Set();
function quiet(command) {
  assert.deepEqual(command, { code: 0, signal: null, stdout: '', stderr: '' });
}
const stamp = /^[1-9][0-9]{16,18}$/;
const sha = /^[a-f0-9]{64}$/;
const shell = path.join('D:\\a\\GraphGoblin\\GraphGoblin', 'apps/api/dist/main.js');
for (const { data } of aliases) {
  assert.equal(data.requestedLinkType, data.reparse.linkType);
  assert.deepEqual([data.reparse.directory, data.reparse.reparsePoint], [true, true]);
  assert.equal(data.storeEntriesBeforeCold, 0);
  assert.equal(data.aliasUnlinked, true);
  assert.equal(data.failure, undefined);
  const digest = data.commands['direct-identity'];
  assert.equal(digest.code, 0);
  assert.match(digest.stdout, /^[a-f0-9]{64}\n$/);
  assert.equal(digest.stdout.length, 65);
  assert.equal(digest.stderr, '');
  assert.deepEqual(data.commands['alias-identity'], digest);
  assert.deepEqual(data.commands['alias-store-state'], {code:0,signal:null,stdout:'{"state":"free"}\n',stderr:''});
  quiet(data.commands['alias-import']);
  assert.deepEqual(data.cold.map(({spelling})=>spelling),['alias','direct']);
  assert.equal(Object.keys(data.commands).length, 14);
  for (const { spelling, owner, release } of data.cold) {
    assert.equal(release,'drained-pid-listener-leases');
    assert.ok(Number.isSafeInteger(owner.pid) && owner.pid > 0);
    assert.match(owner.birth,stamp);
    processPairs.add(String(owner.pid) + ':' + owner.birth);
    assert.equal(owner.executable, 'C:\\hostedtoolcache\\windows\\node\\22.23.4\\x64\\node.exe');
    const expectedMain=spelling==='alias'
      ? path.join(data.fixture,'checkout alias-α','apps/api/dist/main.js') : shell;
    assert.equal(owner.main, expectedMain);
    assert.deepEqual(Object.keys(owner.leases).sort(), ['graphgoblin.db.graphgoblin.lock','graphgoblin.lock']);
    for (const digest of Object.values(owner.leases)) assert.match(digest,sha);
    quiet(data.commands[spelling + '-cold']);
    for (const via of ['alias','direct']) quiet(data.commands[spelling + '-cold-' + via + '-warm']);
    for (const variant of ['wrong-store-config','wrong-settings-config'])
      assert.deepEqual(data.commands[spelling + '-cold-' + variant],
        {code:1,signal:null,stdout:'',stderr:'unrelated or differently configured service'});
  }
}
assert.equal(processPairs.size,4);
assert.deepEqual(aliases.map(({data}) => data.port), [4844,4845]);
const outcomes = lines.filter((line) => /(?:# (?:tests|pass|fail|cancelled|skipped|duration_ms) \d+|^\S+ ok [1-3] - (?:native Windows launcher|independent API processes)|^\S+     ok [12] - cold and warm native launcher)/.test(line));
assert.ok(outcomes.some((line) => line.includes('ok 1 - native Windows launcher readiness')));
assert.ok(outcomes.some((line) => line.includes('ok 2 - native Windows launcher accepts junction and directory symlink checkout paths')));
assert.ok(outcomes.some((line) => line.includes('ok 3 - independent API processes')));
for (const [key, count] of Object.entries({tests:17,pass:17,fail:0,cancelled:0,skipped:0}))
  assert.ok(outcomes.some((line) => line.endsWith('# '+key+' '+count)));
assert.equal(lines.filter((line) => /^\S+\s+not ok /.test(line)).length,0);
const phases = {
  buildTasks: lines.find((line) => line.includes('Tasks:    12 successful, 12 total')),
  runnerImage: lines.find((line) => line.includes('Image: windows-')),
  node: lines.find((line) => line.includes('node: v22.23.4')),
  nativeDuration: outcomes.find((line) => line.includes('# duration_ms')),
  artifactWarning,
};
writeFileSync('independent-readback.json', JSON.stringify({
 repo, pullRequest:492, runId, jobId, attempt:run.run_attempt, head, tree, target, merge, localProduct,
 testHash, sourceHelper, phases, aliases, outcomes,
 log:{bytes:buffer.length,sha256:hash(buffer),hasOriginalUtf8Bom:true,terminalBytes:[13,10],
  rootIndependentCaptureByteEqual:true},
 tap:{node:process.version,reporterSha256:hash(reporter),reversibleAliasDiagnostics:aliases.length},
 artifact:{present:false, captureIsRunListing:true},
},null,2)+'\n',{flag:'wx'});
process.stdout.write(JSON.stringify({logBytes:buffer.length,logHash:hash(buffer),testHash,sourceHelper,phases})+'\n');
