import { describe, expect, it } from 'vitest';
import {
  ContextThreadSchema,
  type JsonPatch,
  type PatchOperation,
  type RunEvent,
} from '@graphgoblin/contracts';
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
      stdoutBytes: 0,
      stdoutOverflow: false,
      stderrBytes: 12,
      stderrOverflow: false,
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
      stdoutBytes: 14,
      stdoutOverflow: false,
      stderrBytes: 0,
      stderrOverflow: false,
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

describe('script patch boundaries', () => {
  it('rejects the whole patch when a writable destination moves from protected context', async () => {
    const engine = await createTestEngine();
    const patch: JsonPatch = [
      { op: 'add', path: '/vars/shouldNotAppear', value: true },
      { op: 'move', from: '/invocation/caller', path: '/vars/stolen' },
    ];
    let before: ReturnType<typeof engine.manager.getThread> | undefined;
    engine.ports.scripts.respondWith((request) => {
      before = engine.manager.getThread(
        ContextThreadSchema.parse(JSON.parse(request.stdin!)).run.id,
      );
      return { exitCode: 0, stdout: JSON.stringify(patch), stderr: '', timedOut: false };
    });
    const version = engine.publish(
      singleNodeLoop('protected-source', {
        id: 'script',
        kind: 'script',
        label: 'Patch',
        config: { command: 'patch', stdin: 'thread', stdout: 'patch' },
      }),
    );
    const run = await engine.runToIdle(version.loopId, null, {
      caller: { kind: 'user', id: 'owner' },
    });
    expect(run.failure?.code).toBe('SCRIPT_EXIT_CODE');
    expect(await engine.manager.getThread(run.id)).toEqual(await before);
    expect(
      engine
        .events(run.id)
        .some((event) => event.type === 'node.finished' && event.nodeId === 'script'),
    ).toBe(false);
  });
});

describe('authored handler mutations', () => {
  it.each(['add', 'replace', 'remove', 'copy', 'move'] as const)(
    'rejects a script %s destination in protected context atomically',
    async (op) => {
      const engine = await createTestEngine();
      let before: ReturnType<typeof engine.manager.getThread> | undefined;
      engine.ports.scripts.respondWith((request) => {
        before = engine.manager.getThread(
          ContextThreadSchema.parse(JSON.parse(request.stdin!)).run.id,
        );
        const operation: PatchOperation =
          op === 'move' || op === 'copy'
            ? { op, from: '/vars/marker', path: '/invocation/caller' }
            : op === 'remove'
              ? { op, path: '/invocation/caller' }
              : { op, path: '/invocation/caller', value: null };
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ op: 'add', path: '/vars/marker', value: 1 }, operation]),
          stderr: '',
          timedOut: false,
        };
      });
      const version = engine.publish(
        singleNodeLoop('protected-destination', {
          id: 'script',
          kind: 'script',
          label: 'Patch',
          config: { command: 'patch', stdout: 'patch' },
        }),
      );
      const run = await engine.runToIdle(version.loopId, null, {
        caller: { kind: 'user', id: 'owner' },
      });
      expect(run.failure?.code).toBe('SCRIPT_EXIT_CODE');
      expect(run.failure?.message).toMatch(/outside the mutable regions/);
      expect(await engine.manager.getThread(run.id)).toEqual(await before);
    },
  );

  it('allows script copies from protected context, protected tests and writable moves', async () => {
    const engine = await createTestEngine();
    engine.ports.scripts.respondWith(() => ({
      exitCode: 0,
      stdout: JSON.stringify([
        { op: 'test', path: '/invocation/source', value: 'manual.api' },
        { op: 'copy', from: '/invocation/caller', path: '/vars/copied' },
        { op: 'move', from: '/vars/copied', path: '/vars/moved' },
      ]),
      stderr: '',
      timedOut: false,
    }));
    const version = engine.publish(
      singleNodeLoop('permitted-patch', {
        id: 'script',
        kind: 'script',
        label: 'Patch',
        config: { command: 'patch', stdout: 'patch' },
      }),
    );
    const run = await engine.runToIdle(version.loopId, null, {
      caller: { kind: 'user', id: 'owner' },
    });
    expect(run.status).toBe('succeeded');
    const thread = await engine.manager.getThread(run.id);
    expect(thread?.invocation.caller).toEqual({ kind: 'user', id: 'owner' });
    expect(thread?.vars).toEqual({ moved: { kind: 'user', id: 'owner' } });
  });

  it.each(['set', 'delete', 'coerce'] as const)(
    'rejects a protected mutate %s target without retaining earlier changes',
    async (op) => {
      const engine = await createTestEngine();
      const operation =
        op === 'set'
          ? { op, path: '/run/id', value: { kind: 'literal', value: 'changed' } }
          : op === 'delete'
            ? { op, path: '/invocation/caller' }
            : { op, source: '/vars/marker', target: '/counters/usage', jsonSchema: {}, repair: {} };
      const version = engine.publish(
        singleNodeLoop('protected-mutation', {
          id: 'mutate',
          kind: 'mutate',
          label: 'Mutate',
          config: {
            operations: [
              { op: 'set', path: '/vars/marker', value: { kind: 'literal', value: 1 } },
              operation,
            ],
          },
        }),
      );
      const run = await engine.runToIdle(version.loopId, null, {
        caller: { kind: 'user', id: 'owner' },
      });
      expect(run.failure?.message).toMatch(/not in a mutable region/);
      const thread = await engine.manager.getThread(run.id);
      expect(thread?.vars).toEqual({});
      expect(thread?.run.id).toBe(run.id);
      expect(thread?.invocation.caller).toEqual({ kind: 'user', id: 'owner' });
      expect(thread?.counters.usage).toMatchObject({ inputTokens: 0, outputTokens: 0 });
    },
  );
});
