import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { afterEach, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from './testing/test-app.js';

let api: TestApp | undefined;
afterEach(async () => {
  await api?.close();
});

const waitingLoop: LoopDefinitionInput = {
  schemaVersion: 4 as const,
  name: 'Drain input',
  nodes: [
    { id: 'start', kind: 'trigger' as const, label: 'Start', config: { type: 'manual' as const } },
    {
      id: 'wait',
      kind: 'wait' as const,
      label: 'Input',
      config: { mode: 'input' as const, prompt: 'Answer' },
    },
    { id: 'done', kind: 'exit' as const, label: 'Done', config: {} },
  ],
  edges: [
    { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'wait' } },
    { id: 'b', from: { node: 'wait', port: 'out' }, to: { node: 'done' } },
  ],
};

it('keeps input and status reachable while refusing independent starts during drain', async () => {
  api = await createTestApp();
  const id = await api.publishLoop(waitingLoop);
  const started = await api.app.inject({ method: 'POST', url: `/loops/${id}/runs`, payload: {} });
  const run = started.json<{ run: { id: string } }>().run;
  await api.idle();
  const stopped = await api.app.inject({
    method: 'POST',
    url: '/system/shutdown',
    payload: { action: 'drain' },
  });
  expect(stopped.statusCode).toBe(202);
  expect((await api.app.inject('/system/shutdown')).json()).toMatchObject({ phase: 'draining' });
  const refused = await api.app.inject({ method: 'POST', url: `/loops/${id}/runs`, payload: {} });
  expect(refused.statusCode).toBe(503);
  expect(refused.json()).toMatchObject({ code: 'SHUTTING_DOWN' });
  const detail = await api.app.inject(`/runs/${run.id}`);
  const waitId = detail.json<{ waiting: { waitId: string } }>().waiting.waitId;
  expect(
    (
      await api.app.inject({
        method: 'POST',
        url: `/runs/${run.id}/input`,
        payload: { waitId, input: 'answer' },
      })
    ).statusCode,
  ).toBe(200);
  await vi.waitFor(async () =>
    expect((await api!.app.inject(`/runs/${run.id}`)).json()).toMatchObject({
      status: 'succeeded',
    }),
  );
});

it('offers a choice after grace, waits without a kill timer, and explicitly forces a parked run', async () => {
  api = await createTestApp({ env: { GG_SHUTDOWN_GRACE_MS: '25' } });
  const id = await api.publishLoop(waitingLoop);
  const started = await api.app.inject({ method: 'POST', url: `/loops/${id}/runs`, payload: {} });
  const run = started.json<{ run: { id: string } }>().run;
  await api.idle();
  expect(
    (
      await api.app.inject({
        method: 'POST',
        url: '/system/shutdown',
        payload: { action: 'drain' },
      })
    ).statusCode,
  ).toBe(202);
  await vi.waitFor(async () =>
    expect((await api!.app.inject('/system/shutdown')).json()).toMatchObject({
      phase: 'awaiting-choice',
      choices: ['wait', 'force'],
    }),
  );
  expect(
    (await api.app.inject({ method: 'POST', url: '/system/shutdown', payload: { action: 'wait' } }))
      .statusCode,
  ).toBe(202);
  await new Promise((resolve) => setTimeout(resolve, 75));
  expect((await api.app.inject(`/runs/${run.id}`)).json()).toMatchObject({ status: 'waiting' });
  expect(
    (
      await api.app.inject({
        method: 'POST',
        url: '/system/shutdown',
        payload: { action: 'force' },
      })
    ).statusCode,
  ).toBe(202);
  await vi.waitFor(async () =>
    expect((await api!.app.inject(`/runs/${run.id}`)).json()).toMatchObject({
      status: 'failed',
      failure: { code: 'RUN_INTERRUPTED_BY_STOP', nodeId: 'wait', details: { attempt: 1 } },
    }),
  );
});

it('requires authentication for shutdown observation and force control', async () => {
  api = await createTestApp({ requireApiKey: true });
  expect((await api.app.inject('/system/shutdown')).statusCode).toBe(401);
  expect(
    (
      await api.app.inject({
        method: 'POST',
        url: '/system/shutdown',
        payload: { action: 'force' },
      })
    ).statusCode,
  ).toBe(401);
  expect(api.container.shutdown.state().phase).toBe('running');
});
