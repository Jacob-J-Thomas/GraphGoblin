/** Disposable historical fixture built exclusively from shipped SQL and frozen v3 contracts. */
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { V3LoopDefinitionSchema } from '@graphgoblin/contracts';
import { fakeUlid, FIXTURE_TS } from '@graphgoblin/contracts/testing';
import type { DatabaseHandle } from '../db.js';
import { SHIPPED_MIGRATIONS } from '../readiness.js';
export const fixtureId = fakeUlid;
export const fixtureTriggers = {
  manual: { subtype: 'manual' },
  cron: { subtype: 'cron', expression: '* * * * *', enabled: true, missedFirePolicy: 'run-each' },
  poll: {
    subtype: 'poll',
    intervalSeconds: 60,
    probe: { kind: 'none' },
    fireWhen: 'true',
    enabled: true,
  },
  event: { subtype: 'event', eventType: 'test' },
  timestamp: { subtype: 'webhook', signature: { scheme: 'hmac-sha256', secretRef: 'hook-secret' } },
  body: { subtype: 'webhook', signature: { scheme: 'hmac-sha256-body', secretRef: 'hook-secret' } },
};
export function frozenDefinition(name = 'manual', decision?: unknown) {
  return V3LoopDefinitionSchema.parse({
    schemaVersion: 3,
    name,
    nodes: [
      {
        id: 'start',
        kind: 'trigger',
        label: 'Start',
        config: fixtureTriggers[name as keyof typeof fixtureTriggers] ?? fixtureTriggers.manual,
      },
      ...(decision ? [{ id: 'decide', kind: 'decision', label: 'Decide', config: decision }] : []),
      { id: 'done', kind: 'exit', label: 'Done', config: {} },
    ],
    edges: decision
      ? [
          { id: 'start', from: { node: 'start', port: 'out' }, to: { node: 'decide' } },
          ...['yes', 'no'].map((port) => ({
            id: port,
            from: { node: 'decide', port },
            to: { node: 'done' },
          })),
        ]
      : [{ id: 'start', from: { node: 'start', port: 'out' }, to: { node: 'done' } }],
  });
}
export async function insertFixtureRow(
  handle: DatabaseHandle,
  table: string,
  row: Record<string, string | number | null>,
) {
  await handle.client.execute({
    sql: `INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row)
      .map(() => '?')
      .join(',')})`,
    args: Object.values(row),
  });
}
export async function seedFormatThreeStore(handle: DatabaseHandle) {
  const insert = (table: string, row: Record<string, string | number | null>) =>
    insertFixtureRow(handle, table, row);
  await handle.client.execute(
    'CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC)',
  );
  for (const migration of readMigrationFiles({ migrationsFolder: SHIPPED_MIGRATIONS }).slice(
    0,
    12,
  )) {
    for (const statement of migration.sql) await handle.client.execute(statement);
    await insert('__drizzle_migrations', {
      hash: migration.hash,
      created_at: migration.folderMillis,
    });
  }
  const answer = {
    type: 'choice',
    options: [
      { id: 'yes', label: 'Yes', criteria: 'Ready' },
      { id: 'no', label: 'No', criteria: 'Needs work' },
    ],
  };
  const definitions = [
    ...Object.keys(fixtureTriggers).map((name) => frozenDefinition(name)),
    frozenDefinition('expression', {
      answer,
      evaluation: { kind: 'expression', jsonata: '"yes"' },
    }),
    frozenDefinition('classifier', {
      answer,
      evaluation: { kind: 'classifier', model: 'jev', question: 'Ready?' },
    }),
  ];
  for (const definition of [...definitions, frozenDefinition('template')]) {
    const name = definition.name,
      loop = fixtureId(name),
      version = fixtureId(name + '-version'),
      draft = fixtureId(name + '-draft');
    await insert('loops', {
      id: loop,
      owner_id: 'local',
      name,
      current_version_id: version,
      draft_version_id: draft,
      created_at: FIXTURE_TS,
      updated_at: FIXTURE_TS,
    });
    for (const [id, status] of [
      [version, 'published'],
      [draft, 'draft'],
    ])
      await insert('loop_versions', {
        id: id!,
        loop_id: loop,
        version: status === 'published' ? 1 : 2,
        status: status!,
        definition: JSON.stringify(definition),
        created_at: FIXTURE_TS,
      });
    const run = fixtureId(name + '-run');
    await insert('runs', {
      id: run,
      owner_id: 'local',
      loop_id: loop,
      version_id: version,
      invocation_id: fixtureId(name + '-invocation'),
      status: name === 'template' ? 'running' : 'succeeded',
      iteration: 1,
      created_at: FIXTURE_TS,
      initial_thread: '{}',
      thread_snapshot: '{"historical":true}',
      thread_snapshot_seq: 1,
      finalized_at: null,
    });
    await insert('run_events', {
      run_id: run,
      seq: 1,
      ts: FIXTURE_TS,
      type: 'historical',
      payload: '{"subloopVersions":{"child":"pin"},"childNotification":"pending"}',
    });
    await insert('timers', { run_id: run, key: 'timer', at: FIXTURE_TS });
    await insert('harness_sessions', {
      run_id: run,
      node_id: 'work',
      attempt: 1,
      harness: 'codex',
      session_id: 'session',
      status: 'done',
      updated_at: FIXTURE_TS,
    });
    await insert('inbound_events', {
      id: name + '-inbound',
      owner_id: 'local',
      type: 'webhook',
      payload: '{}',
      source: 'test',
      received_at: FIXTURE_TS,
      run_ids: JSON.stringify([run]),
    });
    await insert('webhook_receipts', {
      id: name + '-receipt',
      owner_id: 'local',
      loop_id: loop,
      trigger_node_id: 'start',
      content_hash: name,
      inbound_id: name + '-inbound',
      status: name === 'template' ? 'pending' : 'admitted',
      intent: '{"frozen":"intent"}',
    });
    if (name === 'body' || name === 'timestamp')
      await insert('webhook_endpoints', {
        id: name + '-endpoint',
        owner_id: 'local',
        loop_id: loop,
        version_id: version,
        trigger_node_id: 'start',
        token: name + '-token',
        secret_ref: 'hook-secret',
        signature_header: 'X-Signature',
        signature_scheme: name === 'body' ? 'hmac-sha256-body' : 'hmac-sha256',
        replay_window_seconds: name === 'body' ? null : 300,
        enabled: 1,
        created_at: FIXTURE_TS,
      });
    if (name === 'cron')
      await insert('schedules', {
        id: 'cron-schedule',
        owner_id: 'local',
        loop_id: loop,
        version_id: version,
        trigger_node_id: 'start',
        expression: '* * * * *',
        timezone: 'UTC',
        missed_fire_policy: 'run-each',
        enabled: 1,
        next_fire_at: FIXTURE_TS,
        last_fired_at: FIXTURE_TS,
        created_at: FIXTURE_TS,
      });
  }
  await insert('template_instances', {
    id: 'instance',
    owner_id: 'local',
    instance: JSON.stringify({ loops: [{ loopId: fixtureId('template') }] }),
    binding: '{}',
  });
  await insert('settings', {
    owner_id: 'local',
    key: 'defaults',
    value: '{"byHarness":{"codex":{"model":"gpt-6-luna","effort":"low"}}}',
    updated_at: FIXTURE_TS,
  });
  await insert('secrets', {
    owner_id: 'local',
    name: 'hook-secret',
    ciphertext: 'fixture-ciphertext',
    created_at: FIXTURE_TS,
    updated_at: FIXTURE_TS,
  });
  await insert('api_keys', {
    id: 'key',
    owner_id: 'local',
    label: 'test',
    hash: 'fixture-key-hash',
    scopes: '["loops:read"]',
    created_at: FIXTURE_TS,
  });
}
