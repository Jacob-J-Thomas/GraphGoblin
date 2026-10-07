import { afterEach, describe, expect, it } from 'vitest';
import { FIXTURE_IDS, FIXTURE_TS, minimalLoop, sampleThread } from '@graphgoblin/contracts/testing';
import {
  ContextThreadSchema,
  LoopDefinitionSchema,
  RunEventSchema,
  type RunStatus,
} from '@graphgoblin/contracts';
import { openMemoryDatabase, openDatabase, type DatabaseHandle } from './db.js';
import { SqliteRunRepository } from './runs.js';
import {
  applyDatabaseUpgrade,
  guardDatabaseUpgrade,
  inspectDatabaseUpgrade,
  DatabaseUpgradeRequiredError,
  type DatabaseUpgradeManifest,
} from './upgrade.js';

const storedText = (value: unknown): string => {
  if (typeof value !== 'string') throw new Error('Expected stored JSON text');
  return value;
};
const handles: DatabaseHandle[] = [];
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
});
const definition = () => ({
  ...minimalLoop(),
  schemaVersion: 1,
  settings: { defaults: { model: 'gpt-6-luna', effort: 'low' } },
  nodes: [
    minimalLoop().nodes[0],
    {
      id: 'decide',
      kind: 'decision',
      label: 'Choose',
      config: {
        routes: [
          { label: 'yes', description: 'Approved' },
          { label: 'no', description: 'Rejected' },
        ],
        question: 'Choose',
        strategy: ['expression'],
        expression: { jsonata: '"yes"' },
      },
    },
    minimalLoop().nodes[1],
  ],
  edges: [
    { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'decide' } },
    { id: 'e2', from: { node: 'decide', port: 'yes' }, to: { node: 'done' } },
    { id: 'e3', from: { node: 'decide', port: 'no' }, to: { node: 'done' } },
  ],
});
async function legacy(status: RunStatus = 'succeeded', badHistory = false) {
  const handle = await openMemoryDatabase();
  handles.push(handle);
  await handle.client.execute('DROP TABLE gg_upgrade_state');
  await handle.client.execute({
    sql: 'INSERT INTO loop_versions (id,loop_id,version,status,definition,created_at) VALUES (?,?,1,?,?,?)',
    args: [
      FIXTURE_IDS.version,
      FIXTURE_IDS.loop,
      'published',
      JSON.stringify(definition()),
      FIXTURE_TS,
    ],
  });
  const failure = {
    code: 'DECIDER_UNAVAILABLE' as const,
    message: 'old evaluator',
    resumable: true,
    details: { retained: 'fact' },
  };
  await new SqliteRunRepository(handle.db).create(
    {
      id: FIXTURE_IDS.run,
      ownerId: 'hidden-owner',
      loopId: FIXTURE_IDS.loop,
      versionId: FIXTURE_IDS.version,
      invocationId: FIXTURE_IDS.invocation,
      status,
      iteration: 1,
      createdAt: FIXTURE_TS,
      lastEventSeq: 0,
      ...(status === 'failed' ? { failure } : {}),
    },
    sampleThread(),
  );
  const facts = badHistory
    ? [{ type: 'unknown', nodeId: 'decide', payload: {} }]
    : [
        {
          type: 'node.started',
          nodeId: 'decide',
          payload: { kind: 'decision', attempt: 1, configHash: 'h' },
        },
        {
          type: 'decision.made',
          nodeId: 'decide',
          payload: {
            strategy: 'expression',
            route: 'yes',
            alternatives: [{ route: 'no' }],
            skipped: [{ strategy: 'codex', code: 'PROVIDER_UNAVAILABLE', message: 'old fact' }],
          },
        },
        {
          type: 'node.finished',
          nodeId: 'decide',
          payload: {
            durationMs: 1,
            route: 'yes',
            patch: [
              {
                op: 'add',
                path: '/outputs/decide',
                value: {
                  nodeId: 'decide',
                  at: FIXTURE_TS,
                  value: { route: 'yes', strategy: 'expression' },
                },
              },
              {
                op: 'add',
                path: '/lastOutput',
                value: {
                  nodeId: 'decide',
                  at: FIXTURE_TS,
                  value: { route: 'yes', strategy: 'expression' },
                },
              },
            ],
          },
        },
      ];
  for (const [index, event] of facts.entries())
    await handle.client.execute({
      sql: 'INSERT INTO run_events (run_id,seq,ts,type,node_id,payload) VALUES (?,?,?,?,?,?)',
      args: [
        FIXTURE_IDS.run,
        index + 1,
        FIXTURE_TS,
        event.type,
        event.nodeId,
        JSON.stringify(event.payload),
      ],
    });
  await handle.client.execute({
    sql: 'INSERT INTO settings (owner_id,key,value,updated_at) VALUES (?,?,?,?)',
    args: ['hidden-owner', 'defaultModel', JSON.stringify('gpt-6-luna'), FIXTURE_TS],
  });
  await handle.client.execute({
    sql: 'INSERT INTO harness_sessions (run_id,node_id,attempt,harness,session_id,status,updated_at) VALUES (?,?,1,?,?,?,?)',
    args: [FIXTURE_IDS.run, 'worker', 'codex', 'unchanged-session', 'failed', FIXTURE_TS],
  });
  return handle;
}
async function manifest(handle: DatabaseHandle): Promise<DatabaseUpgradeManifest> {
  const inventory = await inspectDatabaseUpgrade(handle.client);
  return {
    format: 'graphgoblin-upgrade-manifest',
    targetVersion: 2,
    sourceHash: inventory.sourceHash,
    approvedBy: 'owner',
    approvedAt: FIXTURE_TS,
    versions: Object.fromEntries(
      inventory.versions.map((version) => [
        version.id,
        { definitionHash: version.definitionHash, resolutions: {} },
      ]),
    ),
    failedRuns: Object.fromEntries(
      inventory.failedRuns.map((id) => [
        id,
        {
          disposition: 'nonresumable-replay' as const,
          reason: 'Selected decision semantics changed',
        },
      ]),
    ),
  };
}
describe('offline database upgrade boundary', () => {
  it('stamps a genuinely fresh database and refuses unmarked existing state before normal migration', async () => {
    const fresh = await openMemoryDatabase();
    handles.push(fresh);
    expect(await guardDatabaseUpgrade(fresh.client)).toBe('current');
    await fresh.migrate();
    const handle = await legacy();
    const before = (await handle.client.execute('SELECT * FROM __drizzle_migrations')).rows;
    await expect(handle.migrate()).rejects.toBeInstanceOf(DatabaseUpgradeRequiredError);
    expect((await handle.client.execute('SELECT * FROM __drizzle_migrations')).rows).toEqual(
      before,
    );
  });
  it('inventories hidden/deleted historical versions, failed runs, exact version hashes and unchanged sessions', async () => {
    const handle = await legacy('failed');
    const inventory = await inspectDatabaseUpgrade(handle.client);
    expect(inventory.versions).toMatchObject([
      {
        id: FIXTURE_IDS.version,
        definitionHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        decisions: ['decide'],
      },
    ]);
    expect(inventory.failedRuns).toEqual([FIXTURE_IDS.run]);
    expect(inventory.tables.harness_sessions).toHaveLength(1);
    expect(inventory.tables.loops).toEqual([]); // Deleted parent is not filtered out of historical inventory.
  });
  it('converts definitions/events/patches/owner defaults atomically, archives exact old facts, leaves sessions untouched', async () => {
    const handle = await legacy('failed');
    const sessions = (await handle.client.execute('SELECT * FROM harness_sessions')).rows;
    const approved = await manifest(handle);
    expect(await applyDatabaseUpgrade(handle.client, approved)).toMatchObject({
      versions: 1,
      runs: 1,
    });
    expect(await guardDatabaseUpgrade(handle.client)).toBe('current');
    const row = (await handle.client.execute('SELECT definition FROM loop_versions')).rows[0]!;
    expect(LoopDefinitionSchema.parse(JSON.parse(storedText(row.definition))).schemaVersion).toBe(
      2,
    );
    const event = (
      await handle.client.execute("SELECT payload FROM run_events WHERE type='decision.made'")
    ).rows[0]!;
    expect(JSON.parse(storedText(event.payload))).toMatchObject({
      answer: { optionId: 'yes', confidence: null, probabilities: null },
      diagnostics: [{ code: 'PROVIDER_UNAVAILABLE', message: 'old fact' }],
    });
    const archived = (
      await handle.client.execute(
        "SELECT payload FROM gg_upgrade_archive WHERE kind='run_events' AND identity LIKE '%:2'",
      )
    ).rows[0]!;
    expect(JSON.parse(String(JSON.parse(storedText(archived.payload)).payload))).toMatchObject({
      alternatives: [{ route: 'no' }],
      skipped: [{ strategy: 'codex', code: 'PROVIDER_UNAVAILABLE' }],
    });
    expect((await handle.client.execute('SELECT * FROM harness_sessions')).rows).toEqual(sessions);
    const settings = (
      await handle.client.execute("SELECT value FROM settings WHERE key='defaults'")
    ).rows[0]!;
    expect(JSON.parse(storedText(settings.value))).toEqual({
      byHarness: { codex: { model: 'gpt-6-luna' } },
    });
    const run = (await handle.client.execute('SELECT failure,initial_thread FROM runs')).rows[0]!;
    expect(JSON.parse(storedText(run.failure))).toMatchObject({
      code: 'DECIDER_UNAVAILABLE',
      resumable: false,
      details: { original: { retained: 'fact' }, upgrade: { disposition: 'nonresumable-replay' } },
    });
    ContextThreadSchema.parse(JSON.parse(storedText(run.initial_thread)));
    const made = JSON.parse(storedText(event.payload));
    RunEventSchema.parse({
      ...made,
      runId: FIXTURE_IDS.run,
      seq: 2,
      ts: FIXTURE_TS,
      type: 'decision.made',
      nodeId: 'decide',
    });
  });
  it.each(['queued', 'running', 'waiting', 'paused'] as const)(
    'refuses %s without cancelling or mutating',
    async (status) => {
      const handle = await legacy(status),
        before = await inspectDatabaseUpgrade(handle.client);
      await expect(applyDatabaseUpgrade(handle.client, await manifest(handle))).rejects.toThrow(
        /nonterminal/,
      );
      expect((await inspectDatabaseUpgrade(handle.client)).sourceHash).toBe(before.sourceHash);
      expect((await handle.client.execute('SELECT status FROM runs')).rows[0]?.status).toBe(status);
    },
  );
  it('requires every failed-run choice and refuses stale source/version identities, unknown manifest targets', async () => {
    const handle = await legacy('failed');
    const approved = await manifest(handle);
    for (const bad of [
      { ...approved, sourceHash: 'stale' },
      { ...approved, approvedBy: '' },
      { ...approved, approvedAt: 'invalid' },
      { ...approved, versions: {} },
      { ...approved, failedRuns: {} },
      {
        ...approved,
        versions: { ...approved.versions, unknown: { definitionHash: 'wrong', resolutions: {} } },
      },
      {
        ...approved,
        failedRuns: {
          ...approved.failedRuns,
          unknown: { disposition: 'nonresumable-replay' as const, reason: 'wrong' },
        },
      },
    ])
      await expect(applyDatabaseUpgrade(handle.client, bad)).rejects.toBeInstanceOf(
        DatabaseUpgradeRequiredError,
      );
  });
  it('rolls back definition rewrites, audit DDL and state marker when historical validation fails after conversion', async () => {
    const handle = await legacy('succeeded', true),
      before = await inspectDatabaseUpgrade(handle.client);
    await expect(applyDatabaseUpgrade(handle.client, await manifest(handle))).rejects.toThrow(
      /history/,
    );
    expect((await inspectDatabaseUpgrade(handle.client)).sourceHash).toBe(before.sourceHash);
    expect(
      (
        await handle.client.execute(
          "SELECT name FROM sqlite_master WHERE name IN ('gg_upgrade_state','gg_upgrade_archive')",
        )
      ).rows,
    ).toHaveLength(0);
  });
  it('refuses incomplete marker, mixed chains, invalid stored JSON and orphaned event stores', async () => {
    const incomplete = await openMemoryDatabase();
    handles.push(incomplete);
    await incomplete.client.execute("UPDATE gg_upgrade_state SET status='pending'");
    await expect(incomplete.migrate()).rejects.toThrow(/incomplete/);
    const mixed = await legacy();
    const old = definition();
    old.nodes[1]!.config = { ...old.nodes[1]!.config, strategy: ['codex', 'expression'] };
    await mixed.client.execute({
      sql: 'UPDATE loop_versions SET definition=?',
      args: [JSON.stringify(old)],
    });
    await expect(applyDatabaseUpgrade(mixed.client, await manifest(mixed))).rejects.toThrow(
      /Unresolved version/,
    );
    await mixed.client.execute("UPDATE loop_versions SET definition='{'");
    expect((await inspectDatabaseUpgrade(mixed.client)).issues).toMatchObject([
      { code: 'UPGRADE_STORED_JSON_INVALID' },
    ]);
    const orphan = await legacy();
    await orphan.client.execute('DELETE FROM runs');
    expect((await inspectDatabaseUpgrade(orphan.client)).issues).toMatchObject([
      { code: 'UPGRADE_ORPHAN_EVENTS' },
      { code: 'UPGRADE_ORPHAN_EVENTS' },
      { code: 'UPGRADE_ORPHAN_EVENTS' },
    ]);
  });
});

it('refuses recorded migration-only damaged stores while permitting a truly empty ledger', async () => {
  const handle = openDatabase({ url: ':memory:' });
  handles.push(handle);
  await handle.client.execute(
    'CREATE TABLE __drizzle_migrations(id INTEGER PRIMARY KEY,hash TEXT,created_at NUMERIC)',
  );
  expect(await guardDatabaseUpgrade(handle.client)).toBe('fresh');
  await handle.client.execute("INSERT INTO __drizzle_migrations VALUES(1,'old',1)");
  await expect(guardDatabaseUpgrade(handle.client)).rejects.toMatchObject({
    code: 'DATA_UPGRADE_REQUIRED',
  });
});
it('retains DECISION_NO_ROUTE exactly and adds only the approved nonresumable disposition', async () => {
  const handle = await legacy('failed');
  const failure = {
    code: 'DECISION_NO_ROUTE',
    message: 'No strategy produced a route',
    resumable: true,
    details: { attempt: 2 },
  };
  await handle.client.execute({
    sql: 'UPDATE runs SET failure=?',
    args: [JSON.stringify(failure)],
  });
  await handle.client.execute({
    sql: "INSERT INTO run_events(run_id,seq,ts,type,payload) VALUES(?,4,?,'run.failed',?)",
    args: [FIXTURE_IDS.run, FIXTURE_TS, JSON.stringify({ failure })],
  });
  await applyDatabaseUpgrade(handle.client, await manifest(handle));
  const runFailure = JSON.parse(
    storedText((await handle.client.execute('SELECT failure FROM runs')).rows[0]!.failure),
  );
  const eventFailure = JSON.parse(
    storedText(
      (await handle.client.execute("SELECT payload FROM run_events WHERE type='run.failed'"))
        .rows[0]!.payload,
    ),
  ).failure;
  expect(runFailure).toMatchObject({
    ...failure,
    resumable: false,
    details: { original: failure.details },
  });
  expect(eventFailure).toEqual(runFailure);
});
it('refuses orphaned failed version references even with no decision event to identify output provenance', async () => {
  const handle = await legacy('failed');
  await handle.client.execute('DELETE FROM loop_versions');
  await handle.client.execute('DELETE FROM run_events');
  const initial = {
    ...sampleThread(),
    lastOutput: {
      nodeId: 'decide',
      at: FIXTURE_TS,
      value: { route: 'yes', strategy: 'expression' },
    },
  };
  await handle.client.execute({
    sql: 'UPDATE runs SET initial_thread=?,thread_snapshot=?',
    args: [JSON.stringify(initial), JSON.stringify(initial)],
  });
  const inventory = await inspectDatabaseUpgrade(handle.client);
  expect(inventory.issues).toMatchObject([
    { code: 'UPGRADE_ORPHAN_RUN_VERSION', path: '/runs/' + FIXTURE_IDS.run + '/version_id' },
  ]);
  await expect(applyDatabaseUpgrade(handle.client, await manifest(handle))).rejects.toThrow(
    /structural refusals/,
  );
  expect((await inspectDatabaseUpgrade(handle.client)).sourceHash).toBe(inventory.sourceHash);
});
it('requires explicit failed parent disposition for possible changed child returns without own decision nodes', async () => {
  const handle = await legacy('failed');
  const parent = {
    ...definition(),
    nodes: [
      minimalLoop().nodes[0],
      {
        id: 'child',
        kind: 'subloop',
        label: 'Child',
        config: { loopRef: { loopId: FIXTURE_IDS.loop } },
      },
      minimalLoop().nodes[1],
    ],
    edges: [
      { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'child' } },
      { id: 'b', from: { node: 'child', port: 'out' }, to: { node: 'done' } },
    ],
  };
  await handle.client.execute({
    sql: 'UPDATE loop_versions SET definition=?',
    args: [JSON.stringify(parent)],
  });
  await handle.client.execute('DELETE FROM run_events');
  expect((await inspectDatabaseUpgrade(handle.client)).failedRuns).toEqual([FIXTURE_IDS.run]);
  const approved = await manifest(handle);
  await expect(
    applyDatabaseUpgrade(handle.client, { ...approved, failedRuns: {} }),
  ).rejects.toThrow(/Every affected failed run/);
  await applyDatabaseUpgrade(handle.client, approved);
});
