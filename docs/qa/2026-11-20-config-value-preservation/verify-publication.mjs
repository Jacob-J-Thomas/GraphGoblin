import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

// Current bytes and retained outcomes only; never runs product code, tests, Git or drivers.
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
const args = process.argv.slice(2);
assert.ok(
  args.length === 0 || (args.length === 1 && args[0] === '--integrity-only'),
  'Usage: node verify-publication.mjs [--integrity-only]',
);
const verify = (name) => {
  const file = path.join(root, name);
  const base = path.dirname(file);
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
      .filter((p) => p !== path.basename(file))
      .sort(),
    entries.map((entry) => entry.path).sort(),
  );
  return { manifest: name, entriesVerified: entries.length, sha256: sha256(read(name)) };
};
const manifest = json('publication-manifest.json');
const seals = [];
for (const [name, expected] of Object.entries(manifest.componentSeals)) {
  assert.equal(sha256(read(name)), expected);
  seals.push(verify(name));
}
assert.equal(
  sha256(read('baseline/publication-manifest.json')),
  '4a45475086972b8e811ff45c8bf32d3d2fc4d801eceed8e736d928d65cc9fab6',
);
assert.equal(
  sha256(Buffer.concat([read('baseline/report.reconstructible.txt'), Buffer.from([10])])),
  '60f56748ec41ffa92716ec3749280db37e77cbc92fe3fde4c670e9d81b700f6a',
);
seals.push(verify('publication-manifest.json'));
const author = json('author/outcomes.json');
for (const entry of author.selections) {
  const bytes = read(`author/${entry.path}`);
  assert.equal(bytes.length, entry.publishedBytes);
  assert.equal(sha256(bytes), entry.publishedSha256);
  if (entry.path.endsWith('.gz')) {
    const original = zlib.gunzipSync(bytes);
    assert.equal(original.length, entry.originalBytes);
    assert.equal(sha256(original), entry.originalSha256);
  }
}
assert.ok(
  read('author/records/01-old-source-red.txt')
    .toString('utf8')
    .includes('Tests  5 failed | 2 passed | 51 skipped (58)'),
);
assert.ok(
  read('author/records/02-candidate-01-regression.txt')
    .toString('utf8')
    .includes('Tests  1 failed | 489 passed (490)'),
);
assert.ok(
  read('author/records/02-candidate-01-regression.txt').toString('utf8').includes('variables.r'),
);
assert.equal(author.candidate01.status, 'SUPERSEDED');
const one = json('candidate/candidate-01-binding.json');
const two = json('candidate/candidate-02-binding.json');
const three = json('candidate/candidate-03-binding.json');
assert.equal(one.head, author.candidate01.head);
assert.equal(one.tree, author.candidate01.tree);
assert.equal(two.head, author.candidate02.head);
assert.equal(two.tree, author.candidate02.tree);
assert.equal(two.parent, one.head);
assert.equal(one.heldHead, two.heldHead);
assert.equal(one.target, two.target);
assert.equal(three.head, author.candidate03.head);
assert.equal(three.tree, author.candidate03.tree);
assert.equal(three.parent, two.head);
assert.equal(three.heldHead, one.heldHead);
assert.equal(three.target, one.target);
assert.equal(author.candidate02.wholeWeb.passed, 3014);
assert.equal(author.candidate02.wholeWeb.failed, 1);
assert.equal(author.candidate02.mountedAB.held.passed, 1);
assert.equal(author.candidate02.mountedAB.candidate02.failed, 1);
assert.equal(author.candidate02.desktopVariablesAB.heldPassed, 9);
assert.equal(author.candidate02.desktopVariablesAB.candidate02Passed, 9);
assert.equal(author.candidate03.rootExistingControls.passed, 2);
assert.equal(author.candidate03.rootExistingControls.skipped, 31);
assert.equal(author.candidate03.rootBuild.successful, 12);
assert.ok(
  read('author/records/03-candidate-02-whole-web-failure.excerpt.txt')
    .toString('utf8')
    .includes('1 failed | 3014 passed (3015)'),
);
assert.ok(
  read('author/records/06-candidate-03-existing-controls.excerpt.txt')
    .toString('utf8')
    .includes('2 passed | 31 skipped (33)'),
);
const independentManifest = json('independent/publication-manifest.json');
assert.equal(independentManifest.head, three.head);
assert.equal(independentManifest.tree, three.tree);
assert.equal(independentManifest.target, three.target);
assert.equal(
  sha256(read('independent/reports/candidate-03-reviewed.txt')),
  '1f1225b3a20d731d94dd8d30d96a4e24cf0230eaf6463d92e3c995eb0fa8e958',
);
for (const entry of independentManifest.sharedReferences) {
  assert.equal(sha256(read(path.posix.join('independent', entry.path))), entry.sha256);
}
let independentRawChecks = 0;
const check = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  independentRawChecks++;
};
const record = (name) => json(`independent/records/candidate03/${name}.json`);
let liveConfig = 0;
for (const item of json('independent/records/case-inputs.json').cases) {
  const result = record(`${item.key}.browser`);
  const phase = (name) => result.observations.find((entry) => entry.phase === name);
  const before = phase('last-valid-saved').server.definition;
  const expected = structuredClone(before);
  expected.nodes[2].config.harnessOptions.configOverrides.example = JSON.parse(item.corrected);
  check(result.status, 'complete', `${item.key}: complete`);
  check(
    result.checks.every((entry) => entry.passed),
    true,
    `${item.key}: live checks`,
  );
  check(phase('refused-feedback').valueText, item.text, `${item.key}: exact held text`);
  check(phase('refused-text-observed').server.definition, before, `${item.key}: server exact`);
  check(result.deviceSamples.length, 16, `${item.key}: positive sample count`);
  for (const sample of result.deviceSamples) {
    check(sample.absent, undefined, `${item.key}: positively present`);
    check(
      sample.definition,
      item.key === 'space-control' ? result.authoredDefinition : before,
      `${item.key}: whole device definition`,
    );
  }
  check(
    result.autosavePuts.filter((entry) => entry.refusalActive),
    [],
    `${item.key}: refused PUTs`,
  );
  check(result.publishRequests, [], `${item.key}: publish POSTs`);
  check(
    result.autosavePuts.map((entry) => entry.responseStatus),
    [200, 200],
    `${item.key}: valid PUTs`,
  );
  check(
    result.autosavePuts.map((entry) => entry.definition),
    [before, expected],
    `${item.key}: whole PUTs`,
  );
  check(phase('corrected-saved').server.definition, expected, `${item.key}: corrected definition`);
  check(phase('server-reloaded').server.definition, expected, `${item.key}: real reload`);
  check(expected.edges, before.edges, `${item.key}: all geometry`);
  if (item.key === 'reserved-object') {
    check(phase('global-save-label-comparison').sameLabel, true, 'global label ambiguity retained');
    check(phase('ordinary-malformed-held').server.definition, before, 'malformed server exact');
    check(phase('ordinary-malformed-held').device.definition, before, 'malformed device exact');
    check(phase('publish-refusal').publishRequests, [], 'actual Publish no request');
    check(
      phase('publish-refusal').bodyText.includes('complete or discard it first.'),
      true,
      'actual Publish refuses held input',
    );
  }
  liveConfig += result.checks.length;
}
check(liveConfig, 67, 'actual config live assertions');
const variables = record('variables.browser');
check(variables.status, 'complete', 'actual Variables completes');
check(
  variables.checks.filter((entry) => entry.passed).length,
  9,
  'actual Variables live assertions',
);
check(
  variables.writes.some((entry) => entry.path.endsWith('/publish')),
  false,
  'Variables Publish guard',
);
const before = record('source-before');
const after = record('source-after');
check(before.head, three.head, 'actual executed head');
check(before.tree, three.tree, 'actual executed tree');
check(after.matchesBefore, true, 'source unchanged throughout');
for (const key of ['sourceHashes', 'webAssetHashes', 'driverHashes']) {
  check(after[key], before[key], `${key} unchanged throughout`);
}
check(Object.keys(before.webAssetHashes).length, 34, 'actual03 served asset inventory');
const assetQualification = json('independent/records/asset-qualification.json');
check(assetQualification.actual03.head, three.head, 'asset qualification source03');
check(assetQualification.actual03.assetFiles, 34, 'asset qualification count');
check(assetQualification.actual03.allFiveJourneysPersonallyRerun, true, 'all03 journeys rerun');
check(assetQualification.commonDifferent.length, 3, '02 to03 changed common assets');
check(assetQualification.added.length, 2, '02 to03 added assets');
for (const [name, expected] of Object.entries(three.files)) {
  if (Object.hasOwn(before.sourceHashes, name)) {
    check(before.sourceHashes[name], expected, `${name}: selected source matches runtime`);
  }
}
const cleanup = record('credential-cleanup');
check(
  [cleanup.revokeStatus, cleanup.oldCredentialDeniedStatus],
  [204, 401],
  'recorded key cleanup',
);
check(cleanup.retainedTokenHits, [], 'recorded retained-token scan');
const runtime = record('runtime-cleanup');
check(
  [runtime.apiPresent, runtime.browserPresent, runtime.listenerPresent],
  [false, false, false],
  'recorded runtime cleanup',
);
const replay = record('independent-replay');
check(replay.liveAssertionsTotal, 76, 'retained total live assertions');
check(replay.recordAssertions, 208, 'retained original record assertions');
check(replay.socketAfterTeardown, 'ECONNREFUSED', 'recorded socket cleanup');
assert.equal(author.oldSourceFinalRed.failed, 8);
assert.ok(
  read('author/records/10-final-tests-old-source-red.txt')
    .toString('utf8')
    .includes('8 failed | 3 passed | 68 skipped (79)'),
);
assert.equal(author.candidate03.wholeWeb.passed, 3017);
assert.equal(author.candidate03.wholeWeb.failed, 0);
assert.ok(
  read('author/records/08-candidate-03-whole-web.txt')
    .toString('utf8')
    .includes('3017 passed (3017)'),
);
assert.equal(
  sha256(read('author/records/author-report.original.txt')),
  '5ccf220907b3d41827e2543899448b0de738faf0114d414f4c73c1e9572a982d',
);
assert.equal(
  sha256(read('author/records/provider-final-message.original.txt')),
  'd3da9cd50bf780d502a491152390f9cc098c47d8592cd280c360a9c050d6b595',
);
assert.equal(json('author/records/provider-exit.original.json').code, 0);
assert.equal(author.terminal.providerResult.resultMatchesRetainedFinalMessage, true);
assert.equal(author.terminal.providerResult.subtype, 'success');
assert.equal(author.terminal.providerResult.is_error, false);
assert.deepEqual(author.terminal.providerResult.modelUsageKeys, ['claude-opus-5-5']);
for (const [name, expected] of Object.entries(author.authorFinalProposal.finalSourceHashes)) {
  if (name !== 'docs/09-frontend-and-pwa.md') assert.equal(expected, three.files[name]);
}
assert.equal(author.authorFinalProposal.finalPatch.selectedForPublication, false);
const overlay = json('candidate/editorial-overlay-binding.json');
const editorial = json('candidate/editorial-overlay-readback.json');
assert.equal(
  sha256(read('candidate/editorial-overlay-readback.json')),
  'f34c1fe38d6ca1adb62646d55ab66a9c4c9832d53c78fe26a1707c3e3ade4c67',
);
assert.equal(overlay.parent, three.head);
assert.equal(overlay.target, three.target);
assert.equal(editorial.runtimeSource, three.head);
assert.equal(editorial.head, overlay.head);
assert.equal(editorial.tree, overlay.tree);
assert.deepEqual(Object.keys(overlay.files), ['docs/09-frontend-and-pwa.md']);
assert.deepEqual(editorial.changedPaths, Object.keys(overlay.files));
assert.equal(editorial.before.sha256, three.files[editorial.path]);
assert.equal(editorial.after.sha256, overlay.files[editorial.path]);
assert.equal(editorial.runtimeDelta, false);
assert.equal(editorial.fullRecursiveTreeOutsidePathIdentical, true);
assert.equal(editorial.originalFableFinding.runtimeSourceReviewed, three.head);
assert.equal(
  editorial.originalFableFinding.sha256,
  'fa014152e54a70bd4cf430d09190566b82b83a03af475ffd26f57f983845955b',
);
assert.equal(editorial.observations.length, 2);
assert.equal(editorial.parkedFollowup.number, 527);
assert.equal(editorial.parkedFollowup.state, 'open');
assert.equal(editorial.parkedFollowup.parkedEvidence.backlogLabel, true);
assert.deepEqual(editorial.parkedFollowup.gateLabels, []);
assert.equal(manifest.selectedSource, three.head);
assert.equal(manifest.deliverySource, overlay.head);
if (manifest.publicationReady) {
  assert.equal(author.terminal.providerFinalMessageObserved, true);
  assert.equal(author.terminal.providerExitObserved, true);
  assert.equal(author.terminal.finalCoverageClaim, true);
  assert.ok(manifest.componentSeals['independent/publication-manifest.json']);
}
let localLinks = 0;
for (const name of inventory(root).filter((p) => p.endsWith('.md'))) {
  for (const match of read(name)
    .toString('utf8')
    .matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const href = match[1].replace(/^<|>$/g, '');
    if (/^[a-z][a-z\d+.-]*:/i.test(href)) continue;
    assert.ok(
      fs.existsSync(path.resolve(root, path.dirname(name), decodeURIComponent(href.split('#')[0]))),
      `${name}: ${href}`,
    );
    localLinks++;
  }
}
console.log(
  JSON.stringify(
    {
      result: manifest.publicationReady ? 'pass' : 'partial',
      integrity: 'pass',
      publicationReady: manifest.publicationReady,
      seals,
      componentSeals: manifest.componentSeals,
      oldSourceRegressionsFailed: 5,
      finalTestsOldSourceFailed: 8,
      candidate01WiderPassed: 489,
      candidate01WiderFailed: 1,
      candidate01Final: false,
      candidate02WholeWebPassed: 3014,
      candidate02WholeWebFailed: 1,
      candidate02Final: false,
      selectedSource: three.head,
      selectedTag: '03',
      deliverySource: overlay.head,
      editorialRuntimeDelta: false,
      candidate03WholeWebPassed: 3017,
      authorFinalObserved: author.terminal.providerFinalMessageObserved,
      independentLiveAssertions: 76,
      independentRecordedAssertions: 208,
      independentRawChecksReplayed: independentRawChecks,
      localLinks,
      behaviorRerun: false,
    },
    null,
    2,
  ),
);
if (!manifest.publicationReady && !args.includes('--integrity-only')) process.exitCode = 2;
