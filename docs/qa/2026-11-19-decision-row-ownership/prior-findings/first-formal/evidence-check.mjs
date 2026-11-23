import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const repo = path.resolve(process.argv[2] ?? process.cwd());
const read = async p => JSON.parse(await fs.readFile(path.join(repo, p), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const checks = [];
const check = (name, condition) => { assert.ok(condition, name); checks.push(name); };
const shared = 'docs/qa/2026-11-19-shared-edge-records';
const focus = 'docs/qa/2026-11-19-chat-recovery-focus';
const browser = 'docs/qa/2026-11-19-chat-browser-recovery';
const manifests = [];
for (const root of [shared, focus, browser]) {
  const manifest = await read(`${root}/publication-manifest.json`);
  const seen = new Set();
  for (const entry of manifest.files) {
    assert.ok(!seen.has(entry.path)); seen.add(entry.path);
    const bytes = await fs.readFile(path.join(repo, root, entry.path));
    assert.equal(bytes.length, entry.bytes, entry.path);
    assert.equal(hash(bytes), entry.sha256, entry.path);
  }
  check(`${root}: all ${seen.size} listed bytes and hashes`, true);
  manifests.push({ root, verifiedFiles: seen.size });
}
const binding = await read(`${shared}/source-binding.json`);
for (const [p, expected] of Object.entries(binding.correctedSourceFileSha256)) {
  assert.equal(hash(await fs.readFile(path.join(repo, p))), expected, p);
}
check('all 16 current corrected-source files match the historical tested byte hashes', Object.keys(binding.correctedSourceFileSha256).length === 16);

const root = `${shared}/corrected-editor-qa/records`;
const metadata = await read(`${root}/metadata.json`);
const m = Object.fromEntries(metadata.map(sample => [sample.phase, sample]));
for (const sample of metadata) {
  const d = sample.device;
  check(`${sample.phase}: actual own nonempty unsynced ownership table`, Object.hasOwn(d, 'decisionRoutes') && d.synced === false && Object.values(d.decisionRoutes).some(table => table.rows.length > 0));
}
assert.deepEqual(m['01-label'].device.definition, m['03-rename-undo'].device.definition);
assert.deepEqual(m['01-label'].device.decisionRoutes, m['03-rename-undo'].device.decisionRoutes);
assert.deepEqual(m['02-rename'].device.definition, m['04-rename-redo'].device.definition);
assert.deepEqual(m['02-rename'].device.decisionRoutes, m['04-rename-redo'].device.decisionRoutes);
assert.deepEqual(m['06-cancelled'].device.definition, m['04-rename-redo'].device.definition);
assert.deepEqual(m['08-removal-undo'].device.definition, m['06-cancelled'].device.definition);
assert.deepEqual(m['08-removal-undo'].device.decisionRoutes, m['06-cancelled'].device.decisionRoutes);
assert.deepEqual(m['07-removed'].device.definition, m['09-removal-redo'].device.definition);
assert.deepEqual(m['07-removed'].device.decisionRoutes, m['09-removal-redo'].device.decisionRoutes);
assert.deepEqual(m['09-removal-redo'].device.definition, m['11-offline-reloaded'].device.definition);
assert.deepEqual(m['09-removal-redo'].device.decisionRoutes, m['11-offline-reloaded'].device.decisionRoutes);
check('actual definition and ownership Undo/Redo/Cancel/offline-reload pairs compare exactly', true);

const native = await read(`${root}/native.json`);
const n = Object.fromEntries(native.map(sample => [sample.phase, sample]));
for (const phase of ['cold-pointer-03-after-reset', 'cold-pointer-04-after-remove', 'keyboard-01-after']) {
  assert.deepEqual(n[phase].server.definition, n['cold-pointer-01-before'].server.definition);
}
check('cold pointer and keyboard refusal definitions compare exactly', true);
const recovery = await read(`${root}/recovery.json`);
check('the first 15000ms reconnect timeout remains recorded', recovery.timing.initialWait.timeoutMs === 15000 && recovery.timing.initialWait.outcome === 'timeout');
check('first recovered device remained unsynced', recovery.readbacks[0].device.synced === false);
check('later same-journey recovered server/device match the offline draft', recovery.readbacks[1].device.synced === true);
assert.deepEqual(recovery.readbacks[1].server.definition, m['11-offline-reloaded'].device.definition);
assert.deepEqual(recovery.readbacks[1].device.definition, m['11-offline-reloaded'].device.definition);

const beforeVoice = n['voice-01-before'].server.definition;
assert.deepEqual(beforeVoice, n['voice-03-after-refusal'].server.definition);
assert.deepEqual(beforeVoice, n['voice-05-reset-undo'].server.definition);
assert.deepEqual(n['voice-04-unique-reset'].server.definition, n['voice-06-reset-redo'].server.definition);
check('protected removal refusal and unique Reset history compare exactly', true);
console.log(JSON.stringify({ result: 'pass', manifests, checksPassed: checks.length, checks }, null, 2));
