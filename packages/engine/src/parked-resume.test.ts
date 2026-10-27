import { expect, it } from 'vitest';
import { RunManager } from './run-manager.js';
import type { EventStorePort } from './ports.js';
import { createTestEngine, singleNodeLoop } from './testing/scenario.js';

async function setup(kind: 'input' | 'timer' | 'child' = 'input') {
  const e = await createTestEngine();
  e.manager.stop();
  const child = e.publish(
    singleNodeLoop('parked child', {
      id: 'input',
      kind: 'wait',
      label: 'Input',
      config: { mode: 'input', prompt: 'Continue' },
    }),
  );
  const version = e.publish(
    singleNodeLoop(
      'parked parent',
      kind === 'child'
        ? {
            id: 'park',
            kind: 'subloop',
            label: 'Child',
            config: { loopRef: { loopId: child.loopId } },
          }
        : {
            id: 'park',
            kind: 'wait',
            label: 'Wait',
            config:
              kind === 'timer'
                ? { mode: 'duration', seconds: 1 }
                : { mode: 'input', prompt: 'Continue' },
          },
    ),
  );
  const fault: { before?: () => Promise<void>; after?: () => Promise<void> } = {};
  const store = e.ports.events;
  const events: EventStorePort = {
    recoveryFacts: (...args) => store.recoveryFacts(...args),
    read: (...args) => store.read(...args),
    subscribe: (...args) => store.subscribe(...args),
    append: async (...args) => {
      const resume = args[1].some((event) => event.type === 'run.resumed');
      if (resume) await fault.before?.();
      const stored = await store.append(...args);
      if (resume) await fault.after?.();
      return stored;
    },
  };
  const manager = new RunManager({ ...e.ports, events }, e.settings);
  await manager.start();
  const started = await manager.startRun({
    ownerId: 'local',
    loopId: version.loopId,
    source: 'manual.api',
  });
  await manager.waitForIdle();
  const waiting = (await manager.getRun(started.id))!;
  expect(waiting.status).toBe('waiting');
  await manager.pause(waiting.id);
  const review = await manager.getRecovery(waiting.id);
  return { e, manager, waiting, review, fault };
}

it('refuses a parked Resume without changing paused status when cancellation wins the append CAS', async () => {
  const { e, manager, waiting, review, fault } = await setup();
  fault.before = async () => {
    await e.ports.events.append(waiting.id, [
      { type: 'run.cancel_requested', actor: { kind: 'user', id: 'other-client' } },
    ]);
  };
  try {
    await expect(
      manager.resume(
        waiting.id,
        { kind: 'user', id: 'reviewer' },
        { observedSeq: review.observedSeq },
      ),
    ).rejects.toMatchObject({ code: 'RECOVERY_STALE' });
    expect(await manager.getRun(waiting.id)).toMatchObject({
      status: 'paused',
      waiting: waiting.waiting,
    });
    expect(e.events(waiting.id).filter((event) => event.type === 'run.resumed')).toHaveLength(0);
    expect(e.events(waiting.id).filter((event) => event.type === 'run.waiting')).toHaveLength(1);
  } finally {
    manager.stop();
  }
});

it('resumes an uninterleaved input park into the same wait and consumes its answer once', async () => {
  const { e, manager, waiting, review } = await setup();
  try {
    const resumed = await manager.resume(
      waiting.id,
      { kind: 'user', id: 'reviewer' },
      { observedSeq: review.observedSeq },
    );
    expect(resumed).toMatchObject({ id: waiting.id, status: 'waiting', waiting: waiting.waiting });
    await manager.provideInput(waiting.id, waiting.waiting!.waitId, 'answer');
    await manager.waitForIdle();
    expect((await manager.getRun(waiting.id))?.status).toBe('succeeded');
    expect(e.events(waiting.id).filter((event) => event.type === 'run.waiting')).toHaveLength(1);
    expect(e.events(waiting.id).filter((event) => event.type === 'run.resumed')).toHaveLength(1);
    expect(e.events(waiting.id).filter((event) => event.type === 'run.woken')).toHaveLength(1);
  } finally {
    manager.stop();
  }
});

it.each(['timer', 'child'] as const)(
  'keeps a %s park paused until the Resume intent commits, then reconciles the original wait once',
  async (kind) => {
    const { e, manager, waiting, review, fault } = await setup(kind);
    let entered!: () => void;
    let release!: () => void;
    const entering = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fault.before = async () => {
      entered();
      await gate;
    };
    const resume = manager.resume(
      waiting.id,
      { kind: 'user', id: 'reviewer' },
      { observedSeq: review.observedSeq },
    );
    // Observe the public command through its dependency boundary, before any Resume is durable.
    await entering;
    try {
      expect((await manager.getRun(waiting.id))?.status).toBe('paused');
      expect(e.events(waiting.id).some((event) => event.type === 'run.resumed')).toBe(false);
      if (kind === 'timer') {
        e.ports.clock.advance(2000);
        await e.ports.timers.fireDue(e.ports.clock.now());
      } else {
        const [child] = await e.ports.runs.listChildren(waiting.id);
        await manager.provideInput(child!.id, child!.waiting!.waitId, 'child result');
        await manager.waitForIdle();
        expect((await manager.getRun(child!.id))?.status).toBe('succeeded');
      }
      expect((await manager.getRun(waiting.id))?.status).toBe('paused');
      expect(e.events(waiting.id).some((event) => event.type === 'run.woken')).toBe(false);
      release();
      await resume;
      if (kind === 'timer') {
        expect((await manager.getRun(waiting.id))?.waiting).toEqual(waiting.waiting);
        await e.ports.timers.fireDue(e.ports.clock.now());
      }
      await manager.waitForIdle();
      expect((await manager.getRun(waiting.id))?.status).toBe('succeeded');
      expect(e.events(waiting.id).filter((event) => event.type === 'run.woken')).toHaveLength(1);
      expect(e.events(waiting.id).filter((event) => event.type === 'run.waiting')).toHaveLength(1);
      if (kind === 'child') expect(await e.ports.runs.listChildren(waiting.id)).toHaveLength(1);
    } finally {
      release();
      await resume.catch(() => undefined);
      await manager.waitForIdle();
      manager.stop();
    }
  },
);

it('recovers an acknowledged-lost parked Resume, but preserves a later deliberate pause on another restart', async () => {
  const { e, manager, waiting, review, fault } = await setup();
  let restarted: RunManager | undefined;
  let pausedAgain: RunManager | undefined;
  fault.after = () => Promise.reject(new Error('Resume acknowledgement lost'));
  try {
    await expect(
      manager.resume(
        waiting.id,
        { kind: 'user', id: 'reviewer' },
        { observedSeq: review.observedSeq },
      ),
    ).rejects.toThrow('acknowledgement lost');
    expect((await manager.getRun(waiting.id))?.status).toBe('paused');
    expect(e.events(waiting.id).filter((event) => event.type === 'run.resumed')).toHaveLength(1);
    expect((await manager.getRecovery(waiting.id)).resume).toMatchObject({
      code: 'RECOVERY_STALE',
    });
    expect((await manager.getRecovery(waiting.id)).replayDefault).toMatchObject({
      code: 'RECOVERY_STALE',
    });
    manager.stop();
    restarted = new RunManager(e.ports, e.settings);
    await restarted.start();
    await restarted.waitForIdle();
    expect(await restarted.getRun(waiting.id)).toMatchObject({
      id: waiting.id,
      status: 'waiting',
      waiting: waiting.waiting,
    });
    await restarted.pause(waiting.id);
    restarted.stop();
    pausedAgain = new RunManager(e.ports, e.settings);
    await pausedAgain.start();
    await pausedAgain.waitForIdle();
    expect((await pausedAgain.getRun(waiting.id))?.status).toBe('paused');
    expect(e.events(waiting.id).filter((event) => event.type === 'run.resumed')).toHaveLength(1);
  } finally {
    manager.stop();
    restarted?.stop();
    pausedAgain?.stop();
  }
});
