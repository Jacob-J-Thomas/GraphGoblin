import { afterEach, expect, it, vi } from 'vitest';
import { RunManager } from './run-manager.js';
import { createTestEngine, singleNodeLoop, type TestEngine } from './testing/index.js';

let e: TestEngine | undefined;
let release: (() => void) | undefined;
afterEach(async () => {
  vi.useRealTimers();
  release?.();
  e?.manager.stop();
  if (e) {
    for (const row of await e.ports.runs.listRecoveryCandidates()) {
      const run = await e.ports.runs.get(row.id);
      if (run && ['running', 'queued', 'waiting', 'paused'].includes(run.status))
        await e.manager.cancel(run.id);
    }
    await e.manager.waitForIdle();
  }
});

function repairLoop() {
  return singleNodeLoop('Structured deadline', {
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
}

it('releases stalled structured work at the visible run deadline and admits the queued run', async () => {
  e = await createTestEngine({ maxConcurrentRuns: 1 });
  let signal: AbortSignal | undefined;
  e.ports.structured = {
    complete: (_request, supplied) => {
      signal = supplied;
      return new Promise((resolve) => {
        release = () => resolve({ value: 1 });
      });
    },
  };
  const def = repairLoop();
  def.settings = { runDeadlineSeconds: 1 };
  const loop = e.publish(def);
  const stalled = await e.start(loop.loopId);
  await expect.poll(() => signal !== undefined).toBe(true);
  const queued = await e.start(
    e.publish(
      singleNodeLoop('Next', {
        id: 'work',
        kind: 'mutate',
        label: 'Work',
        config: { operations: [{ op: 'delete', path: '/vars/missing' }] },
      }),
    ).loopId,
  );
  e.ports.clock.advance(1001);
  await expect
    .poll(async () => (await e!.ports.runs.get(stalled.id))?.status, { timeout: 2000 })
    .toBe('failed');
  expect(signal?.aborted).toBe(true);
  expect((await e.ports.runs.get(stalled.id))?.failure?.code).toBe('RUN_DEADLINE_EXCEEDED');
  await expect.poll(async () => (await e!.ports.runs.get(queued.id))?.status).toBe('succeeded');
  expect(
    e
      .events(stalled.id)
      .filter((event) => event.type === 'node.finished' && event.nodeId === 'repair'),
  ).toHaveLength(0);
});

it.each([null, 1000])(
  'finishes fast repair with completion limit %s',
  async (structuredTimeoutMs) => {
    e = await createTestEngine();
    e.ports.structured = { complete: () => Promise.resolve({ value: 7 }) };
    const def = repairLoop();
    def.settings = { structuredTimeoutMs };
    const run = await e.runToIdle(e.publish(def).loopId);
    expect(run.status).toBe('succeeded');
    expect((await e.manager.getThread(run.id))?.vars.value).toBe(7);
    expect(run.pinned.limits.structuredTimeoutMs).toBe(structuredTimeoutMs);
  },
);

it.each(['resolve', 'reject'] as const)(
  'times out stalled repair, frees capacity and discards late %s',
  async (outcome) => {
    e = await createTestEngine({ maxConcurrentRuns: 1 });
    let signal: AbortSignal | undefined;
    e.ports.structured = {
      complete: (_request, supplied) => {
        signal = supplied;
        return new Promise((resolve, reject) => {
          release = () =>
            outcome === 'resolve'
              ? resolve({ value: 99 })
              : reject(new Error('private provider diagnostics'));
        });
      },
    };
    const def = repairLoop();
    def.settings = { structuredTimeoutMs: 50 };
    const record = e.publish(def);
    const run = await e.start(record.loopId);
    await expect.poll(() => signal !== undefined).toBe(true);
    const next = await e.start(
      e.publish(
        singleNodeLoop('Capacity', {
          id: 'work',
          kind: 'script',
          label: 'Work',
          config: { command: 'fake' },
        }),
      ).loopId,
    );
    await expect.poll(async () => (await e!.ports.runs.get(run.id))?.status).toBe('failed');
    const failed = await e.ports.runs.get(run.id);
    expect(failed?.failure).toMatchObject({
      code: 'STRUCTURED_COMPLETION_TIMEOUT',
      nodeId: 'repair',
      details: { timeoutMs: 50 },
    });
    expect(failed?.failure?.message).toContain('50 ms');
    expect(signal?.aborted).toBe(true);
    await expect.poll(async () => (await e!.ports.runs.get(next.id))?.status).toBe('succeeded');
    const before = await e.manager.getThread(run.id);
    release!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await e.manager.getThread(run.id)).toEqual(before);
    expect(e.events(run.id).filter((event) => event.type === 'run.failed')).toHaveLength(1);
    expect(
      e
        .events(run.id)
        .filter((event) => event.type === 'node.finished' && event.nodeId === 'repair'),
    ).toHaveLength(0);
    expect(
      e.ports.logger.lines.filter((entry) => entry.msg === 'late structured completion discarded'),
    ).toHaveLength(1);
  },
);

it('Unlimited keeps stalled work running until explicit cancellation, with no timeout failure', async () => {
  vi.useFakeTimers();
  e = await createTestEngine();
  let signal: AbortSignal | undefined;
  e.ports.structured = {
    complete: (_request, supplied) => {
      signal = supplied;
      return new Promise((resolve) => {
        release = () => resolve({ value: 99 });
      });
    },
  };
  const def = repairLoop();
  def.settings = { structuredTimeoutMs: null, runDeadlineSeconds: null, maxNodeVisits: null };
  const run = await e.start(e.publish(def).loopId);
  await vi.advanceTimersByTimeAsync(20);
  expect(signal).toBeDefined();
  e.manager.stop();
  await vi.advanceTimersByTimeAsync(120_001);
  e.ports.clock.advance(24 * 60 * 60 * 1000);
  expect((await e.ports.runs.get(run.id))?.status).toBe('running');
  await e.manager.cancel(run.id);
  expect((await e.settle(run.id)).status).toBe('cancelled');
  expect(signal?.aborted).toBe(true);
  release!();
  await vi.advanceTimersByTimeAsync(0);
  expect((await e.ports.runs.get(run.id))?.failure).toBeUndefined();
  expect((await e.manager.getThread(run.id))?.vars.value).toBeUndefined();
});

it('keeps the timeout when cancellation arrives during failure persistence', async () => {
  vi.useFakeTimers();
  e = await createTestEngine();
  let signal: AbortSignal | undefined;
  let finishPersistence!: () => void;
  let failureWritten!: () => void;
  const persistence = new Promise<void>((resolve) => {
    finishPersistence = resolve;
  });
  const written = new Promise<void>((resolve) => {
    failureWritten = resolve;
  });
  // Fault-inject the event-store port: the terminal event is durable, but its append
  // acknowledgement (and therefore the run snapshot update) remains in flight.
  const append = e.ports.events.append.bind(e.ports.events);
  e.ports.events.append = async (...args) => {
    const stored = await append(...args);
    if (args[1].some((event) => event.type === 'run.failed')) {
      failureWritten();
      await persistence;
    }
    return stored;
  };
  e.ports.structured = {
    complete: (_request, supplied) => {
      signal = supplied;
      return new Promise((resolve) => {
        release = () => {
          finishPersistence();
          resolve({ value: 99 });
        };
      });
    },
  };
  const def = repairLoop();
  def.settings = { structuredTimeoutMs: 100 };
  const run = await e.start(e.publish(def).loopId);
  await vi.advanceTimersByTimeAsync(20);
  expect(signal).toBeDefined();
  await vi.advanceTimersByTimeAsync(101);
  await written;
  expect(signal?.aborted).toBe(true);
  expect((await e.ports.runs.get(run.id))?.status).toBe('running');
  await e.manager.cancel(run.id);
  expect(e.eventTypes(run.id)).toContain('run.cancel_requested');
  finishPersistence();
  const final = await e.settle(run.id);
  expect(final.status).toBe('failed');
  expect(final.failure?.code).toBe('STRUCTURED_COMPLETION_TIMEOUT');
  release!();
  await vi.advanceTimersByTimeAsync(1000);
  expect(
    e
      .events(run.id)
      .filter((event) => ['run.failed', 'run.cancelled', 'run.finished'].includes(event.type)),
  ).toMatchObject([{ type: 'run.failed', failure: { code: 'STRUCTURED_COMPLETION_TIMEOUT' } }]);
  expect((await e.ports.runs.get(run.id))?.failure).toEqual(final.failure);
  expect((await e.manager.getThread(run.id))?.vars.value).toBeUndefined();
});

it.each(['AbortError', 'forwarded reason'] as const)(
  'does not warn about an adapter cancellation acknowledgement: %s',
  async (acknowledgement) => {
    vi.useFakeTimers();
    e = await createTestEngine();
    e.ports.structured = {
      complete: (_request, signal) =>
        new Promise((_resolve, reject) => {
          release = () => {
            if (acknowledgement === 'AbortError')
              reject(new DOMException('The operation was aborted', 'AbortError'));
            else if (signal.reason instanceof Error) reject(signal.reason);
            else throw new Error('Forwarded cancellation reason must be an Error');
          };
        }),
    };
    const def = repairLoop();
    def.settings = { structuredTimeoutMs: 100 };
    const run = await e.start(e.publish(def).loopId);
    await vi.advanceTimersByTimeAsync(101);
    await e.manager.waitForIdle();
    expect((await e.ports.runs.get(run.id))?.failure?.code).toBe('STRUCTURED_COMPLETION_TIMEOUT');
    release!();
    await vi.advanceTimersByTimeAsync(0);
    expect(
      e.ports.logger.lines.filter((line) => line.msg === 'late structured completion discarded'),
    ).toHaveLength(0);
  },
);

it('applies the same deadline to LLM routing without replacing it with a generic provider failure', async () => {
  e = await createTestEngine();
  let signal: AbortSignal | undefined;
  e.ports.deciders = [
    {
      id: 'codex',
      available: () => true,
      route: (_request, supplied) => {
        signal = supplied;
        return new Promise((resolve) => {
          release = () => resolve({ route: 'yes', confidence: 1, reasoning: 'late' });
        });
      },
    },
  ];
  const def = singleNodeLoop('Route timeout', {
    id: 'route',
    kind: 'decision',
    label: 'Route',
    config: {
      kind: 'llm',
      harness: 'codex',
      model: { mode: 'inherit' },
      effort: { mode: 'inherit' },
      instructions: 'Choose',
      routes: [
        { id: 'yes', label: 'Yes' },
        { id: 'no', label: 'No' },
      ],
    },
  });
  def.settings = { structuredTimeoutMs: 50 };
  def.edges.push(
    ...['yes', 'no'].map((port) => ({
      id: port,
      from: { node: 'route', port },
      to: { node: 'done' },
    })),
  );
  const run = await e.runToIdle(e.publish(def).loopId);
  expect(run.failure?.code).toBe('STRUCTURED_COMPLETION_TIMEOUT');
  expect(run.failure?.details).toMatchObject({
    timeoutMs: 50,
    provenance: { kind: 'llm', provider: 'codex', model: 'gpt-6-luna', effort: 'low' },
  });
  expect(signal?.aborted).toBe(true);
  release!();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(e.eventTypes(run.id)).not.toContain('decision.made');
  expect((await e.manager.getThread(run.id))?.outputs.route).toBeUndefined();
});

it.each(['resolve', 'reject'] as const)(
  'enforces elapsed time on %s even before the delayed timer callback runs',
  async (outcome) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    e = await createTestEngine();
    let signal: AbortSignal | undefined;
    e.ports.structured = {
      complete: (_request, supplied) => {
        signal = supplied;
        return new Promise((resolve, reject) => {
          release = () =>
            outcome === 'resolve' ? resolve({ value: 9 }) : reject(new Error('late'));
        });
      },
    };
    const def = repairLoop();
    def.settings = { structuredTimeoutMs: 1000 };
    const run = await e.start(e.publish(def).loopId);
    await expect.poll(() => signal !== undefined).toBe(true);
    vi.setSystemTime(Date.now() + 1001);
    release!();
    await e.manager.waitForIdle();
    expect((await e.ports.runs.get(run.id))?.failure?.code).toBe('STRUCTURED_COMPLETION_TIMEOUT');
    expect(
      e.ports.logger.lines.filter((line) => line.msg === 'late structured completion discarded'),
    ).toHaveLength(1);
  },
);

it('rearms long completion timers without Node timer overflow', async () => {
  vi.useFakeTimers();
  e = await createTestEngine();
  let signal: AbortSignal | undefined;
  e.ports.structured = {
    complete: (_request, supplied) => {
      signal = supplied;
      return new Promise((resolve) => {
        release = () => resolve({ value: 9 });
      });
    },
  };
  const def = repairLoop();
  def.settings = { structuredTimeoutMs: 2_147_483_650 };
  const run = await e.start(e.publish(def).loopId);
  await vi.advanceTimersByTimeAsync(20);
  expect(signal).toBeDefined();
  e.manager.stop(); // Stop the unrelated periodic admission sweep before advancing days.
  await vi.advanceTimersByTimeAsync(2_147_483_647 - 20);
  expect((await e.ports.runs.get(run.id))?.status).toBe('running');
  await vi.advanceTimersByTimeAsync(25);
  expect((await e.ports.runs.get(run.id))?.failure?.code).toBe('STRUCTURED_COMPLETION_TIMEOUT');
});

it('retains the completion pin when a failed run resumes after manager restart and a new publication', async () => {
  e = await createTestEngine();
  e.ports.structured = { complete: () => new Promise(() => {}) };
  const def = repairLoop();
  def.settings = { structuredTimeoutMs: 20 };
  const record = e.publish(def);
  const run = await e.runToIdle(record.loopId);
  expect(run.failure?.code).toBe('STRUCTURED_COMPLETION_TIMEOUT');
  e.manager.stop();
  def.settings = { structuredTimeoutMs: null };
  e.publish(def, { version: 2 });
  const restarted = new RunManager(e.ports, e.settings);
  e.manager = restarted;
  await restarted.start();
  await restarted.resume(run.id);
  await restarted.waitForIdle();
  expect((await e.ports.runs.get(run.id))?.pinned.limits.structuredTimeoutMs).toBe(20);
  expect(e.events(run.id).filter((event) => event.type === 'run.failed')).toHaveLength(2);
});
