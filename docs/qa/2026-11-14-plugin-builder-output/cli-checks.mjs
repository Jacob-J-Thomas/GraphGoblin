import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const expectedHead = 'cded46968c79359aee94a3fa5a7f5e17d2630ada';
const source = process.argv.at(2);
if (!source) throw new Error('Pass the candidate worktree');
const evidenceRoot = dirname(fileURLToPath(import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: source, encoding: 'utf8' }).trim();
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const sourcePackage = join(source, 'apps/plugin-codex');
assert.equal(git('rev-parse', 'HEAD'), expectedHead);
assert.equal(git('status', '--porcelain=v1'), '');
const before = Object.fromEntries(
  [
    'apps/plugin-codex/src/cli.ts',
    'apps/plugin-codex/dist/cli.js',
    'apps/plugin-codex/dist/assemble.js',
    'apps/plugin-codex/dist/manifest.js',
    'tooling/plugin-output.mjs',
  ].map((relative) => [relative, sha(join(source, relative))]),
);
const scratch = mkdtempSync(join(evidenceRoot, 'cli-fixture-'));
const packageDir = join(scratch, 'test package');
const dist = join(packageDir, 'dist');
mkdirSync(dist, { recursive: true });
for (const file of ['cli.js', 'assemble.js', 'manifest.js']) {
  cpSync(join(sourcePackage, 'dist', file), join(dist, file));
  assert.equal(sha(join(dist, file)), before['apps/plugin-codex/dist/'+file]);
}
cpSync(join(sourcePackage, 'plugin'), join(packageDir, 'plugin'), { recursive: true });
writeFileSync(join(packageDir, 'package.json'), '{"type":"module"}\n');
const dependencies = join(packageDir, 'node_modules');
symlinkSync(realpathSync(join(sourcePackage, 'node_modules')), dependencies, 'junction');
const results = [];
const originals = {};
const firstEntry = join(scratch, 'entry one.js');
const nextEntry = join(scratch, 'entry two.js');
writeFileSync(firstEntry, '/* first MCP entry */\n');
writeFileSync(nextEntry, '/* second MCP entry */\n');
const owned = join(scratch, 'assembled output');
const foreign = join(scratch, 'foreign output');
mkdirSync(foreign);
const sentinel = join(foreign, 'sentinel.dat');
writeFileSync(sentinel, Buffer.from([0, 255, 13, 10, 17, 32]));
originals.sentinel = sha(sentinel);

function run(label, args, code, message) {
  const execution = spawnSync(process.execPath, [join(dist, 'cli.js'), ...args], {
    cwd: scratch,
    encoding: 'utf8',
    timeout: 20_000,
  });
  results.push({ label, args, exit: execution.status, signal: execution.signal, stdout: execution.stdout, stderr: execution.stderr });
  assert.ifError(execution.error);
  assert.equal(execution.signal, null);
  assert.equal(execution.status, code);
  assert.equal(execution.stdout, '');
  assert.match(execution.stderr, message);
  assert.doesNotMatch(execution.stderr, /^\s+at /m);
}

const generatedConfig = () => join(owned, 'plugins', 'graphgoblin', '.mcp.json');
const installedEntry = () => JSON.parse(readFileSync(generatedConfig(), 'utf8')).mcpServers.graphgoblin.args[0];
let failure;
try {
  run('new output', ['--out', owned, '--mcp-entry', firstEntry], 0, /Assembled graphgoblin@graphgoblin-local/);
  assert.equal(installedEntry(), firstEntry);
  originals.firstMcpConfig = sha(generatedConfig());
  run('owned rebuild', ['--out', owned, '--mcp-entry', nextEntry], 0, /Assembled graphgoblin@graphgoblin-local/);
  assert.equal(installedEntry(), nextEntry);
  originals.secondMcpConfig = sha(generatedConfig());
  assert.notEqual(originals.firstMcpConfig, originals.secondMcpConfig);
  run('foreign destination', ['--out', foreign, '--mcp-entry', firstEntry], 1, /not owned/);
  assert.deepEqual(readdirSync(foreign), ['sentinel.dat']);
  assert.equal(sha(sentinel), originals.sentinel);
  run('malformed argument', ['--out', owned, '--unexpected-option'], 1, /Unknown option '--unexpected-option'/);
  assert.equal(sha(generatedConfig()), originals.secondMcpConfig);
  assert.equal(git('status', '--porcelain=v1'), '');
  for (const [relative, hash] of Object.entries(before)) assert.equal(sha(join(source, relative)), hash);
} catch (error) {
  failure = error;
} finally {
  // Keep evidence and the tiny fixture. Remove just the junction pointing into the worktree.
  assert.equal(resolve(dirname(dependencies), readlinkSync(dependencies)), realpathSync(join(sourcePackage, 'node_modules')));
  rmSync(dependencies);
  writeFileSync(join(evidenceRoot, 'results.json'), JSON.stringify({
    node: process.version, head: expectedHead, source, scratch: basename(scratch),
    before, observedHashes: originals, results, fixtureJunctionRemoved: true,
    failure: failure?.message ?? null,
  }, null, 2)+'\n');
}
if (failure) throw failure;
console.log('4 compiled CLI cases passed');
