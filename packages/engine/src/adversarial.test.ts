import { describe, expect, it, vi } from 'vitest';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { replayThread } from '@graphgoblin/domain';
import { RunManager } from './run-manager.js';
import { createTestEngine, singleNodeLoop } from './testing/scenario.js';
import { FakeStructured } from './testing/fakes.js';

const inputLoop = () =>
  singleNodeLoop('input', {
    id: 'wait',
    kind: 'wait',
    label: 'Input',
    config: { mode: 'input', prompt: '?' },
  });
const inferLoop = (config: Record<string, unknown> = {}) =>
  singleNodeLoop('infer', {
    id: 'infer',
    kind: 'inference',
    label: 'Infer',
    config: { prompt: { template: 'hello' }, ...config },
  });
const subLoop = (name: string, loopId: string, output: Record<string, unknown> = {}) =>
  singleNodeLoop(name, {
    id: 'child',
    kind: 'subloop',
    label: 'Child',
    config: { loopRef: { loopId }, output },
  });

describe('adversarial engine invariants', () => {
  it('1: queued pause, invalid resume, waiting cancel and terminal signals are typed', async () => {
    const e = await createTestEngine();
    e.manager.stop();
    const v = e.publish(inputLoop());
    const r = await e.start(v.loopId);
    await expect(e.manager.resume(r.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await e.manager.pause(r.id);
    await e.manager.start();
    await e.manager.resume(r.id);
    expect((await e.settle(r.id)).status).toBe('waiting');
    await Promise.all([e.manager.cancel(r.id), e.manager.cancel(r.id)]);
    expect(e.eventTypes(r.id).filter((t) => t === 'run.cancelled')).toHaveLength(1);
    await expect(e.manager.signal(r.id, 'late')).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(e.manager.resume(r.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('ADV-001: concurrent input records only the accepted input', async () => {
    const e = await createTestEngine();
    const v = e.publish(inputLoop());
    const r = await e.runToIdle(v.loopId);
    const results = await Promise.allSettled([
      e.manager.provideInput(r.id, 'A'),
      e.manager.provideInput(r.id, 'B'),
    ]);
    await e.settle(r.id);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(e.eventTypes(r.id).filter((t) => t === 'input.received')).toHaveLength(1);
    expect(e.eventTypes(r.id).filter((t) => t === 'run.finished')).toHaveLength(1);
  });

  it('ADV-002: recovery consumes a durable wake instead of parking again', async () => {
    const e = await createTestEngine();
    const v = e.publish(inputLoop());
    const r = await e.runToIdle(v.loopId);
    e.manager.stop();
    await e.manager.provideInput(r.id, { answer: 42 });
    const recovered = new RunManager(e.ports, e.settings);
    await recovered.start();
    await recovered.waitForIdle();
    recovered.stop();
    expect((await recovered.getRun(r.id))?.status).toBe('succeeded');
    expect((await recovered.getThread(r.id))?.outputs['wait']?.value).toEqual({ answer: 42 });
  });

  it('2: parked inference resumes its session once after manager replacement', async () => {
    const e = await createTestEngine();
    e.ports.harness.script([{ finalText: 'interrupted' }, { finalText: 'continued' }]);
    const start = e.ports.harness.start.bind(e.ports.harness);
    vi.spyOn(e.ports.harness, 'start').mockImplementation((request, signal) => ({
      ...start(request, signal),
      result: new Promise(() => undefined),
    }));
    const v = e.publish(inferLoop());
    const r = await e.start(v.loopId);
    await vi.waitFor(() => expect(e.eventTypes(r.id)).toContain('harness.session'));
    e.manager.stop();
    // A crash removes the old process. Freeze its unresolved turn; only the replacement may write.
    const recovered = new RunManager(e.ports, e.settings);
    await recovered.start();
    await recovered.waitForIdle();
    expect((await recovered.getRun(r.id))?.status).toBe('succeeded');
    expect(e.ports.harness.resumed).toHaveLength(1);
    expect(e.ports.harness.resumed[0]?.request.turn.prompt).toContain('interrupted');
    expect(await recovered.getThread(r.id)).toEqual(
      replayThread((await e.ports.runs.getInitialThread(r.id))!, e.events(r.id)),
    );
    expect(
      e
        .events(r.id)
        .filter((x) => x.type === 'node.started' && x.nodeId === 'infer')
        .map((x) => (x.type === 'node.started' ? x.attempt : 0)),
    ).toEqual([1, 2]);
    recovered.stop();
  });

  it('2/6: timer recovery does not duplicate timers and cancellation removes them', async () => {
    const e = await createTestEngine();
    const v = e.publish(
      singleNodeLoop('timer', {
        id: 'wait',
        kind: 'wait',
        label: 'Wait',
        config: { mode: 'duration', seconds: 60 },
      }),
    );
    const r = await e.runToIdle(v.loopId);
    e.manager.stop();
    const recovered = new RunManager(e.ports, e.settings);
    await recovered.start();
    await recovered.start();
    expect(e.ports.timers.scheduled).toHaveLength(1);
    await recovered.cancel(r.id);
    expect(e.ports.timers.scheduled).toHaveLength(0);
    recovered.stop();
  });

  it('ADV-016: recovery does not execute a node whose completion is already durable', async () => {
    const e = await createTestEngine();
    const v = e.publish(inferLoop());
    const update = e.ports.runs.update.bind(e.ports.runs);
    // Crash after node.finished is durable and before the cursor moves to the exit.
    const spy = vi.spyOn(e.ports.runs, 'update').mockImplementation((id, changes) => {
      if (changes.currentNodeId === 'done') return new Promise(() => undefined);
      return update(id, changes);
    });
    const r = await e.start(v.loopId);
    await vi.waitFor(() =>
      expect(e.events(r.id).some((x) => x.type === 'node.finished' && x.nodeId === 'infer')).toBe(
        true,
      ),
    );
    e.manager.stop();
    spy.mockRestore();
    const recovered = new RunManager(e.ports, e.settings);
    await recovered.start();
    await recovered.waitForIdle();
    recovered.stop();
    expect((await recovered.getRun(r.id))?.status).toBe('succeeded');
    expect(e.ports.harness.started).toHaveLength(1);
    expect(
      e.events(r.id).filter((x) => x.type === 'node.finished' && x.nodeId === 'infer'),
    ).toHaveLength(1);
  });

  it.each([true, false])(
    'ADV-016: a loop-back whose cursor write was lost resumes at its target (append returned=%s)',
    async (recorded) => {
      const e = await createTestEngine();
      const def = singleNodeLoop(
        'loop-crash',
        {
          id: 'mut',
          kind: 'mutate',
          label: 'Mut',
          config: { operations: [{ op: 'delete', path: '/vars/absent' }] },
        },
        { default: 'loop-back', loopBack: { targetNodeId: 'mut' } },
      );
      def.settings = { maxIterations: 2 };
      def.edges.push({ id: 'back', from: { node: 'done', port: 'loopBack' }, to: { node: 'mut' } });
      const v = e.publish(def);
      const update = e.ports.runs.update.bind(e.ports.runs);
      const append = e.ports.events.append.bind(e.ports.events);
      const hang = () => new Promise<never>(() => undefined);
      // The loop-back's node.finished and iteration.incremented are one append. Crash right after
      // it is stored (before the executor learns its seq), or after the run record's update was
      // issued but never applied.
      const appendSpy = vi
        .spyOn(e.ports.events, 'append')
        .mockImplementation(async (id, drafts) => {
          const stored = await append(id, drafts);
          if (!recorded && drafts.some((d) => d.type === 'iteration.incremented')) return hang();
          return stored;
        });
      const updateSpy = vi.spyOn(e.ports.runs, 'update').mockImplementation((id, changes) => {
        if (recorded && changes.iteration === 2) return hang();
        return update(id, changes);
      });
      const r = await e.start(v.loopId);
      await vi.waitFor(() =>
        expect(
          e.events(r.id).some((x) => x.type === 'node.finished' && x.route === 'loopBack'),
        ).toBe(true),
      );
      if (recorded)
        await vi.waitFor(() => expect(e.eventTypes(r.id)).toContain('iteration.incremented'));
      e.manager.stop();
      appendSpy.mockRestore();
      updateSpy.mockRestore();
      const recovered = new RunManager(e.ports, e.settings);
      await recovered.start();
      await recovered.waitForIdle();
      recovered.stop();
      const done = await recovered.getRun(r.id);
      expect(done).toMatchObject({ status: 'exhausted', iteration: 2 });
      expect(e.eventTypes(r.id).filter((t) => t === 'iteration.incremented')).toHaveLength(1);
      expect(
        e.events(r.id).filter((x) => x.type === 'node.finished' && x.nodeId === 'done'),
      ).toHaveLength(2);
      expect(
        e.events(r.id).filter((x) => x.type === 'node.started' && x.nodeId === 'mut'),
      ).toHaveLength(2);
    },
  );

  it('ADV-016: an exit whose run.finished was lost is evaluated again and finishes once', async () => {
    const e = await createTestEngine();
    const v = e.publish(inputLoop());
    const transition = e.ports.runs.transition.bind(e.ports.runs);
    const spy = vi.spyOn(e.ports.runs, 'transition').mockImplementation((id, from, changes) => {
      if (changes.status === 'succeeded') return new Promise(() => undefined);
      return transition(id, from, changes);
    });
    const r = await e.runToIdle(v.loopId);
    await e.manager.provideInput(r.id, 'go');
    await vi.waitFor(() =>
      expect(e.events(r.id).some((x) => x.type === 'node.finished' && x.nodeId === 'done')).toBe(
        true,
      ),
    );
    e.manager.stop();
    spy.mockRestore();
    const recovered = new RunManager(e.ports, e.settings);
    await recovered.start();
    await recovered.waitForIdle();
    recovered.stop();
    expect((await recovered.getRun(r.id))?.status).toBe('succeeded');
    expect(e.eventTypes(r.id).filter((t) => t === 'run.finished')).toHaveLength(1);
    expect(
      e.events(r.id).filter((x) => x.type === 'node.finished' && x.nodeId === 'wait'),
    ).toHaveLength(1);
  });

  it('ADV-003: snapshots equal event replay at every mutation boundary', async () => {
    const e = await createTestEngine();
    const v = e.publish(
      singleNodeLoop('mutations', {
        id: 'mut',
        kind: 'mutate',
        label: 'Mutate',
        config: {
          operations: [
            {
              op: 'inject',
              position: 'end',
              messages: [
                { role: 'user', content: 'secret hello' },
                { role: 'assistant', content: 'old' },
              ],
            },
            { op: 'truncate', keep: { first: 1 } },
            { op: 'redact', target: 'all', patterns: ['secret'], replacement: 'MASK' },
            { op: 'replace', target: 'messages', pattern: 'hello', replacement: 'world' },
            { op: 'set', path: '/vars/raw', value: { kind: 'literal', value: 'bad' } },
            {
              op: 'coerce',
              source: '/vars/raw',
              target: '/vars/fixed',
              jsonSchema: { type: 'number' },
              repair: { enabled: true, maxAttempts: 1 },
            },
          ],
        },
      }),
    );
    e.ports.structured = new FakeStructured(() => 42);
    const snapshots: unknown[] = [];
    const replayed: unknown[] = [];
    // Every checkpoint equals a replay of the log up to the seq it names.
    const save = e.ports.runs.saveThread.bind(e.ports.runs);
    vi.spyOn(e.ports.runs, 'saveThread').mockImplementation(async (id, thread, seq) => {
      if (seq !== undefined) {
        snapshots.push(thread);
        replayed.push(replayThread((await e.ports.runs.getInitialThread(id))!, e.events(id), seq));
      }
      return save(id, thread, seq);
    });
    const r = await e.runToIdle(v.loopId);
    expect(r.status).toBe('succeeded');
    expect(e.events(r.id).map((x) => x.seq)).toEqual(e.events(r.id).map((_, i) => i + 1));
    expect(snapshots.length).toBeGreaterThan(1);
    expect(snapshots).toEqual(replayed);
  });

  it.each(['result-only', 'merge', 'custom'] as const)(
    '3/5: subloop %s mapping creates missing result vars and replays',
    async (mode) => {
      const e = await createTestEngine({ maxConcurrentRuns: 1 });
      const child = minimalLoop();
      child.nodes[1] = {
        id: 'done',
        kind: 'exit',
        label: 'Done',
        config: { return: { mapping: '42', channels: [{ kind: 'caller' }] } },
      };
      const cv = e.publish(child);
      const output =
        mode === 'custom'
          ? { mode, custom: { patch: '[{"op":"add","path":"/vars/new","value":result}]' } }
          : { mode, resultTo: { var: 'new', lastOutput: true }, vars: { strategy: 'child-wins' } };
      const pv = e.publish(subLoop(`parent-${mode}`, cv.loopId, output));
      const r = await e.runToIdle(pv.loopId);
      expect(r.status).toBe('succeeded');
      const t = (await e.manager.getThread(r.id))!;
      expect(t.vars['new']).toBe(42);
      expect(t).toEqual(replayThread((await e.ports.runs.getInitialThread(r.id))!, e.events(r.id)));
    },
  );

  it.each([1, 2, 3])('4: maxIterations stops exactly at %i', async (maxIterations) => {
    const e = await createTestEngine();
    const def = singleNodeLoop(
      'limit',
      {
        id: 'mut',
        kind: 'mutate',
        label: 'Mut',
        config: { operations: [{ op: 'delete', path: '/vars/absent' }] },
      },
      { default: 'loop-back', loopBack: { targetNodeId: 'mut' } },
    );
    def.settings = { maxIterations };
    def.edges.push({ id: 'back', from: { node: 'done', port: 'loopBack' }, to: { node: 'mut' } });
    const r = await e.runToIdle(e.publish(def).loopId);
    expect(r.status).toBe('exhausted');
    expect(r.iteration).toBe(maxIterations);
    expect(
      e.events(r.id).filter((x) => x.type === 'node.started' && x.nodeId === 'mut'),
    ).toHaveLength(maxIterations);
  });

  it.each([false, true])(
    '4: recursive subloops terminate at depth limit (two-loop cycle=%s)',
    async (cycle) => {
      const e = await createTestEngine({ maxConcurrentRuns: 1 });
      const a = subLoop('a', e.loopId(cycle ? 'b' : 'a'));
      a.settings = { subloopDepthLimit: 2 };
      e.publish(a);
      if (cycle) {
        const b = subLoop('b', e.loopId('a'));
        b.settings = { subloopDepthLimit: 2 };
        e.publish(b);
      }
      const root = await e.runToIdle(e.loopId('a'));
      const children = await e.ports.runs.listChildren(root.id);
      const grandchildren = await e.ports.runs.listChildren(children[0]!.id);
      expect(children).toHaveLength(1);
      expect(grandchildren).toHaveLength(1);
      expect(grandchildren[0]?.failure?.code).toBe('SUBLOOP_DEPTH_EXCEEDED');
      expect(await e.ports.runs.listChildren(grandchildren[0]!.id)).toHaveLength(0);
    },
  );

  /** start -> wait for input -> subloop `child` (latest of `childLoopId`) -> done. */
  function waitThenChild(name: string, childLoopId: string): LoopDefinitionInput {
    const parent = subLoop(name, childLoopId);
    parent.nodes.push({
      id: 'wait',
      kind: 'wait',
      label: 'Wait',
      config: { mode: 'input', prompt: '?' },
    });
    parent.edges[0] = { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'wait' } };
    parent.edges.push({ id: 'w', from: { node: 'wait', port: 'out' }, to: { node: 'child' } });
    return parent;
  }

  it('ADV-004: latest subloop version is pinned at parent start', async () => {
    const e = await createTestEngine({ maxConcurrentRuns: 1 });
    const child = e.publish(minimalLoop());
    const r = await e.runToIdle(e.publish(waitThenChild('parent', child.loopId)).loopId);
    e.publish(minimalLoop(), { loopId: child.loopId, version: 2 });
    await e.manager.provideInput(r.id, null);
    expect((await e.settle(r.id)).status).toBe('succeeded');
    expect((await e.ports.runs.listChildren(r.id))[0]?.versionId).toBe(child.id);
    // A run created after the publish picks up the new version.
    const later = await e.runToIdle(e.loopId('parent'));
    await e.manager.provideInput(later.id, null);
    await e.settle(later.id);
    expect((await e.ports.runs.listChildren(later.id))[0]?.versionId).not.toBe(child.id);
  });

  it('ADV-004: pins reach grandchildren, replay forks, and recovery', async () => {
    const e = await createTestEngine({ maxConcurrentRuns: 2 });
    const leaf = e.publish(minimalLoop());
    const middle = e.publish(subLoop('middle', leaf.loopId));
    const root = await e.runToIdle(e.publish(waitThenChild('root', middle.loopId)).loopId);
    expect(e.events(root.id)[0]).toMatchObject({
      type: 'run.queued',
      subloopVersions: { [leaf.loopId]: leaf.id, [middle.loopId]: middle.id },
    });
    // Newer versions of both loops are published while the root waits.
    e.publish(minimalLoop(), { loopId: leaf.loopId, version: 2 });
    e.publish(subLoop('middle', leaf.loopId), { loopId: middle.loopId, version: 2 });
    // The process restarts before the input arrives.
    e.manager.stop();
    const recovered = new RunManager(e.ports, e.settings);
    await recovered.start();
    await recovered.provideInput(root.id, null);
    await recovered.waitForIdle();
    expect((await recovered.getRun(root.id))?.status).toBe('succeeded');
    const [mid] = await e.ports.runs.listChildren(root.id);
    expect(mid?.versionId).toBe(middle.id);
    expect((await e.ports.runs.listChildren(mid!.id))[0]?.versionId).toBe(leaf.id);
    // A replay fork at the subloop node reuses the source's pins.
    const fork = await recovered.replay({ runId: root.id, nodeId: 'child' });
    await recovered.waitForIdle();
    recovered.stop();
    expect((await recovered.getRun(fork.id))?.status).toBe('succeeded');
    expect(e.events(fork.id)[0]).toMatchObject({
      subloopVersions: { [leaf.loopId]: leaf.id, [middle.loopId]: middle.id },
    });
    expect((await e.ports.runs.listChildren(fork.id))[0]?.versionId).toBe(middle.id);
  });

  it.each(['log', 'file', 'webhook', 'event'] as const)(
    '5: failing %s delivery retains outcome and records failure',
    async (kind) => {
      const e = await createTestEngine();
      const fail = () => {
        throw new Error('delivery unavailable');
      };
      if (kind === 'file') vi.spyOn(e.ports.workspace, 'writeFile').mockImplementation(fail);
      if (kind === 'log') vi.spyOn(e.ports.delivery, 'log').mockImplementation(fail);
      if (kind === 'webhook') vi.spyOn(e.ports.delivery, 'webhook').mockImplementation(fail);
      if (kind === 'event') vi.spyOn(e.ports.delivery, 'publishEvent').mockImplementation(fail);
      const channel =
        kind === 'file'
          ? { kind, path: 'out.json' }
          : kind === 'webhook'
            ? { kind, url: 'https://example.invalid' }
            : kind === 'event'
              ? { kind, eventType: 'out' }
              : { kind };
      const v = e.publish(
        singleNodeLoop(
          'return',
          {
            id: 'mut',
            kind: 'mutate',
            label: 'Mut',
            config: { operations: [{ op: 'delete', path: '/vars/absent' }] },
          },
          { return: { mapping: '42', channels: [channel, { kind: 'caller' }] } },
        ),
      );
      const r = await e.runToIdle(v.loopId);
      expect(r).toMatchObject({ status: 'succeeded', result: 42 });
      expect(e.events(r.id).filter((x) => x.type === 'return.failed')).toMatchObject([
        { error: 'delivery unavailable' },
      ]);
      expect(e.eventTypes(r.id).filter((x) => x === 'run.finished')).toHaveLength(1);
    },
  );

  it('6: concurrent cancellation aborts an inference signal once', async () => {
    const e = await createTestEngine();
    e.ports.harness.script([{ delayMs: 60_000 }]);
    let aborts = 0;
    const start = e.ports.harness.start.bind(e.ports.harness);
    vi.spyOn(e.ports.harness, 'start').mockImplementation((req, signal) => {
      signal.addEventListener('abort', () => {
        aborts++;
      });
      return start(req, signal);
    });
    const r = await e.start(e.publish(inferLoop()).loopId);
    await vi.waitFor(() => expect(e.ports.harness.started).toHaveLength(1));
    await Promise.all([e.manager.cancel(r.id), e.manager.cancel(r.id)]);
    expect((await e.settle(r.id)).status).toBe('cancelled');
    expect(aborts).toBe(1);
    expect(e.ports.harness.cancelled).toHaveLength(1);
  });

  it('ADV-012: concurrent cancellation records the intent once', async () => {
    const e = await createTestEngine();
    const r = await e.runToIdle(e.publish(inputLoop()).loopId);
    const [first, second] = await Promise.all([e.manager.cancel(r.id), e.manager.cancel(r.id)]);
    expect(e.eventTypes(r.id).filter((t) => t === 'run.cancel_requested')).toHaveLength(1);
    expect(e.eventTypes(r.id).filter((t) => t === 'run.cancelled')).toHaveLength(1);
    expect(second.cancelRequestedAt).toBe(first.cancelRequestedAt);
    // Once cancelled, a further cancel is an invalid-state request, as before.
    await expect(e.manager.cancel(r.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('ADV-013: a non-resumable failure cannot leave its terminal status', async () => {
    const e = await createTestEngine();
    const r = await e.runToIdle(e.publish(inputLoop()).loopId);
    await e.ports.runs.update(r.id, {
      status: 'failed',
      failure: { code: 'INTERNAL_ERROR', message: 'not resumable', resumable: false },
    });
    await expect(e.manager.resume(r.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await e.manager.waitForIdle();
  });

  it.each([
    '[{"op":"replace","path":"/counters/nodeVisits","value":{}}]',
    '[{"op":"move","from":"/counters/nodeVisits/start","path":"/vars/stolen"}]',
  ])('ADV-014: custom mapping rejects engine-owned writes: %s', async (patch) => {
    const e = await createTestEngine({ maxConcurrentRuns: 1 });
    const child = e.publish(minimalLoop());
    const parent = e.publish(
      subLoop('custom-counter', child.loopId, { mode: 'custom', custom: { patch } }),
    );
    const r = await e.runToIdle(parent.loopId);
    expect(r.failure?.code).toBe('EXPRESSION_ERROR');
  });

  it('ADV-012: a cancel that loses to the run finishing reports the terminal state', async () => {
    const e = await createTestEngine();
    const r = await e.runToIdle(e.publish(inputLoop()).loopId);
    const claim = e.ports.runs.claimCancel.bind(e.ports.runs);
    vi.spyOn(e.ports.runs, 'claimCancel').mockImplementation(async (id, from, at) => {
      await e.ports.runs.update(id, { status: 'succeeded' });
      return claim(id, from, at);
    });
    await expect(e.manager.cancel(r.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(e.eventTypes(r.id)).not.toContain('run.cancel_requested');
  });

  /** A child that has finished with `status` (succeeded, failed, or cancelled) before its parent parks. */
  function childLoop(status: 'succeeded' | 'failed' | 'cancelled'): LoopDefinitionInput {
    if (status === 'succeeded') return minimalLoop();
    if (status === 'failed') {
      return singleNodeLoop('failing-child', {
        id: 'boom',
        kind: 'mutate',
        label: 'Boom',
        config: {
          operations: [
            {
              op: 'set',
              path: '/vars/x',
              value: { kind: 'expression', jsonata: '$error("boom")' },
            },
          ],
        },
      });
    }
    return inputLoop();
  }

  it.each(['succeeded', 'failed', 'cancelled'] as const)(
    'ADV-015: a child that %s before its parent parks wakes the parent',
    async (status) => {
      const e = await createTestEngine({ maxConcurrentRuns: 2 });
      const child = e.publish(childLoop(status));
      const parent = e.publish(subLoop('fast-child', child.loopId));
      const transition = e.ports.runs.transition.bind(e.ports.runs);
      const spy = vi
        .spyOn(e.ports.runs, 'transition')
        .mockImplementation(async (id, expected, changes) => {
          if (changes.status === 'waiting' && changes.waiting?.kind === 'child') {
            const childId = changes.waiting.childRunId!;
            if (status === 'cancelled') {
              await vi.waitFor(async () =>
                expect((await e.manager.getRun(childId))?.status).toBe('waiting'),
              );
              await e.manager.cancel(childId);
            }
            await vi.waitFor(async () =>
              expect((await e.manager.getRun(childId))?.status).toBe(status),
            );
          }
          return transition(id, expected, changes);
        });
      const r = await e.runToIdle(parent.loopId);
      spy.mockRestore();
      expect(r.status).toBe('succeeded');
      expect((await e.manager.getThread(r.id))?.lastOutput?.value).toMatchObject({ status });
      expect(e.eventTypes(r.id).filter((t) => t === 'run.woken')).toHaveLength(1);
    },
  );

  it('ADV-015: recovery wakes a parent whose child finished while the process was down', async () => {
    const e = await createTestEngine({ maxConcurrentRuns: 2 });
    const child = e.publish(inputLoop());
    const parent = e.publish(subLoop('parent-restart', child.loopId));
    const r = await e.runToIdle(parent.loopId);
    expect(r.status).toBe('waiting');
    const [kid] = await e.ports.runs.listChildren(r.id);
    // The child finishes but its parent is never told (the process died first).
    e.manager.stop();
    await e.ports.runs.update(kid!.id, { status: 'succeeded', outcome: 'success' });
    const recovered = new RunManager(e.ports, e.settings);
    await recovered.start();
    await recovered.waitForIdle();
    recovered.stop();
    expect((await recovered.getRun(r.id))?.status).toBe('succeeded');
  });

  function decisionLoop(): LoopDefinitionInput {
    const def = singleNodeLoop('decision', {
      id: 'choose',
      kind: 'decision',
      label: 'Choose',
      config: {
        answer: {
          type: 'choice',
          options: [
            { id: 'yes', label: 'yes', criteria: 'Yes' },
            { id: 'other', label: 'other', criteria: 'Other' },
          ],
        },
        evaluation: { kind: 'classifier', model: 'jev', question: '?', context: {} },
      },
    });
    def.edges.push({ id: 'yes', from: { node: 'choose', port: 'yes' }, to: { node: 'done' } });
    return def;
  }
  it.each(['unknown', 'unavailable', 'throw'])(
    '7: decider %s fails without hanging',
    async (bad) => {
      const e = await createTestEngine();
      if (bad === 'unknown')
        vi.spyOn(e.ports.jev, 'choose').mockResolvedValue({
          type: 'choice',
          optionId: 'no',
          confidence: 1,
          probabilities: { yes: 1, other: 0 },
        });
      if (bad === 'unavailable') e.ports.jev.isAvailable = false;
      if (bad === 'throw') vi.spyOn(e.ports.jev, 'choose').mockRejectedValue(new Error('offline'));
      const r = await e.runToIdle(e.publish(decisionLoop()).loopId);
      expect(r.status).toBe('failed');
      expect(r.failure?.code).toBe(
        bad === 'throw'
          ? 'EVALUATION_PROVIDER_FAILED'
          : bad === 'unavailable'
            ? 'EVALUATION_UNAVAILABLE'
            : 'EVALUATION_INVALID_RESPONSE',
      );
    },
  );
  it.each([NaN, -1, 1.01, Infinity])(
    'ADV-005: invalid decider confidence %s fails with EVALUATION_INVALID_RESPONSE',
    async (confidence) => {
      const e = await createTestEngine();
      vi.spyOn(e.ports.jev, 'choose').mockResolvedValue({
        type: 'choice',
        optionId: 'yes',
        confidence,
        probabilities: { yes: 1, other: 0 },
      });
      const r = await e.runToIdle(e.publish(decisionLoop()).loopId);
      expect(r.failure?.code).toBe('EVALUATION_INVALID_RESPONSE');
    },
  );

  it.each(
    [0, 1, 3].flatMap((maxAttempts) =>
      ['fail-run', 'continue-raw'].map((onFailure) => ({ maxAttempts, onFailure })),
    ),
  )(
    '8: invalid output obeys $onFailure with $maxAttempts repairs',
    async ({ maxAttempts, onFailure }) => {
      const e = await createTestEngine();
      e.ports.harness.script(Array.from({ length: 4 }, () => ({ finalText: 'invalid' })));
      const r = await e.runToIdle(
        e.publish(
          inferLoop({
            output: {
              schema: {
                jsonSchema: { type: 'number' },
                repair: { enabled: true, maxAttempts, onFailure },
              },
            },
          }),
        ).loopId,
      );
      expect(r.status).toBe(onFailure === 'fail-run' ? 'failed' : 'succeeded');
      if (onFailure === 'fail-run') expect(r.failure?.code).toBe('OUTPUT_SCHEMA_MISMATCH');
      expect(e.ports.harness.resumed).toHaveLength(maxAttempts);
    },
  );
});
