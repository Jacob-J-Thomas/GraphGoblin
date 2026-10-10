import { afterEach, describe, expect, it } from 'vitest';
import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import { minimalLoop, FIXTURE_TS, fakeUlid } from '@graphgoblin/contracts/testing';
import { createInitialThread } from '@graphgoblin/engine';
import { FakeClock, FakeIds } from '@graphgoblin/engine/testing';
import { openMemoryDatabase, type DatabaseHandle } from './db.js';
import { SqliteLoopRepository } from './loops.js';
import { SqliteRunRepository } from './runs.js';
import { SqliteEventStore } from './events.js';
import { SqliteWebhookEndpoints } from './triggers.js';
import {
  applyDatabaseUpgrade,
  guardDatabaseUpgrade,
  inspectDatabaseUpgrade,
  type DatabaseUpgradeManifest,
} from './upgrade.js';
const textColumn = (value: unknown): string => {
  if (typeof value !== 'string') throw new Error('Expected text column');
  return value;
};
const handles: DatabaseHandle[] = [];
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
});
async function previousStructure(custom = false) {
  const handle = await openMemoryDatabase();
  handles.push(handle);
  const definition = minimalLoop();
  definition.nodes[0]!.config = {
    subtype: 'webhook',
    signature: { scheme: 'hmac-sha256', secretRef: 'secret' },
    ...(custom ? { dedupeKey: 'payload.id' } : {}),
  };
  const repo = new SqliteLoopRepository(handle.db, new FakeClock(), new FakeIds());
  const { loop } = await repo.create('local', LoopDefinitionSchema.parse(definition));
  const version = (await repo.publish(loop.id))!;
  const key = 'sig:sha256=' + 'ab'.repeat(32),
    runId = fakeUlid('history-run'),
    invocationId = fakeUlid('history-invocation');
  const initialThread = createInitialThread({
    runId,
    loopId: loop.id,
    versionId: version.id,
    invocation: {
      id: invocationId,
      source: 'webhook',
      trigger: {
        nodeId: 'start',
        kind: 'webhook',
        payload: { id: 1 },
        receivedAt: FIXTURE_TS,
        dedupeKey: key,
      },
    },
  });
  await new SqliteRunRepository(handle.db).create(
    {
      id: runId,
      ownerId: 'local',
      loopId: loop.id,
      versionId: version.id,
      invocationId,
      status: 'succeeded',
      iteration: 1,
      createdAt: FIXTURE_TS,
      lastEventSeq: 0,
    },
    initialThread,
  );
  await new SqliteEventStore(handle.db, new FakeClock()).append(runId, [
    { type: 'run.queued', initialThread },
  ]);
  // Remove later template structures as well as their ledger entries to reconstruct v2.
  for (const statement of [
    'DROP INDEX template_qa_issue_attempt_idx',
    'DROP INDEX template_issue_attempt_idx',
    'DROP INDEX template_qa_merge_idx',
    'DROP INDEX template_pr_head_idx',
    'DROP INDEX template_active_pr_idx',
    'DROP INDEX template_child_visit_idx',
    'ALTER TABLE runs DROP COLUMN template_subject',
    'DROP TABLE template_instances',
  ])
    await handle.client.execute(statement);
  expect(
    (await handle.client.execute("SELECT name FROM sqlite_master WHERE name LIKE 'template_%'"))
      .rows,
  ).toEqual([]);
  expect(
    (await handle.client.execute('PRAGMA table_info(runs)')).rows.map((row) => row.name),
  ).not.toContain('template_subject');
  await handle.client.execute('DROP TABLE webhook_receipts');
  await handle.client.execute('DROP INDEX runs_trigger_dedupe_idx');
  await handle.client.execute('DROP TABLE webhook_endpoints');
  await handle.client.execute(
    'CREATE TABLE webhook_endpoints(id text PRIMARY KEY,owner_id text NOT NULL,loop_id text NOT NULL,version_id text NOT NULL,trigger_node_id text NOT NULL,token text NOT NULL,secret_ref text NOT NULL,signature_header text NOT NULL,replay_window_seconds integer NOT NULL,enabled integer NOT NULL,created_at text NOT NULL)',
  );
  await handle.client.execute({
    sql: 'INSERT INTO webhook_endpoints VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    args: [
      'ep',
      'local',
      loop.id,
      version.id,
      'start',
      'token',
      'secret',
      'x-graphgoblin-signature',
      300,
      1,
      FIXTURE_TS,
    ],
  });
  await handle.client.execute({
    sql: 'INSERT INTO inbound_events VALUES (?,?,?,?,?,?,?,?)',
    args: [
      'event',
      'local',
      'webhook',
      '{"id":1}',
      key,
      'webhook:ep',
      FIXTURE_TS,
      JSON.stringify([runId]),
    ],
  });
  await handle.client.execute('DELETE FROM __drizzle_migrations WHERE created_at>=1791396000000');
  return { handle, key, loop, version, runId };
}
async function approval(handle: DatabaseHandle): Promise<DatabaseUpgradeManifest> {
  const inventory = await inspectDatabaseUpgrade(handle.client);
  return {
    format: 'graphgoblin-upgrade-manifest',
    targetVersion: 3,
    sourceHash: inventory.sourceHash,
    approvedBy: 'owner',
    approvedAt: FIXTURE_TS,
    versions: Object.fromEntries(
      inventory.versions.map((v) => [v.id, { definitionHash: v.definitionHash, resolutions: {} }]),
    ),
    failedRuns: {},
  };
}
describe('explicit v2 trigger structural cutover', () => {
  it('refuses an incomplete marked v2 store before normal migrations then atomically upgrades exact defaults/history', async () => {
    const { handle, key, runId } = await previousStructure();
    await expect(guardDatabaseUpgrade(handle.client)).rejects.toMatchObject({
      code: 'DATA_UPGRADE_REQUIRED',
    });
    await expect(handle.migrate()).rejects.toMatchObject({ code: 'DATA_UPGRADE_REQUIRED' });
    expect(
      (await handle.client.execute("SELECT name FROM sqlite_master WHERE name='webhook_receipts'"))
        .rows,
    ).toHaveLength(0);
    const manifest = await approval(handle);
    await applyDatabaseUpgrade(handle.client, manifest);
    expect(await guardDatabaseUpgrade(handle.client)).toBe('current');
    const rows = (await handle.client.execute('SELECT dedupe_key FROM inbound_events')).rows;
    const converted = textColumn(rows[0]!.dedupe_key);
    expect(converted).toMatch(/^sig-hash:[a-f0-9]{64}$/);
    expect(converted).not.toBe(key);
    expect(
      (await new SqliteRunRepository(handle.db).getInitialThread(runId))?.invocation.trigger
        .dedupeKey,
    ).toBe(converted);
    expect(
      (await new SqliteRunRepository(handle.db).getThread(runId))?.invocation.trigger.dedupeKey,
    ).toBe(converted);
    const events = await new SqliteEventStore(handle.db, new FakeClock()).read(runId);
    expect(events[0]).toMatchObject({
      type: 'run.queued',
      initialThread: { invocation: { trigger: { dedupeKey: converted } } },
    });
    expect(
      (
        await handle.client.execute(
          'SELECT signature_scheme,replay_window_seconds FROM webhook_endpoints',
        )
      ).rows[0],
    ).toMatchObject({ signature_scheme: 'hmac-sha256', replay_window_seconds: 300 });
    const archived = (
      await handle.client.execute(
        "SELECT payload FROM gg_upgrade_archive WHERE kind='inbound_events'",
      )
    ).rows;
    expect(textColumn(archived[0]!.payload)).toContain(key);
  });
  it('preserves unreachable endpoint and filtered delivery facts after ordinary loop deletion', async () => {
    const { handle, key, loop, runId } = await previousStructure();
    // Filtered deliveries have no execution references. Normal deletion keeps these records.
    await handle.client.execute('DELETE FROM run_events');
    await handle.client.execute('DELETE FROM runs');
    await handle.client.execute("UPDATE inbound_events SET run_ids='[]'");
    await handle.client.execute({
      sql: 'INSERT INTO inbound_events VALUES (?,?,?,?,?,?,?,?)',
      args: [
        'authored-event',
        'local',
        'webhook',
        '{}',
        'authored-business-key',
        'webhook:ep',
        FIXTURE_TS,
        '[]',
      ],
    });
    await handle.client.execute(
      "INSERT INTO webhook_endpoints SELECT 'unused-ep',owner_id,loop_id,version_id,trigger_node_id,'unused-token',secret_ref,signature_header,replay_window_seconds,enabled,created_at FROM webhook_endpoints",
    );
    await new SqliteWebhookEndpoints(handle.db, new FakeClock(), new FakeIds()).disableLoop(
      loop.id,
    );
    expect(
      await new SqliteLoopRepository(handle.db, new FakeClock(), new FakeIds()).delete(loop.id),
    ).toBe(true);
    expect((await handle.client.execute('SELECT * FROM loop_versions')).rows).toEqual([]);
    expect((await inspectDatabaseUpgrade(handle.client)).issues).toEqual([]);
    await applyDatabaseUpgrade(handle.client, await approval(handle));
    expect(await guardDatabaseUpgrade(handle.client)).toBe('current');
    expect(
      (await handle.client.execute('SELECT dedupe_key FROM inbound_events ORDER BY id')).rows.map(
        (row) => row.dedupe_key,
      ),
    ).toEqual(['authored-business-key', key]);
    expect(
      (
        await handle.client.execute(
          'SELECT enabled,signature_scheme,replay_window_seconds FROM webhook_endpoints',
        )
      ).rows,
    ).toEqual([
      expect.objectContaining({
        enabled: 0,
        signature_scheme: 'hmac-sha256',
        replay_window_seconds: 300,
      }),
      expect.objectContaining({
        enabled: 0,
        signature_scheme: 'hmac-sha256',
        replay_window_seconds: 300,
      }),
    ]);
    expect(await new SqliteRunRepository(handle.db).get(runId)).toBeUndefined();
  });
  it('preserves authored prefix-looking keys and refuses orphaned provenance without structural writes', async () => {
    const custom = await previousStructure(true);
    await applyDatabaseUpgrade(custom.handle.client, await approval(custom.handle));
    expect(
      (await custom.handle.client.execute('SELECT dedupe_key FROM inbound_events')).rows[0]!
        .dedupe_key,
    ).toBe(custom.key);
    const orphan = await previousStructure();
    await orphan.handle.client.execute("UPDATE webhook_endpoints SET version_id='missing'");
    const inventory = await inspectDatabaseUpgrade(orphan.handle.client);
    expect(inventory.issues.map((i) => i.code)).toContain('UPGRADE_WEBHOOK_PROVENANCE_REFUSED');
    await expect(
      applyDatabaseUpgrade(orphan.handle.client, await approval(orphan.handle)),
    ).rejects.toMatchObject({ code: 'DATA_UPGRADE_REQUIRED' });
    expect(
      (
        await orphan.handle.client.execute(
          "SELECT name FROM sqlite_master WHERE name='webhook_receipts'",
        )
      ).rows,
    ).toHaveLength(0);
  });
});

it('keeps canonical v2 failed decision history resumable during structural-only conversion', async () => {
  const { handle, runId, version } = await previousStructure();
  const definition = structuredClone(version.definition);
  definition.nodes.splice(1, 0, {
    id: 'choose',
    kind: 'decision',
    label: 'Choice',
    ui: { x: 0, y: 0 },
    config: {
      answer: {
        type: 'choice',
        options: [
          { id: 'yes', label: 'Yes', criteria: 'Approved' },
          { id: 'no', label: 'No', criteria: 'Rejected' },
        ],
      },
      evaluation: { kind: 'expression', jsonata: '"yes"' },
      recordAlternatives: true,
    },
  });
  await handle.client.execute({
    sql: 'UPDATE loop_versions SET definition=?',
    args: [JSON.stringify(LoopDefinitionSchema.parse(definition))],
  });
  const failure = {
    code: 'EVALUATION_UNAVAILABLE' as const,
    message: 'restore selected evaluator',
    resumable: true,
  };
  // Seed the historical schema without the current repository's later-column projection.
  await handle.client.execute({
    sql: 'UPDATE runs SET status=?,failure=? WHERE id=?',
    args: ['failed', JSON.stringify(failure), runId],
  });
  const fact = {
    answer: { type: 'choice' as const, optionId: 'yes', confidence: null, probabilities: null },
    portId: 'yes',
    provenance: {
      kind: 'expression' as const,
      provider: null,
      classifierId: null,
      model: null,
      effort: null,
    },
    diagnostics: [],
  };
  await new SqliteEventStore(handle.db, new FakeClock()).append(runId, [
    { type: 'decision.made', nodeId: 'choose', ...fact },
  ]);
  expect((await inspectDatabaseUpgrade(handle.client)).failedRuns).toEqual([]);
  await applyDatabaseUpgrade(handle.client, await approval(handle));
  expect((await new SqliteRunRepository(handle.db).get(runId))?.failure).toEqual(failure);
  expect((await new SqliteEventStore(handle.db, new FakeClock()).read(runId))[1]).toMatchObject(
    fact,
  );
});

it('refuses a missing structural ledger, a nonunique receipt index and inconsistent signing fields before startup mutation', async () => {
  const ledger = await openMemoryDatabase();
  handles.push(ledger);
  await ledger.client.execute('DELETE FROM __drizzle_migrations WHERE created_at>=1791396000000');
  await expect(ledger.migrate()).rejects.toMatchObject({ code: 'DATA_UPGRADE_REQUIRED' });
  expect((await ledger.client.execute('SELECT * FROM __drizzle_migrations')).rows).toHaveLength(8);
  const unique = await openMemoryDatabase();
  handles.push(unique);
  await unique.client.execute('DROP INDEX webhook_receipts_content_idx');
  await unique.client.execute(
    'CREATE INDEX webhook_receipts_content_idx ON webhook_receipts(owner_id,loop_id,trigger_node_id,content_hash)',
  );
  await expect(guardDatabaseUpgrade(unique.client)).rejects.toMatchObject({
    code: 'DATA_UPGRADE_REQUIRED',
  });
  const signing = await openMemoryDatabase();
  handles.push(signing);
  await signing.client.execute('PRAGMA ignore_check_constraints=ON');
  await signing.client.execute(
    "INSERT INTO webhook_endpoints(id,owner_id,loop_id,version_id,trigger_node_id,token,secret_ref,signature_header,signature_scheme,replay_window_seconds,enabled,created_at) VALUES ('ep','local','loop','version','hook','token','secret','x-signature','hmac-sha256-body',300,1,'2026-10-02T12:00:00.000Z')",
  );
  await expect(guardDatabaseUpgrade(signing.client)).rejects.toMatchObject({
    code: 'DATA_UPGRADE_REQUIRED',
  });
});

it('refuses an incomplete intermediate receipt layout before migration or recovery', async () => {
  const handle = await openMemoryDatabase();
  handles.push(handle);
  await handle.client.execute('DROP TABLE webhook_receipts');
  await handle.client.execute(
    "CREATE TABLE webhook_receipts(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, loop_id TEXT NOT NULL, trigger_node_id TEXT NOT NULL, content_hash TEXT NOT NULL, inbound_id TEXT NOT NULL, status TEXT NOT NULL CONSTRAINT webhook_receipt_status_check CHECK(status IN ('filtered','pending','admitted','failed')), intent TEXT CONSTRAINT webhook_receipt_intent_check CHECK((status='filtered' AND intent IS NULL) OR (status!='filtered' AND intent IS NOT NULL)), attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT, failure_code TEXT)",
  );
  await handle.client.execute(
    'CREATE UNIQUE INDEX webhook_receipts_content_idx ON webhook_receipts(owner_id,loop_id,trigger_node_id,content_hash)',
  );
  await handle.client.execute(
    'CREATE UNIQUE INDEX webhook_receipts_inbound_idx ON webhook_receipts(inbound_id)',
  );
  await handle.client.execute(
    'CREATE INDEX webhook_receipts_due_idx ON webhook_receipts(status,next_attempt_at)',
  );
  await expect(handle.migrate()).rejects.toMatchObject({ code: 'DATA_UPGRADE_REQUIRED' });
  expect((await handle.client.execute('SELECT * FROM __drizzle_migrations')).rows).toHaveLength(12);
});
