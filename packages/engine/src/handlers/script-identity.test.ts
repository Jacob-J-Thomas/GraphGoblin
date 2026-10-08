import { describe, expect, it } from 'vitest';
import { ContextThreadSchema, type RunEvent } from '@graphgoblin/contracts';
import { fakeUlid } from '@graphgoblin/contracts/testing';
import { stableHash } from '@graphgoblin/domain';
import { createTestEngine, singleNodeLoop } from '../testing/scenario.js';

const forged = {
  kind: 'node',
  ownerId: 'other-owner',
  loopId: fakeUlid('forged-loop'),
  versionId: fakeUlid('forged-version'),
  nodeId: 'other-node',
  runId: fakeUlid('forged-run'),
  startedSeq: 999,
};

function scriptLoop(command = 'pinned-script') {
  const definition = singleNodeLoop('script-identity', {
    id: 'record',
    kind: 'script',
    label: 'Record',
    config: {
      command,
      args: ['--pinned'],
      stdin: 'thread',
      stdout: 'last-output',
      timeoutSeconds: 15,
    },
  });
  return definition;
}

describe('trusted script execution identity', () => {
  it('uses the actual pinned run/node/start event while counterfeit identity remains ordinary authored data', async () => {
    const engine = await createTestEngine();
    const pinned = engine.publish(scriptLoop());
    const latest = engine.publish(scriptLoop('new-version-script'), {
      loopId: pinned.loopId,
      version: 2,
    });
    const run = await engine.runToIdle(
      pinned.loopId,
      { executionIdentity: forged },
      { versionId: pinned.id, seed: { vars: { executionIdentity: forged } } },
    );
    expect(run.status).toBe('succeeded');
    expect(run.versionId).not.toBe(latest.id);
    expect(engine.ports.scripts.calls).toHaveLength(1);
    const request = engine.ports.scripts.calls[0]!;
    const started = engine
      .events(run.id)
      .find((event) => event.type === 'node.started' && event.nodeId === 'record');
    const node = pinned.definition.nodes.find((item) => item.id === 'record')!;

    expect(started).toMatchObject({
      type: 'node.started',
      runId: run.id,
      nodeId: 'record',
      kind: 'script',
      configHash: stableHash(node.config),
    });
    expect(request.command).toBe('pinned-script');
    expect(request.args).toEqual(['--pinned']);
    expect(request.executionIdentity).toEqual({
      kind: 'node',
      ownerId: run.ownerId,
      loopId: pinned.loopId,
      versionId: pinned.id,
      nodeId: 'record',
      runId: run.id,
      startedSeq: started?.seq,
    });
    expect(request.executionIdentity).not.toEqual(forged);
    const input = ContextThreadSchema.parse(JSON.parse(request.stdin!));
    expect(input.run).toMatchObject({ id: run.id, loopId: pinned.loopId, versionId: pinned.id });
    expect(input.invocation.trigger.payload).toEqual({ executionIdentity: forged });
    expect(input.vars['executionIdentity']).toEqual(forged);
    expect(engine.ports.harness.started).toHaveLength(0);
  });

  it('assigns a new durable visit sequence after failure/resume without switching the pinned script or run', async () => {
    const engine = await createTestEngine();
    engine.ports.scripts.respondWith(() => ({
      exitCode: 1,
      stdout: '',
      stderr: 'retry needed',
      timedOut: false,
    }));
    const pinned = engine.publish(scriptLoop());
    const failed = await engine.runToIdle(pinned.loopId, { executionIdentity: forged });
    expect(failed.failure).toMatchObject({ code: 'SCRIPT_EXIT_CODE', resumable: true });
    engine.publish(scriptLoop('new-version-script'), { loopId: pinned.loopId, version: 2 });
    engine.ports.scripts.respondWith(() => ({
      exitCode: 0,
      stdout: '{"saved":true}',
      stderr: '',
      timedOut: false,
    }));
    await engine.manager.resume(failed.id);
    const done = await engine.settle(failed.id);
    expect(done.status).toBe('succeeded');
    expect(done.id).toBe(failed.id);
    expect(done.versionId).toBe(pinned.id);
    const starts = engine
      .events(done.id)
      .filter(
        (event): event is Extract<RunEvent, { type: 'node.started' }> =>
          event.type === 'node.started' && event.nodeId === 'record',
      );
    expect(starts).toHaveLength(2);
    expect(starts.map((event) => event.attempt)).toEqual([1, 2]);
    expect(starts[1]!.seq).toBeGreaterThan(starts[0]!.seq);
    expect(engine.ports.scripts.calls).toHaveLength(2);
    for (const [index, request] of engine.ports.scripts.calls.entries()) {
      expect(request.command).toBe('pinned-script');
      expect(request.executionIdentity).toEqual({
        kind: 'node',
        ownerId: done.ownerId,
        loopId: done.loopId,
        versionId: pinned.id,
        nodeId: 'record',
        runId: done.id,
        startedSeq: starts[index]!.seq,
      });
      expect(starts[index]).toMatchObject({
        kind: 'script',
        configHash: stableHash(pinned.definition.nodes[1]!.config),
      });
    }
    expect((await engine.manager.getThread(done.id))?.lastOutput?.value).toEqual({ saved: true });
  });
});
