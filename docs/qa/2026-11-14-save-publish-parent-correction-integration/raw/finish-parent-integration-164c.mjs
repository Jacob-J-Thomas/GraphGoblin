import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = 'C:/Users/98jak/.codex/worktrees/gg-20261114-save-publish/GraphGoblin';
const batch = 'C:/Users/98jak/graphgoblin-qa/2026-11-13-aidlc-batch';
const first = 'ea8eda378cf726a169aa32a24db11aa9a6eee8c5', second = '164c01a2e3a52bf0ef69a409e1a428b45817b1b8', oldParent = 'ae8add8a791699e905540465b5ddf929d00c50eb';
const git = (args, opts = {}) => execFileSync('git', ['-C', root, ...args], { maxBuffer: 100 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, ...opts });
const line = (...args) => git(args).toString().trim();
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
if (line('rev-parse', 'HEAD') !== first || line('rev-parse', 'MERGE_HEAD') !== second) throw new Error('Unexpected merge');
if (line('diff', '--name-only') || line('diff', '--name-only', '--diff-filter=U')) throw new Error('Uncommitted merge edits or conflicts');
git(['diff', '--cached', '--check']);
const own = JSON.parse(readFileSync(`${batch}/review-237/source-correction-freeze.json`, 'utf8')).files.filter(f => f.path.startsWith('apps/'));
const inherited = line('diff', '--name-only', oldParent, second, '--', 'apps', 'packages').split(/\r?\n/).filter(p => p && p !== 'apps/web/src/editor/store.ts').map(path => ({ path, sha256: sha(git(['show', `${second}:${path}`])) }));
const evidence = JSON.parse(readFileSync(`${batch}/review-273/correction-staged-verification.json`, 'utf8')).evidence;
const records = [...own, ...inherited, ...evidence];
function verify(ref) {
  const stream = git(['cat-file', '--batch'], { input: records.map(f => `${ref}:${f.path}\n`).join('') });
  let offset = 0;
  for (const file of records) {
    const eol = stream.indexOf(10, offset), match = /^[a-f0-9]+ blob (\d+)$/.exec(stream.subarray(offset, eol).toString());
    if (!match) throw new Error(`Invalid blob: ${file.path}`);
    const size = Number(match[1]), bytes = stream.subarray(eol + 1, eol + 1 + size);
    if (sha(bytes) !== file.sha256) throw new Error(`Changed integrated bytes: ${file.path}`);
    offset = eol + 1 + size + 1;
  }
  if (offset !== stream.length) throw new Error('Unexpected extra blob bytes');
}
verify('');
git(['commit', '-q', '-m', 'Merge node-reference corrections into publish recovery']);
const head = line('rev-parse', 'HEAD');
verify(head);
if (line('status', '--porcelain')) throw new Error('Integration not clean');
const result = { at: new Date().toISOString(), head, tree: line('rev-parse', 'HEAD^{tree}'), parents: [first, second], conflicts: [], unchangedChildCorrectionSource: own, unchangedParentCorrectionSource: inherited, inheritedEvidenceFiles: evidence.length, inheritedEvidenceBytes: evidence.reduce((n, f) => n + f.size, 0), combinedStore: { path: 'apps/web/src/editor/store.ts', sha256: sha(git(['show', `${head}:apps/web/src/editor/store.ts`])), rootObservation: 'Parent merge adds only RenameReport.definition and its assignment to the existing child store; exact staged delta read by root.' }, checks: { focusedFiles: 9, focusedTests: 122, focused: 'PASS', noEmitTypes: 'PASS', webLint: 'PASS', build: 'NOT RUN; original 1dcee compiled distributions retained' }, published: false, finalMainIntegration: 'Pending actual merge of PR474' };
writeFileSync(`${batch}/review-237/parent-integration-164c/identity.json`, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({head:result.head,tree:result.tree,parents:result.parents,childSource:own.length,parentSource:inherited.length,evidence:evidence.length,checks:result.checks}));
