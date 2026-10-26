import { expect, it, vi } from 'vitest';
import { createTestEngine, singleNodeLoop } from '@graphgoblin/engine/testing';
import { RunManager } from '@graphgoblin/engine';
import { ShutdownController } from './shutdown.js';

it('B3 reports an earlier unconfirmed timeout but completes a normal stop', async () => {
  const e = await createTestEngine();
  e.ports.scripts.respondWith(() => ({
    exitCode: null,
    timedOut: true,
    stdout: '',
    stderr: '',
    stdoutBytes: 0,
    stderrBytes: 0,
    stdoutOverflow: false,
    stderrOverflow: false,
    state: 'outcome-uncertain',
    terminationUnconfirmed: true,
  }));
  const v = e.publish(
    singleNodeLoop('unconfirmed', {
      id: 'work',
      kind: 'script',
      label: 'Work',
      config: { command: 'controlled-native' },
    }),
  );
  const run = await e.start(v.loopId);
  await e.manager.waitForIdle();
  const controller = new ShutdownController(e.manager, 300_000, () => undefined, e.ports.logger);
  await controller.request('drain');
  await controller.ready;
  expect(controller.state()).toMatchObject({ phase: 'ready', unconfirmedRunIds: [run.id] });
  expect((await e.ports.runs.get(run.id))?.failure?.code).toBe('SCRIPT_TERMINATION_UNCONFIRMED');
  e.manager.stop();
});

it('B3 force failure offers an explicit nonzero exit acknowledgement, retaining the failure', async () => {
  const e = await createTestEngine();
  let entered!: () => void;
  const running = new Promise<void>((resolve) => {
    entered = resolve;
  });
  e.manager.stop();
  const manager = new RunManager(
    {
      ...e.ports,
      scripts: {
        run: (request) =>
          new Promise((resolve) => {
            entered();
            request.signal.addEventListener(
              'abort',
              () =>
                resolve({
                  exitCode: null,
                  timedOut: false,
                  stdout: '',
                  stderr: '',
                  stdoutBytes: 0,
                  stderrBytes: 0,
                  stdoutOverflow: false,
                  stderrOverflow: false,
                  state: 'outcome-uncertain',
                  terminationUnconfirmed: true,
                }),
              { once: true },
            );
          }),
      },
    },
    e.settings,
  );
  await manager.start();
  const v = e.publish(
    singleNodeLoop('force unconfirmed', {
      id: 'work',
      kind: 'script',
      label: 'Work',
      config: { command: 'controlled-native' },
    }),
  );
  const run = await manager.startRun({ ownerId: 'local', loopId: v.loopId, source: 'manual.api' });
  await running;
  const controller = new ShutdownController(manager, 300_000, () => undefined, e.ports.logger);
  await controller.request('force');
  await vi.waitFor(() => expect(controller.state().phase).toBe('force-failed'));
  expect(controller.closing.signal.aborted).toBe(false);
  const failure = (await e.ports.runs.get(run.id))?.failure;
  expect(failure?.code).toBe('SCRIPT_TERMINATION_UNCONFIRMED');
  await expect(controller.request('wait')).rejects.toMatchObject({
    state: { phase: 'force-failed' },
  });
  expect(await controller.request('force')).toMatchObject({
    phase: 'exiting',
    unconfirmedRunIds: [run.id],
  });
  await controller.abandoned;
  expect((await e.ports.runs.get(run.id))?.failure).toEqual(failure);
  expect(controller.closing.signal.aborted).toBe(false);
  manager.stop();
});

it('labels a drain observation failure accurately and rejects invalid transitions', async () => {
  const e = await createTestEngine();
  const controller = new ShutdownController(
    {
      beginDrain: () => Promise.resolve(),
      waitForDrain: () => Promise.reject(new Error('store read failed')),
      forceStop: () => Promise.resolve(),
      drainingRunIds: () => [],
      unconfirmedRunIds: () => [],
    },
    300_000,
    () => undefined,
    e.ports.logger,
  );
  await expect(controller.request('wait')).rejects.toMatchObject({ state: { phase: 'running' } });
  await controller.request('drain');
  await vi.waitFor(() => expect(controller.state().phase).toBe('drain-failed'));
  await expect(controller.request('force')).rejects.toMatchObject({
    state: { phase: 'drain-failed' },
  });
  e.manager.stop();
});

it('captures admission before returning state and wait has no hidden kill timer', async () => {
  vi.useFakeTimers();
  const e = await createTestEngine();
  let captured!: () => void, finish!: () => void;
  const admission = new Promise<void>((resolve) => {
    captured = resolve;
  });
  const draining = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let ids: string[] = [];
  const controller = new ShutdownController(
    {
      beginDrain: () => admission,
      waitForDrain: () => draining,
      forceStop: () => Promise.resolve(),
      drainingRunIds: () => ids,
      unconfirmedRunIds: () => [],
    },
    300_000,
    () => undefined,
    e.ports.logger,
  );
  try {
    const response = controller.request('drain');
    ids = ['active'];
    captured();
    expect(await response).toMatchObject({ activeRunIds: ['active'] });
    await vi.advanceTimersByTimeAsync(300_000);
    expect(controller.state().phase).toBe('awaiting-choice');
    await controller.request('wait');
    await vi.advanceTimersByTimeAsync(86_400_000);
    expect(controller.state()).toMatchObject({ phase: 'draining', activeRunIds: ['active'] });
    finish();
    await controller.ready;
  } finally {
    e.manager.stop();
    vi.useRealTimers();
  }
});

it.each(['drain-first', 'force-first'] as const)(
  'does not publish ready until drain and force cleanup both finish: %s',
  async (order) => {
    vi.useFakeTimers();
    let drained!: () => void, cleaned!: () => void;
    const drain = new Promise<void>((resolve) => {
      drained = resolve;
    });
    const force = new Promise<void>((resolve) => {
      cleaned = resolve;
    });
    const e = await createTestEngine();
    try {
      const controller = new ShutdownController(
        {
          beginDrain: () => Promise.resolve(),
          waitForDrain: () => drain,
          forceStop: () => force,
          drainingRunIds: () => [],
          unconfirmedRunIds: () => [],
        },
        300_000,
        () => undefined,
        e.ports.logger,
      );
      await controller.request('force');
      if (order === 'drain-first') drained();
      else cleaned();
      await vi.advanceTimersByTimeAsync(0);
      expect(controller.state().phase).toBe('forcing');
      expect(controller.closing.signal.aborted).toBe(false);
      if (order === 'drain-first') cleaned();
      else drained();
      await vi.advanceTimersByTimeAsync(0);
      expect(controller.state().phase).toBe('ready');
      expect(controller.closing.signal.aborted).toBe(true);
    } finally {
      e.manager.stop();
      vi.useRealTimers();
    }
  },
);

it('an observation failure during an open drain keeps its origin when force races it', async () => {
  const e = await createTestEngine();
  let rejectDrain!: (error: Error) => void;
  const draining = new Promise<void>((_resolve, reject) => {
    rejectDrain = reject;
  });
  const controller = new ShutdownController(
    {
      beginDrain: () => Promise.resolve(),
      waitForDrain: () => draining,
      forceStop: () => Promise.resolve(),
      drainingRunIds: () => [],
      unconfirmedRunIds: () => [],
    },
    300_000,
    () => undefined,
    e.ports.logger,
  );
  await controller.request('drain');
  await controller.request('force');
  rejectDrain(new Error('drain observation failed'));
  await vi.waitFor(() => expect(controller.state().phase).toBe('drain-failed'));
  await expect(controller.request('force')).rejects.toMatchObject({
    state: { phase: 'drain-failed' },
  });
  e.manager.stop();
});
