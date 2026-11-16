import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packet = await realpath(dirname(fileURLToPath(import.meta.url)));
const [admissionPath, admissionSha256, output, ...extra] = process.argv.slice(2);
const hashPattern = /^[a-f0-9]{64}$/u;
const commitPattern = /^[a-f0-9]{40}$/u;
const driverSeal = '6b4be7674b608a8583415dd75e642d483249d789eca678e14b641af958918926';
const driverMembers = ['README.md', 'invoke.ps1', 'run.ps1', 'syntax-readback.json', 'version-fixture.cs', 'windows.cs'];
const packetMembers = ['ProcessTrace.cs', 'README.md', 'admission.example.json', 'bind.mjs',
  'carrier-steps.example.yml', 'inventory/artifacts.mjs', 'inventory/common.mjs', 'observe.ps1', 'supervise.ps1', 'syntax-readback.json'];
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = async (file) => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/u, ''));

function inside(root, file) {
  const path = relative(root, file);
  return path !== '' && path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path);
}

async function file(fileName, expected) {
  const path = await realpath(fileName);
  assert.equal(path, resolve(fileName), 'Expected canonical file: ' + fileName);
  assert((await lstat(path)).isFile());
  const sha256 = digest(await readFile(path));
  if (expected !== undefined) assert.equal(sha256, expected, path);
  return { path, sha256 };
}

async function seal(directory, expected, members) {
  assert.match(expected, hashPattern);
  assert.equal(await realpath(directory), directory);
  const manifest = await file(join(directory, 'SHA256SUMS.txt'), expected);
  const files = {};
  for (const row of (await readFile(manifest.path, 'utf8')).trimEnd().split(/\r?\n/u)) {
    const match = /^([a-f0-9]{64})  ([a-zA-Z0-9_.\/-]+)$/u.exec(row);
    assert(match, 'Invalid manifest row');
    const [, sha256, name] = match;
    assert(members.includes(name) && !Object.hasOwn(files, name), name);
    files[name] = await file(join(directory, name), sha256);
  }
  assert.deepEqual(Object.keys(files).sort(), [...members].sort());
  return { manifest, files };
}

assert.deepEqual(extra, []);
assert.deepEqual(process.execArgv, []);
assert.equal(process.platform, 'win32');
assert.equal(process.arch, 'x64');
assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
assert.equal(process.env.RUNNER_OS, 'Windows');
assert(!Object.keys(process.env).some((key) =>
  /^(NODE_OPTIONS|NODE_PATH|GIT_DIR|GIT_WORK_TREE|GIT_INDEX_FILE|GIT_COMMON_DIR|GIT_CONFIG_COUNT|GIT_CONFIG_PARAMETERS|GIT_CONFIG_KEY_\d+|GIT_CONFIG_VALUE_\d+|GIT_OBJECT_DIRECTORY|GIT_ALTERNATE_OBJECT_DIRECTORIES|GIT_NAMESPACE)$/iu.test(key)));
assert.match(admissionSha256 ?? '', hashPattern);
const admission = await file(admissionPath, admissionSha256);
const input = await json(admission.path);
assert.equal(input.schema, 'gg436-hosted-admission/v1');
assert.equal(input.state, 'root-admitted');
assert.equal(input.githubRunId, process.env.GITHUB_RUN_ID);
assert.equal(input.githubRunAttempt, process.env.GITHUB_RUN_ATTEMPT);
assert(['baseline', 'candidate'].includes(input.phase));
assert.match(input.evidenceName, /^qa436-[a-z0-9-]{3,38}$/u);
assert.equal(input.driverManifestSha256, driverSeal);
const packetProof = await seal(packet, input.packetManifestSha256, packetMembers);
const driverProof = await seal(input.driverDirectory, driverSeal, driverMembers);
const checkedInventory = {
  'inventory/common.mjs': '54f0a901a702eb78de69a6f0df7f9293e358689cb9a7af1016f906317da03ae4',
  'inventory/artifacts.mjs': '479b4a723e12f7d11da926d99c83ced2ab9e26e5eedffc7dd74000c65a806226',
};
for (const [name, sha256] of Object.entries(checkedInventory))
  assert.equal(packetProof.files[name].sha256, sha256, name);
const { collectArtifacts } = await import(pathToFileURL(packetProof.files['inventory/artifacts.mjs'].path).href);
const ws = await realpath(process.env.GITHUB_WORKSPACE);
const checkout = await realpath(input.checkout);
assert.equal(checkout, input.checkout);
assert(checkout === ws || inside(ws, checkout));
assert.equal(process.env.GITHUB_SHA, input.expectedCommit);
assert.equal(process.env.GITHUB_EVENT_NAME, 'pull_request');
const event = await json(process.env.GITHUB_EVENT_PATH);
assert.equal(event.pull_request.base.sha, input.baseCommit);
assert.match(event.pull_request.head.sha, commitPattern);
const git = (...args) => execFileSync('git.exe', ['-C', checkout, ...args], {
  env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true,
});
for (const [field, tree] of [['baseCommit','baseTree'], ['productCommit','productTree'], ['expectedCommit','expectedTree']]) {
  assert.match(input[field], commitPattern);
  assert.match(input[tree], commitPattern);
  assert.equal(git('rev-parse', input[field] + '^{tree}').trim(), input[tree], field);
}
assert.equal(git('rev-parse', 'HEAD').trim(), input.expectedCommit);
const parents = git('show','-s','--format=%P','HEAD').trim().split(' ').filter(Boolean);
assert.deepEqual(parents, [input.baseCommit, event.pull_request.head.sha],
  'The hosted synthetic checkout must have the exact admitted base and carrier parents');
assert.equal(git('status', '--porcelain=v1', '--untracked-files=all').trim(), '');
git('merge-base','--is-ancestor', input.baseCommit, input.productCommit);
git('merge-base','--is-ancestor', input.productCommit, input.expectedCommit);
if (input.phase === 'baseline') {
  assert.equal(input.baseCommit, input.productCommit);
  assert.equal(input.baseTree, input.productTree);
} else {
  assert.notEqual(input.baseCommit, input.productCommit);
}
assert(Array.isArray(input.carrierOnlyPaths) && input.carrierOnlyPaths.length > 0);
const permitted = new Set(input.carrierOnlyPaths);
assert.equal(permitted.size, input.carrierOnlyPaths.length);
for (const path of permitted) {
  assert(/^[a-zA-Z0-9_.\/-]+$/.test(path) && !path.includes('..') && !path.startsWith('/'), path);
  assert(!/^(apps|packages|scripts|tooling)\//u.test(path), 'Carrier cannot change product/build paths');
  assert(!['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','.nvmrc'].includes(path));
}
const carrierDiff = git('diff','--no-renames','--name-only','-z',input.productCommit,input.expectedCommit)
  .split('\0').filter(Boolean);
assert(carrierDiff.every((path) => permitted.has(path)), 'A product-to-checkout diff path escaped the carrier allowlist');
const tracked = git('ls-files','-z').split('\0').filter(Boolean).sort();
const treePaths = git('ls-tree','-r','--name-only','-z','HEAD').split('\0').filter(Boolean).sort();
assert.deepEqual(tracked, treePaths);
const source = [];
for (const name of tracked) {
  const path = join(checkout,name);
  assert(inside(checkout, path) && (await lstat(path)).isFile(), name);
  source.push([name,digest(await readFile(path))]);
}
const index = await file(resolve(git('rev-parse','--path-format=absolute','--git-path','index').trim()));
const tools = {};
for (const [name, toolPath] of Object.entries(input.tools)) tools[name] = await file(toolPath);
assert.deepEqual(Object.keys(tools).sort(), ['chrome','chromeProxy','compiler','node','powershell','tracerpt']);
assert.equal(await realpath(process.execPath), tools.node.path);
assert.match(process.version,/^v22\.\d+\.\d+$/u);
const [minor, patch] = process.version.slice(4).split('.').map(Number);
assert(minor > 22 || (minor === 22 && patch >= 2), 'Use Node 22.22.2 or later within major 22');
assert.equal(basename(tools.chromeProxy.path).toLowerCase(), 'chrome_proxy.exe');
assert.equal(basename(tools.chrome.path).toLowerCase(), 'chrome.exe');
assert.equal(dirname(tools.chrome.path), dirname(tools.chromeProxy.path));
const buildReceipt = await file(input.buildReceipt.path, input.buildReceipt.sha256);
const build = await json(buildReceipt.path);
assert.equal(build.schema, 'gg436-hosted-build-exit/v1');
assert.equal(build.checkout, checkout);
assert.equal(build.head, input.expectedCommit);
assert.equal(build.tree, input.expectedTree);
assert.equal(build.command, 'pnpm.cmd build');
assert.equal(build.exitCode, 0);
assert.equal(build.beforeIndexSha256, index.sha256);
assert.equal(build.afterIndexSha256, index.sha256);
assert.equal(build.nodeSha256, tools.node.sha256);
assert.equal(build.nodeVersion, process.version);
assert.equal(build.githubRunId, input.githubRunId);
assert.equal(build.githubRunAttempt, input.githubRunAttempt);
const artifacts = await collectArtifacts(checkout);
for (const path of ['apps/api/dist/instance-identity.js','apps/web/dist/index.html','apps/web/dist-goblin/index.html'])
  assert(Object.hasOwn(artifacts.outputFiles,path), path);
assert.equal(git('status', '--porcelain=v1', '--untracked-files=all').trim(), '');
assert.equal((await file(index.path)).sha256,index.sha256);
assert.equal((await file(admission.path)).sha256,admissionSha256);
const destination = resolve(output);
const temp = await realpath(process.env.RUNNER_TEMP);
assert(inside(temp, destination));
assert.equal(await realpath(dirname(destination)),dirname(destination));
await writeFile(destination, JSON.stringify({
  schema:'gg436-hosted-identity/v1', admission, checkout,
  head:input.expectedCommit, tree:input.expectedTree, base:input.baseCommit, product:input.productCommit,
  carrierDiff, parents,
  index, sourceCount:tracked.length, sourceInventorySha256:digest(JSON.stringify(source)),
  nodeVersion:process.version, tools, driver:driverProof, packet:packetProof, buildReceipt, artifacts,
},null,2) + '\n', {flag:'wx'});
