import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

const [checkout, expectedHead, expectedBase, specFile, reportFile] = process.argv.slice(2);
assert(checkout && expectedHead && expectedBase && specFile && reportFile,
  'Usage: node verify-corrected-binding.mjs <checkout> <head> <base> <manifest-spec.json> <external-output.json>');
const root = await realpath(checkout);
const specPath = resolve(specFile);
const output = resolve(reportFile);
const expectedCommit = /^[a-f0-9]{40}$/;
assert(expectedCommit.test(expectedHead) && expectedCommit.test(expectedBase));
const gitOptions = { cwd: root, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } };
const git = (...args) => execFileSync('git', args, { ...gitOptions, encoding: 'utf8' }).trim();
assert.equal(git('rev-parse', 'HEAD'), expectedHead);
assert.equal(git('rev-parse', 'origin/main'), expectedBase);
assert.equal(git('status', '--porcelain=v1'), '');
assert(relative(root, output).startsWith('..'), 'Evidence output must be external');
assert.equal(process.version,'v22.23.4');

const digest = (raw) => createHash('sha256').update(raw).digest('hex');
const spec = JSON.parse(await readFile(specPath, 'utf8'));
assert(spec.frozen === true,'Fill and authorize the actual manifest after the candidate freeze');
assert.equal(spec.head,expectedHead);
assert.equal(spec.base,expectedBase);
assert.equal(spec.tree,git('rev-parse','HEAD^{tree}'));
assert.match(spec.stackBase,/^[a-f0-9]{40}$/);
execFileSync('git',['merge-base','--is-ancestor',spec.stackBase,expectedHead],gitOptions);
assert.match(spec.builtSource,/^[a-f0-9]{40}$/);
execFileSync('git',['merge-base','--is-ancestor',spec.builtSource,expectedHead],gitOptions);
const changedSinceBuild = git('diff',spec.builtSource,expectedHead,'--name-only').split(/\r?\n/).filter(Boolean);
assert(changedSinceBuild.every((file)=>spec.allowedPostBuildPaths.includes(file) &&
  (/^(?:docs\/|CHANGELOG\.md$)/.test(file) || /(?:\.test|\.spec)\.[jt]sx?$/.test(file))),
  'The source-freeze commit differs from the build source outside reviewed evidence/test paths');
assert(spec.mapping, 'Provide the accepted UI mapping provenance file');
const resolveListed = (path) => resolve(dirname(specPath),path);
const mappingBytes = await readFile(resolveListed(spec.mapping));
const mapping = JSON.parse(mappingBytes);
assert.equal(mapping.id, '237-review-corrected-native-v1', 'Unexpected QA notice mapping identifier');
assert(mapping.frozen === true && mapping.head === expectedHead && mapping.bundle === spec.bundle &&
  Object.keys(mapping.sourceHashes).length >= 10,'Bind final notice and control sources before the native run');
for (const file of mapping.noticeSourcePaths) assert(mapping.sourceHashes[file],'Missing frozen notice source '+file);
for (const [file, expected] of Object.entries(mapping.sourceHashes)) {
  const bytes = execFileSync('git', ['show', expectedHead + ':' + file], gitOptions);
  assert.equal(digest(bytes), expected,
    file + ' changed after QA mapping; re-read the frozen code and refresh the mapping before launch');
}
const sha256sum = /^([a-f0-9]{64}) [* ](?:\.\/)?(.+)$/;

async function list(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    assert(!entry.isSymbolicLink(), 'Unexpected link in artifact tree: ' + join(dir, entry.name));
    if (entry.isFile()) files.push(join(dir, entry.name));
    else if (entry.isDirectory()) files.push(...await list(join(dir, entry.name)));
  }
  return files;
}

async function listing(filename) {
  const bytes = await readFile(resolveListed(filename));
  const entries = new Map();
  for (const line of bytes.toString('utf8').split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue;
    const found = sha256sum.exec(line);
    assert(found, 'Unrecognized sha256sum row: ' + line);
    const [, hash, file] = found;
    assert(!isAbsolute(file) && !file.split('/').includes('..') && !entries.has(file), 'Bad or duplicate listed path ' + file);
    entries.set(file, hash);
  }
  assert(entries.size > 0);
  return { bytes, entries };
}

const requiredTrees = ['apps/web/dist','apps/web/dist-goblin','apps/api/dist','apps/mcp/dist',
  'apps/plugin-codex/dist','apps/plugin-claude/dist','packages/contracts/dist', 'packages/domain/dist',
  'packages/engine/dist','packages/infrastructure/dist','packages/api-client/dist',
  'packages/adapter-codex/dist','packages/adapter-jev/dist'];
for (const path of requiredTrees) assert(spec.trees[path], 'Missing expected distribution tree ' + path);
const trees = {};
const critical = {};
for (const [tree, filename] of Object.entries(spec.trees)) {
  assert(!isAbsolute(tree) && !tree.split('/').includes('..'));
  const expected = await listing(filename);
  const directory = join(root, tree);
  const files = await list(directory);
  assert.equal(files.length, expected.entries.size, tree + ' file count');
  for (const file of files) {
    const key = relative(directory, file).replaceAll('\\', '/');
    const actual = digest(await readFile(file));
    assert.equal(actual, expected.entries.get(key), tree + '/' + key);
    if (tree === 'apps/web/dist' || (tree === 'apps/api/dist' && key === 'main.js')) critical[tree+'/'+key] = actual;
  }
  trees[tree] = { files: files.length, listingSha256: digest(expected.bytes) };
}
const source = await listing(spec.source);
const sourceReadback = {};
for (const [file, hash] of source.entries) {
  assert.equal(digest(await readFile(join(root, file))), hash, file);
  assert.equal(digest(execFileSync('git',['show',expectedHead+':'+file],gitOptions)),hash,file+' frozen Git blob');
  sourceReadback[file] = hash;
}
for (const file of spec.requiredSources) {
  assert(source.entries.has(file), 'Expected affected source hash ' + file);
}
const bundle = 'apps/web/dist/'+spec.bundle.replace(/^\/app\//,'');
assert.match(spec.bundle,/^\/app\/assets\/index-[\w-]+\.js$/);
assert.equal(critical[bundle],spec.bundleSha256);
assert.equal(critical['apps/api/dist/main.js'],spec.apiEntrySha256);
const map = JSON.parse(await readFile(join(root,bundle+'.map'),'utf8'));
const mappedRuntime = ['editor/usePublish.ts','editor/EditorPage.tsx','editor/useAutosave.ts',
  'editor/EditorToolbar.tsx','editor/ValidationIndicator.tsx','editor/ConflictNotice.tsx',
  'api/queries.ts','forms/fields/json.tsx','drafts/local-drafts.ts'];
const sourceMap = {};
for (const file of mappedRuntime) {
  const index = map.sources.findIndex((source)=>source.endsWith('/'+file));
  const path = 'apps/web/src/'+file;
  assert(index>=0 && sourceReadback[path],'Missing frozen bundle source '+path);
  sourceMap[path] = digest(map.sourcesContent[index]);
  assert.equal(sourceMap[path],sourceReadback[path],'Frozen relationship in source map '+path);
}
const report = { head: expectedHead, base: expectedBase, stackBase:spec.stackBase, tree: git('rev-parse','HEAD^{tree}'),
  node: process.version, status: git('status','--porcelain=v1'), trees, critical, bundle:spec.bundle,
  builtSource:spec.builtSource,changedSinceBuild,sourceMap,
  builtFiles:Object.values(trees).reduce((count,tree)=>count+tree.files,0),
  sourceListingSha256: digest(source.bytes), sourceReadback,
  mapping: { id: mapping.id, sha256: digest(mappingBytes), sourceHashes: mapping.sourceHashes } };
assert.equal(report.status, '');
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
if (/^corrected-binding-before\.json$/.test(output.split(/[\\/]/).at(-1))) {
  await writeFile(join(dirname(output),'source-paths.json'),JSON.stringify(Object.keys(sourceReadback),null,2)+'\n');
}
console.log('Verified', Object.keys(sourceReadback).length, 'source hashes and',
  Object.values(trees).reduce((total, tree) => total + tree.files, 0), 'artifact files');
