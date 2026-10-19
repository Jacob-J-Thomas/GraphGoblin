import { afterEach, describe, expect, it } from 'vitest';
import { TemplateSchema, WaitSpecSchema, type RunRecord } from '@graphgoblin/contracts';
import { singleNodeLoop } from '@graphgoblin/engine/testing';
import { createTestApp, type TestApp } from './testing/test-app.js';

const apps: TestApp[] = [];
afterEach(async () => {
  for (const t of apps.splice(0)) await t.close();
});

describe('user content in durable events', () => {
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
      { code: 'INTERNAL_ERROR' },
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
    expect(other.json()).toEqual({ items: [] });
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
    });
    await t.container.handle.client.execute('ALTER TABLE run_events RENAME TO broken_event_table');
    const brokenStore = await t.app.inject({ method: 'GET', url: '/runs/diagnostics' });
    expect(brokenStore.statusCode).toBe(500);
    expect(brokenStore.json()).toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});
