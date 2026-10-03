import { describe, expect, it } from 'vitest';
import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { FIXTURE_IDS } from '@graphgoblin/contracts/testing';
import { createTestEngine, singleNodeLoop } from '../testing/scenario.js';

function waitLoop(name: string, config: Record<string, unknown>): LoopDefinitionInput {
  return singleNodeLoop(
    name,
    { id: 'wait', kind: 'wait', label: 'W', config },
    { return: { mapping: 'lastOutput.value' } },
  );
}

describe('wait node', () => {
  it('waits for input, validates it against the schema, and records it as a user message', async () => {
    const engine = await createTestEngine();
    const version = engine.publish(
      waitLoop('input', {
        mode: 'input',
        prompt: 'Approve {{ trigger.payload.title }}?',
        inputSchema: { type: 'object', required: ['approved'] },
      }),
    );
    const run = await engine.runToIdle(version.loopId, { title: 'PR 7' });
    expect(run.status).toBe('waiting');
    expect(run.waiting).toMatchObject({ nodeId: 'wait', kind: 'input', prompt: 'Approve PR 7?' });
    await expect(engine.manager.provideInput(run.id, { nope: true })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    await expect(engine.manager.signal(run.id, 'go')).resolves.toMatchObject({ woke: false });
    await engine.manager.provideInput(run.id, { approved: true }, { kind: 'user', id: 'u' });
    const done = await engine.settle(run.id);
    expect(done.status).toBe('succeeded');
    expect(done.result).toEqual({ approved: true });
    const thread = await engine.manager.getThread(run.id);
    expect(thread?.messages.at(-1)).toMatchObject({
      role: 'user',
      content: '{"approved":true}',
      tags: ['input'],
    });
    expect(engine.eventTypes(run.id)).toEqual(
      expect.arrayContaining(['run.waiting', 'input.received', 'run.woken']),
    );
    await expect(engine.manager.provideInput(run.id, {})).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
  });

  it('waits for a named signal, applies the filter, and keeps unrelated signals', async () => {
    const engine = await createTestEngine();
    const version = engine.publish(
      waitLoop('signal', { mode: 'signal', name: 'deploy', filter: 'env = "prod"' }),
    );
    const run = await engine.runToIdle(version.loopId);
    expect(run.waiting).toMatchObject({ kind: 'signal', signalName: 'deploy' });
    expect((await engine.manager.signal(run.id, 'other', {})).woke).toBe(false);
    expect((await engine.manager.signal(run.id, 'deploy', { env: 'staging' })).woke).toBe(false);
    expect((await engine.manager.signal(run.id, 'deploy', { env: 'prod' })).woke).toBe(true);
    const done = await engine.settle(run.id);
    expect(done.result).toEqual({ env: 'prod' });
    expect(engine.events(run.id).filter((e) => e.type === 'signal.received')).toHaveLength(3);
    await expect(engine.manager.signal(run.id, 'deploy')).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
  });

  it('sleeps for a duration and wakes on the timer', async () => {
    const engine = await createTestEngine();
    const version = engine.publish(waitLoop('sleep', { mode: 'duration', seconds: 30 }));
    const run = await engine.runToIdle(version.loopId);
    expect(run.waiting?.kind).toBe('timer');
    expect(engine.ports.timers.scheduled[0]).toMatchObject({ runId: run.id, key: 'timer' });
    expect(engine.ports.timers.scheduled[0]?.at.toISOString()).toBe('2026-10-02T12:00:30.000Z');
    engine.ports.clock.advance(30_000);
    expect(await engine.ports.timers.fireDue(engine.ports.clock.now())).toBe(1);
    const done = await engine.settle(run.id);
    expect(done.status).toBe('succeeded');
    expect(done.result).toMatchObject({ reason: 'timer' });
  });

  it('waits until a rendered timestamp and rejects bad timestamps', async () => {
    const engine = await createTestEngine();
    const version = engine.publish(
      waitLoop('until', { mode: 'until', timestamp: '{{ trigger.payload.at }}' }),
    );
    const run = await engine.runToIdle(version.loopId, { at: '2026-10-02T13:00:00Z' });
    expect(run.waiting?.until).toBe('2026-10-02T13:00:00.000Z');
    const bad = await engine.runToIdle(version.loopId, { at: 'soon' });
    expect(bad.failure?.code).toBe('TEMPLATE_ERROR');
  });

  it('times out and continues by default, or fails when configured', async () => {
    const engine = await createTestEngine();
    const lenient = engine.publish(
      waitLoop('to', { mode: 'input', prompt: 'p', timeoutSeconds: 10 }),
    );
    const run = await engine.runToIdle(lenient.loopId);
    expect(run.waiting?.until).toBe('2026-10-02T12:00:10.000Z');
    await engine.ports.timers.fire(run.id, 'timeout');
    const done = await engine.settle(run.id);
    expect(done.status).toBe('succeeded');
    expect(done.result).toEqual({ timedOut: true });

    const strict = engine.publish(
      waitLoop('to2', { mode: 'signal', name: 'x', timeoutSeconds: 10, onTimeout: 'fail-run' }),
    );
    const run2 = await engine.runToIdle(strict.loopId);
    await engine.ports.timers.fire(run2.id, 'timeout');
    const failed = await engine.settle(run2.id);
    expect(failed.failure?.code).toBe('WAIT_TIMEOUT');
  });

  it('ignores stray timers for runs that are not waiting on them', async () => {
    const engine = await createTestEngine();
    const version = engine.publish(waitLoop('stray', { mode: 'input', prompt: 'p' }));
    const run = await engine.runToIdle(version.loopId);
    await engine.ports.timers.fire(run.id, 'timer');
    await engine.ports.timers.fire(FIXTURE_IDS.run, 'timer');
    await engine.manager.waitForIdle();
    expect((await engine.ports.runs.get(run.id))?.status).toBe('waiting');
  });
});

describe('heartbeat node', () => {
  function heartbeatLoop(config: Record<string, unknown>): LoopDefinitionInput {
    return singleNodeLoop(
      'hb',
      { id: 'hb', kind: 'heartbeat', label: 'H', config },
      { return: { mapping: 'lastOutput.value' } },
    );
  }

  it('polls an HTTP probe until the condition holds', async () => {
    const engine = await createTestEngine();
    let calls = 0;
    engine.ports.probes.respondWith(() => {
      calls += 1;
      return {
        status: calls >= 3 ? 200 : 202,
        headers: {},
        body: JSON.stringify({ ready: calls >= 3 }),
      };
    });
    const version = engine.publish(
      heartbeatLoop({
        intervalSeconds: 5,
        probe: {
          kind: 'http',
          url: 'https://example.test/{{ trigger.payload.id }}',
          headers: { 'x-a': '{{ vars.x }}' },
        },
        until: 'probe.json.ready',
        maxBeats: 10,
        record: 'full',
      }),
    );
    let run = await engine.runToIdle(version.loopId, { id: 'job-1' });
    expect(run.status).toBe('waiting');
    expect(run.waiting).toMatchObject({ kind: 'heartbeat', beat: 1 });
    for (let i = 0; i < 2; i += 1) {
      await engine.ports.timers.fire(run.id, 'heartbeat');
      run = await engine.settle(run.id);
    }
    expect(run.status).toBe('succeeded');
    expect(engine.ports.probes.requests[0]?.url).toBe('https://example.test/job-1');
    expect(engine.events(run.id).filter((e) => e.type === 'heartbeat.beat')).toHaveLength(3);
    expect(run.result).toMatchObject({ beat: 3, satisfied: true, probe: { status: 200 } });
  });

  it('exhausts on maxBeats and continues, or fails when configured', async () => {
    const engine = await createTestEngine();
    const lenient = engine.publish(heartbeatLoop({ intervalSeconds: 1, maxBeats: 2 }));
    let run = await engine.runToIdle(lenient.loopId);
    await engine.ports.timers.fire(run.id, 'heartbeat');
    run = await engine.settle(run.id);
    expect(run.status).toBe('succeeded');
    expect(run.result).toMatchObject({ beat: 2, exhausted: true });

    const strict = engine.publish(
      heartbeatLoop({ intervalSeconds: 1, maxBeats: 1, onExhausted: 'fail-run' }),
    );
    const failed = await engine.runToIdle(strict.loopId);
    expect(failed.failure?.code).toBe('HEARTBEAT_EXHAUSTED');
  });

  it('respects a rendered deadline and rejects invalid ones', async () => {
    const engine = await createTestEngine();
    const version = engine.publish(
      heartbeatLoop({ intervalSeconds: 60, deadline: '{{ trigger.payload.deadline }}' }),
    );
    const run = await engine.runToIdle(version.loopId, { deadline: '2026-10-02T12:00:30Z' });
    expect(run.status).toBe('waiting');
    engine.ports.clock.advance(60_000);
    await engine.ports.timers.fire(run.id, 'heartbeat');
    const done = await engine.settle(run.id);
    expect(done.result).toMatchObject({ exhausted: true, beat: 2 });
    const bad = await engine.runToIdle(version.loopId, { deadline: 'whenever' });
    expect(bad.failure?.code).toBe('TEMPLATE_ERROR');
  });

  it('counts signals and runs script probes', async () => {
    const engine = await createTestEngine();
    const version = engine.publish(
      heartbeatLoop({
        intervalSeconds: 1,
        probe: { kind: 'signal-count', name: 'tick' },
        until: 'probe.count >= 2',
        maxBeats: 5,
      }),
    );
    let run = await engine.runToIdle(version.loopId);
    await engine.manager.signal(run.id, 'tick');
    await engine.manager.signal(run.id, 'tick');
    await engine.ports.timers.fire(run.id, 'heartbeat');
    run = await engine.settle(run.id);
    expect(run.status).toBe('succeeded');
    expect(run.result).toMatchObject({ probe: { count: 2 } });

    engine.ports.scripts.respondWith(() => ({
      exitCode: 0,
      stdout: '{"done":true}',
      stderr: '',
      timedOut: false,
    }));
    const scripted = engine.publish(
      heartbeatLoop({
        intervalSeconds: 1,
        probe: { kind: 'script', command: 'check', args: ['{{ trigger.payload }}'] },
        until: 'probe.json.done',
        maxBeats: 2,
      }),
    );
    const done = await engine.runToIdle(scripted.loopId, 'arg');
    expect(done.status).toBe('succeeded');
    expect(engine.ports.scripts.calls[0]?.args).toEqual(['arg']);
    expect(done.result).toMatchObject({ probe: { exitCode: 0, json: { done: true } } });
  });
});

describe('subloop node', () => {
  const childDef: LoopDefinitionInput = {
    schemaVersion: 1,
    name: 'child',
    nodes: [
      { id: 'start', kind: 'trigger', label: 'S', config: { subtype: 'manual' } },
      {
        id: 'work',
        kind: 'mutate',
        label: 'W',
        config: {
          operations: [
            {
              op: 'set',
              path: '/vars/childVar',
              value: { kind: 'expression', jsonata: '"child saw " & $string(trigger.payload)' },
            },
            { op: 'set', path: '/vars/shared', value: { kind: 'literal', value: 'from-child' } },
            { op: 'append-message', role: 'assistant', content: 'child message' },
          ],
        },
      },
      {
        id: 'done',
        kind: 'exit',
        label: 'D',
        config: {
          return: { mapping: '{ "childVar": vars.childVar, "inherited": vars.parentVar }' },
        },
      },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'work' } },
      { id: 'e2', from: { node: 'work', port: 'out' }, to: { node: 'done' } },
    ],
  };

  function parentLoop(
    subloopConfig: Record<string, unknown>,
    childLoopId: string,
  ): LoopDefinitionInput {
    return {
      schemaVersion: 1,
      name: 'parent',
      nodes: [
        { id: 'start', kind: 'trigger', label: 'S', config: { subtype: 'manual' } },
        {
          id: 'prep',
          kind: 'mutate',
          label: 'P',
          config: {
            operations: [
              {
                op: 'set',
                path: '/vars/parentVar',
                value: { kind: 'literal', value: 'from-parent' },
              },
              { op: 'set', path: '/vars/shared', value: { kind: 'literal', value: 'from-parent' } },
            ],
          },
        },
        {
          id: 'sub',
          kind: 'subloop',
          label: 'Sub',
          config: { loopRef: { loopId: childLoopId }, ...subloopConfig },
        },
        {
          id: 'done',
          kind: 'exit',
          label: 'D',
          config: {
            return: {
              mapping: '{ "vars": vars, "last": lastOutput.value, "messages": $count(messages) }',
            },
          },
        },
      ],
      edges: [
        { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'prep' } },
        { id: 'e2', from: { node: 'prep', port: 'out' }, to: { node: 'sub' } },
        { id: 'e3', from: { node: 'sub', port: 'out' }, to: { node: 'done' } },
      ],
    };
  }

  it('runs a child with an inherited thread and maps the result back', async () => {
    const engine = await createTestEngine();
    const child = engine.publish(childDef);
    const parent = engine.publish(parentLoop({}, child.loopId));
    const run = await engine.runToIdle(parent.loopId, 'payload');
    expect(run.status).toBe('succeeded');
    const result = run.result as {
      vars: Record<string, unknown>;
      last: Record<string, unknown>;
      messages: number;
    };
    expect(result.last).toMatchObject({
      status: 'succeeded',
      outcome: 'success',
      result: { childVar: 'child saw payload', inherited: 'from-parent' },
    });
    expect(result.vars['shared']).toBe('from-parent'); // result-only does not merge vars
    const children = await engine.ports.runs.listChildren(run.id);
    expect(children).toHaveLength(1);
    expect(children[0]?.status).toBe('succeeded');
    expect(engine.eventTypes(run.id)).toEqual(
      expect.arrayContaining([
        'child_run.started',
        'run.waiting',
        'run.woken',
        'child_run.finished',
      ]),
    );
    const childThread = await engine.manager.getThread(children[0]!.id);
    expect(childThread?.run.parentRunId).toBe(run.id);
    expect(childThread?.invocation.source).toBe('subloop');
  });

  it('projects input, injects messages, builds a trigger payload, and merges output', async () => {
    const engine = await createTestEngine();
    const child = engine.publish(childDef);
    const parent = engine.publish(
      parentLoop(
        {
          input: {
            mode: 'project',
            vars: { parentVar: '"projected"' },
            messages: 'none',
            inject: [{ content: 'hello child {{ vars.parentVar }}' }],
            trigger: { payload: '{ "n": 1 }' },
          },
          output: {
            mode: 'merge',
            resultTo: { lastOutput: false, var: 'childResult' },
            vars: { strategy: 'child-wins' },
            messages: 'all',
            artifacts: 'all',
          },
        },
        child.loopId,
      ),
    );
    const run = await engine.runToIdle(parent.loopId);
    const result = run.result as { vars: Record<string, unknown>; messages: number };
    expect(result.vars['shared']).toBe('from-child');
    expect(result.vars['childResult']).toEqual({
      childVar: 'child saw {"n":1}',
      inherited: 'projected',
    });
    expect(result.messages).toBe(2); // injected note + child's assistant message merged back
  });

  it('supports fresh input, parent-wins and explicit merges, and custom patches', async () => {
    const engine = await createTestEngine();
    const child = engine.publish(childDef);
    const parentWins = engine.publish(
      parentLoop(
        {
          input: { mode: 'fresh' },
          output: { mode: 'merge', vars: { strategy: 'parent-wins' }, usage: 'separate' },
        },
        child.loopId,
      ),
      { loopId: engine.loopId('pw') },
    );
    const pw = await engine.runToIdle(parentWins.loopId);
    expect((pw.result as { vars: Record<string, unknown> }).vars['shared']).toBe('from-parent');

    const explicit = engine.publish(
      parentLoop(
        {
          output: {
            mode: 'merge',
            vars: { strategy: 'explicit', map: { picked: 'vars.childVar' } },
          },
        },
        child.loopId,
      ),
      { loopId: engine.loopId('ex') },
    );
    const ex = await engine.runToIdle(explicit.loopId, 'p');
    expect((ex.result as { vars: Record<string, unknown> }).vars['picked']).toBe('child saw p');

    const custom = engine.publish(
      parentLoop(
        {
          output: {
            mode: 'custom',
            custom: {
              patch: '[{ "op": "add", "path": "/vars/custom", "value": result.childVar }]',
            },
          },
        },
        child.loopId,
      ),
      { loopId: engine.loopId('cu') },
    );
    const cu = await engine.runToIdle(custom.loopId, 'q');
    expect((cu.result as { vars: Record<string, unknown> }).vars['custom']).toBe('child saw q');

    const badCustom = engine.publish(
      parentLoop(
        {
          output: {
            mode: 'custom',
            custom: { patch: '[{ "op": "add", "path": "/run/id", "value": 1 }]' },
          },
        },
        child.loopId,
      ),
      { loopId: engine.loopId('bc') },
    );
    expect((await engine.runToIdle(badCustom.loopId)).failure?.message).toMatch(
      /outside the mutable regions/,
    );
    const notPatch = engine.publish(
      parentLoop({ output: { mode: 'custom', custom: { patch: '"nope"' } } }, child.loopId),
      { loopId: engine.loopId('np') },
    );
    expect((await engine.runToIdle(notPatch.loopId)).failure).toMatchObject({
      code: 'EXPRESSION_ERROR',
    });
  });

  it('fails on missing child loops and depth limits, and cancels children with the parent', async () => {
    const engine = await createTestEngine();
    const missing = engine.publish(parentLoop({}, FIXTURE_IDS.childLoop));
    expect((await engine.runToIdle(missing.loopId)).failure?.code).toBe('SUBLOOP_NOT_FOUND');

    const pinned = engine.publish(
      parentLoop({ loopRef: { loopId: FIXTURE_IDS.childLoop, version: 2 } }, FIXTURE_IDS.childLoop),
      { loopId: engine.loopId('pinned') },
    );
    expect((await engine.runToIdle(pinned.loopId)).failure?.code).toBe('SUBLOOP_NOT_FOUND');

    // A loop that calls itself: depth limit 2 means the third nesting fails.
    const selfId = engine.loopId('self');
    const selfLoop = parentLoop({ depthLimitOverride: 2 }, selfId);
    selfLoop.name = 'self';
    engine.publish(selfLoop, { loopId: selfId });
    const deep = await engine.runToIdle(selfId);
    expect(deep.status).toBe('succeeded'); // the innermost child failed with depth exceeded; parents see a failed child result
    const all = [...engine.ports.runs.runs.values()];
    const failedChild = all.find((r) => r.failure?.code === 'SUBLOOP_DEPTH_EXCEEDED');
    expect(failedChild?.failure?.resumable).toBe(false);

    const waitingChild = engine.publish(
      singleNodeLoop('wchild', {
        id: 'w',
        kind: 'wait',
        label: 'W',
        config: { mode: 'input', prompt: 'p' },
      }),
      { loopId: engine.loopId('wchild') },
    );
    const parent = engine.publish(parentLoop({}, waitingChild.loopId), {
      loopId: engine.loopId('wparent'),
    });
    const run = await engine.runToIdle(parent.loopId);
    expect(run.status).toBe('waiting');
    expect(run.waiting?.kind).toBe('child');
    await engine.manager.cancel(run.id);
    await engine.manager.waitForIdle();
    const children = await engine.ports.runs.listChildren(run.id);
    expect(children[0]?.status).toBe('cancelled');
    expect((await engine.ports.runs.get(run.id))?.status).toBe('cancelled');
  });

  it('a cancelled or failed child wakes the parent with its status', async () => {
    const engine = await createTestEngine();
    const waitingChild = engine.publish(
      singleNodeLoop('wc', {
        id: 'w',
        kind: 'wait',
        label: 'W',
        config: { mode: 'input', prompt: 'p' },
      }),
    );
    const parent = engine.publish(parentLoop({}, waitingChild.loopId));
    const run = await engine.runToIdle(parent.loopId);
    const child = (await engine.ports.runs.listChildren(run.id))[0]!;
    await engine.manager.cancel(child.id);
    const done = await engine.settle(run.id);
    expect(done.status).toBe('succeeded');
    expect((done.result as { last: { status: string } }).last.status).toBe('cancelled');
  });
});
