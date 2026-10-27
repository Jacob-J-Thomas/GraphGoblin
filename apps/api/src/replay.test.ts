import { CURRENT_DEFINITION_FORMAT } from '@graphgoblin/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  ContextThread,
  LoopDefinitionInput,
  RunEvent,
  RunRecord,
} from '@graphgoblin/contracts';
import { fakeUlid } from '@graphgoblin/contracts/testing';
import { createTestApp, type TestApp } from './testing/test-app.js';

let t: TestApp;

beforeEach(async () => {
  t = await createTestApp();
});

afterEach(async () => {
  await t.close();
});

/** start -> prep (sets vars.prepared from the input) -> ask (input) -> done. */
function askLoop(): LoopDefinitionInput {
  return {
    schemaVersion: CURRENT_DEFINITION_FORMAT,
    name: 'ask',
    nodes: [
      { id: 'start', kind: 'trigger', label: 'S', config: { type: 'manual' } },
      {
        id: 'prep',
        kind: 'mutate',
        label: 'P',
        config: {
          operations: [
            {
              op: 'set',
              path: '/vars/prepared',
              value: { kind: 'expression', jsonata: 'invocation.trigger.payload.topic' },
            },
          ],
        },
      },
      { id: 'ask', kind: 'wait', label: 'A', config: { mode: 'input', prompt: 'ok?' } },
      {
        id: 'done',
        kind: 'exit',
        label: 'D',
        config: {
          returns: '{ "prepared": vars.prepared, "answer": lastOutput.value }',
        },
      },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'prep' } },
      { id: 'e2', from: { node: 'prep', port: 'out' }, to: { node: 'ask' } },
      { id: 'e3', from: { node: 'ask', port: 'out' }, to: { node: 'done' } },
    ],
  };
}

async function finishedRun(): Promise<RunRecord> {
  const loopId = await t.publishLoop(askLoop());
  const { run } = (
    await t.app.inject({
      method: 'POST',
      url: `/loops/${loopId}/runs`,
      payload: { input: { topic: 'loops' } },
    })
  ).json<{ run: RunRecord }>();
  await t.idle();
  await t.app.inject({
    method: 'POST',
    url: `/runs/${run.id}/input`,
    payload: {
      waitId: (await t.container.manager.getRun(run.id))?.waiting?.waitId ?? 'unknown',
      input: 'yes',
    },
  });
  await t.idle();
  const finished = (await t.app.inject(`/runs/${run.id}`)).json<RunRecord>();
  expect(finished.result).toEqual({ prepared: 'loops', answer: 'yes' });
  return finished;
}

describe('POST /runs/{id}/replay', () => {
  it('exposes the executable seed through replay events and the queued thread route without changing source bytes', async () => {
    const source = await finishedRun();
    const sourceBytes = async () =>
      JSON.stringify({
        // Read the raw stored columns too: retain the serialized event payload and snapshot bytes.
        record: (
          await t.container.handle.client.execute({
            sql: 'SELECT * FROM runs WHERE id = ?',
            args: [source.id],
          })
        ).rows,
        events: (
          await t.container.handle.client.execute({
            sql: 'SELECT * FROM run_events WHERE run_id = ? ORDER BY seq',
            args: [source.id],
          })
        ).rows,
      });
    const before = await sourceBytes();
    t.container.manager.stop();
    const response = await t.app.inject({
      method: 'POST',
      url: `/runs/${source.id}/replay`,
      payload: {
        nodeId: 'ask',
        observedSeq: (await t.container.manager.getRecovery(source.id)).observedSeq,
      },
    });
    expect(response.statusCode).toBe(202);
    const { run: fork } = response.json<{ run: RunRecord }>();
    try {
      expect((await t.app.inject(`/runs/${fork.id}`)).json<RunRecord>().status).toBe('queued');
      const responseThread = await t.app.inject(`/runs/${fork.id}/thread`);
      expect(responseThread.statusCode).toBe(200);
      const seed = responseThread.json<ContextThread>();
      expect(seed.counters.nodeVisits).toEqual({ start: 1, prep: 1 });
      expect(seed.vars).toEqual({ prepared: 'loops' });
      const { items } = (await t.app.inject(`/runs/${fork.id}/events`)).json<{
        items: RunEvent[];
      }>();
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ type: 'run.queued', initialThread: seed });
    } finally {
      await t.container.manager.start();
      await t.idle();
    }
    await t.idle();
    const waiting = (await t.app.inject(`/runs/${fork.id}`)).json<RunRecord>();
    expect(waiting.status).toBe('waiting');
    await t.app.inject({
      method: 'POST',
      url: `/runs/${fork.id}/input`,
      payload: { waitId: waiting.waiting?.waitId, input: 'fork answer' },
    });
    await t.idle();
    expect(
      (await t.app.inject(`/runs/${fork.id}/thread`)).json<ContextThread>().counters.nodeVisits,
    ).toEqual({ start: 1, prep: 1, ask: 2, done: 1 });
    expect(await sourceBytes()).toBe(before);
  });

  it('forks a finished run at a node and runs it from there', async () => {
    const source = await finishedRun();
    const response = await t.app.inject({
      method: 'POST',
      url: `/runs/${source.id}/replay`,
      payload: {
        nodeId: 'ask',
        observedSeq: (await t.container.manager.getRecovery(source.id)).observedSeq,
      },
      headers: { 'x-graphgoblin-client': 'mcp' },
    });
    expect(response.statusCode).toBe(202);
    const { run: fork } = response.json<{ run: RunRecord }>();
    expect(fork.id).not.toBe(source.id);
    expect(fork).toMatchObject({ versionId: source.versionId, currentNodeId: 'ask' });
    await t.idle();

    const waiting = (await t.app.inject(`/runs/${fork.id}`)).json<RunRecord>();
    expect(waiting.status).toBe('waiting');
    const thread = (await t.app.inject(`/runs/${fork.id}/thread`)).json<ContextThread>();
    expect(thread.vars).toEqual({ prepared: 'loops' });
    expect(thread.invocation).toMatchObject({
      source: 'manual.mcp',
      trigger: { payload: { topic: 'loops' } },
      replayOf: { runId: source.id, nodeId: 'ask' },
    });
    const events = (await t.app.inject(`/runs/${fork.id}/events`)).json<{ items: RunEvent[] }>();
    expect(events.items[0]).toMatchObject({
      type: 'run.queued',
      replayOf: { runId: source.id, nodeId: 'ask' },
    });
    expect(events.items.filter((e) => e.type === 'node.started')).toHaveLength(1);

    await t.app.inject({
      method: 'POST',
      url: `/runs/${fork.id}/input`,
      payload: {
        waitId: (await t.container.manager.getRun(fork.id))?.waiting?.waitId ?? 'unknown',
        input: 'no',
      },
    });
    await t.idle();
    const done = (await t.app.inject(`/runs/${fork.id}`)).json<RunRecord>();
    expect(done.status).toBe('succeeded');
    expect(done.result).toEqual({ prepared: 'loops', answer: 'no' });
    const source2 = (await t.app.inject(`/runs/${source.id}`)).json<RunRecord>();
    expect(source2.result).toEqual({ prepared: 'loops', answer: 'yes' });
  });

  it('answers 409 for a node the run never reached, 404 for unknown runs, 400 for bad bodies', async () => {
    const loopId = await t.publishLoop(askLoop());
    const { run } = (
      await t.app.inject({ method: 'POST', url: `/loops/${loopId}/runs`, payload: {} })
    ).json<{ run: RunRecord }>();
    await t.idle();
    const notReached = await t.app.inject({
      method: 'POST',
      url: `/runs/${run.id}/replay`,
      payload: {
        nodeId: 'done',
        observedSeq: (await t.container.manager.getRecovery(run.id)).observedSeq,
      },
    });
    expect(notReached.statusCode).toBe(409);
    expect(notReached.json()).toMatchObject({ code: 'REPLAY_NODE_NOT_REACHED' });

    const unknown = await t.app.inject({
      method: 'POST',
      url: `/runs/${fakeUlid('nope')}/replay`,
      payload: { nodeId: 'ask', observedSeq: 0 },
    });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toMatchObject({ code: 'RUN_NOT_FOUND' });

    const bad = await t.app.inject({
      method: 'POST',
      url: `/runs/${run.id}/replay`,
      payload: {},
    });
    expect(bad.statusCode).toBe(400);
  });

  it('requires the runs:write scope', async () => {
    const source = await finishedRun();
    const { token } = (
      await t.app.inject({
        method: 'POST',
        url: '/api-keys',
        payload: { label: 'reader', scopes: ['runs:read'] },
      })
    ).json<{ token: string }>();
    const forbidden = await t.app.inject({
      method: 'POST',
      url: `/runs/${source.id}/replay`,
      payload: {
        nodeId: 'ask',
        observedSeq: (await t.container.manager.getRecovery(source.id)).observedSeq,
      },
      headers: { authorization: `Bearer ${token}` },
    });
    expect(forbidden.statusCode).toBe(403);
  });
});
