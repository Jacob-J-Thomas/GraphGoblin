import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(root, '../../..');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const read = async (name) => JSON.parse(await fs.readFile(path.join(root, name), 'utf8'));
const list = async (directory) => {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await list(target)));
    else files.push(path.relative(root, target).replaceAll('\\', '/'));
  }
  return files;
};
const manifest = await read('publication-manifest.json');
const paths = manifest.files.map((entry) => entry.path);
assert.equal(new Set(paths).size, paths.length, 'No repeated publication paths');
assert.deepEqual(
  paths.slice().sort(),
  (await list(root)).filter((name) => name !== 'publication-manifest.json').sort(),
  'Every other file is included exactly once',
);
for (const entry of manifest.files) {
  assert.ok(!entry.path.startsWith('/') && !entry.path.split('/').includes('..'));
  const bytes = await fs.readFile(path.join(root, entry.path));
  assert.equal(bytes.length, entry.bytes, entry.path);
  assert.equal(hash(bytes), entry.sha256, entry.path);
}
const selection = await read('selection.json');
for (const entry of selection.files) {
  const bytes = await fs.readFile(path.join(root, entry.path));
  assert.equal(bytes.length, entry.bytes, entry.path);
  assert.equal(hash(bytes), entry.sha256, entry.path);
}
assert.equal(
  hash(await fs.readFile(path.join(root, 'raw/artifact-manifest.json'))),
  selection.upstreamPublicManifestSha256,
);
const upstream = await read('raw/artifact-manifest.json');
for (const entry of upstream.files) {
  const retained = entry.path === 'README.md' ? 'raw/README.original.txt' : `raw/${entry.path}`;
  const bytes = await fs.readFile(path.join(root, retained));
  assert.equal(bytes.length, entry.bytes, retained);
  assert.equal(hash(bytes), entry.sha256, retained);
}
const markdown = await fs.readFile(path.join(root, 'README.md'), 'utf8');
let localLinks = 0;
for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
  const link = match[1];
  if (/^[a-z]+:\/\//i.test(link) || link.startsWith('#')) continue;
  const target = path.resolve(root, decodeURIComponent(link.split('#')[0]));
  assert.ok(!path.relative(repository, target).startsWith('..'), link);
  await fs.access(target);
  localLinks++;
}
const replay = JSON.parse(
  execFileSync(process.execPath, [path.join(root, 'raw/verify-records.mjs')], {
    encoding: 'utf8',
  }),
);
assert.equal(replay.result, 'pass');
assert.equal(replay.checksPassed, 12);
assert.deepEqual(replay, await read('replay-verification.json'));
assert.equal((await read('privacy-verification.json')).result, 'pass');
console.log(
  JSON.stringify({
    result: 'pass',
    publicationFilesVerified: manifest.files.length,
    upstreamFilesVerified: upstream.files.length,
    selectedOriginalFilesVerified: selection.files.length,
    repositoryLinksVerified: localLinks,
    replayChecksPassed: replay.checksPassed,
    behaviorTestsStarted: 0,
  }),
);
