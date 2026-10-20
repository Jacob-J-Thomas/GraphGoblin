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
  it('isolates damaged latest-run metadata, retains its count, and identifies it through diagnostics', async () => {
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
    await t.container.handle.client.execute({
      sql: 'UPDATE runs SET status = ? WHERE id = ?',
      args: ['damaged-status', badId],
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
  });

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
