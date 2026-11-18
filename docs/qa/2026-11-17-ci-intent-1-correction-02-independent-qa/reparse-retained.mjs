import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [checkout, author, earlier] = process.argv.slice(2);
const helper = await import(pathToFileURL(join(checkout, 'tooling/scripts/windows-launcher-evidence.mjs')).href);
const read = (root,name) => readFileSync(join(root,name));
const json = (root,name) => JSON.parse(read(root,name));
const roots = {
  authorNegative:join(author,'native/runner-temp',json(author,'native/exits.json').dir),
  originalNative:json(earlier,'native-exits.json').bundle,
};
const receipt = {};
for (const [kind, root] of Object.entries(roots)) {
  const manifest = helper.parseManifest(read(root,'manifest.json'));
  const stored = json(root,'result.json');
  const observations = read(root,'observations.ndjson');
  const parsed = helper.parseObservations(observations,manifest.evidenceId);
  assert.equal(parsed.state,'valid');
  const result = helper.summarize(parsed.records);
  const close = parsed.records.at(-1);
  const seen = parsed.records.filter((row) => row.type === 'rejected').length;
  assert.equal(close.type,'recorder-closed');
  assert.ok(seen <= close.rejected && close.rejected <= seen + close.omittedRecords);
  assert.equal(result.closed,true);
  assert.deepEqual(result.contention,[1,2,3]);
  assert.deepEqual([...result.aliases.junction.released].sort(),['alias','direct']);
  assert.equal(result.records,stored.observations.records);
  for (const [name,caseInfo] of Object.entries(stored.cases)) {
    for (const [field,value] of Object.entries(caseInfo)) {
      assert.deepEqual(result.cases[name][field],value);
    }
  }
  const unmapped = stored.missing.filter((reason) => !reason.startsWith('binding-'));
  assert.deepEqual(helper.missingRequirements(result), unmapped);
  assert.deepEqual(helper.bindingRequirements(manifest.binding), ['binding-identity','binding-unverified']);
  receipt[kind] = { records:result.records, closed:result.closed, observedRejected:seen,
    closerRejected:close.rejected, omitted:close.omittedRecords, sourceBytes:observations.length,
    sha256:createHash('sha256').update(observations).digest('hex'),
    missing:[...unmapped,...helper.bindingRequirements(manifest.binding)] };
}
assert.equal(receipt.authorNegative.records,1019);
assert.equal(receipt.originalNative.records,203);
console.log(JSON.stringify(receipt,null,2));
