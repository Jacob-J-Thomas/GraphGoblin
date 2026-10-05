import { describe, expect, it } from 'vitest';
import type { LoopDefinitionInput, RunEvent } from '@graphgoblin/contracts';
import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import {
  FIXTURE_IDS,
  FIXTURE_TS,
  fakeUlid,
  kitchenSinkLoop,
  minimalLoop,
} from '@graphgoblin/contracts/testing';
import {
  EngineRequestError,
  RunManager,
  attemptFor,
  countEntries,
  findPendingWake,
} from './run-manager.js';
import { createTestEngine, singleNodeLoop } from './testing/scenario.js';
import { createFakePorts, DEFAULT_TEST_SETTINGS } from './testing/fakes.js';
import { createInitialThread } from './thread.js';

describe('a minimal run', () => {
  it.each(['DECIDER_HTTP_ERROR', 'DECIDER_private-marker'])(
    'guards raw coded exceptions at the manager boundary (%s)',
    async (code) => {
      const engine = await createTestEngine();
      engine.ports.scripts.run = () =>
        Promise.reject(
          Object.assign(new Error('private-marker'), { code, name: 'private-marker', status: 400 }),
        );
      const version = engine.publish(
        singleNodeLoop('raw-provider-error', {
          id: 'script',
          kind: 'script',
          label: 'Script',
          config: { command: 'unused' },
        }),
      );
      const run = await engine.runToIdle(version.loopId);
      expect(run.failure).toMatchObject({
        code: 'INTERNAL_ERROR',
        message: 'Decision provider request failed',
        details: { code: code === 'DECIDER_HTTP_ERROR' ? code : 'DECIDER_ERROR' },
      });
      expect(JSON.stringify([run, engine.events(run.id), engine.ports.logger.lines])).not.toContain(
        'private-marker',
      );
      expect(engine.ports.logger.lines).toContainEqual(
        expect.objectContaining({
          level: 'warn',
          obj: expect.objectContaining({ name: 'Error', status: 400 }),
        }),
      );
    },
  );
  it('runs trigger to exit and records the expected events', async () => {
    const engine = await createTestEngine();
    const version = engine.publish(minimalLoop());
    const run = await engine.runToIdle(version.loopId, { hello: 'world' });

    expect(run.status).toBe('succeeded');
    expect(run.outcome).toBe('success');
    expect(run.currentNodeId).toBeUndefined();
    expect(run.finishedAt).toBeDefined();
    expect(engine.eventTypes(run.id)).toEqual([
      'run.queued',
      'run.started',
      'node.started',
      'node.finished',
      'node.started',
      'node.finished',
      'run.finished',
    ]);
    const thread = await engine.manager.getThread(run.id);
    expect(thread?.outputs['start']?.value).toEqual({ hello: 'world' });
    expect(thread?.lastOutput?.value).toEqual({ hello: 'world' });
    expect(thread?.counters.nodeVisits).toEqual({ start: 1, done: 1 });
    expect(thread?.invocation.trigger.payload).toEqual({ hello: 'world' });
  });

  it('defaults a null payload, picks the manual trigger, and validates trigger input', async () => {
    const engine = await createTestEngine();
    const loop = minimalLoop();
    loop.nodes[0] = {
      id: 'start',
      kind: 'trigger',
      label: 'Start',
      config: { subtype: 'manual', inputSchema: { type: 'object', required: ['topic'] } },
    };
    const version = engine.publish(loop);
    await expect(engine.start(version.loopId)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const run = await engine.runToIdle(version.loopId, { topic: 'x' });
    expect(run.status).toBe('succeeded');
  });

  it('rejects unknown loops, drafts, and unknown triggers', async () => {
    const engine = await createTestEngine();
    await expect(engine.start(FIXTURE_IDS.loop)).rejects.toMatchObject({ code: 'LOOP_NOT_FOUND' });
    const draft = engine.publish(minimalLoop(), {
      status: 'draft',
      loopId: engine.loopId('draft'),
    });
    await expect(engine.start(draft.loopId)).rejects.toMatchObject({ code: 'LOOP_NOT_FOUND' });
    await expect(engine.start(draft.loopId, null, { versionId: draft.id })).rejects.toMatchObject({
      code: 'VERSION_NOT_PUBLISHED',
    });
    const allowed = await engine.runToIdle(draft.loopId, null, {
      versionId: draft.id,
      allowDraft: true,
    });
    expect(allowed.status).toBe('succeeded');
    const published = engine.publish(minimalLoop());
    await expect(
      engine.start(published.loopId, null, { triggerNodeId: 'nope' }),
    ).rejects.toMatchObject({ code: 'TRIGGER_NOT_FOUND' });
    await expect(
      engine.start(published.loopId, null, { versionId: draft.id }),
    ).rejects.toMatchObject({ code: 'LOOP_NOT_FOUND' });
  });

  it('uses the first trigger when there is no manual one and the explicit one when named', async () => {
    const engine = await createTestEngine();
    const loop = minimalLoop();
    loop.nodes[0] = {
      id: 'start',
      kind: 'trigger',
      label: 'Cron',
      config: { subtype: 'cron', expression: '* * * * *' },
    };
    const version = engine.publish(loop);
    const run = await engine.runToIdle(version.loopId, null, { source: 'cron' });
    expect(run.status).toBe('succeeded');
    const thread = await engine.manager.getThread(run.id);
    expect(thread?.invocation.trigger.kind).toBe('cron');
    const explicit = await engine.runToIdle(version.loopId, null, {
      triggerNodeId: 'start',
      triggerKind: 'webhook',
    });
    const explicitThread = await engine.manager.getThread(explicit.id);
    expect(explicitThread?.invocation.trigger.kind).toBe('webhook');
  });
});

describe('run control', () => {
  it('keeps timers running during a fast graph cycle, so the cycle can be cancelled', async () => {
    const engine = await createTestEngine();
    const loop = singleNodeLoop('cycle', {
      id: 'pick',
      kind: 'decision',
      label: 'Pick',
      config: {
        routes: [
          { label: 'again', description: 'loop' },
          { label: 'stop', description: 'finish' },
        ],
        question: 'again?',
        strategy: ['expression'],
        expression: { jsonata: '"again"' },
      },
    });
    loop.edges.push(
      { id: 'e2', from: { node: 'pick', port: 'again' }, to: { node: 'pick' } },
      { id: 'e3', from: { node: 'pick', port: 'stop' }, to: { node: 'done' } },
    );
    // A high ceiling keeps the visit cap out of the way: this test is about yielding.
    loop.settings = { maxIterations: 10_000 };
    const version = engine.publish(loop);
    const run = await engine.start(version.loopId);
    // A timer firing at all proves the executor yields; before the fix this await never returned.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(engine.eventTypes(run.id).filter((t) => t === 'decision.made').length).toBeGreaterThan(
      1,
    );
    await engine.manager.cancel(run.id);
    expect((await engine.settle(run.id)).status).toBe('cancelled');
  });

  it('stops before the next node when a pause lands during the yield between nodes', async () => {
    const engine = await createTestEngine();
    const loop = singleNodeLoop('pause-yield', {
      id: 'note',
      kind: 'mutate',
      label: 'Note',
      config: { operations: [{ op: 'append-message', role: 'note', content: 'hi' }] },
    });
    const version = engine.publish(loop);
    const store = engine.ports.events;
    const original = store.append.bind(store);
    let pausing: Promise<unknown> | undefined;
    store.append = async (runId, drafts) => {
      const appended = await original(runId, drafts);
      // The trigger just finished; the executor is about to yield before the next node.
      if (!pausing && drafts.some((d) => d.type === 'node.finished' && d.nodeId === 'start')) {
        pausing = new Promise((resolve) => setTimeout(resolve, 0)).then(() =>
          engine.manager.pause(runId),
        );
      }
      return appended;
    };
    const run = await engine.start(version.loopId);
    await engine.manager.waitForIdle();
    await pausing;
    const types = engine.eventTypes(run.id);
    const pausedAt = types.indexOf('run.paused');
    expect(pausedAt).toBeGreaterThan(0);
    expect(types.slice(pausedAt)).not.toContain('node.started');
    expect((await engine.ports.runs.get(run.id))?.status).toBe('paused');
    // Resuming continues from the next node.
    await engine.manager.resume(run.id);
    expect((await engine.settle(run.id)).status).toBe('succeeded');
  });

  it('cancels a queued run before it starts', async () => {
    const engine = await createTestEngine({ maxConcurrentRuns: 1 });
    const version = engine.publish(
      singleNodeLoop('slow', {
        id: 'wait',
        kind: 'wait',
        label: 'W',
        config: { mode: 'signal', name: 'go' },
      }),
    );
    const first = await engine.start(version.loopId);
    const second = await engine.start(version.loopId);
    await engine.manager.cancel(second.id, { kind: 'user', id: 'u' });
    const cancelled = await engine.ports.runs.get(second.id);
    expect(cancelled?.status).toBe('cancelled');
    expect(engine.eventTypes(second.id)).toEqual([
      'run.queued',
      'run.cancel_requested',
      'run.cancelled',
    ]);
    await engine.manager.waitForIdle();
    expect((await engine.ports.runs.get(first.id))?.status).toBe('waiting');
    await expect(engine.manager.cancel(second.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('cancels a waiting run and is idempotent on repeated requests', async () => {
    const engine = await createTestEngine();
    const version = engine.publish(
      singleNodeLoop('w', {
        id: 'wait',
        kind: 'wait',
        label: 'W',
        config: { mode: 'input', prompt: 'ok?' },
      }),
    );
    const run = await engine.runToIdle(version.loopId);
    expect(run.status).toBe('waiting');
    const once = await engine.manager.cancel(run.id);
    expect(once.status).toBe('cancelled');
    expect(engine.eventTypes(run.id)).toContain('run.cancelled');
  });

  it('pauses a queued run and resumes it later', async () => {
    const engine = await createTestEngine();
    const version = engine.publish(kitchenSinkLoopWithoutHeavyNodes());
    const run = await engine.start(version.loopId);
    const paused = await engine.manager.pause(run.id, { kind: 'user', id: 'u' });
    expect(paused.status).toBe('paused');
    await engine.manager.waitForIdle();
    expect((await engine.ports.runs.get(run.id))?.status).toBe('paused');
    await expect(engine.manager.pause(run.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await engine.manager.resume(run.id, { kind: 'user', id: 'u' });
    const done = await engine.settle(run.id);
    expect(done.status).toBe('succeeded');
    expect(engine.eventTypes(run.id)).toEqual(
      expect.arrayContaining(['run.paused', 'run.resumed', 'run.started']),
    );
    await expect(engine.manager.resume(run.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('pauses a running run after the current node and resumes from the next one', async () => {
    const engine = await createTestEngine();
    engine.ports.harness.script([{ finalText: 'slow', delayMs: 150 }]);
    const version = engine.publish(
      singleNodeLoop('slow', {
        id: 'infer',
        kind: 'inference',
        label: 'I',
        config: { prompt: { template: 'go' } },
      }),
    );
    const run = await engine.start(version.loopId);
    await waitFor(() => engine.eventTypes(run.id).includes('harness.session'));
    await engine.manager.pause(run.id, { kind: 'user', id: 'u' });
    await engine.manager.waitForIdle();
    const afterPause = await engine.ports.runs.get(run.id);
    expect(afterPause?.status).toBe('paused');
    expect(afterPause?.currentNodeId).toBe('done');
    expect(
      engine
        .events(run.id)
        .filter((e) => e.type === 'node.finished')
        .map((e) => (e.type === 'node.finished' ? e.nodeId : '')),
    ).toEqual(['start', 'infer']);
    await engine.manager.resume(run.id, { kind: 'user', id: 'u' });
    const done = await engine.settle(run.id);
    expect(done.status).toBe('succeeded');
    expect(engine.ports.harness.started).toHaveLength(1);
  });

  it('pauses a waiting run; on resume it waits again with its deadline, and a missed timer fires', async () => {
    const engine = await createTestEngine();
    const version = engine.publish(
      singleNodeLoop('w', {
        id: 'wait',
        kind: 'wait',
        label: 'W',
        config: { mode: 'duration', seconds: 60 },
      }),
    );
    const run = await engine.runToIdle(version.loopId);
    expect(run.status).toBe('waiting');
    expect(engine.ports.timers.scheduled).toHaveLength(1);
    await engine.manager.pause(run.id);
    engine.ports.clock.advance(61_000);
    // The timer fires while paused: ignored, and consumed.
    expect(await engine.ports.timers.fireDue(engine.ports.clock.now())).toBe(1);
    await engine.manager.waitForIdle();
    expect((await engine.ports.runs.get(run.id))?.status).toBe('paused');
    // Resume goes back to waiting on the same wait (no new run.waiting) and re-arms its timer.
    const resumed = await engine.manager.resume(run.id);
    expect(resumed).toMatchObject({ status: 'waiting', waiting: { until: run.waiting?.until } });
    expect(engine.eventTypes(run.id).filter((t) => t === 'run.waiting')).toHaveLength(1);
    expect(engine.ports.timers.scheduled).toHaveLength(1);
    expect(await engine.ports.timers.fireDue(engine.ports.clock.now())).toBe(1);
    expect((await engine.settle(run.id)).status).toBe('succeeded');
  });

  it('reports unknown runs', async () => {
    const engine = await createTestEngine();
    await expect(engine.manager.cancel(FIXTURE_IDS.run)).rejects.toBeInstanceOf(EngineRequestError);
    await expect(engine.manager.provideInput(FIXTURE_IDS.run, 1)).rejects.toMatchObject({
      code: 'RUN_NOT_FOUND',
    });
    expect(await engine.manager.getRun(FIXTURE_IDS.run)).toBeUndefined();
    expect(await engine.manager.getThread(FIXTURE_IDS.run)).toBeUndefined();
  });

  it('limits concurrency to the configured number of workers', async () => {
    const engine = await createTestEngine({ maxConcurrentRuns: 1 });
    engine.ports.harness.script([
      { finalText: 'one', delayMs: 30 },
      { finalText: 'two', delayMs: 30 },
    ]);
    const version = engine.publish(
      singleNodeLoop('inf', {
        id: 'infer',
        kind: 'inference',
        label: 'I',
        config: { prompt: { template: 'go' } },
      }),
    );
    const a = await engine.start(version.loopId);
    const b = await engine.start(version.loopId);
    await engine.manager.waitForIdle();
    const finishedA = engine.events(a.id).find((e) => e.type === 'run.finished') as RunEvent;
    const startedB = engine.events(b.id).find((e) => e.type === 'run.started') as RunEvent;
    expect(finishedA).toBeDefined();
    expect(startedB).toBeDefined();
    expect((await engine.ports.runs.get(b.id))?.status).toBe('succeeded');
  });
});

describe('failure and recovery', () => {
  it('fails on a missing edge as an internal error and can be inspected', async () => {
    const engine = await createTestEngine();
    const loop = minimalLoop();
    loop.edges = [];
    const version = engine.publish(loop);
    const run = await engine.runToIdle(version.loopId);
    expect(run.status).toBe('failed');
    expect(run.failure?.code).toBe('INTERNAL_ERROR');
    expect(run.failure?.message).toMatch(/no edge/);
  });

  it('resumes a failed run from the failed node', async () => {
    const engine = await createTestEngine();
    engine.ports.scripts.respondWith(() => ({
      exitCode: 1,
      stdout: '',
      stderr: 'boom',
      timedOut: false,
    }));
    const version = engine.publish(
      singleNodeLoop('s', { id: 'script', kind: 'script', label: 'S', config: { command: 'x' } }),
    );
    const run = await engine.runToIdle(version.loopId);
    expect(run.status).toBe('failed');
    expect(run.failure).toMatchObject({
      code: 'SCRIPT_EXIT_CODE',
      nodeId: 'script',
      resumable: true,
    });
    engine.ports.scripts.respondWith(() => ({
      exitCode: 0,
      stdout: '"fixed"',
      stderr: '',
      timedOut: false,
    }));
    await engine.manager.resume(run.id);
    const resumed = await engine.settle(run.id);
    expect(resumed.status).toBe('succeeded');
    expect(resumed.failure).toBeUndefined();
    const starts = engine
      .events(run.id)
      .filter((e) => e.type === 'node.started' && e.nodeId === 'script');
    expect(starts.map((e) => (e.type === 'node.started' ? e.attempt : 0))).toEqual([1, 2]);
    const thread = await engine.manager.getThread(run.id);
    expect(thread?.lastOutput?.value).toBe('fixed');
  });

  it('recovers runs left running by a previous process and resumes harness sessions', async () => {
    const ports = createFakePorts();
    const loopId = fakeUlid('recover-loop');
    const versionId = fakeUlid('recover-version');
    const runId = fakeUlid('recover-run');
    const invocationId = fakeUlid('recover-invocation');
    const def = singleNodeLoop('inf', {
      id: 'infer',
      kind: 'inference',
      label: 'I',
      config: {
        prompt: { template: 'go' },
        model: 'gpt-6-luna',
        effort: 'high',
        harnessOptions: { sandbox: 'read-only', approval: 'never', webSearch: true },
      },
    });
    ports.loops.publish(versionId, loopId, 1, LoopDefinitionSchema.parse(def));
    const thread = createInitialThread({
      runId,
      loopId,
      versionId,
      invocation: {
        id: invocationId,
        source: 'manual.api',
        trigger: { nodeId: 'start', kind: 'manual', payload: null, receivedAt: FIXTURE_TS },
      },
    });
    await ports.runs.create(
      {
        id: runId,
        ownerId: 'local',
        loopId,
        versionId,
        invocationId,
        status: 'running',
        currentNodeId: 'infer',
        iteration: 1,
        createdAt: FIXTURE_TS,
        startedAt: FIXTURE_TS,
        lastEventSeq: 0,
      },
      thread,
    );
    await ports.events.append(runId, [
      { type: 'run.queued' },
      { type: 'run.started', attempt: 1 },
      { type: 'node.started', nodeId: 'start', kind: 'trigger', attempt: 1, configHash: 'h' },
      { type: 'node.finished', nodeId: 'start', patch: [], route: 'out', durationMs: 1 },
      { type: 'node.started', nodeId: 'infer', kind: 'inference', attempt: 1, configHash: 'h' },
    ]);
    await ports.sessions.upsert({
      runId,
      nodeId: 'infer',
      attempt: 1,
      harness: 'codex',
      sessionId: 'left-behind',
      status: 'active',
      updatedAt: FIXTURE_TS,
    });
    ports.harness.script([
      { match: (r) => r.prompt.includes('interrupted'), finalText: 'resumed fine' },
    ]);

    const manager = new RunManager(ports, DEFAULT_TEST_SETTINGS);
    await manager.start();
    await manager.waitForIdle();

    const run = await ports.runs.get(runId);
    expect(run?.status).toBe('succeeded');
    expect(ports.harness.resumed).toHaveLength(1);
    expect(ports.harness.resumed[0]?.sessionId).toBe('left-behind');
    // Crash recovery resumes with the node's own session settings, not harness defaults.
    expect(ports.harness.resumed[0]?.request).toMatchObject({
      model: 'gpt-6-luna',
      effort: 'high',
      options: { sandbox: 'read-only', approval: 'never', webSearch: true },
    });
    expect(ports.harness.resumed[0]?.request.workingDirectory).toEqual(expect.any(String));
    const starts = ports.events.all(runId).filter((e) => e.type === 'run.started');
    expect(starts.map((e) => (e.type === 'run.started' ? e.attempt : 0))).toEqual([1, 2]);
    const final = await manager.getThread(runId);
    expect(final?.messages.at(-1)?.content).toBe('resumed fine');
    manager.stop();
  });

  it('completes pending cancellations at recovery and re-queues queued runs', async () => {
    const ports = createFakePorts();
    const version = ports.loops.publish(
      fakeUlid('rq-version'),
      fakeUlid('rq-loop'),
      1,
      LoopDefinitionSchema.parse(minimalLoop()),
    );
    const invocationId = fakeUlid('rq-invocation');
    const queuedId = fakeUlid('rq-run-1');
    const cancelledId = fakeUlid('rq-run-2');
    const base = {
      ownerId: 'local',
      loopId: version.loopId,
      versionId: version.id,
      invocationId,
      iteration: 1,
      createdAt: FIXTURE_TS,
      lastEventSeq: 0,
    } as const;
    const invocation = {
      id: invocationId,
      source: 'manual.api' as const,
      trigger: { nodeId: 'start', kind: 'manual' as const, payload: null, receivedAt: FIXTURE_TS },
    };
    await ports.runs.create(
      { ...base, id: queuedId, status: 'queued' },
      createInitialThread({
        runId: queuedId,
        loopId: version.loopId,
        versionId: version.id,
        invocation,
      }),
    );
    await ports.runs.create(
      {
        ...base,
        id: cancelledId,
        status: 'waiting',
        cancelRequestedAt: FIXTURE_TS,
        waiting: { nodeId: 'x', kind: 'input' },
      },
      createInitialThread({
        runId: cancelledId,
        loopId: version.loopId,
        versionId: version.id,
        invocation,
      }),
    );
    const manager = new RunManager(ports, DEFAULT_TEST_SETTINGS);
    await manager.start();
    await manager.waitForIdle();
    expect((await ports.runs.get(queuedId))?.status).toBe('succeeded');
    expect((await ports.runs.get(cancelledId))?.status).toBe('cancelled');
    manager.stop();
  });

  it('replays the thread from the log when the snapshot is missing', async () => {
    const engine = await createTestEngine();
    const version = engine.publish(minimalLoop());
    const run = await engine.runToIdle(version.loopId, { a: 1 });
    engine.ports.runs.dropThreadSnapshot(run.id);
    const thread = await engine.manager.getThread(run.id);
    expect(thread?.outputs['done']).toBeUndefined();
    expect(thread?.outputs['start']?.value).toEqual({ a: 1 });
  });

  it('fails cleanly when the loop version disappears', async () => {
    const engine = await createTestEngine();
    const version = engine.publish(minimalLoop());
    engine.manager.stop();
    const run = await engine.start(version.loopId);
    engine.ports.loops.versions.delete(version.id);
    await engine.manager.start();
    const done = await engine.settle(run.id);
    expect(done.status).toBe('failed');
    expect(done.failure?.message).toMatch(/not found/);
  });
});

describe('event helpers', () => {
  const base = { runId: FIXTURE_IDS.run, ts: FIXTURE_TS };
  it('finds a pending wake only between waiting and the next finish', () => {
    const events: RunEvent[] = [
      { ...base, seq: 1, type: 'run.started', attempt: 1 },
      {
        ...base,
        seq: 2,
        type: 'node.started',
        nodeId: 'w',
        kind: 'wait',
        attempt: 1,
        configHash: 'h',
      },
      { ...base, seq: 3, type: 'run.waiting', nodeId: 'w', wait: { nodeId: 'w', kind: 'input' } },
    ];
    expect(findPendingWake(events)).toBeUndefined();
    events.push({
      ...base,
      seq: 4,
      type: 'run.woken',
      nodeId: 'w',
      reason: 'input',
      payload: { ok: true },
    });
    expect(findPendingWake(events)).toEqual({ reason: 'input', payload: { ok: true } });
    events.push({
      ...base,
      seq: 5,
      type: 'node.started',
      nodeId: 'w',
      kind: 'wait',
      attempt: 2,
      configHash: 'h',
    });
    expect(findPendingWake(events)).toEqual({ reason: 'input', payload: { ok: true } });
    events.push({ ...base, seq: 6, type: 'node.finished', nodeId: 'w', patch: [], durationMs: 1 });
    expect(findPendingWake(events)).toBeUndefined();
    expect(
      findPendingWake([{ ...base, seq: 1, type: 'run.woken', nodeId: 'w', reason: 'timer' }]),
    ).toEqual({ reason: 'timer' });
    expect(findPendingWake([{ ...base, seq: 1, type: 'run.queued' }])).toBeUndefined();
  });

  it('counts attempts since the last finish of the node', () => {
    const events: RunEvent[] = [
      {
        ...base,
        seq: 1,
        type: 'node.started',
        nodeId: 'a',
        kind: 'mutate',
        attempt: 1,
        configHash: 'h',
      },
      { ...base, seq: 2, type: 'node.finished', nodeId: 'a', patch: [], durationMs: 1 },
      {
        ...base,
        seq: 3,
        type: 'node.started',
        nodeId: 'a',
        kind: 'mutate',
        attempt: 1,
        configHash: 'h',
      },
      {
        ...base,
        seq: 4,
        type: 'node.started',
        nodeId: 'a',
        kind: 'mutate',
        attempt: 2,
        configHash: 'h',
      },
    ];
    expect(attemptFor(events, 'a')).toBe(3);
    expect(attemptFor(events, 'b')).toBe(1);
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** The kitchen-sink fixture minus nodes that need external input, so a run completes on its own. */
function kitchenSinkLoopWithoutHeavyNodes(): LoopDefinitionInput {
  const loop = kitchenSinkLoop();
  return {
    ...loop,
    nodes: loop.nodes
      .filter((n) => ['start', 'prep', 'done'].includes(n.id))
      .map((n) => (n.id === 'done' ? { ...n, config: {} } : n)),
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'prep' } },
      { id: 'e3', from: { node: 'prep', port: 'out' }, to: { node: 'done' } },
    ],
  } as LoopDefinitionInput;
}

describe('the per-node visit cap (maxIterations)', () => {
  function selfRoutingLoop(maxIterations: number, jsonata: string): LoopDefinitionInput {
    const loop = singleNodeLoop('self-routing', {
      id: 'pick',
      kind: 'decision',
      label: 'Pick',
      config: {
        routes: [
          { label: 'again', description: 'loop' },
          { label: 'stop', description: 'finish' },
        ],
        question: 'again?',
        strategy: ['expression'],
        expression: { jsonata },
      },
    });
    loop.edges.push(
      { id: 'e2', from: { node: 'pick', port: 'again' }, to: { node: 'pick' } },
      { id: 'e3', from: { node: 'pick', port: 'stop' }, to: { node: 'done' } },
    );
    loop.settings = { maxIterations };
    return loop;
  }

  it('fails a self-routing decision with MAX_ITERATIONS naming the node', async () => {
    const engine = await createTestEngine();
    const version = engine.publish(selfRoutingLoop(3, '"again"'));
    const run = await engine.runToIdle(version.loopId);
    expect(run.status).toBe('failed');
    expect(run.failure).toMatchObject({
      code: 'MAX_ITERATIONS',
      nodeId: 'pick',
      resumable: false,
      details: { maxIterations: 3 },
    });
    expect(run.failure?.message).toContain('"pick"');
    expect(run.failure?.message).toContain('maxIterations of 3');
    const events = await engine.ports.events.read(run.id);
    expect(countEntries(events, 'pick')).toBe(3);
    expect(events.filter((e) => e.type === 'decision.made')).toHaveLength(3);
  });

  it('lets a long but finite cycle finish when every node stays within the cap', async () => {
    const engine = await createTestEngine();
    // Routes "again" while fewer than 49 decisions were made: 50 visits of "pick" against a cap of 50.
    const version = engine.publish(
      selfRoutingLoop(50, 'counters.nodeVisits.pick < 50 ? "again" : "stop"'),
    );
    const run = await engine.runToIdle(version.loopId);
    expect(run.status).toBe('succeeded');
    const thread = await engine.manager.getThread(run.id);
    expect(thread?.counters.nodeVisits['pick']).toBe(50);
  });

  it('counts fresh entries only, not wakes or retries of the same visit', () => {
    const base = { runId: FIXTURE_IDS.run, ts: FIXTURE_TS, kind: 'wait' as const, configHash: 'h' };
    const events = [
      { ...base, seq: 1, type: 'node.started', nodeId: 'w', attempt: 1 },
      { ...base, seq: 2, type: 'node.started', nodeId: 'w', attempt: 2 },
      { ...base, seq: 3, type: 'node.started', nodeId: 'other', attempt: 1 },
      { ...base, seq: 4, type: 'run.started', attempt: 1 },
    ] as unknown as RunEvent[];
    expect(countEntries(events, 'w')).toBe(1);
    expect(countEntries(events, 'other')).toBe(1);
    expect(countEntries(events, 'missing')).toBe(0);
  });
});

describe('the visit cap and re-entries of one visit', () => {
  it('does not count wakes, pause and resume, or timer fires as visits', async () => {
    const engine = await createTestEngine();
    const input = singleNodeLoop('cap-input', {
      id: 'wait',
      kind: 'wait',
      label: 'W',
      config: { mode: 'input', prompt: 'ok?' },
    });
    input.settings = { maxIterations: 1 };
    const inputRun = await engine.runToIdle(engine.publish(input).loopId);
    expect(inputRun.status).toBe('waiting');
    await engine.manager.pause(inputRun.id);
    await engine.manager.resume(inputRun.id);
    await engine.manager.provideInput(inputRun.id, { ok: true });
    expect((await engine.settle(inputRun.id)).status).toBe('succeeded');

    const timer = singleNodeLoop('cap-timer', {
      id: 'wait',
      kind: 'wait',
      label: 'W',
      config: { mode: 'duration', seconds: 60 },
    });
    timer.settings = { maxIterations: 1 };
    const timerRun = await engine.runToIdle(engine.publish(timer).loopId);
    expect(timerRun.status).toBe('waiting');
    engine.ports.clock.advance(61_000);
    await engine.ports.timers.fireDue(engine.ports.clock.now());
    const done = await engine.settle(timerRun.id);
    expect(done.status).toBe('succeeded');
    const events = await engine.ports.events.read(timerRun.id);
    expect(events.filter((e) => e.type === 'node.started' && e.nodeId === 'wait').length).toBe(2);
    expect(countEntries(events, 'wait')).toBe(1);
  });
});
