import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const evidence = dirname(fileURLToPath(import.meta.url));
const [admissionFile, mode] = process.argv.slice(2);
assert(['source', 'before', 'after'].includes(mode), 'Use source, before or after');
const admission = JSON.parse(await readFile(resolve(admissionFile), 'utf8'));
assert.equal(admission.status, 'authorized');
assert(admission.buildGrant?.trim(), 'Requires root build authorization');
assert.equal(process.version, 'v22.23.4');
const { head, tree, base, actualMain, historyParent, corrected207Integration } = admission;
for (const value of [head, tree, base, actualMain, historyParent, corrected207Integration]) assert.match(value, /^[a-f0-9]{40}$/);
assert.notEqual(head, historyParent);
assert.notEqual(head, corrected207Integration);
const checkout = await realpath(admission.checkout);
assert(relative(checkout, evidence).startsWith('..'), 'Evidence must be outside the candidate');
const opts = { cwd: checkout, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } };
const rawGit = (...args) => execFileSync('git', args, opts);
const git = (...args) => rawGit(...args).toString('utf8').trim();
const identity = () => git('rev-parse', 'HEAD', 'HEAD^{tree}', 'origin/main').split(/\r?\n/);
assert.deepEqual(identity(), [head, tree, mode === 'after' ? (admission.observedMain ?? actualMain) : actualMain]);
assert.equal(git('status', '--porcelain=v1', '--untracked-files=all'), '');
for (const ancestor of [base, actualMain, historyParent, corrected207Integration]) {
  rawGit('merge-base', '--is-ancestor', ancestor, head);
}

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const mapped = [
  'app/App.tsx',
  'components/layout/AppShell.tsx',
  'components/layout/connection-banner.ts',
  'editor/EditorConnectionBanner.tsx',
  'editor/EditorPage.tsx',
  'editor/EditorToolbar.tsx',
  'editor/UndoRedo.tsx',
  'editor/ValidationIndicator.tsx',
  'editor/useAutosave.ts',
  'editor/useLoadEditor.ts',
  'editor/useUndoShortcuts.ts',
  'editor/usePublish.ts',
  'editor/store.ts',
  'lib/online.ts',
  'lib/reachability.ts',
  'api/queries.ts',
].map((path) => 'apps/web/src/' + path);
const affected = git('diff', '--name-only', '--diff-filter=ACMRT', base, head).split(/\r?\n/).filter(Boolean);
const stackDelta = git('diff', '--name-only', '--diff-filter=ACMRT', '64a955887962f72287e532824be1b8cb32c5f055', head).split(/\r?\n/).filter(Boolean);
const files = [...new Set(stackDelta.concat(affected, mapped, ['apps/web/src/index.css', 'apps/web/vite.config.ts',
  'apps/api/src/main.ts', 'apps/api/src/routes/loops.ts']))].sort();
const sourceReadback = {};
for (const file of files) {
  const expected = digest(rawGit('show', head + ':' + file));
  assert.equal(digest(await readFile(join(checkout, file))), expected, file);
  sourceReadback[file] = expected;
}
const emit = (path, content) => writeFile(join(evidence, path), JSON.stringify(content, null, 2) + '\n', { flag: 'wx' });
const source = { head, tree, base, actualMain, node: process.version, status: '', sourceReadback, affected };
  const dirs = [
    'apps/web/dist', 'apps/web/dist-goblin', 'apps/api/dist', 'apps/mcp/dist',
    'apps/plugin-codex/dist', 'apps/plugin-claude/dist', 'packages/contracts/dist',
    'packages/domain/dist', 'packages/engine/dist', 'packages/infrastructure/dist',
    'packages/api-client/dist', 'packages/adapter-codex/dist', 'packages/adapter-jev/dist',
  ];
  async function collect(directory, collected) {
    for (const item of await readdir(join(checkout, directory), { withFileTypes: true })) {
      const path = directory + '/' + item.name;
      assert(!item.isSymbolicLink(), path);
      if (item.isDirectory()) await collect(path, collected);
      else {
        assert(item.isFile(), path);
        collected[path] = digest(await readFile(join(checkout, path)));
      }
    }
  }
if (mode === 'source') {
  const prebuild = {};
  for (const directory of dirs) {
    const hashes = {};
    try {
      await collect(directory, hashes);
      prebuild[directory] = { exists: true, files: Object.keys(hashes).length, hashes };
    } catch (error) {
      if (error.code !== 'ENOENT' || Object.keys(hashes).length) throw error;
      prebuild[directory] = { exists: false, files: 0, hashes };
    }
  }
  await emit('prebuild-inventory.json', prebuild);
  await emit('source-binding.json', source);
  console.log(JSON.stringify({ head, tree, actualMain, boundSource: files.length }));
} else {
  const prior = JSON.parse(await readFile(join(evidence, 'source-binding.json'), 'utf8'));
  assert.deepEqual(prior, source, 'Working/Git source changed since pre-build admission');
  const build = JSON.parse(await readFile(join(evidence, 'forced-build-exit.json'), 'utf8'));
  assert.deepEqual([build.head, build.tree, build.actualMain, build.node, build.exitCode, build.cleanAfter],
    [head, tree, actualMain, process.version, 0, true]);
  const buildLog = await readFile(join(evidence, 'forced-build.log'));
  assert.equal(digest(buildLog), build.logSha256);
  const log = buildLog.toString('utf8');
  const tasks = /\b([1-9]\d*) successful, ([1-9]\d*) total/.exec(log);
  assert(tasks && tasks[1] === tasks[2]);
  assert(log.includes('0 cached, ' + tasks[2] + ' total'));
  const critical = {};
  const trees = {};
  await mkdir(join(evidence, 'manifests'), { recursive: true });
  for (const directory of dirs) {
    const collected = {};
    await collect(directory, collected);
    assert(Object.keys(collected).length > 0, directory);
    const listing = Object.keys(collected).sort().map((path) => collected[path] + ' *' + path).join('\n') + '\n';
    const manifest = join(evidence, 'manifests', directory.replaceAll('/', '_') + '.sha256');
    if (mode === 'before') await writeFile(manifest, listing, { flag: 'wx' });
    else assert.equal(await readFile(manifest, 'utf8'), listing, directory);
    for (const [path, hash] of Object.entries(collected)) {
      if (directory === 'apps/web/dist' || path === 'apps/api/dist/main.js') critical[path] = hash;
    }
    trees[directory] = { files: Object.keys(collected).length, listingSha256: digest(listing) };
  }
  const index = await readFile(join(checkout, 'apps/web/dist/index.html'), 'utf8');
  const scripts = [...index.matchAll(/<script[^>]*\bsrc="(\/app\/assets\/index-[\w-]+\.js)"/g)];
  assert.equal(scripts.length, 1);
  const bundle = scripts[0][1];
  const bundlePath = 'apps/web/dist/' + bundle.slice('/app/'.length);
  assert(critical[bundlePath] && critical['apps/api/dist/main.js']);
  const sourceMap = {};
  for (const path of Object.keys(critical).filter((file) => file.endsWith('.js.map')).sort()) {
    const map = JSON.parse(await readFile(join(checkout, path), 'utf8'));
    for (const [i, original] of map.sources.entries()) {
      const file = mapped.find((candidate) => original.replaceAll('\\', '/').endsWith('/' + candidate.slice('apps/web/src/'.length)));
      if (!file) continue;
      const hash = digest(map.sourcesContent[i]);
      assert.equal(hash, sourceReadback[file], file + ' embedded in ' + path);
      sourceMap[file] = hash;
    }
  }
  const sourceHashes = {};
  for (const file of mapped) {
    assert.equal(sourceMap[file], sourceReadback[file], 'Missing mapped production source ' + file);
    sourceHashes[file] = sourceReadback[file];
  }
  const mapping = { id: '208-history-independent-native-v1', sourceHashes };
  mapping.sha256 = digest(JSON.stringify(mapping));
  const report = { ...source, builtSource: head, buildLogSha256: build.logSha256, bundle, critical, trees, sourceMap, mapping,
    builtFiles: Object.values(trees).reduce((count, current) => count + current.files, 0) };
  if (mode === 'after') {
    const before = JSON.parse(await readFile(join(evidence, 'binding', 'binding-before.json'), 'utf8'));
    assert.deepEqual(report, before, 'Before and after bindings differ');
  }
  assert.deepEqual(identity(), [head, tree, mode === 'after' ? (admission.observedMain ?? actualMain) : actualMain]);
  assert.equal(git('status', '--porcelain=v1', '--untracked-files=all'), '');
  await mkdir(join(evidence, 'binding'), { recursive: true });
  await emit('binding/binding-' + mode + '.json', report);
  console.log(JSON.stringify({ mode, head, bundle, builds: report.builtFiles, map: sourceHashes }));
}
