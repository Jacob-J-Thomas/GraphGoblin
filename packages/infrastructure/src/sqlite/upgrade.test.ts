import { CURRENT_DEFINITION_FORMAT } from '@graphgoblin/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { FIXTURE_IDS, FIXTURE_TS, minimalLoop, sampleThread } from '@graphgoblin/contracts/testing';
import { type RunStatus, V2NodeConfigSchemas } from '@graphgoblin/contracts';
import { openMemoryDatabase, openDatabase, type DatabaseHandle } from './db.js';
import { SqliteRunRepository } from './runs.js';
import { upgradeLoopV1, upgradeLoopCurrent } from '@graphgoblin/domain';
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

async function assertUpgradeRefusedUnchanged(
  client: DatabaseHandle['client'],
  selected: DatabaseUpgradeManifest,
) {
  const before = (await inspectDatabaseUpgrade(client)).sourceHash;
  const schema = (await client.execute('SELECT * FROM sqlite_master ORDER BY name')).rows;
  await expect(applyDatabaseUpgrade(client, selected)).rejects.toMatchObject({
    code: 'DATA_UPGRADE_REQUIRED',
  });
  expect((await inspectDatabaseUpgrade(client)).sourceHash).toBe(before);
  expect((await client.execute('SELECT * FROM sqlite_master ORDER BY name')).rows).toEqual(schema);
}
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
  it('preserves provider intent, factual history and prior audit rows while refusing the missing format-4 stage', async () => {
    const handle = await legacy('failed');
    const _original = await v2(handle, [
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
    const _sessions = (await handle.client.execute('SELECT * FROM harness_sessions')).rows;
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
    await assertUpgradeRefusedUnchanged(handle.client, selected);
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
      await assertUpgradeRefusedUnchanged(handle.client, approved);
      await expect(guardDatabaseUpgrade(handle.client)).rejects.toMatchObject({
        code: 'DATA_UPGRADE_REQUIRED',
      });
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
      expect(stored).toEqual(original);
      const stage = upgradeLoopCurrent(
        original,
        approved.versions[FIXTURE_IDS.version]!.resolutions,
      );
      expect(stage.ok).toBe(true);
      if (stage.ok)
        expect(stage.value).toHaveProperty(
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
    await assertUpgradeRefusedUnchanged(handle.client, approved);
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
    targetVersion: CURRENT_DEFINITION_FORMAT,
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
    expect(inventory.tableCounts.harness_sessions).toBe(1);
    expect(inventory.tableCounts.loops).toBe(0); // Deleted parent is not filtered out of historical inventory.
  });
  it('refuses historical definition and output rewrites atomically until the integrated format-4 stage exists', async () => {
    const handle = await legacy('failed');
    const _sessions = (await handle.client.execute('SELECT * FROM harness_sessions')).rows;
    const approved = await manifest(handle);
    await assertUpgradeRefusedUnchanged(handle.client, approved);
  });
  it('preserves pre-#103/#104 history in a fully migrated store while refusing the missing format-4 stage', async () => {
    // Fully migrate before inserting old events: migration 0007 would otherwise backfill skipped: [].
    const handle = await legacy();
    const oldDecision = { strategy: 'expression', route: 'yes' };
    const oldProgress = {
      progress: { item: { id: 'item-1', type: 'command', summary: 'Command completed' } },
    };
    await handle.client.execute({
      sql: 'UPDATE run_events SET payload=? WHERE run_id=? AND seq=2',
      args: [JSON.stringify(oldDecision), FIXTURE_IDS.run],
    });
    await handle.client.execute({
      sql: 'INSERT INTO run_events (run_id,seq,ts,type,node_id,payload) VALUES (?,4,?,?,?,?)',
      args: [FIXTURE_IDS.run, FIXTURE_TS, 'node.progress', 'worker', JSON.stringify(oldProgress)],
    });
    const oldError = {
      progress: {
        item: {
          id: 'error-1',
          type: 'error',
          summary: 'Private harness error: provider-private-value',
        },
      },
    };
    const oldTool = {
      progress: {
        item: {
          id: 'tool-1',
          type: 'tool-call',
          summary: 'browser.search failed: provider-private-value',
        },
      },
    };
    for (const [seq, payload] of [
      [5, oldError],
      [6, oldTool],
    ] as const)
      await handle.client.execute({
        sql: 'INSERT INTO run_events (run_id,seq,ts,type,node_id,payload) VALUES (?,?,?,?,?,?)',
        args: [
          FIXTURE_IDS.run,
          seq,
          FIXTURE_TS,
          'node.progress',
          'worker',
          JSON.stringify(payload),
        ],
      });
    await assertUpgradeRefusedUnchanged(handle.client, await manifest(handle));
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
      /format-4 conversion/,
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
it('retains DECISION_NO_ROUTE and its resumability exactly while the format-4 cutover is unavailable', async () => {
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
  await assertUpgradeRefusedUnchanged(handle.client, await manifest(handle));
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
  await assertUpgradeRefusedUnchanged(handle.client, approved);
});
import { createHash } from 'node:crypto';
import { stableStringify } from '@graphgoblin/domain';
import { rows, tableNames } from './upgrade-scan.js';

it('preserves the original canonical whole-store hash on upgrade fixtures', async () => {
  const handle = await legacy('failed');
  // Independent reference: the original algorithm, deliberately limited to this small fixture.
  const stored: Record<string, Record<string, unknown>[]> = {};
  for (const name of await tableNames(handle.client)) {
    if (name === 'gg_upgrade_state' || name === 'gg_upgrade_archive') continue;
    stored[name] = (await rows(handle.client, 'SELECT * FROM "' + name + '"')).sort((a, b) =>
      stableStringify(a) < stableStringify(b)
        ? -1
        : stableStringify(a) > stableStringify(b)
          ? 1
          : 0,
    );
  }
  expect((await inspectDatabaseUpgrade(handle.client)).sourceHash).toBe(
    createHash('sha256').update(stableStringify(stored)).digest('hex'),
  );
});

it('inventories 50 loops, 500 versions, 500 runs and 50,000 events and refuses unavailable format-4 conversion without writes', async () => {
  const small = await legacy();
  const originalDefinition = storedText(
    (await small.client.execute('SELECT definition FROM loop_versions')).rows[0]!.definition,
  );

  const expectedDefinition = (await small.client.execute('SELECT definition FROM loop_versions'))
    .rows[0]!.definition;
  const expectedDecision = (
    await small.client.execute('SELECT payload FROM run_events WHERE seq=2')
  ).rows[0]!.payload;
  const handle = await legacy();
  for (let index = 0; index < 50; index += 1) {
    const id = index === 0 ? FIXTURE_IDS.loop : fakeUlid('scale-loop-' + index);
    await handle.client.execute({
      sql: 'INSERT INTO loops(id,owner_id,name,created_at,updated_at) VALUES (?,?,?,?,?)',
      args: [id, 'hidden-owner', 'Scale', FIXTURE_TS, FIXTURE_TS],
    });
  }
  for (let index = 1; index < 500; index += 1) {
    const loopId = index % 50 === 0 ? FIXTURE_IDS.loop : fakeUlid('scale-loop-' + (index % 50));
    const versionId = fakeUlid('scale-version-' + index);
    await handle.client.execute({
      sql: "INSERT INTO loop_versions(id,loop_id,version,status,definition,created_at) VALUES (?,?,?,'published',?,?)",
      args: [versionId, loopId, Math.floor(index / 50) + 1, originalDefinition, FIXTURE_TS],
    });
    await new SqliteRunRepository(handle.db).create(
      {
        id: fakeUlid('scale-run-' + index),
        ownerId: 'hidden-owner',
        loopId,
        versionId,
        invocationId: fakeUlid('scale-invocation-' + index),
        status: 'succeeded',
        iteration: 1,
        createdAt: FIXTURE_TS,
        lastEventSeq: 100,
      },
      sampleThread(),
    );
  }
  await handle.client.execute({
    sql: `WITH RECURSIVE n(x) AS (SELECT 4 UNION ALL SELECT x+1 FROM n WHERE x<100)
    INSERT INTO run_events(run_id,seq,ts,type,node_id,payload)
    SELECT run_id,x,ts,type,node_id,payload FROM run_events CROSS JOIN n WHERE run_id=? AND seq=1`,
    args: [FIXTURE_IDS.run],
  });
  await handle.client.execute({
    sql: `INSERT INTO run_events(run_id,seq,ts,type,node_id,payload)
    SELECT runs.id,run_events.seq,run_events.ts,run_events.type,run_events.node_id,run_events.payload
    FROM runs CROSS JOIN run_events WHERE run_events.run_id=? AND runs.id<>?`,
    args: [FIXTURE_IDS.run, FIXTURE_IDS.run],
  });
  await handle.client.execute('UPDATE runs SET last_event_seq=100');
  const start = performance.now();
  const inventory = await inspectDatabaseUpgrade(handle.client);
  expect(inventory.tableCounts).toMatchObject({
    loops: 50,
    loop_versions: 500,
    runs: 500,
    run_events: 50_000,
  });
  expect(inventory.versions).toHaveLength(500);
  expect(inventory.failedRuns).toEqual([]);
  expect(inventory.blockedRuns).toEqual([]);
  expect(inventory.issues).toEqual([]);
  const approved: DatabaseUpgradeManifest = {
    format: 'graphgoblin-upgrade-manifest',
    targetVersion: CURRENT_DEFINITION_FORMAT,
    sourceHash: inventory.sourceHash,
    approvedBy: 'owner',
    approvedAt: FIXTURE_TS,
    failedRuns: {},
    versions: Object.fromEntries(
      inventory.versions.map((version) => [
        version.id,
        { definitionHash: version.definitionHash, resolutions: {} },
      ]),
    ),
  };
  await expect(applyDatabaseUpgrade(handle.client, approved)).rejects.toMatchObject({
    code: 'DATA_UPGRADE_REQUIRED',
  });
  expect((await inspectDatabaseUpgrade(handle.client)).sourceHash).toBe(inventory.sourceHash);
  expect(await rows(handle.client, 'SELECT DISTINCT definition FROM loop_versions')).toEqual([
    { definition: expectedDefinition },
  ]);
  expect(
    await rows(handle.client, "SELECT DISTINCT payload FROM run_events WHERE type='decision.made'"),
  ).toEqual([{ payload: expectedDecision }]);
  expect(await rows(handle.client, 'SELECT count(*) AS count FROM run_events')).toEqual([
    { count: 50_000 },
  ]);
  await expect(guardDatabaseUpgrade(handle.client)).rejects.toMatchObject({
    code: 'DATA_UPGRADE_REQUIRED',
  });
  console.error(
    'UPGRADE_SCALE ' +
      JSON.stringify({
        loops: 50,
        versions: 500,
        runs: 500,
        events: 50_000,
        elapsedMs: Math.round(performance.now() - start),
        peakRssMiB: Math.round((process.resourceUsage().maxRSS / 1024) * 10) / 10,
      }),
  );
}, 180_000);
it('preserves old canonical issue ordering for orphan runs, interleaved orphan events and pending receipts', async () => {
  const handle = await legacy();
  for (const [id, createdAt] of [
    ['z-run', '2000'],
    ['a-run', '2001'],
  ])
    await handle.client.execute({
      sql: 'INSERT INTO runs(id,owner_id,loop_id,version_id,invocation_id,status,iteration,created_at,last_event_seq,initial_thread) VALUES (?,?,?,?,?,?,?,?,?,?)',
      args: [id!, 'local', 'loop', 'missing-version', id!, 'succeeded', 1, createdAt!, 0, '{}'],
    });
  for (const [runId, seq, node] of [
    ['orphan-a', 1, 'a'],
    ['orphan-a', 2, 'c'],
    ['orphan-b', 1, 'b'],
  ] as const)
    await handle.client.execute({
      sql: 'INSERT INTO run_events(run_id,seq,ts,type,node_id,payload) VALUES (?,?,?,?,?,?)',
      args: [runId, seq, FIXTURE_TS, 'node.started', node, '{}'],
    });
  for (const [id, attempts] of [
    ['z-receipt', 0],
    ['a-receipt', 1],
  ] as const)
    await handle.client.execute({
      sql: "INSERT INTO webhook_receipts(id,owner_id,loop_id,trigger_node_id,content_hash,inbound_id,status,intent,attempts) VALUES (?,?,?,?,?,?,'pending','{}',?)",
      args: [id, 'local', 'loop', 'start', id, id, attempts],
    });
  const sort = (values: Record<string, unknown>[]) =>
    values
      .map((row) => ({ row, key: stableStringify(row) }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .map(({ row }) => row);
  const oldRuns = sort(await rows(handle.client, 'SELECT * FROM runs'))
    .filter((row) => row.version_id === 'missing-version')
    .map((row) => '/runs/' + String(row.id) + '/version_id');
  const oldEvents = sort(await rows(handle.client, 'SELECT * FROM run_events'))
    .filter((row) => String(row.run_id).startsWith('orphan-'))
    .map((row) => '/run_events/' + String(row.run_id));
  const oldReceipts = sort(await rows(handle.client, 'SELECT * FROM webhook_receipts')).map(
    (row) => '/webhook_receipts/' + String(row.id),
  );
  expect(oldEvents).toEqual([
    '/run_events/orphan-a',
    '/run_events/orphan-b',
    '/run_events/orphan-a',
  ]);
  expect((await inspectDatabaseUpgrade(handle.client)).issues.map((issue) => issue.path)).toEqual([
    ...oldRuns,
    ...oldEvents,
    ...oldReceipts,
  ]);
});
