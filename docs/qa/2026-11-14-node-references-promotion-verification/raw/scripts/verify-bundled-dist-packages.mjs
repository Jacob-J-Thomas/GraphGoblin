// Read-only: the web entry bundle embeds workspace packages from packages/*/dist/*.js (not from TypeScript source).
// Confirm every such embedded file equals the on-disk dist file and the manifest listing for the named label.
// Usage: node verify-bundled-dist-packages.mjs <checkout> <output-dir> <manifest-label> <result.json>
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

const [checkout, outputDir, label, resultFile] = process.argv.slice(2);
assert(checkout && outputDir && label && resultFile, 'Usage: node verify-bundled-dist-packages.mjs <checkout> <output-dir> <label> <result.json>');
const root = await realpath(checkout);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const posix = (path) => path.split(String.fromCharCode(92)).join('/');
const indexHtml = await readFile(join(root, 'apps/web/dist/index.html'), 'utf8');
const entry = /assets\/index-[\w-]+\.js/.exec(indexHtml)?.[0];
assert(entry, 'no entry bundle referenced by index.html');
const mapFile = join(root, 'apps/web/dist', entry + '.map');
const map = JSON.parse(await readFile(mapFile, 'utf8'));
const listings = {};
const listed = async (tree) => {
  if (!listings[tree]) {
    listings[tree] = new Map();
    const text = await readFile(join(outputDir, 'manifests', label, tree.replaceAll('/', '_') + '.sha256'), 'utf8');
    for (const line of text.split('\n').filter(Boolean)) {
      const found = /^([a-f0-9]{64}) \*\.\/(.+)$/.exec(line);
      listings[tree].set(found[2], found[1]);
    }
  }
  return listings[tree];
};
const rows = [];
const failures = [];
for (let index = 0; index < map.sources.length; index++) {
  const repoPath = posix(relative(root, resolve(dirname(mapFile), (map.sourceRoot ?? '') + map.sources[index])));
  const found = /^(packages\/[^/]+\/dist)\/(.+)$/.exec(repoPath);
  if (!found) continue;
  const [, tree, key] = found;
  const onDisk = digest(await readFile(join(root, repoPath)));
  const embedded = digest(Buffer.from(map.sourcesContent[index], 'utf8'));
  const inListing = (await listed(tree)).get(key) ?? null;
  const equal = embedded === onDisk && onDisk === inListing;
  rows.push({ path: repoPath, embeddedSha256: embedded, onDiskSha256: onDisk, manifestSha256: inListing, equal });
  if (!equal) failures.push(repoPath);
}
const perPackage = {};
for (const row of rows) { const key = row.path.split('/').slice(0, 2).join('/'); perPackage[key] = (perPackage[key] ?? 0) + 1; }
const result = { label, entryBundle: 'apps/web/dist/' + entry, embeddedDistFiles: rows.length, perPackage, failures, verdict: failures.length === 0 && rows.length > 0 ? 'MATCH' : 'MISMATCH', rows };
await writeFile(resultFile, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ verdict: result.verdict, embeddedDistFiles: rows.length, perPackage, failures }, null, 2));
process.exitCode = result.verdict === 'MATCH' ? 0 : 1;
