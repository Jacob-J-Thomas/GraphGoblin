import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [helper, repoRoot, output, bindingFile] = process.argv.slice(2);
const h = await import(pathToFileURL(helper).href);
mkdirSync(output, { recursive: true });
const runnerTemp = realpathSync.native(mkdtempSync(join(output, 'runner-')));
const bindings = JSON.parse(readFileSync(bindingFile, 'utf8'));
const results = [];
for (const binding of bindings) {
  const s = binding.freshCorpus;
  const rawManifest = readFileSync(join(s, h.FILES.manifest));
  const original = JSON.parse(readFileSync(join(s, h.FILES.result), 'utf8'));
  const manifest = h.parseManifest(rawManifest);
  assert.equal(manifest.evidenceId, original.evidenceId);
  const observationPath = join(s, h.FILES.observations);
  const bytes = existsSync(observationPath) ? readFileSync(observationPath) : null;
  const parsed = bytes === null ? { state: 'absent', reason: null, records: [] } : h.parseObservations(bytes, manifest.evidenceId);
  assert.equal(parsed.state, original.observations.state);
  assert.equal(parsed.reason, original.observations.reason);
  assert.equal(parsed.records.length, original.observations.records);
  const markers = parsed.records.filter((r) => r.type === 'rejected');
  assert.equal(markers.every((r) => typeof r.recordType === 'string' && h.validateRecord(r)), true);
  const directory = mkdtempSync(join(runnerTemp, h.DIRECTORY_PREFIX));
  copyFileSync(join(s, h.FILES.manifest), join(directory, h.FILES.manifest));
  if (bytes !== null) writeFileSync(join(directory, h.FILES.observations), bytes);
  const outcome = h.finalizeEvidence({
    env: {
      RUNNER_TEMP: runnerTemp,
      [h.DIRECTORY_VARIABLE]: directory, [h.ID_VARIABLE]: manifest.evidenceId,
      GG_TEST_EVIDENCE_INSTALL_OUTCOME: original.steps.install,
      GG_TEST_EVIDENCE_BUILD_OUTCOME: original.steps.build,
      GG_TEST_EVIDENCE_NATIVE_OUTCOME: original.steps.native,
    }, repoRoot, now: () => new Date(original.finalizedAt),
  });
  assert.deepEqual(outcome.result, original);
  assert.deepEqual(outcome.upload.map((path) => basename(path)), original.uploaded);
  assert.equal(outcome.exitCode, 0);
  const exitSeven = parsed.records.filter((r) => r.type === 'child' && r.exitCode === 7);
  if (binding.case === 'negative') {
    assert.ok(exitSeven.length > 0);
    assert.equal(markers.length, 1);
    assert.equal(original.observations.omittedRecords, 296);
    assert.equal(outcome.status, 'native-failed');
  }
  results.push({ case: binding.case, artifactId: binding.artifactId, runId: binding.runId, status: outcome.status, state: parsed.state, records: parsed.records.length, rejected: markers.map((r) => ({ recordType: r.recordType, primitiveType: typeof r.recordType })), omittedRecords: original.observations.omittedRecords, exitSeven: exitSeven.length, exactResultReplay: true, upload: original.uploaded, fixture: directory });
}
const report = { node: process.version, helper, sha256: createHash('sha256').update(readFileSync(helper)).digest('hex'), cases: results };
writeFileSync(join(output, 'replay-results.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
