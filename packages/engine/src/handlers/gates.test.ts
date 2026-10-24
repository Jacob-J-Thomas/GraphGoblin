import { describe, expect, it, vi } from 'vitest';
import {
  type DecisionConfig,
  type LoopDefinitionInput,
  RunEventSchema,
} from '@graphgoblin/contracts';
import { replayThread } from '@graphgoblin/domain';
import { RunManager } from '../run-manager.js';
import { createTestEngine, type TestEngine } from '../testing/scenario.js';

const routes = [
  { id: 'repeat', label: 'Repeat', repeat: true },
  { id: 'done', label: 'Done' },
];
function gateLoop(
  config: Partial<Extract<DecisionConfig, { kind: 'expression' }>> = {},
): LoopDefinitionInput {
  return {
    schemaVersion: 4,
    name: 'gate',
    settings: { maxNodeVisits: 20 },
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      {
        id: 'work',
        kind: 'mutate',
        label: 'Work',
        config: {
          operations: [
            {
              op: 'set',
              path: '/vars/work',
              value: { kind: 'expression', jsonata: '($exists(vars.work) ? vars.work : 0) + 1' },
            },
          ],
        },
      },
      {
        id: 'gate',
        kind: 'decision',
        label: 'Gate',
        config: { kind: 'expression', jsonata: '"repeat"', routes, maxPasses: 3, ...config },
      },
      { id: 'done', kind: 'exit', label: 'Done', config: { returns: 'vars.work' } },
      {
        id: 'exhausted',
        kind: 'exit',
        label: 'Exhausted',
        config: { outcome: 'exhausted', returns: 'vars.work' },
      },
    ],
    edges: [
      { id: 'start', from: { node: 'start', port: 'out' }, to: { node: 'work' } },
      { id: 'work', from: { node: 'work', port: 'out' }, to: { node: 'gate' } },
      { id: 'repeat', from: { node: 'gate', port: 'repeat' }, to: { node: 'work' } },
      { id: 'done', from: { node: 'gate', port: 'done' }, to: { node: 'done' } },
      { id: 'limit', from: { node: 'gate', port: 'limit-reached' }, to: { node: 'exhausted' } },
    ],
  };
}
const decisions = (e: TestEngine, runId: string) =>
  e.events(runId).filter((event) => event.type === 'decision.made');
const hang = () => new Promise<never>(() => undefined);

describe('decision gates', () => {
  it('recovers the recorded repeat route after the atomic append, before either snapshot or cursor saves', async () => {
    const e = await createTestEngine();
    const def = gateLoop();
    def.nodes[2] = {
      id: 'gate',
      kind: 'decision',
      label: 'Gate',
      config: {
        kind: 'llm',
        instructions: 'Choose',
        routes,
        harness: 'codex',
        model: { mode: 'inherit' },
        effort: { mode: 'inherit' },
        maxPasses: 3,
      },
    };
    def.nodes.push({
      id: 'checkpoint',
      kind: 'wait',
      label: 'Checkpoint',
      config: { mode: 'input', prompt: 'Continue?' },
    });
    def.edges[2]!.to.node = 'checkpoint';
    def.edges.push({
      id: 'checkpoint-work',
      from: { node: 'checkpoint', port: 'out' },
      to: { node: 'work' },
    });
    const choose = vi
      .spyOn(e.ports.codexDecider, 'route')
      .mockResolvedValue({ route: 'repeat', confidence: 1, reasoning: 'Repeat once' });
    let crashed = false;
    const append = e.ports.events.append.bind(e.ports.events);
    const freeze = vi
      .spyOn(e.ports.events, 'append')
      .mockImplementation(async (id, batch, options) => {
        const recorded = await append(id, batch, options);
        if (batch.some((event) => event.type === 'decision.made')) {
          expect(batch.map((event) => event.type)).toEqual(['decision.made', 'node.finished']);
          crashed = true;
          return hang();
        }
        return recorded;
      });
    const run = await e.start(e.publish(def).loopId);
    await vi.waitFor(() => expect(crashed).toBe(true));
    e.manager.stop();
    expect((await e.ports.runs.get(run.id))?.currentNodeId).toBe('gate');
    expect((await e.ports.runs.getThread(run.id))?.gates.gate?.passes).toBe(1);
    expect(decisions(e, run.id)).toHaveLength(1);
    expect(decisions(e, run.id)[0]).toMatchObject({
      portId: 'repeat',
      gate: { previousPasses: 1, passes: 2 },
    });
    freeze.mockRestore();
    for (let restart = 0; restart < 2; restart++) {
      const recovered = new RunManager(e.ports, e.settings);
      await recovered.start();
      await recovered.waitForIdle();
      expect(await recovered.getRun(run.id)).toMatchObject({
        status: 'waiting',
        currentNodeId: 'checkpoint',
      });
      const thread = await recovered.getThread(run.id);
      expect(thread).toMatchObject({ gates: { gate: { passes: 2 } }, vars: { work: 1 } });
      expect(thread).toEqual(
        replayThread((await e.ports.runs.getInitialThread(run.id))!, e.events(run.id)),
      );
      expect(choose).toHaveBeenCalledTimes(1);
      expect(decisions(e, run.id)).toHaveLength(1);
      expect(
        e
          .events(run.id)
          .filter((event) => event.type === 'node.finished' && event.nodeId === 'gate'),
      ).toHaveLength(1);
      recovered.stop();
    }
  });

  it.each(['choice', 'noul', 'score'] as const)(
    'applies the same gate policy to classifier %s routes',
    async (type) => {
      const e = await createTestEngine();
      const answer =
        type === 'choice'
          ? { type, options: routes.map((route) => ({ ...route, criteria: route.label })) }
          : type === 'noul'
            ? {
                type,
                true: { id: 'repeat', label: 'Repeat', criteria: 'Repeat', repeat: true },
                false: { id: 'done', label: 'Done', criteria: 'Done' },
              }
            : {
                type,
                anchors: ['Low', 'High'],
                bands: [
                  { id: 'repeat', label: 'Repeat', min: 0, max: 0.5, repeat: true },
                  { id: 'done', label: 'Done', min: 0.5, max: 1 },
                ],
              };
      const def = gateLoop();
      def.nodes[2] = {
        id: 'gate',
        kind: 'decision',
        label: 'Gate',
        config: { kind: 'classifier', answer, model: 'jev', question: 'Choose', maxPasses: 2 },
      };
      const run = await e.runToIdle(e.publish(def).loopId);
      expect(run).toMatchObject({ status: 'exhausted', result: 2 });
      expect(decisions(e, run.id).map((event) => event.gate?.passes)).toEqual([2, 2]);
      expect(decisions(e, run.id).at(-1)).toMatchObject({
        portId: 'limit-reached',
        observation: { kind: 'classifier', answer: { type } },
      });
      e.manager.stop();
    },
  );

  it('evaluates at the limit and preserves evaluator failures rather than declaring exhaustion', async () => {
    const e = await createTestEngine();
    const run = await e.runToIdle(
      e.publish(gateLoop({ maxPasses: 1, jsonata: '$error("evaluation failed")' })).loopId,
    );
    expect(run.failure?.code).toBe('EVALUATION_EXPRESSION_FAILED');
    expect(run.outcome).toBeUndefined();
    expect(decisions(e, run.id)).toEqual([]);
    expect((await e.manager.getThread(run.id))?.gates.gate?.passes).toBe(1);
    e.manager.stop();
  });

  it('gate counts are independent when more than one decision repeats', async () => {
    const e = await createTestEngine();
    const def = gateLoop({ jsonata: 'gates.gate.passes = 2 ? "done" : "repeat"' });
    def.nodes.push({
      id: 'second',
      kind: 'decision',
      label: 'Second',
      config: { kind: 'expression', routes, maxPasses: 2, jsonata: '"repeat"' },
    });
    def.edges[3]!.to.node = 'second';
    def.edges.push(
      { id: 'second-repeat', from: { node: 'second', port: 'repeat' }, to: { node: 'second' } },
      { id: 'second-done', from: { node: 'second', port: 'done' }, to: { node: 'done' } },
      {
        id: 'second-limit',
        from: { node: 'second', port: 'limit-reached' },
        to: { node: 'exhausted' },
      },
    );
    const run = await e.runToIdle(e.publish(def).loopId);
    expect(run.status).toBe('exhausted');
    expect((await e.manager.getThread(run.id))?.gates).toEqual({
      gate: { passes: 2 },
      second: { passes: 2 },
    });
    e.manager.stop();
  });

  it('a non-repeat choice on the last allowed pass wins', async () => {
    const e = await createTestEngine();
    const run = await e.runToIdle(
      e.publish(gateLoop({ jsonata: 'gates.gate.passes = 3 ? "done" : "repeat"' })).loopId,
    );
    expect(run).toMatchObject({ status: 'succeeded', outcome: 'success', result: 3, iteration: 1 });
    expect(
      decisions(e, run.id).map((event) => [event.portId, event.gate?.passes, event.gate?.limit]),
    ).toEqual([
      ['repeat', 2, null],
      ['repeat', 3, null],
      ['done', 3, null],
    ]);
    e.manager.stop();
  });

  it('repeat at the pass limit takes the distinct Limit reached output', async () => {
    const e = await createTestEngine();
    const append = vi.spyOn(e.ports.events, 'append');
    const run = await e.runToIdle(e.publish(gateLoop()).loopId);
    expect(run).toMatchObject({ status: 'exhausted', outcome: 'exhausted', result: 3 });
    expect(decisions(e, run.id).at(-1)).toMatchObject({
      portId: 'limit-reached',
      observation: { routeId: 'repeat' },
      gate: { passes: 3, previousPasses: 3, limit: 'max-passes' },
    });
    for (const [, drafts] of append.mock.calls.filter(([, batch]) =>
      batch.some((event) => event.type === 'decision.made'),
    ))
      expect(drafts.map((event) => event.type)).toEqual(['decision.made', 'node.finished']);
    expect(e.eventTypes(run.id)).not.toContain('iteration.incremented');
    for (const event of e.events(run.id))
      expect(RunEventSchema.safeParse(event).success).toBe(true);
    expect(await e.manager.getThread(run.id)).toEqual(
      replayThread((await e.ports.runs.getInitialThread(run.id))!, e.events(run.id)),
    );
    e.manager.stop();
  });

  it.each(['repeat', 'done'] as const)(
    'checks run time after LLM evaluation; %s wins according to its route',
    async (route) => {
      const e = await createTestEngine();
      e.ports.codexDecider.route = () => {
        e.ports.clock.advance(60_000);
        return Promise.resolve({
          route,
          confidence: 1,
          reasoning: 'Observed after run time limit',
        });
      };
      const def = gateLoop();
      def.nodes[2] = {
        id: 'gate',
        kind: 'decision',
        label: 'Gate',
        config: {
          kind: 'llm',
          instructions: 'Choose',
          routes,
          harness: 'codex',
          model: { mode: 'inherit' },
          effort: { mode: 'inherit' },
          maxPasses: 3,
          maxRunTimeSeconds: 60,
        },
      };
      const run = await e.runToIdle(e.publish(def).loopId);
      expect(run.status).toBe(route === 'repeat' ? 'exhausted' : 'succeeded');
      expect(decisions(e, run.id)[0]).toMatchObject({
        gate: { elapsedSeconds: 60, passes: 1, limit: route === 'repeat' ? 'max-run-time' : null },
      });
      e.manager.stop();
    },
  );

  it('maximum run time includes time before reaching the gate and parked waits', async () => {
    const e = await createTestEngine();
    const def = gateLoop({ maxRunTimeSeconds: 60 });
    def.nodes[1] = {
      id: 'work',
      kind: 'wait',
      label: 'Work',
      config: { mode: 'input', prompt: 'Continue?' },
    };
    const run = await e.runToIdle(e.publish(def).loopId);
    e.ports.clock.advance(60_000);
    await e.manager.provideInput(
      run.id,
      (await e.manager.getRun(run.id))?.waiting?.waitId ?? 'unknown',
      true,
    );
    expect((await e.settle(run.id)).status).toBe('exhausted');
    expect(decisions(e, run.id)[0]).toMatchObject({
      gate: { passes: 1, limit: 'max-run-time', elapsedSeconds: 60 },
    });
    e.manager.stop();
  });

  it('replay forks preserve the recorded count before their entry node', async () => {
    const e = await createTestEngine();
    const def = gateLoop();
    def.nodes.push({
      id: 'checkpoint',
      kind: 'mutate',
      label: 'Checkpoint',
      config: { operations: [{ op: 'delete', path: '/vars/unused' }] },
    });
    def.edges[2]!.to.node = 'checkpoint';
    def.edges.push({
      id: 'checkpoint',
      from: { node: 'checkpoint', port: 'out' },
      to: { node: 'work' },
    });
    const run = await e.runToIdle(e.publish(def).loopId);
    const fork = await e.manager.replay({ runId: run.id, nodeId: 'checkpoint' });
    expect((await e.ports.runs.getInitialThread(fork.id))?.gates.gate?.passes).toBe(2);
    expect((await e.settle(fork.id)).status).toBe('exhausted');
    expect(decisions(e, fork.id).map((event) => event.gate?.passes)).toEqual([3, 3]);
    e.manager.stop();
  });

  it('resuming a provider failure preserves counts from completed repeats', async () => {
    const e = await createTestEngine();
    const def = gateLoop();
    def.nodes[2] = {
      id: 'gate',
      kind: 'decision',
      label: 'Gate',
      config: {
        kind: 'llm',
        instructions: 'Choose',
        routes,
        harness: 'codex',
        model: { mode: 'inherit' },
        effort: { mode: 'inherit' },
        maxPasses: 3,
      },
    };
    let calls = 0;
    e.ports.codexDecider.route = () =>
      ++calls === 2
        ? Promise.reject(Object.assign(new Error('Unavailable'), { code: 'DECIDER_UNAVAILABLE' }))
        : Promise.resolve({ route: 'repeat', confidence: 1, reasoning: 'Repeat' });
    const run = await e.runToIdle(e.publish(def).loopId);
    expect(run.status).toBe('failed');
    expect((await e.manager.getThread(run.id))?.gates.gate?.passes).toBe(2);
    await e.manager.resume(run.id);
    expect((await e.settle(run.id)).status).toBe('exhausted');
    expect(decisions(e, run.id).map((event) => event.gate?.passes)).toEqual([2, 3, 3]);
    e.manager.stop();
  });

  it.each([
    'before-append',
    'after-append',
    'before-snapshot',
    'after-snapshot',
    'before-cursor',
    'after-cursor',
  ] as const)('recovery at %s preserves exactly one accepted repeat', async (boundary) => {
    const e = await createTestEngine();
    let blocked = false;
    const append = e.ports.events.append.bind(e.ports.events);
    const save = e.ports.runs.saveThread.bind(e.ports.runs);
    const update = e.ports.runs.update.bind(e.ports.runs);
    const a = vi.spyOn(e.ports.events, 'append').mockImplementation(async (id, drafts, options) => {
      const repeat = drafts.some(
        (event) => event.type === 'decision.made' && event.gate?.passes === 2,
      );
      if (repeat && boundary === 'before-append') {
        blocked = true;
        return hang();
      }
      const out = await append(id, drafts, options);
      if (repeat && boundary === 'after-append') {
        blocked = true;
        return hang();
      }
      return out;
    });
    const s = vi
      .spyOn(e.ports.runs, 'saveThread')
      .mockImplementation(async (id, thread, seq, replayState) => {
        const repeat = thread.gates.gate?.passes === 2;
        if (repeat && boundary === 'before-snapshot') {
          blocked = true;
          return hang();
        }
        await save(id, thread, seq, replayState);
        if (repeat && boundary === 'after-snapshot') {
          blocked = true;
          return hang();
        }
      });
    const u = vi.spyOn(e.ports.runs, 'update').mockImplementation(async (id, changes) => {
      const repeat =
        changes.currentNodeId === 'work' && decisions(e, id).at(-1)?.gate?.passes === 2;
      if (repeat && boundary === 'before-cursor') {
        blocked = true;
        return hang();
      }
      const out = await update(id, changes);
      if (repeat && boundary === 'after-cursor') {
        blocked = true;
        return hang();
      }
      return out;
    });
    const run = await e.start(e.publish(gateLoop()).loopId);
    await vi.waitFor(() => expect(blocked).toBe(true));
    e.manager.stop();
    a.mockRestore();
    s.mockRestore();
    u.mockRestore();
    const recovered = new RunManager(e.ports, e.settings);
    await recovered.start();
    await recovered.waitForIdle();
    expect(await recovered.getRun(run.id)).toMatchObject({ status: 'exhausted', result: 3 });
    expect(decisions(e, run.id).map((event) => event.gate?.passes)).toEqual([2, 3, 3]);
    const initial = (await e.ports.runs.getInitialThread(run.id))!;
    expect(await recovered.getThread(run.id)).toEqual(replayThread(initial, e.events(run.id)));
    recovered.stop();
  });
});
