import { describe, expect, it } from 'vitest';
import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { createTestEngine, singleNodeLoop } from './testing/scenario.js';
import { RunManager } from './run-manager.js';

const policies = ['resume-previous', 'resume-named'] as const;
function twoNodes(policy: (typeof policies)[number]): LoopDefinitionInput {
  const session = policy === 'resume-named' ? { policy, key: 'shared' } : { policy };
  return {
    schemaVersion: 4,
    name: 'inherited-' + policy,
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      {
        id: 'a',
        kind: 'inference',
        label: 'A',
        config: {
          prompt: { template: 'Task A' },
          session: { policy: 'resume-named', key: 'shared' },
        },
      },
      {
        id: 'b',
        kind: 'inference',
        label: 'B',
        config: { prompt: { template: 'Task B' }, session },
      },
      { id: 'done', kind: 'exit', label: 'Done', config: {} },
    ],
    edges: [
      { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'a' } },
      { id: 'b', from: { node: 'a', port: 'out' }, to: { node: 'b' } },
      { id: 'done', from: { node: 'b', port: 'out' }, to: { node: 'done' } },
    ],
  };
}

describe('D-022 inherited-session recovery', () => {
  it.each(policies)(
    'blocks explicit resume of unaccepted authored work under %s',
    async (policy) => {
      const e = await createTestEngine();
      const v = e.publish(twoNodes(policy));
      e.ports.harness.script([
        { finalText: 'A completed' },
        {
          items: [],
          announceSession: true,
          accepted: false,
          error: {
            code: 'HARNESS_TURN_FAILED',
            message: 'output lost before acceptance',
            retriable: false,
          },
        },
      ]);
      const run = await e.runToIdle(v.loopId);
      expect(run.failure).toMatchObject({
        code: 'HARNESS_DELIVERY_UNCERTAIN',
        nodeId: 'b',
        resumable: false,
        inference: {
          promptKind: 'authored',
          submission: 'delivery-uncertain',
          sessionId: 'fake-session-1',
        },
      });
      await expect(e.manager.resume(run.id)).rejects.toThrow();
      expect(e.ports.harness.resumed.map((x) => x.request.turn.prompt)).toEqual(['Task B']);
      expect((await e.manager.getThread(run.id))?.outputs['b']).toBeUndefined();
      e.manager.stop();
    },
  );
  it.each(policies)(
    'blocks restart after authored intent but before adapter events under %s',
    async (policy) => {
      const e = await createTestEngine();
      e.manager.stop();
      const events = e.ports.events;
      let held!: () => void;
      const durable = new Promise<void>((resolve) => {
        held = resolve;
      });
      const manager = new RunManager(
        {
          ...e.ports,
          events: {
            append: async (runId, drafts, options) => {
              const stored = await events.append(runId, drafts, options);
              if (drafts.some((x) => x.type === 'harness.turn' && x.nodeId === 'b')) {
                held();
                return new Promise(() => undefined);
              }
              return stored;
            },
            read: (id, after, limit) => events.read(id, after, limit),
            subscribe: (id, listener) => events.subscribe(id, listener),
          },
        },
        e.settings,
      );
      const v = e.publish(twoNodes(policy));
      await manager.start();
      const run = await manager.startRun({
        ownerId: 'local',
        loopId: v.loopId,
        source: 'manual.api',
      });
      await durable;
      manager.stop();
      const restarted = new RunManager(e.ports, e.settings);
      await restarted.start();
      await restarted.waitForIdle();
      expect((await e.ports.runs.get(run.id))?.failure).toMatchObject({
        code: 'HARNESS_DELIVERY_UNCERTAIN',
        nodeId: 'b',
        resumable: false,
      });
      expect(e.ports.harness.resumed).toHaveLength(0);
      expect(e.ports.harness.started).toHaveLength(1);
      expect((await restarted.getThread(run.id))?.outputs['b']).toBeUndefined();
      restarted.stop();
    },
  );
  it.each(policies)(
    'does not authorize inherited %s continuation when persisting acceptance fails',
    async (policy) => {
      const e = await createTestEngine();
      e.manager.stop();
      const events = e.ports.events;
      const manager = new RunManager(
        {
          ...e.ports,
          events: {
            append: (id, drafts, options) => {
              if (
                drafts.some(
                  (event) =>
                    event.type === 'harness.submission' &&
                    event.nodeId === 'b' &&
                    event.submission === 'submitted',
                )
              )
                return Promise.reject(new Error('acceptance record not durable'));
              return events.append(id, drafts, options);
            },
            read: (id, after, limit) => events.read(id, after, limit),
            subscribe: (id, listener) => events.subscribe(id, listener),
          },
        },
        e.settings,
      );
      const version = e.publish(twoNodes(policy));
      await manager.start();
      const run = await manager.startRun({
        ownerId: 'local',
        loopId: version.loopId,
        source: 'manual.api',
      });
      await manager.waitForIdle();
      expect((await e.ports.runs.get(run.id))?.failure).toMatchObject({
        code: 'INTERNAL_ERROR',
        resumable: false,
        inference: { submission: 'delivery-uncertain', sessionId: 'fake-session-1' },
        details: { name: 'Error', stack: expect.stringContaining('acceptance record not durable') },
      });
      await expect(manager.resume(run.id)).rejects.toThrow();
      expect(e.ports.harness.resumed.map((call) => call.request.turn.prompt)).toEqual(['Task B']);
      manager.stop();
    },
  );
  it.each(policies)(
    'also blocks an unaccepted retry of refused authored work under %s',
    async (policy) => {
      const e = await createTestEngine();
      const v = e.publish(twoNodes(policy));
      e.ports.harness.script([
        { finalText: 'A completed' },
        {
          announceSession: false,
          items: [],
          submission: 'definitely-not-submitted',
          error: {
            code: 'HARNESS_TURN_FAILED',
            message: 'transient pre-send refusal',
            retriable: false,
          },
        },
      ]);
      const run = await e.runToIdle(v.loopId);
      expect(run.failure?.resumable).toBe(true);
      e.ports.harness.script([
        {
          announceSession: false,
          items: [],
          error: { code: 'HARNESS_TURN_FAILED', message: 'lost retry', retriable: false },
        },
      ]);
      await e.manager.resume(run.id);
      const failed = await e.settle(run.id);
      expect(failed.failure).toMatchObject({
        code: 'HARNESS_DELIVERY_UNCERTAIN',
        resumable: false,
        inference: { promptKind: 'authored' },
      });
      await expect(e.manager.resume(run.id)).rejects.toThrow();
      expect(e.ports.harness.resumed.map((x) => x.request.turn.prompt)).toEqual([
        'Task B',
        'Task B',
      ]);
      e.manager.stop();
    },
  );
  it('refuses a missing session at visit start after the refusal was durable but failure recording was interrupted', async () => {
    const e = await createTestEngine();
    e.manager.stop();
    const events = e.ports.events;
    let held!: () => void;
    const durable = new Promise<void>((resolve) => {
      held = resolve;
    });
    const manager = new RunManager(
      {
        ...e.ports,
        events: {
          append: async (id, drafts, options) => {
            const stored = await events.append(id, drafts, options);
            if (
              drafts.some(
                (x) => x.type === 'harness.submission' && x.submission === 'session-missing',
              )
            ) {
              held();
              return new Promise(() => undefined);
            }
            return stored;
          },
          read: (id, after, limit) => events.read(id, after, limit),
          subscribe: (id, listener) => events.subscribe(id, listener),
        },
      },
      e.settings,
    );
    e.ports.harness.script([
      { finalText: 'A completed' },
      {
        items: [],
        submission: 'session-missing',
        error: { code: 'HARNESS_SESSION_MISSING', message: 'missing prior session' },
      },
    ]);
    const v = e.publish(twoNodes('resume-previous'));
    await manager.start();
    const run = await manager.startRun({
      ownerId: 'local',
      loopId: v.loopId,
      source: 'manual.api',
    });
    await durable;
    manager.stop();
    const restarted = new RunManager(e.ports, e.settings);
    await restarted.start();
    await restarted.waitForIdle();
    expect((await e.ports.runs.get(run.id))?.failure).toMatchObject({
      code: 'HARNESS_SESSION_MISSING',
      resumable: false,
    });
    expect(e.ports.harness.resumed).toHaveLength(1);
    restarted.stop();
  });
  it('continues an uncertain unaccepted repair on the visit-owned session', async () => {
    const e = await createTestEngine();
    const v = e.publish(
      singleNodeLoop('uncertain repair', {
        id: 'infer',
        kind: 'inference',
        label: 'Infer',
        config: {
          prompt: { template: 'original' },
          output: {
            schema: { jsonSchema: { type: 'number' }, repair: { enabled: true, maxAttempts: 1 } },
          },
        },
      }),
    );
    e.ports.harness.script([
      { finalText: 'invalid' },
      {
        accepted: false,
        announceSession: false,
        items: [],
        error: { code: 'HARNESS_TURN_FAILED', message: 'repair interrupted', retriable: false },
      },
    ]);
    const run = await e.runToIdle(v.loopId);
    expect(run.failure).toMatchObject({
      resumable: true,
      inference: { promptKind: 'repair', submission: 'delivery-uncertain' },
    });
    e.ports.harness.script([{ finalText: '42' }]);
    await e.manager.resume(run.id);
    expect((await e.settle(run.id)).status).toBe('succeeded');
    expect(e.ports.harness.resumed.at(-1)?.request.turn.prompt).toContain(
      'previous turn was interrupted',
    );
    e.manager.stop();
  });
  it('continues an uncertain unaccepted continuation on the visit-owned session', async () => {
    const e = await createTestEngine();
    const v = e.publish(
      singleNodeLoop('uncertain continuation', {
        id: 'infer',
        kind: 'inference',
        label: 'Infer',
        config: { prompt: { template: 'original' } },
      }),
    );
    e.ports.harness.script([
      {
        accepted: true,
        error: { code: 'HARNESS_TURN_FAILED', message: 'authored interrupted', retriable: false },
      },
      {
        accepted: false,
        announceSession: false,
        items: [],
        error: {
          code: 'HARNESS_TURN_FAILED',
          message: 'continuation interrupted',
          retriable: false,
        },
      },
    ]);
    const run = await e.runToIdle(v.loopId);
    await e.manager.resume(run.id);
    expect((await e.settle(run.id)).failure).toMatchObject({
      resumable: true,
      inference: { promptKind: 'continuation', submission: 'delivery-uncertain' },
    });
    await e.manager.resume(run.id);
    expect((await e.settle(run.id)).status).toBe('succeeded');
    expect(e.ports.harness.started).toHaveLength(1);
    expect(
      e.ports.harness.resumed.every((x) =>
        x.request.turn.prompt.includes('previous turn was interrupted'),
      ),
    ).toBe(true);
    e.manager.stop();
  });
});
