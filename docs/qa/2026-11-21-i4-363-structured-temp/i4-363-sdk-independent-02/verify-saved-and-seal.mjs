// Saved-state verification and artifact sealing only; no behavior/product import or fixture retry.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const out = path.dirname(fileURLToPath(import.meta.url)); const q = path.dirname(out);
const hash = (b) => crypto.createHash('sha256').update(b).digest('hex');
const load = (name) => JSON.parse(fs.readFileSync(path.join(out, name), 'utf8').replace(/^\uFEFF/, ''));
const original = load('observations.json'); const native = load('native-corrected-01/observations.json'); const abort = load('abort-corrected-01/observations.json');
assert.equal(original.final.pass, 0); assert.equal(original.final.fail, 8); assert.equal(native.final.pass, 2); assert.equal(native.final.fail, 0); assert.equal(abort.final.pass, 0); assert.equal(abort.final.fail, 2);
const schema = load('run-input.json').schema;
const rows = [];
function shared(row, packet) {
  const state = row.state; assert.equal(row.process.status, 0); assert.equal(state.fixtureFailure, undefined);
  assert.equal(state.schemaDirExistsAfter, false); assert.equal(state.scratchExistsAfter, false);
  assert(state.sentinelContents.every((item) => item.actual === item.expected));
  assert.deepEqual(state.after.filter((name) => name.startsWith('gg-schema-') || name.startsWith('gg-structured-')).sort(), ['gg-schema-SENTINEL', 'gg-structured-sentinel'].sort());
  const read = row.tier === 'harmless' ? state.turn : state.requests[0];
  assert(read); assert.deepEqual(read.schema, schema); assert.equal(read.schemaText, JSON.stringify(schema));
  const scratch = row.tier === 'harmless' ? read.cwd : read.scratch; assert.deepEqual(row.tier === 'harmless' ? read.cwdEntries : read.scratchEntries, []);
  if (row.root === '226') { assert.equal(scratch.length, 249); assert.equal(read.schemaDirLength, 243); assert.equal(read.schemaFileLength, 255); }
  assert.equal(fs.existsSync(packet.owner), false);
  return { id: row.id, packet: packet === original ? 'original-v1' : packet === native ? 'native-corrected-v2' : 'abort-corrected-v3', originalDriverStatus: row.status, actualOutcome: state.outcome.kind, schemaDirLength: read.schemaDirLength, schemaFileLength: read.schemaFileLength, scratchLength: scratch.length, schemaMatches: true, scratchAndSchemaRemoved: true, sentinelsPreserved: true };
}
for (const row of original.cases) {
  const saved = shared(row, original);
  assert(row.failure.message.includes('state.children.length >= 2')); assert.equal(row.state.children.length, 0);
  if (row.mode === 'success') { assert.equal(row.state.outcome.kind, 'resolved'); assert.deepEqual(row.state.outcome.value.value, { proof: 'sdk363', ok: true }); }
  if (row.mode === 'error') { assert.equal(row.state.outcome.kind, 'rejected'); assert.equal(row.state.outcome.error.code, 'HARNESS_TURN_FAILED'); assert(row.state.outcome.error.message.includes('code 7')); }
  if (row.mode === 'abort') {
    assert(row.state.outcome.error.message.includes('ERR_MODULE_NOT_FOUND'));
    assert.equal(row.state.abortObservation.schemaFileExists, false);
    saved.disposition = 'INVALID_ABORT_FIXTURE: preload fell through to nonexistent exec before cancellation; not counted as abort QA';
  } else saved.disposition = 'PRODUCT_OUTCOME_CONFIRMED; v1 missing child telemetry retained';
  if (row.tier === 'native') { assert.equal(row.state.requests.length, 1); assert.deepEqual(row.state.requests[0].body.text.format.schema, schema); assert.equal(row.state.requests[0].body.text.format.strict, true); }
  rows.push(saved);
}
for (const row of native.cases) {
  const saved = shared(row, native); assert.equal(row.status, 'PASS'); assert.equal(row.state.requests.length, 1); assert.deepEqual(row.state.unexpectedRequests, []);
  assert.deepEqual(row.state.requests[0].body.text.format.schema, schema); assert.equal(row.state.requests[0].body.text.format.strict, true);
  assert.deepEqual(row.state.outcome.value.value, { proof: 'sdk363', ok: true });
  assert(row.state.children.every((child) => child.pid > 0 && child.exited && child.exitCode === 0));
  const cli = row.state.children.find((child) => path.basename(child.executable) === 'codex.exe'); assert(cli);
  saved.nativePid = cli.pid; saved.nativeExitCode = cli.exitCode; saved.requests = 1; saved.disposition = 'PASS: corrected native-pair driver and saved-state readback'; rows.push(saved);
}
for (const row of abort.cases) {
  const saved = shared(row, abort); assert.equal(row.status, 'FAIL'); assert(row.failure.message.includes('state.children.every'));
  assert.equal(row.state.outcome.error.name, 'AbortError'); assert.equal(row.state.abortObservation.schemaFileExists, true); assert.equal(row.state.abortObservation.scratchExists, true);
  assert(row.state.children.every((child) => child.pid > 0));
  assert.equal(row.state.handleTermination.length, row.state.children.length);
  assert(row.state.handleTermination.every((child) => child.exitCode !== null || child.signalCode !== null));
  assert.deepEqual(row.state.liveHandles, []);
  const turnHandle = row.state.handleTermination.find((child) => child.pid === row.state.turn.pid); assert(turnHandle && turnHandle.signalCode === 'SIGTERM');
  saved.pid = turnHandle.pid; saved.signalCode = turnHandle.signalCode;
  saved.disposition = 'PRODUCT_ABORT_AND_CLEANUP_CONFIRMED from native process-handle signal/exit properties; SDK removed exit listener, raw failing event assertion retained'; rows.push(saved);
}
for (const [name, expected] of [['i4-363-sdk-boundary-01', '49b577d1a6776ad8c0cd6ca429b5eeec9e70bd56984b03d738c88c4d6c552bc3'], ['i4-363-independent-01', 'e4047b7378b612194b3f47ed11e19aac3f2c4d8f80f81c1b46524116ee844c9b']]) {
  const bytes = fs.readFileSync(path.join(q, name, 'manifest.json')); assert.equal(hash(bytes), expected);
  for (const file of JSON.parse(bytes).files) assert.equal(hash(fs.readFileSync(path.join(q, name, file.path))), file.sha256);
}
for (const filename of ['source-binding.json', 'native-corrected-01/source-binding.json', 'abort-corrected-01/source-binding.json']) for (const value of Object.values(load(filename).sources)) assert.equal(hash(fs.readFileSync(value.path)), value.sha256);
const binding = load('source-binding.json');
const git = (...args) => execFileSync('git', args, { cwd: binding.checkout, windowsHide: true }).toString();
assert.equal(git('status', '--porcelain=v1'), ''); assert.equal(git('rev-parse', 'HEAD').trim(), binding.head); assert.equal(git('branch', '--show-current').trim(), '');
const processReadback = load('raw/final-owned-process-readback-02.json'); assert.equal(processReadback.count, 0); assert.deepEqual(processReadback.knownPidsPresentNow, []);
const result = { at: new Date().toISOString(), behaviorCalls: 12, originalDriver: { pass: 0, fail: 8, exit: 1 }, correctedNativeDriver: { pass: 2, fail: 0, exit: 0 }, correctedAbortDriver: { pass: 0, fail: 2, exit: 1 }, readbackOnly: true, intendedContractScenariosEstablished: 8, harmlessSuccessError: 4, harmlessAbortFromCorrectedFixtures: 2, nativeShortLongFromCorrectedPair: 2, invalidOriginalAbortCases: 2, syntheticNativeRequestsTotal: 4, liveProviderRequests: 0, originalSealedQaFilesUnchanged: true, sourceUnchanged: true, checkoutDetachedAndClean: true, ownedProcessCommandMatches: 0, ownersRemoved: true, cases: rows, gaps: ['Original v1 child telemetry was absent due to early filtering; original statuses remain FAIL.', 'Corrected abort exit events were removed by SDK; public ChildProcess exit/signal properties and final CIM absence establish termination.', 'Synthetic loopback Responses verifies native CLI boundary, not live account/model entitlement.', 'No full monorepo build or coverage run by this agent.'] };
fs.writeFileSync(path.join(out, 'readback-analysis.json'), JSON.stringify(result, null, 2) + '\n');
if (process.argv.includes('--seal')) {
  const entries = []; const walk = (directory) => { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) { const target = path.join(directory, entry.name); if (entry.isDirectory()) walk(target); else if (target !== path.join(out, 'manifest.json')) { const bytes = fs.readFileSync(target); entries.push({ path: path.relative(out, target).replaceAll('\\', '/'), bytes: bytes.length, sha256: hash(bytes) }); } } };
  walk(out); entries.sort((a, b) => a.path.localeCompare(b.path));
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ at: new Date().toISOString(), head: binding.head, tree: binding.tree, files: entries, excludes: ['manifest.json self hash returned separately'] }, null, 2) + '\n');
  console.log(JSON.stringify({ casesEstablishedByReadback: 8, rawDriverCountsPreserved: true, artifacts: entries.length, manifestSha256: hash(fs.readFileSync(path.join(out, 'manifest.json'))), reportSha256: hash(fs.readFileSync(path.join(out, 'REPORT.md'))), sourcesUnchanged: true, originalsUnchanged: true }, null, 2));
} else console.log(JSON.stringify({ intendedScenariosEstablished: 8, originalDriver: result.originalDriver, correctedNative: result.correctedNativeDriver, correctedAbort: result.correctedAbortDriver, sourceUnchanged: true, originalSealedQaFilesUnchanged: true, ownersRemoved: true }, null, 2));
