import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import process from 'node:process';
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
import { fileURLToPath, URL } from 'node:url';
import { argumentsFor, backupStoppedData, verifyStoppedBackup, runUpgrade } from './upgrade.mjs';
import { acquireDataDirLock } from '../../apps/api/dist/data-dir-lock.js';
import {
  openDatabase,
  openReadOnlyDatabaseClient,
  guardDatabaseUpgrade,
  verifyDatabaseHead,
} from '../../packages/infrastructure/dist/sqlite/index.js';
import { FIXTURE_TS } from '../../packages/contracts/dist/testing/index.js';
import { seedFormatThreeStore } from '../../packages/infrastructure/dist/sqlite/testing/format-three-store.js';
import { LoopExportSchema } from '../../packages/contracts/dist/index.js';
import { upgradeExportCurrent, upgradeExportV1 } from '../../packages/domain/dist/index.js';
const executeCli = promisify(execFile);
async function cli(args) {
  const { stdout } = await executeCli(process.execPath, [
    fileURLToPath(new URL('./upgrade.mjs', import.meta.url)),
    ...args,
  ]);
  return JSON.parse(stdout);
}
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
  try {
    return await fn(root);
  } finally {
    // Closed libsql statements can retain native Windows file handles until collection.
    globalThis.gc?.();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
async function seed(file, retainWal = false) {
  const handle = openDatabase({ url: url(file) });
  await seedFormatThreeStore(handle);
  if (retainWal) {
    await handle.client.execute('PRAGMA journal_mode=WAL');
    await handle.client.execute('PRAGMA wal_autocheckpoint=0');
    await handle.client.execute("UPDATE settings SET updated_at='2026-10-17T01:00:00.000Z'");
    return handle;
  }
  await handle.client.execute('PRAGMA journal_mode=DELETE');
  handle.close();
}
async function reviewedPlan(root, data, file, prefix = '') {
  const report = join(root, prefix + 'inspect.json');
  const first = await cli(['inspect', '--data-dir', data, '--db-url', url(file), '--out', report]);
  const plan = JSON.parse(await readFile(report, 'utf8'));
  const resolutions = Object.fromEntries(
    plan.definitions
      .filter((entry) => entry.conversion === 'pending')
      .map((entry) => [
        entry.id,
        {
          v3: Object.fromEntries(
            entry.reviewItems
              .filter((item) => item.status === 'pending')
              .map((item) => [
                item.id,
                { hash: item.hash, action: 'approve', reason: 'Reviewed fixture proposal' },
              ]),
          ),
        },
      ]),
  );
  const choices = join(root, prefix + 'resolutions.json');
  await writeFile(choices, JSON.stringify(resolutions));
  const resolved = join(root, prefix + 'resolved-inspect.json');
  const result = await cli([
    'inspect',
    '--data-dir',
    data,
    '--db-url',
    url(file),
    '--out',
    resolved,
    '--resolutions',
    choices,
  ]);
  assert.equal(result.pending, 0);
  assert.equal(result.invalid, 0);
  return {
    first,
    plan,
    result,
    choices,
    args: [
      '--data-dir',
      data,
      '--db-url',
      url(file),
      '--plan-hash',
      result.planHash,
      '--resolutions',
      choices,
    ],
  };
}
async function storedState(file) {
  const client = openReadOnlyDatabaseClient(file);
  try {
    const schema = await client.execute(
      "SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name",
    );
    const tables = [];
    for (const { name, sql } of schema.rows)
      tables.push({
        name,
        sql,
        rows: (await client.execute('SELECT * FROM "' + name.replaceAll('"', '""') + '"')).rows,
      });
    return tables;
  } finally {
    client.close();
  }
}
test('format-3 export, inspect, verified backup, apply, startup admission, restoration and re-upgrade', (t) =>
  temporary(async (root) => {
    const data = join(root, 'data');
    await mkdir(join(data, 'artifacts', 'transcript'), { recursive: true });
    await writeFile(join(data, 'artifacts', 'transcript', 'fixture'), 'historical transcript');
    await writeFile(join(data, 'master.key'), 'synthetic encryption material');
    const file = join(data, 'database.db');
    await seed(file);
    const before = await readFile(file),
      state = await storedState(file);
    const exported = join(root, 'exported.json');
    const old = JSON.parse(
      state
        .find((entry) => entry.name === 'loop_versions')
        .rows.find((row) => JSON.parse(row.definition).name === 'manual').definition,
    );
    const input = join(root, 'old-export.json');
    await writeFile(input, JSON.stringify(old));
    assert.equal((await cli(['export', '--input', input, '--out', exported])).ok, true);
    const reviewed = await reviewedPlan(root, data, file);
    assert.deepEqual(await readFile(file), before);
    assert.equal(reviewed.plan.counts.artifactFiles, 1);
    assert.equal(reviewed.first.pending, 4);
    const backup = join(root, 'backup');
    const result = await cli(['apply', ...reviewed.args, '--backup-dir', backup]);
    assert.equal(result.status, 'upgraded');
    assert.equal(result.deletedRuns, 9);
    assert.equal(result.definitions, 16);
    assert.equal(result.deletedArtifactFiles, 1);
    assert.equal(result.disarmed.length, 5);
    assert.equal(result.readback, 'verified');
    assert.equal(result.backupDir, backup);
    t.diagnostic(
      JSON.stringify({
        export: 'ok',
        inspect: reviewed.first,
        apply: {
          status: result.status,
          definitions: result.definitions,
          deletedRuns: result.deletedRuns,
          deletedArtifactFiles: result.deletedArtifactFiles,
          disarmed: result.disarmed.length,
          backupDir: result.backupDir,
          readback: result.readback,
        },
      }),
    );
    assert.deepEqual(await readFile(join(backup, 'data', 'database.db')), before);
    assert.equal(
      await readFile(join(backup, 'data', 'artifacts', 'transcript', 'fixture'), 'utf8'),
      'historical transcript',
    );
    await assert.rejects(access(join(data, 'artifacts', 'transcript', 'fixture')), {
      code: 'ENOENT',
    });
    assert.equal(await readFile(join(data, 'master.key'), 'utf8'), 'synthetic encryption material');
    const handle = openDatabase({ url: url(file) });
    try {
      await handle.migrate();
      assert.equal(await guardDatabaseUpgrade(handle.client), 'current');
      await verifyDatabaseHead(handle.client);
    } finally {
      handle.close();
    }
    const currentReport = join(root, 'current.json');
    const current = await cli([
      'inspect',
      '--data-dir',
      data,
      '--db-url',
      url(file),
      '--out',
      currentReport,
    ]);
    assert.equal(current.status, 'current');
    assert.equal(current.disarm, 0);
    const noop = await cli([
      'apply',
      '--data-dir',
      data,
      '--db-url',
      url(file),
      '--plan-hash',
      current.planHash,
      '--backup-dir',
      join(root, 'unused-backup'),
    ]);
    assert.equal(noop.status, 'current');
    await assert.rejects(access(join(root, 'unused-backup')), { code: 'ENOENT' });
    const restore = join(root, 'restored');
    await cp(join(backup, 'data'), restore, { recursive: true });
    const restoreFile = join(restore, 'database.db');
    assert.deepEqual(await storedState(restoreFile), state);
    const restored = await reviewedPlan(root, restore, restoreFile, 'restored-');
    assert.equal(restored.result.planHash, reviewed.result.planHash);
    assert.equal(
      (await cli(['apply', ...restored.args, '--backup-dir', join(root, 'restored-backup')]))
        .status,
      'upgraded',
    );
  }));

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
    const first = await upgradeExportCurrent(JSON.parse(bytes), { v1: resolutions });
    const v3 = Object.fromEntries(
      first.reviewItems
        .filter((item) => item.status === 'pending')
        .map((item) => [
          item.id,
          { hash: item.hash, action: 'approve', reason: 'Reviewed exact source and proposal' },
        ]),
    );
    await writeFile(choices, JSON.stringify({ v1: resolutions, v3 }));
    assert.equal(
      (await runUpgrade(['export', '--input', input, '--out', converted, '--resolutions', choices]))
        .ok,
      true,
    );
    const historical = LoopExportSchema.parse(JSON.parse(await readFile(converted, 'utf8')));
    assert.equal(historical.formatVersion, 4);
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
test('format-2 provider exit exports require namespaced sides and subsequent hash-bound graph review', () =>
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
        v2: {
          predicates: {
            '/nodes/1/config/criteria/0': {
              answer: {
                type: 'noul',
                true: { label: 'Complete', criteria: 'All required work is complete' },
                false: { label: 'Pending', criteria: 'Required work remains' },
              },
            },
          },
        },
      }),
    );
    assert.equal(
      (await runUpgrade(['export', '--input', input, '--out', output, '--resolutions', resolution]))
        .ok,
      false,
    );
    const pendingReport = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(pendingReport.format, 'graphgoblin-upgrade-refusals');
    assert.ok(
      pendingReport.reviewItems.some(
        (item) => item.status === 'pending' && item.id && item.hash && item.reason,
      ),
    );
    assert.equal(pendingReport.value, undefined);
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
        ['inspect', ['--out', join(root, 'inspect.json')]],
        ['apply', ['--plan-hash', 'unchanged-plan', '--backup-dir', join(root, 'backup')]],
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
test('refuses unresolved reviews, unused resolutions, changed plan/artifacts and invalid backup without data loss', () =>
  temporary(async (root) => {
    const data = join(root, 'data');
    await mkdir(data);
    const file = join(data, 'database.db');
    await seed(file);
    const reviewed = await reviewedPlan(root, data, file),
      before = await storedState(file);
    await assert.rejects(
      runUpgrade([
        'apply',
        '--data-dir',
        data,
        '--db-url',
        url(file),
        '--plan-hash',
        reviewed.first.planHash,
        '--backup-dir',
        join(root, 'pending-backup'),
      ]),
      /unresolved/,
    );
    await assert.rejects(runUpgrade(['apply', ...reviewed.args, '--backup-dir', data]), /separate/);
    const altered = join(root, 'unused.json');
    await writeFile(altered, JSON.stringify({ unknown: {} }));
    const report = await runUpgrade([
      'inspect',
      '--data-dir',
      data,
      '--db-url',
      url(file),
      '--resolutions',
      altered,
      '--out',
      join(root, 'unused-report.json'),
    ]);
    assert.ok(report.invalid > 0);
    await mkdir(join(data, 'artifacts'));
    await writeFile(join(data, 'artifacts', 'late'), 'new history');
    await assert.rejects(
      runUpgrade(['apply', ...reviewed.args, '--backup-dir', join(root, 'stale-backup')]),
      /hash changed/,
    );
    assert.deepEqual(await storedState(file), before);
    await assert.rejects(verifyStoppedBackup(data, file, join(root, 'missing')), {
      code: 'ENOENT',
    });
    const backup = join(root, 'verified-backup');
    await backupStoppedData(data, file, backup);
    await writeFile(join(backup, 'data', 'master.key'), 'not in inventory');
    await assert.rejects(verifyStoppedBackup(data, file, backup), /verification failed/);
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

test('committed external SQLite WAL is backed up exactly, converted, restored and re-upgraded', () =>
  temporary(async (root) => {
    const data = join(root, 'data');
    await mkdir(data);
    await writeFile(join(data, 'master.key'), 'synthetic WAL key');
    const writerFile = join(root, 'writer.db'),
      file = join(root, 'external.db');
    const writer = await seed(writerFile, true);
    try {
      for (const suffix of ['', '-wal', '-shm']) await copyFile(writerFile + suffix, file + suffix);
    } finally {
      writer.close();
    }
    assert.ok((await readFile(file + '-wal')).length > 0);
    const before = await storedState(file),
      reviewed = await reviewedPlan(root, data, file),
      backup = join(root, 'backup');
    assert.equal(
      (await runUpgrade(['apply', ...reviewed.args, '--backup-dir', backup])).status,
      'upgraded',
    );
    const record = JSON.parse(await readFile(join(backup, 'backup.json'), 'utf8'));
    assert.ok(record.external['-wal']);
    assert.ok(record.external['-shm']);
    assert.deepEqual(await storedState(join(backup, 'database')), before);
    const restoreData = join(root, 'restored-data');
    await cp(join(backup, 'data'), restoreData, { recursive: true });
    const restoredFile = join(root, 'restored.db');
    for (const suffix of ['', '-wal', '-shm'])
      await copyFile(join(backup, 'database' + suffix), restoredFile + suffix);
    assert.deepEqual(await storedState(restoredFile), before);
    const restored = await reviewedPlan(root, restoreData, restoredFile, 'restored-');
    assert.equal(
      (await runUpgrade(['apply', ...restored.args, '--backup-dir', join(root, 'restore-backup')]))
        .status,
      'upgraded',
    );
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
