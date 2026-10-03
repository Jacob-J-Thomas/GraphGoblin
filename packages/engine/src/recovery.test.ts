/**
 * Regressions from the independent review of WP-G: crash boundaries around node completion,
 * wakes, terminal transitions, pause while parked, and the thread checkpoint. Each test freezes
 * the executor at an asynchronous boundary (a write that never returns) and recovers with a new
 * manager over the same stores, sometimes twice.
 */
import { describe, expect, it, vi } from 'vitest';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { replayThread } from '@graphgoblin/domain';
import { AppendConflictError } from './errors.js';
import { RunManager } from './run-manager.js';
import {
  createTestEngine,
  singleNodeLoop,
  type TestEngine,
  type TestNode,
} from './testing/scenario.js';

const hang = () => new Promise<never>(() => undefined);
const inputLoop = (name = 'input') =>
  singleNodeLoop(name, {
    id: 'wait',
    kind: 'wait',
    label: 'Wait',
    config: { mode: 'input', prompt: '?' },
  });
const subLoop = (name: string, loopId: string) =>
  singleNodeLoop(name, {
    id: 'sub',
    kind: 'subloop',
    label: 'Sub',
    config: { loopRef: { loopId } },
  });

async function recover(e: TestEngine): Promise<RunManager> {
  const manager = new RunManager(e.ports, e.settings);
  await manager.start();
  await manager.waitForIdle();
  manager.stop();
  return manager;
}

describe('cursor boundaries, recovered twice', () => {
  const kinds = [
    'inference',
    'decision-yes',
    'decision-no',
    'mutate',
    'script',
    'wait',
    'heartbeat',
    'subloop',
    'exit',
  ] as const;
  const boundaries = ['append-return', 'before-cursor', 'after-cursor'] as const;
  it.each(kinds.flatMap((kind) => boundaries.map((boundary) => ({ kind, boundary }))))(
    '$kind at $boundary',
    async ({ kind, boundary }) => {
      const e = await createTestEngine({ maxConcurrentRuns: 1 });
      const child = e.publish(minimalLoop());
      const configs: Record<string, unknown> = {
        inference: { prompt: { template: 'hello' } },
        decision: {
          question: '?',
          strategy: ['jev'],
          routes: [
            { label: 'yes', description: 'Y' },
            { label: 'no', description: 'N' },
          ],
        },
        mutate: {
          operations: [
            { op: 'inject', position: 'end', messages: [{ role: 'user', content: 'once' }] },
          ],
        },
        script: { command: 'echo', args: ['hello'] },
        wait: { mode: 'input', prompt: '?' },
        heartbeat: { intervalSeconds: 1, until: 'true' },
        subloop: { loopRef: { loopId: child.loopId } },
        exit: {},
      };
      const nodeKind = kind.startsWith('decision') ? 'decision' : kind;
      const node: TestNode = {
        id: 'target',
        kind: nodeKind as TestNode['kind'],
        label: 'Target',
        config: configs[nodeKind],
      };
      const def = singleNodeLoop(`cursor-${kind}-${boundary}`, node);
      if (nodeKind === 'decision') {
        def.edges.push(
          ...['yes', 'no'].map((route) => ({
            id: route,
            from: { node: 'target', port: route },
            to: { node: 'done' },
          })),
        );
        vi.spyOn(e.ports.jev, 'choose').mockResolvedValue({ label: kind.slice(9) });
      }
      if (nodeKind === 'exit') def.edges = def.edges.filter((edge) => edge.from.node !== 'target');
      let blocked = false;
      const append = e.ports.events.append.bind(e.ports.events);
      const update = e.ports.runs.update.bind(e.ports.runs);
      const transition = e.ports.runs.transition.bind(e.ports.runs);
      const a = vi
        .spyOn(e.ports.events, 'append')
        .mockImplementation(async (id, drafts, options) => {
          const out = await append(id, drafts, options);
          if (
            boundary === 'append-return' &&
            drafts.some((d) => d.type === 'node.finished' && d.nodeId === 'target')
          ) {
            blocked = true;
            return hang();
          }
          return out;
        });
      const u = vi.spyOn(e.ports.runs, 'update').mockImplementation(async (id, changes) => {
        if (
          nodeKind !== 'exit' &&
          boundary !== 'append-return' &&
          changes.currentNodeId === 'done' &&
          e.events(id).some((x) => x.type === 'node.finished' && x.nodeId === 'target')
        ) {
          if (boundary === 'after-cursor') await update(id, changes);
          blocked = true;
          return hang();
        }
        return update(id, changes);
      });
      const t = vi
        .spyOn(e.ports.runs, 'transition')
        .mockImplementation(async (id, from, changes) => {
          if (
            nodeKind === 'exit' &&
            boundary !== 'append-return' &&
            changes.status === 'succeeded'
          ) {
            if (boundary === 'after-cursor') await transition(id, from, changes);
            blocked = true;
            return hang();
          }
          return transition(id, from, changes);
        });
      const r = await e.start(e.publish(def).loopId);
      if (nodeKind === 'wait') {
        await e.manager.waitForIdle();
        await e.manager.provideInput(r.id, 'accepted');
      }
      await vi.waitFor(() => expect(blocked).toBe(true));
      e.manager.stop();
      a.mockRestore();
      u.mockRestore();
      t.mockRestore();
      await recover(e);
      await recover(e);
      expect((await e.ports.runs.get(r.id))?.status).toBe('succeeded');
      expect(e.events(r.id).filter((x) => x.type === 'run.finished')).toHaveLength(1);
      expect(
        e.events(r.id).filter((x) => x.type === 'node.finished' && x.nodeId === 'target'),
      ).toHaveLength(1);
      expect(await e.ports.runs.getThread(r.id)).toEqual(
        replayThread((await e.ports.runs.getInitialThread(r.id))!, e.events(r.id)),
      );
    },
  );
});

describe('loop-back boundaries, recovered twice', () => {
  const boundaries = [
    'finish-return',
    'before-iteration',
    'iteration-return',
    'before-cursor',
    'after-cursor',
  ] as const;
  it.each(boundaries.flatMap((boundary) => [1, 2].map((cap) => ({ boundary, cap }))))(
    'cap $cap at $boundary',
    async ({ boundary, cap }) => {
      const e = await createTestEngine();
      const def = singleNodeLoop(
        `loop-${cap}-${boundary}`,
        {
          id: 'mut',
          kind: 'mutate',
          label: 'Mut',
          config: {
            operations: [
              {
                op: 'inject',
                position: 'end',
                messages: [{ role: 'user', content: 'one per iteration' }],
              },
            ],
          },
        },
        { default: 'loop-back', loopBack: { targetNodeId: 'mut' } },
      );
      def.settings = { maxIterations: cap };
      def.edges.push({ id: 'back', from: { node: 'done', port: 'loopBack' }, to: { node: 'mut' } });
      const append = e.ports.events.append.bind(e.ports.events);
      const update = e.ports.runs.update.bind(e.ports.runs);
      let blocked = false;
      const a = vi
        .spyOn(e.ports.events, 'append')
        .mockImplementation(async (id, drafts, options) => {
          const increment = drafts.some((d) => d.type === 'iteration.incremented');
          if (cap === 2 && boundary === 'before-iteration' && increment) {
            blocked = true;
            return hang();
          }
          const out = await append(id, drafts, options);
          if (
            (cap === 1 || boundary === 'finish-return') &&
            drafts.some((d) => d.type === 'node.finished' && d.nodeId === 'done')
          ) {
            blocked = true;
            return hang();
          }
          if (boundary === 'iteration-return' && increment) {
            blocked = true;
            return hang();
          }
          return out;
        });
      const u = vi.spyOn(e.ports.runs, 'update').mockImplementation(async (id, changes) => {
        if (
          cap === 2 &&
          changes.iteration === 2 &&
          (boundary === 'before-cursor' || boundary === 'after-cursor')
        ) {
          if (boundary === 'after-cursor') await update(id, changes);
          blocked = true;
          return hang();
        }
        return update(id, changes);
      });
      const r = await e.start(e.publish(def).loopId);
      await vi.waitFor(() => expect(blocked).toBe(true));
      e.manager.stop();
      a.mockRestore();
      u.mockRestore();
      await recover(e);
      await recover(e);
      expect(await e.ports.runs.get(r.id)).toMatchObject({ status: 'exhausted', iteration: cap });
      expect(e.eventTypes(r.id).filter((x) => x === 'iteration.incremented')).toHaveLength(cap - 1);
      expect((await e.ports.runs.getThread(r.id))?.messages).toHaveLength(cap);
    },
  );

  it('a self-targeted loop-back does not increment twice after its cursor commit', async () => {
    const e = await createTestEngine();
    const def = minimalLoop();
    def.settings = { maxIterations: 3 };
    def.nodes[1] = {
      id: 'done',
      kind: 'exit',
      label: 'Done',
      config: { default: 'loop-back', loopBack: { targetNodeId: 'done' } },
    };
    def.edges.push({ id: 'self', from: { node: 'done', port: 'loopBack' }, to: { node: 'done' } });
    const update = e.ports.runs.update.bind(e.ports.runs);
    let blocked = false;
    const spy = vi.spyOn(e.ports.runs, 'update').mockImplementation(async (id, changes) => {
      const out = await update(id, changes);
      if (changes.iteration === 2) {
        blocked = true;
        return hang();
      }
      return out;
    });
    const r = await e.start(e.publish(def).loopId);
    await vi.waitFor(() => expect(blocked).toBe(true));
    e.manager.stop();
    spy.mockRestore();
    await recover(e);
    expect(await e.ports.runs.get(r.id)).toMatchObject({ status: 'exhausted', iteration: 3 });
    expect(e.eventTypes(r.id).filter((x) => x === 'iteration.incremented')).toHaveLength(2);
  });
});

describe('wakes across crashes (review finding 4)', () => {
  it('an accepted input survives two crashes before its node finishes', async () => {
    const e = await createTestEngine();
    const r = await e.runToIdle(e.publish(inputLoop()).loopId);
    e.manager.stop();
    await e.manager.provideInput(r.id, 'keep me');
    const append = e.ports.events.append.bind(e.ports.events);
    let blocked = false;
    // The first recovery dies right after its run.started marker.
    const spy = vi
      .spyOn(e.ports.events, 'append')
      .mockImplementation(async (id, drafts, options) => {
        const result = await append(id, drafts, options);
        if (drafts.some((d) => d.type === 'run.started')) {
          blocked = true;
          return hang();
        }
        return result;
      });
    const first = new RunManager(e.ports, e.settings);
    await first.start();
    await vi.waitFor(() => expect(blocked).toBe(true));
    first.stop();
    spy.mockRestore();
    const second = await recover(e);
    expect((await second.getRun(r.id))?.status).toBe('succeeded');
    expect((await second.getThread(r.id))?.outputs['wait']?.value).toBe('keep me');
  });

  it.each(['before', 'after'] as const)(
    'a crash %s the waiting-to-running write keeps the durable input',
    async (when) => {
      const e = await createTestEngine();
      const r = await e.runToIdle(e.publish(inputLoop('claim-gap')).loopId);
      const transition = e.ports.runs.transition.bind(e.ports.runs);
      let blocked = false;
      const spy = vi
        .spyOn(e.ports.runs, 'transition')
        .mockImplementation(async (id, from, changes) => {
          if (from.includes('waiting') && changes.status === 'running') {
            if (when === 'after') await transition(id, from, changes);
            blocked = true;
            return hang();
          }
          return transition(id, from, changes);
        });
      void e.manager.provideInput(r.id, 'accepted');
      await vi.waitFor(() => expect(blocked).toBe(true));
      e.manager.stop();
      spy.mockRestore();
      const recovered = await recover(e);
      expect((await recovered.getRun(r.id))?.status).toBe('succeeded');
      expect((await recovered.getThread(r.id))?.outputs['wait']?.value).toBe('accepted');
      expect(e.eventTypes(r.id).filter((t) => t === 'input.received')).toHaveLength(1);
    },
  );

  it('a wake retries when another event lands between its read and its append', async () => {
    const e = await createTestEngine();
    const r = await e.runToIdle(e.publish(inputLoop('busy-log')).loopId);
    const append = e.ports.events.append.bind(e.ports.events);
    let raced = false;
    vi.spyOn(e.ports.events, 'append').mockImplementation(async (id, drafts, options) => {
      if (!raced && options?.expectedLastSeq !== undefined) {
        raced = true;
        await append(id, [{ type: 'signal.received', name: 'noise', payload: null }]);
      }
      return append(id, drafts, options);
    });
    await e.manager.provideInput(r.id, 'late');
    expect((await e.settle(r.id)).status).toBe('succeeded');
    expect(e.eventTypes(r.id).filter((t) => t === 'run.woken')).toHaveLength(1);
  });
});

describe('terminal transitions across crashes (review finding 5)', () => {
  it('an exit keeps the result it computed before its completion was recorded', async () => {
    const e = await createTestEngine();
    const def = minimalLoop();
    def.nodes[1] = {
      id: 'done',
      kind: 'exit',
      label: 'Done',
      config: { return: { mapping: 'counters.nodeVisits.done', channels: [{ kind: 'caller' }] } },
    };
    const transition = e.ports.runs.transition.bind(e.ports.runs);
    let blocked = false;
    const spy = vi.spyOn(e.ports.runs, 'transition').mockImplementation((id, from, changes) => {
      if (changes.status === 'succeeded') {
        blocked = true;
        return hang();
      }
      return transition(id, from, changes);
    });
    const r = await e.start(e.publish(def).loopId);
    await vi.waitFor(() => expect(blocked).toBe(true));
    e.manager.stop();
    spy.mockRestore();
    const recovered = await recover(e);
    expect(await recovered.getRun(r.id)).toMatchObject({ status: 'succeeded', result: 1 });
    expect(e.eventTypes(r.id).filter((t) => t === 'run.finished')).toHaveLength(1);
    expect(
      e.events(r.id).filter((x) => x.type === 'node.started' && x.nodeId === 'done'),
    ).toHaveLength(1);
  });

  it('a recovered finish delivers returns only when none were recorded, and wakes the parent', async () => {
    const e = await createTestEngine({ maxConcurrentRuns: 2 });
    const childDef = minimalLoop();
    childDef.nodes[1] = {
      id: 'done',
      kind: 'exit',
      label: 'Done',
      config: { return: { mapping: '7', channels: [{ kind: 'log' }] } },
    };
    const child = e.publish(childDef);
    const parent = e.publish(subLoop('finish-parent', child.loopId));
    const transition = e.ports.runs.transition.bind(e.ports.runs);
    let blocked = false;
    const spy = vi.spyOn(e.ports.runs, 'transition').mockImplementation((id, from, changes) => {
      if (changes.status === 'succeeded' && changes.result === 7) {
        blocked = true;
        return hang();
      }
      return transition(id, from, changes);
    });
    const r = await e.start(parent.loopId);
    await vi.waitFor(() => expect(blocked).toBe(true));
    e.manager.stop();
    spy.mockRestore();
    await recover(e);
    const [kid] = await e.ports.runs.listChildren(r.id);
    expect(kid).toMatchObject({ status: 'succeeded', result: 7 });
    expect(e.ports.delivery.logged).toHaveLength(1);
    expect((await e.ports.runs.get(r.id))?.status).toBe('succeeded');
  });

  it.each(['failed', 'cancelled'] as const)(
    'a %s event whose status write was lost is completed at recovery',
    async (status) => {
      const e = await createTestEngine();
      const r = await e.runToIdle(e.publish(inputLoop(`lost-${status}`)).loopId);
      e.manager.stop();
      await e.ports.events.append(r.id, [
        status === 'failed'
          ? {
              type: 'run.failed',
              failure: { code: 'INTERNAL_ERROR', message: 'boom', resumable: false },
            }
          : { type: 'run.cancelled' },
      ]);
      const recovered = await recover(e);
      expect((await recovered.getRun(r.id))?.status).toBe(status);
      expect(e.eventTypes(r.id).filter((t) => t === `run.${status}`)).toHaveLength(1);
    },
  );

  it('cancel after pause records one intent and one terminal event', async () => {
    const e = await createTestEngine();
    const r = await e.runToIdle(e.publish(inputLoop()).loopId);
    await e.manager.pause(r.id);
    await Promise.all([e.manager.cancel(r.id), e.manager.cancel(r.id)]);
    expect((await e.ports.runs.get(r.id))?.status).toBe('cancelled');
    expect(e.eventTypes(r.id).filter((x) => x === 'run.cancel_requested')).toHaveLength(1);
    expect(e.eventTypes(r.id).filter((x) => x === 'run.cancelled')).toHaveLength(1);
  });
});

describe('subloops (review finding 3)', () => {
  it('pausing while the parent parks and resuming keeps the original child', async () => {
    const e = await createTestEngine({ maxConcurrentRuns: 2 });
    const cv = e.publish(inputLoop('kid'));
    const pv = e.publish(subLoop('pause-parent', cv.loopId));
    const transition = e.ports.runs.transition.bind(e.ports.runs);
    let once = true;
    vi.spyOn(e.ports.runs, 'transition').mockImplementation(async (id, from, changes) => {
      if (once && changes.waiting?.kind === 'child') {
        once = false;
        await e.manager.pause(id);
      }
      return transition(id, from, changes);
    });
    const r = await e.runToIdle(pv.loopId);
    expect(r.status).toBe('paused');
    expect(await e.ports.runs.listChildren(r.id)).toHaveLength(1);
    expect((await e.manager.resume(r.id)).status).toBe('waiting');
    await e.manager.waitForIdle();
    const [kid] = await e.ports.runs.listChildren(r.id);
    expect(await e.ports.runs.listChildren(r.id)).toHaveLength(1);
    await e.manager.provideInput(kid!.id, 'done');
    expect((await e.settle(r.id)).status).toBe('succeeded');
  });

  it('a child that finished while its parent was paused is delivered on resume', async () => {
    const e = await createTestEngine({ maxConcurrentRuns: 2 });
    const cv = e.publish(inputLoop('paused-kid'));
    const r = await e.runToIdle(e.publish(subLoop('paused-parent', cv.loopId)).loopId);
    await e.manager.pause(r.id);
    const [kid] = await e.ports.runs.listChildren(r.id);
    await e.manager.provideInput(kid!.id, 'finished meanwhile');
    await e.manager.waitForIdle();
    expect((await e.ports.runs.get(r.id))?.status).toBe('paused');
    await e.manager.resume(r.id);
    expect((await e.settle(r.id)).status).toBe('succeeded');
  });

  it.each(['active', 'finished'] as const)(
    'a crash after the child started and before the park reuses the %s child',
    async (state) => {
      const e = await createTestEngine({ maxConcurrentRuns: 2 });
      const cv = e.publish(state === 'active' ? inputLoop('crash-kid') : minimalLoop());
      const pv = e.publish(subLoop(`crash-parent-${state}`, cv.loopId));
      const append = e.ports.events.append.bind(e.ports.events);
      let blocked = false;
      const spy = vi
        .spyOn(e.ports.events, 'append')
        .mockImplementation(async (id, drafts, options) => {
          const out = await append(id, drafts, options);
          if (drafts.some((d) => d.type === 'child_run.started')) {
            blocked = true;
            return hang();
          }
          return out;
        });
      const r = await e.start(pv.loopId);
      await vi.waitFor(() => expect(blocked).toBe(true));
      const [kid] = await e.ports.runs.listChildren(r.id);
      // Let the child reach its own resting state before the parent's process "dies".
      await vi.waitFor(async () =>
        expect((await e.ports.runs.get(kid!.id))?.status).toBe(
          state === 'active' ? 'waiting' : 'succeeded',
        ),
      );
      e.manager.stop();
      spy.mockRestore();
      const recovered = new RunManager(e.ports, e.settings);
      await recovered.start();
      await recovered.waitForIdle();
      if (state === 'active') {
        expect((await recovered.getRun(r.id))?.status).toBe('waiting');
        await recovered.provideInput(kid!.id, 'go');
        await recovered.waitForIdle();
      }
      recovered.stop();
      expect(await e.ports.runs.listChildren(r.id)).toHaveLength(1);
      expect((await e.ports.runs.get(r.id))?.status).toBe('succeeded');
    },
  );

  it('two sequential subloops produce exactly two children and two wakes', async () => {
    const e = await createTestEngine({ maxConcurrentRuns: 2 });
    const cv = e.publish(minimalLoop());
    const def = subLoop('sequential', cv.loopId);
    def.nodes.push({
      id: 'sub2',
      kind: 'subloop',
      label: 'Sub 2',
      config: { loopRef: { loopId: cv.loopId } },
    });
    def.edges[1]!.to.node = 'sub2';
    def.edges.push({ id: 'end', from: { node: 'sub2', port: 'out' }, to: { node: 'done' } });
    const r = await e.runToIdle(e.publish(def).loopId);
    expect(r.status).toBe('succeeded');
    expect(await e.ports.runs.listChildren(r.id)).toHaveLength(2);
    expect(e.events(r.id).filter((x) => x.type === 'run.woken')).toHaveLength(2);
  });

  it('a child finishing after the park commits but before reconciliation wakes once', async () => {
    const e = await createTestEngine({ maxConcurrentRuns: 2 });
    const cv = e.publish(inputLoop('after-park-child'));
    const pv = e.publish(subLoop('after-park-parent', cv.loopId));
    const transition = e.ports.runs.transition.bind(e.ports.runs);
    let sawRace = false;
    vi.spyOn(e.ports.runs, 'transition').mockImplementation(async (id, from, changes) => {
      const parked = await transition(id, from, changes);
      if (changes.status === 'waiting' && changes.waiting?.kind === 'child') {
        const child = changes.waiting.childRunId!;
        await vi.waitFor(async () =>
          expect((await e.manager.getRun(child))?.status).toBe('waiting'),
        );
        await e.manager.provideInput(child, 'fast');
        await vi.waitFor(async () =>
          expect((await e.manager.getRun(child))?.status).toBe('succeeded'),
        );
        sawRace = true;
      }
      return parked;
    });
    const r = await e.runToIdle(pv.loopId);
    expect(sawRace).toBe(true);
    expect(r.status).toBe('succeeded');
    expect(e.eventTypes(r.id).filter((x) => x === 'run.woken')).toHaveLength(1);
  });
});

describe('thread checkpoints (review finding 9)', () => {
  async function waitingRun(e: TestEngine) {
    return e.runToIdle(e.publish(inputLoop('checkpoint')).loopId);
  }

  it('resumes from a verified checkpoint and replays only the events after it', async () => {
    const e = await createTestEngine();
    const r = await waitingRun(e);
    const checkpoint = (await e.ports.runs.getThreadCheckpoint(r.id))!;
    expect(checkpoint.seq).toBe(e.events(r.id).at(-1)?.seq);
    // A marker only the checkpoint carries: it survives only if the checkpoint is used.
    await e.ports.runs.saveThread(
      r.id,
      { ...checkpoint.thread, vars: { ...checkpoint.thread.vars, marker: true } },
      checkpoint.seq,
    );
    await e.manager.provideInput(r.id, 'go');
    await e.settle(r.id);
    expect((await e.ports.runs.getThread(r.id))?.vars['marker']).toBe(true);
  });

  it.each(['ahead of the log', 'without a seq'] as const)(
    'ignores a checkpoint %s and replays from the initial thread',
    async (kind) => {
      const e = await createTestEngine();
      const r = await waitingRun(e);
      const checkpoint = (await e.ports.runs.getThreadCheckpoint(r.id))!;
      await e.ports.runs.saveThread(
        r.id,
        { ...checkpoint.thread, vars: { marker: true } },
        kind === 'without a seq' ? undefined : checkpoint.seq + 100,
      );
      expect(await e.ports.runs.getThreadCheckpoint(r.id)).toEqual(
        kind === 'without a seq' ? undefined : expect.anything(),
      );
      await e.manager.provideInput(r.id, 'go');
      await e.settle(r.id);
      expect((await e.ports.runs.getThread(r.id))?.vars['marker']).toBeUndefined();
      expect(await e.ports.runs.getThread(r.id)).toEqual(
        replayThread((await e.ports.runs.getInitialThread(r.id))!, e.events(r.id)),
      );
    },
  );

  it('a duplicate completion straddling the checkpoint matches a full replay (review probe)', async () => {
    const e = await createTestEngine();
    const def = inputLoop('straddle');
    def.nodes.push({
      id: 'mutate',
      kind: 'mutate',
      label: 'M',
      config: {
        operations: [
          { op: 'inject', position: 'end', messages: [{ role: 'user', content: 'once' }] },
        ],
      },
    });
    def.edges[0]!.to.node = 'mutate';
    def.edges.push({ id: 'mw', from: { node: 'mutate', port: 'out' }, to: { node: 'wait' } });
    const save = e.ports.runs.saveThread.bind(e.ports.runs);
    let blocked = false;
    let runId = '';
    // Crash right after the checkpoint for the mutate completion is written.
    const spy = vi.spyOn(e.ports.runs, 'saveThread').mockImplementation(async (id, thread, seq) => {
      await save(id, thread, seq);
      if (thread.messages.length === 1 && !blocked) {
        runId = id;
        blocked = true;
        return hang();
      }
    });
    await e.start(e.publish(def).loopId);
    await vi.waitFor(() => expect(blocked).toBe(true));
    e.manager.stop();
    spy.mockRestore();
    // The same completion is recorded a second time, after the checkpoint.
    const completion = e.events(runId).findLast((x) => x.type === 'node.finished')!;
    await e.ports.events.append(runId, [completion]);
    await recover(e);
    const full = replayThread((await e.ports.runs.getInitialThread(runId))!, e.events(runId));
    expect(full.messages).toHaveLength(1);
    expect(await e.ports.runs.getThread(runId)).toEqual(full);
  });

  it('a long log resumes from its checkpoint (10,000 completions)', async () => {
    const e = await createTestEngine();
    const r = await waitingRun(e);
    const drafts = Array.from({ length: 10_000 }, (_, i) => [
      {
        type: 'node.started' as const,
        nodeId: 'historic',
        kind: 'mutate' as const,
        attempt: 1,
        configHash: 'h',
      },
      {
        type: 'node.finished' as const,
        nodeId: 'historic',
        route: 'out',
        durationMs: 0,
        patch: [
          {
            op: 'add' as const,
            path: '/messages/-',
            value: {
              id: String(i),
              role: 'user',
              content: 'x'.repeat(128),
              nodeId: 'historic',
              ts: e.ports.clock.now().toISOString(),
              tags: [],
            },
          },
        ],
      },
    ]);
    // History before the park: the run then parks again on the same wait.
    const stored = await e.ports.events.append(r.id, [
      ...drafts.flat(),
      { type: 'run.waiting', nodeId: 'wait', wait: r.waiting! },
    ]);
    const thread = replayThread((await e.ports.runs.getInitialThread(r.id))!, e.events(r.id));
    await e.ports.runs.saveThread(r.id, thread, stored.at(-1)!.seq);
    const started = performance.now();
    await e.manager.provideInput(r.id, 'go');
    expect((await e.settle(r.id)).status).toBe('succeeded');
    const elapsed = performance.now() - started;
    expect(await e.ports.runs.getThread(r.id)).toEqual(
      replayThread((await e.ports.runs.getInitialThread(r.id))!, e.events(r.id)),
    );
    // Generous: the point is that it does not replay 10,000 patches (seconds), not a benchmark.
    expect(elapsed).toBeLessThan(2_000);
  }, 30_000);
});

describe('wake and timer edges', () => {
  it('a timer armed by an earlier wait cannot wake a later one; legacy keys still wake', async () => {
    const e = await createTestEngine();
    const r = await e.runToIdle(
      e.publish(
        singleNodeLoop('stale-key', {
          id: 'wait',
          kind: 'wait',
          label: 'W',
          config: { mode: 'duration', seconds: 1 },
        }),
      ).loopId,
    );
    const seq = r.waiting!.startedSeq!;
    await e.ports.timers.fire(r.id, `timer@${seq + 100}`);
    expect((await e.ports.runs.get(r.id))?.status).toBe('waiting');
    await e.ports.timers.fire(r.id, 'timer');
    expect((await e.settle(r.id)).status).toBe('succeeded');
  });

  it('a wake fails cleanly when the log shows no parked wait, or keeps changing', async () => {
    const e = await createTestEngine();
    const r = await e.runToIdle(e.publish(inputLoop('wake-edges')).loopId);
    const append = e.ports.events.append.bind(e.ports.events);
    const always = vi
      .spyOn(e.ports.events, 'append')
      .mockImplementation((id, drafts, options) =>
        options?.expectedLastSeq !== undefined
          ? Promise.reject(new AppendConflictError(id, options.expectedLastSeq, 0))
          : append(id, drafts, options),
      );
    await expect(e.manager.provideInput(r.id, 1)).rejects.toThrow(/kept changing/);
    always.mockImplementation((id, drafts, options) =>
      options?.expectedLastSeq !== undefined
        ? Promise.reject(new Error('disk full'))
        : append(id, drafts, options),
    );
    await expect(e.manager.provideInput(r.id, 1)).rejects.toThrow('disk full');
    always.mockRestore();
    // A durable wake already sits in the log: the run is not waiting for another.
    await e.ports.events.append(r.id, [{ type: 'run.woken', nodeId: 'wait', reason: 'manual' }]);
    await expect(e.manager.provideInput(r.id, 1)).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('a wake that loses the status race to a pause stays in the log for resume', async () => {
    const e = await createTestEngine();
    const r = await e.runToIdle(e.publish(inputLoop('wake-pause')).loopId);
    const transition = e.ports.runs.transition.bind(e.ports.runs);
    const spy = vi
      .spyOn(e.ports.runs, 'transition')
      .mockImplementation(async (id, from, changes) => {
        if (changes.status === 'running' && from.includes('waiting')) {
          await e.manager.pause(id);
        }
        return transition(id, from, changes);
      });
    const paused = await e.manager.provideInput(r.id, 'kept');
    spy.mockRestore();
    expect(paused.status).toBe('paused');
    expect((await e.manager.resume(r.id)).status).toBe('running');
    const done = await e.settle(r.id);
    expect(done.status).toBe('succeeded');
    expect((await e.manager.getThread(r.id))?.outputs['wait']?.value).toBe('kept');
  });

  it('a timer wake that fails for another reason is reported, not swallowed', async () => {
    const e = await createTestEngine();
    const r = await e.runToIdle(
      e.publish(
        singleNodeLoop('wake-error', {
          id: 'wait',
          kind: 'wait',
          label: 'W',
          config: { mode: 'duration', seconds: 1 },
        }),
      ).loopId,
    );
    vi.spyOn(e.ports.events, 'read').mockRejectedValueOnce(new Error('read failed'));
    await expect(e.ports.timers.fire(r.id, `timer@${r.waiting!.startedSeq}`)).rejects.toThrow(
      'read failed',
    );
    expect((await e.ports.runs.get(r.id))?.status).toBe('waiting');
  });

  it('recovery re-arms a wait spec written before wait identities and timeoutAt', async () => {
    const e = await createTestEngine();
    const r = await e.runToIdle(e.publish(inputLoop('legacy-spec')).loopId);
    e.manager.stop();
    const until = '2026-10-02T12:05:00.000Z';
    const startedSeq = r.waiting!.startedSeq!;
    await e.ports.runs.update(r.id, { waiting: { nodeId: 'wait', kind: 'input', until } });
    // Strip the identity from the logged wait too, as a log from before identities would be.
    for (const event of e.events(r.id))
      if (event.type === 'run.waiting') delete event.wait.startedSeq;
    await e.ports.timers.schedule(r.id, 'timeout', new Date(until));
    await recover(e);
    // The identity is derived from the log, the record updated, and the bare key replaced.
    expect((await e.ports.runs.get(r.id))?.waiting?.startedSeq).toBe(startedSeq);
    expect(e.ports.timers.scheduled).toEqual([
      { runId: r.id, key: `timeout@${startedSeq}`, at: new Date(until) },
    ]);
  });

  it('a bare timeout from before an upgrade cannot wake a later wait (review probe)', async () => {
    const e = await createTestEngine();
    e.manager.stop();
    const def = singleNodeLoop('legacy-timer', {
      id: 'sleep',
      kind: 'wait',
      label: 'S',
      config: { mode: 'duration', seconds: 1, timeoutSeconds: 2 },
    });
    def.nodes.push({
      id: 'input',
      kind: 'wait',
      label: 'I',
      config: { mode: 'input', prompt: '?' },
    });
    def.edges[1]!.to.node = 'input';
    def.edges.push({ id: 'end', from: { node: 'input', port: 'out' }, to: { node: 'done' } });
    let manager = new RunManager(e.ports, e.settings);
    await manager.start();
    const r = await manager.startRun({
      loopId: e.publish(def).loopId,
      ownerId: 'local',
      source: 'manual.api',
    });
    await manager.waitForIdle();
    manager.stop();
    // Make the parked duration wait look pre-upgrade: no identity, no timeoutAt, bare keys.
    const wait = { ...(await manager.getRun(r.id))!.waiting! };
    delete wait.startedSeq;
    delete wait.timeoutAt;
    await e.ports.runs.update(r.id, { waiting: wait });
    for (const event of e.events(r.id)) {
      if (event.type === 'run.waiting') {
        delete event.wait.startedSeq;
        delete event.wait.timeoutAt;
      }
    }
    await e.ports.timers.cancel(r.id);
    await e.ports.timers.schedule(r.id, 'timer', new Date('2026-10-02T12:00:01Z'));
    await e.ports.timers.schedule(r.id, 'timeout', new Date('2026-10-02T12:00:02Z'));
    manager = new RunManager(e.ports, e.settings);
    await manager.start();
    e.ports.clock.advance(3000);
    // The re-keyed timer fires; then the old bare timeout, delivered late, must do nothing.
    await e.ports.timers.fireDue(e.ports.clock.now());
    await manager.waitForIdle();
    await e.ports.timers.fire(r.id, 'timeout');
    await manager.waitForIdle();
    manager.stop();
    expect(await manager.getRun(r.id)).toMatchObject({
      status: 'waiting',
      waiting: { nodeId: 'input', kind: 'input' },
    });
  });

  it('a recovered durable wake whose status write lost to a pause waits for resume', async () => {
    const e = await createTestEngine();
    const r = await e.runToIdle(e.publish(inputLoop('recover-paused')).loopId);
    e.manager.stop();
    await e.ports.events.append(r.id, [
      { type: 'run.woken', nodeId: 'wait', reason: 'input', payload: 'x' },
    ]);
    const transition = e.ports.runs.transition.bind(e.ports.runs);
    const spy = vi
      .spyOn(e.ports.runs, 'transition')
      .mockImplementation((id, from, changes) =>
        changes.status === 'running' ? Promise.resolve(undefined) : transition(id, from, changes),
      );
    await recover(e);
    spy.mockRestore();
    expect((await e.ports.runs.get(r.id))?.status).toBe('waiting');
  });

  it('deletes a loop atomically with run creation (review probe)', async () => {
    const e = await createTestEngine({ maxConcurrentRuns: 2 });
    const child = e.publish(minimalLoop());
    const parentDef = inputLoop('delete-race-parent');
    parentDef.nodes.push({
      id: 'sub',
      kind: 'subloop',
      label: 'Sub',
      config: { loopRef: { loopId: child.loopId } },
    });
    parentDef.edges[1]!.to.node = 'sub';
    parentDef.edges.push({ id: 's', from: { node: 'sub', port: 'out' }, to: { node: 'done' } });
    const parent = e.publish(parentDef);
    // A parent started while the deletion is in progress waits for it, then finds no version
    // to pin: it never pins a version the deletion removes underneath it.
    let started: Promise<unknown> | undefined;
    const deleted = await e.manager.deleteLoopUnlessInUse(child.loopId, async () => {
      started = e.start(parent.loopId);
      await new Promise((resolve) => setTimeout(resolve, 10));
      e.ports.loops.versions.delete(child.id);
    });
    expect(deleted).toBe(true);
    const run = (await started) as { id: string };
    expect(e.events(run.id)[0]).not.toHaveProperty('subloopVersions');
    await e.settle(run.id);
    await e.manager.provideInput(run.id, null);
    expect((await e.settle(run.id)).failure?.code).toBe('SUBLOOP_NOT_FOUND');
    // The other order: a parent pinned first makes the deletion refuse, and remove never runs.
    const other = e.publish(minimalLoop(), { loopId: e.loopId('kept-child') });
    const keeper = inputLoop('keeper-parent');
    keeper.nodes.push({
      id: 'sub',
      kind: 'subloop',
      label: 'Sub',
      config: { loopRef: { loopId: other.loopId } },
    });
    keeper.edges[1]!.to.node = 'sub';
    keeper.edges.push({ id: 's', from: { node: 'sub', port: 'out' }, to: { node: 'done' } });
    await e.runToIdle(e.publish(keeper).loopId);
    const remove = vi.fn(() => Promise.resolve());
    expect(await e.manager.deleteLoopUnlessInUse(other.loopId, remove)).toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });

  it('knows which loops active runs can still reach', async () => {
    const e = await createTestEngine({ maxConcurrentRuns: 2 });
    const leaf = e.publish(minimalLoop());
    const numbered = e.publish({ ...minimalLoop(), name: 'numbered' });
    const middle = subLoop('middle', leaf.loopId);
    middle.nodes.push({
      id: 'pinned',
      kind: 'subloop',
      label: 'Numbered',
      config: { loopRef: { loopId: numbered.loopId, version: 1 } },
    });
    middle.edges[1]!.to.node = 'pinned';
    middle.edges.push({ id: 'p', from: { node: 'pinned', port: 'out' }, to: { node: 'done' } });
    const mv = e.publish(middle);
    const unrelated = e.publish({ ...minimalLoop(), name: 'unrelated' });
    const parentDef = inputLoop('in-use-parent');
    parentDef.nodes.push({
      id: 'sub',
      kind: 'subloop',
      label: 'Sub',
      config: { loopRef: { loopId: mv.loopId } },
    });
    parentDef.edges[1]!.to.node = 'sub';
    parentDef.edges.push({ id: 's', from: { node: 'sub', port: 'out' }, to: { node: 'done' } });
    const parent = e.publish(parentDef);
    expect(await e.manager.loopInUse(leaf.loopId)).toBe(false);
    const r = await e.runToIdle(parent.loopId);
    expect(r.status).toBe('waiting');
    expect(await e.manager.loopInUse(parent.loopId)).toBe(true);
    expect(await e.manager.loopInUse(mv.loopId)).toBe(true);
    expect(await e.manager.loopInUse(leaf.loopId)).toBe(true);
    expect(await e.manager.loopInUse(numbered.loopId)).toBe(true);
    expect(await e.manager.loopInUse(unrelated.loopId)).toBe(false);
    await e.manager.cancel(r.id);
    expect(await e.manager.loopInUse(leaf.loopId)).toBe(false);
  });
});

describe('pins and timers (review probes)', () => {
  /** start -> wait for input -> subloop of `loopId` -> done. */
  function parent(name: string, loopId: string) {
    const def = subLoop(name, loopId);
    def.nodes.push(inputLoop('unused').nodes[1]!);
    def.edges[0]!.to.node = 'wait';
    def.edges.push({ id: 'wait-sub', from: { node: 'wait', port: 'out' }, to: { node: 'sub' } });
    return def;
  }

  it.each(['timer', 'heartbeat'] as const)(
    'an expired %s re-arms at recovery and a timer of the wrong kind is ignored',
    async (kind) => {
      const e = await createTestEngine();
      const node: TestNode =
        kind === 'timer'
          ? { id: 'wait', kind: 'wait', label: 'Wait', config: { mode: 'duration', seconds: 1 } }
          : {
              id: 'wait',
              kind: 'heartbeat',
              label: 'Beat',
              config: { intervalSeconds: 1, until: 'beat >= 2' },
            };
      const r = await e.runToIdle(e.publish(singleNodeLoop(kind, node)).loopId);
      e.manager.stop();
      await e.ports.timers.cancel(r.id);
      e.ports.clock.advance(2000);
      const recovered = new RunManager(e.ports, e.settings);
      await recovered.start();
      expect(e.ports.timers.scheduled).toHaveLength(1);
      const seq = r.waiting!.startedSeq!;
      await e.ports.timers.fire(r.id, `${kind === 'timer' ? 'heartbeat' : 'timer'}@${seq}`);
      expect((await recovered.getRun(r.id))?.status).toBe('waiting');
      await e.ports.timers.fireDue(e.ports.clock.now());
      await recovered.waitForIdle();
      if (kind === 'heartbeat') {
        e.ports.clock.advance(2000);
        await e.ports.timers.fireDue(e.ports.clock.now());
        await recovered.waitForIdle();
      }
      recovered.stop();
      expect((await recovered.getRun(r.id))?.status).toBe('succeeded');
    },
  );

  it('a timer fire racing a cancel leaves one cancelled outcome', async () => {
    const e = await createTestEngine();
    const r = await e.runToIdle(
      e.publish(
        singleNodeLoop('cancel-timer', {
          id: 'wait',
          kind: 'wait',
          label: 'Wait',
          config: { mode: 'duration', seconds: 1 },
        }),
      ).loopId,
    );
    await Promise.all([
      e.manager.cancel(r.id),
      e.ports.timers.fire(r.id, `timer@${r.waiting!.startedSeq}`),
    ]);
    await e.manager.waitForIdle();
    expect((await e.ports.runs.get(r.id))?.status).toBe('cancelled');
    expect(e.eventTypes(r.id).filter((x) => x === 'run.cancelled')).toHaveLength(1);
    expect(e.ports.timers.scheduled).toHaveLength(0);
  });

  it('two managers over the same stores both execute a queued run (single-manager restriction)', async () => {
    const e = await createTestEngine();
    e.manager.stop();
    const v = e.publish(
      singleNodeLoop('two-managers', {
        id: 'infer',
        kind: 'inference',
        label: 'I',
        config: { prompt: { template: 'hello' } },
      }),
    );
    await e.start(v.loopId);
    const a = new RunManager(e.ports, e.settings);
    const b = new RunManager(e.ports, e.settings);
    await Promise.all([a.start(), b.start()]);
    await Promise.all([a.waitForIdle(), b.waitForIdle()]);
    a.stop();
    b.stop();
    // Documented in docs/05 and 11: one run manager per store; there is no execution lease.
    expect(e.ports.harness.started.length).toBeGreaterThan(1);
  });

  it('a cyclic pin walk is finite and the run-time depth limit still applies', async () => {
    const e = await createTestEngine({ maxConcurrentRuns: 1 });
    const a = subLoop('a', e.loopId('b'));
    a.settings = { subloopDepthLimit: 2 };
    const b = subLoop('b', e.loopId('a'));
    b.settings = { subloopDepthLimit: 2 };
    const av = e.publish(a);
    const bv = e.publish(b);
    const r = await e.runToIdle(av.loopId);
    expect(e.events(r.id)[0]).toMatchObject({
      subloopVersions: { [av.loopId]: av.id, [bv.loopId]: bv.id },
    });
    const [kid] = await e.ports.runs.listChildren(r.id);
    const [grand] = await e.ports.runs.listChildren(kid!.id);
    expect(grand?.failure?.code).toBe('SUBLOOP_DEPTH_EXCEEDED');
  });

  it.each(['unpublished', 'deleted'] as const)(
    'a pinned child version %s before the child starts fails without falling back to latest',
    async (state) => {
      const e = await createTestEngine();
      const cv = e.publish(minimalLoop());
      const r = await e.runToIdle(e.publish(parent('pin-missing', cv.loopId)).loopId);
      e.publish(minimalLoop(), { loopId: cv.loopId, version: 2 });
      if (state === 'deleted') e.ports.loops.versions.delete(cv.id);
      else e.ports.loops.versions.set(cv.id, { ...cv, status: 'draft' });
      await e.manager.provideInput(r.id, null);
      const final = await e.settle(r.id);
      expect(final.status).toBe('failed');
      expect(final.failure?.code).toBe('SUBLOOP_NOT_FOUND');
      expect(await e.ports.runs.listChildren(r.id)).toHaveLength(0);
    },
  );

  it('a replay fork copies pins and fails at the subloop when the pinned version is gone', async () => {
    const e = await createTestEngine();
    const cv = e.publish(minimalLoop());
    const r = await e.runToIdle(e.publish(subLoop('fork-pins', cv.loopId)).loopId);
    e.ports.loops.versions.delete(cv.id);
    const fork = await e.manager.replay({ runId: r.id, nodeId: 'sub' });
    const final = await e.settle(fork.id);
    expect(e.events(fork.id)[0]).toMatchObject({ subloopVersions: { [cv.loopId]: cv.id } });
    expect(final.failure?.code).toBe('SUBLOOP_NOT_FOUND');
  });

  it('a log without pins resolves latest when the child starts', async () => {
    const e = await createTestEngine();
    const cv = e.publish(minimalLoop());
    const r = await e.runToIdle(e.publish(parent('old-log', cv.loopId)).loopId);
    const queued = e.events(r.id)[0];
    if (queued?.type === 'run.queued') delete queued.subloopVersions;
    const newer = e.publish(minimalLoop(), { loopId: cv.loopId, version: 2 });
    await e.manager.provideInput(r.id, null);
    await e.settle(r.id);
    expect((await e.ports.runs.listChildren(r.id))[0]?.versionId).toBe(newer.id);
  });
});

describe('deletion against replay and root resolution (fourth round)', () => {
  function parentOf(name: string, childLoopId: string) {
    const def = inputLoop(name);
    def.nodes.push({
      id: 'sub',
      kind: 'subloop',
      label: 'Sub',
      config: { loopRef: { loopId: childLoopId } },
    });
    def.edges[1]!.to.node = 'sub';
    def.edges.push({ id: 's', from: { node: 'sub', port: 'out' }, to: { node: 'done' } });
    return def;
  }

  it('a replay fork requested during a deletion registers only after it', async () => {
    const e = await createTestEngine({ maxConcurrentRuns: 2 });
    const child = e.publish(minimalLoop());
    const parent = e.publish(parentOf('replay-race', child.loopId));
    const source = await e.runToIdle(parent.loopId);
    await e.manager.provideInput(source.id, null);
    expect((await e.settle(source.id)).status).toBe('succeeded');
    let fork: Promise<{ id: string }> | undefined;
    let registeredDuring = true;
    const deleted = await e.manager.deleteLoopUnlessInUse(child.loopId, async () => {
      fork = e.manager.replay({ runId: source.id, nodeId: 'wait' });
      await new Promise((resolve) => setTimeout(resolve, 20));
      registeredDuring =
        (await e.ports.runs.listByStatus(['queued', 'running', 'waiting'])).length > 0;
      e.ports.loops.versions.delete(child.id);
    });
    expect(deleted).toBe(true);
    expect(registeredDuring).toBe(false);
    const forked = await fork!;
    await e.settle(forked.id);
    await e.manager.provideInput(forked.id, null);
    // Deletion won: the fork's pinned child is gone, so its subloop fails, as for any reference
    // to a deleted loop.
    expect((await e.settle(forked.id)).failure?.code).toBe('SUBLOOP_NOT_FOUND');
  });

  it('a replay fork registered first makes the deletion refuse', async () => {
    const e = await createTestEngine({ maxConcurrentRuns: 2 });
    const child = e.publish(minimalLoop());
    const parent = e.publish(parentOf('replay-first', child.loopId));
    const source = await e.runToIdle(parent.loopId);
    await e.manager.provideInput(source.id, null);
    await e.settle(source.id);
    const forked = await e.manager.replay({ runId: source.id, nodeId: 'wait' });
    expect((await e.settle(forked.id)).status).toBe('waiting');
    const remove = vi.fn(() => Promise.resolve());
    expect(await e.manager.deleteLoopUnlessInUse(child.loopId, remove)).toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });

  it('a run whose own version is deleted between resolution and registration is refused', async () => {
    const e = await createTestEngine();
    e.manager.stop();
    const target = e.publish(minimalLoop());
    let entered!: () => void;
    const enteredP = new Promise<void>((resolve) => (entered = resolve));
    let unblock!: () => void;
    const unblockP = new Promise<void>((resolve) => (unblock = resolve));
    const latest = e.ports.loops.getLatestPublished.bind(e.ports.loops);
    let once = true;
    vi.spyOn(e.ports.loops, 'getLatestPublished').mockImplementation(async (id) => {
      const out = await latest(id);
      if (id === target.loopId && once) {
        once = false;
        entered();
        await unblockP;
      }
      return out;
    });
    const start = e.start(target.loopId);
    await enteredP;
    expect(
      await e.manager.deleteLoopUnlessInUse(target.loopId, () => {
        e.ports.loops.versions.delete(target.id);
        return Promise.resolve();
      }),
    ).toBe(true);
    unblock();
    await expect(start).rejects.toMatchObject({ code: 'LOOP_NOT_FOUND' });
    expect(await e.ports.runs.listByStatus(['queued'])).toHaveLength(0);
  });
});
