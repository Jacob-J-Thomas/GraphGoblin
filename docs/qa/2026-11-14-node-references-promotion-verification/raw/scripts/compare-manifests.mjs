// Compare two manifest sets written by manifest-trees.mjs and classify every file.
// Usage: node compare-manifests.mjs <output-dir> <labelA> <labelB> <result-name>
//   byte-identical + same mtime  -> untouched      (the builder did not write the file)
//   byte-identical + new mtime   -> rewritten-identical (written again, same bytes)
//   different bytes              -> changed
//   only in A / only in B        -> removed / added
// This is the accounting needed to say accurately what an incremental `tsc -b` did: identical bytes alone do not show a re-emit.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const [outputDir, labelA, labelB, name] = process.argv.slice(2);
assert(outputDir && labelA && labelB && name, 'Usage: node compare-manifests.mjs <output-dir> <labelA> <labelB> <result-name>');
const load = async (label) => {
  const base = join(outputDir, 'manifests', label);
  const hashes = new Map();
  const treeOfFile = new Map();
  const summary = JSON.parse(await readFile(join(base, 'trees-summary.json'), 'utf8'));
  for (const tree of Object.keys(summary.trees)) {
    const text = await readFile(join(base, tree.replaceAll('/', '_') + '.sha256'), 'utf8');
    for (const line of text.split('\n').filter(Boolean)) {
      const found = /^([a-f0-9]{64}) \*\.\/(.+)$/.exec(line);
      assert(found, 'bad row ' + line);
      hashes.set(tree + '/' + found[2], found[1]);
      treeOfFile.set(tree + '/' + found[2], tree);
    }
  }
  const mtimes = new Map();
  for (const line of (await readFile(join(base, 'mtimes.tsv'), 'utf8')).split('\n').filter(Boolean)) {
    const [tree, key, size, mtimeNs] = line.split('\t');
    mtimes.set(tree + '/' + key, mtimeNs);
  }
  return { hashes, mtimes, treeOfFile, summary };
};
const a = await load(labelA);
const b = await load(labelB);
const classes = { untouched: [], 'rewritten-identical': [], changed: [], added: [], removed: [] };
for (const [file, hashA] of a.hashes) {
  if (!b.hashes.has(file)) { classes.removed.push(file); continue; }
  if (b.hashes.get(file) !== hashA) classes.changed.push(file);
  else if (b.mtimes.get(file) === a.mtimes.get(file)) classes.untouched.push(file);
  else classes['rewritten-identical'].push(file);
}
for (const file of b.hashes.keys()) if (!a.hashes.has(file)) classes.added.push(file);
const perTree = {};
for (const tree of Object.keys(b.summary.trees)) {
  const row = { filesA: a.summary.trees[tree]?.files ?? 0, filesB: b.summary.trees[tree].files, listingSha256A: a.summary.trees[tree]?.listingSha256, listingSha256B: b.summary.trees[tree].listingSha256 };
  row.listingIdentical = row.listingSha256A === row.listingSha256B;
  for (const [cls, files] of Object.entries(classes)) row[cls] = files.filter((file) => file.startsWith(tree + '/')).length;
  perTree[tree] = row;
}
const result = {
  a: labelA, b: labelB, filesA: a.hashes.size, filesB: b.hashes.size,
  counts: Object.fromEntries(Object.entries(classes).map(([cls, files]) => [cls, files.length])),
  perTree, changed: classes.changed, added: classes.added, removed: classes.removed,
  rewrittenIdentical: classes['rewritten-identical'],
  allListingsIdentical: Object.values(perTree).every((row) => row.listingIdentical),
  allFilesUntouched: classes.changed.length + classes.added.length + classes.removed.length + classes['rewritten-identical'].length === 0,
};
await writeFile(join(outputDir, 'manifests', name + '.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ a: labelA, b: labelB, counts: result.counts, allListingsIdentical: result.allListingsIdentical, allFilesUntouched: result.allFilesUntouched,
  perTree: Object.fromEntries(Object.entries(perTree).map(([tree, row]) => [tree, { files: row.filesB, changed: row.changed, added: row.added, removed: row.removed, 'rewritten-identical': row['rewritten-identical'], untouched: row.untouched }])) }, null, 2));
