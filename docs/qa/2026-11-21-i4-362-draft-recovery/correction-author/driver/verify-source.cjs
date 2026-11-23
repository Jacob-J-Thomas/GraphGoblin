'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const evidence = path.dirname(__dirname);
const repo = process.cwd();
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const read = (name) => fs.readFileSync(path.join(repo, name), 'utf8');
const normalize = (text) => text.replace(/\r\n/g, '\n');
const binding = JSON.parse(fs.readFileSync(path.join(evidence, 'originals/bindings.json'), 'utf8'));
assert.equal(cp.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), binding.head);
const selected = [
  { path: 'docs/04-node-catalog.md', prefixes: ['Commands use `shell: false`.'] },
  { path: 'docs/guide/03-run-and-observe.md', prefixes: ['Editing the loop does not change', '`SCRIPT_START_FAILED` means', 'Read `code`, `message`,'] },
  { path: 'docs/guide/07-troubleshooting.md', prefixes: ['For `SCRIPT_OUTCOME_UNCERTAIN`,', 'To run a batch file, explicitly choose'] },
];
const changes = [];
const links = [];
for (const document of selected) {
  const original = normalize(fs.readFileSync(path.join(evidence, 'originals', path.basename(document.path)), 'utf8'));
  const current = normalize(read(document.path));
  const originalBlocks = original.split('\n\n');
  const currentBlocks = current.split('\n\n');
  const isSelected = (block) => document.prefixes.some((prefix) => block.startsWith(prefix));
  assert.equal(originalBlocks.filter(isSelected).length, document.prefixes.length);
  assert.equal(currentBlocks.filter(isSelected).length, document.prefixes.length);
  assert.equal(originalBlocks.filter((block) => !isSelected(block)).join('\n\n'), currentBlocks.filter((block) => !isSelected(block)).join('\n\n'), 'Unselected content changed: ' + document.path);
  for (const prefix of document.prefixes) {
    const block = currentBlocks.find((item) => item.startsWith(prefix));
    const prose = block.replace(/\s+/g, ' ');
    assert(prose.includes('fresh run from the corrected definition'));
    assert(/(?:UI[\s\S]*published|published[\s\S]*UI)/.test(block));
    assert(prose.includes('editable draft\'s `versionId`'));
    assert(prose.includes('`allowDraft: true`'));
    assert(!prose.includes('publish the corrected definition and start a fresh run'));
    assert(!prose.includes('Publish and start a new run when the correction changes'));
    const line = current.slice(0, current.indexOf(block)).split('\n').length;
    changes.push({ path: document.path, line, prefix, text: block });
    for (const match of block.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const [file, anchor] = match[1].split('#');
      const target = path.resolve(path.dirname(path.join(repo, document.path)), file || path.basename(document.path));
      assert(fs.existsSync(target), 'Missing link target ' + target);
      const headings = fs.readFileSync(target, 'utf8').split(/\r?\n/).filter((item) => /^#+ /.test(item));
      const slugs = headings.map((heading) => heading.replace(/^#+ /, '').toLowerCase().replace(/[^\p{L}\p{N}_\-\s]/gu, '').replace(/\s/g, '-'));
      if (anchor) assert(slugs.includes(anchor), 'Missing anchor ' + match[1]);
      links.push({ source: document.path, target: match[1], exists: true, anchorVerified: Boolean(anchor) });
    }
  }
}
const protectedBindings = binding.bindings.filter((item) => !selected.some((document) => document.path === item.path));
for (const item of protectedBindings) assert.equal(sha(fs.readFileSync(path.join(repo, item.path))), item.sha256, item.path);
const traces = [
  { claim: 'Public API accepts editable draft versionId and allowDraft and forwards both to startRun.', path: 'apps/api/src/routes/runs.ts', start: 72, end: 123, includes: ['versionId: z.string().optional()', 'allowDraft: z.boolean().optional()', 'body.allowDraft ? { allowDraft: true }'] },
  { claim: 'Draft start freezes the exact validated draft into a separate snapshot.', path: 'packages/engine/src/run-manager.ts', start: 657, end: 730, includes: ["source.status === 'draft' ? freezeDraft(source", 'const version = snapshot ?? source'] },
  { claim: 'Version selection accepts explicit editable drafts only with allowDraft; snapshots cannot be started directly.', path: 'packages/engine/src/run-manager.ts', start: 3362, end: 3384, includes: ['input.versionId', "version.status === 'snapshot'", "version.status !== 'published' && !input.allowDraft"] },
  { claim: 'Replay reuses source versionId and pinned metadata.', path: 'packages/engine/src/run-manager.ts', start: 1782, end: 1824, includes: ['versionId: source.versionId', 'pinned: source.pinned'] },
  { claim: 'Recovery reads the existing run version.', path: 'packages/engine/src/run-manager.ts', start: 1213, end: 1221, includes: ['getVersion(before.versionId)'] },
  { claim: 'UI New run lists published versions and submits their versionId.', path: 'apps/web/src/runs/new/RunLauncher.tsx', start: 14, end: 97, includes: ['versionId: version.id', ".filter((v) => v.status === 'published')"] },
  { claim: 'Publishing invokes trigger arming.', path: 'apps/api/src/routes/loops.ts', start: 363, end: 394, includes: ['await loops.publish(', 'await container.triggers.armVersion(loop, version)'] },
  { claim: 'Trigger arming replaces schedule and webhook registrations for the new version.', path: 'apps/api/src/triggers/trigger-service.ts', start: 210, end: 255, includes: ['rows of earlier versions disabled', 'schedules.replaceForVersion', 'endpoints.replaceForVersion'] },
  { claim: 'Published trigger contract explicitly describes disabling prior registrations.', path: 'docs/08-triggers-and-integrations.md', start: 29, end: 37, includes: ['Rows of earlier versions of the loop are disabled'] },
  { claim: 'Existing unmodified criterion observes old output from the original draft snapshot and new output from a fresh draft start.', path: 'packages/engine/src/definition-pin.test.ts', start: 103, end: 149, includes: ["result: 'old'", 'versionId: draft.id, allowDraft: true', ".result).toBe('new')"] },
];
for (const trace of traces) {
  const source = read(trace.path);
  const lines = source.split(/\r?\n/);
  const excerpt = lines.slice(trace.start - 1, trace.end).join('\n');
  for (const required of trace.includes) assert(excerpt.includes(required), trace.path + ': ' + required);
  trace.sourceSha256 = sha(fs.readFileSync(path.join(repo, trace.path)));
  trace.excerpt = excerpt;
  const copyPath = path.join(evidence, 'source', trace.path);
  fs.mkdirSync(path.dirname(copyPath), { recursive: true });
  if (!fs.existsSync(copyPath)) fs.copyFileSync(path.join(repo, trace.path), copyPath);
}
const docs = selected.map((item) => ({ path: item.path, originalSha256: binding.bindings.find((old) => old.path === item.path).sha256, finalSha256: sha(fs.readFileSync(path.join(repo, item.path))), gitBlob: cp.execFileSync('git', ['hash-object', '--', item.path], { encoding: 'utf8' }).trim() }));
const changedPaths = cp.execFileSync('git', ['diff', '--name-only'], { encoding: 'utf8' }).trim().split(/\r?\n/);
assert.deepEqual(changedPaths.slice().sort(), selected.map((item) => item.path).sort());
cp.execFileSync('git', ['diff', '--cached', '--quiet']);
const reportHash = sha(fs.readFileSync(path.join(evidence, 'originals/scan3-REPORT.md')));
assert.equal(reportHash, '11ea4ff863fc923388d0d19c26e3d7e4bed8d1e0a5a877626c80b6dbe30710f5');
const result = { head: binding.head, docBindings: docs, changedParagraphs: changes, checkedLinks: links, protectedSourceHashes: protectedBindings, traces, sealedReportSha256: reportHash, originalParagraphsOutsideSelectedBlocksUnchanged: true, indexUnchanged: true, authorChecksOnly: true, criterionTestExecuted: false };
fs.writeFileSync(path.join(evidence, 'observations/source-checks.json'), JSON.stringify(result, null, 2) + '\n');
process.stdout.write(JSON.stringify({ docs, changedParagraphs: changes.length, checkedLinks: links.length, protectedSourceHashes: protectedBindings.length, sourceTraces: traces.length, originalParagraphsOutsideSelectedBlocksUnchanged: true, indexUnchanged: true, sealedReportSha256: reportHash, authorChecksOnly: true, criterionTestExecuted: false }, null, 2) + '\n');
