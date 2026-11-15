import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

const specPath = resolve(
  'docs/qa/2026-11-14-node-reference-review-corrected-native/corrected-manifest.json',
);
const bindingPath = join(dirname(specPath), 'corrected-binding-before.json');
const spec = JSON.parse(await readFile(specPath, 'utf8'));
const binding = JSON.parse(await readFile(bindingPath, 'utf8'));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const trees = [];
async function list(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    assert(!entry.isSymbolicLink(), 'Unexpected artifact symlink ' + path);
    if (entry.isFile()) files.push(path);
    if (entry.isDirectory()) files.push(...await list(path));
  }
  return files;
}
for (const [tree, listingFile] of Object.entries(spec.trees)) {
  const listing = await readFile(resolve(dirname(specPath), listingFile));
  const checksum = sha(listing);
  assert.equal(checksum, binding.trees[tree].listingSha256);
  const hashes = new Map();
  for (const line of listing.toString('utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const result = /^([a-f0-9]{64}) [* ](?:\.\/)?(.+)$/.exec(line);
    assert(result, 'Unrecognized hash listing entry ' + line);
    hashes.set(result[2], result[1]);
  }
  const files = await list(tree);
  assert.equal(files.length, hashes.size, tree);
  assert.equal(files.length, binding.trees[tree].files, tree);
  for (const file of files) {
    const name = relative(tree, file).replaceAll('\\', '/');
    assert.equal(sha(await readFile(file)), hashes.get(name), file);
  }
  trees.push({ tree, files: files.length, listingSha256: checksum });
}
const files = trees.reduce((total, tree) => total + tree.files, 0);
assert.equal(trees.length, 13);
assert.equal(files, 1227);
console.log(JSON.stringify({ builtSource: binding.builtSource, trees, files }, null, 2));
