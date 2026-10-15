import { createHash } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { FIXTURE_TS, fakeUlid, minimalLoop, sampleThread } from '@graphgoblin/contracts/testing';
import { openDatabase, openMemoryDatabase, type DatabaseHandle } from './db.js';
import { SHIPPED_MIGRATIONS, storeStructure } from './readiness.js';
import { applyDatabaseUpgrade, inspectDatabaseUpgrade } from './upgrade.js';
import { applyShippedSqlToHistoricalTestFixture } from './testing/shipped-migrations.js';

const handles: DatabaseHandle[] = [];
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
});
const migrations = readMigrationFiles({ migrationsFolder: SHIPPED_MIGRATIONS });
const retirement = migrations[12]!;
const templateIndexes = [
  'template_issue_attempt_idx',
  'template_qa_merge_idx',
  'template_pr_head_idx',
  'template_active_pr_idx',
  'template_child_visit_idx',
  'template_qa_issue_attempt_idx',
];
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';

async function at0011() {
  const handle = openDatabase({ url: ':memory:' });
  handles.push(handle);
  await handle.client.execute(
    'CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT, created_at INTEGER)',
  );
  for (const migration of migrations.slice(0, 12)) {
    for (const statement of migration.sql) await handle.client.execute(statement);
    await handle.client.execute({
      sql: 'INSERT INTO __drizzle_migrations(hash,created_at) VALUES (?,?)',
      args: [migration.hash, migration.folderMillis],
    });
  }
  return handle;
}
async function seed(handle: DatabaseHandle) {
  const insert = async (table: string, row: Record<string, string | number | null>) => {
    await handle.client.execute({
      sql:
        'INSERT INTO ' +
        quote(table) +
        '(' +
        Object.keys(row).map(quote).join(',') +
        ') VALUES (' +
        Object.keys(row)
          .map(() => '?')
          .join(',') +
        ')',
      args: Object.values(row),
    });
  };
  const loop = fakeUlid('loop');
  const version = fakeUlid('version');
  const thread = JSON.stringify(sampleThread());
  await insert('loops', {
    id: loop,
    owner_id: 'local',
    name: 'Ordinary loop',
    description: 'Retained',
    current_version_id: version,
    created_at: FIXTURE_TS,
    updated_at: FIXTURE_TS,
  });
  await insert('loop_versions', {
    id: version,
    loop_id: loop,
    version: 1,
    status: 'published',
    definition: JSON.stringify(minimalLoop()),
    created_at: FIXTURE_TS,
    published_at: FIXTURE_TS,
  });
  for (const [id, subject] of [
    ['ordinary', null],
    [
      'subject',
      JSON.stringify({
        role: 'parent',
        kind: 'implementation',
        repository: 'owner/repo',
        issue: 1,
        attempt: 1,
      }),
    ],
  ] as const) {
    const run = fakeUlid(id);
    await insert('runs', {
      id: run,
      owner_id: 'local',
      loop_id: loop,
      version_id: version,
      parent_run_id: id === 'subject' ? fakeUlid('ordinary') : null,
      invocation_id: fakeUlid(id + '-invocation'),
      status: 'succeeded',
      current_node_id: 'done',
      iteration: 2,
      waiting: '{"kind":"test"}',
      cancel_requested_at: FIXTURE_TS,
      paused_at: FIXTURE_TS,
      failure: '{"code":"test"}',
      outcome: 'success',
      result: '{"retained":true}',
      created_at: FIXTURE_TS,
      started_at: FIXTURE_TS,
      finished_at: FIXTURE_TS,
      last_event_seq: 1,
      initial_thread: thread,
      thread_snapshot: thread,
      thread_snapshot_seq: 1,
      finalized_at: FIXTURE_TS,
      template_subject: subject,
    });
    await insert('run_events', {
      run_id: run,
      seq: 1,
      ts: FIXTURE_TS,
      type: 'run.queued',
      payload: JSON.stringify({ initialThread: sampleThread() }),
    });
    await insert('harness_sessions', {
      run_id: run,
      node_id: 'start',
      attempt: 1,
      harness: 'codex',
      session_id: id + '-session',
      status: 'done',
      model: 'test',
      effort: 'low',
      scope_key: id,
      updated_at: FIXTURE_TS,
    });
    await insert('timers', { run_id: run, key: 'deadline', at: FIXTURE_TS });
  }
  await insert('settings', {
    owner_id: 'local',
    key: 'retained',
    value: '{"value":1}',
    updated_at: FIXTURE_TS,
  });
  await insert('secrets', {
    owner_id: 'local',
    name: 'test',
    ciphertext: 'fixture-ciphertext',
    created_at: FIXTURE_TS,
    updated_at: FIXTURE_TS,
  });
  await insert('api_keys', {
    id: 'key',
    owner_id: 'local',
    label: 'test',
    hash: 'fixture-hash',
    scopes: '["loops:read"]',
    created_at: FIXTURE_TS,
  });
  await insert('model_catalog', {
    harness: 'codex',
    model: 'test',
    display_name: 'Test',
    efforts: '["low"]',
    default_effort: 'low',
    enabled: 0,
    source: 'harness',
  });
  await insert('classifier_models', {
    owner_id: 'local',
    id: 'test',
    display_name: 'Test',
    source: 'custom',
    provider: 'http',
    provider_model: 'test',
    primitives: '["choice"]',
    endpoint: 'https://example.invalid',
    enabled: 0,
  });
  await insert('schedules', {
    id: 'schedule',
    owner_id: 'local',
    loop_id: loop,
    version_id: version,
    trigger_node_id: 'start',
    expression: '* * * * *',
    timezone: 'UTC',
    missed_fire_policy: 'skip',
    enabled: 0,
    created_at: FIXTURE_TS,
  });
  await insert('webhook_endpoints', {
    id: 'hook',
    owner_id: 'local',
    loop_id: loop,
    version_id: version,
    trigger_node_id: 'start',
    token: 'retained-token',
    secret_ref: 'test',
    signature_header: 'signature',
    signature_scheme: 'hmac-sha256-body',
    enabled: 0,
    created_at: FIXTURE_TS,
  });
  await insert('webhook_receipts', {
    id: 'receipt',
    owner_id: 'local',
    loop_id: loop,
    trigger_node_id: 'start',
    content_hash: 'retained-hash',
    inbound_id: 'inbound',
    status: 'filtered',
  });
  await insert('inbound_events', {
    id: 'inbound',
    owner_id: 'local',
    type: 'test',
    payload: '{}',
    source: 'test',
    received_at: FIXTURE_TS,
    run_ids: JSON.stringify([fakeUlid('ordinary')]),
  });
  await insert('template_instances', {
    id: 'retired',
    owner_id: 'local',
    instance: '{"id":"retired","loops":[]}',
    binding: '{"retired":true}',
  });
}
async function rowSets(
  handle: DatabaseHandle,
  structure: Awaited<ReturnType<typeof storeStructure>>,
) {
  const sets = [];
  for (const table of structure) {
    if (table.name === 'template_instances' || table.name === '__drizzle_migrations') continue;
    const columns = table.columns.filter((column) => column.name !== 'template_subject');
    const result = await handle.client.execute(
      'SELECT ' +
        columns.map((column) => quote(column.name)).join(',') +
        ' FROM ' +
        quote(table.name) +
        ' ORDER BY rowid',
    );
    sets.push({
      name: table.name,
      count: result.rows.length,
      hash: createHash('sha256').update(JSON.stringify(result.rows)).digest('hex'),
    });
  }
  return sets;
}
async function expectRetired(handle: DatabaseHandle) {
  expect(
    (await handle.client.execute("SELECT name FROM sqlite_master WHERE name LIKE 'template_%'"))
      .rows,
  ).toEqual([]);
  expect(
    (await handle.client.execute('PRAGMA table_info(runs)')).rows.map((column) => column.name),
  ).not.toContain('template_subject');
  await expect(handle.client.execute('SELECT * FROM template_instances')).rejects.toThrow(
    'no such table',
  );
  await expect(handle.client.execute('SELECT template_subject FROM runs')).rejects.toThrow(
    'no such column',
  );
  expect((await handle.client.execute('PRAGMA integrity_check')).rows[0]?.integrity_check).toBe(
    'ok',
  );
}

it('applies 0012 during atomic fresh initialization', async () => {
  const handle = await openMemoryDatabase();
  handles.push(handle);
  await expectRetired(handle);
  expect(await handle.pendingMigrations()).toBe(0);
  expect(
    (await handle.client.execute('SELECT count(*) AS count FROM __drizzle_migrations')).rows[0]
      ?.count,
  ).toBe(13);
  expect(
    (await handle.client.execute('SELECT format_version,status FROM gg_upgrade_state')).rows,
  ).toMatchObject([{ format_version: 4, status: 'complete' }]);
});

it('drops a populated inline-CHECK column on deployed libsql, preserving ordinary rows and structure', async () => {
  const handle = await at0011();
  await seed(handle);
  expect(
    (await handle.client.execute('SELECT sqlite_version() AS version')).rows[0]?.version,
  ).toMatch(/^3\./);
  const ddl = (await handle.client.execute("SELECT sql FROM sqlite_master WHERE name='runs'"))
    .rows[0]!.sql;
  expect(ddl).toContain(
    'template_subject TEXT CHECK (template_subject IS NULL OR json_valid(template_subject))',
  );
  expect(
    (
      await handle.client.execute(
        'SELECT template_subject FROM runs WHERE template_subject IS NOT NULL',
      )
    ).rows,
  ).toHaveLength(1);
  await expect(
    handle.client.execute(
      "UPDATE runs SET template_subject='invalid JSON' WHERE template_subject IS NOT NULL",
    ),
  ).rejects.toThrow('CHECK constraint failed');
  const before = await storeStructure(handle.client);
  const rows = await rowSets(handle, before);
  expect(rows.every((table) => table.count > 0)).toBe(true);
  const ledger = (
    await handle.client.execute('SELECT * FROM __drizzle_migrations ORDER BY created_at')
  ).rows;
  const expected = before
    .filter((table) => table.name !== 'template_instances')
    .map((table) => ({
      ...table,
      columns: table.columns.filter((column) => column.name !== 'template_subject'),
      checks: table.checks.filter((check) => !check.includes('template_subject')),
      indexes: table.indexes.filter((index) => !templateIndexes.includes(index.name)),
    }));
  await applyShippedSqlToHistoricalTestFixture(handle);
  const after = await storeStructure(handle.client);
  expect(after).toEqual(expected);
  expect(await rowSets(handle, after)).toEqual(rows);
  const migratedLedger = (
    await handle.client.execute('SELECT * FROM __drizzle_migrations ORDER BY created_at')
  ).rows;
  expect(migratedLedger.slice(0, 12)).toEqual(ledger);
  expect(migratedLedger[12]).toMatchObject({
    hash: retirement.hash,
    created_at: retirement.folderMillis,
  });
  await expectRetired(handle);
  // Surviving CHECK and uniqueness constraints still enforce their original rules.
  await expect(
    handle.client.execute("UPDATE webhook_receipts SET status='unknown'"),
  ).rejects.toThrow('CHECK constraint failed');
  await expect(
    handle.client.execute("UPDATE webhook_receipts SET status='admitted'"),
  ).rejects.toThrow('CHECK constraint failed');
  await expect(
    handle.client.execute("UPDATE webhook_endpoints SET signature_scheme='hmac-sha256'"),
  ).rejects.toThrow('CHECK constraint failed');
  await expect(
    handle.client.execute(
      "INSERT INTO webhook_receipts SELECT 'duplicate',owner_id,loop_id,trigger_node_id,content_hash,'other',status,intent,attempts,next_attempt_at,failure_code FROM webhook_receipts",
    ),
  ).rejects.toThrow('UNIQUE constraint failed');
});

it('rolls back all eight DDL statements and populated template evidence on transaction failure', async () => {
  const handle = await at0011();
  await seed(handle);
  const structure = await storeStructure(handle.client);
  const rows = await rowSets(handle, structure);
  const evidence = (await handle.client.execute('SELECT * FROM template_instances')).rows;
  const subjects = (await handle.client.execute('SELECT id,template_subject FROM runs ORDER BY id'))
    .rows;
  const ledger = (await handle.client.execute('SELECT * FROM __drizzle_migrations')).rows;
  const tx = await handle.client.transaction('write');
  try {
    for (const statement of retirement.sql) await tx.execute(statement);
    await tx.execute({
      sql: 'INSERT INTO __drizzle_migrations(hash,created_at) VALUES (?,?)',
      args: [retirement.hash, retirement.folderMillis],
    });
    await expect(tx.execute('SELECT * FROM injected_missing_table')).rejects.toThrow();
  } finally {
    await tx.rollback();
  }
  expect(await storeStructure(handle.client)).toEqual(structure);
  expect(await rowSets(handle, structure)).toEqual(rows);
  expect((await handle.client.execute('SELECT * FROM template_instances')).rows).toEqual(evidence);
  expect(
    (await handle.client.execute('SELECT id,template_subject FROM runs ORDER BY id')).rows,
  ).toEqual(subjects);
  expect((await handle.client.execute('SELECT * FROM __drizzle_migrations')).rows).toEqual(ledger);
});

async function snapshotStore(handle: DatabaseHandle) {
  const schema = (await handle.client.execute('SELECT * FROM sqlite_master ORDER BY name')).rows;
  const contents = [];
  for (const table of (
    await handle.client.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
  ).rows) {
    const name = table.name;
    if (typeof name !== 'string') throw new Error('Expected table name');
    contents.push({
      name,
      rows: (await handle.client.execute('SELECT * FROM ' + quote(name) + ' ORDER BY rowid')).rows,
    });
  }
  return { schema, contents };
}
async function expectApplyRefusedUnchanged(handle: DatabaseHandle) {
  const inventory = await inspectDatabaseUpgrade(handle.client);
  expect(inventory.issues).toEqual([]);
  const before = await snapshotStore(handle);
  const statements: string[] = [];
  const client = new Proxy(handle.client, {
    get(target, key, receiver) {
      if (key === 'transaction')
        return async () => {
          const tx = await target.transaction('write');
          const execute = tx.execute.bind(tx);
          tx.execute = (statement) => {
            statements.push(typeof statement === 'string' ? statement : statement.sql);
            return execute(statement);
          };
          return tx;
        };
      const value: unknown = Reflect.get(target, key, receiver);
      return value;
    },
  });
  await expect(
    applyDatabaseUpgrade(client, {
      format: 'graphgoblin-upgrade-manifest',
      targetVersion: 4,
      sourceHash: inventory.sourceHash,
      approvedBy: 'test-owner',
      approvedAt: FIXTURE_TS,
      versions: Object.fromEntries(
        inventory.versions.map((version) => [
          version.id,
          { definitionHash: version.definitionHash, resolutions: {} },
        ]),
      ),
      failedRuns: {},
    }),
  ).rejects.toMatchObject({ code: 'DATA_UPGRADE_REQUIRED' });
  expect(statements.length).toBeGreaterThan(0);
  expect(statements.every((statement) => /^(SELECT|PRAGMA table_info)/i.test(statement))).toBe(
    true,
  );
  expect(await snapshotStore(handle)).toEqual(before);
  expect((await inspectDatabaseUpgrade(handle.client)).sourceHash).toBe(inventory.sourceHash);
}
it.each([
  {
    name: 'unmarked 0011 store with template rows',
    marker: null,
    definitions: false,
    legacyStorage: true,
  },
  {
    name: 'unmarked store with definitions',
    marker: null,
    definitions: true,
    legacyStorage: false,
  },
  {
    name: 'format-3 marker without definitions',
    marker: 3,
    definitions: false,
    legacyStorage: false,
  },
  { name: 'format-3 marker with definitions', marker: 3, definitions: true, legacyStorage: false },
  { name: 'format-1 marker', marker: 1, definitions: false, legacyStorage: false },
  { name: 'format-2 marker', marker: 2, definitions: false, legacyStorage: false },
  {
    name: 'claimed format-4 marker with retired storage',
    marker: 4,
    definitions: false,
    legacyStorage: true,
  },
])(
  'refuses $name without changing rows, schema, marker or ledger',
  async ({ marker, definitions, legacyStorage }) => {
    const handle = await at0011();
    if (legacyStorage)
      await handle.client.execute(
        "INSERT INTO template_instances VALUES ('retired','local','{}','{}')",
      );
    else await applyShippedSqlToHistoricalTestFixture(handle);
    if (marker !== null) {
      await handle.client.execute(
        'CREATE TABLE gg_upgrade_state (id INTEGER PRIMARY KEY,format_version INTEGER,status TEXT)',
      );
      await handle.client.execute({
        sql: "INSERT INTO gg_upgrade_state VALUES (1,?,'complete')",
        args: [marker],
      });
    }
    if (definitions) {
      await handle.client.execute({
        sql: 'INSERT INTO loop_versions (id,loop_id,version,status,definition,created_at) VALUES (?,?,1,?,?,?)',
        args: [
          fakeUlid('old-version'),
          fakeUlid('old-loop'),
          'draft',
          JSON.stringify({ ...minimalLoop(), schemaVersion: 3 }),
          FIXTURE_TS,
        ],
      });
    }
    await expectApplyRefusedUnchanged(handle);
  },
);
it.each([
  [
    'template table',
    'CREATE TABLE template_instances (id TEXT PRIMARY KEY,owner_id TEXT,instance TEXT,binding TEXT)',
  ],
  ['subject column', 'ALTER TABLE runs ADD COLUMN template_subject TEXT'],
  ['incomplete marker', "UPDATE gg_upgrade_state SET status='pending'"],
  ['missing marker row', 'DELETE FROM gg_upgrade_state'],
  ['incorrect marker identity', 'UPDATE gg_upgrade_state SET id=2'],
  [
    'incomplete ledger',
    'DELETE FROM __drizzle_migrations WHERE created_at=(SELECT max(created_at) FROM __drizzle_migrations)',
  ],
  ['incomplete structure', 'DROP INDEX runs_parent_idx'],
])('refuses a current-format store with %s before structural SQL', async (_name, mutation) => {
  const handle = await openMemoryDatabase();
  handles.push(handle);
  // The malformed marker identity is deliberately injected to exercise offline admission.
  if (_name === 'incorrect marker identity')
    await handle.client.execute('PRAGMA ignore_check_constraints=ON');
  await handle.client.execute(mutation);
  await expectApplyRefusedUnchanged(handle);
});

it('admits an already complete format-4 store and preserves its ordinary rows and ledger', async () => {
  const handle = await openMemoryDatabase();
  handles.push(handle);
  await handle.client.execute({
    sql: 'INSERT INTO settings (owner_id,key,value,updated_at) VALUES (?,?,?,?)',
    args: ['local', 'ordinary', '{"kept":true}', FIXTURE_TS],
  });
  const ordinary = (await handle.client.execute('SELECT * FROM settings')).rows;
  const ledger = (await handle.client.execute('SELECT * FROM __drizzle_migrations')).rows;
  const inventory = await inspectDatabaseUpgrade(handle.client);
  await expect(
    applyDatabaseUpgrade(handle.client, {
      format: 'graphgoblin-upgrade-manifest',
      targetVersion: 4,
      sourceHash: inventory.sourceHash,
      approvedBy: 'test-owner',
      approvedAt: FIXTURE_TS,
      versions: {},
      failedRuns: {},
    }),
  ).resolves.toMatchObject({ versions: 0, runs: 0 });
  expect((await handle.client.execute('SELECT * FROM settings')).rows).toEqual(ordinary);
  expect((await handle.client.execute('SELECT * FROM __drizzle_migrations')).rows).toEqual(ledger);
});
