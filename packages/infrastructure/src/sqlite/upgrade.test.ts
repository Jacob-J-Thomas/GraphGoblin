import { afterEach, describe, expect, it } from 'vitest';
import { FIXTURE_IDS, FIXTURE_TS, minimalLoop, sampleThread } from '@graphgoblin/contracts/testing';
import {
  ContextThreadSchema,
  LoopDefinitionSchema,
  RunEventSchema,
  type RunStatus,
  V2NodeConfigSchemas,
} from '@graphgoblin/contracts';
import { openMemoryDatabase, openDatabase, type DatabaseHandle } from './db.js';
import { SqliteRunRepository } from './runs.js';
import { upgradeLoopV1 } from '@graphgoblin/domain';
import { fakeUlid } from '@graphgoblin/contracts/testing';
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

describe('format-3 exit cutover', () => {
  const sides = {
    type: 'noul' as const,
    true: { label: 'Done', criteria: 'All work is complete' },
    false: { label: 'Pending', criteria: 'Required work remains' },
  };
  async function v2(handle: DatabaseHandle, criteria: unknown[]) {
    const frozen = upgradeLoopV1(definition());
    if (!frozen.ok) throw new Error('fixture conversion failed');
    const value = structuredClone(frozen.value);
    const exit = value.nodes.find((node) => node.kind === 'exit');
    if (!exit || exit.kind !== 'exit') throw new Error('fixture exit missing');
    // Deliberately write an old-format source; current repository methods must not admit it.
    const raw = {
      ...value,
      nodes: value.nodes.map((node) =>
        node.id === exit.id ? { ...node, config: { ...exit.config, criteria } } : node,
      ),
    };
    await handle.client.execute({
      sql: 'UPDATE loop_versions SET definition=? WHERE id=?',
      args: [JSON.stringify(raw), FIXTURE_IDS.version],
    });
    return raw;
  }
  it('refuses unresolved provider intent atomically, then converts exact factual evidence and preserves prior audit/session rows', async () => {
    const handle = await legacy('failed');
    const original = await v2(handle, [
      {
        when: 'predicate',
        strategy: 'jev',
        question: 'Done?',
        minConfidence: 0.8,
        outcome: 'success',
      },
      {
        when: 'predicate',
        strategy: 'codex',
        question: 'Ready?',
        minConfidence: 0.7,
        outcome: 'failure',
      },
    ]);
    await handle.client.execute(
      'CREATE TABLE gg_upgrade_state (id INTEGER PRIMARY KEY, format_version INTEGER NOT NULL,status TEXT NOT NULL,source_hash TEXT NOT NULL,manifest_hash TEXT NOT NULL)',
    );
    await handle.client.execute("INSERT INTO gg_upgrade_state VALUES (1,2,'complete','old','old')");
    await handle.client.execute(
      'CREATE TABLE gg_upgrade_archive (kind TEXT NOT NULL,identity TEXT NOT NULL,source_hash TEXT NOT NULL,manifest_hash TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(kind,identity,manifest_hash))',
    );
    await handle.client.execute(
      "INSERT INTO gg_upgrade_archive VALUES ('previous','retained','old','old','{\"retained\":true}')",
    );
    const oldFact = {
      iteration: 1,
      maxIterations: 10,
      criteria: [
        {
          index: 0,
          strategy: 'jev',
          status: 'not-matched',
          holds: false,
          confidence: 0.6,
          minConfidence: 0.8,
        },
        { index: 1, strategy: 'codex', status: 'matched' },
      ],
      result: {
        kind: 'completed',
        outcome: 'failure',
        reason: 'criterion-matched',
        criterionIndex: 1,
      },
    };
    await handle.client.execute({
      sql: "INSERT INTO run_events (run_id,seq,ts,type,node_id,payload) VALUES (?,4,?,'exit.evaluated','done',?)",
      args: [FIXTURE_IDS.run, FIXTURE_TS, JSON.stringify(oldFact)],
    });
    await expect(guardDatabaseUpgrade(handle.client)).rejects.toMatchObject({
      code: 'DATA_UPGRADE_REQUIRED',
    });
    const sessions = (await handle.client.execute('SELECT * FROM harness_sessions')).rows;
    const inventory = await inspectDatabaseUpgrade(handle.client);
    expect(inventory.versions[0]?.predicates).toEqual([
      '/nodes/2/config/criteria/0',
      '/nodes/2/config/criteria/1',
    ]);
    expect(inventory.versions[0]?.issues).toMatchObject([
      { code: 'UPGRADE_EXIT_CRITERIA_REQUIRED' },
      { code: 'UPGRADE_EXIT_CRITERIA_REQUIRED' },
    ]);
    const selected = await manifest(handle);
    await expect(applyDatabaseUpgrade(handle.client, selected)).rejects.toMatchObject({
      code: 'DATA_UPGRADE_REQUIRED',
    });
    expect((await inspectDatabaseUpgrade(handle.client)).sourceHash).toBe(inventory.sourceHash);
    expect(
      (await handle.client.execute('SELECT format_version FROM gg_upgrade_state')).rows[0]
        ?.format_version,
    ).toBe(2);
    selected.versions[FIXTURE_IDS.version]!.resolutions = {
      predicates: {
        '/nodes/2/config/criteria/0': { answer: sides },
        '/nodes/2/config/criteria/1': { answer: sides },
      },
    };
    await applyDatabaseUpgrade(handle.client, selected);
    expect(await guardDatabaseUpgrade(handle.client)).toBe('current');
    const converted = JSON.parse(
      storedText(
        (await handle.client.execute("SELECT payload FROM run_events WHERE type='exit.evaluated'"))
          .rows[0]?.payload,
      ),
    );
    expect(converted.criteria[0]).toMatchObject({
      answer: { holds: false, confidence: 0.6, trueProbability: null },
      acceptance: null,
      configuredMinConfidence: 0.8,
    });
    expect(converted.criteria[1]).toMatchObject({
      answer: { holds: null, confidence: null, reasoning: null },
      acceptance: null,
    });
    expect(
      (await handle.client.execute("SELECT payload FROM gg_upgrade_archive WHERE kind='previous'"))
        .rows[0]?.payload,
    ).toBe('{"retained":true}');
    const archived = (
      await handle.client.execute(
        "SELECT payload FROM gg_upgrade_archive WHERE kind='run_events' AND identity LIKE '%:4'",
      )
    ).rows[0]?.payload;
    expect(JSON.parse(String(JSON.parse(storedText(archived)).payload))).toEqual(oldFact);
    expect((await handle.client.execute('SELECT * FROM harness_sessions')).rows).toEqual(sessions);
    const stored = JSON.parse(
      storedText(
        (await handle.client.execute('SELECT definition FROM loop_versions')).rows[0]?.definition,
      ),
    );
    expect(stored.edges).toEqual(original.edges);
    expect(stored.nodes[2].config.return).toEqual(
      original.nodes[2]?.kind === 'exit' && original.nodes[2].config.return,
    );
  });
  it('requires an affected failed parent disposition when only a reachable child has a legacy exit', async () => {
    const handle = await legacy('failed');
    const parent = await v2(handle, []);
    const childLoop = fakeUlid('exit-child-loop'),
      childVersion = fakeUlid('exit-child-version');
    parent.nodes.push({
      id: 'child',
      kind: 'subloop',
      label: 'Child',
      ui: { x: 0, y: 0 },
      config: V2NodeConfigSchemas.subloop.parse({
        loopRef: { loopId: childLoop, version: 'latest' },
      }),
    });
    await handle.client.execute({
      sql: 'UPDATE loop_versions SET definition=? WHERE id=?',
      args: [JSON.stringify(parent), FIXTURE_IDS.version],
    });
    const child = {
      ...minimalLoop(),
      schemaVersion: 2,
      nodes: [
        minimalLoop().nodes[0],
        {
          id: 'done',
          kind: 'exit',
          label: 'Done',
          config: {
            criteria: [
              { when: 'predicate', strategy: 'expression', jsonata: 'true', outcome: 'success' },
            ],
          },
        },
      ],
    };
    await handle.client.execute({
      sql: 'INSERT INTO loop_versions (id,loop_id,version,status,definition,created_at) VALUES (?,?,1,?,?,?)',
      args: [childVersion, childLoop, 'published', JSON.stringify(child), FIXTURE_TS],
    });
    const inventory = await inspectDatabaseUpgrade(handle.client);
    expect(inventory.failedRuns).toContain(FIXTURE_IDS.run);
    const approved = await manifest(handle);
    approved.failedRuns = {};
    await expect(applyDatabaseUpgrade(handle.client, approved)).rejects.toThrow(
      /affected failed run/,
    );
  });
  it('requires an affected recorded child disposition even after the parent definition drops that reference', async () => {
    const handle = await legacy('failed');
    await v2(handle, []);
    const childVersion = fakeUlid('recorded-exit-child'),
      childLoop = fakeUlid('recorded-exit-loop');
    const child = {
      ...minimalLoop(),
      schemaVersion: 2,
      nodes: [
        minimalLoop().nodes[0],
        {
          id: 'done',
          kind: 'exit',
          label: 'Done',
          config: {
            criteria: [
              { when: 'predicate', strategy: 'expression', jsonata: 'true', outcome: 'success' },
            ],
          },
        },
      ],
    };
    await handle.client.execute({
      sql: 'INSERT INTO loop_versions (id,loop_id,version,status,definition,created_at) VALUES (?,?,1,?,?,?)',
      args: [childVersion, childLoop, 'published', JSON.stringify(child), FIXTURE_TS],
    });
    await handle.client.execute({
      sql: "INSERT INTO run_events (run_id,seq,ts,type,payload) VALUES (?,4,?,'run.queued',?)",
      args: [
        FIXTURE_IDS.run,
        FIXTURE_TS,
        JSON.stringify({ subloopVersions: { [childLoop]: childVersion } }),
      ],
    });
    expect((await inspectDatabaseUpgrade(handle.client)).failedRuns).toContain(FIXTURE_IDS.run);
  });
  it.each(['true[false]', '(vars.count > 0)[false]', 'true{"x": true}'])(
    'atomically refuses output-modified boolean %s until its exact rewrite is approved',
    async (source) => {
      const handle = await legacy();
      const original = await v2(handle, [
        { when: 'predicate', strategy: 'expression', jsonata: source, outcome: 'success' },
      ]);
      const before = (await inspectDatabaseUpgrade(handle.client)).sourceHash;
      const approved = await manifest(handle);
      await expect(applyDatabaseUpgrade(handle.client, approved)).rejects.toMatchObject({
        code: 'DATA_UPGRADE_REQUIRED',
      });
      expect((await inspectDatabaseUpgrade(handle.client)).sourceHash).toBe(before);
      expect(
        JSON.parse(
          storedText(
            (
              await handle.client.execute({
                sql: 'SELECT definition FROM loop_versions WHERE id=?',
                args: [FIXTURE_IDS.version],
              })
            ).rows[0]!.definition,
          ),
        ),
      ).toEqual(original);
      approved.versions[FIXTURE_IDS.version]!.resolutions = {
        predicates: { '/nodes/2/config/criteria/0': { jsonata: '(vars.count > 0) = true' } },
      };
      await applyDatabaseUpgrade(handle.client, approved);
      expect(await guardDatabaseUpgrade(handle.client)).toBe('current');
      const stored = JSON.parse(
        storedText(
          (
            await handle.client.execute({
              sql: 'SELECT definition FROM loop_versions WHERE id=?',
              args: [FIXTURE_IDS.version],
            })
          ).rows[0]!.definition,
        ),
      );
      expect(stored).toHaveProperty(
        'nodes.2.config.criteria.0.evaluation.jsonata',
        '(vars.count > 0) = true',
      );
    },
  );
  it('refuses stale predicate keys and ambiguous expressions without changing any source rows', async () => {
    const handle = await legacy();
    await v2(handle, [
      { when: 'predicate', strategy: 'expression', jsonata: 'vars.done', outcome: 'success' },
    ]);
    const before = (await inspectDatabaseUpgrade(handle.client)).sourceHash;
    const approved = await manifest(handle);
    approved.versions[FIXTURE_IDS.version]!.resolutions = {
      predicates: { '/nodes/2/config/criteria/1': { jsonata: 'vars.done = true' } },
    };
    await expect(applyDatabaseUpgrade(handle.client, approved)).rejects.toMatchObject({
      code: 'DATA_UPGRADE_REQUIRED',
    });
    expect((await inspectDatabaseUpgrade(handle.client)).sourceHash).toBe(before);
    approved.versions[FIXTURE_IDS.version]!.resolutions = {
      predicates: { '/nodes/2/config/criteria/0': { jsonata: 'vars.done = true' } },
    };
    await applyDatabaseUpgrade(handle.client, approved);
    expect(await guardDatabaseUpgrade(handle.client)).toBe('current');
  });
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
    targetVersion: 3,
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
      3,
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
