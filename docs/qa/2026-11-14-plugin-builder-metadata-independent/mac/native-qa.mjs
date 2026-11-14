import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { writePluginOutput } from './plugin-output.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const fixture = await mkdtemp(join(root, 'native-fixture-'));
const packageDir = join(fixture, 'package');
await mkdir(packageDir);
const source = join(packageDir, 'source.txt');
await writeFile(source, 'source');
const files = { 'skills/demo/SKILL.md': 'generated skill\n' };
const options = (outDir) => ({ outDir, packageDir, protectedPaths: [source], defaultOutDir: join(packageDir, 'dist'), kind: 'codex', files });
const digest = (b) => createHash('sha256').update(b).digest('hex');
const results = [];
const readAttribute = (path, name) => {
  try { const b = execFileSync('/usr/bin/xattr', ['-p', name, path], { stdio: ['ignore', 'pipe', 'pipe'] }); return { present: true, sha256: digest(b), bytes: b.length }; }
  catch (e) { return { present: false, exit: e.status, diagnostic: String(e.stderr ?? '').trim() }; }
};

for (const boundary of ['empty-directory', 'generated-file', 'marker', 'generated-directory']) {
  const outDir = join(fixture, boundary);
  if (boundary === 'empty-directory') await mkdir(outDir);
  else await writePluginOutput(options(outDir));
  const target = boundary === 'generated-file' ? join(outDir, 'skills/demo/SKILL.md') : boundary === 'marker' ? join(outDir, '.graphgoblin-plugin-output.json') : boundary === 'generated-directory' ? join(outDir, 'skills/demo') : outDir;
  const name = 'com.graphgoblin.qa.owner-content';
  execFileSync('/usr/bin/xattr', ['-w', name, 'synthetic owner data for preservation audit', target]);
  const before = readAttribute(target, name);
  if (!before.present) throw new Error('Failed to establish attribute fixture');
  let outcome;
  try { await writePluginOutput(options(outDir)); outcome = { accepted: true }; }
  catch (e) { outcome = { accepted: false, message: e.message }; }
  const after = readAttribute(target, name);
  results.push({ boundary, target, name, before, outcome, after, preserved: before.sha256 === after.sha256 });
}

const forkOut = join(fixture, 'resource-fork');
await writePluginOutput(options(forkOut));
const forkFile = join(forkOut, 'skills/demo/SKILL.md');
const forkName = 'com.apple.ResourceFork';
let resourceFork;
try {
  execFileSync('/usr/bin/xattr', ['-w', forkName, 'synthetic resource fork owner bytes', forkFile]);
  const before = readAttribute(forkFile, forkName);
  let outcome;
  try { await writePluginOutput(options(forkOut)); outcome = { accepted: true }; }
  catch (e) { outcome = { accepted: false, message: e.message }; }
  const after = readAttribute(forkFile, forkName);
  resourceFork = { target: forkFile, name: forkName, before, outcome, after, preserved: before.sha256 === after.sha256 };
} catch (e) { resourceFork = { unsupportedFixture: true, message: e.message, diagnostic: String(e.stderr ?? '') }; }
const cleanOut = join(fixture, 'clean-control');
await writePluginOutput(options(cleanOut));
await writePluginOutput({ ...options(cleanOut), files: { 'skills/demo/SKILL.md': 'updated generated skill\n' } });
const cleanContent = await readFile(join(cleanOut, 'skills/demo/SKILL.md'), 'utf8');
const cleanControl = { repeatedBuildPassed: cleanContent === 'updated generated skill\n', content: cleanContent };
const report = { runtime: process.version, platform: process.platform, arch: process.arch, candidate: 'uncommitted A1 correction after934971a3, frozen by source hashes', helperSha256: digest(await readFile(join(root, 'plugin-output.mjs'))), metadataSha256: digest(await readFile(join(root, 'plugin-output-metadata.mjs'))), fixture, results, resourceFork, cleanControl, remainingFixtureNames: await readdir(fixture), createdAt: new Date().toISOString() };
await writeFile(join(root, 'mac-output-results.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exitCode = results.every(r => r.preserved && !r.outcome.accepted) && !resourceFork.unsupportedFixture && resourceFork.preserved && !resourceFork.outcome.accepted && cleanControl.repeatedBuildPassed ? 0 : 1;
