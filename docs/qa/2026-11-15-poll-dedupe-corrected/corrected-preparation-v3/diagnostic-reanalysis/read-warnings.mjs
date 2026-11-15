// Reanalyzes the retained first-run logs. Reads no database and imports no GraphGoblin code.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(import.meta.url);
const out = dirname(script);
const driver = dirname(out);
const original = join(driver,'corrected-attempt-1');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const required = {
  admission:'27dd6040c1d605ff73de4da10c0e47c5a2a8fe7c86fd676413af21526edc3311',
  fixtureManifest:'957458526b7231c6dcf3f3103502dd9348e277cb4036dc53ea06db497ee6cfcc',
  freeze:'252145a9d2a5aec128c63719b40be62d4c62b7afff1b1de6a4533492fbd5d790',
  source:'fb547ec5d2039ac902c9ae81b72a8cba1c26722a8a2b3779b9f388eeb32e99ec',
  result:'03be248eb5b5c4328183544d31acb681f115bbb75d279be2877af53a861bf5f2',
  requests:'f1527c19330cb3dd52baf5f6252a203703022f9125156fee27dd78a6eb4ed759',
  firstLog:'8317656b6d21cf1dfdb1997e0d180434a1d3ce3a3dafe8cfc2cb76d734507de7',
  restartLog:'5f31a50a035484f7afe719a8ec4899ec9719986e21a300b37ba2fb5f91b89eb7',
  cleanup:'b261dca68ea05f41c84d784dc92c6fb125b69ef2ab38a5d538fa309143e763d4',
};
async function exact(path, expected) {
  const raw = await readFile(path);
  assert.equal(sha(raw),expected,path);
  return raw;
}
const admission = JSON.parse(await exact(join(driver,'admission.json'),required.admission));
await exact(admission.freeze.path,required.freeze);
const manifest = (await exact(join(driver,'SHA256SUMS'),required.fixtureManifest)).toString('utf8').trimEnd().split('\n');
assert.equal(manifest.length,10);
const inputs = {};
for (const line of manifest) {
  const [digest,path] = line.split(' *');
  await exact(join(driver,path),digest);
  inputs[path] = digest;
}
const wire = JSON.parse(await exact(join(driver,'..','wire-fixtures.json'),inputs['../wire-fixtures.json']));
const binding = JSON.parse(await exact(join(original,'source-and-build.json'),required.source));
await exact(join(original,'source-and-build-after.json'),required.source);
assert.equal(binding.head,'420240cad27d3865988dc7009dc9d80291e93c9c');
assert.equal(binding.tree,'75d6720f6cc7da85e04d9f17f8b96f40b94c4094');
assert.deepEqual(binding.diagnostics,admission.diagnostics);
for (const [path, digest] of Object.entries(binding.diagnostics.sourceSha256)) {
  assert.equal(binding.sources[path].sha256,digest);
  await exact(join(binding.checkout,path),digest);
}
for (const path of ['apps/api/dist/main.js','apps/api/dist/triggers/poll.js','apps/api/dist/triggers/poll-items.js',
  'packages/domain/dist/poll-items.js']) await exact(join(binding.checkout,path),binding.built[path]);
const result = JSON.parse(await exact(join(original,'result.json'),required.result));
assert.equal(result.verdict,'unconfirmed or incomplete');
assert.match(result.failure.message,/^corrected-lone-P3/u);
assert.equal(result.cleanupFailed,false);
assert(result.observations.every((entry) => entry.matchesCorrectedObservation));
assert.equal(result.observations.length,21);
const cleanup = JSON.parse(await exact(join(original,'cleanup.json'),required.cleanup));
assert.equal(cleanup.resultSha256,required.result);
assert(cleanup.cleanDrain && cleanup.storeRemoved);
assert.deepEqual(cleanup.afterOwnership.listeners,[]);
assert.deepEqual(cleanup.afterOwnership.presentPids,[]);
const requests = JSON.parse(await exact(join(original,'probe-requests.json'),required.requests));
assert.equal(requests.filter((request) => request.label).length,21);
const canaries = /(?:probe-(?:body|other)-canary-|candidate-(?:body|other)-canary-|item-(?:H|Ht|L)-key-canary-|single-(?:H|L)-key-canary-|S{63})/u;
const warnings = [];
for (const [file, digest, phase] of [['initial-gateway.log',required.firstLog,'initial'],
  ['restart-gateway.log',required.restartLog,'restart']]) {
  const raw = (await exact(join(original,file),digest)).toString('utf8');
  assert(!canaries.test(raw),file);
  for (const [i, line] of raw.split(/\r?\n/u).entries()) {
    if (!line) continue;
    const entry = JSON.parse(line);
    if (entry.level >= 40) {
      assert.equal(entry.level,40);
      assert.equal(entry.pid,result.gatewayProcesses.find(({label}) => label === phase).pid);
      warnings.push({file,line:i+1,phase,entry});
    }
  }
}
assert.equal(warnings.length,20);
const unique = new Set();
const assignments = [];
const malformed = new Set(['H','L','Ht']);
const metadataFields = ['level','time','pid','hostname','loopId','nodeId','code','reason','msg'];
for (const observation of result.observations) {
  const {target,label,armed,delivered,barrier} = observation;
  const loop = result.loops[target];
  const phase = /-P[45]$/u.test(label) ? 'restart' : 'initial';
  const processRecord = result.gatewayProcesses.find((gateway) => gateway.label === phase);
  assert(processRecord && processRecord.exit.code === 0 && processRecord.drain.status === 202);
  for (const id of ['ownerId','loopId','versionId','triggerNodeId']) assert.equal(armed[id],loop[id]);
  const inclusiveDueMs = Date.parse(armed.nextPollAt);
  const firstProbeMs = Date.parse(delivered.received.wall);
  const exclusiveBarrierMs = Date.parse(barrier.received.wall);
  assert(inclusiveDueMs <= firstProbeMs);
  assert(firstProbeMs <= Date.parse(delivered.finished.wall) && Date.parse(delivered.finished.wall) < exclusiveBarrierMs);
  const dataRequests = requests.filter((request) => request.label === label);
  assert.equal(dataRequests.length,1);
  assert.deepEqual(dataRequests[0],delivered);
  assert.equal(barrier.target,target);
  assert.equal(barrier.label,null);
  const rawBarrier = requests.find((request) => request.target === target && request.label === null &&
    request.received.monoMs >= delivered.finished.monoMs);
  assert.deepEqual(rawBarrier,barrier);
  const input = wire.phases.corrected[target].find((candidate) => candidate.label === label);
  assert(input);
  assert.equal(Buffer.from(delivered.wireBase64,'base64').toString('utf8'),input.body);
  assert.equal(Buffer.from(barrier.wireBase64,'base64').toString('utf8'),wire.inertBody);
  const expectedIndices = target === 'items' ?
    input.ids.flatMap((tag,index) => malformed.has(tag) ? [index] : []) :
    target === 'lone' || (target === 'split' && input.ids.includes('SPLIT')) ? [null] : [];
  const selected = warnings.filter(({entry}) => entry.pid === processRecord.pid && entry.loopId === loop.loopId &&
    entry.time >= inclusiveDueMs && entry.time < exclusiveBarrierMs);
  assert.equal(selected.length,expectedIndices.length,label);
  assignments.push({target,label,pid:processRecord.pid,loopId:loop.loopId,inclusiveDueMs,exclusiveBarrierMs,
    firstProbeMs,expected:expectedIndices.length,assigned:selected.map((warning,i) => {
      const {file,line,entry} = warning;
      assert(!unique.has(warning),'A warning was assigned more than once');
      unique.add(warning);
      assert.equal(entry.nodeId,loop.triggerNodeId,label);
      const contract = binding.diagnostics[target === 'items' ? 'item' : 'single'];
      assert.equal(entry.code,contract.code,label);
      assert.equal(entry.reason,contract.reason,label);
      assert.equal(entry.msg,contract.message,label);
      const fields = target === 'items' ? [...metadataFields,'itemIndex'] : [...metadataFields];
      assert.deepEqual(Object.keys(entry).sort(),fields.sort(),label);
      if (target === 'items') assert.equal(entry.itemIndex,expectedIndices[i],label);
      const bytes = Buffer.byteLength(JSON.stringify(entry),'utf8');
      assert(bytes < 512,label);
      return {file,line,entry,bytes,fromDueMs:entry.time-inclusiveDueMs,fromProbeReceivedMs:entry.time-firstProbeMs};
    })});
}
for (const target of wire.targetOrder) {
  const windows = assignments.filter((window) => window.target === target).sort((a,b) => a.inclusiveDueMs-b.inclusiveDueMs);
  for (let i = 1; i < windows.length; i += 1) assert(windows[i-1].exclusiveBarrierMs <= windows[i].inclusiveDueMs,target);
}
assert.equal(unique.size,warnings.length);
const discrepancies = assignments.flatMap(({label,assigned}) =>
  assigned.filter((warning) => warning.fromProbeReceivedMs < 0).map(({file,line,fromDueMs,fromProbeReceivedMs}) =>
    ({label,file,line,fromDueMs,fromProbeReceivedMs})));
assert.deepEqual(discrepancies,[
  {label:'corrected-lone-P3',file:'initial-gateway.log',line:164,fromDueMs:30,fromProbeReceivedMs:-1},
  {label:'corrected-split-P3',file:'initial-gateway.log',line:165,fromDueMs:31,fromProbeReceivedMs:-1},
]);
const receipt = {schema:'graphgoblin-361-offline-diagnostic-reanalysis/v1', at:new Date().toISOString(),
  candidate:{head:binding.head,tree:binding.tree}, scriptSha256:sha(await readFile(script)), exactInputs:{...required,...inputs},
  warningSourceHashes:binding.diagnostics.sourceSha256, observations:assignments.length, uniqueAssignments:unique.size,
  limits:'Retained-log readback only. Original native result and checker failure stay unchanged.',
  originalFailure:result.failure,
  lowerBound:'armed.nextPollAt, the due time from the gateway that emitted the warning',
  upperBound:'later inert request reception, exclusive',
  identity:'gateway PID, exact loop ID and trigger node',
  allPerLoopWindowsNonoverlapping:true, warningCanaryMatches:0, discrepancies, assignments};
await writeFile(join(out,'receipt.json'),JSON.stringify(receipt,null,2) + '\n',{flag:'wx'});
process.stdout.write(JSON.stringify({observations:assignments.length,warnings:unique.size,discrepancies,
  receiptSha256:sha(JSON.stringify(receipt,null,2) + '\n')}) + '\n');
