// Adapt the implementer's documented public API regression fixture to this independent run.
// Only ports, temporary prefixes, evidence destinations and additional assertions change.
import { readFile, writeFile } from 'node:fs/promises';
const source = 'docs/qa/2026-10-21-wp-d2-report';
const target = 'docs/qa/2026-10-21-wp-d2-qa';
let s = await readFile(source + '/retired-return.acceptance.mjs', 'utf8');
s = s
  .replaceAll('docs/qa/2026-10-21-wp-d2-report', target)
  .replaceAll('gg-wp-d2-r4-fixture.json', 'gg-qa-246-upgrade-manifest.json')
  .replaceAll('gg-wp-d2-retired-return-', 'gg-qa-246-upgrade-')
  .replaceAll('5800 + i', '5812 + i')
  .replaceAll('length: 10', 'length: 7')
  .replaceAll('5800-5809', '5812-5818');
s = s.replace(
  'const summary = {',
  `
  const imported = state.events.filter(e => e.type === 'delivery.attempt_finished' && JSON.parse(e.payload).delivery.lastError?.code === 'interrupted');
  assert.equal(imported.length, 1);
  assert.equal(JSON.parse(imported[0].payload).delivery.maxAttempts, 5);
  assert.equal(JSON.parse(imported[0].payload).delivery.attempts, 1);
  assert.equal(childRun.deliveries[0].maxAttempts, 5);
  assert.equal(childRun.deliveries[0].attempts, 2);
  assert.equal(childRun.deliveries[0].status, 'delivered');
  assert.equal(requests, 2); // old unknown request plus one resumed current-build request
  const summary = {
    evidenceProcedure: 'Fresh archived old API store; independent execution of documented fixture with additional migration assertions',
    storeRoot: '%TEMP%/' + basename(fixture.root),
    originalState: fixture.original,
    migratedState: state,
    childApiEvents: childEvents,
    parentApiEvents: parentEvents,
    migrationImport: imported,
    receiverRequests: requests,
    apiLogs: logs,
`,
);
s = s.replace(
  "JSON.stringify(summary, null, 2) + '\\n'",
  "JSON.stringify(summary, null, 2).replaceAll(workspace, '%WORKTREE%').replaceAll(process.env.TEMP, '%TEMP%').replaceAll(process.env.USERPROFILE, '%USERPROFILE%') + '\\n'",
);
s = s.replace(
  'await rm(manifest, { force: true });',
  "await rm(manifest, { force: true });\n    await writeFile(join(evidence, 'upgrade-cleanup.json'), JSON.stringify({root: '%TEMP%/' + basename(fixture.root), removed: true}));",
);
await writeFile(target + '/upgrade.mjs', s);
await writeFile(target + '/base-loader.mjs', await readFile(source + '/base-loader.mjs', 'utf8'));
