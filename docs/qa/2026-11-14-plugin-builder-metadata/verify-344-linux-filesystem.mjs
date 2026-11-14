import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { writePluginOutput } from './plugin-output.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const fixture = await mkdtemp(join(root, "test é [literal] $ "));
const packageDir = join(fixture, 'package');
await mkdir(packageDir);
const files = { 'skills/demo/SKILL.md': 'authored data' };
const options = (outDir) => ({ outDir, packageDir, defaultOutDir: join(packageDir, 'dist'), protectedPaths: [], kind: 'test', files });

function xattr(code, path) {
  const result = spawnSync('/usr/bin/python3', ['-I', '-S', '-X', 'utf8', '-c', code, path], {
    env: {}, timeout: 3000,
  });
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
}
const objectKinds = [
  ['', 'empty root'],
  ['', 'owned root'],
  ['skills/demo', 'generated directory'],
  ['skills/demo/SKILL.md', 'generated file'],
  ['.graphgoblin-plugin-output.json', 'marker'],
];
const results = [];
for (const [relative, label] of objectKinds) {
  const outDir = join(fixture, label);
  if (label === 'empty root') await mkdir(outDir);
  else await writePluginOutput(options(outDir));
  const path = join(outDir, relative);
  const attribute = label === 'marker' ? '""' : '"\\u00ff\\u00e9"';
  xattr('import os,sys; os.setxattr(sys.argv[1],"user.graphgoblin.qa", ' + attribute + '.encode("utf-8"), follow_symlinks=False)', path);
  const read = 'import os,sys; sys.stdout.buffer.write(os.getxattr(sys.argv[1], "user.graphgoblin.qa", follow_symlinks=False))';
  const original = xattr(read, path);
  const entries = await readdir(outDir);
  let message;
  await assert.rejects(writePluginOutput(options(outDir)), (error) => {
    message = error.message;
    return /Unowned extended attribute found/.test(message);
  });
  assert.deepEqual(xattr(read, path), original);
  assert.deepEqual(await readdir(outDir), entries);
  results.push({ label, message, preserved: true, bytes: original.length });
}
const control = join(fixture, 'repeat');
await writePluginOutput(options(control));
await writePluginOutput(options(control));
assert.equal(await readFile(join(control, 'skills/demo/SKILL.md'), 'utf8'), files['skills/demo/SKILL.md']);
const substrate = Object.fromEntries(await Promise.all(['plugin-output.mjs', 'plugin-output-metadata.mjs', 'linux-plugin-attributes.py'].map(async (name) =>
  [name, createHash('sha256').update(await readFile(join(root, name))).digest('hex')],
)));
console.log(JSON.stringify({ node: process.version, platform: process.platform, fixture, cleanRepeat: true, substrate, results }, null, 2));
