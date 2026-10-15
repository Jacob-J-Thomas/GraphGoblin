import { describe, expect, it } from 'vitest';
import { ContextThreadSchema, type RunEvent } from '@graphgoblin/contracts';
import { stableHash } from '@graphgoblin/domain';
import { createTestEngine, singleNodeLoop } from '../testing/scenario.js';

function scriptLoop(command = 'pinned-script') {
  return singleNodeLoop('pinned-script-resume', {
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
}

describe('ordinary script resume', () => {
  it('keeps the pinned script and run and starts a new attempt when resuming after a newer version is published', async () => {
    const engine = await createTestEngine();
    engine.ports.scripts.respondWith(() => ({
      exitCode: 1,
      stdout: '',
      stderr: 'retry needed',
      timedOut: false,
    }));
    const pinned = engine.publish(scriptLoop());
    const failed = await engine.runToIdle(pinned.loopId);
    expect(failed.failure).toMatchObject({ code: 'SCRIPT_EXIT_CODE', resumable: true });
    const latest = engine.publish(scriptLoop('new-version-script'), {
      loopId: pinned.loopId,
      version: 2,
    });
    expect((await engine.ports.loops.getLatestPublished(pinned.loopId))?.id).toBe(latest.id);
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
    expect(done.versionId).not.toBe(latest.id);
    const starts = engine
      .events(done.id)
      .filter(
        (event): event is Extract<RunEvent, { type: 'node.started' }> =>
          event.type === 'node.started' && event.nodeId === 'record',
      );
    expect(starts).toHaveLength(2);
    expect(starts.map((event) => event.attempt)).toEqual([1, 2]);
    expect(starts[1]!.seq).toBeGreaterThan(starts[0]!.seq);
    for (const event of starts)
      expect(event).toMatchObject({
        kind: 'script',
        configHash: stableHash(pinned.definition.nodes[1]!.config),
      });
    expect(engine.ports.scripts.calls).toHaveLength(2);
    for (const request of engine.ports.scripts.calls) {
      expect(request).toMatchObject({
        command: 'pinned-script',
        args: ['--pinned'],
        timeoutMs: 15000,
      });
      const thread = ContextThreadSchema.parse(JSON.parse(request.stdin!));
      expect(thread.run).toMatchObject({
        id: done.id,
        loopId: pinned.loopId,
        versionId: pinned.id,
      });
    }
    expect((await engine.manager.getThread(done.id))?.lastOutput?.value).toEqual({ saved: true });
  });
});
