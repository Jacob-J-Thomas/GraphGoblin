import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => fs.readFileSync(path.join(root, name));
const json = (name) => JSON.parse(read(name));
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const inventory = (dir, base = dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? inventory(path.join(dir, e.name), base)
        : [path.relative(base, path.join(dir, e.name)).replaceAll('\\', '/')],
    )
    .sort();
const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 1 && args[0] === '--integrity-only'));
const manifest = json('evidence-manifest.json');
const summary = json('case-summary.json');
const binding = json('source-binding.json');
assert.equal(manifest.base, '8181f350028e284529c76b51927f32890afcb68a');
assert.equal(manifest.source, 'e5e665fd83753af4e684a969083711883466ce55');
assert.equal(summary.source, manifest.source);
assert.equal(binding.source, manifest.source);
assert.equal(binding.parent, 'be78e222daaef8d2f03bed428d995873b5bc846c');
assert.deepEqual(binding.changedPaths, ['apps/api/src/subloop-restart.test.ts']);
assert.equal(binding.productionFilesChanged, false);
assert.equal(binding.test.gitBlob, '15f6f95297f9f9a5172399f114490608489680dc');
assert.equal(
  binding.test.sha256,
  '4c88d6c9f53248bc21ce68188d09243c279800f73970eb84e278585cc6191004',
);
assert.deepEqual(
  inventory(root).filter((p) => p !== 'evidence-manifest.json'),
  manifest.files.map((f) => f.path).sort(),
);
for (const f of manifest.files) {
  assert.ok(path.resolve(root, f.path).startsWith(root + path.sep));
  assert.equal(read(f.path).length, f.bytes, f.path);
  assert.equal(sha(read(f.path)), f.sha256, f.path);
}
assert.equal(summary.publicationReady, true);
assert.equal(summary.author.terminal.completed, true);
assert.equal(summary.author.terminal.source, manifest.source);
assert.equal(summary.author.terminal.allManifestHashesVerified, true);
assert.equal(summary.independent.terminal.completed, true);
assert.equal(summary.independent.terminal.source, manifest.source);
assert.equal(summary.independent.terminal.tree, binding.tree);
assert.equal(binding.independentSourceSha256, binding.test.sha256);
assert.equal(
  binding.independentBaselineSha256,
  '40b4128df3e33955ae39405d93852ffae21b8796e6a6be0b0415059f575d3633',
);
assert.equal(
  sha(read('independent/report.original.txt')),
  'b4d6668b6d05cc820dc7113a3e0081f159eee7d82d830a0381ecd80dac0f5303',
);
assert.equal(
  sha(read('independent/case-summary.original.json')),
  '5e916f11f9fb760f46bce24f88284c1831dca9d944e2a11c7d34e603d583852f',
);
const actual = json('independent/case-summary.original.json');
assert.equal(actual.candidate, manifest.source);
assert.equal(actual.candidateSourceSha256, binding.test.sha256);
assert.deepEqual(actual.genuineFindings, []);
assert.equal(actual.candidateOrdinary.passed, 3);
assert.deepEqual(actual.finalControlledCounts, {
  executed: 10,
  positivePasses: 4,
  expectedNegativeFailures: 6,
  unexpectedFailures: 0,
});
assert.equal(actual.finalControlledCases.filter((c) => c.status === 'passed').length, 4);
assert.equal(actual.finalControlledCases.filter((c) => c.status === 'failed').length, 6);
assert.equal(actual.cleanup.finalCases, 10);
assert.equal(actual.cleanup.allClosedStoppedDisposedRemoved, true);
assert.equal(actual.cleanup.remainingCandidatePrefixedFixtureDirectories, 0);
assert.equal(actual.durability.flatMap((c) => c.records).length, 6);
assert.equal(
  actual.durability.flatMap((c) => c.records).reduce((s, r) => s + r.events, 0),
  102,
);
for (const c of actual.durability) {
  assert.equal(c.equal, true);
  assert.equal(c.snapshotsCompared, 3);
}
assert.equal(
  actual.attemptLedger.find((a) => a.run === 'candidate-controls-first-attempt').failed,
  7,
);
assert.equal(actual.attemptLedger.find((a) => a.run === 'candidate-delay-corrected').passed, 2);
assert.equal(summary.historical.linux.wholeCi, 'failure');
assert.equal(summary.historical.linux.head, binding.parent);
assert.equal(summary.historical.linux.apiTest.failed, 1);
assert.equal(summary.historical.windows.teardownTimeout, true);
assert.equal(summary.historical.windows.ownedDisposableStoreLeft, true);
assert.equal(summary.independent.baseline.controlledDelay.failed, 1);
assert.equal(summary.independent.baseline.controlledDelay.cleanupHookTimedOutMs, 60000);
assert.match(summary.independent.baseline.controlledDelay.disposableFixtureRemoval, /retained/);
const controls = json('author-controls.json');
assert.equal(controls.source, manifest.source);
assert.equal(controls.verification.receipts.length, 48);
assert.equal(controls.verification.positive_test_exit, 0);
assert.equal(controls.verification.negative_test_exit, 1);
assert.equal(controls.verification.expected_negative_constructed_cases, 8);
let links = 0;
for (const file of inventory(root)) {
  const text = read(file).toString('utf8');
  const decoded = text.replaceAll('\\\\', '\\');
  assert.ok(!/(?:^|[^a-z])[a-z]:(?:\\|\/(?!\/))/im.test(decoded), 'absolute private path: ' + file);
  assert.ok(
    !/Bearer\s+[a-z0-9._-]{8,}|sk-(?:ant-)?[a-z0-9_-]{12,}/i.test(decoded),
    'credential-like value: ' + file,
  );
  if (file.endsWith('.md'))
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const link = match[1];
      if (/^(?:https?:|#)/.test(link)) continue;
      assert.ok(fs.existsSync(path.resolve(root, link.split('#')[0])), 'broken local link ' + link);
      links++;
    }
}
console.log(
  JSON.stringify(
    {
      result: args.includes('--integrity-only') ? 'integrity-pass' : 'pass',
      publicationReady: true,
      source: manifest.source,
      manifestSha256: sha(read('evidence-manifest.json')),
      files: manifest.files.length,
      bytes: manifest.files.reduce((s, f) => s + f.bytes, 0),
      localLinks: links,
      authorTerminal: 'complete',
      independentTerminal: 'complete',
      independentOrdinaryPass: 3,
      independentControlledPositive: 4,
      independentExpectedNegative: 6,
    },
    null,
    2,
  ),
);
process.exitCode = 0;
