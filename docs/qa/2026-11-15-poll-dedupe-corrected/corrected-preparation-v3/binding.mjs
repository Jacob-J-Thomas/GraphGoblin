// Read-only binding for the independently reviewed, freshly built #361 candidate.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const checkoutPath = 'C:/Users/98jak/.codex/worktrees/gg-20261115-runtime/GraphGoblin';
const baseline = '15ce9a1dd12e87b7f7cb5f853aaecf68d6188afd';
const expectedChangedPaths = [
  'CHANGELOG.md',
  'apps/api/src/ollama-container.test.ts',
  'apps/api/src/preflight-ollama.test.ts',
  'apps/api/src/triggers/poll-dedupe.test.ts',
  'apps/api/src/triggers/poll-items.test.ts',
  'apps/api/src/triggers/poll-items.ts',
  'apps/api/src/triggers/poll.ts',
  'docs/08-triggers-and-integrations.md',
  'docs/decisions/ADR-0079-poll-dedupe-key-identities.md',
  'docs/decisions/README.md',
  'packages/domain/src/poll-items.test.ts',
  'packages/domain/src/poll-items.ts',
];
const expectedRuntimeTrees = ['apps/api/dist', 'packages/adapter-codex/dist', 'packages/adapter-jev/dist',
  'packages/contracts/dist', 'packages/domain/dist', 'packages/engine/dist', 'packages/infrastructure/dist'];
const neededModules = ['apps/api/dist/main.js', 'apps/api/dist/triggers/poll.js',
  'apps/api/dist/triggers/poll-items.js', 'packages/domain/dist/poll-items.js',
  'packages/infrastructure/dist/sqlite/index.js', 'packages/infrastructure/dist/sqlite/admission.js'];
export const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const actualGitId = (input) => typeof input === 'string' && /^[0-9a-f]{40}$/u.test(input);
const hash = (input) => typeof input === 'string' && /^[0-9a-f]{64}$/u.test(input);

async function admittedFile(path,digest) {
  assert(isAbsolute(path) && hash(digest));
  const bytes = await readFile(path);
  assert.equal(sha(bytes),digest,path);
  return bytes;
}

export async function readCandidateBinding(spec) {
  assert.equal(process.version, 'v22.23.4');
  assert.equal(spec.schema, 'graphgoblin-361-corrected-admission/v1');
  assert.equal(spec.baseline, baseline);
  assert(actualGitId(spec.head) && actualGitId(spec.tree) && actualGitId(spec.main));
  assert.notEqual(spec.head, baseline);
  const checkout = await realpath(checkoutPath);
  const gitOptions = {cwd:checkout, env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}, maxBuffer:128 * 1024 * 1024};
  const git = (...args) => execFileSync('git', args, gitOptions).toString('utf8');
  const identity = () => ({head:git('rev-parse','HEAD').trim(), tree:git('rev-parse','HEAD^{tree}').trim(),
    localOriginMain:git('rev-parse','origin/main').trim(),
    status:git('status','--porcelain=v1','--untracked-files=all').trim()});
  const observed = identity();
  assert.deepEqual(observed, {head:spec.head, tree:spec.tree, localOriginMain:spec.main, status:''});
  assert.equal(git('merge-base', baseline, spec.head).trim(), baseline);
  const indexPath = resolve(checkout, git('rev-parse','--git-path','index').trim());
  const indexSha256 = sha(await readFile(indexPath));
  const build = spec.build;
  const receipt = JSON.parse(await admittedFile(build.receiptPath,build.receiptSha256));
  const buildLog = (await admittedFile(build.logPath,build.logSha256)).toString('utf8');
  assert.equal(receipt.node,process.version);
  assert.equal(receipt.exit,0);
  assert.equal(receipt.logSha256,build.logSha256);
  assert.equal(receipt.sourceUnchanged,true);
  assert.deepEqual(receipt.sourceBefore,receipt.sourceAfter);
  assert.equal(receipt.sourceBefore.head,baseline);
  assert.equal(receipt.sourceBefore.tree,git('rev-parse',baseline + '^{tree}').trim());
  assert.deepEqual(receipt.sourceBefore.index,[]);
  assert(Date.parse(receipt.endedUtc) > Date.parse(receipt.startedUtc));
  assert.match(receipt.command,/^pnpm[.]cmd build --filter=@graphgoblin\/api --force/u);
  assert(buildLog.includes(receipt.command));
  assert(buildLog.includes('HEAD ' + baseline));
  assert(buildLog.includes('tree ' + receipt.sourceBefore.tree));
  assert.match(buildLog,/Tasks:\s+7 successful, 7 total/u);
  assert.match(buildLog,/Cached:\s+0 cached, 7 total/u);
  assert.match(buildLog,/^exit=0\s*$/mu);

  const changed = git('diff','--name-only','-z', baseline, spec.head).split('\0').filter(Boolean).sort();
  const builtChanges = receipt.sourceBefore.changed;
  assert.deepEqual(builtChanges.map(({path}) => path).sort(),expectedChangedPaths,
    'Expected the ten #361 paths and two #483 Windows cleanup tests in the final build receipt.');
  assert.deepEqual(changed,expectedChangedPaths,'The frozen candidate must have the exact admitted path set.');
  const entries = git('ls-tree','-r','-z', spec.head).split('\0').filter(Boolean);
  const trackedInputs = entries.map((entry) => {
    const match = /^(\d+) blob ([0-9a-f]{40})\t(.+)$/u.exec(entry);
    assert(match, entry);
    const [, mode, blob, path] = match;
    return { mode, blob, path };
  }).filter(({path}) => !path.startsWith('docs/qa/'));
  await Promise.all(trackedInputs.map(async (file) => {
    const bytes = await readFile(join(checkout,file.path));
    const blob = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
    assert.equal(blob, file.blob, file.path);
    file.sha256 = sha(bytes);
  }));
  const sources = Object.fromEntries(trackedInputs.map(({path,...record}) => [path,record]));
  for (const {path,blob,sha256} of builtChanges) {
    assert.equal(sources[path].blob,blob,path);
    assert.equal(sources[path].sha256,sha256,path);
  }

  const oracle = spec.diagnostics;
  const oracleFields = ['code','reason','message'];
  for (const name of ['item','single']) {
    assert.deepEqual(Object.keys(oracle[name]).sort(), oracleFields.sort());
    for (const key of oracleFields) assert(typeof oracle[name][key] === 'string' && oracle[name][key].length > 0);
  }
  const boundOraclePaths = ['apps/api/src/triggers/poll.ts','apps/api/src/triggers/poll-items.ts',
    'packages/domain/src/poll-items.ts'];
  assert.deepEqual(Object.keys(oracle.sourceSha256).sort(), boundOraclePaths.sort());
  for (const path of boundOraclePaths) assert.equal(sources[path].sha256, oracle.sourceSha256[path]);

  const built = {};
  const trees = {};
  async function collect(dir, files) {
    for (const entry of await readdir(join(checkout, dir), {withFileTypes:true})) {
      const path = dir + '/' + entry.name;
      if (entry.isDirectory()) await collect(path, files);
      else {
        assert(entry.isFile(), path);
        files[path] = sha(await readFile(join(checkout,path)));
      }
    }
  }
  for (const dir of expectedRuntimeTrees) {
    const files = {};
    await collect(dir, files);
    const inventory = Object.keys(files).sort().map((path) => files[path] + ' *' + path).join('\n') + '\n';
    trees[dir] = {files:Object.keys(files).length, sha256:sha(inventory)};
    Object.assign(built, files);
  }
  for (const file of neededModules) assert(built[file], file);
  const selectedOutputs = receipt.selectedOutputs;
  assert.equal(selectedOutputs.length,8);
  assert.equal(new Set(selectedOutputs.map(({path}) => path)).size,8);
  for (const {path,sha256} of selectedOutputs) assert.equal(built[path],sha256,path);
  let freeze = null;
  if (spec.status === 'CORRECTED_NATIVE_ADMITTED') {
    freeze = JSON.parse(await admittedFile(spec.freeze.path,spec.freeze.sha256));
    assert.equal(freeze.schema,'graphgoblin-361-build-source-rebind/v1');
    assert.equal(freeze.head,spec.head);
    assert.equal(freeze.tree,spec.tree);
    assert.equal(freeze.buildReceiptSha256,build.receiptSha256);
    assert.deepEqual(freeze.changed,changed);
    assert.deepEqual(freeze.trees,trees);
    assert.deepEqual(freeze.selectedOutputs,selectedOutputs);
  } else {
    assert.equal(spec.status,'PREPARATION_ONLY');
  }
  const workspaceLinks = {};
  for (const owner of expectedRuntimeTrees.map((dir) => dir.slice(0, -5))) {
    const manifest = JSON.parse(await readFile(join(checkout,owner,'package.json'), 'utf8'));
    for (const name of Object.keys(manifest.dependencies ?? {}).filter((n) => n.startsWith('@graphgoblin/'))) {
      const file = owner + '/node_modules/' + name;
      const resolved = await realpath(join(checkout,file));
      const link = relative(checkout,resolved).replaceAll('\\','/');
      assert.equal(link, 'packages/' + name.split('/')[1], file);
      workspaceLinks[file] = link;
    }
  }
  const libsql = await realpath(join(checkout,'packages/infrastructure/node_modules/@libsql/client'));
  assert(!relative(checkout,libsql).startsWith('..'));
  const libsqlManifest = await readFile(join(libsql,'package.json'));
  assert.deepEqual(identity(), observed);
  assert.equal(sha(await readFile(indexPath)), indexSha256);
  return {schema:'graphgoblin-361-corrected-build-binding/v1', checkout, ...observed, baseline,
    node:process.version, nodePath:process.execPath, build, buildTimeSource:receipt.sourceBefore,
    buildLogCheck:{exit:receipt.exit,command:receipt.command,startedUtc:receipt.startedUtc,endedUtc:receipt.endedUtc,tasks:7,cached:0},
    freeze, diagnostics:oracle, indexSha256, changed, sources, trees, built, selectedOutputs, workspaceLinks, libsql:{ path:relative(checkout,libsql),
      version:JSON.parse(libsqlManifest).version, manifestSha256:sha(libsqlManifest) }};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , input, output] = process.argv;
  const spec = JSON.parse(await readFile(input,'utf8'));
  const binding = await readCandidateBinding(spec);
  await writeFile(output, JSON.stringify(binding,null,2) + '\n', {flag:'wx'});
  process.stdout.write(JSON.stringify({head:binding.head, tree:binding.tree,
    sources:Object.keys(binding.sources).length, outputs:Object.keys(binding.built).length,
    trees:Object.keys(binding.trees).length}) + '\n');
}
