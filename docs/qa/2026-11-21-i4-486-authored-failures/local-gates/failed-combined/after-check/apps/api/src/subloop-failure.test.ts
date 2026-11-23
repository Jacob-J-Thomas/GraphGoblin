/**
 * A child failure seen through the REST API (#251): the parent fails visibly with the child's
 * code and resumability, names the child, and an explicit `POST /runs/{id}/resume` of the parent
 * resumes that child in place. A cancelled child cancels its parent.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { LoopDefinitionInput, RunEvent, RunRecord, RunRecovery } from '@graphgoblin/contracts';
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
  it.each(['input', 'output'] as const)(
    '#486 parent-authored %s mapping failure owns its location and refuses Resume',
    async (stage) => {
      t = await createTestApp();
      const childId = await t.publishLoop(
        chain('Successful child', {
          id: 'work',
          kind: 'mutate',
          label: 'Work',
          config: {
            operations: [
              {
                op: 'set',
                path: '/vars/value',
                value: { kind: 'literal', value: 'actual-child-value' },
              },
            ],
          },
        }),
      );
      const parentId = await t.publishLoop(
        chain('Mapping parent', {
          id: 'sub',
          kind: 'subloop',
          label: 'Sub',
          config: {
            loopRef: { loopId: childId },
            ...(stage === 'input'
              ? { input: { vars: { first: '1', privateName: '$error("private-map-486")' } } }
              : {
                  output: {
                    mode: 'merge',
                    vars: {
                      strategy: 'explicit',
                      map: { first: '1', privateName: '$error("private-map-486")' },
                    },
                  },
                }),
          },
        }),
      );
      const parent = await start(t, parentId);
      const cause =
        'The expression could not evaluate this input. Check its input type and mapping.';
      expect(parent.failure).toEqual({
        code: 'EXPRESSION_ERROR',
        nodeId: 'sub',
        resumable: false,
        message: `Subloop ${stage} variable mapping 2 failed. ${cause}`,
        details: {
          boundary: `subloop.${stage}.vars`,
          mapIndex: 1,
          cause: { code: 'EXPRESSION_ERROR', message: cause },
        },
      });
      const row = await t.container.ports.runs.get(parent.id);
      expect(row?.failure).toEqual(parent.failure);
      const events = (await t.app.inject(`/runs/${parent.id}/events`)).json<{ items: RunEvent[] }>()
        .items;
      const failure = events.filter((event) => event.type === 'run.failed');
      expect(failure).toMatchObject([{ failure: parent.failure }]);
      const children = (await t.app.inject(`/runs?parent=${parent.id}`)).json<{
        items: RunRecord[];
      }>().items;
      const finishes = events.filter((event) => event.type === 'child_run.finished');
      expect(children).toHaveLength(stage === 'input' ? 0 : 1);
      expect(finishes).toHaveLength(stage === 'input' ? 0 : 1);
      if (stage === 'output') {
        expect(children[0]).toMatchObject({ status: 'succeeded' });
        expect(finishes[0]).toMatchObject({ status: 'succeeded', childRunId: children[0]!.id });
        expect(failure[0]!.seq).toBe(finishes[0]!.seq + 1);
      }
      const recovery = await t.container.manager.getRecovery(parent.id);
      expect(recovery.resume).toMatchObject({ allowed: false, code: 'FAILURE_NOT_RESUMABLE' });
      const before = JSON.stringify(events);
      const refused = await t.app.inject({
        method: 'POST',
        url: `/runs/${parent.id}/resume`,
        payload: { observedSeq: recovery.observedSeq },
      });
      expect(refused.statusCode).toBe(409);
      expect(refused.json()).toMatchObject({ code: 'FAILURE_NOT_RESUMABLE' });
      expect(
        JSON.stringify(
          (await t.app.inject(`/runs/${parent.id}/events`)).json<{ items: RunEvent[] }>().items,
        ),
      ).toBe(before);
      expect(t.harness.started).toHaveLength(0);
    },
  );

  it.each([1, 2])(
    '#486 actual failed-child links remain authoritative through depth %i',
    async (depth) => {
      t = await createTestApp();
      t.harness.script([{ finalText: 'actual provider result', accepted: false }]);
      let loopId = await t.publishLoop(
        chain('Authored output leaf', {
          id: 'infer',
          kind: 'inference',
          label: 'Infer',
          config: {
            prompt: { template: 'go' },
            output: {
              transforms: [
                {
                  op: 'set',
                  path: '/vars/value',
                  value: { kind: 'expression', jsonata: '$error("private-leaf-486")' },
                },
              ],
            },
          },
        }),
      );
      for (let level = 0; level < depth; level += 1)
        loopId = await t.publishLoop(
          chain(`Parent level ${level}`, {
            id: 'sub',
            kind: 'subloop',
            label: 'Sub',
            config: { loopRef: { loopId } },
          }),
        );
      const root = await start(t, loopId);
      let current = root;
      for (let level = 0; level < depth; level += 1) {
        const [child] = (await t.app.inject(`/runs?parent=${current.id}`)).json<{
          items: RunRecord[];
        }>().items;
        expect(child).toBeDefined();
        expect(current.failure).toMatchObject({
          code: 'MUTATION_ERROR',
          nodeId: 'sub',
          resumable: false,
          details: {
            childRunId: child!.id,
            childNodeId: level + 1 === depth ? 'infer' : 'sub',
            childDetails: child!.failure!.details,
          },
        });
        expect(current.failure).not.toHaveProperty('inference');
        expect(current.failure?.details ?? {}).not.toHaveProperty('phase');
        expect((await t.container.ports.runs.get(current.id))?.failure).toEqual(current.failure);
        const events = (await t.app.inject(`/runs/${current.id}/events`)).json<{
          items: RunEvent[];
        }>().items;
        expect(events.filter((event) => event.type === 'run.failed')).toMatchObject([
          { failure: current.failure },
        ]);
        expect(events.filter((event) => event.type === 'child_run.finished')).toMatchObject([
          { childRunId: child!.id, status: 'failed' },
        ]);
        current = child!;
      }
      expect(current.failure).toMatchObject({
        nodeId: 'infer',
        details: { boundary: 'inference.output.transforms', phase: 'after-result' },
        inference: { promptKind: 'authored' },
      });
      expect(current.failure?.message).toContain(
        'GraphGoblin received the provider result before this step failed.',
      );
      const before = JSON.stringify(await t.container.ports.events.read(root.id));
      const refused = await t.app.inject({
        method: 'POST',
        url: `/runs/${root.id}/resume`,
        payload: { observedSeq: (await t.container.manager.getRecovery(root.id)).observedSeq },
      });
      expect(refused.statusCode).toBe(409);
      expect(refused.json()).toMatchObject({ code: 'FAILURE_NOT_RESUMABLE' });
      expect(JSON.stringify(await t.container.ports.events.read(root.id))).toBe(before);
      expect(t.harness.started).toHaveLength(1);
      expect(t.harness.resumed).toHaveLength(0);
    },
  );

  it('#486 B25 signal expression remains a request error with the same parked wait and zero effects', async () => {
    t = await createTestApp();
    const loopId = await t.publishLoop(
      chain('Signal request control', {
        id: 'wait',
        kind: 'wait',
        label: 'Wait',
        config: { mode: 'signal', name: 'go', filter: '$error("B25 existing request marker")' },
      }),
    );
    const parked = await start(t, loopId);
    expect(parked.status).toBe('waiting');
    const before = JSON.stringify(await t.container.ports.events.read(parked.id));
    const response = await t.app.inject({
      method: 'POST',
      url: `/runs/${parked.id}/signals/go`,
      payload: { waitId: parked.waiting!.waitId, payload: { value: 42 } },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: 'EXPRESSION_ERROR',
      detail: expect.stringContaining('B25 existing request marker'),
    });
    const after = (await t.app.inject(`/runs/${parked.id}`)).json<RunRecord>();
    expect(after.status).toBe('waiting');
    expect(after.waiting).toEqual(parked.waiting);
    expect(after.failure).toBeUndefined();
    expect(JSON.stringify(await t.container.ports.events.read(parked.id))).toBe(before);
    const events = await t.container.ports.events.read(parked.id);
    expect(
      events.filter((event) => ['signal.received', 'run.woken', 'run.failed'].includes(event.type)),
    ).toEqual([]);
    expect(t.harness.started).toHaveLength(0);
  });

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

    const childSnapshot = (await t.app.inject(`/runs/${child!.id}`)).json<
      RunRecord & { recovery: RunRecovery }
    >();
    expect(childSnapshot.recovery.resume).toMatchObject({
      code: 'PARENT_RECOVERY_REQUIRED',
      parentRunId: parent.id,
    });
    for (const action of ['resume', 'replay']) {
      const response = await t.app.inject({
        method: 'POST',
        url: `/runs/${child!.id}/${action}`,
        payload: {
          observedSeq: childSnapshot.recovery.observedSeq,
          ...(action === 'replay' ? { nodeId: 'think' } : {}),
        },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: 'PARENT_RECOVERY_REQUIRED' });
    }
    t.harness.script([{ finalText: 'continued after quota' }]);
    const resumed = await t.app.inject({
      method: 'POST',
      url: `/runs/${parent.id}/resume`,
      payload: { observedSeq: (await t.container.manager.getRecovery(parent.id)).observedSeq },
    });
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
    const resume = await t.app.inject({
      method: 'POST',
      url: `/runs/${parent.id}/resume`,
      payload: { observedSeq: (await t.container.manager.getRecovery(parent.id)).observedSeq },
    });
    expect(resume.statusCode).toBe(409);
  });
});
