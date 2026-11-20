import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Integrity and retained observations only. No application, driver, test or Git execution.
const root = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => fs.readFileSync(path.join(root, name));
const json = (name) => JSON.parse(read(name));
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const inventory = (dir, base = dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(dir, entry.name);
    return entry.isDirectory()
      ? inventory(target, base)
      : [path.relative(base, target).replaceAll('\\', '/')];
  });
const verifyManifest = (name) => {
  const absolute = path.join(root, name);
  const base = path.dirname(absolute);
  const manifest = json(name);
  const entries = manifest.files ?? manifest.entries;
  for (const entry of entries) {
    const target = path.resolve(base, entry.path);
    assert.ok(target.startsWith(base + path.sep), `${name}: scoped path`);
    const bytes = fs.readFileSync(target);
    assert.equal(bytes.length, entry.bytes, `${name}: ${entry.path}: bytes`);
    assert.equal(sha256(bytes), entry.sha256, `${name}: ${entry.path}: SHA-256`);
  }
  assert.deepEqual(
    inventory(base)
      .filter((p) => p !== path.basename(name))
      .sort(),
    entries.map((entry) => entry.path).sort(),
    `${name}: complete inventory`,
  );
  return { manifest: name, entriesVerified: entries.length, sha256: sha256(read(name)) };
};
const umbrella = json('publication-manifest.json');
const seals = [];
for (const [name, hash] of Object.entries(umbrella.componentSeals)) {
  assert.equal(sha256(read(name)), hash, `${name}: component seal`);
  seals.push(verifyManifest(name));
}
assert.equal(
  sha256(read('baseline/publication-manifest.json')),
  '9f977008294d066bd29a7f56e735b69c96924559f9905a24a3eee9a72e95f443',
);
seals.push(verifyManifest('publication-manifest.json'));
const source = json('source-receipt.json');
assert.deepEqual(source.cumulativePaths, Object.keys(source.finalFilesSha256).sort());
assert.equal(source.nonTriviaTypeScriptTokensIdentical, true);
const assets = json(source.servedAssetReceipt);
assert.equal(assets.qaSource, source.firstQASource);
assert.equal(assets.finalSource, source.finalSource);
assert.deepEqual(
  Object.keys(assets.qaAssetDigests).sort(),
  Object.keys(assets.finalAssetDigests).sort(),
);
const nonMap = Object.keys(assets.qaAssetDigests).filter((name) => !name.endsWith('.map'));
assert.equal(nonMap.length, 25);
assert.ok(nonMap.every((name) => assets.qaAssetDigests[name] === assets.finalAssetDigests[name]));
const differences = Object.keys(assets.qaAssetDigests).filter(
  (name) => assets.qaAssetDigests[name] !== assets.finalAssetDigests[name],
);
assert.deepEqual(differences.sort(), source.differentDiagnosticSourceMaps.slice().sort());
assert.equal(differences.length, 2);
assert.ok(differences.every((name) => name.endsWith('.map')));
assert.equal(Object.keys(assets.qaAssetDigests).length - differences.length, 26);
const author = json('author/receipt.json');
for (const entry of author.selections) {
  const bytes = read(`author/${entry.path}`);
  assert.equal(bytes.length, entry.publishedBytes ?? entry.bytes);
  assert.equal(sha256(bytes), entry.publishedSha256 ?? entry.sha256);
}
for (const entry of author.deduplicatedOriginals) {
  let bytes = fs.readFileSync(path.resolve(root, 'author', entry.publishedReference));
  if (entry.transform === 'CRLF-to-LF')
    bytes = Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n'));
  else assert.equal(entry.transform, 'identity');
  assert.equal(bytes.length, entry.bytes);
  assert.equal(sha256(bytes), entry.sha256);
}
const baselineDriver = read('baseline/ownership-challenge.mts').toString('utf8');
assert.equal(
  read('author/witness/ownership-challenge-corrected-expectation.mts').toString('utf8'),
  baselineDriver.replace("['fresh-unique', 'fresh-both-owned'].includes(scenario)", 'true'),
  'only baseline driver expectation changed',
);
const corrected = json('author/witness/corrected-run-all-scenarios.stdout.json');
for (const name of ['restored', 'fresh-duplicate', 'fresh-unique', 'fresh-both-owned']) {
  assert.equal(corrected[name].survivorsPreserved, true);
  assert.equal(corrected[name].exactUndo, true);
  assert.equal(corrected[name].exactRedo, true);
}
assert.equal(corrected['fresh-duplicate-keep-target'].unrelatedDescriptionPreservedEveryEdge, true);
assert.ok(
  read('author/tests-new-file-against-baseline-product.txt')
    .toString('utf8')
    .includes('Tests  5 failed | 59 passed (64)'),
);
assert.ok(
  read('author/witness/corrected-run.stderr.txt').toString('utf8').includes('true !== false'),
);
const mutations = [
  ...read('author/mutation-checks.txt')
    .toString('utf8')
    .matchAll(/\[([A-D]):[^\n]*Tests\s+(\d+) failed \| (\d+) passed \((\d+)\)/g),
];
assert.deepEqual(
  mutations.map((m) => [Number(m[2]), Number(m[3]), Number(m[4])]),
  author.mutations.map((m) => [m.failed, m.passed, m.total]),
);
const independent = json('independent/manifest.json');
assert.equal(independent.originalHead, source.firstQASource);
assert.equal(independent.finalHead, source.finalSource);
for (const prefix of ['independent/records/', 'independent/final-ae4ad07/records/']) {
  const store = json(`${prefix}store-controls.json`);
  assert.equal(store.status, 'pass');
  assert.equal(store.cases.length, 6);
  for (const result of store.cases) {
    assert.equal(result.status, 'pass');
    assert.equal(result.exactUndo, true);
    assert.equal(result.exactRedo, true);
  }
  const probe = json(`${prefix}yes-preview-browser.json`);
  assert.equal(probe.status, 'complete');
  assert.equal(probe.removalReviewShown, false);
  assert.equal(probe.checks.length, 10);
  assert.ok(probe.checks.every((check) => check.passed));
}
const originalCases = [
  'restored-delete',
  'fresh-delete',
  'unique-delete',
  'both-owned-delete',
  'description-control',
  'target-rename',
];
for (const name of originalCases) {
  const result = json(`independent/records/${name}-browser.json`);
  assert.equal(result.status, 'complete');
  assert.ok(result.checks.length > 0 && result.checks.every((check) => check.passed));
}
const finalBrowser = json('independent/final-ae4ad07/records/restored-delete-browser.json');
assert.equal(finalBrowser.status, 'complete');
assert.equal(finalBrowser.checks.length, 11);
assert.ok(finalBrowser.checks.every((check) => check.passed));
const replay = json('independent/records/independent-replay.json');
assert.equal(replay.status, 'pass');
assert.equal(replay.assertionsPassed, 136);
assert.equal(replay.assertions.length, 136);
assert.equal(replay.mapSamples, 51);
const firstAttempt = json('independent/records/harness-first-attempt.json');
assert.equal(firstAttempt.status, 'automation-error');
assert.equal(firstAttempt.firstJourneyAttemptsCompleted, 5);
assert.equal(firstAttempt.finalJourneyAttemptsCompleted, 6);
let localLinks = 0;
for (const name of inventory(root).filter((name) => name.endsWith('.md'))) {
  for (const match of read(name)
    .toString('utf8')
    .matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const href = match[1].replace(/^<|>$/g, '');
    if (/^[a-z][a-z\d+.-]*:/i.test(href)) continue;
    const [relative, fragment] = href.split('#');
    const target = path.resolve(root, path.dirname(name), decodeURIComponent(relative));
    assert.ok(fs.existsSync(target), `${name}: ${href}`);
    if (fragment && fs.statSync(target).isFile()) {
      const anchors = [...fs.readFileSync(target, 'utf8').matchAll(/^#{1,6}\s+(.+)$/gm)].map(
        (heading) =>
          heading[1]
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s_-]/gu, '')
            .trim()
            .replace(/\s/g, '-'),
      );
      assert.ok(anchors.includes(decodeURIComponent(fragment)), `${name}: #${fragment}`);
    }
    localLinks++;
  }
}
console.log(
  JSON.stringify(
    {
      result: 'pass',
      seals,
      nonMapAssetsIdentical: nonMap.length,
      unchangedAssetsIncludingSourceMaps: 26,
      differentDiagnosticMaps: differences.length,
      authorDeduplicatedOriginals: author.deduplicatedOriginals.length,
      authorMutationControls: mutations.length,
      originalIndependentBrowserJourneys: originalCases.length,
      finalIndependentBrowserJourneys: 1,
      independentStoreControlsPerSource: 6,
      directYesRemovalProbes: 2,
      preservedOriginalFirstAttempt: firstAttempt.status,
      localLinks,
      behaviorRerun: false,
    },
    null,
    2,
  ),
);
