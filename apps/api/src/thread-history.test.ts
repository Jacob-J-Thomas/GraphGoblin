import { buildApp } from './app.js';
import { createContainer } from './container.js';
import { loadConfig } from './config.js';
import { expect, it } from 'vitest';
import type { ContextThread, RunRecord } from '@graphgoblin/contracts';
import { createThreadHistoryFixture } from './testing/thread-history.js';

it('reconciles persisted failure, unfinished resume and success without writing on reads', async () => {
  const t = await createThreadHistoryFixture();
  try {
    const started = await t.app.inject({
      method: 'POST',
      url: '/loops/' + t.loopId + '/runs',
      payload: {},
    });
    const { run } = started.json<{ run: RunRecord }>();
    await t.manager.waitForIdle();
    const check = async (status: string, visits: number, complete: boolean) => {
      const before = await t.bytes(run.id);
      expect((await t.app.inject('/runs/' + run.id)).json<RunRecord>().status).toBe(status);
      const thread = (await t.app.inject('/runs/' + run.id + '/thread')).json<ContextThread>();
      expect(thread.vars).toEqual({ prepared: true, ...(complete ? { completed: true } : {}) });
      expect(thread.counters.nodeVisits.work).toBe(visits);
      expect(await t.bytes(run.id)).toBe(before);
      expect(await t.repos.runs.getThread(run.id)).not.toEqual(thread);
    };
    await check('failed', 1, false);
    expect(
      (await t.app.inject({ method: 'POST', url: '/runs/' + run.id + '/resume' })).statusCode,
    ).toBe(200);
    await t.working;
    await check('running', 2, false);
    t.release();
    await t.manager.waitForIdle();
    await check('succeeded', 2, true);
    await t.snapshots.flush();
    expect((await t.app.inject('/runs/' + run.id + '/thread')).json()).toEqual(
      await t.repos.runs.getThread(run.id),
    );
  } finally {
    await t.close();
  }
});

it('does not apply the resumed script patch when that attempt is cancelled', async () => {
  const t = await createThreadHistoryFixture();
  try {
    const response = await t.app.inject({
      method: 'POST',
      url: '/loops/' + t.loopId + '/runs',
      payload: {},
    });
    const { run } = response.json<{ run: RunRecord }>();
    await t.manager.waitForIdle();
    await t.app.inject({ method: 'POST', url: '/runs/' + run.id + '/resume' });
    await t.working;
    await t.app.inject({ method: 'POST', url: '/runs/' + run.id + '/cancel' });
    t.release();
    await t.manager.waitForIdle();
    const before = await t.bytes(run.id);
    expect((await t.app.inject('/runs/' + run.id)).json<RunRecord>().status).toBe('cancelled');
    const thread = (await t.app.inject('/runs/' + run.id + '/thread')).json<ContextThread>();
    expect(thread.vars).toEqual({ prepared: true });
    expect(thread.counters.nodeVisits.work).toBe(2);
    expect(await t.bytes(run.id)).toBe(before);
  } finally {
    await t.close();
  }
});

it('reopens the persisted failed history and reconciles reads without writing its stale snapshot', async () => {
  const t = await createThreadHistoryFixture();
  let runId: string;
  try {
    const response = await t.app.inject({
      method: 'POST',
      url: '/loops/' + t.loopId + '/runs',
      payload: {},
    });
    runId = response.json<{ run: RunRecord }>().run.id;
    await t.manager.waitForIdle();
  } finally {
    await t.close();
  }
  const reopened = await createContainer(
    loadConfig({
      GG_DATA_DIR: t.dataDir,
      GG_MASTER_KEY: Buffer.alloc(32, 9).toString('base64'),
      GG_SWAGGER_UI: 'false',
    }),
    { startTimers: false },
  );
  await reopened.start();
  const app = await buildApp(reopened, { logger: false });
  try {
    const before = await reopened.repos.runs.getThreadCheckpoint(runId);
    const thread = (await app.inject('/runs/' + runId + '/thread')).json<ContextThread>();
    expect(thread.vars).toEqual({ prepared: true });
    expect(thread.counters.nodeVisits.work).toBe(1);
    expect(await reopened.repos.runs.getThreadCheckpoint(runId)).toEqual(before);
    expect((await app.inject('/runs/' + runId)).json<RunRecord>().status).toBe('failed');
  } finally {
    await app.close();
    await reopened.stop();
  }
});
