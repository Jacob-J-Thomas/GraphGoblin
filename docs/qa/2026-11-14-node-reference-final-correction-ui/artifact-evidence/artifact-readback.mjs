// Read-only readback of the retained compiled 164c runtime in the PR #474 checkout.
// Verifies every artifact in the 13 distribution trees against the retained sha256sum listings that
// the activation-supplement binding used, and hashes every *.tsbuildinfo outside node_modules.
// Writes one JSON report to the path given; never writes inside the checkout.
// Usage: node artifact-readback.mjs <checkout> <activation-manifest.json> <output.json>
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

const [checkout, manifestFile, outputFile] = process.argv.slice(2);
assert(checkout && manifestFile && outputFile, 'Usage: <checkout> <activation-manifest.json> <output.json>');
const root = await realpath(checkout);
const output = resolve(outputFile);
assert(relative(root, output).startsWith('..'), 'Output must be outside the checkout');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifestPath = resolve(manifestFile);
const manifestBytes = await readFile(manifestPath);
const manifest = JSON.parse(manifestBytes);
const row = /^([a-f0-9]{64}) [* ](?:\.\/)?(.+)$/;

async function list(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    assert(!entry.isSymbolicLink(), 'Unexpected link ' + join(dir, entry.name));
    if (entry.isFile()) files.push(join(dir, entry.name));
    else if (entry.isDirectory()) files.push(...(await list(join(dir, entry.name))));
  }
  return files;
}

const trees = {};
const mismatches = [];
const all = createHash('sha256');
let total = 0;
for (const [tree, listingFile] of Object.entries(manifest.trees).sort(([a], [b]) => a.localeCompare(b))) {
  assert(!isAbsolute(tree) && !tree.split('/').includes('..'));
  const listingBytes = await readFile(resolve(dirname(manifestPath), listingFile));
  const expected = new Map();
  for (const line of listingBytes.toString('utf8').split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue;
    const found = row.exec(line);
    assert(found, 'Unrecognized listing row ' + line);
    expected.set(found[2], found[1]);
  }
  const directory = join(root, tree);
  const files = (await list(directory))
    .map((file) => relative(directory, file).replaceAll('\\', '/'))
    .sort();
  let matched = 0;
  for (const key of files) {
    const actual = digest(await readFile(join(directory, key)));
    all.update(tree + '/' + key + '\0' + actual + '\n');
    if (expected.get(key) === actual) matched += 1;
    else mismatches.push({ file: tree + '/' + key, expected: expected.get(key) ?? null, actual });
  }
  for (const key of expected.keys())
    if (!files.includes(key)) mismatches.push({ file: tree + '/' + key, expected: expected.get(key), actual: null });
  total += files.length;
  trees[tree] = {
    files: files.length,
    listed: expected.size,
    matched,
    listingSha256: digest(listingBytes),
  };
}

async function buildInfo(dir, found = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await buildInfo(path, found);
    else if (entry.isFile() && entry.name.endsWith('.tsbuildinfo')) found.push(path);
  }
  return found;
}
const tsbuildinfo = {};
for (const file of (await buildInfo(root)).sort()) {
  tsbuildinfo[relative(root, file).replaceAll('\\', '/')] = digest(await readFile(file));
}

const report = {
  node: process.version,
  checkout: root,
  manifest: { path: manifestPath, sha256: digest(manifestBytes), builtSource: manifest.builtSource },
  trees,
  artifactFiles: total,
  artifactAggregateSha256: all.digest('hex'),
  mismatches,
  allMatchRetainedListings: mismatches.length === 0,
  bundle: {
    path: 'apps/web/dist/assets/index-BSN6gKGW.js',
    sha256: digest(await readFile(join(root, 'apps/web/dist/assets/index-BSN6gKGW.js'))),
  },
  apiEntry: { path: 'apps/api/dist/main.js', sha256: digest(await readFile(join(root, 'apps/api/dist/main.js'))) },
  tsbuildinfo,
};
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(
  `artifacts=${total} mismatches=${mismatches.length} aggregate=${report.artifactAggregateSha256} tsbuildinfo=${Object.keys(tsbuildinfo).length}`,
);
