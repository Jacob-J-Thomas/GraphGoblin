// Read-only admission recheck for the #273 promotion verification.
// Usage: node admission.mjs <checkout> <output-dir>
// Git is run with GIT_OPTIONAL_LOCKS=0 by the caller; this script never writes inside the checkout.
// It references the schema of node-reference-273-promotion-independent/promotion-source-map.json
// (sources: { path: { sha256, equalsPreviousCandidate, equalsPriorNative } }) rather than assuming a
// source-paths.json exists, and recomputes raw working-tree and Git-blob hashes for every mapped path.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = await realpath(process.argv[2]);
const out = process.argv[3];
const batch = 'C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch';
const expected = {
  head: 'ae8add8a791699e905540465b5ddf929d00c50eb',
  tree: 'ea2dfcfd46f7d5ab79fd98414db214513d830b52',
  base: 'a817e5ccb4fd598ca56089b97b4ce55e9cb6f58c',
  freeze: '16aa9a2aed50710e68875b991a8eedb668fdecf8',
  freezeTree: '863175d2c21d09800b8e41416f76abdf9d59cf1b',
  previous: '33a2f47cfdcc5ad76723f4e7c6841babfcfd1fb6',
};
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const gitBytes = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
const git = (...args) => gitBytes(...args).toString('utf8').replace(/\r?\n$/, '');
const lines = (text) => text.split(/\r?\n/).filter(Boolean);
const report = { observedAt: new Date().toISOString(), checks: {}, failures: [] };
const check = (name, ok, detail) => {
  report.checks[name] = { ok: Boolean(ok), ...(detail === undefined ? {} : { detail }) };
  if (!ok) report.failures.push(name);
};

// 1. Slot grant and admission proof are mutually consistent with the brief.
const grant = JSON.parse(await readFile(join(batch, 'ui-273-promotion-verification-slot-grant.json'), 'utf8'));
const admission = JSON.parse(await readFile(join(batch, 'ui-273-promotion-verification-admission.json'), 'utf8'));
check('grant.granted', grant.granted === true);
check('grant.head/tree/base match brief', grant.head === expected.head && grant.tree === expected.tree && grant.base === expected.base);
check('admission.head/tree/base/freeze match brief',
  admission.head === expected.head && admission.tree === expected.tree && admission.base === expected.base &&
  admission.productSourceFreeze === expected.freeze);
check('admission.productDeltaAfterFreeze is empty', Array.isArray(admission.productDeltaAfterFreeze) && admission.productDeltaAfterFreeze.length === 0);

// 2. Checkout identity.
const head = git('rev-parse', 'HEAD');
const tree = git('rev-parse', 'HEAD^{tree}');
check('HEAD equals expected', head === expected.head, head);
check('HEAD tree equals expected', tree === expected.tree, tree);
const branch = git('branch', '--show-current');
const originMain = git('rev-parse', 'origin/main');
check('origin/main still equals target', originMain === expected.base, originMain);
const baseIsAncestor = (() => { try { execFileSync('git', ['merge-base', '--is-ancestor', expected.base, 'HEAD'], { cwd: root }); return true; } catch { return false; } })();
check('target a817 is an ancestor of HEAD', baseIsAncestor);
const freezeIsAncestor = (() => { try { execFileSync('git', ['merge-base', '--is-ancestor', expected.freeze, 'HEAD'], { cwd: root }); return true; } catch { return false; } })();
check('freeze 16aa is an ancestor of HEAD', freezeIsAncestor);
check('freeze tree equals prepared source-map tree', git('rev-parse', expected.freeze + '^{tree}') === expected.freezeTree);
const freezeParents = git('show', '-s', '--format=%P', expected.freeze).split(' ');
check('16aa parents are 33a2 and a817 (merge of main into the candidate)', freezeParents[0] === expected.previous && freezeParents[1] === expected.base, freezeParents.join(' '));
const status = git('status', '--porcelain=v1', '--untracked-files=all');
check('worktree and index clean (porcelain empty, untracked included)', status === '', status);
const hiddenFlags = lines(git('ls-files', '-v')).filter((line) => !line.startsWith('H '));
check('no skip-worktree / assume-unchanged / other hidden-state index entries', hiddenFlags.length === 0, hiddenFlags.slice(0, 5));
check('no merge/rebase/cherry-pick state', ['MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'].every((ref) => {
  try { execFileSync('git', ['rev-parse', '--verify', '--quiet', ref], { cwd: root, stdio: 'ignore' }); return false; } catch { return true; }
}));

// 3. Commits and delta after the product freeze.
const commits = lines(git('log', '--format=%H %P %s', expected.freeze + '..HEAD'));
const nameStatus = lines(git('diff', '--name-status', '-M', expected.freeze, 'HEAD'));
const changed = lines(git('diff', '--name-only', expected.freeze, 'HEAD'));
const outsideDocs = changed.filter((file) => !/^docs\/(?:qa|delivery)\//.test(file));
const renames = nameStatus.filter((row) => row.startsWith('R')).map((row) => row.split('\t'));
check('commits after freeze are exactly two', commits.length === 2, commits);
check('every changed path after 16aa is under docs/qa or docs/delivery', outsideDocs.length === 0, outsideDocs);
check('no changed path under apps/ packages/ tooling/ or any root file', changed.every((file) => /^docs\//.test(file)));
const rootEntries = (ref) => Object.fromEntries(lines(git('ls-tree', ref)).map((row) => { const [meta, name] = row.split('\t'); return [name, meta.split(' ')[2]]; }));
const rootAtFreeze = rootEntries(expected.freeze);
const rootAtHead = rootEntries('HEAD');
const differingRoot = [...new Set([...Object.keys(rootAtFreeze), ...Object.keys(rootAtHead)])].filter((name) => rootAtFreeze[name] !== rootAtHead[name]).sort();
check('only the docs root entry differs between 16aa and HEAD (apps, packages, tooling, configs, lockfile identical Git objects)',
  differingRoot.length === 1 && differingRoot[0] === 'docs', differingRoot);
report.rootEntryObjectIds = Object.fromEntries(['apps', 'packages', 'tooling', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'turbo.json', 'tsconfig.json', 'tsconfig.build.json', '.prettierignore', '.gitattributes', '.github', 'CHANGELOG.md']
  .filter((name) => rootAtHead[name] || rootAtFreeze[name]).map((name) => [name, { at16aa: rootAtFreeze[name] ?? null, atHead: rootAtHead[name] ?? null, equal: rootAtFreeze[name] === rootAtHead[name] }]));
check('docs sub-entries that differ are only qa and delivery', (() => {
  const docsAtFreeze = Object.fromEntries(lines(git('ls-tree', expected.freeze + ':docs')).map((row) => { const [meta, name] = row.split('\t'); return [name, meta.split(' ')[2]]; }));
  const docsAtHead = Object.fromEntries(lines(git('ls-tree', 'HEAD:docs')).map((row) => { const [meta, name] = row.split('\t'); return [name, meta.split(' ')[2]]; }));
  const differing = [...new Set([...Object.keys(docsAtFreeze), ...Object.keys(docsAtHead)])].filter((name) => docsAtFreeze[name] !== docsAtHead[name]).sort();
  report.docsEntriesDiffering = differing;
  return differing.every((name) => name === 'qa' || name === 'delivery');
})());
check('exactly two renames, both R100 to .md.txt (contents unchanged)',
  renames.length === 2 && renames.every(([status, from, to]) => status === 'R100' && to === from + '.txt' && from.endsWith('.md')),
  renames);
const renameBlobs = renames.map(([, from, to]) => ({ from, to, blobAt16aa: git('rev-parse', expected.freeze + ':' + from), blobAtHead: git('rev-parse', 'HEAD:' + to) }));
check('renamed blobs byte-identical (same Git object id)', renameBlobs.every((row) => row.blobAt16aa === row.blobAtHead), renameBlobs);
report.commitsAfterFreeze = commits;
report.nameStatusSummary = nameStatus.reduce((acc, row) => { const key = row.split('\t')[0]; acc[key] = (acc[key] ?? 0) + 1; return acc; }, {});
report.changedAfterFreeze = changed;

// 4. 48-path independent source map: recompute raw working-tree and Git-blob hashes.
const map = JSON.parse(await readFile(join(batch, 'node-reference-273-promotion-independent', 'promotion-source-map.json'), 'utf8'));
check('source map head/tree/base are the 16aa freeze', map.head === expected.freeze && map.tree === expected.freezeTree && map.base === expected.base);
const mapped = Object.keys(map.sources).sort();
check('source map captures 48 paths', mapped.length === 48, mapped.length);
const sources = {};
let mismatches = 0;
for (const file of mapped) {
  const rawBytes = await readFile(join(root, file));
  const raw = digest(rawBytes);
  const headBlob = digest(gitBytes('show', 'HEAD:' + file));
  const freezeBlob = digest(gitBytes('show', expected.freeze + ':' + file));
  const entry = {
    mapSha256: map.sources[file].sha256, rawWorktreeSha256: raw, gitHeadBlobSha256: headBlob, git16aaBlobSha256: freezeBlob,
    headBlobId: git('rev-parse', 'HEAD:' + file), lstree: git('ls-tree', 'HEAD', '--', file).split('\t')[0],
    rawEqualsGitHead: raw === headBlob, headEquals16aa: headBlob === freezeBlob, equalsMap: raw === map.sources[file].sha256 && headBlob === map.sources[file].sha256,
    mapEqualsPreviousCandidate: map.sources[file].equalsPreviousCandidate, mapEqualsPriorNative: map.sources[file].equalsPriorNative,
    bytes: rawBytes.length,
  };
  if (!entry.rawEqualsGitHead || !entry.headEquals16aa || !entry.equalsMap) mismatches++;
  sources[file] = entry;
}
check('all 48 mapped paths: raw worktree == HEAD blob == 16aa blob == map sha256', mismatches === 0, { mismatches });
report.sources = sources;
const productDiff = lines(git('diff', '--name-only', expected.freeze, 'HEAD', '--', ...mapped));
check('git diff 16aa..HEAD over the 48 mapped paths is empty', productDiff.length === 0, productDiff);
const productFamilies = lines(git('diff', '--name-only', expected.freeze, 'HEAD', '--', 'apps', 'packages', 'tooling'));
check('git diff 16aa..HEAD over apps/ packages/ tooling/ is empty', productFamilies.length === 0, productFamilies);

// 5. Admission proof hashes (24 changed-by-rename paths) against recomputed values.
let admissionMismatches = [];
for (const [file, hash] of Object.entries(admission.sourceHashes)) {
  const actual = digest(await readFile(join(root, file)));
  if (actual !== hash || sources[file]?.rawWorktreeSha256 !== hash) admissionMismatches.push(file);
}
check('admission sourceHashes (24) equal recomputed raw hashes and are inside the 48-path map',
  admissionMismatches.length === 0 && Object.keys(admission.sourceHashes).length === 24 &&
  JSON.stringify(Object.keys(admission.sourceHashes).sort()) === JSON.stringify([...admission.changedProductPaths].sort()) &&
  JSON.stringify([...map.changedByRename].sort()) === JSON.stringify([...admission.changedProductPaths].sort()), admissionMismatches);

report.identity = { head, tree, branch, originMain, base: expected.base, status };
report.verdict = report.failures.length === 0 ? 'ADMITTED' : 'NOT ADMITTED';
await writeFile(join(out, 'manifests', 'admission-recheck.json'), JSON.stringify(report, null, 2) + '\n');
await writeFile(join(out, 'manifests', 'source-sha256.txt'), mapped.map((file) => sources[file].rawWorktreeSha256 + ' *' + file).join('\n') + '\n');
console.log(JSON.stringify({ verdict: report.verdict, failures: report.failures, checks: Object.fromEntries(Object.entries(report.checks).map(([k, v]) => [k, v.ok])) }, null, 2));
process.exitCode = report.failures.length === 0 ? 0 : 1;
