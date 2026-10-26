import { RESOURCE_OWNERSHIP_REWIND_SQL } from './testing/resource-ownership.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { fileURLToPath } from 'node:url';
import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import type { RunRecord } from '@graphgoblin/contracts';
import {
  fakeUlid,
  FIXTURE_TS,
  minimalLoop,
  samplePin,
  sampleThread,
} from '@graphgoblin/contracts/testing';
import { FakeClock, FakeIds } from '@graphgoblin/engine/testing';
import { openMemoryDatabase, type DatabaseHandle } from './db.js';
import { SqliteEventStore } from './events.js';
import { SqliteLoopRepository } from './loops.js';
import { SqliteRunRepository } from './runs.js';
import { SqliteInboundEvents } from './triggers.js';

describe('SQLite history queries', () => {
  let handle: DatabaseHandle;
  beforeEach(async () => {
    handle = await openMemoryDatabase();
  });
  afterEach(() => handle.close());
  it('applies the history index to an existing current-format store and reruns idempotently', async () => {
    // Rewind migration 0021 together with the older ledger used by this historical fixture.
    for (const statement of RESOURCE_OWNERSHIP_REWIND_SQL) await handle.client.execute(statement);
    await handle.client.execute('DROP TRIGGER runs_deletion_activity');
    await handle.client.execute('DROP TRIGGER runs_deletion_dependency_insert');
    await handle.client.execute('DROP TRIGGER runs_deletion_revision');
    await handle.client.execute('DROP TRIGGER runs_deletion_relationship');
    await handle.client.execute('DROP TRIGGER runs_replay_source_update');
    await handle.client.execute('DROP INDEX runs_replay_source_idx');
    await handle.client.execute('ALTER TABLE runs DROP COLUMN replay_source_run_id');
    await handle.client.execute('DROP INDEX runs_deletion_approval_idx');
    await handle.client.execute('ALTER TABLE runs DROP COLUMN deletion_approval');
    await handle.client.execute('ALTER TABLE runs DROP COLUMN deletion_revision');
    await handle.client.execute('DROP INDEX runs_loop_owner_history_idx');
    await handle.client.execute('ALTER TABLE runs DROP COLUMN thread_snapshot_replay_state');
    const historyMigration = readMigrationFiles({
      migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
    }).find((migration) =>
      migration.sql.some((sql) => sql.includes('runs_loop_owner_history_idx')),
    );
    if (!historyMigration) throw new Error('Missing shipped history-index migration');
    // Rewind structure as well as the ledger before replaying newer migrations.
    await handle.client.execute('DROP TABLE event_receipts');
    const removed = await handle.client.execute({
      sql: 'DELETE FROM __drizzle_migrations WHERE created_at >= ?',
      args: [historyMigration.folderMillis],
    });
    expect(await handle.pendingMigrations()).toBe(removed.rowsAffected);
    await handle.migrate();
    expect(await handle.pendingMigrations()).toBe(0);
    await handle.migrate();
    const columns = await handle.client.execute("PRAGMA index_info('runs_loop_owner_history_idx')");
    expect(columns.rows.map((row) => row.name)).toEqual([
      'loop_id',
      'owner_id',
      'created_at',
      'id',
    ]);
  });
  it('summarizes each owner loop beyond 500 unrelated runs, with ties and no-history controls', async () => {
    const loops = new SqliteLoopRepository(handle.db, new FakeClock(), new FakeIds());
    const runs = new SqliteRunRepository(handle.db);
    const old = await loops.create('local', LoopDefinitionSchema.parse(minimalLoop()));
    const busy = await loops.create(
      'local',
      LoopDefinitionSchema.parse({ ...minimalLoop(), name: 'busy' }),
    );
    const empty = await loops.create(
      'local',
      LoopDefinitionSchema.parse({ ...minimalLoop(), name: 'empty' }),
    );
    await loops.create('other', LoopDefinitionSchema.parse(minimalLoop()));
    const seed = async (index: number, loopId: string, createdAt: string, ownerId = 'local') => {
      const run: RunRecord = {
        id: fakeUlid(`summary:${index}`),
        ownerId,
        loopId,
        versionId: old.draft.id,
        pinned: samplePin(),
        invocationId: fakeUlid(`summary-inv:${index}`),
        status: 'succeeded',
        iteration: 1,
        lastEventSeq: 0,
        createdAt,
      };
      await runs.create(run, sampleThread());
      return run;
    };
    const a = await seed(0, old.loop.id, '2026-10-01T00:00:00.000Z');
    const b = await seed(1, old.loop.id, a.createdAt);
    for (let i = 2; i < 503; i++) await seed(i, busy.loop.id, FIXTURE_TS);
    await seed(999, old.loop.id, FIXTURE_TS, 'other');
    const summary = await loops.listWithRunSummaries('local');
    const expected = [a, b].sort((x, y) => y.id.localeCompare(x.id))[0]!;
    expect(summary).toHaveLength(3);
    expect(summary.find((loop) => loop.id === old.loop.id)).toMatchObject({
      runCount: 2,
      latestRun: { id: expected.id, status: expected.status, createdAt: expected.createdAt },
    });
    expect(summary.find((loop) => loop.id === busy.loop.id)?.runCount).toBe(501);
    expect(summary.find((loop) => loop.id === empty.loop.id)).toMatchObject({
      runCount: 0,
      latestRun: null,
    });
    expect(await loops.listWithRunSummaries('missing')).toEqual([]);
    await runs.update(expected.id, { status: 'failed' });
    expect(
      (await loops.listWithRunSummaries('local')).find((loop) => loop.id === old.loop.id)?.latestRun
        ?.status,
    ).toBe('failed');
    // Only the selected latest row must be readable; an absent cached snapshot is valid.
    const older = expected.id === a.id ? b : a;
    await handle.client.execute({
      sql: "UPDATE runs SET initial_thread = '{}', thread_snapshot = '{}' WHERE id = ?",
      args: [older.id],
    });
    await runs.clearThreadSnapshot(expected.id);
    expect(
      (await loops.listWithRunSummaries('local')).find((loop) => loop.id === old.loop.id),
    ).toMatchObject({ runCount: 2, latestRun: { id: expected.id, status: 'failed' } });
  });
  it.each([
    ['status', 'damaged-status'],
    ['pinned', '{broken'],
    ['pinned', '{}'],
    ['pinned', null],
    ['waiting', '{broken'],
    ['failure', '{}'],
    ['result', '{broken'],
    ['iteration', -1],
    ['initial_thread', '{}'],
    ['thread_snapshot', '{}'],
    ['thread_snapshot', '{broken'],
  ])('isolates damaged latest %s without substituting an older run', async (column, value) => {
    const loops = new SqliteLoopRepository(handle.db, new FakeClock(), new FakeIds());
    const damaged = await loops.create('local', LoopDefinitionSchema.parse(minimalLoop()));
    const healthy = await loops.create('local', LoopDefinitionSchema.parse(minimalLoop()));
    const runs = new SqliteRunRepository(handle.db);
    const seed = async (tag: string, loopId: string, createdAt = FIXTURE_TS) => {
      const id = fakeUlid(tag);
      await runs.create(
        {
          id,
          ownerId: 'local',
          loopId,
          versionId: damaged.draft.id,
          pinned: samplePin(),
          invocationId: fakeUlid(`${tag}:inv`),
          status: 'succeeded',
          iteration: 1,
          lastEventSeq: 0,
          createdAt,
        },
        sampleThread(),
      );
      return id;
    };
    await seed('older-summary', damaged.loop.id, '2026-09-01T00:00:00.000Z');
    const badId = await seed('bad-summary', damaged.loop.id);
    const goodId = await seed('good-summary', healthy.loop.id);
    if (column === 'initial_thread' || column === 'thread_snapshot') {
      const events = new SqliteEventStore(handle.db, new FakeClock());
      await events.append(badId, [
        { type: 'run.finished', status: 'succeeded', outcome: 'success' },
      ]);
      await runs.update(badId, { status: 'running' });
      expect((await events.read(badId)).at(-1)).toMatchObject({
        type: 'run.finished',
        status: 'succeeded',
      });
    }
    await handle.client.execute({
      // Column names come only from the fixed cases above; all values stay bound.
      sql: `UPDATE runs SET ${column} = ? WHERE id = ?`,
      args: [value, badId],
    });
    const summaries = await loops.listWithRunSummaries('local');
    expect(summaries.find((loop) => loop.id === damaged.loop.id)).toMatchObject({
      runCount: 2,
      latestRun: null,
    });
    expect(summaries.find((loop) => loop.id === healthy.loop.id)).toMatchObject({
      runCount: 1,
      latestRun: { id: goodId, status: 'succeeded' },
    });
    const columns = await handle.client.execute("PRAGMA index_info('runs_loop_owner_history_idx')");
    expect(columns.rows.map((row) => row.name)).toEqual([
      'loop_id',
      'owner_id',
      'created_at',
      'id',
    ]);
  });
  it('pages inbound timestamp ties, applies every filter before the boundary, and detects exhaustion', async () => {
    const repo = new SqliteInboundEvents(handle.db);
    expect(await repo.page('local')).toEqual({ items: [], next: null });
    for (let i = 0; i < 503; i++)
      await repo.insert({
        id: fakeUlid(`event:${i}`),
        ownerId: i === 502 ? 'other' : 'local',
        type: i === 501 ? 'other' : 'chosen',
        payload: null,
        source: 'api',
        receivedAt: FIXTURE_TS,
        runIds: [],
      });
    const filters = { type: 'chosen', before: '2026-10-03T00:00:00.000Z' };
    const first = await repo.page('local', { ...filters, limit: 1000 });
    expect(first.items).toHaveLength(500);
    const last = await repo.page('local', { ...filters, limit: 1, cursor: first.next! });
    expect(last.items).toHaveLength(1);
    expect(last.next).toBeNull();
    expect(new Set([...first.items, ...last.items].map((event) => event.id)).size).toBe(501);
    const limitOne = await repo.page('local', { ...filters, limit: 0 });
    expect(limitOne.items).toHaveLength(1);
    expect(limitOne.next).not.toBeNull();
    expect((await repo.page('local', { before: FIXTURE_TS })).items).toEqual([]);
    expect(await repo.page('missing')).toEqual({ items: [], next: null });
  });

  it('refuses unreadable latest events despite a durable finish and a valid stale running record', async () => {
    const clock = new FakeClock();
    const loops = new SqliteLoopRepository(handle.db, clock, new FakeIds());
    const runs = new SqliteRunRepository(handle.db);
    const events = new SqliteEventStore(handle.db, clock);
    const loop = await loops.create('local', LoopDefinitionSchema.parse(minimalLoop()));
    for (const [tag, createdAt] of [
      ['older', '2026-09-01T00:00:00.000Z'],
      ['latest', FIXTURE_TS],
    ] as const) {
      await runs.create(
        {
          id: fakeUlid(tag),
          ownerId: 'local',
          loopId: loop.loop.id,
          versionId: loop.draft.id,
          invocationId: fakeUlid(`${tag}:inv`),
          pinned: samplePin(),
          status: 'running',
          iteration: 1,
          lastEventSeq: 0,
          createdAt,
        },
        sampleThread(),
      );
    }
    const id = fakeUlid('latest');
    await events.append(id, [{ type: 'run.finished', status: 'succeeded', outcome: 'success' }]);
    // More than one validation batch, with the damage in the middle of the second batch.
    await events.append(
      id,
      Array.from({ length: 205 }, () => ({ type: 'run.started' as const, attempt: 1 })),
    );
    await handle.client.execute({
      sql: "UPDATE run_events SET payload='{}', type='run.queued' WHERE run_id=? AND seq=103",
      args: [id],
    });
    expect(await runs.get(id)).toMatchObject({ status: 'running' });
    expect((await events.read(id, 0, 1))[0]).toMatchObject({ status: 'succeeded' });
    const read = vi.spyOn(SqliteEventStore.prototype, 'read');
    const reopened = new SqliteLoopRepository(handle.db, clock, new FakeIds());
    expect((await reopened.listWithRunSummaries('local'))[0]).toMatchObject({
      runCount: 2,
      latestRun: null,
    });
    expect(read).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenNthCalledWith(1, id, 0, 100);
    expect(read).toHaveBeenNthCalledWith(2, id, 100, 100);
    read.mockClear();
    expect((await reopened.listWithRunSummaries('local'))[0]?.latestRun).toBeNull();
    expect(read).not.toHaveBeenCalled();
    // An append changes the count and invalidates the cached failure; repair alone requires restart.
    await handle.client.execute({
      sql: "UPDATE run_events SET payload=?, type='run.started' WHERE run_id=? AND seq=103",
      args: [JSON.stringify({ attempt: 1 }), id],
    });
    await events.append(id, [{ type: 'run.started', attempt: 1 }]);
    read.mockClear();
    expect((await reopened.listWithRunSummaries('local'))[0]?.latestRun?.id).toBe(id);
    expect(read).toHaveBeenCalledTimes(3);
    read.mockClear();
    await reopened.listWithRunSummaries('local');
    expect(read).not.toHaveBeenCalled();
    read.mockRestore();
    // Damage on an older run cannot hide a healthy latest run.
    await events.append(fakeUlid('older'), [{ type: 'run.started', attempt: 1 }]);
    await handle.client.execute({
      sql: "UPDATE run_events SET payload='{broken' WHERE run_id=?",
      args: [fakeUlid('older')],
    });
    expect(
      (
        await new SqliteLoopRepository(handle.db, clock, new FakeIds()).listWithRunSummaries(
          'local',
        )
      )[0]?.latestRun?.id,
    ).toBe(id);
  });

  it('propagates event storage failures without caching them as unreadable history', async () => {
    const clock = new FakeClock();
    const loops = new SqliteLoopRepository(handle.db, clock, new FakeIds());
    const runs = new SqliteRunRepository(handle.db);
    const loop = await loops.create('local', LoopDefinitionSchema.parse(minimalLoop()));
    const id = fakeUlid('storage-error');
    await runs.create(
      {
        id,
        ownerId: 'local',
        loopId: loop.loop.id,
        versionId: loop.draft.id,
        invocationId: fakeUlid('storage-inv'),
        pinned: samplePin(),
        status: 'succeeded',
        iteration: 1,
        lastEventSeq: 0,
        createdAt: FIXTURE_TS,
      },
      sampleThread(),
    );
    await new SqliteEventStore(handle.db, clock).append(id, [{ type: 'run.started', attempt: 1 }]);
    const read = vi
      .spyOn(SqliteEventStore.prototype, 'read')
      .mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(loops.listWithRunSummaries('local')).rejects.toThrow('storage unavailable');
    expect((await loops.listWithRunSummaries('local'))[0]?.latestRun?.id).toBe(id);
    expect(read).toHaveBeenCalledTimes(2);
    read.mockRestore();
  });
});
