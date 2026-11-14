// Read-only build-to-source correspondence for the current checkout.
// Usage: node verify-bundle-sources.mjs <checkout> <result.json> <phase-label>
//  1. Web: the entry bundle named by apps/web/dist/index.html, its source map, and the seven rename/editor runtime paths from
//     the independent QA mapping (EditorPage, store, useAutosave, NodeEditorDialog, LoopSettingsPanel, RenameNotice,
//     useUndoShortcuts) compared by exact repo path (not by leaf name) with the raw/Git source hash and the 48-path source map.
//     Also every notice source path, every tracked source embedded in any web source map, and every promotion-source-map path.
//  2. Backend: every dist/.tsbuildinfo records, per source file, the SHA-256 TypeScript hashed when it last emitted that project;
//     compare each with the current raw source bytes. This binds tsc -b output to source bytes without claiming a fresh emit.
//  3. API entry hash and its map.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

const [checkoutArg, outputFile, phase] = process.argv.slice(2);
assert(checkoutArg && outputFile && phase, 'Usage: node verify-bundle-sources.mjs <checkout> <result.json> <phase-label>');
const root = await realpath(checkoutArg);
const batch = 'C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const gitBytes = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
const git = (...args) => gitBytes(...args).toString('utf8').trim();
const posix = (path) => path.replaceAll('\\', '/');
const promotion = JSON.parse(await readFile(join(batch, 'node-reference-273-promotion-independent', 'promotion-source-map.json'), 'utf8'));
const mapping = JSON.parse(await readFile(join(batch, 'node-reference-273-promotion-independent', 'ui-mapping-template.json'), 'utf8'));
const head = git('rev-parse', 'HEAD');
const mappedRuntime = ['EditorPage.tsx', 'store.ts', 'useAutosave.ts', 'NodeEditorDialog.tsx', 'LoopSettingsPanel.tsx', 'RenameNotice.tsx', 'useUndoShortcuts.ts'];
const sevenPaths = mappedRuntime.map((leaf) => 'apps/web/src/editor/' + leaf);
const result = { phase, checkedAt: new Date().toISOString(), head, tree: git('rev-parse', 'HEAD^{tree}'), status: git('status', '--porcelain=v1', '--untracked-files=all'), failures: [] };
const fail = (message) => result.failures.push(message);
const rawSource = async (file) => digest(await readFile(join(root, file)));
const blobSource = (file) => digest(gitBytes('show', 'HEAD:' + file));

// ---- 1. Web bundle
const webDist = join(root, 'apps/web/dist');
const indexHtml = await readFile(join(webDist, 'index.html'), 'utf8');
const scripts = [...indexHtml.matchAll(/(?:src|href)="\/app\/(assets\/[^"]+)"/g)].map((match) => match[1]);
const entryJs = scripts.find((file) => /^assets\/index-[\w-]+\.js$/.test(file));
assert(entryJs, 'index.html does not reference an assets/index-*.js entry; refs: ' + scripts.join(', '));
const bundlePath = join(webDist, entryJs);
const mapPath = bundlePath + '.map';
const map = JSON.parse(await readFile(mapPath, 'utf8'));
assert(Array.isArray(map.sources) && Array.isArray(map.sourcesContent) && map.sources.length === map.sourcesContent.length);
const toRepoPath = (mapFile, source, sourceRoot) => posix(relative(root, resolve(dirname(mapFile), (sourceRoot ?? '') + source)));
const entryRepoPaths = map.sources.map((source) => toRepoPath(mapPath, source, map.sourceRoot));
result.web = {
  indexHtmlRefs: scripts, bundle: 'apps/web/dist/' + entryJs, bundleSha256: digest(await readFile(bundlePath)), bundleBytes: (await stat(bundlePath)).size,
  mapFile: 'apps/web/dist/' + entryJs + '.map', mapSha256: digest(await readFile(mapPath)), mapSources: map.sources.length,
  indexHtmlSha256: digest(Buffer.from(indexHtml)),
};
result.web.servedBundlePath = '/app/' + entryJs;
const compareEntry = async (repoPath, index) => {
  const content = map.sourcesContent[index];
  const embedded = content === null || content === undefined ? null : digest(Buffer.from(content, 'utf8'));
  const raw = await rawSource(repoPath);
  const blob = blobSource(repoPath);
  return { mapIndex: index, mapSource: map.sources[index], embeddedSha256: embedded, rawWorktreeSha256: raw, gitHeadBlobSha256: blob, equal: embedded === raw && raw === blob };
};
result.sevenRuntimePaths = {};
for (const path of sevenPaths) {
  const matches = entryRepoPaths.flatMap((candidate, index) => (candidate === path ? [index] : []));
  if (matches.length !== 1) { fail('seven-path ' + path + ' appears ' + matches.length + ' times in the entry source map'); result.sevenRuntimePaths[path] = { occurrences: matches.length }; continue; }
  const row = await compareEntry(path, matches[0]);
  row.promotionMapSha256 = promotion.sources[path]?.sha256 ?? null;
  row.equalsPromotionMap = row.promotionMapSha256 === row.embeddedSha256;
  row.mappingTemplateSha256 = mapping.sourceHashes[path] ?? null;
  row.equalsMappingTemplate = row.mappingTemplateSha256 === row.embeddedSha256;
  result.sevenRuntimePaths[path] = row;
  if (!row.equal || !row.equalsPromotionMap || (row.mappingTemplateSha256 !== null && !row.equalsMappingTemplate)) fail('seven-path mismatch ' + path);
}
// The other eight notice sources and any of the 48 mapped paths embedded in this bundle.
result.noticeSources = {};
for (const path of mapping.noticeSourcePaths) {
  const matches = entryRepoPaths.flatMap((candidate, index) => (candidate === path ? [index] : []));
  if (matches.length === 0) { result.noticeSources[path] = { inEntryBundleMap: false, rawWorktreeSha256: await rawSource(path), mappingTemplateSha256: mapping.sourceHashes[path] }; continue; }
  const row = await compareEntry(path, matches[0]);
  row.inEntryBundleMap = true;
  row.mappingTemplateSha256 = mapping.sourceHashes[path] ?? null;
  row.equalsMappingTemplate = row.mappingTemplateSha256 === row.embeddedSha256;
  result.noticeSources[path] = row;
  if (!row.equal || !row.equalsMappingTemplate) fail('notice source mismatch ' + path);
}
result.promotionMapPathsInEntryBundle = {};
for (const path of Object.keys(promotion.sources)) {
  const index = entryRepoPaths.indexOf(path);
  if (index < 0) continue;
  const row = await compareEntry(path, index);
  row.promotionMapSha256 = promotion.sources[path].sha256;
  row.equalsPromotionMap = row.promotionMapSha256 === row.embeddedSha256;
  result.promotionMapPathsInEntryBundle[path] = row;
  if (!row.equal || !row.equalsPromotionMap) fail('promotion-map path embedded content mismatch ' + path);
}
result.promotionMapPathsNotInEntryBundle = Object.keys(promotion.sources).filter((path) => !(path in result.promotionMapPathsInEntryBundle)).sort();
// Every tracked source embedded in any web source map (dist and dist-goblin) equals the current source.
const listFiles = async (dir) => {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) found.push(...await listFiles(join(dir, entry.name)));
    else if (entry.isFile()) found.push(join(dir, entry.name));
  }
  return found;
};
const tracked = new Set(git('ls-files').split(/\r?\n/).filter(Boolean));
result.allWebMaps = {};
for (const tree of ['apps/web/dist', 'apps/web/dist-goblin']) {
  for (const file of (await listFiles(join(root, tree))).filter((name) => name.endsWith('.map'))) {
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    const counts = { sources: parsed.sources.length, trackedSources: 0, trackedEqual: 0, trackedMismatch: [], notTracked: 0, noEmbeddedContent: 0 };
    for (let index = 0; index < parsed.sources.length; index++) {
      const repoPath = toRepoPath(file, parsed.sources[index], parsed.sourceRoot);
      if (!tracked.has(repoPath)) { counts.notTracked++; continue; }
      counts.trackedSources++;
      const content = parsed.sourcesContent?.[index];
      if (content === null || content === undefined) { counts.noEmbeddedContent++; continue; }
      if (digest(Buffer.from(content, 'utf8')) === await rawSource(repoPath)) counts.trackedEqual++;
      else counts.trackedMismatch.push(repoPath);
    }
    result.allWebMaps[posix(relative(root, file))] = counts;
    if (counts.trackedMismatch.length > 0) fail('web map embeds tracked source that differs from the checkout: ' + posix(relative(root, file)) + ' ' + counts.trackedMismatch.join(','));
  }
}

// ---- 2. Backend tsbuildinfo cross-check
result.tsbuildinfo = {};
const buildInfoFiles = [];
for (const tree of ['apps/api/dist', 'apps/mcp/dist', 'apps/plugin-codex/dist', 'apps/plugin-claude/dist', 'packages/contracts/dist', 'packages/domain/dist', 'packages/engine/dist', 'packages/infrastructure/dist', 'packages/api-client/dist', 'packages/adapter-codex/dist', 'packages/adapter-jev/dist']) {
  for (const file of await listFiles(join(root, tree))) if (file.endsWith('.tsbuildinfo')) buildInfoFiles.push(file);
}
for (const file of buildInfoFiles.sort()) {
  const info = JSON.parse(await readFile(file, 'utf8'));
  const counts = { typescript: info.version, entries: info.fileNames.length, sourceEntries: 0, sourceEqual: 0, sourceMismatch: [], sourceMissing: [], dtsEntriesNotCompared: 0, external: 0, pendingEmit: Array.isArray(info.affectedFilesPendingEmit) ? info.affectedFilesPendingEmit.length : 0, hasErrors: Boolean(info.semanticDiagnosticsPerFile?.some?.((row) => Array.isArray(row))) };
  for (let index = 0; index < info.fileNames.length; index++) {
    const absolute = resolve(dirname(file), info.fileNames[index]);
    const repoPath = posix(relative(root, absolute));
    const version = typeof info.fileInfos[index] === 'string' ? info.fileInfos[index] : info.fileInfos[index].version;
    if (repoPath.startsWith('node_modules/') || repoPath.startsWith('..') || repoPath.includes('/node_modules/')) { counts.external++; continue; }
    let actual;
    try { actual = await rawSource(repoPath); } catch { counts.sourceMissing.push(repoPath); continue; }
    if (/\/dist\//.test('/' + repoPath)) {
      // TypeScript does not record declaration files of referenced projects as raw-byte SHA-256; counted, never compared.
      counts.dtsEntriesNotCompared++;
    } else {
      counts.sourceEntries++;
      if (actual === version) counts.sourceEqual++; else counts.sourceMismatch.push(repoPath);
    }
  }
  const key = posix(relative(root, file));
  result.tsbuildinfo[key] = counts;
  if (counts.sourceMismatch.length || counts.sourceMissing.length) fail('tsbuildinfo source hash differs from checkout: ' + key + ' ' + [...counts.sourceMismatch, ...counts.sourceMissing].join(','));
}

// ---- 3. API entry
const apiEntry = join(root, 'apps/api/dist/main.js');
result.api = { entry: 'apps/api/dist/main.js', entrySha256: digest(await readFile(apiEntry)), mapSha256: digest(await readFile(apiEntry + '.map')) };
const apiMap = JSON.parse(await readFile(apiEntry + '.map', 'utf8'));
result.api.mapSources = apiMap.sources.map((source) => toRepoPath(apiEntry + '.map', source, apiMap.sourceRoot));
result.api.mapPointsAtMainTs = result.api.mapSources.includes('apps/api/src/main.ts');
if (!result.api.mapPointsAtMainTs) fail('apps/api/dist/main.js.map does not point at apps/api/src/main.ts');
result.api.mainTsRawSha256 = await rawSource('apps/api/src/main.ts');
result.api.mainTsPromotionMapSha256 = promotion.sources['apps/api/src/main.ts']?.sha256 ?? null;
result.api.mainTsEqualsPromotionMap = result.api.mainTsRawSha256 === result.api.mainTsPromotionMapSha256;
if (!result.api.mainTsEqualsPromotionMap) fail('apps/api/src/main.ts differs from the promotion source map');

result.verdict = result.failures.length === 0 ? 'MATCH' : 'MISMATCH';
await writeFile(outputFile, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({
  phase, verdict: result.verdict, failures: result.failures, bundle: result.web.bundle, bundleSha256: result.web.bundleSha256, mapSha256: result.web.mapSha256,
  apiEntrySha256: result.api.entrySha256,
  sevenRuntimePaths: Object.fromEntries(Object.entries(result.sevenRuntimePaths).map(([path, row]) => [path, row.occurrences !== undefined ? 'occurrences=' + row.occurrences : row.equal && row.equalsPromotionMap])),
  promotionMapPathsEmbedded: Object.keys(result.promotionMapPathsInEntryBundle).length,
  tsbuildinfo: Object.fromEntries(Object.entries(result.tsbuildinfo).map(([key, row]) => [key, row.sourceEntries + ' source (' + row.sourceEqual + ' equal), ' + row.dtsEntriesNotCompared + ' d.ts not compared, pendingEmit ' + row.pendingEmit])),
}, null, 2));
process.exitCode = result.failures.length === 0 ? 0 : 1;
