// Per-file manifests for the 13 existing distribution trees (same method as ui-237-uncertainty-correction/manifests).
// Usage: node manifest-trees.mjs <checkout> <output-dir> <label>
// Writes <output-dir>/manifests/<label>/<tree with / as _>.sha256   ("<sha256> *./<relative path>", C-locale path order),
//        <output-dir>/manifests/<label>/mtimes.tsv                  (tree, path, size, mtimeNs) and trees-summary.json.
// Read-only over the checkout. Symbolic links are refused, as in the independent verifier.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

export const TREES = [
  'apps/web/dist', 'apps/web/dist-goblin', 'apps/api/dist', 'apps/mcp/dist', 'apps/plugin-codex/dist',
  'apps/plugin-claude/dist', 'packages/contracts/dist', 'packages/domain/dist', 'packages/engine/dist',
  'packages/infrastructure/dist', 'packages/api-client/dist', 'packages/adapter-codex/dist', 'packages/adapter-jev/dist',
];
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function walk(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    assert(!entry.isSymbolicLink(), 'Unexpected link in artifact tree: ' + join(dir, entry.name));
    if (entry.isFile()) files.push(join(dir, entry.name));
    else if (entry.isDirectory()) files.push(...await walk(join(dir, entry.name)));
    else assert.fail('Unexpected entry type: ' + join(dir, entry.name));
  }
  return files;
}

export async function manifestTrees(checkout, outputDir, label) {
  const root = await realpath(checkout);
  const target = join(outputDir, 'manifests', label);
  await mkdir(target, { recursive: true });
  const summary = { label, recordedAt: new Date().toISOString(), trees: {}, totalFiles: 0, totalBytes: 0 };
  const mtimeRows = [];
  for (const tree of TREES) {
    const directory = join(root, tree);
    const found = (await walk(directory)).map((file) => ({ file, key: relative(directory, file).replaceAll('\\', '/') }));
    found.sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
    const lines = [];
    let bytes = 0;
    for (const { file, key } of found) {
      const raw = await readFile(file);
      const info = await stat(file, { bigint: true });
      assert.equal(Number(info.size), raw.length, 'size changed while reading ' + file);
      lines.push(digest(raw) + ' *./' + key);
      mtimeRows.push([tree, key, raw.length, info.mtimeNs].join('\t'));
      bytes += raw.length;
    }
    const listing = lines.join('\n') + '\n';
    await writeFile(join(target, tree.replaceAll('/', '_') + '.sha256'), listing);
    summary.trees[tree] = { files: found.length, bytes, listingSha256: digest(listing) };
    summary.totalFiles += found.length;
    summary.totalBytes += bytes;
  }
  await writeFile(join(target, 'mtimes.tsv'), mtimeRows.join('\n') + '\n');
  summary.mtimesSha256 = digest(mtimeRows.join('\n') + '\n');
  await writeFile(join(target, 'trees-summary.json'), JSON.stringify(summary, null, 2) + '\n');
  return summary;
}

if (process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('manifest-trees.mjs')) {
  const [checkout, outputDir, label] = process.argv.slice(2);
  assert(checkout && outputDir && label, 'Usage: node manifest-trees.mjs <checkout> <output-dir> <label>');
  const summary = await manifestTrees(checkout, outputDir, label);
  console.log(JSON.stringify({ label, totalFiles: summary.totalFiles, totalBytes: summary.totalBytes,
    trees: Object.fromEntries(Object.entries(summary.trees).map(([tree, value]) => [tree, value.files])) }, null, 2));
}
