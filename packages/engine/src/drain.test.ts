import { RunManager } from './run-manager.js';
import { FakeTimers } from './testing/fakes.js';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { expect, it, vi } from 'vitest';
import { createTestEngine, singleNodeLoop } from './testing/scenario.js';

it('refuses every independent admission source after drain, including a slow in-flight admission', async () => {
  const e = await createTestEngine();
  const v = e.publish(minimalLoop());
  let release!: () => void;
  let entered!: () => void;
  const reached = new Promise<void>((r) => {
    entered = r;
  });
  const pending = e.manager.startRun(
    { ownerId: 'local', loopId: v.loopId, source: 'manual.api' },
    async () => {
      entered();
      await new Promise<void>((r) => {
        release = r;
      });
    },
  );
  await reached;
  await e.manager.beginDrain();
  release();
  await expect(pending).rejects.toMatchObject({ code: 'SHUTTING_DOWN' });
  for (const source of [
    'manual.api',
    'manual.ui',
    'manual.mcp',
    'cron',
    'webhook',
    'poll',
    'event',
  ] as const)
    await expect(e.start(v.loopId, null, { source })).rejects.toMatchObject({
      code: 'SHUTTING_DOWN',
    });
  await expect(
    e.manager.startPollItem({ ownerId: 'local', loopId: v.loopId, source: 'poll' }),
  ).rejects.toMatchObject({ code: 'SHUTTING_DOWN' });
  await e.manager.waitForDrain();
  e.manager.stop();
});

it('runs due parked timers while independent queue entries are preserved', async () => {
  const e = await createTestEngine({ maxConcurrentRuns: 1 });
  const v = e.publish(
    singleNodeLoop('timer', {
      id: 'work',
      kind: 'wait',
      label: 'Timer',
      config: { mode: 'duration', seconds: 1 },
    }),
  );
  const run = await e.start(v.loopId);
  await e.manager.waitForIdle();
  await e.manager.beginDrain();
  e.ports.clock.advance(1000);
  await e.ports.timers.fire(run.id, 'timer');
  await e.manager.waitForDrain();
  expect((await e.ports.runs.get(run.id))?.status).toBe('succeeded');
  e.manager.stop();
});

it('force preserves a parent and child parked on durable input', async () => {
  const e = await createTestEngine({ maxConcurrentRuns: 1 });
  const leaf = e.publish(
    singleNodeLoop('leaf', {
      id: 'work',
      kind: 'wait',
      label: 'Input',
      config: { mode: 'input', prompt: 'answer' },
    }),
  );
  const parent = e.publish(
    singleNodeLoop('parent', {
      id: 'sub',
      kind: 'subloop',
      label: 'Sub',
      config: { loopRef: { loopId: leaf.loopId } },
    }),
  );
  const run = await e.start(parent.loopId);
  await e.manager.waitForIdle();
  const children = await e.ports.runs.listChildren(run.id);
  expect(children).toHaveLength(1);
  const ids = [run.id, children[0]!.id];
  const before = await Promise.all(ids.map((id) => e.ports.runs.get(id)));
  await e.manager.forceStop();
  expect(await Promise.all(ids.map((id) => e.ports.runs.get(id)))).toEqual(before);
  for (const id of ids) expect(e.eventTypes(id)).not.toContain('run.failed');
  e.manager.stop();
});

it('allows explicit user cancellation during a drain', async () => {
  const e = await createTestEngine();
  const v = e.publish(
    singleNodeLoop('cancel', {
      id: 'work',
      kind: 'wait',
      label: 'Input',
      config: { mode: 'input', prompt: 'answer' },
    }),
  );
  const run = await e.start(v.loopId);
  await e.manager.waitForIdle();
  await e.manager.beginDrain();
  await e.manager.cancel(run.id);
  await e.manager.waitForDrain();
  expect((await e.ports.runs.get(run.id))?.status).toBe('cancelled');
  e.manager.stop();
});

it('interrupts an in-flight harness turn and awaits cancellation', async () => {
  const e = await createTestEngine();
  const loop = singleNodeLoop('late', {
    id: 'work',
    kind: 'inference',
    label: 'Work',
    config: { prompt: { template: 'Hold' }, harness: 'codex' },
  });
  e.ports.harness.script([{ delayMs: 100, finalText: 'late' }]);
  const v = e.publish(loop);
  const run = await e.start(v.loopId);
  await vi.waitFor(() => expect(e.ports.harness.started).toHaveLength(1));
  await e.manager.forceStop();
  expect((await e.ports.runs.get(run.id))?.failure?.code).toBe('RUN_INTERRUPTED_BY_STOP');
  e.manager.stop();
});

it('force settles a run that is still committing its timer park', async () => {
  const e = await createTestEngine();
  e.manager.stop();
  let reached!: () => void, release!: () => void;
  const entered = new Promise<void>((r) => {
    reached = r;
  });
  const held = new Promise<void>((r) => {
    release = r;
  });
  class HeldTimers extends FakeTimers {
    override async schedule(runId: string, key: string, at: Date): Promise<void> {
      reached();
      await held;
      await super.schedule(runId, key, at);
    }
  }
  const manager = new RunManager({ ...e.ports, timers: new HeldTimers() }, e.settings);
  await manager.start();
  const v = e.publish(
    singleNodeLoop('park race', {
      id: 'work',
      kind: 'wait',
      label: 'Timer',
      config: { mode: 'duration', seconds: 1 },
    }),
  );
  const run = await manager.startRun({ ownerId: 'local', loopId: v.loopId, source: 'manual.api' });
  await entered;
  const forced = manager.forceStop();
  await manager.beginDrain();
  release();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      forced,
      new Promise<never>((_r, reject) => {
        timer = setTimeout(() => reject(new Error('force did not settle the parking run')), 2000);
      }),
    ]);
    expect((await e.ports.runs.get(run.id))?.failure?.code).toBe('RUN_INTERRUPTED_BY_STOP');
  } finally {
    clearTimeout(timer);
    if ((await e.ports.runs.get(run.id))?.status === 'waiting') await manager.cancel(run.id);
    await forced;
    manager.stop();
  }
});
