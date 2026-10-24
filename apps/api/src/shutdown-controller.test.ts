import { expect, it, vi } from 'vitest';
import { createTestEngine, singleNodeLoop } from '@graphgoblin/engine/testing';
import { ShutdownController } from './shutdown.js';

it('retains observation and ownership intent after unconfirmed native cleanup', async () => {
  const e = await createTestEngine();
  e.ports.scripts.respondWith(() => ({
    exitCode: null,
    timedOut: false,
    stdout: '',
    stderr: '',
    stdoutBytes: 0,
    stderrBytes: 0,
    stdoutOverflow: false,
    stderrOverflow: false,
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
  controller.request('force');
  await vi.waitFor(() => expect(controller.state().phase).toBe('force-failed'));
  expect(controller.closing.signal.aborted).toBe(false);
  expect(controller.state().error).toContain('ownership retained');
  expect(controller.request('force').phase).toBe('force-failed');
  expect(controller.request('wait').phase).toBe('force-failed');
  expect((await e.ports.runs.get(run.id))?.failure?.code).toBe('SCRIPT_TERMINATION_UNCONFIRMED');
  await expect(controller.drain()).rejects.toThrow('termination unconfirmed');
  e.manager.stop();
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
        },
        300_000,
        () => undefined,
        e.ports.logger,
      );
      controller.request('force');
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
