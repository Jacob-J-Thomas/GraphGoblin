import { RunManager } from './run-manager.js';
import { ShutdownCleanupError } from './errors.js';
import { expect, it, vi } from 'vitest';
import { createTestEngine, singleNodeLoop } from './testing/scenario.js';

it('force retains ownership when its heartbeat probe termination is unconfirmed', async () => {
  const e = await createTestEngine();
  e.manager.stop();
  let entered = false;
  const manager = new RunManager(
    {
      ...e.ports,
      scripts: {
        run(request) {
          entered = true;
          return new Promise((resolve) => {
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
                  terminationUnconfirmed: true,
                }),
              { once: true },
            );
          });
        },
      },
    },
    e.settings,
  );
  await manager.start();
  const v = e.publish(
    singleNodeLoop('force heartbeat cleanup', {
      id: 'work',
      kind: 'heartbeat',
      label: 'Probe',
      config: {
        intervalSeconds: 1,
        maxBeats: 2,
        probe: { kind: 'script', command: 'controlled' },
        record: 'full',
      },
    }),
  );
  const run = await manager.startRun({ ownerId: 'local', loopId: v.loopId, source: 'manual.api' });
  await vi.waitFor(() => expect(entered).toBe(true));
  try {
    await expect(manager.forceStop()).rejects.toBeInstanceOf(ShutdownCleanupError);
    expect((await e.ports.runs.get(run.id))?.failure).toMatchObject({
      code: 'SCRIPT_TERMINATION_UNCONFIRMED',
      nodeId: 'work',
      details: { interruptedByStop: true },
    });
    expect(manager.unconfirmedRunIds()).toEqual([run.id]);
  } finally {
    manager.stop();
  }
});

it('B1 normal drain completes with future timer and paused input unchanged', async () => {
  const e = await createTestEngine();
  const timer = e.publish(
    singleNodeLoop('future timer', {
      id: 'work',
      kind: 'wait',
      label: 'Wait',
      config: { mode: 'duration', seconds: 3600 },
    }),
  );
  const input = e.publish(
    singleNodeLoop('paused input', {
      id: 'work',
      kind: 'wait',
      label: 'Input',
      config: { mode: 'input', prompt: 'Answer' },
    }),
  );
  const a = await e.start(timer.loopId),
    b = await e.start(input.loopId);
  await e.manager.waitForIdle();
  await e.manager.pause(b.id);
  const before = await Promise.all([e.ports.runs.get(a.id), e.ports.runs.get(b.id)]);
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  let done = false;
  const drain = e.manager.waitForDrain().then(() => {
    done = true;
  });
  try {
    await vi.advanceTimersByTimeAsync(500);
    expect(done, 'durable parks must not hold a normal drain').toBe(true);
    expect(await Promise.all([e.ports.runs.get(a.id), e.ports.runs.get(b.id)])).toEqual(before);
  } finally {
    await vi.advanceTimersByTimeAsync(50);
    await drain;
    e.manager.stop();
    vi.useRealTimers();
  }
});

it('B1 force leaves future timer and paused input unchanged', async () => {
  const e = await createTestEngine();
  const timer = e.publish(
    singleNodeLoop('future force', {
      id: 'work',
      kind: 'wait',
      label: 'Wait',
      config: { mode: 'duration', seconds: 3600 },
    }),
  );
  const input = e.publish(
    singleNodeLoop('paused force', {
      id: 'work',
      kind: 'wait',
      label: 'Input',
      config: { mode: 'input', prompt: 'Answer' },
    }),
  );
  const a = await e.start(timer.loopId),
    b = await e.start(input.loopId);
  await e.manager.waitForIdle();
  await e.manager.pause(b.id);
  const before = await Promise.all([e.ports.runs.get(a.id), e.ports.runs.get(b.id)]);
  try {
    await e.manager.forceStop();
    expect(await Promise.all([e.ports.runs.get(a.id), e.ports.runs.get(b.id)])).toEqual(before);
  } finally {
    e.manager.stop();
  }
});

it('B3 an earlier unconfirmed script timeout does not block normal drain', async () => {
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
    terminationUnconfirmed: true,
  }));
  const v = e.publish(
    singleNodeLoop('earlier timeout', {
      id: 'work',
      kind: 'script',
      label: 'Script',
      config: { command: 'controlled-script' },
    }),
  );
  const run = await e.start(v.loopId);
  await e.manager.waitForIdle();
  expect((await e.ports.runs.get(run.id))?.failure?.code).toBe('SCRIPT_TERMINATION_UNCONFIRMED');
  try {
    await expect(e.manager.waitForDrain()).resolves.toBeUndefined();
  } finally {
    e.manager.stop();
  }
});

it('a due timer wakes during an open drain and holds it until the continuation parks again', async () => {
  const e = await createTestEngine({ maxConcurrentRuns: 2 });
  const work = singleNodeLoop('due continuation', {
    id: 'timer',
    kind: 'wait',
    label: 'Timer',
    config: { mode: 'duration', seconds: 1 },
  });
  work.nodes.push(
    {
      id: 'hold',
      kind: 'inference',
      label: 'Hold',
      config: { harness: 'codex', prompt: { template: 'Hold' } },
    },
    { id: 'park', kind: 'wait', label: 'Park', config: { mode: 'input', prompt: 'Answer' } },
  );
  work.edges = [
    { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'timer' } },
    { id: 'b', from: { node: 'timer', port: 'out' }, to: { node: 'hold' } },
    { id: 'c', from: { node: 'hold', port: 'out' }, to: { node: 'park' } },
    { id: 'd', from: { node: 'park', port: 'out' }, to: { node: 'done' } },
  ];
  const v = e.publish(work);
  const run = await e.start(v.loopId);
  await e.manager.waitForIdle();
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  try {
    e.ports.harness.script([{ delayMs: 1000, finalText: 'done' }]);
    e.ports.clock.advance(1000);
    // The scheduler need not have polled: drain itself must deliver an already-due wake.
    let done = false;
    const draining = e.manager.waitForDrain().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(e.ports.harness.started).toHaveLength(1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    await draining;
    expect((await e.ports.runs.get(run.id))?.waiting?.kind).toBe('input');
    expect(done).toBe(true);
  } finally {
    e.manager.stop();
    vi.useRealTimers();
  }
});

it('force interrupts queued family children but preserves an independent queued run', async () => {
  const e = await createTestEngine({ maxConcurrentRuns: 1 });
  e.ports.harness.script([{ delayMs: 60_000, finalText: 'late' }]);
  const v = e.publish(
    singleNodeLoop('queued force family', {
      id: 'work',
      kind: 'inference',
      label: 'Work',
      config: { harness: 'codex', prompt: { template: 'Hold' } },
    }),
  );
  const parent = await e.start(v.loopId);
  await vi.waitFor(() => expect(e.ports.harness.started).toHaveLength(1));
  const independent = await e.start(v.loopId);
  await e.manager.beginDrain();
  const child = await e.manager.startRun({
    ownerId: 'local',
    loopId: v.loopId,
    source: 'subloop',
    parentRunId: parent.id,
  });
  await e.manager.forceStop();
  expect((await e.ports.runs.get(parent.id))?.failure?.code).toBe('RUN_INTERRUPTED_BY_STOP');
  expect(await e.ports.runs.get(child.id)).toMatchObject({
    status: 'failed',
    failure: {
      code: 'RUN_INTERRUPTED_BY_STOP',
      details: { attempt: 0, effectMayHaveHappened: false },
    },
  });
  expect((await e.ports.runs.get(independent.id))?.status).toBe('queued');
  e.manager.stop();
});

it.each(['script', 'heartbeat'] as const)(
  'a %s timeout initiated before force remains a warning instead of this stop cleanup veto',
  async (kind) => {
    const e = await createTestEngine();
    e.manager.stop();

    let release!: () => void;
    let scriptStarted = false;
    let observedTimeout = false;
    const manager = new RunManager(
      {
        ...e.ports,
        scripts: {
          run(request) {
            scriptStarted = true;
            request.signal.addEventListener(
              'abort',
              () => {
                observedTimeout = true;
              },
              { once: true },
            );
            return new Promise((resolve) => {
              release = () =>
                resolve({
                  exitCode: null,
                  timedOut: true,
                  stdout: '',
                  stderr: '',
                  stdoutBytes: 0,
                  stderrBytes: 0,
                  stdoutOverflow: false,
                  stderrOverflow: false,
                  terminationUnconfirmed: true,
                });
            });
          },
        },
      },
      e.settings,
    );
    await manager.start();

    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    try {
      const v = e.publish(
        singleNodeLoop(
          'timeout before force',
          kind === 'script'
            ? {
                id: 'work',
                kind: 'script',
                label: 'Timeout',
                config: { command: 'controlled', timeoutSeconds: 1 },
              }
            : {
                id: 'work',
                kind: 'heartbeat',
                label: 'Probe',
                config: {
                  intervalSeconds: 1,
                  maxBeats: 2,
                  record: 'full',
                  probe: { kind: 'script', command: 'controlled', timeoutSeconds: 1 },
                },
              },
        ),
      );
      const run = await manager.startRun({
        ownerId: 'local',
        loopId: v.loopId,
        source: 'manual.api',
      });
      await vi.waitFor(() => expect(scriptStarted).toBe(true));
      await vi.advanceTimersByTimeAsync(1000);
      expect(observedTimeout, 'the authored timeout must happen before force').toBe(true);
      const forced = manager.forceStop();
      release();
      await vi.waitFor(async () => expect((await e.ports.runs.get(run.id))?.status).toBe('failed'));
      await vi.advanceTimersByTimeAsync(100);
      await forced;
      expect(manager.unconfirmedRunIds()).toEqual([run.id]);
      if (kind === 'script')
        expect((await e.ports.runs.get(run.id))?.failure).toMatchObject({
          code: 'SCRIPT_TERMINATION_UNCONFIRMED',
          details: { interruptedByStop: false },
        });
      else {
        expect((await e.ports.runs.get(run.id))?.failure?.code).toBe('RUN_INTERRUPTED_BY_STOP');
        expect(e.events(run.id).find((event) => event.type === 'heartbeat.beat')).toMatchObject({
          result: { timedOut: true, terminationUnconfirmed: true },
        });
      }
    } finally {
      manager.stop();
      vi.useRealTimers();
    }
  },
);

it('heartbeat unconfirmed timeout evidence still reaches the authored condition', async () => {
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
    terminationUnconfirmed: true,
  }));
  const v = e.publish(
    singleNodeLoop('heartbeat timeout policy', {
      id: 'work',
      kind: 'heartbeat',
      label: 'Probe',
      config: {
        intervalSeconds: 1,
        probe: { kind: 'script', command: 'controlled' },
        until: 'probe.timedOut',
        record: 'full',
      },
    }),
  );
  const run = await e.runToIdle(v.loopId);
  expect(run.status).toBe('succeeded');
  expect(e.events(run.id).find((event) => event.type === 'heartbeat.beat')).toMatchObject({
    result: { timedOut: true, terminationUnconfirmed: true },
  });
  expect(e.manager.unconfirmedRunIds()).toEqual([run.id]);
  await e.manager.waitForDrain();
  e.manager.stop();
});

it('force leaves a parked parent untouched when its executing child is interrupted', async () => {
  const e = await createTestEngine({ maxConcurrentRuns: 1 });
  e.ports.harness.script([{ delayMs: 60_000, finalText: 'late' }]);
  const leaf = e.publish(
    singleNodeLoop('active force leaf', {
      id: 'work',
      kind: 'inference',
      label: 'Hold',
      config: { harness: 'codex', prompt: { template: 'Hold' } },
    }),
  );
  const root = e.publish(
    singleNodeLoop('parked force parent', {
      id: 'sub',
      kind: 'subloop',
      label: 'Child',
      config: { loopRef: { loopId: leaf.loopId } },
    }),
  );
  const run = await e.start(root.loopId);
  await vi.waitFor(() => expect(e.ports.harness.started).toHaveLength(1));
  const before = await e.ports.runs.get(run.id);
  expect(before?.waiting?.kind).toBe('child');
  await e.manager.forceStop();
  expect(await e.ports.runs.get(run.id)).toEqual(before);
  const child = (await e.ports.runs.listChildren(run.id))[0]!;
  expect(child.failure?.code).toBe('RUN_INTERRUPTED_BY_STOP');
  e.manager.stop();
});

it('a timer becoming due during force cleanup remains an unchanged durable park', async () => {
  const e = await createTestEngine();
  e.manager.stop();
  let entered!: () => void, aborted!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const cancelling = new Promise<void>((resolve) => {
    aborted = resolve;
  });
  const manager = new RunManager(
    {
      ...e.ports,
      scripts: {
        run(request) {
          entered();
          request.signal.addEventListener('abort', () => aborted(), { once: true });
          return new Promise((resolve) => {
            release = () =>
              resolve({
                exitCode: null,
                timedOut: false,
                stdout: '',
                stderr: '',
                stdoutBytes: 0,
                stderrBytes: 0,
                stdoutOverflow: false,
                stderrOverflow: false,
              });
          });
        },
      },
    },
    e.settings,
  );
  await manager.start();
  const timer = e.publish(
    singleNodeLoop('timer during force', {
      id: 'work',
      kind: 'wait',
      label: 'Timer',
      config: { mode: 'duration', seconds: 1 },
    }),
  );
  const parked = await manager.startRun({
    ownerId: 'local',
    loopId: timer.loopId,
    source: 'manual.api',
  });
  await manager.waitForIdle();
  const before = await e.ports.runs.get(parked.id);
  const script = e.publish(
    singleNodeLoop('held cleanup', {
      id: 'work',
      kind: 'script',
      label: 'Script',
      config: { command: 'controlled' },
    }),
  );
  await manager.startRun({ ownerId: 'local', loopId: script.loopId, source: 'manual.api' });
  await started;
  const forced = manager.forceStop();
  await cancelling;
  try {
    e.ports.clock.advance(1000);
    await e.ports.timers.fireDue(e.ports.clock.now());
    expect(await e.ports.runs.get(parked.id)).toEqual(before);
  } finally {
    release();
    await forced;
    manager.stop();
  }
});
