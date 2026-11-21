import { expect, it, vi } from 'vitest';
import { createTestEngine, singleNodeLoop } from './testing/index.js';

it('explicit cancellation wins before an enabled completion deadline and discards its late value', async () => {
  vi.useFakeTimers();
  const e = await createTestEngine();
  let signal: AbortSignal | undefined;
  let late: (() => void) | undefined;
  e.ports.structured = {
    complete: (_request, supplied) => {
      signal = supplied;
      return new Promise((resolve) => {
        late = () => resolve({ value: 99 });
      });
    },
  };
  try {
    const def = singleNodeLoop('Cancel before deadline', {
      id: 'repair',
      kind: 'mutate',
      label: 'Repair',
      config: {
        operations: [
          {
            op: 'coerce',
            source: '/vars/value',
            target: '/vars/value',
            jsonSchema: { type: 'number' },
            repair: { enabled: true, maxAttempts: 1 },
          },
        ],
      },
    });
    def.settings = { structuredTimeoutMs: 1000 };
    const run = await e.start(e.publish(def).loopId);
    await vi.advanceTimersByTimeAsync(20);
    expect(signal).toBeDefined();
    expect(signal?.aborted).toBe(false);
    await e.manager.cancel(run.id);
    await e.manager.waitForIdle();
    expect((await e.ports.runs.get(run.id))?.status).toBe('cancelled');
    expect((await e.ports.runs.get(run.id))?.failure).toBeUndefined();
    expect(signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    late!();
    await vi.advanceTimersByTimeAsync(0);
    expect(e.events(run.id).filter((event) => event.type === 'run.cancelled')).toHaveLength(1);
    expect(e.eventTypes(run.id)).not.toContain('run.failed');
    expect((await e.manager.getThread(run.id))?.vars.value).toBeUndefined();
  } finally {
    e.manager.stop();
    vi.useRealTimers();
    late?.();
    for (const row of await e.ports.runs.listRecoveryCandidates()) {
      const run = await e.ports.runs.get(row.id);
      if (run && ['running', 'queued', 'waiting', 'paused'].includes(run.status))
        await e.manager.cancel(run.id);
    }
    await e.manager.waitForIdle();
  }
});
