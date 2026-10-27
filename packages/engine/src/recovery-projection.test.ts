import { expect, it, vi } from 'vitest';
import { RunManager } from './run-manager.js';
import type { EventStorePort, RunRepository, ScriptRunResult, ScriptPort } from './ports.js';
import { createTestEngine, singleNodeLoop } from './testing/scenario.js';

const completed: ScriptRunResult = {
  state: 'completed',
  exitCode: 0,
  stdout: 'null',
  stderr: '',
  stdoutBytes: 4,
  stderrBytes: 0,
  stdoutOverflow: false,
  stderrOverflow: false,
  timedOut: false,
};

it.each(['running-replay', 'paused-replay', 'paused-resume'] as const)(
  'refuses %s while an uncertain failure is durable but its status projection is delayed',
  async (scenario) => {
    const e = await createTestEngine();
    e.manager.stop();
    let release!: () => void;
    let fail!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const script = new Promise<void>((resolve) => {
      fail = resolve;
    });
    let committed = false;
    let dispatches = 0;
    const scripts: ScriptPort = {
      run: async () => {
        if (++dispatches !== 1) return completed;
        await script;
        return { ...completed, state: 'outcome-uncertain', exitCode: null };
      },
    };
    const events: EventStorePort = {
      recoveryFacts: (...args) => e.ports.events.recoveryFacts(...args),
      read: (...args) => e.ports.events.read(...args),
      subscribe: (...args) => e.ports.events.subscribe(...args),
      append: async (...args) => {
        const stored = await e.ports.events.append(...args);
        if (!committed && stored.some((event) => event.type === 'run.failed')) {
          committed = true;
          await gate;
        }
        return stored;
      },
    };
    const manager = new RunManager({ ...e.ports, events, scripts }, e.settings);
    try {
      await manager.start();
      const version = e.publish(
        singleNodeLoop(scenario, {
          id: 'effect',
          kind: 'script',
          label: 'Effect',
          config: { command: 'effect' },
        }),
      );
      const run = await manager.startRun({
        ownerId: 'local',
        loopId: version.loopId,
        source: 'manual.api',
      });
      await vi.waitFor(() => expect(dispatches).toBe(1));
      if (scenario.startsWith('paused')) await manager.pause(run.id);
      fail();
      await vi.waitFor(() => expect(committed).toBe(true));
      const snapshot = await manager.getSnapshot(run.id);
      const failed = (await events.read(run.id)).at(-1)!;
      expect(failed).toMatchObject({
        type: 'run.failed',
        failure: { code: 'SCRIPT_OUTCOME_UNCERTAIN' },
      });
      expect(snapshot.recovery.observedSeq).toBe(failed.seq);
      expect(snapshot.recovery.resume).toMatchObject({ allowed: false, code: 'RECOVERY_STALE' });
      expect(snapshot.recovery.replayDefault).toMatchObject({
        allowed: false,
        code: 'RECOVERY_STALE',
      });
      expect(snapshot.recovery.scriptConsent).toBeUndefined();
      const command = scenario.endsWith('replay')
        ? manager.replay({ runId: run.id, nodeId: 'effect', observedSeq: failed.seq })
        : manager.resume(run.id, { kind: 'user', id: 'reviewer' }, { observedSeq: failed.seq });
      await expect(command).rejects.toMatchObject({ code: 'RECOVERY_STALE' });
      expect(
        (await events.read(run.id)).filter((event) => event.type === 'run.resumed'),
      ).toHaveLength(0);
      release();
      await manager.waitForIdle();
      expect(dispatches).toBe(1);
      expect((await manager.getRecovery(run.id)).scriptConsent?.failureSeq).toBe(failed.seq);
    } finally {
      fail();
      release();
      await manager.waitForIdle();
      manager.stop();
    }
  },
);

it.each([
  { parked: false, point: 'claim' },
  { parked: true, point: 'claim' },
  { parked: false, point: 'append' },
  { parked: true, point: 'append' },
])(
  'atomically refuses a paused Resume after a durable failure ($point, parked=$parked)',
  async ({ parked, point }) => {
    const e = await createTestEngine();
    e.manager.stop();
    const version = e.publish(
      singleNodeLoop(
        'atomic review',
        parked
          ? {
              id: 'node',
              kind: 'wait',
              label: 'Wait',
              config: { mode: 'input', prompt: 'Continue', exposeTo: ['api'] },
            }
          : { id: 'node', kind: 'script', label: 'Effect', config: { command: 'effect' } },
      ),
    );
    let release!: () => void;
    const script = new Promise<void>((resolve) => {
      release = resolve;
    });
    const scripts: ScriptPort = {
      run: async () => {
        await script;
        return completed;
      },
    };
    let armed = false;
    let injected = false;
    const original = e.ports.runs;
    const runs: RunRepository = {
      ...original,
      create: (...a) => original.create(...a),
      get: (...a) => original.get(...a),
      update: (...a) => original.update(...a),
      transition: async (...args) => {
        if (point === 'claim' && armed && !injected && args[1].includes('paused')) {
          injected = true;
          await e.ports.events.append(args[0], [
            {
              type: 'run.failed',
              failure: {
                code: 'SCRIPT_OUTCOME_UNCERTAIN',
                message: 'Durable before status projection',
                resumable: true,
                nodeId: 'node',
              },
            },
          ]);
        }
        return original.transition(...args);
      },
      claimCancel: (...a) => original.claimCancel(...a),
      listRecoveryCandidates: (...a) => original.listRecoveryCandidates(...a),
      listRunReferences: (...a) => original.listRunReferences(...a),
      markFinalized: (...a) => original.markFinalized(...a),
      clearFinalized: (...a) => original.clearFinalized(...a),
      listChildren: (...a) => original.listChildren(...a),
      getInitialThread: (...a) => original.getInitialThread(...a),
      getThread: (...a) => original.getThread(...a),
      saveThread: (...a) => original.saveThread(...a),
      getThreadCheckpoint: (...a) => original.getThreadCheckpoint(...a),
    };
    const store = e.ports.events;
    const events: EventStorePort = {
      recoveryFacts: (...a) => store.recoveryFacts(...a),
      read: (...a) => store.read(...a),
      subscribe: (...a) => store.subscribe(...a),
      append: async (...args) => {
        if (
          point === 'append' &&
          armed &&
          !injected &&
          args[1].some((e) => e.type === 'run.resumed')
        ) {
          injected = true;
          await store.append(args[0], [
            {
              type: 'run.failed',
              failure: {
                code: 'SCRIPT_OUTCOME_UNCERTAIN',
                message: 'Failure between claim and append',
                resumable: true,
                nodeId: 'node',
              },
            },
          ]);
        }
        return store.append(...args);
      },
    };
    const manager = new RunManager({ ...e.ports, runs, scripts, events }, e.settings);
    try {
      await manager.start();
      const run = await manager.startRun({
        ownerId: 'local',
        loopId: version.loopId,
        source: 'manual.api',
      });
      await vi.waitFor(async () =>
        expect((await manager.getRun(run.id))?.currentNodeId).toBe('node'),
      );
      if (parked) await manager.waitForIdle();
      await manager.pause(run.id);
      const review = await manager.getRecovery(run.id);
      expect(review.resume.allowed).toBe(true);
      armed = true;
      await expect(
        manager.resume(
          run.id,
          { kind: 'user', id: 'reviewer' },
          { observedSeq: review.observedSeq },
        ),
      ).rejects.toMatchObject({ code: 'RECOVERY_STALE' });
      expect(injected).toBe(true);
      const history = await e.ports.events.read(run.id);
      const resumed = history.find((event) => event.type === 'run.resumed');
      if (point === 'claim') {
        // Status projection follows the durable intent now. A later failure wins the
        // projection guard; its earlier accepted Resume remains factual history.
        expect(resumed?.seq).toBeLessThan(
          history.findLast((event) => event.type === 'run.failed')!.seq,
        );
      } else expect(resumed).toBeUndefined();
      expect((await manager.getRun(run.id))?.status).toBe('paused');
      expect((await manager.getRecovery(run.id)).resume).toMatchObject({ code: 'RECOVERY_STALE' });
    } finally {
      release();
      await manager.waitForIdle();
      manager.stop();
    }
  },
);
