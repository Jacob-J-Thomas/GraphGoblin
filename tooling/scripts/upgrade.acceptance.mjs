import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cp,
  copyFile,
  lstat,
  symlink,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
  access,
} from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argumentsFor, backupStoppedData, runUpgrade } from './upgrade.mjs';
import { acquireDataDirLock } from '../../apps/api/dist/data-dir-lock.js';
import {
  openDatabase,
  openReadOnlyDatabaseClient,
  guardDatabaseUpgrade,
  inspectDatabaseUpgrade,
} from '../../packages/infrastructure/dist/sqlite/index.js';
import {
  sampleThread,
  FIXTURE_IDS,
  FIXTURE_TS,
} from '../../packages/contracts/dist/testing/index.js';
import { upgradeExportV1 } from '../../packages/domain/dist/index.js';
const url = (file) => 'file:' + file.replaceAll('\\', '/');
const original = {
  schemaVersion: 1,
  name: 'offline-acceptance',
  settings: { defaults: { model: 'gpt-6-luna', effort: 'low' } },
  nodes: [
    { id: 'start', kind: 'trigger', label: 'Start', config: { subtype: 'manual' } },
    {
      id: 'decide',
      kind: 'decision',
      label: 'Choose',
      config: {
        question: 'Which?',
        strategy: ['codex', 'expression'],
        routes: [
          { label: 'yes', description: 'Approve' },
          { label: 'no', description: 'Reject' },
        ],
        expression: { jsonata: '"yes"' },
      },
    },
    {
      id: 'done',
      kind: 'exit',
      label: 'Done',
      config: { return: { mapping: 'lastOutput.value.route' } },
    },
  ],
  edges: [
    { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'decide' } },
    { id: 'b', from: { node: 'decide', port: 'yes' }, to: { node: 'done' } },
    { id: 'c', from: { node: 'decide', port: 'no' }, to: { node: 'done' } },
  ],
};
const resolutions = {
  decisions: {
    decide: {
      answer: {
        type: 'choice',
        options: [
          { id: 'yes', label: 'Approved', criteria: 'Approve' },
          { id: 'no', label: 'Rejected', criteria: 'Reject' },
        ],
      },
      evaluation: { kind: 'expression', jsonata: '"yes"' },
    },
  },
  sources: { '/nodes/2/config/return/mapping': 'lastOutput.value.answer.optionId' },
};
async function temporary(fn) {
  await mkdir(fileURLToPath(new URL('../../.tmp/', import.meta.url)), { recursive: true });
  const root = await mkdtemp(
    fileURLToPath(new URL('../../.tmp/upgrade-acceptance-', import.meta.url)),
  );
  // Retain disposable evidence: Windows native prepared statements can hold closed-file handles until GC.
  return fn(root);
}
async function seed(file, retainWal = false) {
  const handle = openDatabase({ url: url(file) });
  await handle.migrate();
  if (retainWal) {
    await handle.client.execute('PRAGMA journal_mode=WAL');
    await handle.client.execute('PRAGMA wal_autocheckpoint=0');
    await handle.client.execute('PRAGMA wal_checkpoint(TRUNCATE)');
  }
  await handle.client.execute('DROP TABLE gg_upgrade_state');
  await handle.client.execute({
    sql: 'INSERT INTO loop_versions(id,loop_id,version,status,definition,created_at,published_at) VALUES(?,?,1,?,?,?,?)',
    args: [
      FIXTURE_IDS.version,
      FIXTURE_IDS.loop,
      'published',
      JSON.stringify(original),
      FIXTURE_TS,
      FIXTURE_TS,
    ],
  });
  const thread = sampleThread();
  await handle.client.execute({
    sql: 'INSERT INTO runs(id,owner_id,loop_id,version_id,invocation_id,status,iteration,created_at,last_event_seq,initial_thread,thread_snapshot,failure) VALUES(?,?,?,?,?,?,?,?,0,?,?,?)',
    args: [
      FIXTURE_IDS.run,
      'local',
      FIXTURE_IDS.loop,
      FIXTURE_IDS.version,
      FIXTURE_IDS.invocation,
      'failed',
      1,
      FIXTURE_TS,
      JSON.stringify(thread),
      JSON.stringify(thread),
      JSON.stringify({
        code: 'DECISION_NO_ROUTE',
        message: 'No evaluator produced a route',
        resumable: true,
      }),
    ],
  });
  await handle.client.execute({
    sql: 'INSERT INTO settings(owner_id,key,value,updated_at) VALUES(?,?,?,?)',
    args: ['local', 'defaultModel', '"gpt-6-luna"', FIXTURE_TS],
  });
  if (retainWal) return handle;
  await handle.client.execute('PRAGMA journal_mode=DELETE');
  handle.close();
}
test('strict CLI argument surface refuses duplicates, absent and unknown values', () => {
  assert.equal(argumentsFor(['export', '--input', 'a', '--out', 'b']).command, 'export');
  for (const args of [
    [],
    ['invalid'],
    ['export', '--input', 'a'],
    ['export', '--input', 'a', '--input', 'b', '--out', 'c'],
    ['export', '--input', 'a', '--out', 'b', '--bad', 'c'],
    ['export', '--input', '--out', 'b'],
  ])
    assert.throws(() => argumentsFor(args));
});
test('portable refusal, explicit resolutions, new output and complete original preservation', () =>
  temporary(async (root) => {
    const input = join(root, 'old.json'),
      refused = join(root, 'refused.json'),
      converted = join(root, 'converted.json'),
      choices = join(root, 'choices.json');
    const bytes = JSON.stringify({
      format: 'graphgoblin-loop',
      formatVersion: 1,
      exportedAt: FIXTURE_TS,
      loop: original,
    });
    await writeFile(input, bytes);
    assert.equal((await runUpgrade(['export', '--input', input, '--out', refused])).ok, false);
    assert.equal(
      JSON.parse(await readFile(refused, 'utf8')).format,
      'graphgoblin-upgrade-refusals',
    );
    await writeFile(choices, JSON.stringify(resolutions));
    assert.equal(
      (await runUpgrade(['export', '--input', input, '--out', converted, '--resolutions', choices]))
        .ok,
      true,
    );
    assert.equal(JSON.parse(await readFile(converted, 'utf8')).formatVersion, 3);
    assert.equal(await readFile(input, 'utf8'), bytes);
    await assert.rejects(
      runUpgrade(['export', '--input', input, '--out', converted, '--resolutions', choices]),
      { code: 'EEXIST' },
    );
  }));
test('real frozen AIDLC artifact requires explicit choices and preserves every old stable route', async () => {
  const fixture = JSON.parse(
    await readFile(
      new URL('../../packages/domain/src/upgrade-fixtures/codex-first.v1.json', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(upgradeExportV1(fixture).ok, false);
  const decisions = {};
  for (const node of fixture.loop.nodes.filter((node) => node.kind === 'decision'))
    decisions[node.id] = {
      answer: {
        type: 'choice',
        options: node.config.routes.map((route) => ({
          id: route.label,
          label: route.label,
          criteria: route.description || 'Owner reviewed ' + route.label,
        })),
      },
      evaluation: { kind: 'expression', jsonata: '"pass"' },
    };
  const choices = { decisions, sources: {}, opaqueConsumers: {} };
  let result = upgradeExportV1(fixture, choices);
  for (let pass = 0; !result.ok && pass < 3; pass++) {
    for (const issue of result.issues) {
      if (
        issue.code === 'UPGRADE_REFERENCE_CHOICE_REQUIRED' ||
        issue.code === 'UPGRADE_SOURCE_INVALID'
      )
        choices.sources[issue.path] =
          issue.path.endsWith('/jsonata') || issue.path.endsWith('/mapping')
            ? '"Owner reviewed fixture"'
            : 'Owner reviewed fixture';
      if (issue.code === 'UPGRADE_OPAQUE_CONSUMER_REVIEW_REQUIRED') {
        const index = Number(issue.path.split('/')[2]);
        choices.opaqueConsumers[fixture.loop.nodes[index].id] = {
          reason: 'Owner reviewed canonical fixture input',
        };
      }
    }
    result = upgradeExportV1(fixture, choices);
  }
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(
    result.value.loop.edges,
    fixture.loop.edges.map((edge) => ({ ...edge, to: { port: 'in', ...edge.to } })),
  );
});
test('format-2 provider exit exports refuse without authored sides and convert only the explicit resolution', () =>
  temporary(async (root) => {
    const input = join(root, 'exit-v2.json'),
      refused = join(root, 'exit-refused.json'),
      output = join(root, 'exit-v3.json'),
      resolution = join(root, 'exit-resolution.json');
    const old = {
      format: 'graphgoblin-loop',
      formatVersion: 2,
      exportedAt: FIXTURE_TS,
      loop: {
        schemaVersion: 2,
        name: 'exit-cutover',
        nodes: [
          { id: 'start', kind: 'trigger', label: 'Start', config: { subtype: 'manual' } },
          {
            id: 'done',
            kind: 'exit',
            label: 'Done',
            config: {
              criteria: [
                {
                  when: 'predicate',
                  strategy: 'codex',
                  question: 'Is the task complete?',
                  minConfidence: 0.8,
                  outcome: 'success',
                },
              ],
              return: { mapping: 'vars.result', channels: [{ kind: 'caller' }] },
            },
          },
        ],
        edges: [
          {
            id: 'edge',
            from: { node: 'start', port: 'out' },
            to: { node: 'done', port: 'in' },
            ui: { route: [12, 20, 30] },
          },
        ],
      },
    };
    const bytes = JSON.stringify(old);
    await writeFile(input, bytes);
    assert.equal((await runUpgrade(['export', '--input', input, '--out', refused])).ok, false);
    assert.equal(
      JSON.parse(await readFile(refused, 'utf8')).issues[0].code,
      'UPGRADE_EXIT_CRITERIA_REQUIRED',
    );
    await writeFile(
      resolution,
      JSON.stringify({
        predicates: {
          '/nodes/1/config/criteria/0': {
            answer: {
              type: 'noul',
              true: { label: 'Complete', criteria: 'All required work is complete' },
              false: { label: 'Pending', criteria: 'Required work remains' },
            },
          },
        },
      }),
    );
    assert.equal(
      (await runUpgrade(['export', '--input', input, '--out', output, '--resolutions', resolution]))
        .ok,
      true,
    );
    const converted = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(converted.formatVersion, 3);
    assert.deepEqual(converted.loop.edges, old.loop.edges);
    assert.deepEqual(converted.loop.nodes[1].config.return, old.loop.nodes[1].config.return);
    assert.deepEqual(converted.loop.nodes[1].config.criteria[0].evaluation, {
      kind: 'llm',
      harness: 'codex',
      model: { mode: 'inherit' },
      effort: { mode: 'inherit' },
      question: 'Is the task complete?',
    });
    assert.deepEqual(converted.loop.nodes[1].config.criteria[0].match, {
      type: 'noul',
      value: true,
      minReportedConfidence: 0.8,
    });
    assert.equal(await readFile(input, 'utf8'), bytes);
  }));
test('native read-only client cannot create a missing file or write existing rows', () =>
  temporary(async (root) => {
    const missing = join(root, 'missing.db');
    assert.throws(() => openReadOnlyDatabaseClient(missing));
    await assert.rejects(access(missing), { code: 'ENOENT' });
    const file = join(root, 'database.db');
    await seed(file);
    const before = await readFile(file);
    const client = openReadOnlyDatabaseClient(file);
    try {
      await assert.rejects(client.execute('DELETE FROM settings'), { code: 'SQLITE_READONLY' });
    } finally {
      client.close();
    }
    assert.deepEqual(await readFile(file), before);
  }));
test('held live installation lock refuses inventory/apply before any SQLite file or backup creation', () =>
  temporary(async (root) => {
    const data = join(root, 'data'),
      file = join(root, 'missing.db');
    await mkdir(data);
    const lock = await acquireDataDirLock(data);
    try {
      for (const [command, args] of [
        ['inventory', ['--out', join(root, 'inventory.json')]],
        [
          'apply',
          ['--manifest', join(root, 'manifest.json'), '--backup-dir', join(root, 'backup')],
        ],
      ])
        await assert.rejects(
          runUpgrade([command, '--data-dir', data, '--db-url', url(file), ...args]),
          /another GraphGoblin process holds/,
        );
      await assert.rejects(access(file), { code: 'ENOENT' });
      await assert.rejects(access(join(root, 'backup')), { code: 'ENOENT' });
    } finally {
      await lock.release();
    }
  }));
test('complete internal data backup, failed transaction rollback, restore and successful re-upgrade', () =>
  temporary(async (root) => {
    const data = join(root, 'data');
    await mkdir(data);
    await mkdir(join(data, 'artifacts'));
    await writeFile(join(data, 'artifacts', 'retained.txt'), 'retained artifact');
    await writeFile(join(data, 'master.key'), 'synthetic test key');
    const file = join(data, 'database.db');
    await seed(file);
    const report = join(root, 'inventory.json');
    await runUpgrade(['inventory', '--data-dir', data, '--db-url', url(file), '--out', report]);
    const manifest = JSON.parse(await readFile(report, 'utf8')).manifest;
    manifest.approvedBy = 'Test owner';
    manifest.approvedAt = FIXTURE_TS;
    manifest.failedRuns[FIXTURE_IDS.run].reason = 'Owner approves replay';
    const before = await readFile(file),
      bad = join(root, 'bad.json');
    await writeFile(bad, JSON.stringify(manifest));
    await assert.rejects(
      runUpgrade([
        'apply',
        '--data-dir',
        data,
        '--db-url',
        url(file),
        '--manifest',
        bad,
        '--backup-dir',
        join(root, 'failed-backup'),
      ]),
      /Unresolved version conversion/,
    );
    // SQLite rollback may change container bytes; original durable rows and marker absence prove rollback.
    let client = openReadOnlyDatabaseClient(file);
    try {
      assert.equal((await inspectDatabaseUpgrade(client)).sourceHash, manifest.sourceHash);
      await assert.rejects(guardDatabaseUpgrade(client), { code: 'DATA_UPGRADE_REQUIRED' });
    } finally {
      client.close();
    }
    assert.deepEqual(await readFile(join(root, 'failed-backup', 'data', 'database.db')), before);
    assert.equal(
      await readFile(join(root, 'failed-backup', 'data', 'artifacts', 'retained.txt'), 'utf8'),
      'retained artifact',
    );
    manifest.versions[FIXTURE_IDS.version].resolutions = resolutions;
    manifest.failedRuns[FIXTURE_IDS.run].reason =
      'Owner approves replay against selected expression';
    const good = join(root, 'good.json');
    await writeFile(good, JSON.stringify(manifest));
    assert.equal(
      (
        await runUpgrade([
          'apply',
          '--data-dir',
          data,
          '--db-url',
          url(file),
          '--manifest',
          good,
          '--backup-dir',
          join(root, 'good-backup'),
        ])
      ).ok,
      true,
    );
    const audit = join(root, 'audit.json');
    await runUpgrade(['audit', '--data-dir', data, '--db-url', url(file), '--out', audit]);
    const records = JSON.parse(await readFile(audit, 'utf8')).records;
    assert.ok(records.some((record) => record.kind === 'manifest'));
    assert.ok(
      records.some(
        (record) => record.kind === 'runs' && JSON.parse(record.payload.failure).resumable === true,
      ),
    );
    // Restore the complete pre-upgrade data to an independent path and approve its own inventory.
    const restored = join(root, 'restored');
    await cp(join(root, 'good-backup', 'data'), restored, { recursive: true });
    const restoreFile = join(restored, 'database.db'),
      restoreReport = join(root, 'restored-inventory.json');
    await runUpgrade([
      'inventory',
      '--data-dir',
      restored,
      '--db-url',
      url(restoreFile),
      '--out',
      restoreReport,
    ]);
    const restoredManifest = JSON.parse(await readFile(restoreReport, 'utf8')).manifest;
    assert.equal(restoredManifest.sourceHash, manifest.sourceHash);
    Object.assign(restoredManifest, { approvedBy: 'Test owner restored', approvedAt: FIXTURE_TS });
    restoredManifest.versions[FIXTURE_IDS.version].resolutions = resolutions;
    restoredManifest.failedRuns[FIXTURE_IDS.run].reason = 'Owner approves restored attempt';
    const approved = join(root, 'restored-approved.json');
    await writeFile(approved, JSON.stringify(restoredManifest));
    await runUpgrade([
      'apply',
      '--data-dir',
      restored,
      '--db-url',
      url(restoreFile),
      '--manifest',
      approved,
      '--backup-dir',
      join(root, 'restored-backup'),
    ]);
    client = openReadOnlyDatabaseClient(restoreFile);
    try {
      assert.equal(await guardDatabaseUpgrade(client), 'current');
    } finally {
      client.close();
    }
    assert.equal(
      await readFile(join(restored, 'artifacts', 'retained.txt'), 'utf8'),
      'retained artifact',
    );
  }));
test('external database backup copies base/WAL/SHM exactly and refuses overlapping or reused backup destinations', () =>
  temporary(async (root) => {
    const data = join(root, 'data');
    await mkdir(data);
    await writeFile(join(data, 'configuration'), 'saved');
    const file = join(root, 'external.db');
    for (const suffix of ['', '-wal', '-shm']) await writeFile(file + suffix, 'original' + suffix);
    const backup = join(root, 'backup');
    await backupStoppedData(data, file, backup);
    for (const suffix of ['', '-wal', '-shm'])
      assert.deepEqual(
        await readFile(join(backup, 'database' + suffix)),
        await readFile(file + suffix),
      );
    const record = JSON.parse(await readFile(join(backup, 'backup.json'), 'utf8'));
    assert.equal(Object.keys(record.external).length, 3);
    for (const child of ['child', '..backup'])
      await assert.rejects(backupStoppedData(data, file, join(data, child)), /separate/);
    await assert.rejects(backupStoppedData(data, file, backup), { code: 'EEXIST' });
    const second = join(root, 'second');
    await rm(file + '-wal');
    await rm(file + '-shm');
    await backupStoppedData(data, file, second);
    assert.equal(
      Object.keys(JSON.parse(await readFile(join(second, 'backup.json'), 'utf8')).external).length,
      1,
    );
    assert.deepEqual((await readdir(data)).sort(), ['configuration']);
  }));

test('actual committed external SQLite WAL survives backup restoration and a second approved upgrade', () =>
  temporary(async (root) => {
    const data = join(root, 'data');
    await mkdir(data);
    await writeFile(join(data, 'master.key'), 'synthetic WAL acceptance key');
    const liveFile = join(root, 'fixture-writer.db'),
      externalFile = join(root, 'external-source.db');
    const writer = await seed(liveFile, true);
    // Capture a quiescent committed WAL image before closing the fixture writer. The upgrade operates
    // only on this independent stopped snapshot, never the writer connection or a live installation.
    try {
      for (const suffix of ['', '-wal', '-shm'])
        await copyFile(liveFile + suffix, externalFile + suffix);
    } finally {
      writer.close();
    }
    assert.ok((await readFile(externalFile + '-wal')).length > 0);
    const report = join(root, 'inventory.json');
    await runUpgrade([
      'inventory',
      '--data-dir',
      data,
      '--db-url',
      url(externalFile),
      '--out',
      report,
    ]);
    const manifest = JSON.parse(await readFile(report, 'utf8')).manifest;
    Object.assign(manifest, { approvedBy: 'WAL test owner', approvedAt: FIXTURE_TS });
    manifest.versions[FIXTURE_IDS.version].resolutions = resolutions;
    manifest.failedRuns[FIXTURE_IDS.run].reason = 'Owner approves replay with canonical Choice';
    const approved = join(root, 'approved.json');
    await writeFile(approved, JSON.stringify(manifest));
    const backup = join(root, 'backup');
    await runUpgrade([
      'apply',
      '--data-dir',
      data,
      '--db-url',
      url(externalFile),
      '--manifest',
      approved,
      '--backup-dir',
      backup,
    ]);
    const backupRecord = JSON.parse(await readFile(join(backup, 'backup.json'), 'utf8'));
    assert.ok(backupRecord.external['-wal']);
    assert.ok(backupRecord.external['-shm']);
    const restoreData = join(root, 'restore-data');
    await cp(join(backup, 'data'), restoreData, { recursive: true });
    const restoreFile = join(root, 'restore-external.db');
    for (const suffix of ['', '-wal', '-shm'])
      await copyFile(join(backup, 'database' + suffix), restoreFile + suffix);
    const restoredReport = join(root, 'restore-inventory.json');
    await runUpgrade([
      'inventory',
      '--data-dir',
      restoreData,
      '--db-url',
      url(restoreFile),
      '--out',
      restoredReport,
    ]);
    const restored = JSON.parse(await readFile(restoredReport, 'utf8')).manifest;
    assert.equal(restored.sourceHash, manifest.sourceHash); // Reads committed rows residing in the restored WAL.
    Object.assign(restored, { approvedBy: 'WAL restore owner', approvedAt: FIXTURE_TS });
    restored.versions[FIXTURE_IDS.version].resolutions = resolutions;
    restored.failedRuns[FIXTURE_IDS.run].reason = 'Owner approves restored replay';
    const restoredApproved = join(root, 'restore-approved.json');
    await writeFile(restoredApproved, JSON.stringify(restored));
    await runUpgrade([
      'apply',
      '--data-dir',
      restoreData,
      '--db-url',
      url(restoreFile),
      '--manifest',
      restoredApproved,
      '--backup-dir',
      join(root, 'restore-backup'),
    ]);
    const reader = openReadOnlyDatabaseClient(restoreFile);
    try {
      assert.equal(await guardDatabaseUpgrade(reader), 'current');
    } finally {
      reader.close();
    }
  }));

async function fileLinkOrSkip(t, target, path) {
  try {
    await symlink(target, path, 'file');
    return true;
  } catch (error) {
    if (process.platform === 'win32' && error?.code === 'EPERM') {
      t.skip('Host does not permit file symlinks; directory-junction refusal is tested separately');
      return false;
    }
    throw error;
  }
}
test('internal database symlink and external linked sidecars refuse before a backup is created', (t) =>
  temporary(async (root) => {
    const data = join(root, 'data'),
      target = join(root, 'target.db');
    await mkdir(data);
    await writeFile(target, 'unchanged target');
    const linked = join(data, 'database.db');
    if (!(await fileLinkOrSkip(t, target, linked))) return;
    const first = join(root, 'internal-backup');
    await assert.rejects(
      backupStoppedData(data, linked, first),
      /regular files without symbolic links/,
    );
    await assert.rejects(access(first), { code: 'ENOENT' });
    assert.equal(await readFile(target, 'utf8'), 'unchanged target');
    const external = join(root, 'external.db');
    await writeFile(external, 'ordinary external database');
    for (const suffix of ['-wal', '-shm']) {
      await symlink(target, external + suffix, 'file');
      const destination = join(root, 'sidecar-backup' + suffix);
      await assert.rejects(
        backupStoppedData(data, external, destination),
        /regular files without symbolic links/,
      );
      await assert.rejects(access(destination), { code: 'ENOENT' });
      await rm(external + suffix);
    }
    assert.equal(await readFile(external, 'utf8'), 'ordinary external database');
    assert.equal(await readFile(target, 'utf8'), 'unchanged target');
  }));
test('linked database ancestors, data roots and physically overlapping backup parents refuse before copy', () =>
  temporary(async (root) => {
    const data = join(root, 'data'),
      target = join(root, 'target');
    await mkdir(data);
    await mkdir(target);
    const database = join(target, 'database.db');
    await writeFile(database, 'unchanged database');
    const kind = process.platform === 'win32' ? 'junction' : 'dir';
    await symlink(target, join(data, 'linked-database'), kind);
    const backup = join(root, 'linked-db-backup');
    await assert.rejects(
      backupStoppedData(data, join(data, 'linked-database', 'database.db'), backup),
      /regular files without symbolic links/,
    );
    await assert.rejects(access(backup), { code: 'ENOENT' });
    const rootAlias = join(root, 'data-alias');
    await symlink(data, rootAlias, kind);
    await assert.rejects(
      backupStoppedData(rootAlias, database, join(root, 'root-alias-backup')),
      /physical path/,
    );
    await assert.rejects(access(join(root, 'root-alias-backup')), { code: 'ENOENT' });
    const aliasDestination = join(rootAlias, 'overlapping-backup');
    await assert.rejects(
      backupStoppedData(data, database, aliasDestination),
      /separate from the data directory/,
    );
    await assert.rejects(access(join(data, 'overlapping-backup')), { code: 'ENOENT' });
    // Existing destinations, including a link to the external DB's parent, cannot be reused.
    const externalAlias = join(root, 'external-alias');
    await symlink(target, externalAlias, kind);
    await assert.rejects(backupStoppedData(data, database, externalAlias), { code: 'EEXIST' });
    assert.equal(await readFile(database, 'utf8'), 'unchanged database');
  }));
test('ordinary non-database links remain preserved without claiming their external content is snapshotted', (t) =>
  temporary(async (root) => {
    const data = join(root, 'data'),
      database = join(root, 'external.db'),
      artifact = join(root, 'artifact.txt');
    await mkdir(data);
    await writeFile(database, 'database snapshot');
    await writeFile(artifact, 'external artifact');
    if (!(await fileLinkOrSkip(t, artifact, join(data, 'artifact-link')))) return;
    const backup = join(root, 'backup');
    await backupStoppedData(data, database, backup);
    assert.equal((await lstat(join(backup, 'data', 'artifact-link'))).isSymbolicLink(), true);
    const record = JSON.parse(await readFile(join(backup, 'backup.json'), 'utf8'));
    assert.equal(record.files['artifact-link'].link, artifact);
    assert.equal(Object.keys(record.external).length, 1);
    assert.equal(await readFile(join(backup, 'database'), 'utf8'), 'database snapshot');
  }));
