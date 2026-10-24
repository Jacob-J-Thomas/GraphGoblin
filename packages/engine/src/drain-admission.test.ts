import { expect, it, vi } from 'vitest';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { createTestEngine, singleNodeLoop } from './testing/scenario.js';
import type { RunAdmissionScope } from './run-manager.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

it('rechecks runnable work awakened while delivery cleanup is pending', async () => {
  const e = await createTestEngine();
  const delivery = deferred();
  e.ports.delivery.responder = async () => {
    await delivery.promise;
    return { ok: true };
  };
  const work = singleNodeLoop('wake in delivery cleanup', {
    id: 'input',
    kind: 'wait',
    label: 'Input',
    config: { mode: 'input', prompt: 'Continue' },
  });
  work.nodes.splice(2, 0, {
    id: 'hold',
    kind: 'inference',
    label: 'Hold',
    config: { harness: 'codex', prompt: { template: 'Hold' } },
  });
  work.edges = [
    { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'input' } },
    { id: 'b', from: { node: 'input', port: 'out' }, to: { node: 'hold' } },
    { id: 'c', from: { node: 'hold', port: 'out' }, to: { node: 'done' } },
  ];
  const v = e.publish(work);
  const run = await e.start(v.loopId);
  await e.manager.waitForIdle();
  const waiting = (await e.ports.runs.get(run.id))!.waiting!;
  const returned = minimalLoop();
  returned.name = 'held outbound delivery';
  const exit = returned.nodes.find((n) => n.kind === 'exit');
  if (!exit || exit.kind !== 'exit') throw new Error('Missing exit');
  exit.config = {
    returns: '"ok"',
    destinations: [{ kind: 'webhook', url: 'https://receiver.test' }],
  };
  await e.start(e.publish(returned).loopId);
  await vi.waitFor(() => expect(e.ports.delivery.webhooks).toHaveLength(1));
  vi.useFakeTimers();
  const draining = e.manager.waitForDrain();
  let done = false;
  void draining.then(() => {
    done = true;
  });
  try {
    await vi.advanceTimersByTimeAsync(100);
    e.ports.harness.script([{ delayMs: 1000, finalText: 'done' }]);
    await e.manager.provideInput(run.id, waiting.waitId, 'continue');
    await vi.advanceTimersByTimeAsync(10);
    expect(e.ports.harness.started).toHaveLength(1);
    delivery.resolve();
    await vi.advanceTimersByTimeAsync(100);
    expect(done, 'delivery cleanup must not seal a drain with an awakened executor').toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    await draining;
    expect((await e.ports.runs.get(run.id))?.status).toBe('succeeded');
  } finally {
    delivery.resolve();
    await vi.advanceTimersByTimeAsync(2000);
    await draining;
    e.manager.stop();
    vi.useRealTimers();
  }
});

it('holds drain until an intake already accepted before closure has durable queued work', async () => {
  const e = await createTestEngine();
  const v = e.publish(minimalLoop());
  const entered = deferred(),
    release = deferred();
  const start = e.manager.startRun(
    { ownerId: 'local', loopId: v.loopId, source: 'manual.api' },
    async () => {
      entered.resolve();
      await release.promise;
    },
  );
  const outcome = start.then(
    (run) => ({ run }),
    (error: unknown) => ({ error }),
  );
  await entered.promise;
  vi.useFakeTimers();
  let done = false;
  const drain = e.manager.waitForDrain().then(() => {
    done = true;
  });
  try {
    await vi.advanceTimersByTimeAsync(100);
    expect(done, 'in-flight intake must hold ownership until its durable outcome').toBe(false);
    release.resolve();
    expect(await outcome).toMatchObject({ run: { status: 'queued' } });
    await vi.advanceTimersByTimeAsync(100);
    await drain;
  } finally {
    release.resolve();
    await outcome;
    await vi.advanceTimersByTimeAsync(100);
    await drain;
    e.manager.stop();
    vi.useRealTimers();
  }
});

it('refuses wakes after the quiescent handoff without changing durable parks', async () => {
  const e = await createTestEngine();
  const v = e.publish(
    singleNodeLoop('sealed input', {
      id: 'work',
      kind: 'wait',
      label: 'Input',
      config: { mode: 'input', prompt: 'Continue' },
    }),
  );
  const run = await e.start(v.loopId);
  await e.manager.waitForIdle();
  const parked = (await e.ports.runs.get(run.id))!;
  await e.manager.waitForDrain();
  try {
    await expect(
      e.manager.provideInput(run.id, parked.waiting!.waitId, 'late'),
    ).rejects.toMatchObject({ code: 'SHUTTING_DOWN' });
    await expect(e.manager.signal(run.id, 'late', parked.waiting!.waitId)).rejects.toMatchObject({
      code: 'SHUTTING_DOWN',
    });
    expect(await e.ports.runs.get(run.id)).toEqual(parked);
  } finally {
    e.manager.stop();
  }
});

it('keeps a multi-write intake scope open through drain and refuses reuse after release', async () => {
  const e = await createTestEngine();
  const v = e.publish(minimalLoop());
  const entered = deferred(),
    release = deferred();
  const scopes: RunAdmissionScope[] = [];
  const intake = e.manager.withAdmission(async (scope) => {
    scopes.push(scope);
    entered.resolve();
    await release.promise; // represents an inbound receipt/transaction already in flight
    return scope.startRun({ ownerId: 'local', loopId: v.loopId, source: 'event' });
  });
  await entered.promise;
  await e.manager.beginDrain();
  release.resolve();
  const run = await intake;
  expect(run.status).toBe('queued');
  await expect(
    scopes[0]!.startRun({ ownerId: 'local', loopId: v.loopId, source: 'event' }),
  ).rejects.toMatchObject({ code: 'INVALID_STATE' });
  await e.manager.waitForDrain();
  expect(await e.ports.runs.get(run.id)).toMatchObject({ status: 'queued' });
  e.manager.stop();
});
