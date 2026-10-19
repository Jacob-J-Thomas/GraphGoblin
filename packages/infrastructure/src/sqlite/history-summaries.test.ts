import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import type { RunRecord } from '@graphgoblin/contracts';
import { fakeUlid, FIXTURE_TS, minimalLoop, sampleThread } from '@graphgoblin/contracts/testing';
import { FakeClock, FakeIds } from '@graphgoblin/engine/testing';
import { openMemoryDatabase, type DatabaseHandle } from './db.js';
import { SqliteLoopRepository } from './loops.js';
import { SqliteRunRepository } from './runs.js';
import { SqliteInboundEvents } from './triggers.js';

describe('SQLite history queries', () => {
  let handle: DatabaseHandle;
  beforeEach(async () => {
    handle = await openMemoryDatabase();
  });
  afterEach(() => handle.close());
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
});
