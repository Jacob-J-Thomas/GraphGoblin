import { afterEach, expect, it, vi } from 'vitest';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { createTestEngine, type TestEngine } from './testing/scenario.js';
import { AdmissionConflictError } from './admission.js';
let engine: TestEngine;
afterEach(() => {
  engine?.manager.stop();
  vi.restoreAllMocks();
});
async function setup() {
  engine = await createTestEngine();
  const definition = minimalLoop();
  definition.nodes[0]!.config = { type: 'event', eventType: 'ready' };
  const version = engine.publish(definition);
  const input = {
    ownerId: 'local',
    loopId: version.loopId,
    versionId: version.id,
    triggerNodeId: 'start',
    triggerKind: 'event' as const,
    source: 'event' as const,
    eventType: 'ready',
    payload: null,
    dedupeKey: 'key',
  };
  const claim = {
    id: engine.ports.ids.next(),
    ownerId: 'local',
    loopId: version.loopId,
    versionId: version.id,
    triggerNodeId: 'start',
    inbound: {
      id: engine.ports.ids.next(),
      ownerId: 'local',
      type: 'ready',
      source: 'api',
      payload: null,
      receivedAt: engine.ports.clock.now().toISOString(),
      runIds: [],
      dedupeKey: 'key',
    },
  };
  return { claim, input, version, store: engine.ports.admission.events };
}
it('recovers uncertain acknowledgements at both claim and atomic run commit without duplicating a run', async () => {
  const { claim, input, store } = await setup();
  const observed: string[] = [];
  const claimReal = store.claim.bind(store);
  vi.spyOn(store, 'claim').mockImplementationOnce(async (...args) => {
    engine.ports.events.subscribe(args[1].run.id, (event) => {
      if (event.type === 'run.queued') observed.push(store.receipts.get(claim.id)!.status);
    });
    await claimReal(...args);
    throw Error('lost claim ack');
  });
  const createReal = store.create.bind(store);
  vi.spyOn(store, 'create').mockImplementationOnce(async (...args) => {
    await createReal(...args);
    throw Error('lost run ack');
  });
  const accepted = await engine.manager.receiveEvent(claim, input);
  await engine.manager.waitForIdle();
  expect(await store.get(claim.id)).toMatchObject({
    status: 'admitted',
    inbound: { runIds: [accepted.receipt.intent!.run.id] },
  });
  expect(
    engine.eventTypes(accepted.receipt.intent!.run.id).filter((t) => t === 'run.queued'),
  ).toHaveLength(1);
  expect(observed).toEqual(['admitted']);
});
it('never accepts an unconfirmed or mismatched claim', async () => {
  const { claim, input, store } = await setup();
  await expect(
    engine.manager.receiveEvent({ ...claim, loopId: 'wrong' }, input),
  ).rejects.toBeInstanceOf(AdmissionConflictError);
  vi.spyOn(store, 'claim').mockRejectedValueOnce(Error('unconfirmed'));
  await expect(engine.manager.receiveEvent(claim, input)).rejects.toThrow('unconfirmed');
  expect(await store.get(claim.id)).toBeUndefined();
});
it('bounds transient failures, keeps pending pins and stops retrying a deterministic corrupt intent', async () => {
  const { claim, input, store } = await setup();
  const create = vi.spyOn(store, 'create').mockRejectedValue(Error('disk fault'));
  await engine.manager.receiveEvent(claim, input);
  await engine.manager.waitForIdle();
  expect(await store.hasPendingPin(input.loopId)).toBe(true);
  const retry = {
    ...claim,
    id: engine.ports.ids.next(),
    inbound: { ...claim.inbound, id: engine.ports.ids.next() },
  };
  expect((await engine.manager.receiveEvent(retry, input)).duplicate).toBe(true);
  for (let i = 0; i < 7; i++) {
    engine.ports.clock.advance(300000);
    await engine.manager.retryPendingWebhooks();
  }
  expect(await store.get(claim.id)).toMatchObject({
    status: 'failed',
    attempts: 8,
    failureCode: 'EVENT_ADMISSION_EXHAUSTED',
  });
  expect(create).toHaveBeenCalledTimes(8);
});
it('classifies an immutable intent conflict and a removed version permanently', async () => {
  const { claim, input, store } = await setup();
  vi.spyOn(store, 'create').mockRejectedValueOnce(new AdmissionConflictError());
  await engine.manager.receiveEvent(claim, input);
  await engine.manager.waitForIdle();
  expect(await store.get(claim.id)).toMatchObject({
    status: 'failed',
    failureCode: 'EVENT_INTENT_CONFLICT',
  });
  const next = {
    ...claim,
    id: engine.ports.ids.next(),
    inbound: { ...claim.inbound, id: engine.ports.ids.next(), dedupeKey: 'other' },
  };
  const create = vi.spyOn(store, 'create').mockRejectedValueOnce(Error('wait'));
  await engine.manager.receiveEvent(next, { ...input, dedupeKey: 'other' });
  await engine.manager.waitForIdle();
  create.mockRestore();
  engine.ports.loops.versions.delete(input.versionId);
  engine.ports.clock.advance(5000);
  await engine.manager.retryPendingWebhooks();
  expect(await store.get(next.id)).toMatchObject({
    status: 'failed',
    failureCode: 'EVENT_TARGET_REMOVED',
  });
});
