import { afterEach, describe, expect, it } from 'vitest';
import { TemplateSchema, WaitSpecSchema, type RunRecord } from '@graphgoblin/contracts';
import { singleNodeLoop } from '@graphgoblin/engine/testing';
import { createTestApp, type TestApp } from './testing/test-app.js';

const apps: TestApp[] = [];
afterEach(async () => {
  for (const t of apps.splice(0)) await t.close();
});

describe('user content in durable events', () => {
  it('rejects a non-slug signal name before generating an event', async () => {
    const t = await createTestApp();
    apps.push(t);
    const loopId = await t.publishLoop(
      singleNodeLoop('Signal validation', {
        id: 'work',
        kind: 'wait',
        label: 'Wait',
        config: { mode: 'input', prompt: 'hello' },
      }),
    );
    const started = await t.app.inject({
      method: 'POST',
      url: `/loops/${loopId}/runs`,
      payload: {},
    });
    await t.idle();
    const { run } = started.json<{ run: RunRecord }>();
    const before = await t.container.repos.events.read(run.id);
    const response = await t.app.inject({
      method: 'POST',
      url: `/runs/${run.id}/signals/bad%20name!`,
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await t.container.repos.events.read(run.id)).toEqual(before);
  });
  it('fails oversized rendered input readably, and rejects malformed API inputs', async () => {
    const t = await createTestApp();
    apps.push(t);
    const bound = WaitSpecSchema.shape.prompt.unwrap().maxLength!;
    const loopId = await t.publishLoop(
      singleNodeLoop('Rendered API input', {
        id: 'work',
        kind: 'wait',
        label: 'Wait',
        config: { mode: 'input', prompt: '{{ trigger.payload }}' },
      }),
    );
    for (const length of [bound, bound + 1]) {
      const response = await t.app.inject({
        method: 'POST',
        url: `/loops/${loopId}/runs`,
        payload: { input: 'x'.repeat(length) },
      });
      expect(response.statusCode).toBe(202);
      await t.idle();
      const { run } = response.json<{ run: RunRecord }>();
      const snapshot = await t.app.inject({ method: 'GET', url: `/runs/${run.id}` });
      expect(snapshot.statusCode).toBe(200);
      expect(snapshot.json<RunRecord>().status).toBe(length === bound ? 'waiting' : 'failed');
      if (length > bound)
        expect(snapshot.json<RunRecord>().failure).toMatchObject({
          code: 'EVENT_INVALID',
          resumable: false,
        });
      expect(
        (await t.app.inject({ method: 'GET', url: `/runs/${run.id}/events` })).statusCode,
      ).toBe(200);
    }
    const malformed = await t.app.inject({
      method: 'POST',
      url: `/loops/${loopId}/runs`,
      headers: { 'content-type': 'application/json' },
      payload: '{broken',
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toMatchObject({ code: 'MALFORMED_BODY' });
    const invalid = await t.app.inject({
      method: 'POST',
      url: '/loops',
      payload: {
        definition: singleNodeLoop('Invalid prompt', {
          id: 'work',
          kind: 'wait',
          label: 'Wait',
          config: { mode: 'input', prompt: 'x'.repeat(TemplateSchema.maxLength! + 1) },
        }),
      },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('damaged history diagnostics', () => {
  it('pages diagnostics across run and event bounds and rejects malformed cursors', async () => {
    const t = await createTestApp();
    apps.push(t);
    const loopId = await t.publishLoop(
      singleNodeLoop('Paged diagnostics', {
        id: 'work',
        kind: 'wait',
        label: 'Wait',
        config: { mode: 'input', prompt: 'hello' },
      }),
    );
    const runs: RunRecord[] = [];
    for (let n = 0; n < 21; n++)
      runs.push(
        await t.container.manager.startRun({ ownerId: 'local', loopId, source: 'manual.api' }),
      );
    await t.idle();
    runs.sort((a, b) => a.id.localeCompare(b.id));
    const first = runs[0]!;
    await t.container.repos.events.append(
      first.id,
      Array.from({ length: 100 }, () => ({ type: 'run.cancelled' as const })),
    );
    await t.container.handle.client.execute({
      sql: 'UPDATE run_events SET payload = ? WHERE run_id = ? AND seq = 101',
      args: ['{broken', first.id],
    });
    const request = async (cursor?: string) => {
      const response = await t.app.inject({
        method: 'GET',
        url: '/runs/diagnostics' + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''),
      });
      expect(response.statusCode).toBe(200);
      return response.json<{ items: { runId: string }[]; nextCursor: string | null }>();
    };
    const page1 = await request();
    expect(page1).toEqual({ items: [], nextCursor: `${first.id}:100` });
    const page2 = await request(page1.nextCursor!);
    expect(page2.items).toMatchObject([{ runId: first.id }]);
    expect(page2.nextCursor).toBe(`${runs[20]!.id}:0`);
    expect(await request(page2.nextCursor!)).toEqual({ items: [], nextCursor: null });
    for (const cursor of [
      'bad',
      `${first.id}:NaN`,
      `${first.id}:9007199254740992`,
      `${first.id}:0:extra`,
    ]) {
      expect(
        (
          await t.app.inject({
            method: 'GET',
            url: `/runs/diagnostics?cursor=${encodeURIComponent(cursor)}`,
          })
        ).statusCode,
      ).toBe(400);
    }
    const list = await t.container.repos.runs.page({ ownerId: 'local', limit: 1 });
    await t.container.handle.client.execute({
      sql: 'UPDATE runs SET waiting = ? WHERE id = ?',
      args: ['{broken', list.items[0]!.id],
    });
    const skipped = await t.container.repos.runs.page({ ownerId: 'local', limit: 1 });
    expect(skipped.items).toEqual([]);
    expect(skipped.next).toEqual(list.next);
  });
  it.each(['row', 'event'])(
    'lists healthy runs and deletes an unrelated loop beside damaged active %s history',
    async (damage) => {
      const t = await createTestApp();
      apps.push(t);
      const definition = singleNodeLoop('Damaged elsewhere', {
        id: 'work',
        kind: 'wait',
        label: 'Wait',
        config: { mode: 'input', prompt: 'hello' },
      });
      const loopId = await t.publishLoop(definition);
      const unrelated = await t.publishLoop({ ...definition, name: 'Unrelated' });
      const start = async () => {
        const response = await t.app.inject({
          method: 'POST',
          url: `/loops/${loopId}/runs`,
          payload: {},
        });
        await t.idle();
        return response.json<{ run: RunRecord }>().run;
      };
      const damaged = await start();
      const healthy = await start();
      await t.container.handle.client.execute({
        sql:
          damage === 'row'
            ? 'UPDATE runs SET waiting = ? WHERE id = ?'
            : 'UPDATE run_events SET payload = ? WHERE run_id = ? AND seq = 1',
        args: ['{broken', damaged.id],
      });
      const list = await t.app.inject({ method: 'GET', url: '/runs' });
      expect(list.statusCode).toBe(200);
      expect(
        list
          .json<{ items: RunRecord[] }>()
          .items.map((run) => run.id)
          .sort(),
      ).toEqual((damage === 'row' ? [healthy.id] : [healthy.id, damaged.id]).sort());
      expect(
        (await t.app.inject({ method: 'GET', url: '/runs/diagnostics' })).json(),
      ).toMatchObject({ items: [{ runId: damaged.id, code: 'HISTORY_UNREADABLE' }] });
      const deletion = await t.app.inject({ method: 'DELETE', url: `/loops/${unrelated}` });
      expect(deletion.statusCode).toBe(204);
      expect((await t.app.inject({ method: 'DELETE', url: `/loops/${loopId}` })).statusCode).toBe(
        409,
      );
    },
  );

  it('identifies event and row damage without changing it and scopes results to the owner', async () => {
    const t = await createTestApp();
    apps.push(t);
    const loopId = await t.publishLoop(
      singleNodeLoop('Diagnostics', {
        id: 'work',
        kind: 'wait',
        label: 'Wait',
        config: { mode: 'input', prompt: 'hello' },
      }),
    );
    const start = async () => {
      const response = await t.app.inject({
        method: 'POST',
        url: `/loops/${loopId}/runs`,
        payload: {},
      });
      await t.idle();
      return response.json<{ run: RunRecord }>().run;
    };
    const badEvent = await start();
    const badRow = await start();
    await t.container.handle.client.execute({
      sql: 'UPDATE run_events SET payload = ? WHERE run_id = ? AND seq = 1',
      args: ['{broken', badEvent.id],
    });
    await t.container.handle.client.execute({
      sql: 'UPDATE runs SET waiting = ? WHERE id = ?',
      args: ['{broken', badRow.id],
    });
    const response = await t.app.inject({ method: 'GET', url: '/runs/diagnostics' });
    expect(response.statusCode).toBe(200);
    expect(
      response.json<{ items: { runId: string; code: string; reason: string }[] }>().items,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ runId: badEvent.id, code: 'HISTORY_UNREADABLE' }),
        expect.objectContaining({ runId: badRow.id, code: 'HISTORY_UNREADABLE' }),
      ]),
    );
    expect((await t.app.inject({ method: 'GET', url: `/runs/${badRow.id}` })).json()).toMatchObject(
      { code: 'STORED_RUN_INVALID' },
    );
    const key = await t.container.repos.apiKeys.create('someone-else', 'Other owner', [
      'runs:read',
    ]);
    const other = await t.app.inject({
      method: 'GET',
      url: '/runs/diagnostics',
      headers: { authorization: `Bearer ${key.token}` },
    });
    expect(other.statusCode).toBe(200);
    expect(other.json()).toEqual({ items: [], nextCursor: null });
    await t.container.handle.client.execute({
      sql: 'UPDATE runs SET waiting = NULL WHERE id = ?',
      args: [badRow.id],
    });
    await t.container.handle.client.execute({
      sql: 'UPDATE run_events SET payload = ? WHERE run_id = ? AND seq = 1',
      args: ['{}', badEvent.id],
    });
    expect((await t.app.inject({ method: 'GET', url: '/runs/diagnostics' })).json()).toEqual({
      items: [],
      nextCursor: null,
    });
    await t.container.handle.client.execute('ALTER TABLE run_events RENAME TO broken_event_table');
    const brokenStore = await t.app.inject({ method: 'GET', url: '/runs/diagnostics' });
    expect(brokenStore.statusCode).toBe(500);
    expect(brokenStore.json()).toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});
