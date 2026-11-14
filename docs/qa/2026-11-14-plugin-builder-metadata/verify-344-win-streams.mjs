import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { tmpdir } from 'node:os';

const worktree = resolve(process.argv[2]);
const scratch = await mkdtemp(join(tmpdir(), '344 win streams 漢 '));
const sourcePackage = join(worktree, 'apps/plugin-codex');
const packageRoot = join(scratch, 'test package');
const cli = join(packageRoot, 'dist', 'cli.js');
const caller = join(scratch, 'caller');
const outputs = join(scratch, "owner's [literal] $& 漢");
const entry = join(scratch, 'MCP $& é.js');
for (const target of [dirname(cli), outputs, caller]) await mkdir(target, { recursive: true });
await cp(join(sourcePackage, 'plugin'), join(packageRoot, 'plugin'), { recursive: true });
await cp(join(sourcePackage, 'package.json'), join(packageRoot, 'package.json'));
for (const file of ['cli.js', 'assemble.js', 'manifest.js'])
  await cp(join(sourcePackage, 'dist', file), join(packageRoot, 'dist', file));
const dependencies = join(packageRoot, 'node_modules');
await mkdir(join(dependencies, '@graphgoblin'), { recursive: true });
const tooling = join(dependencies, '@graphgoblin', 'tooling');
await mkdir(tooling);
const toolingFiles = ['package.json', 'plugin-output.mjs', 'plugin-output-metadata.mjs', 'windows-plugin-streams.ps1'];
for (const file of toolingFiles)
  await cp(join(worktree, 'tooling', file), join(tooling, file));
await cp(await realpath(join(sourcePackage, 'node_modules', 'zod')), join(dependencies, 'zod'), { recursive: true });
await writeFile(entry, 'test fixture');

const installedSources = [cli, ...toolingFiles.map((file) => join(tooling, file))];
const installed = Object.fromEntries(await Promise.all(installedSources.map(async (path) => [
  path, createHash('sha256').update(await readFile(path)).digest('hex'),
])));
const trace = [];
async function invoke(outDir, expected, env = process.env) {
  const start = performance.now();
  const child = spawnSync(process.execPath, [cli, '--out', outDir, '--mcp-entry', entry], {
    cwd: caller, env, encoding: 'utf8', windowsHide: true, timeout: 25_000,
  });
  trace.push({ outDir, exitCode: child.status, error: child.error?.message, signal: child.signal, stderr: child.stderr, durationMs: Math.round(performance.now() - start) });
  assert.equal(child.status, expected, child.stderr);
  return child.stderr;
}

const sentinels = [
  ['', 'empty-directory'],
  ['', 'owned-directory'],
  ['plugins/graphgoblin/skills/design-loop', 'generated-directory'],
  ['plugins/graphgoblin/skills/design-loop/SKILL.md', 'generated-file'],
  ['.graphgoblin-plugin-output.json', 'marker'],
];
try {
  for (const [relative, name] of sentinels) {
    const outDir = join(outputs, name);
    if (name === 'empty-directory') await mkdir(outDir);
    else await invoke(outDir, 0);
    const path = join(outDir, relative);
    const stream = path + (name === 'marker' ? ':$DATA:$DATA' : ':owner-sentinel:$DATA');
    const payload = name === 'marker' ? Buffer.from([]) : Buffer.from([0, 64, 128, 255]);
    await writeFile(stream, payload);
    const names = await readdir(outDir);
    assert.match(await invoke(outDir, 1), /Unowned alternate data stream found/);
    assert.deepEqual(await readFile(stream), payload);
    assert.deepEqual(await readdir(outDir), names);
    trace.push({ case: name, ownerStreamPreserved: true, bytes: payload.length });
  }

  const good = join(outputs, 'stream-free output');
  await invoke(good, 0);
  await invoke(good, 0);
  const marker = join(good, '.graphgoblin-plugin-output.json');
  const before = await readFile(marker);
  await writeFile(join(tooling, 'windows-plugin-streams.ps1'), 'exit 7');
  assert.match(await invoke(good, 1), /Unsafe plugin output destination/);
  assert.deepEqual(await readFile(marker), before);
  await invoke(join(outputs, 'new without helper'), 0);
} finally {
  const evidence = { node: process.version, platform: process.platform, installed, trace };
  await writeFile(join(scratch, 'observed.json'), JSON.stringify(evidence, null, 2));
  console.log(join(scratch, 'observed.json'));
}
