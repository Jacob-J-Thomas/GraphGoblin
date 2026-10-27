import { describe, expect, it } from 'vitest';
import type { EventStorePort, ScriptRunResult } from './ports.js';
import { RunManager } from './run-manager.js';
import { createTestEngine, singleNodeLoop } from './testing/scenario.js';

const scriptLoop = () =>
  singleNodeLoop('script-recovery', {
    id: 'script',
    kind: 'script',
    label: 'Effect',
    config: { command: 'effect' },
  });
const completed: ScriptRunResult = {
  state: 'completed',
  exitCode: 0,
  stdout: '',
  stderr: '',
  timedOut: false,
  stdoutBytes: 0,
  stderrBytes: 0,
  stdoutOverflow: false,
  stderrOverflow: false,
};

describe('script dispatch recovery (#321)', () => {
  it('never automatically retries an uncertain child script when recovering its parent', async () => {
    const e = await createTestEngine();
    e.ports.scripts.respondWith(() => ({
      ...completed,
      state: 'outcome-uncertain',
      exitCode: null,
    }));
    const child = e.publish(scriptLoop());
    const parent = e.publish(
      singleNodeLoop('uncertain-parent', {
        id: 'sub',
        kind: 'subloop',
        label: 'Sub',
        config: { loopRef: { loopId: child.loopId } },
      }),
    );
    const run = await e.runToIdle(parent.loopId);
    expect(run.failure).toMatchObject({
      code: 'SCRIPT_OUTCOME_UNCERTAIN',
      nodeId: 'sub',
      resumable: true,
    });
    e.manager.stop();
    const recovered = new RunManager(e.ports, e.settings);
    try {
      await recovered.start();
      await recovered.waitForIdle();
      expect(e.ports.scripts.calls).toHaveLength(1);
      e.ports.scripts.respondWith(() => completed);
      await recovered.resume(run.id, { kind: 'user', id: 'owner' }, { retryUncertainScript: true });
      await recovered.waitForIdle();
      expect((await e.ports.runs.get(run.id))?.status).toBe('succeeded');
      expect(e.ports.scripts.calls).toHaveLength(2);
    } finally {
      recovered.stop();
    }
  });
  it.each(['before-dispatch', 'dispatch-ack', 'completion-ack', 'failure-ack'] as const)(
    'recovers %s twice, preserving evidence and requiring consent for an unknown effect',
    async (boundary) => {
      const e = await createTestEngine();
      e.manager.stop();
      const version = e.publish(scriptLoop());
      const run = await e.start(version.loopId);
      let reach!: () => void;
      const reached = new Promise<void>((resolve) => {
        reach = resolve;
      });
      let blocked = false;
      const events: EventStorePort = {
        recoveryFacts: (...args) => e.ports.events.recoveryFacts(...args),
        read: (...args) => e.ports.events.read(...args),
        subscribe: (...args) => e.ports.events.subscribe(...args),
        append: async (id, drafts, options) => {
          const stored = await e.ports.events.append(id, drafts, options);
          if (
            !blocked &&
            drafts.some(
              (draft) =>
                (boundary === 'before-dispatch' &&
                  draft.type === 'node.started' &&
                  draft.nodeId === 'script') ||
                (boundary === 'dispatch-ack' && draft.type === 'script.dispatched') ||
                (boundary === 'completion-ack' &&
                  draft.type === 'node.finished' &&
                  draft.nodeId === 'script') ||
                (boundary === 'failure-ack' && draft.type === 'run.failed'),
            )
          ) {
            blocked = true;
            reach();
            // Storage committed; its acknowledgement is lost with the process.
            return new Promise<never>(() => undefined);
          }
          return stored;
        },
      };
      if (boundary === 'failure-ack')
        e.ports.scripts.respondWith(() => ({
          ...completed,
          state: 'definitely-not-started',
          exitCode: null,
        }));
      const first = new RunManager({ ...e.ports, events }, e.settings);
      await first.start();
      await reached;
      first.stop();
      const callsAtCrash = e.ports.scripts.calls.length;
      for (let restart = 0; restart < 2; restart++) {
        const recovered = new RunManager(e.ports, e.settings);
        try {
          await recovered.start();
          await recovered.waitForIdle();
        } finally {
          recovered.stop();
        }
      }
      const recovered = (await e.ports.runs.get(run.id))!;
      if (boundary === 'dispatch-ack' || boundary === 'before-dispatch') {
        expect(e.ports.scripts.calls).toHaveLength(0);
        expect(recovered.failure).toMatchObject({
          code: 'SCRIPT_OUTCOME_UNCERTAIN',
          script: { state: 'outcome-uncertain' },
          resumable: true,
        });
        expect(e.events(run.id).filter((event) => event.type === 'run.failed')).toHaveLength(1);
      } else if (boundary === 'failure-ack') {
        expect(recovered.failure).toMatchObject({
          code: 'SCRIPT_START_FAILED',
          script: { state: 'definitely-not-started' },
          resumable: true,
        });
        expect(e.ports.scripts.calls).toHaveLength(callsAtCrash);
      } else {
        expect(recovered.status).toBe('succeeded');
        expect(e.ports.scripts.calls).toHaveLength(1);
      }
      if (
        boundary === 'dispatch-ack' ||
        boundary === 'before-dispatch' ||
        boundary === 'failure-ack'
      ) {
        e.ports.scripts.respondWith(() => completed);
        const resumed = new RunManager(e.ports, e.settings);
        try {
          await resumed.start();
          expect(e.ports.scripts.calls).toHaveLength(callsAtCrash);
          if (boundary === 'before-dispatch' || boundary === 'dispatch-ack') {
            const recovery = await resumed.getRecovery(run.id);
            expect(recovery.replay.find((node) => node.nodeId === 'start')?.action).toMatchObject({
              allowed: false,
              code: 'SCRIPT_CONSENT_REQUIRED',
            });
            await expect(
              resumed.replay({
                runId: run.id,
                nodeId: 'start',
                observedSeq: recovery.observedSeq,
              }),
            ).rejects.toMatchObject({ code: 'SCRIPT_CONSENT_REQUIRED' });
            expect(e.ports.scripts.calls).toHaveLength(callsAtCrash);
          }
          await resumed.resume(
            run.id,
            { kind: 'user', id: 'owner' },
            { retryUncertainScript: true },
          );
          await resumed.waitForIdle();
          expect((await e.ports.runs.get(run.id))?.status).toBe('succeeded');
          const dispatches = e.events(run.id).filter((event) => event.type === 'script.dispatched');
          expect(dispatches).toHaveLength(boundary === 'before-dispatch' ? 1 : 2);
          if (boundary !== 'before-dispatch') {
            expect(dispatches[1]!.visitId).toBe(dispatches[0]!.visitId);
            expect(dispatches[1]!.dispatchId).not.toBe(dispatches[0]!.dispatchId);
          }
        } finally {
          resumed.stop();
        }
      }
    },
    15_000,
  );

  it.each(['definitely-not-started', 'outcome-uncertain', 'completed'] as const)(
    'records %s provenance and keeps completed nonzero exits distinct',
    async (state) => {
      const e = await createTestEngine();
      e.ports.scripts.respondWith(() => ({
        ...completed,
        state,
        exitCode: state === 'completed' ? 7 : null,
      }));
      const v = e.publish(scriptLoop());
      const run = await e.runToIdle(v.loopId);
      const dispatch = e.events(run.id).find((event) => event.type === 'script.dispatched');
      expect(dispatch).toBeDefined();
      expect(run.failure).toMatchObject({
        code:
          state === 'completed'
            ? 'SCRIPT_EXIT_CODE'
            : state === 'definitely-not-started'
              ? 'SCRIPT_START_FAILED'
              : 'SCRIPT_OUTCOME_UNCERTAIN',
        resumable: true,
        script: {
          visitId: dispatch!.visitId,
          dispatchId: dispatch!.dispatchId,
          state,
          ...(state === 'completed' ? { exitCode: 7 } : {}),
        },
      });
    },
  );

  it('writes dispatch durably before entering the runner, and classifies an unproven rejection conservatively', async () => {
    const e = await createTestEngine();
    e.manager.stop();
    const v = e.publish(scriptLoop());
    const run = await e.start(v.loopId);
    e.ports.scripts.respondWith(() => {
      const dispatch = e.events(run.id).find((event) => event.type === 'script.dispatched');
      expect(dispatch).toBeDefined();
      throw new Error('runner lost contact after an effect');
    });
    const manager = new RunManager(e.ports, e.settings);
    try {
      await manager.start();
      await manager.waitForIdle();
      expect((await e.ports.runs.get(run.id))?.failure).toMatchObject({
        code: 'SCRIPT_OUTCOME_UNCERTAIN',
        script: { state: 'outcome-uncertain' },
      });
    } finally {
      manager.stop();
    }
  });
});
