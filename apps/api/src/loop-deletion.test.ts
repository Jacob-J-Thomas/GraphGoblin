import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeUlid, FIXTURE_TS, minimalLoop, sampleThread } from '@graphgoblin/contracts/testing';
import type { RunRecord } from '@graphgoblin/contracts';
import { createTestApp, type TestApp } from './testing/test-app.js';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.close();
});

async function start(loopId: string) {
  const response = await t.app.inject({
    method: 'POST',
    url: `/loops/${loopId}/runs`,
    payload: {},
  });
  expect(response.statusCode).toBe(202);
  await t.idle();
  return response.json<{ run: RunRecord }>().run;
}

async function snapshot() {
  const tables = await t.container.handle.client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  );
  return Promise.all(
    tables.rows.map(async (row) => {
      const name = row['name'] as string;
      return [
        name,
        (
          await t.container.handle.client.execute(
            'SELECT * FROM "' + name.replaceAll('"', '""') + '" ORDER BY rowid',
          )
        ).rows,
      ];
    }),
  );
}

describe('DELETE /loops/:id', () => {
  it('removes armed schedules and webhook endpoints and disarms polls only after commit', async () => {
    await t.app.inject({ method: 'PUT', url: '/secrets/hook-secret', payload: { value: 'shh' } });
    const definition = minimalLoop();
    definition.nodes.push(
      {
        id: 'cron',
        kind: 'trigger',
        label: 'Cron',
        config: { type: 'cron', expression: '0 * * * *' },
      },
      {
        id: 'hook',
        kind: 'trigger',
        label: 'Hook',
        config: {
          type: 'webhook',
          authentication: {
            type: 'hmac-sha256',
            message: 'timestamp-body',
            secretRef: 'hook-secret',
          },
        },
      },
      {
        id: 'poll',
        kind: 'trigger',
        label: 'Poll',
        config: {
          type: 'poll',
          intervalSeconds: 60,
          probe: { kind: 'http', url: 'https://example.test' },
          fireWhen: 'true',
          dedupeKey: 'probe.body',
        },
      },
    );
    for (const node of ['cron', 'hook', 'poll'])
      definition.edges.push({ id: node, from: { node, port: 'out' }, to: { node: 'done' } });
    const loopId = await t.publishLoop(definition);
    const armed = await t.container.triggers.listForLoop(loopId);
    expect(armed.schedules).toHaveLength(1);
    expect(armed.webhooks).toHaveLength(1);
    expect(armed.polls).toHaveLength(1);
    await t.container.handle.client.execute(
      "CREATE TRIGGER fail_delete BEFORE DELETE ON loops BEGIN SELECT RAISE(ABORT, 'injected failure'); END",
    );
    expect((await t.app.inject({ method: 'DELETE', url: `/loops/${loopId}` })).statusCode).toBe(
      500,
    );
    expect(await t.container.triggers.listForLoop(loopId)).toEqual(armed);
    await t.container.handle.client.execute('DROP TRIGGER fail_delete');
    expect((await t.app.inject({ method: 'DELETE', url: `/loops/${loopId}` })).statusCode).toBe(
      204,
    );
    expect(await t.container.triggers.listForLoop(loopId)).toEqual({
      schedules: [],
      webhooks: [],
      polls: [],
    });
  });

  it('deletes terminal run history and artifacts and returns 204, then 404', async () => {
    const loopId = await t.publishLoop(minimalLoop());
    const run = await start(loopId);
    expect((await t.container.repos.runs.get(run.id))?.status).toBe('succeeded');
    expect((await t.app.inject({ method: 'DELETE', url: `/loops/${loopId}` })).statusCode).toBe(
      204,
    );
    for (const path of [
      `/loops/${loopId}`,
      `/runs/${run.id}`,
      `/runs/${run.id}/events`,
      `/runs/${run.id}/thread`,
      `/runs/${run.id}/sessions`,
      `/runs/${run.id}/artifacts/any`,
    ]) {
      expect((await t.app.inject(path)).statusCode).toBe(404);
    }
    expect((await t.app.inject({ method: 'DELETE', url: `/loops/${loopId}` })).statusCode).toBe(
      404,
    );
    expect(await t.container.repos.runs.list({ loopId })).toEqual([]);
  });

  it.each(['queued', 'running', 'waiting', 'paused'] as const)(
    'returns a readable 409 for %s and changes nothing',
    async (status) => {
      const loopId = await t.publishLoop(minimalLoop());
      const loop = (await t.container.repos.loops.getLoop(loopId))!;
      await t.container.repos.runs.create(
        {
          id: fakeUlid(status),
          ownerId: 'local',
          loopId,
          versionId: loop.currentVersionId!,
          invocationId: fakeUlid('inv'),
          status,
          iteration: 1,
          createdAt: FIXTURE_TS,
          lastEventSeq: 0,
        },
        sampleThread(),
      );
      const before = await snapshot();
      const response = await t.app.inject({ method: 'DELETE', url: `/loops/${loopId}` });
      expect(response.statusCode).toBe(409);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(response.json()).toMatchObject({
        code: 'LOOP_IN_USE',
        detail: expect.stringContaining('cancel them first'),
      });
      expect(await snapshot()).toEqual(before);
    },
  );

  it('maps the transactional active-run refusal to 409 if a run appears after the route check', async () => {
    const loopId = await t.publishLoop(minimalLoop());
    const loops = t.container.repos.loops;
    const loop = (await loops.getLoop(loopId))!;
    const remove = loops.delete.bind(loops);
    vi.spyOn(loops, 'delete').mockImplementationOnce(async (id) => {
      await t.container.repos.runs.create(
        {
          id: fakeUlid('late-run'),
          ownerId: 'local',
          loopId,
          versionId: loop.currentVersionId!,
          invocationId: fakeUlid('inv'),
          status: 'queued',
          iteration: 1,
          createdAt: FIXTURE_TS,
          lastEventSeq: 0,
        },
        sampleThread(),
      );
      return remove(id);
    });
    const response = await t.app.inject({ method: 'DELETE', url: `/loops/${loopId}` });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: 'LOOP_IN_USE',
      detail: expect.stringContaining('cancel them first'),
    });
    expect(await loops.getLoop(loopId)).toBeDefined();
  });

  it('returns 500 and rolls back history on a mid-delete storage failure', async () => {
    const loopId = await t.publishLoop(minimalLoop());
    await start(loopId);
    await t.container.handle.client.execute(
      "CREATE TRIGGER fail_delete BEFORE DELETE ON loops BEGIN SELECT RAISE(ABORT, 'injected failure'); END",
    );
    const before = await snapshot();
    const disarm = vi.spyOn(t.container.polls, 'disarm');
    const response = await t.app.inject({ method: 'DELETE', url: `/loops/${loopId}` });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(await snapshot()).toEqual(before);
    expect(disarm).not.toHaveBeenCalled();
  });

  it('keeps a cross-loop parent and its published subloop reference after deleting the child', async () => {
    const childLoopId = await t.publishLoop(minimalLoop());
    const definition = minimalLoop();
    definition.nodes.push({
      id: 'sub',
      kind: 'subloop',
      label: 'Child',
      config: { loopRef: { loopId: childLoopId } },
    });
    definition.edges = [
      { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'sub' } },
      { id: 'b', from: { node: 'sub', port: 'out' }, to: { node: 'done' } },
    ];
    const parentLoopId = await t.publishLoop(definition);
    const parent = await start(parentLoopId);
    const [child] = await t.container.repos.runs.listChildren(parent.id);
    expect(child).toBeDefined();
    const history = await t.container.repos.events.read(parent.id);
    const thread = await t.container.repos.runs.getThread(parent.id);
    const published = await t.container.repos.loops.getLatestPublished(parentLoopId);
    expect(
      (await t.app.inject({ method: 'DELETE', url: `/loops/${childLoopId}` })).statusCode,
    ).toBe(204);
    expect((await t.app.inject(`/runs/${parent.id}`)).statusCode).toBe(200);
    expect((await t.app.inject(`/runs/${child!.id}`)).statusCode).toBe(404);
    expect(await t.container.repos.events.read(parent.id)).toEqual(history);
    expect(await t.container.repos.runs.getThread(parent.id)).toEqual(thread);
    expect(await t.container.repos.loops.getLatestPublished(parentLoopId)).toEqual(published);
    const later = await start(parentLoopId);
    expect((await t.container.repos.runs.get(later.id))?.failure?.code).toBe('SUBLOOP_NOT_FOUND');
  });
});
