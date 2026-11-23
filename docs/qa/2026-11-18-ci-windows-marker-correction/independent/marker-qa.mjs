import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [helper, repoRoot, output, label] = process.argv.slice(2);
const h = await import(pathToFileURL(helper).href);
mkdirSync(output, { recursive: true });
const runnerTemp = realpathSync.native(mkdtempSync(join(output, 'runner-')));
const at = '2026-11-18T20:00:00.000Z';
const id = 'a1111111-1111-4111-8111-111111111111';
const supported = ['recorder-open', 'recorder-closed', 'overflow', 'rejected', 'case-start', 'case-end', 'child', 'fixture', 'fixture-state', 'alias', 'alias-round', 'contention', 'cleanup'];
const negative = [
  ['null', null], ['undefined', undefined], ['true', true], ['false', false],
  ['zero', 0], ['one', 1], ['empty-string', ''], ['wrong-case', 'Child'],
  ['unsupported-string', 'future-kind'], ['empty-array', []], ['array-child', ['child']],
  ['array-cleanup', ['cleanup']], ['plain-object', {}], ['boxed-child', new String('child')],
  ['boxed-number', new Number(1)], ['symbol', Symbol('marker')], ['bigint', 1n],
];
const entries = [];
function check(group, name, fn) {
  try { entries.push({ group, name, passed: true, actual: fn() }); }
  catch (error) { entries.push({ group, name, passed: false, error: error.message }); }
}
const record = (seq, type, fields) => ({ seq, at, type, ...fields });
const marker = (value) => record(3, 'rejected', { recordType: value });
const stream = (value, evidenceId = id) => Buffer.from([
  record(1, 'recorder-open', { evidenceId }), marker(value),
  record(4, 'recorder-closed', { written: 2, rejected: 1, omittedRecords: 0, omittedBytes: 0 }),
].map((r) => JSON.stringify(r)).join('\n') + '\n');
const setup = () => {
  const env = { RUNNER_TEMP: runnerTemp };
  const initialized = h.initializeEvidence({ env, repoRoot, now: () => new Date(at) });
  return { runnerTemp, ...initialized };
};
const finalEnv = (s, native) => ({
  RUNNER_TEMP: s.runnerTemp,
  [h.DIRECTORY_VARIABLE]: s.directory,
  [h.ID_VARIABLE]: s.evidenceId,
  GG_TEST_EVIDENCE_INSTALL_OUTCOME: 'success', GG_TEST_EVIDENCE_BUILD_OUTCOME: 'success',
  GG_TEST_EVIDENCE_NATIVE_OUTCOME: native,
});

for (const value of [...supported, 'unknown']) {
  check('validator-positive', value, () => {
    assert.equal(h.validateRecord(marker(value)), true);
    assert.equal(h.parseObservations(stream(value), id).state, 'valid');
    return { primitiveType: typeof value, parsed: 'valid' };
  });
}
for (const [name, value] of negative) {
  check('validator-negative', name, () => {
    assert.equal(h.validateRecord(marker(value)), false);
    return { primitiveType: typeof value, accepted: false };
  });
}
const producer = setup();
const stdout = [];
const env = { RUNNER_TEMP: runnerTemp, [h.DIRECTORY_VARIABLE]: producer.directory };
const recorder = h.openWindowsLauncherEvidence({ env, repoRoot, log: (line) => stdout.push(line), onExit: () => {}, now: () => new Date(at) });
assert.equal(recorder.state, 'recording');
for (const type of supported) {
  check('producer-supported', type, () => {
    const actual = recorder.record(type, {});
    assert.equal(actual?.type, 'rejected');
    assert.equal(actual.recordType, type);
    assert.equal(typeof actual.recordType, 'string');
    return { recordType: actual.recordType, primitiveType: typeof actual.recordType };
  });
}
for (const [name, type] of [...negative, ['unknown-string', 'unknown']]) {
  check('producer-unsupported', name, () => {
    const actual = recorder.record(type, {});
    assert.equal(actual?.type, 'rejected');
    assert.equal(actual.recordType, 'unknown');
    assert.equal(typeof actual.recordType, 'string');
    return { recordType: actual.recordType, primitiveType: typeof actual.recordType };
  });
}
recorder.close();
const produced = readFileSync(join(producer.directory, h.FILES.observations));
writeFileSync(join(output, `${label}-producer.ndjson`), produced);
check('producer-stream', 'closed-accounted-and-readable', () => {
  const parsed = h.parseObservations(produced, producer.evidenceId);
  assert.equal(parsed.state, 'valid');
  assert.equal(parsed.records.at(-1).rejected, supported.length + negative.length + 1);
  assert.equal(parsed.records.filter((r) => r.type === 'rejected').length, supported.length + negative.length + 1);
  assert.equal(parsed.records.every(h.validateRecord), true);
  return { state: parsed.state, records: parsed.records.length, rejected: parsed.records.at(-1).rejected };
});
for (const [name, value, valid] of [
  ['child', 'child', true], ['unknown', 'unknown', true], ['unsupported-string', 'future-kind', false],
  ['array-child', ['child'], false], ['array-cleanup', ['cleanup'], false],
  ['plain-object', {}, false], ['null', null, false], ['boolean', true, false], ['number', 1, false], ['missing', undefined, false],
]) {
  for (const native of ['success', 'failure']) {
    check('reader-finalizer', `${name}-${native}`, () => {
      const s = setup();
      const bytes = stream(value, s.evidenceId);
      writeFileSync(join(s.directory, h.FILES.observations), bytes);
      const parsed = h.parseObservations(bytes, s.evidenceId);
      assert.equal(parsed.state, valid ? 'valid' : 'rejected');
      assert.equal(parsed.reason, valid ? null : 'invalid-record');
      const result = h.finalizeEvidence({ env: finalEnv(s, native), repoRoot, now: () => new Date(at) });
      assert.equal(result.status, native === 'failure' ? 'native-failed' : 'incomplete');
      assert.equal(result.exitCode, valid && native === 'failure' ? 0 : 1);
      assert.deepEqual(result.upload.map((path) => basename(path)), valid ? [h.FILES.manifest, h.FILES.result, h.FILES.observations] : [h.FILES.manifest, h.FILES.result]);
      assert.equal(result.result.observations.state, valid ? 'valid' : 'rejected');
      return { native, status: result.status, exitCode: result.exitCode, observations: result.result.observations, upload: result.upload.map((path) => basename(path)) };
    });
  }
}

const report = { label, node: process.version, helper, sha256: createHash('sha256').update(readFileSync(helper)).digest('hex'), runnerTemp, totals: { passed: entries.filter((e) => e.passed).length, failed: entries.filter((e) => !e.passed).length }, entries };
writeFileSync(join(output, `${label}-results.json`), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ label, ...report.totals, sha256: report.sha256 }));
for (const entry of entries.filter((e) => !e.passed)) console.log(JSON.stringify(entry));
process.exitCode = report.totals.failed > 0 ? 1 : 0;
