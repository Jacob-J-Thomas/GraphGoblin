import { afterEach, expect, it } from 'vitest';
import type { Effort, RunRecord } from '@graphgoblin/contracts';
import { FakeHarness, singleNodeLoop } from '@graphgoblin/engine/testing';
import { createTestApp, type TestApp } from './testing/test-app.js';

let app: TestApp;
afterEach(async () => {
  await app?.close();
});

// Manual admission checks the ready Claude capabilities once per start. Execution checks the
// catalog, whose Claude rows carry the adapter's capability table (packages/engine
// claude-effort.test.ts), so these cases narrow only the probed list.
async function setup(explicit: boolean, effort: Effort = 'high') {
  const harness = new FakeHarness([], 'claude');
  harness.preflightResult = {
    state: 'ready',
    ok: true,
    authenticated: true,
    problems: [],
    models: [{ model: 'claude-opus-5-5', efforts: ['low'] }],
  };
  app = await createTestApp({
    harnesses: { claude: harness },
    env: {
      GG_DEFAULTS: JSON.stringify({ byHarness: { claude: { model: 'claude-opus-5-5', effort } } }),
    },
  });
  const loopId = await app.publishLoop(
    singleNodeLoop('Capability effort', {
      id: 'work',
      kind: 'inference',
      label: 'Work',
      config: {
        harness: 'claude',
        ...(explicit ? { model: 'claude-opus-5-5', effort } : {}),
        harnessOptions: { sandbox: 'read-only', approval: 'never' },
        prompt: { template: 'q' },
      },
    }),
  );
  return { harness, loopId };
}

it.each([false, true])(
  'refuses capability-only unsupported high before manual admission (explicit=%s)',
  async (explicit) => {
    const { harness, loopId } = await setup(explicit);
    const response = await app.app.inject({
      method: 'POST',
      url: `/loops/${loopId}/runs`,
      payload: {},
    });
    await app.idle();
    expect({
      status: response.statusCode,
      requests: harness.started.map(({ model, effort }) => ({ model, effort })),
    }).toEqual({ status: 422, requests: [] });
    expect(response.json()).toMatchObject({
      errors: [
        expect.objectContaining({
          code: 'EFFORT_UNSUPPORTED',
          nodeId: 'work',
          path: 'config.effort',
        }),
      ],
    });
    expect((await app.app.inject(`/runs?loopId=${loopId}`)).json().items).toEqual([]);
  },
);

it('checks pinned child selections at manual admission', async () => {
  const { harness, loopId } = await setup(false);
  const parentId = await app.publishLoop(
    singleNodeLoop('Capability parent', {
      id: 'child',
      kind: 'subloop',
      label: 'Child',
      config: { loopRef: { loopId, version: 'latest' } },
    }),
  );
  const rejected = await app.app.inject({
    method: 'POST',
    url: `/loops/${parentId}/runs`,
    payload: {},
  });
  expect(rejected.statusCode, rejected.body).toBe(422);
  expect(rejected.json()).toMatchObject({
    errors: [expect.objectContaining({ code: 'EFFORT_UNSUPPORTED', loopId, nodeId: 'work' })],
  });
  expect(harness.started).toEqual([]);
});

it.each([false, true])(
  'runs a capability-supported low unchanged (explicit=%s)',
  async (explicit) => {
    const { harness, loopId } = await setup(explicit, 'low');
    const response = await app.app.inject({
      method: 'POST',
      url: `/loops/${loopId}/runs`,
      payload: {},
    });
    expect(response.statusCode, response.body).toBe(202);
    await app.idle();
    const { run } = response.json<{ run: RunRecord }>();
    expect(await app.container.repos.runs.get(run.id)).toMatchObject({ status: 'succeeded' });
    expect(harness.started).toMatchObject([{ model: 'claude-opus-5-5', effort: 'low' }]);
  },
);
