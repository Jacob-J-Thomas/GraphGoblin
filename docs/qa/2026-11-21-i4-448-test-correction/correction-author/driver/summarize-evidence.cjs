'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const evidence = path.dirname(__dirname);
const repo = process.cwd();
const sourcePath = 'apps/api/src/preflight-catalog.test.ts';
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const ts = require(path.join(repo, 'node_modules/typescript'));
const original = fs.readFileSync(path.join(evidence, 'originals/preflight-catalog.test.ts'), 'utf8');
const current = fs.readFileSync(path.join(repo, sourcePath), 'utf8');
function assertionStatements(text) {
  const source = ts.createSourceFile('test.ts', text, ts.ScriptTarget.Latest, true);
  const statements = [];
  function visit(node) {
    if (ts.isExpressionStatement(node)) {
      const value = node.getText(source).replace(/\r\n/g, '\n');
      if (/^(?:await )?expect\(/.test(value)) statements.push(value);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return statements;
}
const oldAssertions = assertionStatements(original);
const remainingAssertions = assertionStatements(current);
const removed = [];
for (const assertion of oldAssertions) {
  const index = remainingAssertions.indexOf(assertion);
  if (index < 0) removed.push(assertion);
  else remainingAssertions.splice(index, 1);
}
assert.equal(removed.length, 4);
assert(removed.every((item) => item === 'expect(await storeBytes(dbFile)).toEqual(before);'));
const counts = (text) => ({ startCallSites: (text.match(/await container\.start\(\);/g) ?? []).length, timersDisabled: text.includes('startTimers: false,') });
assert.deepEqual(counts(current), counts(original));
assert.equal(counts(current).startCallSites, 2); // Two positive + two disabled parameterized cases.
const sourceBindings = JSON.parse(fs.readFileSync(path.join(evidence, 'originals/source-bindings.json'), 'utf8'));
const unchangedBindings = sourceBindings.bindings.filter((item) => item.path !== sourcePath).map((item) => {
  const actual = hash(fs.readFileSync(path.join(repo, item.path)));
  assert.equal(actual, item.sha256, item.path);
  return { ...item, unchanged: true };
});
const finalEvents = fs.readFileSync(path.join(evidence, 'commands/08-final-single-file.observer.jsonl'), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
assert.equal(finalEvents.filter((item) => item.event === 'blocked-fetch' || item.event === 'blocked-socket').length, 0);
const installed = finalEvents.filter((item) => item.event === 'observer-installed');
const exits = finalEvents.filter((item) => item.event === 'observer-exit');
for (const item of exits) assert(item.fetchAttempts === 0 && item.socketAttempts === 0);
const missingExitSummaries = installed.filter((item) => !exits.some((end) => end.pid === item.pid)).map((item) => item.pid);
const fixtureGroups = new Map();
for (const item of finalEvents) {
  if (!item.event.startsWith('storage-')) continue;
  const directory = item.event === 'storage-listing' ? item.path : path.dirname(item.path);
  if (!fixtureGroups.has(directory)) fixtureGroups.set(directory, { directory, listings: [], reads: [] });
  const group = fixtureGroups.get(directory);
  if (item.event === 'storage-listing') group.listings.push({ utc: item.utc, names: item.names });
  else group.reads.push({ utc: item.utc, name: path.basename(item.path), size: item.size, sha256: item.sha256 });
}
const blobDirectory = path.join(evidence, 'fixtures/blobs');
const blobs = fs.readdirSync(blobDirectory).map((name) => {
  const bytes = fs.readFileSync(path.join(blobDirectory, name));
  const sha256 = hash(bytes);
  assert.equal(name, sha256 + '.blob');
  const result = { name, size: bytes.length, sha256 };
  if (bytes.length > 32 && [0x377f0682, 0x377f0683].includes(bytes.readUInt32BE(0))) {
    const pageSize = bytes.readUInt32BE(8);
    result.wal = { pageSize, frames: (bytes.length - 32) / (24 + pageSize) };
  }
  return result;
});
const strict = fs.readFileSync(path.join(evidence, 'originals/counterfactual-strict-valid.test.ts'), 'utf8');
function outsideHelper(text) {
  const start = text.indexOf('function expectStoreUnchanged(');
  const end = text.indexOf('async function storedCatalog(', start);
  assert(start >= 0 && end > start);
  return (text.slice(0, start) + text.slice(end)).replace(/\r\n/g, '\n');
}
assert.equal(outsideHelper(strict), outsideHelper(current));
const summary = {
  head: cp.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  status: cp.execFileSync('git', ['status', '--porcelain=v1'], { encoding: 'utf8' }).trim().split(/\r?\n/),
  originalSha256: hash(Buffer.from(original)), finalSha256: hash(Buffer.from(current)),
  finalGitBlob: cp.execFileSync('git', ['hash-object', '--', sourcePath], { encoding: 'utf8' }).trim(),
  originalAssertions: oldAssertions.length, preservedOriginalAssertions: oldAssertions.length - removed.length,
  replacedAssertions: removed, originalAndFinalStartSites: counts(current), unchangedBindings,
  validCounterfactualDiffersOnlyWithinHelper: true,
  outbound: { observedProcesses: installed.map((item) => ({ pid: item.pid, argv: item.argv })), fetchAttempts: 0, socketAttempts: 0, missingExitSummaries, note: 'Every blocked attempt is logged synchronously before rejection. Worker exit callbacks are not guaranteed by Vitest process termination.' },
  fixtureGroups: [...fixtureGroups.values()], blobs,
};
assert.deepEqual(summary.status, ['M apps/api/src/preflight-catalog.test.ts']);
fs.writeFileSync(path.join(evidence, 'observations/evidence-summary.json'), JSON.stringify(summary, null, 2) + '\n');
process.stdout.write(JSON.stringify({ head: summary.head, originalSha256: summary.originalSha256, finalSha256: summary.finalSha256, finalGitBlob: summary.finalGitBlob, originalAssertions: summary.originalAssertions, preservedOriginalAssertions: summary.preservedOriginalAssertions, replacedStorageAssertions: removed.length, observerProcesses: installed.length, outboundAttempts: 0, fixtureGroups: fixtureGroups.size, verifiedBlobs: blobs.length, genuineWalBlobs: blobs.filter((item) => item.wal), sourceAndDocsUnchanged: unchangedBindings.length, validCounterfactualDiffersOnlyWithinHelper: true }, null, 2) + '\n');
