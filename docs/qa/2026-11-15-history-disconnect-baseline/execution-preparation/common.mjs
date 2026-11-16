// The read-only primitives and artifact inventory originate in the sealed #410 preparation.
// Check both imported files before evaluating either, including artifacts.mjs's transitive import.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const prep = await realpath(fileURLToPath(new URL('.', import.meta.url)));
const sharedRoot = join(dirname(prep), 'runtime-410-build-preparation');
const shared = {
  'runtime-410-build-preparation/common.mjs': '54f0a901a702eb78de69a6f0df7f9293e358689cb9a7af1016f906317da03ae4',
  'runtime-410-build-preparation/artifacts.mjs': '479b4a723e12f7d11da926d99c83ced2ab9e26e5eedffc7dd74000c65a806226',
};
for (const [key, sha] of Object.entries(shared)) {
  const path = join(dirname(prep), key);
  assert.equal(await realpath(path), path);
  assert((await lstat(path)).isFile());
  assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'), sha);
}
const common410 = await import(pathToFileURL(join(sharedRoot, 'common.mjs')).href);
const artifacts410 = await import(pathToFileURL(join(sharedRoot, 'artifacts.mjs')).href);
export const { absolute, batch, profile, buildEnv, digest, git, hash, hashPattern, iso,
  json, ordinaryFile, save, slash, within } = common410;
const commitPattern = /^[a-f0-9]{40}$/u;
const localTools = ['common.mjs', 'build.mjs', 'capture-binding.mjs'];
const gitRepositoryOverrides = /^GIT_(DIR|WORK_TREE|INDEX_FILE|INDEX_VERSION|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|CONFIG_COUNT|CONFIG_PARAMETERS|CONFIG_KEY_\d+|CONFIG_VALUE_\d+)$/iu;

export async function confirmTooling(tooling) {
  assert(tooling && Object.keys(tooling).length === localTools.length + Object.keys(shared).length);
  for (const file of localTools) {
    const key = 'runtime-419-execution-preparation/' + file;
    assert.match(tooling[key] ?? '', hashPattern);
    assert.equal(await hash(await ordinaryFile(join(batch, key), batch)), tooling[key], key);
  }
  for (const [key, sha] of Object.entries(shared)) {
    assert.equal(tooling[key], sha, key);
    assert.equal(await hash(await ordinaryFile(join(batch, key), batch)), sha, key);
  }
}

export async function readAdmission(path, sha) {
  assert.equal(prep, join(batch, 'runtime-419-execution-preparation'));
  assert.deepEqual(process.execArgv, [], 'No Node flags or preloads');
  assert.equal(process.env.NODE_OPTIONS, undefined);
  for (const key of Object.keys(process.env)) {
    assert(!gitRepositoryOverrides.test(key), 'Unexpected Git environment: ' + key);
  }
  assert.match(sha ?? '', hashPattern, 'Exact admission SHA-256 required');
  await ordinaryFile(path, batch);
  assert.equal(await hash(path), sha);
  const input = await json(path);
  assert.equal(input.schema, 'gg419-root-build-admission/v1');
  assert.equal(input.state, 'root-admitted-build');
  assert(['baseline', 'candidate'].includes(input.phase));
  for (const key of ['head', 'tree', 'actualMain', 'actualMainTree', 'merged381', 'merged410'])
    assert.match(input[key] ?? '', commitPattern);
  assert.notEqual(input.merged381, input.merged410);
  for (const key of ['indexSha256', 'nodeSha256']) assert.match(input[key] ?? '', hashPattern);
  await confirmTooling(input.tooling);

  const node = await common410.currentNode();
  assert.equal(node.nodeSha256, input.nodeSha256);
  const checkout = await realpath(absolute(input.checkout));
  assert.equal(checkout, input.checkout);
  const worktrees = await realpath(join(profile, '.codex', 'worktrees'));
  assert.match(relative(worktrees, checkout), /^gg-[^\\/]+[\\/]GraphGoblin$/iu);
  assert((await lstat(dirname(checkout))).isDirectory() && (await lstat(checkout)).isDirectory());
  const directory = absolute(input.buildDirectory);
  assert.equal(dirname(directory), batch);
  assert.match(basename(directory), new RegExp('^runtime-419-build-' + input.phase + '-[a-z0-9-]{3,48}$', 'u'));
  return { input, checkout, directory, node, admissionPath: path, admissionSha256: sha };
}

export async function readIdentity(job) {
  const identity = await common410.readIdentity(job);
  git(job, 'merge-base', '--is-ancestor', job.input.merged381, job.input.merged410);
  git(job, 'merge-base', '--is-ancestor', job.input.merged410, identity.actualMain);
  return identity;
}

export function receiptReference(job) {
  return { ...common410.receiptReference(job), merged381: job.input.merged381,
    merged410: job.input.merged410, tooling: job.input.tooling };
}

export async function collectArtifacts(checkout) {
  const old = await artifacts410.collectArtifacts(checkout);
  const provider = await realpath(join(checkout, 'apps/api/node_modules/fastify-type-provider-zod'));
  assert(within(checkout, provider));
  const manifest = await ordinaryFile(join(provider, 'package.json'), checkout);
  const metadata = await json(manifest);
  assert.equal(metadata.name, 'fastify-type-provider-zod');
  assert.equal(metadata.exports.default.default, './dist/esm/index.js');
  const entry = await ordinaryFile(join(provider, 'dist/esm/index.js'), checkout);
  const additions = ['apps/api/dist/routes/runs.js', 'apps/api/dist/run-history.js',
    'apps/api/dist/plugins/auth.js', 'apps/api/dist/plugins/errors.js', 'apps/api/dist/routes/system.js'];
  for (const [name, key] of [['domain', '.'], ['engine', './testing']]) {
    const owner = 'packages/' + name;
    const pkg = await json(join(checkout, owner, 'package.json'));
    assert.equal(pkg.name, '@graphgoblin/' + name);
    const target = pkg.exports[key].import;
    assert.match(target, /^\.\/dist\/(?:[a-z-]+\/)*index\.js$/u);
    additions.push(owner + '/' + target.slice(2));
  }
  for (const addition of additions) assert(Object.hasOwn(old.outputFiles, addition), 'Missing #419 runtime entry: ' + addition);
  const dependencyFiles = { ...old.dependencyFiles };
  for (const path of [manifest, entry]) dependencyFiles[slash(relative(checkout, path))] = await hash(path);
  const inventory = { outputRoots: old.outputRoots, outputFiles: old.outputFiles,
    runtimeEntries: [...old.runtimeEntries, ...additions], dependencyFiles, workspaceLinks: old.workspaceLinks };
  return { ...inventory, inventorySha256: digest(JSON.stringify(inventory)), counts: old.counts };
}
