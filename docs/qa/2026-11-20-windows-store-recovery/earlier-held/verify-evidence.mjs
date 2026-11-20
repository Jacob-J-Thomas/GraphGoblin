import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => fs.readFileSync(path.join(root, name));
const json = (name) => JSON.parse(read(name));
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const inventory = (dir, base = dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory()
      ? inventory(full, base)
      : [path.relative(base, full).replaceAll('\\', '/')];
  });
const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 1 && args[0] === '--integrity-only'));
const manifest = json('evidence-manifest.json');
assert.equal(manifest.base, '8181f350028e284529c76b51927f32890afcb68a');
assert.equal(manifest.source, '52bbab677117e8c7ded9953da1fa9c4bdba651dd');
assert.deepEqual(
  inventory(root)
    .filter((name) => name !== 'evidence-manifest.json')
    .sort(),
  manifest.files.map((entry) => entry.path).sort(),
);
for (const entry of manifest.files) {
  const full = path.resolve(root, entry.path);
  assert.ok(full.startsWith(root + path.sep));
  const bytes = fs.readFileSync(full);
  assert.equal(bytes.length, entry.bytes);
  assert.equal(sha256(bytes), entry.sha256);
}
const receipt = json('selection-receipt.json');
const allowlist = json('author/allowlist.original.json');
assert.equal(allowlist.candidateSha, manifest.source);
for (const selected of receipt.author.mapping) {
  const original = allowlist.publicationSafeOnly.find(
    (entry) => entry.file === selected.originalFile,
  );
  assert.ok(original);
  assert.equal(original.bytes, read(selected.publishedPath).length);
  assert.equal(original.sha256, sha256(read(selected.publishedPath)));
}
const author = json('author/public-outcomes.json');
for (const entry of receipt.author.coverageAddendum.files) {
  assert.equal(read(entry.publishedPath).length, entry.bytes);
  assert.equal(sha256(read(entry.publishedPath)), entry.sha256);
}
const coverage = json('author/coverage-addendum.json');
assert.equal(coverage.candidateSha, manifest.source);
assert.equal(coverage.tests.passed, 2117);
assert.equal(coverage.tests.skipped, 16);
assert.equal(coverage.packageCoverage.lines.pct, 95.44);
assert.equal(coverage.packageCoverage.branches.pct, 90.95);
assert.equal(author.candidateSha, manifest.source);
assert.equal(author.controlledBaseline.epermRefusals, 8);
assert.equal(author.controlledBaseline.epermSeededMarkerUnlinks, 4);
assert.equal(author.controlledBaseline.epermDirectoryRemovals, 4);
assert.equal(author.firstCandidate.sourceSha, '8d8311923cebe191fc68acc2a924fc2ffb38d31d');
assert.equal(author.firstCandidate.trials, 10);
assert.equal(author.finalCandidate.sourceSha, manifest.source);
assert.equal(author.finalCandidate.trials, 5);
assert.equal(author.finalCandidate.epermRefusals, 0);
assert.equal(
  author.finalCandidate.compiledModuleSha256,
  '446fcae990d1c1ed6f17929fbadc29a659aefeb7e1995ff4b7a85b2b42dab704',
);
assert.equal(author.focusedTests.baselineRed, 7);
assert.equal(author.focusedTests.finalGreen, 57);
assert.equal(author.focusedTests.evidenceRecorderGreen, 37);
assert.equal(author.fullCheck.result, 'failed');
assert.equal(author.fullNative.passed, 16);
assert.equal(author.fullNative.failedIncludingParents, 9);
assert.equal(author.toolingCoverage.testsPassed, 218);
assert.equal(author.toolingCoverage.testsFailed, 1);
assert.equal(author.toolingCoverage.coverageThresholdPassEstablished, false);
assert.ok(author.additionalStandaloneGates.results.every((entry) => entry.exitCode === 0));
const qa = json('independent/corrected/full-run-01.json');
assert.equal(qa.meta.targets.candidate.head, manifest.source);
assert.equal(qa.meta.targets.candidate.headMatches, true);
assert.equal(qa.meta.targets.candidate.trackedChanges, 0);
assert.equal(qa.summary.candidate.total, 649);
assert.equal(qa.summary.candidate.pass, 648);
assert.equal(qa.summary.candidate.fail, 1);
assert.ok(
  qa.assertions.some(
    (entry) =>
      entry.target === 'candidate' &&
      !entry.pass &&
      entry.phase === 'C-controlled-stale-unlink-barrier',
  ),
);
for (const [target, summary] of Object.entries(qa.summary)) {
  const assertions = qa.assertions.filter((entry) => entry.target === target);
  assert.equal(assertions.length, summary.total);
  assert.equal(assertions.filter((entry) => entry.pass).length, summary.pass);
  assert.equal(assertions.filter((entry) => !entry.pass).length, summary.fail);
}
let localLinks = 0;
for (const name of inventory(root).filter((entry) => entry.endsWith('.md'))) {
  for (const match of read(name)
    .toString('utf8')
    .matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const href = match[1].replace(/^<|>$/g, '');
    if (/^[a-z][a-z\d+.-]*:/i.test(href)) continue;
    assert.ok(
      fs.existsSync(path.resolve(root, path.dirname(name), decodeURIComponent(href.split('#')[0]))),
    );
    localLinks++;
  }
}
assert.equal(
  receipt.publicationReady,
  false,
  'This initial assembly has no terminal independent QA component',
);
const result = {
  result: receipt.assemblyStatus,
  integrity: 'pass',
  publicationReady: false,
  base: manifest.base,
  source: manifest.source,
  manifestSha256: sha256(read('evidence-manifest.json')),
  entriesVerified: manifest.files.length,
  localLinks,
  authorBaselineMarkerUnlinks: 4,
  authorBaselineDirectoryRemovals: 4,
  independentTerminalIncorporated: false,
  correctedCandidateHeld: true,
  rawIndependentAssertionsRecounted: qa.assertions.length,
  behaviorRerun: false,
};
console.log(JSON.stringify(result, null, 2));
if (!args.includes('--integrity-only')) process.exitCode = 2;
