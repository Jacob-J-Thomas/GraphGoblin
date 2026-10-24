import { expect, it } from 'vitest';
import { createTestApp } from './testing/test-app.js';

it('B2 refuses an Event before consuming its dedupe key during drain', async () => {
  const t = await createTestApp();
  try {
    await t.app.inject({ method: 'POST', url: '/system/shutdown', payload: { action: 'drain' } });
    const response = await t.app.inject({
      method: 'POST',
      url: '/events',
      payload: { type: 'shutdown-test', payload: { value: 1 }, dedupeKey: 'retry-after-restart' },
    });
    expect(response.statusCode, response.body).toBe(503);
    expect(response.json()).toMatchObject({ code: 'SHUTTING_DOWN' });
    expect((await t.app.inject('/events')).json()).toMatchObject({ items: [] });
  } finally {
    await t.close();
  }
});

import type { LoopDefinitionInput } from '@graphgoblin/contracts';
function trigger(
  name: string,
  config: Extract<LoopDefinitionInput['nodes'][number], { kind: 'trigger' }>['config'],
): LoopDefinitionInput {
  return {
    schemaVersion: 4,
    name,
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config },
      { id: 'done', kind: 'exit', label: 'Done', config: {} },
    ],
    edges: [{ id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'done' } }],
  };
}

it('refuses manual and webhook HTTP admission and preserves due cron slots and poll dedupe', async () => {
  const t = await createTestApp();
  try {
    const manual = await t.publishLoop(trigger('manual', { type: 'manual' }));
    const hook = await t.publishLoop(
      trigger('webhook', { type: 'webhook', authentication: { type: 'none' } }),
    );
    const cron = await t.publishLoop(
      trigger('cron', { type: 'cron', expression: '* * * * *', timezone: 'UTC' }),
    );
    const poll = await t.publishLoop(
      trigger('poll', {
        type: 'poll',
        intervalSeconds: 5,
        probe: { kind: 'none' },
        fireWhen: 'true',
        dedupeKey: '"poll-key"',
      }),
    );
    const schedule = (await t.app.inject(`/loops/${cron}/triggers`)).json<{
      schedules: unknown[];
    }>().schedules;
    const path = (await t.app.inject(`/loops/${hook}/triggers`)).json<{
      webhooks: { path: string }[];
    }>().webhooks[0]!.path;
    await t.app.inject({ method: 'POST', url: '/system/shutdown', payload: { action: 'drain' } });
    const refused = await t.app.inject({
      method: 'POST',
      url: `/loops/${manual}/runs`,
      payload: {},
    });
    expect(refused.statusCode).toBe(503);
    expect(refused.json()).toMatchObject({ code: 'SHUTTING_DOWN' });
    const webhook = await t.app.inject({ method: 'POST', url: path, payload: {} });
    expect(webhook.statusCode).toBe(503);
    expect(webhook.json()).toMatchObject({ code: 'WEBHOOK_ADMISSION_FAILED' });
    t.clock.advance(60_000);
    expect(await t.container.cron.poll()).toBe(0);
    expect((await t.app.inject(`/loops/${cron}/triggers`)).json()).toMatchObject({
      schedules: schedule,
    });
    expect(await t.container.polls.poll()).toEqual([]);
    expect(await t.container.repos.runs.hasTriggerDedupe(poll, 'start', 'poll-key')).toBe(false);
    for (const id of [manual, hook, cron, poll])
      expect((await t.app.inject(`/runs?loopId=${id}`)).json()).toMatchObject({ items: [] });
    expect((await t.app.inject('/events')).json()).toMatchObject({ items: [] });
  } finally {
    await t.close();
  }
});

it('rejects force after a drain observation failure with 409 and the current phase', async () => {
  const t = await createTestApp();
  try {
    const id = await t.publishLoop({
      schemaVersion: 4,
      name: 'Park before storage failure',
      nodes: [
        { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
        { id: 'wait', kind: 'wait', label: 'Wait', config: { mode: 'input', prompt: 'Answer' } },
        { id: 'done', kind: 'exit', label: 'Done', config: {} },
      ],
      edges: [
        { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'wait' } },
        { id: 'b', from: { node: 'wait', port: 'out' }, to: { node: 'done' } },
      ],
    });
    await t.app.inject({ method: 'POST', url: `/loops/${id}/runs`, payload: {} });
    await t.idle();
    await t.container.handle.client.execute('DROP TABLE run_events');
    await t.app.inject({ method: 'POST', url: '/system/shutdown', payload: { action: 'drain' } });
    const response = await t.app.inject({
      method: 'POST',
      url: '/system/shutdown',
      payload: { action: 'force' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ phase: 'drain-failed' });
  } finally {
    await t.close();
  }
});
