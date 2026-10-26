import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const out = fileURLToPath(new URL('.', import.meta.url));
const readme = await fs.readFile(join(out, 'README.md'), 'utf8');
const links = new Set([...readme.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1]));
const files = [];
async function walk(dir, prefix = '') {
  for (const item of await fs.readdir(dir, { withFileTypes: true })) {
    const name = prefix + item.name;
    if (item.isDirectory()) await walk(join(dir, item.name), name + '/');
    else files.push(name);
  }
}
await walk(out);
const missing = files.filter((name) => !name.endsWith('.md') && !links.has(name));
const broken = [];
for (const link of links) {
  if (link === 'bundle-validation.json') continue;
  try {
    await fs.access(join(out, link));
  } catch {
    broken.push(link);
  }
}
const exposed = [];
for (const name of files) {
  const text = await fs.readFile(join(out, name), 'utf8');
  if (/[A-Z]:[\\/]+Users[\\/]+[^\\/\s]+/i.test(text) || /\bgg_[A-Za-z0-9_-]{8,}/.test(text))
    exposed.push(name);
}
assert.deepEqual(missing, []);
assert.deepEqual(broken, []);
assert.deepEqual(exposed, []);
const cleanup = JSON.parse(
  (await fs.readFile(join(out, 'cleanup.json'), 'utf8')).replace(/^\uFEFF/, ''),
);
assert.deepEqual(cleanup.remaining, []);
const result = {
  status: 'PASS',
  artifactCount: files.length,
  allArtifactsLinked: true,
  missing,
  broken,
  exposed,
  remainingStores: cleanup.remaining,
};
await fs.writeFile(join(out, 'bundle-validation.json'), JSON.stringify(result, null, 2) + '\n');
process.stdout.write(JSON.stringify(result) + '\n');
