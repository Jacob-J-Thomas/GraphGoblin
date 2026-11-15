// Read-only byte binding. This module never imports the application or opens a store.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const checkoutPath = 'C:/Users/98jak/.codex/worktrees/gg-20261114-space-cards/GraphGoblin';
const sourceHead = 'e1237593babd4d03466b91685fc05dbe49223b2a';
const sourceTree = '57541f0423de585307f5d7db27923ddac41d7181';
const buildHead = 'b043d3b8baafdff742803ae46750c8664067f3c7';
const buildTree = 'c87fed2f00990e7ccb3728ab1935e3d75241f736';
const packet = 'docs/qa/2026-11-15-space-cards-corrected-native/evidence';
export const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const packetFile = (name) => join(checkoutPath, packet, name);
const isPublication = (file) =>
  file.startsWith('docs/qa/') || file === 'docs/delivery/2026-11-13-four-intents-register.md';

export async function readOldBinding(actualMain) {
  assert.equal(process.version, 'v22.23.4');
  const checkout = await realpath(checkoutPath);
  const gitOptions = {
    cwd: checkout,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    maxBuffer: 128 * 1024 * 1024,
  };
  const git = (...args) => execFileSync('git', args, gitOptions).toString('utf8');
  const identity = () => ({
    head: git('rev-parse', 'HEAD').trim(),
    tree: git('rev-parse', 'HEAD^{tree}').trim(),
    localOriginMain: git('rev-parse', 'origin/main').trim(),
    mainTree: git('rev-parse', 'origin/main^{tree}').trim(),
    status: git('status', '--porcelain=v1', '--untracked-files=all').trim(),
  });
  const observed = identity();
  assert.equal(observed.head, sourceHead);
  assert.equal(observed.tree, sourceTree);
  assert.equal(observed.status, '');
  if (actualMain) {
    assert.match(actualMain, /^[0-9a-f]{40}$/);
    assert.equal(observed.localOriginMain, actualMain, 'Origin tracking ref differs from root-verified main.');
    assert.equal(observed.mainTree, sourceTree, 'Main tree differs from the frozen checkout.');
  }
  assert.equal(git('rev-parse', buildHead + '^{tree}').trim(), buildTree);

  const indexPath = resolve(checkout, git('rev-parse', '--git-path', 'index').trim());
  const indexSha256 = sha(await readFile(indexPath));
  const publicationPaths = git('diff', '--name-only', '-z', buildHead, sourceHead)
    .split('\0').filter(Boolean);
  assert(publicationPaths.length > 0 && publicationPaths.every(isPublication));

  const rawPrior = await readFile(packetFile('existing-rebind/binding/binding-before.json'));
  const prior = JSON.parse(rawPrior);
  assert.equal(prior.head, buildHead);
  assert.equal(prior.builtSource, buildHead);
  assert.equal(prior.tree, buildTree);
  assert.equal(prior.node, process.version);
  const exit = JSON.parse(await readFile(packetFile('target-d1/forced-build-exit.json'), 'utf8'));
  const log = await readFile(packetFile('target-d1/forced-build.log'));
  assert.equal(exit.head, buildHead);
  assert.equal(exit.tree, buildTree);
  assert.equal(exit.exitCode, 0);
  assert.equal(exit.node, process.version);
  assert.equal(exit.cleanAfter, true);
  assert.equal(sha(log), exit.logSha256);
  assert.equal(sha(log), prior.buildLogSha256);

  const entries = git('ls-tree', '-r', '-z', 'HEAD').split('\0').filter(Boolean);
  const productPaths = entries.map((entry) => {
    const match = /^(\d+) blob ([0-9a-f]{40})\t(.+)$/u.exec(entry);
    assert(match, entry);
    const [, mode, blob, path] = match;
    return { mode, blob, path };
  }).filter(({path}) => !isPublication(path));

  await Promise.all(productPaths.map(async (file) => {
    const bytes = await readFile(join(checkout, file.path));
    const blob = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
    assert.equal(blob, file.blob, file.path);
    file.sha256 = sha(bytes);
    assert.equal(file.sha256, prior.sourceReadback[file.path], 'Prior build input mismatch ' + file.path);
  }));
  const sources = Object.fromEntries(productPaths.map(({path, ...rest}) => [path, rest]));
  const built = {};
  async function collect(dir, files) {
    for (const entry of await readdir(join(checkout, dir), {withFileTypes:true})) {
      const path = dir + '/' + entry.name;
      if (entry.isDirectory()) await collect(path, files);
      else {
        assert(entry.isFile(), path);
        files[path] = sha(await readFile(join(checkout, path)));
      }
    }
  }
  const trees = {};
  for (const [dir, priorTree] of Object.entries(prior.trees)) {
    const files = {};
    await collect(dir, files);
    const list = Object.keys(files).sort().map((path) => files[path] + ' *' + path).join('\n') + '\n';
    const frozen = await readFile(packetFile('existing-rebind/manifests/' + dir.replaceAll('/', '_') + '.sha256'), 'utf8');
    assert.equal(list, frozen, dir);
    trees[dir] = { files: Object.keys(files).length, listingSha256: sha(list) };
    assert.deepEqual(trees[dir], priorTree);
    Object.assign(built, files);
  }
  assert.equal(Object.keys(trees).length, 13);
  assert.equal(Object.keys(built).length, prior.builtFiles);
  for (const [file, hash] of Object.entries(prior.critical)) {
    assert.equal(built[file], hash, 'Critical built asset ' + file);
  }

  const workspaceLinks = {};
  const owners = ['apps/api', 'packages/adapter-codex', 'packages/adapter-jev',
    'packages/contracts', 'packages/domain', 'packages/engine', 'packages/infrastructure'];
  for (const owner of owners) {
    const manifest = JSON.parse(await readFile(join(checkout, owner, 'package.json'), 'utf8'));
    for (const name of Object.keys(manifest.dependencies ?? {}).filter((n) => n.startsWith('@graphgoblin/'))) {
      const file = owner + '/node_modules/' + name;
      const resolved = await realpath(join(checkout, file));
      const link = relative(checkout, resolved).replaceAll('\\', '/');
      assert.equal(link, 'packages/' + name.split('/')[1], file);
      workspaceLinks[file] = link;
    }
  }

  const libsql = await realpath(join(checkout, 'packages/infrastructure/node_modules/@libsql/client'));
  assert(!relative(checkout, libsql).startsWith('..'), 'Libsql resolves outside the candidate worktree');
  const libsqlManifest = await readFile(join(libsql, 'package.json'));
  assert.deepEqual(identity(), observed, 'Git identity changed during inspection.');
  assert.equal(sha(await readFile(indexPath)), indexSha256, 'Git index changed during inspection.');
  return {
    schema: 'graphgoblin-361-old-build-binding/v1', checkout, ...observed,
    admittedMain: actualMain ?? null,
    comparison: actualMain ? 'exact committed tree match' : 'preparation only, main comparison pending',
    buildHead, buildTree, priorBindingSha256: sha(rawPrior), indexSha256,
    node: process.version, nodePath: process.execPath, buildExit: exit,
    publicationOnlyPathCount: publicationPaths.length, sources, trees, built, workspaceLinks,
    libsql: { path: relative(checkout, libsql), version: JSON.parse(libsqlManifest).version, manifestSha256: sha(libsqlManifest) },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , output, actualMain] = process.argv;
  assert(output, 'Usage: node binding.mjs <new external output> [root-verified main SHA]');
  const binding = await readOldBinding(actualMain);
  await writeFile(output, JSON.stringify(binding, null, 2) + '\n', {flag: 'wx'});
  process.stdout.write(JSON.stringify({
    head: binding.head, currentMain: binding.localOriginMain, comparison: binding.comparison,
    productFiles: Object.keys(binding.sources).length, builtFiles: Object.keys(binding.built).length,
    builtTrees: Object.keys(binding.trees).length, workspaceLinks: Object.keys(binding.workspaceLinks).length,
  }) + '\n');
}
