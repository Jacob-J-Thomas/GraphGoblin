import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// Evidence readback/sealing only; never imports or runs the behavior fixture.
const evidence = path.dirname(fileURLToPath(import.meta.url));
const checkout = 'G:/ggq/gg-i4-363-qa/GraphGoblin';
const git = (...args) => execFileSync('git', args, { cwd: checkout, windowsHide: true }).toString();
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const observations = JSON.parse(fs.readFileSync(path.join(evidence, 'observations.json')));
const binding = JSON.parse(fs.readFileSync(path.join(evidence, 'source-binding.json')));
const predictions = JSON.parse(fs.readFileSync(path.join(evidence, 'predictions.json')));
const trace = fs.readFileSync(path.join(evidence, 'raw/native-run-01.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
assert.equal(observations.final.pass, 19);
assert.equal(observations.final.fail, 0);
assert.equal(observations.cases.length, predictions.cases.length);
assert.deepEqual(new Set(observations.cases.map((item) => item.id)), new Set(predictions.cases.map((item) => item.id)));
assert(observations.cases.every((item) => item.status === 'PASS' && item.residueAfterQaRecovery.length === 0));
assert.equal(trace.filter((event) => event.kind === 'case-start').length, 19);
assert.equal(trace.filter((event) => event.kind === 'case-finish').length, 19);
const recovered = observations.cases.flatMap((item) => item.residueBeforeQaRecovery);
assert.equal(recovered.length, 6);
assert(recovered.every((target) => !fs.existsSync(target)));
assert.equal(fs.existsSync(observations.owner), false);
assert.equal(git('rev-parse', 'HEAD').trim(), binding.head);
assert.equal(git('rev-parse', 'HEAD^{tree}').trim(), binding.tree);
assert.equal(git('status', '--porcelain=v1'), '');
assert.equal(hash(fs.readFileSync(binding.candidate.path)), binding.candidate.sha256);
assert.equal(hash(fs.readFileSync(binding.fixture.path)), binding.fixture.sha256);
assert.equal(hash(fs.readFileSync(path.join(checkout, 'pnpm-lock.yaml'))), binding.lockSha256);
const result = { at: new Date().toISOString(), kind: 'Readback and artifact sealing only; no behavior rerun', behaviorRunCount: 1, casesRead: observations.cases.length, traceEventsRead: trace.length, pass: observations.final.pass, fail: observations.final.fail, syntheticCleanupResiduesRecovered: recovered.length, sourceUnchanged: true, fixtureHashMatchesPreRun: true, cleanCheckout: true, head: binding.head, tree: binding.tree, ownerAbsent: true, recoveredPathsAbsent: true };
fs.writeFileSync(path.join(evidence, 'raw/seal-readback.json'), JSON.stringify(result, null, 2) + '\n');
const entries = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(target);
    else if (entry.name !== 'manifest.json') {
      const bytes = fs.readFileSync(target);
      entries.push({ path: path.relative(evidence, target).replaceAll('\\', '/'), bytes: bytes.length, sha256: hash(bytes) });
    }
  }
}
walk(evidence);
entries.sort((a, b) => a.path.localeCompare(b.path));
const manifest = { createdAt: new Date().toISOString(), evidence, binding: { head: binding.head, tree: binding.tree }, excludes: ['manifest.json (self hash returned in tool output)'], files: entries };
const manifestPath = path.join(evidence, 'manifest.json');
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ ...result, artifacts: entries.length, manifestSha256: hash(fs.readFileSync(manifestPath)), observationsSha256: hash(fs.readFileSync(path.join(evidence, 'observations.json'))), reportSha256: hash(fs.readFileSync(path.join(evidence, 'REPORT.md'))) }, null, 2));
