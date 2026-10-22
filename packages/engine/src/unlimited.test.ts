import { defaultHandlers } from './handlers/index.js';
import type { NodeResult } from './handler.js';
import { afterEach, describe, expect, it } from 'vitest';
import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { RunManager } from './run-manager.js';
import { createTestEngine, singleNodeLoop, type TestEngine } from './testing/index.js';

const engines: TestEngine[] = [];
async function engine() {
  const e = await createTestEngine();
  engines.push(e);
  return e;
}
afterEach(async () => {
  for (const e of engines.splice(0)) {
    e.manager.stop();
    for (const candidate of await e.ports.runs.listRecoveryCandidates()) {
      const run = await e.ports.runs.get(candidate.id);
      if (run && ['queued', 'running', 'waiting', 'paused'].includes(run.status))
        await e.manager.cancel(run.id);
    }
    await e.manager.waitForIdle();
  }
});
function cycle(settings: LoopDefinitionInput['settings'] = {}): LoopDefinitionInput {
  return {
    schemaVersion: 4,
    name: 'Unlimited fixture',
    settings,
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      {
        id: 'work',
        kind: 'inference',
        label: 'Work',
        config: { prompt: { template: 'Controlled fake turn' } },
      },
      {
        id: 'gate',
        kind: 'decision',
        label: 'Gate',
        config: {
          kind: 'expression',
          jsonata: '"again"',
          routes: [
            { id: 'again', label: 'Again' },
            { id: 'done', label: 'Done' },
          ],
        },
      },
      { id: 'done', kind: 'exit', label: 'Done', config: {} },
    ],
    edges: [
      { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'work' } },
      { id: 'b', from: { node: 'work', port: 'out' }, to: { node: 'gate' } },
      { id: 'c', from: { node: 'gate', port: 'again' }, to: { node: 'work' } },
      { id: 'd', from: { node: 'gate', port: 'done' }, to: { node: 'done' } },
    ],
  };
}
describe('execution guardrails (#243)', () => {
  it('allows unlimited marked passes beyond ten without a synthetic exhaustion', async () => {
    const e = await engine();
    const def = cycle({ maxNodeVisits: null, runDeadlineSeconds: null });
    const gate = def.nodes.find((n) => n.kind === 'decision');
    if (!gate || gate.kind !== 'decision' || gate.config.kind !== 'expression')
      throw new Error('fixture');
    gate.config.routes[0]!.repeat = true;
    gate.config.maxPasses = null;
    def.edges.push({
      id: 'limit',
      from: { node: 'gate', port: 'limit-reached' },
      to: { node: 'done' },
    });
    const run = await e.start(e.publish(def).loopId);
    await expect
      .poll(() => e.events(run.id).filter((event) => event.type === 'decision.made').length, {
        timeout: 10000,
      })
      .toBeGreaterThan(20);
    await e.manager.cancel(run.id);
    await e.settle(run.id);
    const decisions = e.events(run.id).filter((event) => event.type === 'decision.made');
    expect(decisions.at(-1)?.gate).toMatchObject({ maxPasses: null, limit: null });
  });
  it.each(['definitely-not-submitted', 'delivery-uncertain'] as const)(
    'bounds transport retries using %s evidence',
    async (submission) => {
      const e = await engine();
      e.ports.harness.script(
        Array.from({ length: 3 }, () => ({
          announceSession: false,
          submission,
          error: {
            code: 'HARNESS_TRANSPORT_FAILED',
            message: 'Controlled transient',
            retriable: true,
          },
        })),
      );
      const run = await e.runToIdle(e.publish(cycle()).loopId);
      expect(run.failure?.code).toBe('HARNESS_TRANSPORT_FAILED');
      expect(e.ports.harness.started).toHaveLength(
        submission === 'definitely-not-submitted' ? 2 : 1,
      );
    },
  );
  it('a safe retry retains the exact authored task and turn identity', async () => {
    const e = await engine();
    e.ports.harness.script([
      {
        announceSession: false,
        submission: 'definitely-not-submitted',
        error: {
          code: 'HARNESS_TRANSPORT_FAILED',
          message: 'Controlled transient',
          retriable: true,
        },
      },
    ]);
    const run = await e.runToIdle(
      e.publish(
        singleNodeLoop('safe retry', {
          id: 'work',
          kind: 'inference',
          label: 'Work',
          config: { prompt: { template: 'Exact original task' } },
        }),
      ).loopId,
    );
    expect(run.status).toBe('succeeded');
    expect(e.ports.harness.started).toHaveLength(2);
    expect(e.ports.harness.started.map((request) => request.turn.prompt)).toEqual([
      'Exact original task',
      'Exact original task',
    ]);
    expect(
      new Set(
        e
          .events(run.id)
          .filter((event) => event.type === 'harness.turn')
          .map((event) => event.turnId),
      ).size,
    ).toBe(1);
  });
  it.each(['HARNESS_QUOTA_EXHAUSTED', 'HARNESS_NOT_AUTHENTICATED', 'HARNESS_OUTPUT_LIMIT'])(
    'does not retry %s',
    async (code) => {
      const e = await engine();
      e.ports.harness.script([
        {
          submission: 'definitely-not-submitted',
          error: { code, message: 'Controlled failure', retriable: true },
        },
      ]);
      const run = await e.runToIdle(e.publish(cycle()).loopId);
      expect(run.failure?.code).toBe(code);
      expect(e.ports.harness.started).toHaveLength(1);
    },
  );
  it.each([false, true])(
    'expires a parked run across restart=%s without resetting its clock',
    async (restart) => {
      const e = await engine();
      const def = singleNodeLoop('deadline wait', {
        id: 'wait',
        kind: 'wait',
        label: 'Wait',
        config: { mode: 'signal', name: 'continue' },
      });
      def.settings = { runDeadlineSeconds: 2 };
      const run = await e.runToIdle(e.publish(def).loopId);
      expect(run.status).toBe('waiting');
      const original = e.ports.timers.scheduled
        .find((t) => t.key === 'run-deadline')
        ?.at.toISOString();
      e.ports.clock.advance(3000);
      if (restart) {
        e.manager.stop();
        const recovered = new RunManager(e.ports, e.settings);
        await recovered.start();
        engines.push({ ...e, manager: recovered });
      } else await e.ports.timers.fireDue(e.ports.clock.now());
      expect((await e.ports.runs.get(run.id))?.failure?.code).toBe('RUN_DEADLINE_EXCEEDED');
      expect(original).toBe(new Date(Date.parse(run.startedAt!) + 2000).toISOString());
    },
  );
  it('aborts overdue active work and rejects its result', async () => {
    const e = await engine();
    e.ports.harness.script([{ delayMs: 60000 }]);
    const def = singleNodeLoop('active deadline', {
      id: 'work',
      kind: 'inference',
      label: 'Work',
      config: { prompt: { template: 'Stall' } },
    });
    def.settings = { runDeadlineSeconds: 1 };
    const run = await e.start(e.publish(def).loopId);
    await expect.poll(() => e.ports.harness.started.length).toBe(1);
    e.ports.clock.advance(2000);
    await e.ports.timers.fireDue(e.ports.clock.now());
    const finished = await e.settle(run.id);
    expect(finished.failure?.code).toBe('RUN_DEADLINE_EXCEEDED');
    expect(
      e.events(run.id).some((event) => event.type === 'node.finished' && event.nodeId === 'work'),
    ).toBe(false);
  });
  it('rejects a late result from a handler that ignored the deadline signal', async () => {
    let finish!: (result: NodeResult) => void;
    const pending = new Promise<NodeResult>((resolve) => {
      finish = resolve;
    });
    let signal: AbortSignal | undefined;
    const e = await createTestEngine(
      {},
      {
        handlers: {
          ...defaultHandlers(),
          inference: {
            kind: 'inference',
            execute: (ctx) => {
              signal = ctx.signal;
              return pending;
            },
          },
        },
      },
    );
    engines.push(e);
    const def = singleNodeLoop('late result', {
      id: 'work',
      kind: 'inference',
      label: 'Work',
      config: { prompt: { template: 'Controlled late handler' } },
    });
    def.settings = { runDeadlineSeconds: 1 };
    const run = await e.start(e.publish(def).loopId);
    await expect.poll(() => signal !== undefined, { timeout: 5000 }).toBe(true);
    e.ports.clock.advance(2000);
    await e.ports.timers.fireDue(e.ports.clock.now());
    expect(signal?.aborted).toBe(true);
    finish({
      kind: 'done',
      route: 'out',
      patch: [{ op: 'add', path: '/vars/late', value: 'ignored' }],
    });
    expect((await e.settle(run.id)).failure?.code).toBe('RUN_DEADLINE_EXCEEDED');
    expect((await e.manager.getThread(run.id))?.vars['late']).toBeUndefined();
    expect(
      e.events(run.id).some((event) => event.type === 'node.finished' && event.nodeId === 'work'),
    ).toBe(false);
  });

  it('cancels awaited child work when the parent deadline expires', async () => {
    const e = await engine();
    const childDef = singleNodeLoop('deadline child', {
      id: 'wait',
      kind: 'wait',
      label: 'Wait',
      config: { mode: 'signal', name: 'continue' },
    });
    childDef.settings = { runDeadlineSeconds: null };
    const childVersion = e.publish(childDef);
    const parentDef = singleNodeLoop('deadline parent', {
      id: 'sub',
      kind: 'subloop',
      label: 'Child',
      config: { loopRef: { loopId: childVersion.loopId } },
    });
    parentDef.settings = { runDeadlineSeconds: 5 };
    const run = await e.runToIdle(e.publish(parentDef).loopId);
    const child = (await e.ports.runs.listChildren(run.id))[0];
    expect(child?.status).toBe('waiting');
    e.ports.clock.advance(6000);
    await e.ports.timers.fireDue(e.ports.clock.now());
    expect((await e.ports.runs.get(run.id))?.failure?.code).toBe('RUN_DEADLINE_EXCEEDED');
    expect((await e.ports.runs.get(child!.id))?.status).toBe('cancelled');
  });

  it('keeps the configured deadline while draining after stop', async () => {
    const e = await engine();
    e.ports.harness.script([{ delayMs: 60000 }]);
    const def = singleNodeLoop('draining deadline', {
      id: 'work',
      kind: 'inference',
      label: 'Work',
      config: { prompt: { template: 'Stall' } },
    });
    def.settings = { runDeadlineSeconds: 1 };
    const run = await e.start(e.publish(def).loopId);
    await expect.poll(() => e.ports.harness.started.length, { timeout: 5000 }).toBe(1);
    e.manager.stop();
    e.ports.clock.advance(2000);
    // No TimerPort delivery after stop: the active execution's watchdog must still abort it.
    await expect.poll(() => e.ports.harness.cancelled.length, { timeout: 5000 }).toBe(1);
    expect((await e.settle(run.id)).failure?.code).toBe('RUN_DEADLINE_EXCEEDED');
  });

  it.each([false, true])(
    'an omitted deadline survives a day of waiting across restart=%s and continues',
    async (restart) => {
      const e = await engine();
      const def = singleNodeLoop('overnight wait', {
        id: 'wait',
        kind: 'wait',
        label: 'Wait',
        config: { mode: 'signal', name: 'continue' },
      });
      const run = await e.runToIdle(e.publish(def).loopId);
      expect(run.status).toBe('waiting');
      e.ports.clock.advance(86400000);
      if (restart) {
        e.manager.stop();
        const recovered = new RunManager(e.ports, e.settings);
        await recovered.start();
        engines.push({ ...e, manager: recovered });
      } else await e.ports.timers.fireDue(e.ports.clock.now());
      expect((await e.ports.runs.get(run.id))?.status).toBe('waiting');
      expect((await e.ports.runs.get(run.id))?.pinned.limits.runDeadlineSeconds).toBeNull();
      const manager = engines.at(-1)!.manager;
      await manager.signal(run.id, 'continue', run.waiting!.waitId);
      await manager.waitForIdle();
      expect((await e.settle(run.id)).status).toBe('succeeded');
    },
  );
  it('disabled deadline leaves a paused wait cancellable after elapsed time', async () => {
    const e = await engine();
    const def = singleNodeLoop('no deadline', {
      id: 'wait',
      kind: 'wait',
      label: 'Wait',
      config: { mode: 'signal', name: 'continue' },
    });
    def.settings = { runDeadlineSeconds: null };
    const run = await e.runToIdle(e.publish(def).loopId);
    await e.manager.pause(run.id);
    e.ports.clock.advance(86400000);
    await e.ports.timers.fireDue(e.ports.clock.now());
    expect((await e.ports.runs.get(run.id))?.status).toBe('paused');
    await e.manager.cancel(run.id);
    expect((await e.settle(run.id)).status).toBe('cancelled');
  });
  it('still stops an unconfigured cycle at the visible ten-visit default', async () => {
    const e = await engine();
    const run = await e.runToIdle(e.publish(cycle()).loopId);
    expect(run.failure?.code).toBe('MAX_NODE_VISITS');
    expect(e.ports.harness.started).toHaveLength(10);
  });
  it('runs beyond the former visit cap with fake turns and cancels', async () => {
    const e = await engine();
    const run = await e.start(
      e.publish(cycle({ maxNodeVisits: null, runDeadlineSeconds: null })).loopId,
    );
    await expect.poll(() => e.ports.harness.started.length, { timeout: 10000 }).toBeGreaterThan(20);
    await e.manager.cancel(run.id);
    expect((await e.settle(run.id)).status).toBe('cancelled');
  });
  it('preserves the typed transport failure at run level', async () => {
    const e = await engine();
    e.ports.harness.script([
      {
        announceSession: false,
        submission: 'definitely-not-submitted',
        error: {
          code: 'HARNESS_TRANSPORT_FAILED',
          message: 'Controlled transport refusal',
          retriable: false,
        },
      },
    ]);
    const run = await e.runToIdle(e.publish(cycle()).loopId);
    expect(run.failure?.code).toBe('HARNESS_TRANSPORT_FAILED');
    expect(e.ports.harness.started).toHaveLength(1);
  });
});
