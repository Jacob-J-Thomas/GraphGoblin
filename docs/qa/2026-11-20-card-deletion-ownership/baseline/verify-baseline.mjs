import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Byte integrity and retained observations only. No application or driver execution.
const root = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => fs.readFileSync(path.join(root, name));
const json = (name) => JSON.parse(read(name));
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const manifest = json('publication-manifest.json');
for (const entry of manifest.files) {
  assert.equal(path.basename(entry.path), entry.path, 'flat capsule path');
  const bytes = read(entry.path);
  assert.equal(bytes.length, entry.bytes, `${entry.path}: bytes`);
  assert.equal(sha256(bytes), entry.sha256, `${entry.path}: SHA-256`);
}
assert.deepEqual(
  fs
    .readdirSync(root)
    .filter((name) => name !== 'publication-manifest.json')
    .sort(),
  manifest.files.map((entry) => entry.path).sort(),
  'complete capsule inventory',
);
assert.equal(
  sha256(read('report.original.txt')),
  '108fdc3b3000eb0899b7a07bb4032ab73a7a326ba262d2c3b3430c7c0e5dfe35',
);
const browser = json('browser-verification.json');
assert.equal(browser.head, manifest.source.head);
assert.equal(browser.tree, manifest.source.tree);
assert.equal(browser.captureSha256, manifest.capture.sha256);
assert.equal(browser.restoredDefinitionLoadedExactly, true);
assert.equal(browser.fixtureReadback.sameDefinition, true);
assert.equal(browser.fixtureReadback.sameMap, true);
let savedPhases = 0;
for (const observation of browser.observations) {
  for (const [phase, result] of Object.entries(observation.phases)) {
    assert.equal(result.serverStatus, 200);
    assert.equal(result.save, 'All changes saved');
    assert.equal(result.syncedDeviceEqualsServer, true);
    const expected =
      observation.fixture !== 'unique' && phase !== 'after-undo'
        ? [['/edges/1/from/port', 'no', 'yes']]
        : [];
    assert.deepEqual(result.fullDefinitionDifferenceFromExpected, expected);
    savedPhases++;
  }
}
assert.equal(savedPhases, 9);
const store = json('ownership-challenge.json');
for (const name of ['restored', 'fresh-duplicate', 'fresh-unique', 'fresh-both-owned']) {
  assert.equal(store[name].survivorsPreserved, ['fresh-unique', 'fresh-both-owned'].includes(name));
  assert.equal(store[name].exactUndo, true);
  assert.equal(store[name].exactRedo, true);
}
assert.equal(store['fresh-duplicate-keep-target'].unrelatedDescriptionPreservedEveryEdge, true);
assert.equal(json('prior-findings-control.json').length, 8);
let localLinks = 0;
for (const name of ['README.md', 'report.original.txt']) {
  for (const match of read(name)
    .toString('utf8')
    .matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].replace(/^<|>$/g, '');
    if (/^[a-z][a-z\d+.-]*:/i.test(target)) continue;
    const relative = decodeURIComponent(target.split('#')[0]);
    assert.ok(fs.existsSync(path.resolve(root, relative)), `${name}: ${target}`);
    localLinks++;
  }
}
console.log(
  JSON.stringify(
    {
      result: 'pass',
      manifestSha256: sha256(read('publication-manifest.json')),
      entriesVerified: manifest.files.length,
      exactSourceArtifacts: manifest.files.filter((entry) => entry.originalArtifact).length,
      savedBrowserPhases: savedPhases,
      storeDeletionScenarios: 4,
      unrelatedDescriptionControl: true,
      earlierFindingControls: 8,
      localLinks,
      behaviorRerun: false,
    },
    null,
    2,
  ),
);
