// Read-only repository/evidence capture and sealing. No test runner or product imports.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const output = path.dirname(fileURLToPath(import.meta.url));
const checkout = 'G:/ggq/gg-i4-364-claude-start/GraphGoblin';
const q = 'C:/Users/98jak/graphgoblin-qa/2026-11-17-five-intents';
const author = path.join(q, 'i4-364-author-01');
const head = '99f1de7863dfc6a05b63a9140f7fc7a6833fcb20';
const tree = '911b2400b7622b5b04b58b3b03092d9ea90f55a3';
const base = '02351e2fb932b3be44e7cc3fb3943a61d568226c';
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: checkout, windowsHide: true });
const json = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n');
assert.equal(git('rev-parse', 'HEAD').toString().trim(), head);
assert.equal(git('rev-parse', 'HEAD^{tree}').toString().trim(), tree);
assert.equal(git('rev-list', '--parents', '-n', '1', 'HEAD').toString().trim(), `${head} ${base}`);
assert.equal(git('status', '--porcelain=v1').toString(), '');
if (process.argv.includes('--seal')) {
  const binding = JSON.parse(fs.readFileSync(path.join(output, 'source-binding.json')));
  for (const source of binding.currentSources) assert.equal(hash(fs.readFileSync(path.join(checkout, source.path))), source.sha256);
  const review = JSON.parse(fs.readFileSync(path.join(output, 'review.json')));
  assert.equal(review.verdict, 'APPROVE');
  assert.equal(review.findings.length, 0);
  json('raw/final-state.json', { at: new Date().toISOString(), head, tree, base, checkoutClean: true, reviewedSourceUnchanged: true, reviewerTestsRun: 0, verdict: review.verdict });
  const files = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (entry.name !== 'manifest.json') { const bytes = fs.readFileSync(target); files.push({ path: path.relative(output, target).replaceAll('\\', '/'), bytes: bytes.length, sha256: hash(bytes) }); }
    }
  }
  walk(output); files.sort((a, b) => a.path.localeCompare(b.path));
  json('manifest.json', { at: new Date().toISOString(), head, tree, base, files, excludes: ['manifest.json (self hash returned separately)'] });
  console.log(JSON.stringify({ verdict: review.verdict, introducedFindings: 0, artifacts: files.length, manifestSha256: hash(fs.readFileSync(path.join(output, 'manifest.json'))), reviewSha256: hash(fs.readFileSync(path.join(output, 'REVIEW.md'))), sourceBindingSha256: hash(fs.readFileSync(path.join(output, 'source-binding.json'))), reviewerTestsRun: 0, checkoutClean: true }, null, 2));
} else {
  assert.equal(fs.existsSync(path.join(output, 'source-binding.json')), false);
  const changed = git('diff', '--name-only', base, head).toString().trim().split('\n');
  assert.equal(changed.length, 10);
  const neighbors = ['AGENTS.md', 'docs/README.md', 'docs/12-implementation-plan.md', 'docs/15-issue-workflow.md', 'docs/delivery/2026-11-17-five-intents-register.md', 'packages/infrastructure/src/claude/errors.ts', 'packages/infrastructure/src/claude/policy.ts', 'packages/infrastructure/src/claude/queue.ts', 'packages/infrastructure/src/process/scripts.ts', 'packages/engine/src/handlers/inference-failure.ts'];
  const currentSources = [];
  for (const relative of [...new Set([...changed, ...neighbors])]) {
    const bytes = fs.readFileSync(path.join(checkout, relative));
    const target = path.join(output, 'sources/current', relative);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes);
    currentSources.push({ path: relative, bytes: bytes.length, sha256: hash(bytes), gitBlob: git('rev-parse', `${head}:${relative}`).toString().trim(), changed: changed.includes(relative) });
  }
  const baseSources = [];
  for (const relative of ['packages/infrastructure/src/claude/process.ts', 'packages/infrastructure/src/claude/harness.ts', 'docs/guide/07-troubleshooting.md']) {
    const bytes = git('show', `${base}:${relative}`);
    const target = path.join(output, 'sources/base', relative);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes);
    baseSources.push({ path: relative, sha256: hash(bytes), gitBlob: git('rev-parse', `${base}:${relative}`).toString().trim(), provenance: 'Exact raw bytes read with git show; no checkout edit.' });
  }
  fs.writeFileSync(path.join(output, 'raw/reviewed.patch'), git('diff', '--binary', base, head));
  const inputs = [
    ['decision-176.md', path.join(q, 'decision-176.md')],
    ['issue-364-admission.json', path.join(q, 'i4-postmerge-admission-01/connector/364-issue.json')],
    ...['BRIEF.md', 'REPORT.md', 'evidence-manifest.json', 'provider/provider-final-message.md', 'evidence/native-spawn-probe.json', 'evidence/native-spawn-probe-attempt1-crash.stderr.txt', 'scripts/native-spawn-probe.mjs', 'evidence/baseline-unmodified-verbose.log', 'evidence/existing-tests-after-prod-change.log', 'evidence/native-start-refusal-run1.log', 'evidence/final-focused-checks-2.log', 'evidence/claude-coverage-1.log', 'evidence/infrastructure-coverage-1.log', 'evidence/env-failures-no-redirect.log', 'evidence/typecheck-lint-1.log', 'evidence/layers-deps.log', 'evidence/mutations/summary.json', 'evidence/mutations/summary-M8-output-failure-below-refusal.json', 'evidence/mutations/M1-no-stdio-error-handlers.log', 'evidence/mutations/M8-output-failure-below-refusal.log'].map((relative) => [`author/${relative}`, path.join(author, relative)]),
  ];
  const capturedInputs = [];
  for (const [relative, source] of inputs) {
    const bytes = fs.readFileSync(source); const target = path.join(output, 'inputs', relative);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes);
    capturedInputs.push({ path: relative, originalPath: source, bytes: bytes.length, sha256: hash(bytes) });
  }
  const authorManifest = JSON.parse(fs.readFileSync(path.join(author, 'evidence-manifest.json')));
  const authorArtifactChecks = authorManifest.files.map((entry) => ({ path: entry.path, matches: hash(fs.readFileSync(path.join(author, entry.path))) === entry.sha256 }));
  json('raw/author-manifest-readback.json', { declaredCommitted: authorManifest.committed, note: 'Author handoff preceded coordinator commit; current frozen Git head is independently bound.', entries: authorArtifactChecks });
  json('source-binding.json', { at: new Date().toISOString(), review: '#364 formal opposite-family review 1', reviewerRole: 'Independent GPT reviewer; not author or independent behavior QA for #364', checkout, branch: git('branch', '--show-current').toString().trim(), head, tree, soleParent: base, clean: true, reviewerTestsRun: 0, readerNode: process.version, currentSources, baseSources, capturedInputs, patchSha256: hash(fs.readFileSync(path.join(output, 'raw/reviewed.patch'))) });
  console.log(JSON.stringify({ head, tree, base, changedFiles: changed.length, sourceFilesBound: currentSources.length, inputsCaptured: capturedInputs.length, authorManifestChecked: authorArtifactChecks.length, authorManifestMismatches: authorArtifactChecks.filter((item) => !item.matches), reviewerTestsRun: 0, clean: true }, null, 2));
}
