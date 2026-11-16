// Read-only complete source and artifact binding for the reviewed PowerShell launcher.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { absolute, batch, collectArtifacts, confirmTooling, digest, git, hash, hashPattern, iso,
  json, ordinaryFile, readAdmission, readIdentity, receiptReference, save } from './common.mjs';

const [receiptPath, receiptSha256, outputPath, ...extra] = process.argv.slice(2);
assert.equal(extra.length, 0, 'Usage: capture-binding.mjs <build receipt> <lowercase SHA-256> <new binding>');
assert.match(receiptSha256 ?? '', hashPattern);
await ordinaryFile(receiptPath, batch);
assert.equal(await hash(receiptPath), receiptSha256);
const receipt = await json(receiptPath);
assert.equal(receipt.schema, 'gg419-build-receipt/v1');
assert.equal(receipt.cleanAfter, true);
assert.equal(receipt.command, 'pnpm.cmd build --force');

const job = await readAdmission(receipt.admissionPath, receipt.admissionSha256);
assert.equal(receiptPath, join(job.directory, 'build-receipt.json'));
assert.equal(await realpath(job.directory), job.directory);
assert((await lstat(job.directory)).isDirectory());
for (const [name, expected] of Object.entries(receiptReference(job))) assert.deepEqual(receipt[name], expected, name);
const bindingPath = absolute(outputPath);
assert.equal(dirname(bindingPath), job.directory, 'Write the binding beside the exact build receipt');
assert.notEqual(bindingPath, receiptPath);
assert.match(basename(bindingPath), /^[a-z][a-z0-9-]{2,65}\.json$/u);

const before = await readIdentity(job);
assert.deepEqual(before, receipt.before);
assert.deepEqual(before, receipt.after);
for (const [reference, filename] of [[receipt.launch, 'build-launch.json'],
  [receipt.exit, 'build-exit.json'], [receipt.log, 'build.log']]) {
  assert.equal(reference.path, join(job.directory, filename));
  await ordinaryFile(reference.path, job.directory);
  assert.match(reference.sha256, hashPattern);
  assert.equal(await hash(reference.path), reference.sha256);
}
const rawExit = await json(receipt.exit.path);
assert.equal(rawExit.schema, 'gg419-build-child-exit/v1');
assert.equal(rawExit.exitCode, 0);
assert.equal(rawExit.signal, null);
assert.equal(Object.hasOwn(rawExit, 'spawnError'), false);
assert.deepEqual(rawExit, receipt.rawExit);
const launch = await json(receipt.launch.path);
assert.equal(launch.schema, 'gg419-build-launch/v1');
assert.equal(launch.pid, rawExit.pid);
assert.equal(launch.logPath, receipt.log.path);
assert.equal(launch.command, receipt.command);
assert.deepEqual(launch.before, before);
for (const [name, expected] of Object.entries(receiptReference(job))) assert.deepEqual(launch[name], expected, name);

const sourceFiles = Object.create(null);
for (const row of git(job, 'ls-tree', '-r', '-z', 'HEAD').split('\0').filter(Boolean)) {
  const item = /^(\d+) blob ([a-f0-9]{40})\t([\s\S]+)$/u.exec(row);
  assert(item, 'Unexpected source entry: ' + row);
  const [, mode, expectedBlob, relative] = item;
  assert(['100644', '100755'].includes(mode), 'Unexpected source link: ' + relative);
  const path = join(job.checkout, relative);
  assert((await lstat(path)).isFile(), 'Missing bound source input ' + relative);
  const bytes = await readFile(path);
  const actualBlob = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
  assert.equal(actualBlob, expectedBlob, 'Checked-out bytes differ from Git object: ' + relative);
  assert.equal(Object.hasOwn(sourceFiles, relative), false, 'Duplicate source path: ' + relative);
  sourceFiles[relative] = digest(bytes);
}
const tracked = git(job, 'ls-files', '-z').split('\0').filter(Boolean);
assert.equal(tracked.length, Object.keys(sourceFiles).length, 'Tracked source map is incomplete');
for (const path of tracked) assert(Object.hasOwn(sourceFiles, path), 'Missing tracked entry: ' + path);

const artifacts = await collectArtifacts(job.checkout);
assert.equal(artifacts.inventorySha256, receipt.artifacts.inventorySha256, 'Completed-build artifact inventory drift');
assert.equal(artifacts.counts.outputRoots, receipt.artifacts.outputRoots);
assert.equal(artifacts.counts.outputFiles, receipt.artifacts.outputFiles);
assert.equal(Object.keys(artifacts.dependencyFiles).length, receipt.artifacts.dependencyFiles);
assert.equal(Object.keys(artifacts.workspaceLinks).length, receipt.artifacts.workspaceLinks);
const after = await readIdentity(job);
assert.deepEqual(after, before);
for (const reference of [receipt.launch, receipt.exit, receipt.log,
  { path: receiptPath, sha256: receiptSha256 },
  { path: job.admissionPath, sha256: job.admissionSha256 },
  { path: job.node.nodePath, sha256: job.node.nodeSha256 }]) {
  assert.equal(await hash(reference.path), reference.sha256, 'Input drift at ' + reference.path);
}

await confirmTooling(job.input.tooling);
const binding = {
  schema: 'gg419-reviewed-build-binding/v1',
  checkout: job.checkout, head: before.head, tree: before.tree, actualMain: before.actualMain,
  actualMainTree: before.actualMainTree, indexSha256: before.indexSha256, ...job.node,
  buildProof: { exitCode: rawExit.exitCode, exitReceipt: receipt.exit, log: receipt.log,
    buildReceipt: { path: receiptPath, sha256: receiptSha256 } },
  sourceFiles, outputRoots: artifacts.outputRoots, outputFiles: artifacts.outputFiles,
  dependencyFiles: artifacts.dependencyFiles, workspaceLinks: artifacts.workspaceLinks,
  artifactInventorySha256: artifacts.inventorySha256, runtimeEntries: artifacts.runtimeEntries,
  tooling: job.input.tooling,
  input: { phase: job.input.phase, merged381: job.input.merged381, merged410: job.input.merged410, admissionPath: job.admissionPath, admissionSha256: job.admissionSha256 },
  capturedAt: iso(),
};
await save(bindingPath, binding);
process.stdout.write(JSON.stringify({
  path: bindingPath, sha256: await hash(bindingPath), head: binding.head, tree: binding.tree,
  sourceFiles: tracked.length, ...artifacts.counts, dependencyFiles: Object.keys(binding.dependencyFiles).length,
  workspaceLinks: Object.keys(binding.workspaceLinks).length,
}) + '\n');
