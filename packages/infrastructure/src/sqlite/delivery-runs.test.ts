import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { RunRecord, WebhookDelivery } from '@graphgoblin/contracts';
import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import { FIXTURE_TS, fakeUlid, samplePin, sampleThread } from '@graphgoblin/contracts/testing';
import { FakeClock } from '@graphgoblin/engine/testing';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema.js';
import { openMemoryDatabase, type DatabaseHandle } from './db.js';
import { SqliteDeliveryRunRepository } from './delivery-runs.js';
import { SqliteEventStore } from './events.js';

let handle: DatabaseHandle;
let repo: SqliteDeliveryRunRepository;
let events: SqliteEventStore;
const run: RunRecord = {
  id: fakeUlid('delivery'),
  ownerId: 'local',
  loopId: fakeUlid('loop'),
  versionId: fakeUlid('version'),
  pinned: samplePin(),
  invocationId: fakeUlid('inv'),
  status: 'succeeded',
  iteration: 1,
  createdAt: FIXTURE_TS,
  lastEventSeq: 0,
  parentRunId: fakeUlid('parent'),
};
const state: WebhookDelivery = {
  id: 'delivery-id',
  channel: { kind: 'webhook', url: 'https://example.test' },
  status: 'pending',
  attempts: 1,
  maxAttempts: 5,
  inFlight: true,
  acknowledgement: 'unknown',
  effectMayHaveHappened: true,
};
beforeEach(async () => {
  handle = await openMemoryDatabase();
  repo = new SqliteDeliveryRunRepository(handle.db);
  events = new SqliteEventStore(handle.db, new FakeClock());
  await repo.create(run, sampleThread());
});
afterEach(() => handle.close());

it('freezes the historical import budget in migration 0015', async () => {
  const migration = await readFile(
    new URL('../../drizzle/0015_webhook_delivery_journal.sql', import.meta.url),
    'utf8',
  );
  // #246 fixed the historical import budget at five; runtime policy changes must not rewrite it.
  expect(migration).toContain("'attempts', 1, 'maxAttempts', 5,");
});

it.each([
  ['return.delivered', '{"channel":{"kind":"webhook"}}'],
  ['return.failed', '{"channel":{"kind":"webhook","url":"https://example.test"}}'],
  ['return.failed', '{"channel":{"kind":"webhook","url":"https://example.test"},"error":42}'],
])('migration preserves shape-damaged %s receipts byte for byte (%s)', async (type, payload) => {
  await handle.client.execute({
    sql: 'INSERT INTO run_events (run_id,seq,ts,type,payload) VALUES (?,?,?,?,?)',
    args: [run.id, 1, FIXTURE_TS, type, payload],
  });
  const migration = await readFile(
    new URL('../../drizzle/0015_webhook_delivery_journal.sql', import.meta.url),
    'utf8',
  );
  for (const statement of migration.split('--> statement-breakpoint'))
    await handle.client.execute(statement);
  const result = await handle.client.execute({
    sql: 'SELECT type,payload FROM run_events WHERE run_id=?',
    args: [run.id],
  });
  expect(result.rows).toMatchObject([{ type, payload }]);
  expect((await repo.get(run.id))?.deliveries).toBeUndefined();
});

it('does not append a delivery journal for an absent run', async () => {
  const deletedId = fakeUlid('deleted run');
  expect(
    await events.append(deletedId, [{ type: 'delivery.attempted', delivery: state }], {
      requireRun: true,
    }),
  ).toEqual([]);
  expect(await events.read(deletedId)).toEqual([]);
});

it('projects a whole page in one indexed delivery query', async () => {
  for (let i = 1; i < 20; i++)
    await repo.create({ ...run, id: fakeUlid('page-' + i) }, sampleThread());
  await events.append(run.id, [{ type: 'delivery.attempted', delivery: state }]);
  const queries: string[] = [];
  const measured = new SqliteDeliveryRunRepository(
    drizzle(handle.client, {
      schema,
      logger: {
        logQuery(query) {
          queries.push(query);
        },
      },
    }),
  );
  const page = await measured.page({ ownerId: 'local', limit: 20 });
  expect(page.items).toHaveLength(20);
  expect(page.items.find((item) => item.id === run.id)?.deliveries).toEqual([state]);
  expect(page.items.filter((item) => item.deliveries === undefined)).toHaveLength(19);
  const projections = queries.filter((query) => query.includes('from "run_events"'));
  expect(projections).toHaveLength(1);
  expect(projections[0]).toContain('INDEXED BY run_events_delivery_idx');
  expect(projections[0]).toContain('"run_events"."type" in (?, ?, ?, ?)');
  const plan = await handle.client.execute({
    sql: "EXPLAIN QUERY PLAN SELECT seq FROM run_events INDEXED BY run_events_delivery_idx WHERE run_id=? AND type IN ('delivery.queued','delivery.attempted','delivery.attempt_finished','delivery.finished') ORDER BY seq",
    args: [run.id],
  });
  expect(
    plan.rows.some(
      (row) =>
        typeof row['detail'] === 'string' && row['detail'].includes('run_events_delivery_idx'),
    ),
  ).toBe(true);
  expect(await measured.listChildren('no-such-parent')).toEqual([]);
});

it('projects the same journal state through detail, lists, child reads and pages', async () => {
  expect(await repo.get('missing')).toBeUndefined();
  expect((await repo.get(run.id))?.deliveries).toBeUndefined();
  await events.append(run.id, [{ type: 'delivery.attempted', delivery: state }]);
  const final = {
    ...state,
    status: 'delivered' as const,
    inFlight: false,
    acknowledgement: 'accepted' as const,
  };
  await events.append(run.id, [{ type: 'delivery.finished', delivery: final }]);
  expect((await repo.get(run.id))?.deliveries).toEqual([final]);
  expect((await repo.list())[0]?.deliveries).toEqual([final]);
  expect((await repo.page({ ownerId: 'local' })).items[0]?.deliveries).toEqual([final]);
  expect((await repo.listChildren(run.parentRunId!))[0]?.deliveries).toEqual([final]);
});

it.each(['{broken', '{}', 'null'])(
  'diagnoses damaged delivery journal data (%s)',
  async (payload) => {
    await events.append(run.id, [{ type: 'delivery.attempted', delivery: state }]);
    await handle.client.execute({
      sql: 'UPDATE run_events SET payload = ? WHERE run_id = ?',
      args: [payload, run.id],
    });
    await expect(repo.get(run.id)).rejects.toMatchObject({
      code: 'HISTORY_UNREADABLE',
      runId: run.id,
    });
    await repo.create({ ...run, id: fakeUlid('healthy delivery') }, sampleThread());
    expect((await repo.page({ ownerId: 'local' })).items.map((item) => item.id)).toEqual([
      fakeUlid('healthy delivery'),
    ]);
    expect((await repo.list()).map((item) => item.id)).toEqual([fakeUlid('healthy delivery')]);
  },
);

it('one-off migration converts historical webhook outcomes without retrying or changing other sinks', async () => {
  // Historical rows deliberately bypass the current writer, which rejects the old shape.
  const rows = [
    { type: 'return.delivered', payload: { channel: state.channel, target: state.channel.url } },
    { type: 'return.failed', payload: { channel: state.channel, error: 'old failure' } },
    { type: 'return.delivered', payload: { channel: { kind: 'caller' } } },
  ];
  for (const [index, row] of rows.entries())
    await handle.client.execute({
      sql: 'INSERT INTO run_events (run_id, seq, ts, type, payload) VALUES (?, ?, ?, ?, ?)',
      args: [run.id, index + 1, FIXTURE_TS, row.type, JSON.stringify(row.payload)],
    });
  const migration = await readFile(
    new URL('../../drizzle/0015_webhook_delivery_journal.sql', import.meta.url),
    'utf8',
  );
  for (const statement of migration.split('--> statement-breakpoint'))
    await handle.client.execute(statement);
  const migrated = await events.read(run.id);
  expect(migrated).toMatchObject([
    {
      type: 'delivery.finished',
      delivery: { status: 'delivered', attempts: 1, maxAttempts: 1, acknowledgement: 'accepted' },
    },
    {
      type: 'delivery.finished',
      delivery: {
        status: 'failed',
        acknowledgement: 'unknown',
        lastError: { code: 'historical_failure', message: 'old failure' },
      },
    },
    { type: 'return.delivered', channel: { kind: 'caller' } },
  ]);
  for (const statement of migration.split('--> statement-breakpoint'))
    await handle.client.execute(statement);
  expect(await events.read(run.id)).toEqual(migrated);
});

it.each(['succeeded', 'running', 'resumed'] as const)(
  'one-off migration queues only the current unfinished return, including invocation defaults (%s)',
  async (status) => {
    await repo.update(run.id, { status: status === 'resumed' ? 'running' : status });
    const definition = LoopDefinitionSchema.parse({
      schemaVersion: 4,
      name: 'Old pending return',
      nodes: [
        { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
        {
          id: 'done',
          kind: 'exit',
          label: 'Done',
          config: { returns: '42', destinations: [state.channel] },
        },
      ],
      edges: [{ id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'done' } }],
    });
    await handle.client.execute({
      sql: 'INSERT INTO loop_versions (id, loop_id, version, status, definition, created_at) VALUES (?, ?, 1, ?, ?, ?)',
      args: [run.versionId, run.loopId, 'published', JSON.stringify(definition), FIXTURE_TS],
    });
    const thread = sampleThread();
    thread.invocation.returnDefaults = [
      state.channel,
      { kind: 'webhook', url: 'https://default.test' },
    ];
    await handle.client.execute({
      sql: 'UPDATE runs SET initial_thread = ? WHERE id = ?',
      args: [JSON.stringify(thread), run.id],
    });
    await events.append(run.id, [
      { type: 'exit.evaluated', nodeId: 'done', outcome: 'success' },
      { type: 'run.finished', status: 'succeeded', outcome: 'success', result: { value: 42 } },
    ]);
    if (status === 'resumed')
      await events.append(run.id, [
        { type: 'run.resumed', actor: { kind: 'system', id: 'fixture' } },
        { type: 'run.started', attempt: 2 },
      ]);
    const migration = await readFile(
      new URL('../../drizzle/0015_webhook_delivery_journal.sql', import.meta.url),
      'utf8',
    );
    for (const statement of migration.split('--> statement-breakpoint'))
      await handle.client.execute(statement);
    const migrated = await events.read(run.id);
    if (status === 'resumed') {
      expect(migrated).toHaveLength(4);
      expect((await repo.get(run.id))?.deliveries).toBeUndefined();
      return;
    }
    expect(migrated.filter((event) => event.type === 'delivery.attempt_finished')).toHaveLength(2);
    expect((await repo.get(run.id))?.deliveries).toMatchObject([
      { status: 'pending', attempts: 1, acknowledgement: 'unknown' },
      { status: 'pending', attempts: 1, acknowledgement: 'unknown' },
    ]);
    expect((await repo.get(run.id))?.lastEventSeq).toBe(4);
    for (const statement of migration.split('--> statement-breakpoint'))
      await handle.client.execute(statement);
    expect(await events.read(run.id)).toEqual(migrated);
  },
);
