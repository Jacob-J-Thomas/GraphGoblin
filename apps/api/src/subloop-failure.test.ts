/**
 * A child failure seen through the REST API (#251): the parent fails visibly with the child's
 * code and resumability, names the child, and an explicit `POST /runs/{id}/resume` of the parent
 * resumes that child in place. A cancelled child cancels its parent.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { LoopDefinitionInput, RunEvent, RunRecord } from '@graphgoblin/contracts';
import { CURRENT_DEFINITION_FORMAT } from '@graphgoblin/contracts';
import { createTestApp, type TestApp } from './testing/test-app.js';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

function chain(name: string, work: LoopDefinitionInput['nodes'][number]): LoopDefinitionInput {
  return {
    schemaVersion: CURRENT_DEFINITION_FORMAT,
    name,
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      work,
      { id: 'done', kind: 'exit', label: 'Done', config: { returns: 'lastOutput.value' } },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: work.id } },
      { id: 'e2', from: { node: work.id, port: 'out' }, to: { node: 'done' } },
    ],
  };
}

async function start(app: TestApp, loopId: string): Promise<RunRecord> {
  const response = await app.app.inject({
    method: 'POST',
    url: `/loops/${loopId}/runs`,
    payload: {},
  });
  expect(response.statusCode).toBe(202);
  await app.idle();
  return (await app.app.inject(`/runs/${response.json<{ run: RunRecord }>().run.id}`)).json();
}

describe('subloop child failures over the API (#251)', () => {
  it('a provider failure in a child fails the parent visibly, and resuming the parent resumes the child', async () => {
    t = await createTestApp();
    t.harness.script([
      { error: { code: 'usage_limit_reached', message: 'quota exhausted', retriable: true } },
    ]);
    const childId = await t.publishLoop(
      chain('Inference child', {
        id: 'think',
        kind: 'inference',
        label: 'Think',
        config: { prompt: { template: 'go' } },
      }),
    );
    const parentId = await t.publishLoop(
      chain('Awaiting parent', {
        id: 'sub',
        kind: 'subloop',
        label: 'Sub',
        config: { loopRef: { loopId: childId } },
      }),
    );
    const parent = await start(t, parentId);
    const [child] = (await t.app.inject(`/runs?parent=${parent.id}`)).json<{ items: RunRecord[] }>()
      .items;
    expect(child).toMatchObject({
      status: 'failed',
      failure: { code: 'HARNESS_QUOTA_EXHAUSTED', resumable: true, nodeId: 'think' },
    });
    expect(parent).toMatchObject({
      status: 'failed',
      failure: {
        code: 'HARNESS_QUOTA_EXHAUSTED',
        resumable: true,
        nodeId: 'sub',
        details: { childRunId: child!.id, childNodeId: 'think' },
      },
    });

    t.harness.script([{ finalText: 'continued after quota' }]);
    const resumed = await t.app.inject({ method: 'POST', url: `/runs/${parent.id}/resume` });
    expect(resumed.statusCode).toBe(200);
    await t.idle();
    const done = (await t.app.inject(`/runs/${parent.id}`)).json<RunRecord>();
    expect(done).toMatchObject({ status: 'succeeded' });
    expect(done.result).toMatchObject({ status: 'succeeded', childRunId: child!.id });
    // The child continued its recorded harness session rather than starting the prompt again.
    expect(t.harness.resumed).toHaveLength(1);
    const childEvents = (await t.app.inject(`/runs/${child!.id}/events`)).json<{
      items: RunEvent[];
    }>().items;
    expect(childEvents.filter((event) => event.type === 'run.resumed')).toEqual([
      expect.objectContaining({ actor: { kind: 'run', id: parent.id } }),
    ]);
  });

  it('cancelling a child cancels the parent that awaits it', async () => {
    t = await createTestApp();
    const childId = await t.publishLoop(
      chain('Waiting child', {
        id: 'ask',
        kind: 'wait',
        label: 'Ask',
        config: { mode: 'input', prompt: '?' },
      }),
    );
    const parentId = await t.publishLoop(
      chain('Parent of a waiting child', {
        id: 'sub',
        kind: 'subloop',
        label: 'Sub',
        config: { loopRef: { loopId: childId } },
      }),
    );
    const parent = await start(t, parentId);
    expect(parent.status).toBe('waiting');
    const [child] = (await t.app.inject(`/runs?parent=${parent.id}`)).json<{ items: RunRecord[] }>()
      .items;
    expect(
      (await t.app.inject({ method: 'POST', url: `/runs/${child!.id}/cancel` })).statusCode,
    ).toBe(200);
    await t.idle();
    expect((await t.app.inject(`/runs/${parent.id}`)).json<RunRecord>().status).toBe('cancelled');
    const resume = await t.app.inject({ method: 'POST', url: `/runs/${parent.id}/resume` });
    expect(resume.statusCode).toBe(409);
  });
});
