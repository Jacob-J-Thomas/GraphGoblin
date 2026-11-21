import { expect, it, vi } from 'vitest';
import { RunManager } from './run-manager.js';
import type { ScriptRunResult } from './ports.js';
import { createTestEngine, singleNodeLoop } from './testing/scenario.js';

it('force preserves its non-resumable stop cause and uncertain script provenance', async () => {
  const e = await createTestEngine();
  e.manager.stop();
  let entered = false;
  let calls = 0;
  const manager = new RunManager(
    {
      ...e.ports,
      scripts: {
        run: (request) =>
          new Promise<ScriptRunResult>((resolve) => {
            entered = true;
            calls++;
            request.signal.addEventListener(
              'abort',
              () =>
                resolve({
                  state: 'completed',
                  exitCode: null,
                  timedOut: false,
                  stdout: '',
                  stderr: '',
                  stdoutBytes: 0,
                  stderrBytes: 0,
                  stdoutOverflow: false,
                  stderrOverflow: false,
                }),
              { once: true },
            );
          }),
      },
    },
    e.settings,
  );
  await manager.start();
  const version = e.publish(
    singleNodeLoop('stopped script', {
      id: 'work',
      kind: 'script',
      label: 'Work',
      config: { command: 'controlled' },
    }),
  );
  const run = await manager.startRun({
    ownerId: 'local',
    loopId: version.loopId,
    source: 'manual.api',
  });
  await vi.waitFor(() => expect(entered).toBe(true));
  try {
    await manager.forceStop();
    expect((await e.ports.runs.get(run.id))?.failure).toMatchObject({
      code: 'RUN_INTERRUPTED_BY_STOP',
      resumable: false,
      script: { state: 'outcome-uncertain' },
      details: { effectMayHaveHappened: true },
    });
    await expect(manager.resume(run.id)).rejects.toThrow();
    expect(calls).toBe(1);
  } finally {
    manager.stop();
  }
});
