// One read-only reparse of the retained genuine native evidence with the corrected helper
// (correction 02 of #496). It writes nothing into the retained folders and checks their bytes are
// unchanged afterwards.
//
// Usage: node reparse-retained-native.mjs <checkout> <author-bundle> <baseline-bundle> <output.json>
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [checkout, authorRoot, baselineRoot, output] = process.argv.slice(2);
const helperPath = join(checkout, 'tooling/scripts/windows-launcher-evidence.mjs');
const helper = await import(pathToFileURL(helperPath).href);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hashes = (root) =>
  Object.fromEntries(readdirSync(root).map((name) => [name, sha(readFileSync(join(root, name)))]));

function reparse(root, expectedRecords) {
  const before = hashes(root);
  const manifestBytes = readFileSync(join(root, 'manifest.json'));
  let manifest;
  let manifestState;
  try {
    manifest = helper.parseManifest(manifestBytes);
    manifestState = 'valid';
  } catch (error) {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
    manifestState = `refused:${error.reason ?? 'unavailable'}`;
  }
  const stored = JSON.parse(readFileSync(join(root, 'result.json'), 'utf8'));
  const parsed = helper.parseObservations(
    readFileSync(join(root, 'observations.ndjson')),
    manifest.evidenceId,
  );
  assert.equal(parsed.state, 'valid', `${root}: ${parsed.reason}`);
  assert.equal(parsed.records.length, expectedRecords);
  const closer = parsed.records.at(-1);
  assert.equal(closer.type, 'recorder-closed');
  const visible = parsed.records.filter((record) => record.type === 'rejected').length;
  const summary = helper.summarize(parsed.records);
  const binding = helper.bindingRequirements(manifest.binding);
  const missing = [...helper.missingRequirements(summary), ...binding];
  // A result written before correction 01 has no `subtestsUnpaired`: compare the stored fields and
  // report fields the stored result does not have (attempt 1 compared whole objects).
  const casesAdded = {};
  for (const [name, entry] of Object.entries(summary.cases)) {
    const storedEntry = stored.cases[name];
    for (const [field, value] of Object.entries(entry))
      if (Object.hasOwn(storedEntry, field))
        assert.deepEqual(value, storedEntry[field], `${name}.${field}`);
      else (casesAdded[field] ??= {})[name] = value;
    assert.ok(Object.keys(storedEntry).every((field) => Object.hasOwn(entry, field)));
  }
  assert.equal(summary.rejected, stored.observations.rejected);
  assert.equal(summary.omittedRecords, stored.observations.omittedRecords);
  const after = hashes(root);
  assert.deepEqual(after, before, 'retained bytes unchanged');
  return {
    files: before,
    manifest: manifestState,
    observations: parsed.state,
    records: parsed.records.length,
    closer: {
      seq: closer.seq,
      written: closer.written,
      rejected: closer.rejected,
      omittedRecords: closer.omittedRecords,
    },
    visibleRejected: visible,
    closerRule: `${visible} <= ${closer.rejected} <= ${visible + closer.omittedRecords}`,
    casesFieldsNotInStoredResult: casesAdded,
    bindingUnavailable: manifest.binding.unavailable,
    storedStatus: stored.status,
    storedMissing: stored.missing,
    bindingRequirements: binding,
    missingNow: missing,
    missingAdded: missing.filter((name) => !stored.missing.includes(name)),
    missingRemoved: stored.missing.filter((name) => !missing.includes(name)),
  };
}

const receipt = {
  node: process.version,
  helperSha256: sha(readFileSync(helperPath)),
  author: reparse(authorRoot, 1019),
  baseline: reparse(baselineRoot, 203),
};
writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt, null, 2));
