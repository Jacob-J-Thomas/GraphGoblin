import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(root, p));
const json = (p) => JSON.parse(read(p));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
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
const manifest = json('evidence-manifest.json'),
  layout = json('layout.json');
assert.equal(manifest.base, '8181f350028e284529c76b51927f32890afcb68a');
assert.equal(manifest.source, 'dc65a245a3c21a8dec6b975d9d1d2d63f8a59eaa');
assert.equal(layout.publicationReady, true);
assert.equal(layout.finalIndependent.terminalExit, 0);
assert.equal(layout.finalIndependent.source, manifest.source);
assert.deepEqual(
  inventory(root).filter((p) => p !== 'evidence-manifest.json'),
  manifest.files.map((f) => f.path).sort(),
);
for (const f of manifest.files) {
  assert.ok(path.resolve(root, f.path).startsWith(root + path.sep));
  assert.equal(read(f.path).length, f.bytes);
  assert.equal(sha(read(f.path)), f.sha256);
}
const components = [];
for (const c of layout.children) {
  assert.equal(sha(read(c.folder + '/evidence-manifest.json')), c.manifestSha256);
  const runner = path.join(root, c.folder, 'verify-evidence.mjs');
  const integrity = JSON.parse(
    execFileSync(process.execPath, [runner, '--integrity-only'], { stdio: 'pipe' }),
  );
  assert.equal(integrity.publicationReady, false);
  let held;
  try {
    execFileSync(process.execPath, [runner], { stdio: 'pipe' });
    assert.fail('historical default must remain held');
  } catch (e) {
    assert.equal(e.status, 2);
    held = JSON.parse(e.stdout);
  }
  assert.equal(held.publicationReady, false);
  components.push({
    folder: c.folder,
    manifestSha256: c.manifestSha256,
    integrityOnlyExit: 0,
    defaultExit: 2,
    source: c.source,
  });
}
const final = json('final-independent/receipt.json');
assert.equal(final.source, manifest.source);
assert.equal(
  final.genuineTerminal.original.sha256,
  'f953a0c525a0495d487267c732cdfe6420dd72f07d8fbfc2cc30b1695ae8bf6b',
);
assert.equal(final.genuineTerminal.process.code, 0);
assert.equal(final.genuineTerminal.is_error, false);
assert.equal(final.genuineTerminal.messageMatchesProviderResult, true);
let finalAssertions = 0;
for (const [i, selected] of final.projections.entries()) {
  const data = json('final-independent/' + selected.path);
  assert.equal(data.original.sha256, selected.original.sha256);
  const assertions = data.scenarios.flatMap((s) => s.assertions);
  const tally = (list) => ({
    total: list.length,
    pass: list.filter((a) => a.outcome === 'pass').length,
    fail: list.filter((a) => a.outcome === 'fail').length,
    notRun: list.filter((a) => !['pass', 'fail'].includes(a.outcome)).length,
  });
  assert.deepEqual(tally(assertions), selected.totals);
  assert.deepEqual(tally(assertions), data.totals.all);
  for (const kind of Object.keys(data.totals.byKind))
    assert.deepEqual(tally(assertions.filter((a) => a.kind === kind)), data.totals.byKind[kind]);
  for (const prov of [data.provenanceBefore, data.provenanceAfter]) {
    assert.equal(prov.head, manifest.source);
    assert.equal(prov.headMatches, true);
    assert.deepEqual(prov.statusLines, []);
  }
  if (i === 0) {
    assert.equal(data.totals.all.fail, 12);
    assert.ok(assertions.filter((a) => a.outcome === 'fail').every((a) => a.id.startsWith('C1b.')));
  } else assert.deepEqual(data.totals.all, { total: 22, pass: 22, fail: 0, notRun: 0 });
  finalAssertions += assertions.length;
}
assert.equal(finalAssertions, 296);
assert.equal(final.countReconciliation.identifiedFailedAssertions, 14);
assert.equal(final.countReconciliation.unassignedClaimedFifteenth, 1);
const drivers = final.drivers;
assert.equal(
  sha(read('final-independent/' + drivers.current.path)),
  drivers.current.original.sha256,
);
assert.equal(
  sha(zlib.gunzipSync(read('final-independent/' + drivers.initial.path))),
  drivers.initial.original.sha256,
);
for (const d of [...drivers.helpers, ...drivers.sharedOperatorDrivers])
  assert.equal(sha(read('final-independent/' + d.path)), d.original.sha256);
const scoped = json('final-independent/test-and-physical-receipts.json');
assert.deepEqual(
  scoped.tests.map((t) => [t.passed, t.failed, t.skipped]),
  [
    [11, 0, 0],
    [205, 0, 2],
  ],
);
for (const c of scoped.physicalComparisons) {
  assert.equal(c.checkout.entriesBefore, 3233);
  assert.equal(c.checkout.entriesAfter, 3233);
  assert.deepEqual(c.checkout.changed, []);
}
let localLinks = 0;
for (const file of inventory(root).filter((p) => p.endsWith('.md')))
  for (const m of read(file)
    .toString()
    .matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const href = m[1].replace(/^<|>$/g, '');
    if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('#')) continue;
    const resolved = path.resolve(root, path.dirname(file), decodeURIComponent(href.split('#')[0]));
    assert.ok(resolved.startsWith(root + path.sep));
    assert.ok(fs.existsSync(resolved), 'broken link ' + file + ': ' + href);
    localLinks++;
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
      components,
      localLinks,
      finalIndependentTerminal: 'complete',
      finalControlsAssertions: finalAssertions,
      originalFailedAssertionsRetained: 14,
      unresolvedNarrativeCount: 1,
      productOrQaExecution: false,
    },
    null,
    2,
  ),
);
process.exitCode = 0;
