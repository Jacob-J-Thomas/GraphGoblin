// Readback of the first and only behavior run. No product/SDK imports or child behavior calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const evidence = path.dirname(fileURLToPath(import.meta.url));
const checkout = 'G:/ggq/gg-i4-363-qa/GraphGoblin';
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const raw = JSON.parse(fs.readFileSync(path.join(evidence, 'observations.json'), 'utf8'));
assert.equal(raw.final.pass, 0);
assert.equal(raw.final.fail, 2);
assert.equal(raw.cases.length, 2);
const tsxFiles = fs.readdirSync(path.join(checkout, 'apps/api/node_modules/tsx/dist')).filter((name) => name.endsWith('.mjs') || name.endsWith('.cjs'));
const snippets = [];
for (const name of tsxFiles) {
  const file = path.join(checkout, 'apps/api/node_modules/tsx/dist', name);
  const bytes = fs.readFileSync(file);
  const text = bytes.toString('utf8');
  let index = text.indexOf('tsx-');
  while (index >= 0) {
    const snippet = text.slice(Math.max(0, index - 180), index + 240);
    if (/tmpdir|userInfo/.test(snippet)) snippets.push({ file: fs.realpathSync(file), sha256: hash(bytes), snippet });
    index = text.indexOf('tsx-', index + 4);
  }
}
assert(snippets.length > 0, 'Cache classification must have pinned loader-source evidence');
const caseReadbacks = [];
for (const item of raw.cases) {
  assert.equal(item.child.status, 0);
  assert.equal(item.status, 'FAIL');
  assert.match(item.verificationFailure.message, /tsx-98jak/);
  assert(item.verificationFailure.stack.includes('run-boundary-v1.mjs:97:14'));
  const state = JSON.parse(fs.readFileSync(path.join(evidence, 'raw', `${item.id}.state.json`), 'utf8'));
  assert.deepEqual(state, item.state);
  assert.deepEqual(state.tempEntriesBefore, []);
  assert.deepEqual(state.tempEntriesAfter, ['tsx-98jak']);
  assert.equal(state.listingExists, true);
  assert.equal(state.scratchExistsAfter, false);
  assert.deepEqual(state.listing.entries, []);
  assert.equal(path.dirname(state.listing.cwd), item.temp);
  assert.match(path.basename(state.listing.cwd), /^gg-structured-[a-f0-9]{8}$/);
  if (item.id === 'short-control') {
    assert.equal(state.outcome.kind, 'resolved');
    assert.deepEqual(state.outcome.result.value, { fixture: 'sdk-boundary', ok: true });
    assert.equal(state.turnExists, true);
    assert.equal(state.schemaDirExistsAfter, false);
    const config = JSON.parse(fs.readFileSync(path.join(evidence, 'raw/short-control.config.json')));
    assert.deepEqual(state.turn.schema, config.schema);
    assert.equal(path.dirname(state.turn.schemaDir), item.temp);
    assert.equal(state.turn.requestedCwd, state.listing.cwd);
    assert(state.turn.argv.includes('--output-schema'));
    assert.equal(state.turn.schemaDirLength, 76);
    assert.equal(state.turn.schemaPathLength, 88);
  } else {
    assert.equal(item.tempLength, 226);
    assert.equal(state.listing.cwdLength, 249);
    assert.equal(item.sdkSchemaDirTemplateLength, 253);
    assert.equal(item.sdkSchemaFileTemplateLength, 265);
    assert.equal(state.outcome.kind, 'rejected');
    assert.equal(state.outcome.error.code, 'HARNESS_TURN_FAILED');
    assert.equal(state.outcome.error.retriable, false);
    assert.equal(state.outcome.error.submission, 'delivery-uncertain');
    assert.match(state.outcome.error.message, /ENAMETOOLONG.*mkdtemp/s);
    assert(state.outcome.error.message.includes(item.sdkSchemaDirTemplate));
    assert.equal(state.turnExists, false);
    assert.equal(fs.existsSync(path.join(evidence, 'raw/long-226.turn.json')), false);
  }
  caseReadbacks.push({ id: item.id, readback: 'CONFIRMED', originalDriverStatus: item.status, originalFailure: 'Overbroad TEMP-empty assertion included the tsx loader cache', productOutcome: state.outcome.kind, listingMarker: true, turnMarker: state.turnExists, scratchRemoved: true, remainingTempEntries: state.tempEntriesAfter, cacheSourceEvidence: 'tsx-source-snippets.json', behaviorRerun: false });
}
assert.equal(fs.existsSync(raw.owner), false);
assert.equal(raw.final.mainProcessEnvUnchanged, true);
assert.equal(raw.final.checkoutClean, true);
const result = { at: new Date().toISOString(), behaviorRunCount: 1, behaviorCasesExecuted: 2, readbackOnly: true, originalDriverExit: 1, originalDriverPass: 0, originalDriverFail: 2, finding: 'CONFIRMED: real pinned SDK output-schema mkdtemp blocks long-root completion after successful adapter allocation and MCP listing.', cases: caseReadbacks, sourceAndFixtureNotModifiedAfterRun: true, originalQaManifestUnchanged: raw.final.originalQaManifestUnchanged, ownerRemoved: true, limitations: ['Harness normalizes the native error; native errno text and path survive, but native syscall properties and original SDK stack are not retained by the public harness result.', 'Filesystem before/after and fake-CLI markers are native observations; no fs/builtin/SDK monkeypatch or syscall tracing was used.', 'The loader cache was identified after execution from installed tsx source; raw failed guard and predictions are unaltered.'] };
fs.writeFileSync(path.join(evidence, 'tsx-source-snippets.json'), JSON.stringify(snippets, null, 2) + '\n');
fs.writeFileSync(path.join(evidence, 'readback-analysis.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
