import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunRecord } from '@graphgoblin/contracts';
import {
  FIXTURE_TS,
  fakeUlid,
  minimalLoop,
  samplePin,
  sampleThread,
} from '@graphgoblin/contracts/testing';
import { createTestApp, type TestApp } from '../testing/test-app.js';

describe('loop-specific run summaries over real SQLite', () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(async () => t.close());
  it('does not publish a stale running badge when the latest event log is unreadable', async () => {
    const loopId = await t.publishLoop(minimalLoop());
    const prior = (
      await t.app.inject({ method: 'POST', url: `/loops/${loopId}/runs`, payload: {} })
    ).json<{ run: RunRecord }>().run.id;
    await t.idle();
    t.clock.advance(1);
    const id = (
      await t.app.inject({ method: 'POST', url: `/loops/${loopId}/runs`, payload: {} })
    ).json<{ run: RunRecord }>().run.id;
    await t.idle();
    const original = await t.app.inject(`/runs/${id}/events`);
    expect(original.json<{ items: unknown[] }>().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'run.finished', status: 'succeeded' }),
      ]),
    );
    await t.container.repos.runs.update(id, { status: 'running' });
    await t.container.handle.client.execute({
      sql: "UPDATE run_events SET payload='{}' WHERE run_id=? AND seq=1",
      args: [id],
    });
    expect((await t.app.inject(`/runs/${id}`)).statusCode).toBe(200);
    expect((await t.app.inject(`/runs/${id}/thread`)).statusCode).toBe(200);
    const response = await t.app.inject('/loops');
    expect(response.statusCode).toBe(200);
    expect(response.json<{ items: unknown[] }>().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: loopId, latestRun: null, runCount: 2 }),
      ]),
    );
    expect((await t.app.inject(`/runs/${id}/events`)).json()).toMatchObject({
      status: 500,
      code: 'STORED_EVENT_INVALID',
    });
    expect((await t.app.inject('/runs/diagnostics')).json()).toMatchObject({
      items: [expect.objectContaining({ runId: id, code: 'HISTORY_UNREADABLE' })],
    });
    expect(prior).not.toBe(id);
  });
  it.each([
    ['status', 'damaged-status'],
    ['pinned', '{broken'],
    ['pinned', '{}'],
    ['waiting', '{broken'],
    ['result', '{broken'],
    ['initial_thread', '{}'],
    ['thread_snapshot', '{}'],
    ['thread_snapshot', '{broken'],
  ])(
    'isolates damaged latest-run %s and identifies it through diagnostics',
    async (column, value) => {
      const damaged = await t.publishLoop({ ...minimalLoop(), name: 'damaged' });
      const healthy = await t.publishLoop({ ...minimalLoop(), name: 'healthy' });
      const badRun = await t.app.inject({
        method: 'POST',
        url: `/loops/${damaged}/runs`,
        payload: {},
      });
      const goodRun = await t.app.inject({
        method: 'POST',
        url: `/loops/${healthy}/runs`,
        payload: {},
      });
      const badId = badRun.json<{ run: RunRecord }>().run.id;
      const goodId = goodRun.json<{ run: RunRecord }>().run.id;
      await t.idle();
      if (column === 'initial_thread' || column === 'thread_snapshot') {
        const events = await t.app.inject(`/runs/${badId}/events`);
        expect(events.json<{ items: unknown[] }>().items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ type: 'run.finished', status: 'succeeded' }),
          ]),
        );
        await t.container.repos.runs.update(badId, { status: 'running' });
      }
      await t.container.handle.client.execute({
        sql: `UPDATE runs SET ${column} = ? WHERE id = ?`,
        args: [value, badId],
      });
      const response = await t.app.inject('/loops');
      expect(response.statusCode, response.body).toBe(200);
      const { items } = response.json<{
        items: { id: string; latestRun: { id: string } | null; runCount: number }[];
      }>();
      expect(items.find((loop) => loop.id === damaged)).toMatchObject({
        runCount: 1,
        latestRun: null,
      });
      expect(items.find((loop) => loop.id === healthy)?.latestRun?.id).toBe(goodId);
      expect((await t.app.inject('/runs/diagnostics')).json()).toMatchObject({
        items: [{ runId: badId, code: 'HISTORY_UNREADABLE' }],
      });
    },
  );

  it('finds older history beyond 500 unrelated runs, orders ties, and distinguishes no history', async () => {
    const old = await t.container.repos.loops.create(
      'local',
      LoopDefinitionSchema.parse(minimalLoop()),
    );
    const busy = await t.container.repos.loops.create(
      'local',
      LoopDefinitionSchema.parse({ ...minimalLoop(), name: 'busy' }),
    );
    const empty = await t.container.repos.loops.create(
      'local',
      LoopDefinitionSchema.parse({ ...minimalLoop(), name: 'empty' }),
    );
    const seed = async (i: number, loopId: string, createdAt = FIXTURE_TS) => {
      const run: RunRecord = {
        id: fakeUlid(`summary:${i}`),
        ownerId: 'local',
        loopId,
        versionId: old.draft.id,
        pinned: samplePin(),
        invocationId: fakeUlid(`summary-inv:${i}`),
        status: 'succeeded',
        iteration: 1,
        lastEventSeq: 0,
        createdAt,
      };
      await t.container.repos.runs.create(run, sampleThread());
      return run;
    };
    const a = await seed(0, old.loop.id, '2026-10-01T00:00:00.000Z');
    const b = await seed(1, old.loop.id, a.createdAt);
    for (let i = 2; i < 503; i++) await seed(i, busy.loop.id);
    const global = (await t.app.inject('/runs?limit=500')).json<{ items: RunRecord[] }>();
    expect(global.items).toHaveLength(500);
    expect(global.items.some((run) => run.loopId === old.loop.id)).toBe(false);
    const expected = [a, b].sort((x, y) => y.id.localeCompare(x.id))[0]!;
    const response = await t.app.inject('/loops');
    expect(response.statusCode).toBe(200);
    const { items } = response.json<{
      items: { id: string; latestRun: unknown; runCount: number }[];
    }>();
    expect(items.find((loop) => loop.id === old.loop.id)).toMatchObject({
      latestRun: { id: expected.id, status: 'succeeded', createdAt: expected.createdAt },
      runCount: 2,
    });
    expect(items.find((loop) => loop.id === busy.loop.id)?.runCount).toBe(501);
    expect(items.find((loop) => loop.id === empty.loop.id)).toMatchObject({
      latestRun: null,
      runCount: 0,
    });
  });
});
