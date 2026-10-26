import { describe, expect, it, vi } from 'vitest';
import type { EventStorePort, ScriptRunResult } from './ports.js';
import { RunManager } from './run-manager.js';
import { createTestEngine, singleNodeLoop } from './testing/scenario.js';
const result: ScriptRunResult = {
  state: 'completed',
  exitCode: 0,
  stdout: '"effect"',
  stderr: '',
  stdoutBytes: 8,
  stderrBytes: 0,
  stdoutOverflow: false,
  stderrOverflow: false,
  timedOut: false,
};
describe('recovery effect boundaries (#256)', () => {
  it('does not reinterpret paused Resume as consent when the active script fails during validation', async () => {
    const e = await createTestEngine();
    let finish!: (value: ScriptRunResult) => void;
    const pending = new Promise<ScriptRunResult>((resolve) => {
      finish = resolve;
    });
    vi.spyOn(e.ports.scripts, 'run').mockImplementationOnce((request) => {
      e.ports.scripts.calls.push(request);
      return pending;
    });
    const version = e.publish(
      singleNodeLoop('failure during Resume', {
        id: 'effect',
        kind: 'script',
        label: 'Effect',
        config: { command: 'effect' },
      }),
    );
    const source = await e.start(version.loopId);
    await vi.waitFor(() => expect(e.ports.scripts.calls).toHaveLength(1));
    await e.manager.pause(source.id);
    const observed = await e.manager.getRecovery(source.id);
    const getInitial = e.ports.runs.getInitialThread.bind(e.ports.runs);
    let interleaved = false;
    vi.spyOn(e.ports.runs, 'getInitialThread').mockImplementation(async (id) => {
      const initial = await getInitial(id);
      if (!interleaved && id === source.id) {
        interleaved = true;
        e.ports.scripts.respondWith(() => result);
        finish({ ...result, state: 'outcome-uncertain', exitCode: null });
        await vi.waitFor(async () =>
          expect((await e.ports.runs.get(id))?.failure?.code).toBe('SCRIPT_OUTCOME_UNCERTAIN'),
        );
      }
      return initial;
    });
    let refusal: unknown;
    try {
      await e.manager.resume(
        source.id,
        { kind: 'user', id: 'owner' },
        { observedSeq: observed.observedSeq },
      );
    } catch (error) {
      refusal = error;
    }
    await e.manager.waitForIdle();
    expect(e.ports.scripts.calls).toHaveLength(1);
    expect(refusal).toMatchObject({ code: 'SCRIPT_CONSENT_REQUIRED' });
    e.manager.stop();
  });
  it('does not attach a newer failure observation to an older script consent target', async () => {
    const e = await createTestEngine();
    let dispatches = 0;
    e.ports.scripts.respondWith(() =>
      ++dispatches === 1 || dispatches === 3
        ? { ...result, state: 'outcome-uncertain', exitCode: null }
        : result,
    );
    const loop = singleNodeLoop('changing consent target', {
      id: 'a',
      kind: 'script',
      label: 'A',
      config: { command: 'a' },
    });
    loop.nodes.splice(2, 0, { id: 'b', kind: 'script', label: 'B', config: { command: 'b' } });
    loop.edges = [
      { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'a' } },
      { id: 'b', from: { node: 'a', port: 'out' }, to: { node: 'b' } },
      { id: 'c', from: { node: 'b', port: 'out' }, to: { node: 'done' } },
    ];
    const source = await e.runToIdle(e.publish(loop).loopId);
    expect(source.failure?.nodeId).toBe('a');
    e.manager.stop();
    let armed = false;
    let interleaved = false;
    const events: EventStorePort = {
      append: (...args) => e.ports.events.append(...args),
      subscribe: (...args) => e.ports.events.subscribe(...args),
      read: async (...args) => {
        if (armed && !interleaved && args[0] === source.id) {
          interleaved = true;
          await reader.resume(
            source.id,
            { kind: 'user', id: 'other-tab' },
            { retryUncertainScript: true },
          );
          await reader.waitForIdle();
        }
        return e.ports.events.read(...args);
      },
    };
    const reader = new RunManager({ ...e.ports, events }, e.settings);
    try {
      await reader.start();
      armed = true;
      const recovery = await reader.getRecovery(source.id);
      expect((await e.ports.runs.get(source.id))?.failure?.nodeId).toBe('b');
      expect(recovery.scriptConsent?.nodeId).toBe('b');
      expect(recovery.observedSeq).toBe(e.events(source.id).at(-1)!.seq);
    } finally {
      reader.stop();
    }
  });
  it('replays the chosen script as new work, preserves the source and deduplicates admission', async () => {
    const e = await createTestEngine();
    e.ports.scripts.respondWith(() => result);
    const source = await e.runToIdle(
      e.publish(
        singleNodeLoop('script fork', {
          id: 'effect',
          kind: 'script',
          label: 'Effect',
          config: { command: 'effect' },
        }),
      ).loopId,
    );
    const before = JSON.stringify({
      run: await e.manager.getRun(source.id),
      events: e.events(source.id),
      thread: await e.manager.getThread(source.id),
    });
    const recovery = await e.manager.getRecovery(source.id);
    const choice = recovery.replay.find((node) => node.nodeId === 'effect');
    expect(choice?.action.allowed).toBe(true);
    expect(choice?.effects).toContainEqual({ nodeId: 'effect', label: 'Effect', kind: 'script' });
    const fork = await e.manager.replay({
      runId: source.id,
      nodeId: 'effect',
      observedSeq: recovery.observedSeq,
    });
    expect((await e.settle(fork.id)).status).toBe('succeeded');
    expect(e.ports.scripts.calls).toHaveLength(2);
    expect(
      JSON.stringify({
        run: await e.manager.getRun(source.id),
        events: e.events(source.id),
        thread: await e.manager.getThread(source.id),
      }),
    ).toBe(before);
    const restarted = new RunManager(e.ports, e.settings);
    await expect(
      restarted.replay({ runId: source.id, nodeId: 'effect', observedSeq: recovery.observedSeq }),
    ).rejects.toMatchObject({ code: 'RECOVERY_STALE', replayRunId: fork.id });
    e.manager.stop();
  });
  it('explains possible script work through a loopback without refusing Replay', async () => {
    const e = await createTestEngine();
    e.ports.scripts.respondWith(() => result);
    const loop = singleNodeLoop('loopback effect', {
      id: 'effect',
      kind: 'script',
      label: 'Effect',
      config: { command: 'effect' },
    });
    // The existing source completed normally. The pinned graph has a possible edge back to the
    // effect; eligibility is conservative across routes rather than assuming a future decision.
    loop.nodes.splice(2, 0, {
      id: 'gate',
      kind: 'decision',
      label: 'Gate',
      config: {
        kind: 'expression',
        jsonata: '"stop"',
        routes: [
          { id: 'stop', label: 'Stop' },
          { id: 'again', label: 'Again' },
        ],
      },
    });
    loop.edges[1]!.to.node = 'gate';
    loop.edges.push(
      { id: 'stop', from: { node: 'gate', port: 'stop' }, to: { node: 'done' } },
      { id: 'again', from: { node: 'gate', port: 'again' }, to: { node: 'effect' } },
    );
    const source = await e.runToIdle(e.publish(loop).loopId);
    const choice = (await e.manager.getRecovery(source.id)).replay.find(
      (node) => node.nodeId === 'gate',
    );
    expect(choice?.action.allowed).toBe(true);
    expect(choice?.effects).toContainEqual({ nodeId: 'effect', label: 'Effect', kind: 'script' });
    const fork = await e.manager.replay({ runId: source.id, nodeId: 'gate' });
    expect((await e.settle(fork.id)).status).toBe('succeeded');
    expect(e.ports.scripts.calls).toHaveLength(1);
    e.manager.stop();
  });
  it('replays a script after repeated proven pre-start refusals without classifying them as consumed effects', async () => {
    const e = await createTestEngine();
    e.ports.scripts.respondWith(() => ({
      ...result,
      state: 'definitely-not-started',
      exitCode: null,
    }));
    const run = await e.runToIdle(
      e.publish(
        singleNodeLoop('proven refusals', {
          id: 'effect',
          kind: 'script',
          label: 'Effect',
          config: { command: 'effect' },
        }),
      ).loopId,
    );
    await e.manager.resume(run.id);
    await e.settle(run.id);
    const recovery = await e.manager.getRecovery(run.id);
    expect(recovery.replay.find((node) => node.nodeId === 'effect')?.action.allowed).toBe(true);
    e.ports.scripts.respondWith(() => result);
    const fork = await e.manager.replay({
      runId: run.id,
      nodeId: 'effect',
      observedSeq: recovery.observedSeq,
    });
    expect((await e.settle(fork.id)).status).toBe('succeeded');
    e.manager.stop();
  });
  it('returns the current typed cancellation reason when cancellation wins inside paused Resume', async () => {
    const e = await createTestEngine();
    const run = await e.runToIdle(
      e.publish(
        singleNodeLoop('cancel recovery race', {
          id: 'ask',
          kind: 'wait',
          label: 'Ask',
          config: { mode: 'input', prompt: '?' },
        }),
      ).loopId,
    );
    await e.manager.pause(run.id);
    const observed = await e.manager.getRecovery(run.id);
    const transition = e.ports.runs.transition.bind(e.ports.runs);
    let cancelled = false;
    // A controlled port interleaving: cancellation commits after policy read, before Resume's CAS.
    vi.spyOn(e.ports.runs, 'transition').mockImplementation(async (id, from, changes) => {
      if (!cancelled && id === run.id && from.includes('paused') && changes.status === 'waiting') {
        cancelled = true;
        await e.manager.cancel(id);
        return undefined;
      }
      return transition(id, from, changes);
    });
    await expect(
      e.manager.resume(
        run.id,
        { kind: 'user', id: 'owner' },
        { observedSeq: observed.observedSeq },
      ),
    ).rejects.toMatchObject({ code: 'RUN_CANCELLED' });
    expect((await e.manager.getRun(run.id))?.status).toBe('cancelled');
    e.manager.stop();
  });
  it('resumes a completed resumable script failure after the program is fixed', async () => {
    const e = await createTestEngine();
    e.ports.scripts.respondWith(() => ({ ...result, exitCode: 1 }));
    const run = await e.runToIdle(
      e.publish(
        singleNodeLoop('fixed program', {
          id: 'effect',
          kind: 'script',
          label: 'Effect',
          config: { command: 'effect' },
        }),
      ).loopId,
    );
    expect((await e.manager.getRecovery(run.id)).resume.allowed).toBe(true);
    e.ports.scripts.respondWith(() => result);
    expect((await e.manager.resume(run.id)).id).toBe(run.id);
    expect((await e.settle(run.id)).status).toBe('succeeded');
    expect(e.ports.scripts.calls).toHaveLength(2);
    e.manager.stop();
  });
  it('retains the source delivery and performs the fork own delivery', async () => {
    const e = await createTestEngine();
    const loop = singleNodeLoop('recorded return', {
      id: 'work',
      kind: 'mutate',
      label: 'Work',
      config: {
        operations: [{ op: 'set', path: '/vars/ok', value: { kind: 'literal', value: true } }],
      },
    });
    const done = loop.nodes.find((n) => n.id === 'done');
    if (!done || done.kind !== 'exit') throw new Error('exit missing');
    done.config.returns = '42';
    done.config.destinations = [{ kind: 'webhook', url: 'https://example.test/result' }];
    const run = await e.runToIdle(e.publish(loop).loopId);
    expect(e.events(run.id).some((event) => event.type === 'delivery.finished')).toBe(true);
    const before = structuredClone(e.events(run.id));
    const fork = await e.manager.replay({ runId: run.id, nodeId: 'done' });
    expect((await e.settle(fork.id)).status).toBe('succeeded');
    expect(e.events(run.id)).toEqual(before);
    expect(e.events(run.id).filter((event) => event.type === 'delivery.attempted')).toHaveLength(1);
    expect(e.events(fork.id).filter((event) => event.type === 'delivery.attempted')).toHaveLength(
      1,
    );
    e.manager.stop();
  });
});
