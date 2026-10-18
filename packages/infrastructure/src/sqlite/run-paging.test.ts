import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunRecord } from '@graphgoblin/contracts';
import { FIXTURE_TS, fakeUlid, sampleThread } from '@graphgoblin/contracts/testing';
import { openMemoryDatabase, type DatabaseHandle } from './db.js';
import { SqliteRunRepository } from './runs.js';

describe('SqliteRunRepository ordinary paging', () => {
  let handle: DatabaseHandle;
  let repo: SqliteRunRepository;
  beforeEach(async () => {
    handle = await openMemoryDatabase();
    repo = new SqliteRunRepository(handle.db);
  });
  afterEach(() => handle.close());

  async function seed(index: number, overrides: Partial<RunRecord> = {}) {
    const run: RunRecord = {
      id: fakeUlid('page:' + index),
      ownerId: 'local',
      loopId: fakeUlid('loop'),
      versionId: fakeUlid('version'),
      invocationId: fakeUlid('inv:' + index),
      status: 'succeeded',
      iteration: 1,
      lastEventSeq: 0,
      createdAt: FIXTURE_TS,
      ...overrides,
    };
    await repo.create(run, sampleThread());
    return run;
  }

  it('matches an unpaged SQL query across tuple pages with timestamp ties and a concurrent insertion', async () => {
    expect(await repo.page({ ownerId: 'local' })).toEqual({ items: [], next: null });
    for (let i = 0; i < 13; i++)
      await seed(i, { createdAt: i < 6 ? FIXTURE_TS : '2026-10-01T12:00:00.000Z' });
    await seed(100, { ownerId: 'other' });
    const all = await handle.client.execute(
      "SELECT id FROM runs WHERE owner_id = 'local' ORDER BY created_at DESC, id DESC",
    );
    const first = await repo.page({ ownerId: 'local', limit: 3 });
    await seed(101, { createdAt: '2026-10-03T12:00:00.000Z' });
    const seen = [...first.items];
    let cursor = first.next;
    while (cursor) {
      const page = await repo.page({ ownerId: 'local', cursor, limit: 3 });
      seen.push(...page.items);
      cursor = page.next;
    }
    expect(seen.map((r) => r.id)).toEqual(all.rows.map((r) => r['id']));
    expect(new Set(seen.map((r) => r.id)).size).toBe(13);
    expect(await repo.page({ ownerId: '' })).toEqual({ items: [], next: null });
  });

  it('applies owner, loop, statuses, parent and timestamp filters before the cursor boundary', async () => {
    const parent = await seed(0, { createdAt: '2026-10-01T12:00:00.000Z' });
    const child = await seed(1, { status: 'failed', parentRunId: parent.id });
    await seed(2, { ownerId: 'other', status: 'failed', parentRunId: parent.id });
    await seed(3, { loopId: fakeUlid('other-loop'), status: 'failed', parentRunId: parent.id });
    expect(
      (
        await repo.page({
          ownerId: 'local',
          loopId: parent.loopId,
          status: ['failed', 'cancelled'],
          parentRunId: parent.id,
        })
      ).items,
    ).toEqual([child]);
    expect((await repo.page({ ownerId: 'local', parentRunId: null })).items).toEqual([parent]);
    expect((await repo.page({ ownerId: 'local', before: FIXTURE_TS })).items).toEqual([parent]);
    expect(
      (await repo.page({ ownerId: 'local', loopId: parent.loopId, cursor: child })).items,
    ).toEqual([parent]);
    expect((await repo.page({ ownerId: 'local', status: [] })).items).toHaveLength(3);
  });

  it.each([0, -1, -100])('clamps an internal page limit of %s to one item', async (limit) => {
    await seed(0);
    await seed(1);
    const expected = await repo.page({ ownerId: 'local', limit: 1 });
    const first = await repo.page({ ownerId: 'local', limit });
    expect(first).toEqual(expected);
    expect(first.items).toHaveLength(1);
    expect(first.next).not.toBeNull();
    const last = await repo.page({ ownerId: 'local', limit, cursor: first.next! });
    expect(last.items).toHaveLength(1);
    expect(last.items[0]?.id).not.toBe(first.items[0]?.id);
    expect(last.next).toBeNull();
  });

  it('permits a 501-row lookahead while list remains capped at 500', async () => {
    for (let i = 0; i < 502; i++) await seed(i);
    expect(await repo.list({ ownerId: 'local', limit: 501 })).toHaveLength(500);
    expect((await repo.page({ ownerId: 'local' })).items).toHaveLength(100);
    const page = await repo.page({ ownerId: 'local', limit: 1000 });
    expect(page.items).toHaveLength(500);
    expect(page.next).not.toBeNull();
    const final = await repo.page({ ownerId: 'local', cursor: page.next!, limit: 500 });
    expect(final.items).toHaveLength(2);
    expect(final.next).toBeNull();
    expect(new Set([...page.items, ...final.items].map((r) => r.id)).size).toBe(502);
  });
});
