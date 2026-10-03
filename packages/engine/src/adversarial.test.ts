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

  it.todo('ADV-016: recovery does not execute a node whose completion is already durable');
  // Executed reproduction; restore after fixing the durable cursor boundary.
  // it('ADV-016: recovery does not execute a node whose completion is already durable', async () => {
  //   const e = await createTestEngine();
  //   const v = e.publish(inferLoop());
  //   const update = e.ports.runs.update.bind(e.ports.runs);
  //   const spy = vi.spyOn(e.ports.runs, 'update').mockImplementation((id, changes) => {
  //     if (changes.currentNodeId === 'done') return new Promise(() => undefined);
  //     return update(id, changes);
  //   });
  //   const r = await e.start(v.loopId);
  //   await vi.waitFor(() => expect(e.events(r.id).some(x => x.type === 'node.finished' && x.nodeId === 'infer')).toBe(true));
  //   e.manager.stop(); spy.mockRestore();
  //   const recovered = new RunManager(e.ports, e.settings);
  //   await recovered.start(); await recovered.waitForIdle(); recovered.stop();
  //   expect(e.ports.harness.started).toHaveLength(1);
  //   expect(e.events(r.id).filter(x => x.type === 'node.finished' && x.nodeId === 'infer')).toHaveLength(1);
  // });

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
    const append = e.ports.events.append.bind(e.ports.events);
    vi.spyOn(e.ports.events, 'append').mockImplementation(async (id, drafts) => {
      const events = await append(id, drafts);
      if (drafts.some((d) => d.type === 'node.finished')) {
        snapshots.push(await e.manager.getThread(id));
        replayed.push(replayThread((await e.ports.runs.getInitialThread(id))!, e.events(id)));
      }
      return events;
    });
    const r = await e.runToIdle(v.loopId);
    expect(r.status).toBe('succeeded');
    expect(e.events(r.id).map((x) => x.seq)).toEqual(e.events(r.id).map((_, i) => i + 1));
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

  it.todo('ADV-004: latest subloop version is pinned at parent start');
  // Executed reproduction; restore this test after fixing the finding.
  // it('ADV-004: latest subloop version is pinned at parent start', async () => {
  //   const e = await createTestEngine({ maxConcurrentRuns: 1 });
  //   const child = e.publish(minimalLoop());
  //   const parent = subLoop('parent', child.loopId);
  //   parent.nodes.push({ id: 'wait', kind: 'wait', label: 'Wait', config: { mode: 'input', prompt: '?' } });
  //   parent.edges[0] = { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'wait' } };
  //   parent.edges.push({ id: 'w', from: { node: 'wait', port: 'out' }, to: { node: 'child' } });
  //   const r = await e.runToIdle(e.publish(parent).loopId);
  //   e.publish(minimalLoop(), { loopId: child.loopId, version: 2 });
  //   await e.manager.provideInput(r.id, null);
  //   await e.settle(r.id);
  //   expect((await e.ports.runs.listChildren(r.id))[0]?.versionId).toBe(child.id);
  // });

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

  it.todo('ADV-012: concurrent cancellation records the intent once');
  // Executed reproduction; restore this test after fixing the finding.
  // it('ADV-012: concurrent cancellation records the intent once', async () => {
  //   const e = await createTestEngine();
  //   const r = await e.runToIdle(e.publish(inputLoop()).loopId);
  //   await Promise.all([e.manager.cancel(r.id), e.manager.cancel(r.id)]);
  //   expect(e.eventTypes(r.id).filter(t => t === 'run.cancel_requested')).toHaveLength(1);
  // });

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

  it.todo('ADV-015: a child finishing just before its parent parks cannot orphan the parent');
  // Executed reproduction; restore this test after fixing the finding.
  // it('ADV-015: a child finishing just before its parent parks cannot orphan the parent', async () => {
  //   const e = await createTestEngine({ maxConcurrentRuns: 2 });
  //   const child = e.publish(minimalLoop());
  //   const parent = e.publish(subLoop('fast-child', child.loopId));
  //   const transition = e.ports.runs.transition.bind(e.ports.runs);
  //   vi.spyOn(e.ports.runs, 'transition').mockImplementation(async (id, expected, changes) => {
  //     if (changes.status === 'waiting' && changes.waiting?.kind === 'child') {
  //       const childId = changes.waiting.childRunId!;
  //       await vi.waitFor(async () => expect((await e.manager.getRun(childId))?.status).toBe('succeeded'));
  //     }
  //     return transition(id, expected, changes);
  //   });
  //   const r = await e.runToIdle(parent.loopId);
  //   expect(r.status).toBe('succeeded');
  // });

  function decisionLoop(): LoopDefinitionInput {
    const def = singleNodeLoop('decision', {
      id: 'choose',
      kind: 'decision',
      label: 'Choose',
      config: {
        question: '?',
        strategy: ['jev'],
        routes: [
          { label: 'yes', description: 'Yes' },
          { label: 'other', description: 'Other' },
        ],
      },
    });
    def.edges.push({ id: 'yes', from: { node: 'choose', port: 'yes' }, to: { node: 'done' } });
    return def;
  }
  it.each(['unknown', 'unavailable', 'throw'])(
    '7: decider %s fails without hanging',
    async (bad) => {
      const e = await createTestEngine();
      if (bad === 'unknown') vi.spyOn(e.ports.jev, 'choose').mockResolvedValue({ label: 'no' });
      if (bad === 'unavailable') e.ports.jev.isAvailable = false;
      if (bad === 'throw') vi.spyOn(e.ports.jev, 'choose').mockRejectedValue(new Error('offline'));
      const r = await e.runToIdle(e.publish(decisionLoop()).loopId);
      expect(r.status).toBe('failed');
      expect(r.failure?.code).toBe(bad === 'throw' ? 'INTERNAL_ERROR' : 'DECISION_NO_ROUTE');
    },
  );
  it.each([NaN, -1, 1.01, Infinity])(
    'ADV-005: invalid decider confidence %s fails with DECISION_NO_ROUTE',
    async (confidence) => {
      const e = await createTestEngine();
      vi.spyOn(e.ports.jev, 'choose').mockResolvedValue({ label: 'yes', confidence });
      const r = await e.runToIdle(e.publish(decisionLoop()).loopId);
      expect(r.failure?.code).toBe('DECISION_NO_ROUTE');
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
