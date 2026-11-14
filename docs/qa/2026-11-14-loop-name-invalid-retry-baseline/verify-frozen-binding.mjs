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
assert.equal(git('rev-parse', expectedHead+'^{commit}'), expectedHead);
assert.equal(git('rev-parse', expectedBase+'^{commit}'), expectedBase);

assert(relative(root, output).startsWith('..'), 'Evidence output must be external');

const digest = (raw) => createHash('sha256').update(raw).digest('hex');
const spec = JSON.parse(await readFile(specPath, 'utf8'));
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

const requiredTrees = ['apps/web/dist', 'apps/api/dist', 'packages/infrastructure/dist'];
for (const path of requiredTrees) assert(spec.trees[path], 'Missing expected distribution tree ' + path);
const trees = {};
for (const [tree, filename] of Object.entries(spec.trees)) {
  assert(!isAbsolute(tree) && !tree.split('/').includes('..'));
  const expected = await listing(filename);
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
  assert.equal(digest(execFileSync('git', ['show', expectedHead+':'+file], {cwd:root})), hash, file);
  sourceReadback[file] = hash;
}
for (const file of spec.requiredSources) {
  assert(source.entries.has(file), 'Expected affected source hash ' + file);
}
const report = { head: expectedHead, base: expectedBase, tree: git('rev-parse',expectedHead+'^{tree}'),
  node: process.version, baselineObjectsOnly: true, trees,
  sourceListingSha256: digest(source.bytes), sourceReadback };

await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log('Verified', Object.keys(sourceReadback).length, 'source hashes and',
  Object.values(trees).reduce((total, tree) => total + tree.files, 0), 'artifact files');
