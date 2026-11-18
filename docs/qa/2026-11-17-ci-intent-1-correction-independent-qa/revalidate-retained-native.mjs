import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [checkout, author, earlier] = process.argv.slice(2);
const helper = await import(pathToFileURL(join(checkout, 'tooling/scripts/windows-launcher-evidence.mjs')).href);
const v = (parent, file) => JSON.parse(readFileSync(join(parent, file), 'utf8'));
const exists = (dir) => Object.fromEntries(readdirSync(dir).map((name) => {
  const path = join(dir, name);
  const stat = lstatSync(path);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1);
  return [name, {bytes:stat.size, sha256:createHash('sha256').update(readFileSync(path)).digest('hex')}];
}));
const exits = v(author, 'native/exits.json');
const authorRoot = join(author, 'native/runner-temp', exits.dir);
const beforeRoot = v(earlier, 'native-exits.json').bundle;
const expectedAuthorResult = v(authorRoot, 'result.json');
const prevResult = v(beforeRoot, 'result.json');
const authorBinding = helper.parseManifest(readFileSync(join(authorRoot, 'manifest.json')));
const parse = (root, binding) =>
  helper.parseObservations(readFileSync(join(root, 'observations.ndjson')), binding.evidenceId);
const oldParsed = parse(beforeRoot, v(beforeRoot,'manifest.json'));
const newParsed = parse(authorRoot, authorBinding);
assert.equal(oldParsed.state, 'valid');
assert.equal(newParsed.state, 'valid');
assert.equal(oldParsed.records.length, 203);
assert.equal(newParsed.records.length, 1019);
const oldSummary = helper.summarize(oldParsed.records);
const newSummary = helper.summarize(newParsed.records);
assert.equal(newSummary.closed, true);
assert.equal(newSummary.rejected, 1);
assert.equal(newSummary.omittedRecords, 265);
assert.deepEqual(newSummary.contention, [1,2,3]);
assert.deepEqual(oldSummary.contention, [1,2,3]);
assert.deepEqual([...newSummary.aliases.junction.released].sort(), ['alias','direct']);
assert.deepEqual([...oldSummary.aliases.junction.released].sort(), ['alias','direct']);
assert.deepEqual(newSummary.cases, expectedAuthorResult.cases);
const misses = [...helper.missingRequirements(newSummary),...helper.bindingRequirements(authorBinding.binding)];
assert.deepEqual(misses, expectedAuthorResult.missing);
assert.equal(exits.native, 1);
assert.equal(expectedAuthorResult.status, 'native-failed');
const tap = readFileSync(join(author,'native/native.log'),'utf8');
assert.match(tap, /# fail 4/);
assert.match(tap, /# pass 21/);
const staged = Object.keys(exists(authorRoot));
assert.deepEqual(staged.sort(), ['manifest.json','observations.ndjson','result.json']);
const seed = readFileSync(join(author,'native/canary-seed.txt'), 'utf8').trim();
assert.ok(seed.length > 0);
for (const file of staged) {
  const text = readFileSync(join(authorRoot,file),'utf8');
  assert.ok(!text.includes(seed) && !/[A-Za-z]:[\\/]/.test(text));
}
console.log(JSON.stringify({
  correctedAuthored: {
    status: expectedAuthorResult.status, records:newParsed.records.length, closed:newSummary.closed,
    omitted:newSummary.omittedRecords, rejection:newSummary.rejected, files:exists(authorRoot),
    bindingRequirements:helper.bindingRequirements(authorBinding.binding), missing:misses,
  },
  originalGenuine: {
    status:prevResult.status, records:oldParsed.records.length, closed:oldSummary.closed,
    files:exists(beforeRoot),
  },
}, null, 2));
