import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { afterEach, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from './testing/test-app.js';

let api: TestApp | undefined;
afterEach(async () => {
  vi.useRealTimers();
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

it('keeps input, status and cancellation reachable while refusing independent starts during drain', async () => {
  api = await createTestApp();
  const id = await api.publishLoop(waitingLoop);
  const started = await api.app.inject({ method: 'POST', url: `/loops/${id}/runs`, payload: {} });
  const run = started.json<{ run: { id: string } }>().run;
  await api.idle();
  const work = await api.publishLoop({
    ...waitingLoop,
    name: 'Holding executor',
    nodes: waitingLoop.nodes.map((node) =>
      node.id === 'wait'
        ? {
            id: 'wait',
            kind: 'inference',
            label: 'Hold',
            config: { harness: 'codex', prompt: { template: 'Hold' } },
          }
        : node,
    ),
  });
  api.harness.script([{ delayMs: 60_000, finalText: 'finished' }]);
  const holding = await api.app.inject({ method: 'POST', url: `/loops/${work}/runs`, payload: {} });
  const activeId = holding.json<{ run: { id: string } }>().run.id;
  await vi.waitFor(() => expect(api!.harness.started).toHaveLength(1));
  const stopped = await api.app.inject({
    method: 'POST',
    url: '/system/shutdown',
    payload: { action: 'drain' },
  });
  expect(stopped.statusCode).toBe(202);
  expect(stopped.json<{ activeRunIds: string[] }>().activeRunIds).toHaveLength(1);
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
  expect(
    (await api.app.inject({ method: 'POST', url: `/runs/${activeId}/cancel`, payload: {} }))
      .statusCode,
  ).toBe(200);
  await vi.waitFor(async () =>
    expect((await api!.app.inject(`/runs/${activeId}`)).json()).toMatchObject({
      status: 'cancelled',
    }),
  );
  await api.container.waitForShutdown();
});

it('offers a choice, waits without a hidden timer, then forces the executor while preserving input parks', async () => {
  api = await createTestApp({ env: { GG_SHUTDOWN_GRACE_MS: '25' } });
  const id = await api.publishLoop(waitingLoop);
  const started = await api.app.inject({ method: 'POST', url: `/loops/${id}/runs`, payload: {} });
  const run = started.json<{ run: { id: string } }>().run;
  await api.idle();
  const before = (await api.app.inject(`/runs/${run.id}`)).json();
  const work = await api.publishLoop({
    ...waitingLoop,
    name: 'Holding executor',
    nodes: waitingLoop.nodes.map((node) =>
      node.id === 'wait'
        ? {
            id: 'wait',
            kind: 'inference',
            label: 'Hold',
            config: { harness: 'codex', prompt: { template: 'Hold' } },
          }
        : node,
    ),
  });
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  api.harness.script([{ delayMs: 60_000, finalText: 'finished' }]);
  const active = (
    await api.app.inject({ method: 'POST', url: `/loops/${work}/runs`, payload: {} })
  ).json<{ run: { id: string } }>().run;
  await vi.waitFor(() => expect(api!.harness.started).toHaveLength(1));
  const stopped = await api.app.inject({
    method: 'POST',
    url: '/system/shutdown',
    payload: { action: 'drain' },
  });
  expect(stopped.statusCode).toBe(202);
  expect(stopped.json()).toMatchObject({ activeRunIds: [active.id] });
  await vi.advanceTimersByTimeAsync(25);
  expect((await api.app.inject('/system/shutdown')).json()).toMatchObject({
    phase: 'awaiting-choice',
    choices: ['wait', 'force'],
  });
  expect(
    (await api.app.inject({ method: 'POST', url: '/system/shutdown', payload: { action: 'wait' } }))
      .statusCode,
  ).toBe(202);
  await vi.advanceTimersByTimeAsync(75);
  expect((await api.app.inject(`/runs/${active.id}`)).json()).toMatchObject({ status: 'running' });
  expect((await api.app.inject('/system/shutdown')).json()).toMatchObject({ phase: 'draining' });
  expect(
    (
      await api.app.inject({
        method: 'POST',
        url: '/system/shutdown',
        payload: { action: 'force' },
      })
    ).statusCode,
  ).toBe(202);
  await vi.waitFor(() => expect(api!.container.shutdown.state().phase).toBe('ready'));
  expect((await api.app.inject(`/runs/${active.id}`)).json()).toMatchObject({
    status: 'failed',
    failure: { code: 'RUN_INTERRUPTED_BY_STOP', nodeId: 'wait', details: { attempt: 1 } },
  });
  const after = (await api.app.inject(`/runs/${run.id}`)).json();
  expect(after.recovery.resume).toMatchObject({ allowed: false, code: 'SHUTTING_DOWN' });
  expect(after.recovery.replayDefault).toMatchObject({
    allowed: false,
    code: 'SHUTTING_DOWN',
  });
  // The parked execution is unchanged; current recovery admission reflects the drain.
  expect({ ...after, recovery: before.recovery }).toEqual(before);
});

it('rejects wait without a drain with the current phase', async () => {
  api = await createTestApp();
  const response = await api.app.inject({
    method: 'POST',
    url: '/system/shutdown',
    payload: { action: 'wait' },
  });
  expect(response.statusCode).toBe(409);
  expect(response.json()).toMatchObject({ phase: 'running' });
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
