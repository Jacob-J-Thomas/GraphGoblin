import { describe, expect, it, vi } from 'vitest';
import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { fakeUlid } from '@graphgoblin/contracts/testing';
import { createTestEngine, singleNodeLoop } from './testing/scenario.js';

/** start -> a (sets vars.a) -> b (sets vars.b) -> done, returning vars. */
function linearLoop(): LoopDefinitionInput {
  return {
    schemaVersion: 1,
    name: 'linear',
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { subtype: 'manual' } },
      {
        id: 'a',
        kind: 'mutate',
        label: 'A',
        config: {
          operations: [
            {
              op: 'set',
              path: '/vars/a',
              value: { kind: 'expression', jsonata: 'invocation.trigger.payload.n' },
            },
          ],
        },
      },
      {
        id: 'b',
        kind: 'mutate',
        label: 'B',
        config: {
          operations: [{ op: 'set', path: '/vars/b', value: { kind: 'literal', value: 2 } }],
        },
      },
      { id: 'done', kind: 'exit', label: 'Done', config: { return: { mapping: 'vars' } } },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'a' } },
      { id: 'e2', from: { node: 'a', port: 'out' }, to: { node: 'b' } },
      { id: 'e3', from: { node: 'b', port: 'out' }, to: { node: 'done' } },
    ],
  };
}

describe('replay-at-node', () => {
  it('forks a finished run at a node with the thread from just before that node', async () => {
    const engine = await createTestEngine();
    const version = engine.publish(linearLoop());
    const source = await engine.runToIdle(
      version.loopId,
      { n: 7 },
      {
        caller: { kind: 'user', id: 'alice' },
        returnDefaults: [{ kind: 'log' }],
      },
    );
    expect(source.status).toBe('succeeded');
    expect(source.result).toEqual({ a: 7, b: 2 });

    const fork = await engine.manager.replay({ runId: source.id, nodeId: 'b' });
    expect(fork.id).not.toBe(source.id);
    expect(fork).toMatchObject({
      status: 'queued',
      loopId: source.loopId,
      versionId: source.versionId,
      currentNodeId: 'b',
      iteration: 1,
    });
    expect(fork.invocationId).not.toBe(source.invocationId);
    expect(fork.parentRunId).toBeUndefined();

    const initial = await engine.ports.runs.getInitialThread(fork.id);
    expect(initial?.run.id).toBe(fork.id);
    expect(initial?.vars).toEqual({ a: 7 });
    expect(initial?.counters.nodeVisits).toEqual({ start: 1, a: 1 });
    expect(initial?.invocation).toMatchObject({
      id: fork.invocationId,
      source: 'manual.api',
      caller: { kind: 'user', id: 'alice' },
      trigger: { nodeId: 'start', payload: { n: 7 } },
      replayOf: { runId: source.id, nodeId: 'b' },
    });
    expect(initial?.invocation.returnDefaults).toBeUndefined();

    const finished = await engine.settle(fork.id);
    expect(finished.status).toBe('succeeded');
    expect(finished.result).toEqual({ a: 7, b: 2 });
    const events = engine.events(fork.id);
    expect(events[0]).toMatchObject({
      type: 'run.queued',
      replayOf: { runId: source.id, nodeId: 'b' },
    });
    expect(
      events
        .filter((e) => e.type === 'node.started')
        .map((e) => e.type === 'node.started' && e.nodeId),
    ).toEqual(['b', 'done']);
    const thread = await engine.manager.getThread(fork.id);
    expect(thread?.counters.nodeVisits).toEqual({ start: 1, a: 1, b: 1, done: 1 });
    // The source run is untouched.
    expect(engine.eventTypes(source.id).at(-1)).toBe('return.delivered');
    expect((await engine.ports.runs.get(source.id))?.status).toBe('succeeded');
  });

  it('replays the trigger node with the initial thread and records the requester', async () => {
    const engine = await createTestEngine();
    const version = engine.publish(linearLoop());
    const source = await engine.runToIdle(version.loopId, { n: 1 });
    const fork = await engine.manager.replay({
      runId: source.id,
      nodeId: 'start',
      source: 'manual.mcp',
      caller: { kind: 'mcp-client', id: 'k1' },
    });
    const initial = await engine.ports.runs.getInitialThread(fork.id);
    expect(initial?.vars).toEqual({});
    expect(initial?.invocation).toMatchObject({
      source: 'manual.mcp',
      caller: { kind: 'mcp-client', id: 'k1' },
    });
    expect((await engine.settle(fork.id)).result).toEqual({ a: 1, b: 2 });
  });

  it('forks a run that is still waiting, and rejects nodes the source never started', async () => {
    const engine = await createTestEngine();
    const version = engine.publish(
      singleNodeLoop('waits', {
        id: 'ask',
        kind: 'wait',
        label: 'Ask',
        config: { mode: 'input', prompt: 'go?' },
      }),
    );
    const source = await engine.runToIdle(version.loopId);
    expect(source.status).toBe('waiting');
    await expect(engine.manager.replay({ runId: source.id, nodeId: 'done' })).rejects.toMatchObject(
      { code: 'REPLAY_NODE_NOT_REACHED' },
    );
    await expect(engine.manager.replay({ runId: source.id, nodeId: 'nope' })).rejects.toMatchObject(
      { code: 'REPLAY_NODE_NOT_REACHED' },
    );

    const fork = await engine.manager.replay({ runId: source.id, nodeId: 'ask' });
    const parked = await engine.settle(fork.id);
    expect(parked.status).toBe('waiting');
    expect(parked.waiting).toMatchObject({ nodeId: 'ask', kind: 'input' });
    // The source still waits on its own; answering the fork does not touch it.
    await engine.manager.provideInput(fork.id, 'yes');
    expect((await engine.settle(fork.id)).status).toBe('succeeded');
    expect((await engine.ports.runs.get(source.id))?.status).toBe('waiting');
  });

  it('re-executes a subloop node with a new child instead of copying children', async () => {
    const engine = await createTestEngine();
    const child = engine.publish(minimalChild(), { loopId: engine.loopId('child') });
    const parent = engine.publish(
      singleNodeLoop('parent', {
        id: 'sub',
        kind: 'subloop',
        label: 'Sub',
        config: { loopRef: { loopId: child.loopId } },
      }),
    );
    const source = await engine.runToIdle(parent.loopId);
    expect(source.status).toBe('succeeded');
    const sourceChildren = await engine.ports.runs.listChildren(source.id);
    expect(sourceChildren).toHaveLength(1);

    const fork = await engine.manager.replay({ runId: source.id, nodeId: 'sub' });
    expect((await engine.settle(fork.id)).status).toBe('succeeded');
    const forkChildren = await engine.ports.runs.listChildren(fork.id);
    expect(forkChildren).toHaveLength(1);
    expect(forkChildren[0]?.id).not.toBe(sourceChildren[0]?.id);
    expect(await engine.ports.runs.listChildren(source.id)).toHaveLength(1);
  });

  it('forks a child run as a top-level run', async () => {
    const engine = await createTestEngine();
    const child = engine.publish(minimalChild(), { loopId: engine.loopId('child') });
    const parent = engine.publish(
      singleNodeLoop('parent', {
        id: 'sub',
        kind: 'subloop',
        label: 'Sub',
        config: { loopRef: { loopId: child.loopId } },
      }),
    );
    const source = await engine.runToIdle(parent.loopId);
    const [childRun] = await engine.ports.runs.listChildren(source.id);
    const fork = await engine.manager.replay({ runId: childRun!.id, nodeId: 'done' });
    expect(fork.parentRunId).toBeUndefined();
    const thread = await engine.ports.runs.getInitialThread(fork.id);
    expect(thread?.run.parentRunId).toBeUndefined();
    expect((await engine.settle(fork.id)).status).toBe('succeeded');
  });

  it('rejects unknown runs, missing versions or nodes, and runs without an initial thread', async () => {
    const engine = await createTestEngine();
    await expect(
      engine.manager.replay({ runId: fakeUlid('missing'), nodeId: 'a' }),
    ).rejects.toMatchObject({ code: 'RUN_NOT_FOUND' });

    const version = engine.publish(linearLoop());
    const source = await engine.runToIdle(version.loopId, { n: 1 });

    const spy = vi.spyOn(engine.ports.runs, 'getInitialThread').mockResolvedValueOnce(undefined);
    await expect(engine.manager.replay({ runId: source.id, nodeId: 'b' })).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
    spy.mockRestore();

    // A version whose definition no longer has the node (drafts are edited in place).
    const record = engine.ports.loops.versions.get(version.id)!;
    engine.ports.loops.versions.set(version.id, {
      ...record,
      definition: {
        ...record.definition,
        nodes: record.definition.nodes.filter((n) => n.id !== 'b'),
      },
    });
    await expect(engine.manager.replay({ runId: source.id, nodeId: 'b' })).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
    engine.ports.loops.versions.delete(version.id);
    await expect(engine.manager.replay({ runId: source.id, nodeId: 'b' })).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
  });
});

function minimalChild(): LoopDefinitionInput {
  return {
    schemaVersion: 1,
    name: 'child',
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { subtype: 'manual' } },
      { id: 'done', kind: 'exit', label: 'Done', config: { return: { mapping: '"ok"' } } },
    ],
    edges: [{ id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'done' } }],
  };
}
