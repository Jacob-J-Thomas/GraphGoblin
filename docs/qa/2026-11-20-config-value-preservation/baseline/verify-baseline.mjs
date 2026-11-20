import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Integrity and retained baseline observations only; no product or driver execution.
const root = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => fs.readFileSync(path.join(root, name));
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(read('publication-manifest.json'));
for (const entry of manifest.files) {
  assert.equal(path.basename(entry.path), entry.path);
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
);
const report = Buffer.concat([read('report.reconstructible.txt'), Buffer.from([0x0a])]);
assert.equal(report.length, 20249);
assert.equal(sha256(report), '60f56748ec41ffa92716ec3749280db37e77cbc92fe3fde4c670e9d81b700f6a');
assert.equal(
  sha256(read('editor-value-observations.json')),
  '239798fc6c3d615a52a99baf547c6cd531526d14d1c674bcdd24b065c97fceb6',
);
const data = JSON.parse(read('editor-value-observations.json'));
assert.equal(data.head, manifest.source.head);
assert.equal(data.target, manifest.source.target);
assert.equal(data.tree, manifest.source.tree);
assert.equal(data.confirmation.apiControl.status, 400);
assert.equal(data.confirmation.apiControl.code, 'MALFORMED_BODY');
assert.equal(data.confirmation.apiControl.unchanged, true);
assert.equal(data.confirmation.writes.length, 4);
assert.equal(data.confirmation.published, null);
const phase = (name) => data.confirmation.snapshots.find((entry) => entry.phase === name);
const input = JSON.parse(data.confirmationInputs.nestedReservedBoolean);
assert.ok(Object.hasOwn(input, '__proto__'));
assert.equal(input.__proto__, false);
const arrayInput = JSON.parse(data.confirmationInputs.insideAnArray);
assert.ok(Object.hasOwn(arrayInput.rows[0], '__proto__'));
for (const name of ['nested-reserved-boolean', 'array-reserved-boolean', 'reloaded']) {
  const result = phase(name);
  assert.equal(result.saved, true);
  assert.equal(result.hasBlockingMessage, false);
  assert.equal(result.server.neighbor, 'unchanged');
}
assert.ok(!Object.hasOwn(phase('nested-reserved-boolean').server.example, '__proto__'));
assert.ok(!Object.hasOwn(phase('array-reserved-boolean').server.example.rows[0], '__proto__'));
assert.deepEqual(phase('reloaded').server, phase('array-reserved-boolean').server);
assert.equal(phase('ordinary-space-control').hasBlockingMessage, true);
assert.equal(phase('ordinary-space-control').saved, false);
assert.deepEqual(phase('ordinary-space-control').server, phase('baseline').server);
assert.equal(phase('control-correction').saved, true);
assert.deepEqual(phase('control-correction').server.example, {
  marker: 'corrected-before',
  survivor: true,
});
assert.ok(data.firstTrialNote.includes('before the autosave settled'));
assert.ok(data.firstTrial.observations.corrected.saved === false);
let localLinks = 0;
for (const name of ['README.md', 'report.reconstructible.txt']) {
  for (const match of read(name)
    .toString('utf8')
    .matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const href = match[1].replace(/^<|>$/g, '');
    if (/^[a-z][a-z\d+.-]*:/i.test(href)) continue;
    assert.ok(
      fs.existsSync(path.resolve(root, decodeURIComponent(href.split('#')[0]))),
      `${name}: ${href}`,
    );
    localLinks++;
  }
}
const args = process.argv.slice(2);
if (args.length) {
  assert.equal(args.length, 2, 'Usage: node verify-baseline.mjs [--reconstruct-report NEW_FILE]');
  assert.equal(args[0], '--reconstruct-report');
  const target = path.resolve(args[1]);
  const comparable = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);
  assert.ok(
    comparable(target) !== comparable(root) &&
      !comparable(target).startsWith(comparable(root + path.sep)),
    'Reconstruct outside the sealed capsule',
  );
  fs.writeFileSync(target, report, { flag: 'wx' });
}
console.log(
  JSON.stringify(
    {
      result: 'pass',
      baselineVerdict: 'CHANGES REQUIRED',
      manifestSha256: sha256(read('publication-manifest.json')),
      entriesVerified: manifest.files.length,
      originalReportReconstructedSha256: sha256(report),
      exactCompanionSha256: sha256(read('editor-value-observations.json')),
      originalTimingQualificationRetained: true,
      confirmationAutosaveBodies: data.confirmation.writes.length,
      localLinks,
      behaviorRerun: false,
    },
    null,
    2,
  ),
);
