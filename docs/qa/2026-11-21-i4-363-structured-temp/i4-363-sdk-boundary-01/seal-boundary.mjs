// Final readback and manifest only. Never imports or executes the behavior fixture.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const evidence = path.dirname(fileURLToPath(import.meta.url));
const checkout = 'G:/ggq/gg-i4-363-qa/GraphGoblin';
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const raw = JSON.parse(fs.readFileSync(path.join(evidence, 'observations.json')));
const binding = JSON.parse(fs.readFileSync(path.join(evidence, 'source-binding.json')));
const readback = JSON.parse(fs.readFileSync(path.join(evidence, 'readback-analysis.json')));
for (const source of Object.values(binding.sources)) assert.equal(hash(fs.readFileSync(source.path)), source.sha256);
assert.equal(execFileSync('git', ['status', '--porcelain=v1'], { cwd: checkout }).toString(), '');
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: checkout }).toString().trim(), binding.head);
assert.equal(readback.behaviorRunCount, 1);
assert.equal(raw.final.pass, 0);
assert.equal(raw.final.fail, 2);
assert(readback.cases.every((item) => item.readback === 'CONFIRMED' && item.behaviorRerun === false));
assert.equal(fs.existsSync(raw.owner), false);
const oldQa = path.join(path.dirname(evidence), 'i4-363-independent-01');
const oldManifestBytes = fs.readFileSync(path.join(oldQa, 'manifest.json'));
assert.equal(hash(oldManifestBytes), raw.final.originalQaManifestUnchanged);
for (const file of JSON.parse(oldManifestBytes).files) assert.equal(hash(fs.readFileSync(path.join(oldQa, file.path))), file.sha256, `Original sealed QA ${file.path}`);
const snippets = JSON.parse(fs.readFileSync(path.join(evidence, 'tsx-source-snippets.json')));
for (const snippet of snippets) {
  const bytes = fs.readFileSync(snippet.file);
  assert.equal(hash(bytes), snippet.sha256);
  fs.copyFileSync(snippet.file, path.join(evidence, 'sources', path.basename(snippet.file)));
}
const result = { at: new Date().toISOString(), head: binding.head, sdkVersion: binding.sdkVersion, sdkSha256: binding.sources.sdk.sha256, originalDriver: { exit: 1, pass: 0, fail: 2 }, readback: 'Both native product outcomes confirmed; no behavior rerun', productFinding: 'Long-root SDK output-schema mkdtemp failure confirmed', sourceHashesUnchanged: true, originalAllocatorQaAllManifestFilesUnchanged: true, checkoutClean: true, fixtureOwnerRemoved: true };
fs.writeFileSync(path.join(evidence, 'raw/final-seal-readback.json'), JSON.stringify(result, null, 2) + '\n');
const entries = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(target);
    else if (entry.name !== 'manifest.json') { const bytes = fs.readFileSync(target); entries.push({ path: path.relative(evidence, target).replaceAll('\\', '/'), bytes: bytes.length, sha256: hash(bytes) }); }
  }
}
walk(evidence);
entries.sort((a, b) => a.path.localeCompare(b.path));
const manifest = { at: new Date().toISOString(), evidence, head: binding.head, files: entries, excludes: ['manifest.json (self hash returned separately)'] };
fs.writeFileSync(path.join(evidence, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ ...result, artifacts: entries.length, manifestSha256: hash(fs.readFileSync(path.join(evidence, 'manifest.json'))), reportSha256: hash(fs.readFileSync(path.join(evidence, 'REPORT.md'))) }, null, 2));
