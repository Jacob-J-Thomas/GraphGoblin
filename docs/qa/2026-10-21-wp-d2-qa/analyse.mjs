import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const folder = 'docs/qa/2026-10-21-wp-d2-qa/';
const read = async (name) => JSON.parse(await readFile(folder + name, 'utf8'));
const native = await read('native.json');
const receiver = await read('receiver.json');
for (const test of native.cases) {
  for (const delivery of test.actual) {
    assert.equal(delivery.maxAttempts, 5);
    const path = new URL(delivery.channel.url).pathname;
    const received = receiver.filter((entry) => entry.path === path);
    if (received.length) assert.ok(received.every((entry) => entry.key === delivery.id));
  }
}
const upgrade = await read('verify.json');
assert.equal(upgrade.receiverRequests, 2);
assert.equal(upgrade.child.deliveries[0].maxAttempts, 5);
const importRow = JSON.parse(upgrade.migrationImport[0].payload).delivery;
assert.equal(importRow.attempts, 1);
assert.equal(importRow.maxAttempts, 5);
assert.equal(importRow.acknowledgement, 'unknown');
const summary = {
  currentHead: '77d767a6710e2fa04b92a3aa67893b430a926358',
  oldBuild: '52360d99def690d3cff9f36cc81a76b48c172582',
  nativeCasesPassed: native.cases.length,
  receiverRequests: receiver.length,
  identityHeadersMatchJournalIdentities: true,
  allCurrentBudgets: 5,
  upgrade: {
    originalRequests: 1,
    resumedRequests: 1,
    importedAttempts: 1,
    maxAttempts: 5,
    finalAttempts: upgrade.child.deliveries[0].attempts,
    warningsOnFirstStartup: upgrade.diagnostics.length,
    parentContinuations: upgrade.childFinishedNotifications,
    secondStartupUnchanged: upgrade.secondStartupUnchanged,
    originalHistoryAndDefinitionsUnchanged: upgrade.originalEventsAndDefinitionsUnchanged,
  },
};
await writeFile(folder + 'analysis.json', JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary));
