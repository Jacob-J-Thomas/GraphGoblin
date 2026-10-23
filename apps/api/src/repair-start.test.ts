import { expect, it } from 'vitest';
import { CodexHarness, type CodexClientFactory } from '@graphgoblin/adapter-codex';
import type { RunEvent, RunRecord } from '@graphgoblin/contracts';
import type { HarnessPort, HarnessStartRequest } from '@graphgoblin/engine';
import { FakeHarness, singleNodeLoop } from '@graphgoblin/engine/testing';
import { createTestApp } from './testing/test-app.js';

async function refusedRepair(code: string) {
  let clients = 0;
  const calls: { sessionId?: string; request: HarnessStartRequest }[] = [];
  const clientFactory: CodexClientFactory = () => {
    clients += 1;
    if (clients === 2)
      throw Object.assign(new Error('Controlled synchronous repair refusal'), {
        code,
        // Even a false-positive retry flag must not make a pinned refusal resumable.
        retriable: true,
      });
    const text = clients === 1 ? 'invalid' : '42';
    const thread = (id = 'repair-thread') => ({
      runStreamed: () =>
        Promise.resolve({
          events: (async function* () {
            yield await Promise.resolve({ type: 'thread.started', thread_id: id });
            yield { type: 'turn.started' };
            yield {
              type: 'item.completed',
              item: { id: 'answer', type: 'agent_message', text },
            };
            yield { type: 'turn.completed', usage: {} };
          })(),
        }),
    });
    return { startThread: () => thread(), resumeThread: (id) => thread(id) };
  };
  const adapter = new CodexHarness({ clientFactory });
  const ready = new FakeHarness();
  const harness: HarnessPort = {
    id: 'codex',
    preflight: () => ready.preflight(),
    start(request, signal) {
      calls.push({ request });
      return adapter.start(request, signal);
    },
    resume(sessionId, request, signal) {
      calls.push({ sessionId, request });
      return adapter.resume(sessionId, request, signal);
    },
  };
  const test = await createTestApp({ harnesses: { codex: harness } });
  try {
    const loopId = await test.publishLoop(
      singleNodeLoop('synchronous repair start', {
        id: 'infer',
        kind: 'inference',
        label: 'Infer',
        config: {
          prompt: { template: 'Original task' },
          output: {
            schema: {
              jsonSchema: { type: 'number' },
              repair: { enabled: true, maxAttempts: 1, prompt: 'Repair exactly: {{ value }}' },
            },
          },
        },
      }),
    );
    const started = await test.app.inject({
      method: 'POST',
      url: `/loops/${loopId}/runs`,
      payload: {},
    });
    expect(started.statusCode).toBe(202);
    const runId = started.json<{ run: { id: string } }>().run.id;
    await test.idle();
    const failed = await test.app.inject({ method: 'GET', url: `/runs/${runId}` });
    return { test, runId, calls, failed: failed.json<RunRecord>() };
  } catch (error) {
    await test.close();
    throw error;
  }
}

it('resubmits the exact saved repair after a synchronous restorable refusal', async () => {
  const { test, runId, calls, failed } = await refusedRepair('HARNESS_NOT_AUTHENTICATED');
  try {
    const resumed = await test.app.inject({
      method: 'POST',
      url: `/runs/${runId}/resume`,
      payload: {},
    });
    await test.idle();
    expect(resumed.statusCode).toBe(200);
    expect(calls[2]?.request.turn.prompt).toBe('Repair exactly: "invalid"');
    expect(calls[2]?.request.turn.prompt).toBe(calls[1]?.request.turn.prompt);
    expect(calls[2]?.sessionId).toBe('repair-thread');
    expect(failed.failure).toMatchObject({
      code: 'HARNESS_NOT_AUTHENTICATED',
      resumable: true,
      inference: { submission: 'definitely-not-submitted', promptKind: 'repair' },
    });
    const history = await test.app.inject({ method: 'GET', url: `/runs/${runId}/events` });
    const repairs = history
      .json<{ items: RunEvent[] }>()
      .items.filter((event) => event.type === 'harness.turn')
      .filter((event) => event.promptKind === 'repair');
    expect(repairs).toHaveLength(2);
    expect(repairs[1]).toMatchObject({ visitId: repairs[0]?.visitId, turnId: repairs[0]?.turnId });
    const completed = await test.app.inject({ method: 'GET', url: `/runs/${runId}` });
    expect(completed.json<RunRecord>().status).toBe('succeeded');
  } finally {
    await test.close();
  }
});

it.each([
  'HARNESS_ARGUMENTS_REJECTED',
  'HARNESS_UNSUPPORTED_POLICY',
  'HARNESS_INVALID_CONFIGURATION',
])('refuses Resume without another call after synchronous repair %s', async (code) => {
  const { test, runId, calls, failed } = await refusedRepair(code);
  try {
    const resumed = await test.app.inject({
      method: 'POST',
      url: `/runs/${runId}/resume`,
      payload: {},
    });
    await test.idle();
    expect(resumed.statusCode).toBe(409);
    expect(calls).toHaveLength(2);
    expect(failed.failure).toMatchObject({
      code: 'HARNESS_TURN_FAILED',
      resumable: false,
      details: { adapterCode: code },
      inference: { submission: 'definitely-not-submitted', promptKind: 'repair' },
    });
  } finally {
    await test.close();
  }
});
