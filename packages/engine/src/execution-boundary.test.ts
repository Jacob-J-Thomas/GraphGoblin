import { describe, expect, it, vi } from 'vitest';
import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { RunFailureError } from './errors.js';
import type { EngineSettings } from './ports.js';
import { EngineRequestError } from './run-manager.js';
import { createTestEngine, singleNodeLoop } from './testing/scenario.js';

type ExecutionInput = Parameters<NonNullable<EngineSettings['beforeExecute']>>[0];
type ResumeInput = Parameters<NonNullable<EngineSettings['beforeResume']>>[0];

function effectLoop(name: string): LoopDefinitionInput {
  const definition = singleNodeLoop(name, {
    id: 'work',
    kind: 'inference',
    label: 'Work',
    config: { prompt: { template: 'Describe the input.' } },
  });
  definition.nodes.splice(2, 0, {
    id: 'record',
    kind: 'script',
    label: 'Record',
    config: { command: 'record-result', stdin: 'thread', stdout: 'last-output' },
  });
  definition.edges[1]!.to.node = 'record';
  definition.edges.push({
    id: 'record-done',
    from: { node: 'record', port: 'out' },
    to: { node: 'done' },
  });
  return definition;
}

describe('generic execution policy boundaries', () => {
  it('awaits a prerequisite refusal and durably fails before any node, provider or script starts', async () => {
    let entered!: () => void;
    let rejectPolicy!: (error: RunFailureError) => void;
    let observed: ExecutionInput | undefined;
    const policyEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const decision = new Promise<void>((_resolve, reject) => {
      rejectPolicy = reject;
    });
    const engine = await createTestEngine({
      beforeExecute: (input) => {
        observed = structuredClone(input);
        entered();
        return decision;
      },
    });
    const version = engine.publish(effectLoop('delayed-policy'));
    const queued = await engine.start(version.loopId, { topic: 'test' });
    await policyEntered;

    expect(observed).toEqual({
      run: expect.objectContaining({ id: queued.id, status: 'queued', versionId: version.id }),
      definition: version.definition,
      events: [expect.objectContaining({ type: 'run.queued', runId: queued.id, seq: 1 })],
    });
    expect((await engine.ports.runs.get(queued.id))?.status).toBe('queued');
    expect(engine.eventTypes(queued.id)).toEqual(['run.queued']);
    expect(engine.ports.harness.started).toEqual([]);
    expect(engine.ports.harness.resumed).toEqual([]);
    expect(engine.ports.scripts.calls).toEqual([]);

    const refusal = new RunFailureError(
      'SECRET_MISSING',
      'Configure the required execution credential.',
      { resumable: true, details: { prerequisite: 'execution-key' } },
    );
    rejectPolicy(refusal);
    const failed = await engine.settle(queued.id);
    expect(failed).toMatchObject({
      id: queued.id,
      versionId: version.id,
      status: 'failed',
      failure: refusal.toFailure(),
    });
    expect(failed.startedAt).toBeUndefined();
    expect(failed.currentNodeId).toBeUndefined();
    expect(failed.finishedAt).toBeDefined();
    expect(engine.eventTypes(failed.id)).toEqual(['run.queued', 'run.failed']);
    expect(engine.events(failed.id)[1]).toMatchObject({
      type: 'run.failed',
      failure: failed.failure,
    });
    expect((await engine.manager.getThread(failed.id))?.counters.nodeVisits).toEqual({});
    expect((await engine.manager.getThread(failed.id))?.outputs).toEqual({});
    expect(await engine.ports.runs.listUnfinalized()).toEqual([]);
    expect(engine.ports.harness.started).toEqual([]);
    expect(engine.ports.harness.resumed).toEqual([]);
    expect(engine.ports.scripts.calls).toEqual([]);
  });

  it('rejects resume before changing the failed record, events, checkpoint, initial input or finalization', async () => {
    const beforeResume = vi.fn((input: ResumeInput) => {
      expect(input.run.status).toBe('failed');
      expect(input.events.at(-1)?.type).toBe('run.failed');
      return Promise.reject(
        new EngineRequestError('INVALID_STATE', 'Execution policy denies this resume.'),
      );
    });
    const engine = await createTestEngine({
      beforeExecute: () =>
        Promise.reject(
          new RunFailureError('HARNESS_NOT_AUTHENTICATED', 'Authenticate before running.'),
        ),
      beforeResume,
    });
    const version = engine.publish(effectLoop('resume-refused'));
    const failed = await engine.runToIdle(version.loopId, { immutableInput: 'original' });
    const before = structuredClone({
      run: await engine.ports.runs.get(failed.id),
      events: engine.events(failed.id),
      initial: await engine.ports.runs.getInitialThread(failed.id),
      thread: await engine.ports.runs.getThread(failed.id),
      checkpoint: await engine.ports.runs.getThreadCheckpoint(failed.id),
      unfinalized: await engine.ports.runs.listUnfinalized(),
    });
    expect(before.run?.failure?.resumable).toBe(true);
    expect(before.unfinalized).toEqual([]);

    await expect(engine.manager.resume(failed.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await engine.manager.waitForIdle();
    expect(beforeResume).toHaveBeenCalledTimes(1);
    expect({
      run: await engine.ports.runs.get(failed.id),
      events: engine.events(failed.id),
      initial: await engine.ports.runs.getInitialThread(failed.id),
      thread: await engine.ports.runs.getThread(failed.id),
      checkpoint: await engine.ports.runs.getThreadCheckpoint(failed.id),
      unfinalized: await engine.ports.runs.listUnfinalized(),
    }).toEqual(before);
    expect(engine.ports.harness.started).toEqual([]);
    expect(engine.ports.scripts.calls).toEqual([]);
  });

  it('preserves ordinary execution and input/output behavior when the hook accepts', async () => {
    const observed: ExecutionInput[] = [];
    const beforeExecute = vi.fn((input: ExecutionInput) => {
      observed.push(structuredClone(input));
      return Promise.resolve();
    });
    const beforeResume = vi.fn((_input: ResumeInput) => Promise.resolve());
    const guarded = await createTestEngine({ beforeExecute, beforeResume });
    const ordinary = await createTestEngine();
    for (const engine of [guarded, ordinary])
      engine.ports.scripts.respondWith(() => ({
        exitCode: 0,
        stdout: '{"saved":true}',
        stderr: '',
        timedOut: false,
      }));
    const definition = effectLoop('accepted-policy');
    const guardedVersion = guarded.publish(definition);
    const ordinaryVersion = ordinary.publish(definition);
    const input = { topic: 'same input' };
    const accepted = await guarded.runToIdle(guardedVersion.loopId, input);
    const baseline = await ordinary.runToIdle(ordinaryVersion.loopId, input);

    expect(accepted.status).toBe('succeeded');
    expect(beforeExecute).toHaveBeenCalledTimes(1);
    expect(observed[0]).toMatchObject({
      run: { id: accepted.id, status: 'queued', versionId: guardedVersion.id },
      definition: guardedVersion.definition,
      events: [{ type: 'run.queued' }],
    });
    expect(beforeResume).not.toHaveBeenCalled();
    expect(guarded.eventTypes(accepted.id)).toEqual(ordinary.eventTypes(baseline.id));
    expect(await guarded.manager.getThread(accepted.id)).toEqual(
      await ordinary.manager.getThread(baseline.id),
    );
    expect(guarded.ports.harness.started).toHaveLength(1);
    expect(guarded.ports.scripts.calls).toHaveLength(1);
    expect(await guarded.ports.runs.listUnfinalized()).toEqual([]);
  });

  it('accepts the same failed identity and reruns prerequisites before executing any recovered node', async () => {
    let ready = false;
    const executions: ExecutionInput[] = [];
    const beforeResume = vi.fn((input: ResumeInput) => {
      expect(input.run.status).toBe('failed');
      expect(input.run.failure?.code).toBe('HARNESS_NOT_AUTHENTICATED');
      expect(input.events.some((event) => event.type === 'node.started')).toBe(false);
      return Promise.resolve();
    });
    const engine = await createTestEngine({
      beforeResume,
      beforeExecute: (input) => {
        executions.push(structuredClone(input));
        return ready
          ? Promise.resolve()
          : Promise.reject(
              new RunFailureError('HARNESS_NOT_AUTHENTICATED', 'Authenticate before running.'),
            );
      },
    });
    const version = engine.publish(effectLoop('repaired-policy'));
    const failed = await engine.runToIdle(version.loopId, { original: true });
    expect(failed.status).toBe('failed');
    ready = true;
    await engine.manager.resume(failed.id);
    const done = await engine.settle(failed.id);

    expect(done).toMatchObject({
      id: failed.id,
      loopId: failed.loopId,
      versionId: failed.versionId,
      invocationId: failed.invocationId,
      status: 'succeeded',
    });
    expect(done.failure).toBeUndefined();
    expect(beforeResume).toHaveBeenCalledTimes(1);
    expect(executions).toHaveLength(2);
    expect(executions[1]?.run.id).toBe(failed.id);
    expect(executions[1]?.events.some((event) => event.type === 'run.resumed')).toBe(true);
    expect(executions[1]?.events.some((event) => event.type === 'node.started')).toBe(false);
    const types = engine.eventTypes(done.id);
    expect(types.filter((type) => type === 'run.queued')).toHaveLength(1);
    expect(types.filter((type) => type === 'run.failed')).toHaveLength(1);
    expect(types.filter((type) => type === 'run.resumed')).toHaveLength(1);
    expect(types.indexOf('run.resumed')).toBeLessThan(types.indexOf('node.started'));
    expect(engine.ports.harness.started).toHaveLength(1);
    expect(engine.ports.scripts.calls).toHaveLength(1);
    expect((await engine.manager.getThread(done.id))?.counters.nodeVisits).toEqual({
      start: 1,
      work: 1,
      record: 1,
      done: 1,
    });
  });
});
