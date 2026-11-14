import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

const [checkout, expectedHead, expectedBase, specFile, reportFile] = process.argv.slice(2);
assert(checkout && expectedHead && expectedBase && specFile && reportFile,
  'Usage: node verify-binding.mjs <checkout> <head> <base> <manifest-spec.json> <external-output.json>');
const root = await realpath(checkout);
const specPath = resolve(specFile);
const output = resolve(reportFile);
const expectedCommit = /^[a-f0-9]{40}$/;
assert(expectedCommit.test(expectedHead) && expectedCommit.test(expectedBase));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
assert.equal(git('rev-parse', 'HEAD'), expectedHead);
assert.equal(git('rev-parse', 'origin/main'), expectedBase);
assert.equal(git('status', '--porcelain=v1'), '');
assert(relative(root, output).startsWith('..'), 'Evidence output must be external');

const digest = (raw) => createHash('sha256').update(raw).digest('hex');
const spec = JSON.parse(await readFile(specPath, 'utf8'));
const correctionHead = '2367b15b310eac52d95af77c570d5ce36f741527';
const correctionTree = '6bcc8e4eb74ee2d82dd793f88538b08d260002d8';
const targetHead = '7c6e635539e12c56b82f226f1ee734d83b985ad4';
assert.equal(expectedHead, correctionHead, 'Newly rebound candidate required for a different head');
assert.equal(expectedBase, targetHead);
assert.equal(git('rev-parse', 'HEAD^{tree}'), correctionTree);
assert.equal(spec.buildSourceHead, correctionHead, 'Only the corrected integration build is admitted');
assert.equal(spec.expectedTrees?.['apps/web/dist']?.listingSha256?.length, 64,
  'Provide the worker’s fresh web SHA-256 listing digest');
assert.notEqual(spec.expectedTrees['apps/web/dist'].listingSha256,
  '37d2177ec857c85029979e82a2b86afe46f575ca56bbf88e62b2302410c47dd2',
  'The old 0d2 built web shell is not the correction');
const sourcePreparation = JSON.parse(await readFile(resolve(spec.preparation), 'utf8'));
assert.equal(sourcePreparation.head, expectedHead);
assert.equal(sourcePreparation.tree, correctionTree);
for (const [file, sha256] of Object.entries(sourcePreparation.sourceHashes)) {
  assert.equal(digest(execFileSync('git', ['show', expectedHead + ':' + file], { cwd: root })), sha256, file);
}
const sha256sum = /^([a-f0-9]{64}) [* ](?:\.\/)?(.+)$/;

async function list(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    assert(!entry.isSymbolicLink(), 'Unexpected link in artifact tree: ' + join(dir, entry.name));
    if (entry.isFile()) files.push(join(dir, entry.name));
    else if (entry.isDirectory()) files.push(...await list(join(dir, entry.name)));
  }
  return files;
}

async function listing(filename) {
  const bytes = await readFile(resolve(filename));
  const entries = new Map();
  for (const line of bytes.toString('utf8').split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue;
    const found = sha256sum.exec(line);
    assert(found, 'Unrecognized sha256sum row: ' + line);
    const [, hash, file] = found;
    assert(!isAbsolute(file) && !file.split('/').includes('..') && !entries.has(file), 'Bad or duplicate listed path ' + file);
    entries.set(file, hash);
  }
  assert(entries.size > 0);
  return { bytes, entries };
}

const requiredTrees = ['apps/web/dist', 'apps/web/dist-goblin', 'apps/api/dist', 'packages/infrastructure/dist'];
for (const path of requiredTrees) assert(spec.trees[path], 'Missing expected distribution tree ' + path);
for (const file of ['index.html', ...Object.keys(spec.expectedWebBundle ?? {}).filter((file) => file.endsWith('.js'))]) {
  assert(/^[a-f0-9]{64}$/.test(spec.expectedWebBundle?.[file]), 'Missing corrected served hash: '+file);
}
assert(Object.keys(spec.expectedWebBundle).some((file) => file.startsWith('assets/') && file.endsWith('.js')),
  'Manifest must bind the actual JS delivered to Edge');
const trees = {};
for (const [tree, filename] of Object.entries(spec.trees)) {
  assert(!isAbsolute(tree) && !tree.split('/').includes('..'));
  const expected = await listing(filename);
  const expectedMeta = spec.expectedTrees[tree];
  assert.equal(digest(expected.bytes), expectedMeta.listingSha256, tree + ' manifest digest');
  assert.equal(expected.entries.size, expectedMeta.files, tree + ' manifest count');
  const directory = join(root, tree);
  const files = await list(directory);
  assert.equal(files.length, expected.entries.size, tree + ' file count');
  for (const file of files) {
    const key = relative(directory, file).replaceAll('\\', '/');
    assert.equal(digest(await readFile(file)), expected.entries.get(key), tree + '/' + key);
  }
  trees[tree] = { files: files.length, listingSha256: digest(expected.bytes) };
}
const source = await listing(spec.source);
const sourceReadback = {};
for (const [file, hash] of source.entries) {
  assert.equal(digest(await readFile(join(root, file))), hash, file);
  sourceReadback[file] = hash;
}
for (const file of spec.requiredSources) {
  assert(source.entries.has(file), 'Expected affected source hash ' + file);
}
const report = { head: expectedHead, base: expectedBase, tree: git('rev-parse','HEAD^{tree}'),
  node: process.version, status: git('status','--porcelain=v1'), trees, buildSourceHead: spec.buildSourceHead,
  sourceListingSha256: digest(source.bytes), sourceReadback,
  expectedWebBundle: spec.expectedWebBundle, expectedAPIEntry: spec.expectedAPIEntry };
assert(report.expectedWebBundle && report.expectedAPIEntry, 'Provide fresh served bundle and actual API entry hashes');
assert.equal(digest(await readFile(join(root, 'apps/api/dist/main.js'))), report.expectedAPIEntry);
for (const [file, hash] of Object.entries(report.expectedWebBundle)) {
  assert.equal(digest(await readFile(join(root, 'apps/web/dist', file))), hash, file);
}
assert.equal(report.status, '');
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log('Verified', Object.keys(sourceReadback).length, 'source hashes and',
  Object.values(trees).reduce((total, tree) => total + tree.files, 0), 'artifact files');
