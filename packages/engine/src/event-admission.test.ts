import { afterEach, expect, it, vi } from 'vitest';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { createTestEngine, type TestEngine } from './testing/scenario.js';
import { AdmissionConflictError } from './admission.js';
import { RunManager } from './run-manager.js';
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

it.each(['EVENT_ADMISSION_EXHAUSTED', 'EVENT_INTENT_CONFLICT'] as const)(
  'fake releases the authored node key after %s',
  async (code) => {
    const { claim, input, store } = await setup();
    const create = vi.spyOn(store, 'create').mockRejectedValue(Error('disk fault'));
    await engine.manager.receiveEvent({ ...claim, nodeDedupeKey: 'key' }, input);
    await engine.manager.waitForWebhookRecovery();
    await store.failed(claim.id, code);
    create.mockRestore();
    const next = {
      ...claim,
      id: engine.ports.ids.next(),
      inbound: { ...claim.inbound, id: engine.ports.ids.next(), dedupeKey: 'r2' },
      nodeDedupeKey: 'key',
    };
    const accepted = await engine.manager.receiveEvent(next, input);
    expect(accepted.receipt.status).toBe('pending');
    await engine.manager.waitForIdle();
    expect(await store.get(next.id)).toMatchObject({ status: 'admitted' });
    expect(engine.ports.runs.runs.size).toBe(1);
  },
);

it.each([
  ['event', 'due'],
  ['event', 'failed'],
  ['webhook', 'due'],
  ['webhook', 'failed'],
] as const)(
  'isolates the %s sweep after a %s operation failure, including boot',
  async (kind, operation) => {
    const { claim, input, store } = await setup();
    const definition = minimalLoop();
    definition.name = 'webhook sweep';
    definition.nodes[0]!.config = { type: 'webhook' };
    const version = engine.publish(definition);
    const webhook = {
      id: engine.ports.ids.next(),
      ownerId: 'local',
      loopId: version.loopId,
      triggerNodeId: 'start',
      contentHash: 'a'.repeat(64),
      inbound: {
        ...claim.inbound,
        id: engine.ports.ids.next(),
        type: 'webhook',
        source: 'webhook:ep',
      },
    };
    const admission = engine.ports.admission;
    const blocked = vi.spyOn(admission, 'create').mockRejectedValue(Error('disk fault'));
    await engine.manager.receiveEvent(claim, input);
    await engine.manager.receiveWebhook(webhook, {
      ...input,
      loopId: version.loopId,
      versionId: version.id,
      triggerKind: 'webhook',
      source: 'webhook',
    });
    await engine.manager.waitForWebhookRecovery();
    blocked.mockRestore();
    engine.ports.clock.advance(5000);
    const broken = kind === 'event' ? store : admission;
    if (operation === 'due') vi.spyOn(broken, 'due').mockRejectedValueOnce(Error('due fault'));
    else {
      if (kind === 'event') vi.spyOn(store, 'create').mockRejectedValue(Error('create fault'));
      else {
        // Events delegate their commit to this same fake adapter; fault only the webhook receipt.
        const create = admission.create.bind(admission);
        vi.spyOn(admission, 'create').mockImplementation((intent, receiptId, onCommitted) => {
          if (receiptId === webhook.id) return Promise.reject(Error('create fault'));
          return create(intent, receiptId, onCommitted);
        });
      }
      vi.spyOn(broken, 'failed').mockRejectedValueOnce(Error('metadata fault'));
    }
    engine.manager.stop();
    engine.manager = new RunManager(engine.ports, engine.settings);
    await expect(engine.manager.start()).resolves.toBeUndefined();
    await engine.manager.waitForIdle();
    const healthy = kind === 'event' ? await admission.get(webhook.id) : await store.get(claim.id);
    expect(healthy?.status).toBe('admitted');
    expect(engine.ports.logger.lines).toContainEqual(
      expect.objectContaining({
        level: 'error',
        obj: expect.objectContaining({
          code: kind === 'event' ? 'EVENT_RECOVERY_FAILED' : 'WEBHOOK_RECOVERY_FAILED',
        }),
      }),
    );
  },
);

it('reaches a healthy receipt behind five whose failure metadata can never be written', async () => {
  const { claim, input, store } = await setup();
  const blocked = vi.spyOn(store, 'create').mockRejectedValue(Error('disk fault'));
  const stuck: string[] = [];
  for (const key of ['s1', 's2', 's3', 's4', 's5', 'healthy']) {
    const next = {
      ...claim,
      id: engine.ports.ids.next(),
      inbound: { ...claim.inbound, id: engine.ports.ids.next(), dedupeKey: key },
    };
    await engine.manager.receiveEvent(next, { ...input, dedupeKey: key });
    if (key !== 'healthy') stuck.push(next.id);
  }
  await engine.manager.waitForWebhookRecovery();
  blocked.mockRestore();
  const create = store.create.bind(store);
  vi.spyOn(store, 'create').mockImplementation((intent, receiptId) =>
    stuck.includes(receiptId) ? Promise.reject(Error('disk fault')) : create(intent, receiptId),
  );
  const failed = store.failed.bind(store);
  vi.spyOn(store, 'failed').mockImplementation((id, code, retryAt) =>
    stuck.includes(id) ? Promise.reject(Error('metadata fault')) : failed(id, code, retryAt),
  );
  // The first sweep fills its page with the stuck five; the next continues past them.
  for (let i = 0; i < 2; i++) {
    engine.ports.clock.advance(300_001);
    await engine.manager.retryPendingWebhooks();
    await engine.manager.waitForIdle();
  }
  const healthy = [...store.receipts.values()].find((r) => r.inbound.dedupeKey === 'healthy');
  expect(healthy).toMatchObject({ status: 'admitted' });
  for (const id of stuck) expect(await store.get(id)).toMatchObject({ status: 'pending' });
  // A short page wraps to the start, so the stuck receipts are still revisited.
  const revisits = vi.mocked(store.create).mock.calls.length;
  engine.ports.clock.advance(300_001);
  await engine.manager.retryPendingWebhooks();
  await engine.manager.waitForIdle();
  expect(vi.mocked(store.create).mock.calls.length).toBe(revisits + 5);
});

it('fake matches an unnamed retry across entries and refuses an ambiguous one', async () => {
  const { claim, input, store } = await setup();
  await engine.manager.receiveEvent({ ...claim, implicitEntry: true }, input);
  expect(
    (
      await store.claim(
        { ...claim, id: engine.ports.ids.next(), implicitEntry: true },
        (await store.get(claim.id))!.intent!,
      )
    ).duplicate,
  ).toBe(true);
  store.receipts.set('other-entry', {
    ...(await store.get(claim.id))!,
    id: 'other-entry',
    triggerNodeId: 'other',
  });
  await expect(
    engine.manager.receiveEvent(
      {
        ...claim,
        id: engine.ports.ids.next(),
        inbound: { ...claim.inbound, id: engine.ports.ids.next() },
        implicitEntry: true,
      },
      input,
    ),
  ).rejects.toBeInstanceOf(AdmissionConflictError);
});

it('continues the Event sweep past a persistently broken receipt metadata write', async () => {
  const { claim, input, store } = await setup();
  const blocked = vi.spyOn(store, 'create').mockRejectedValue(Error('disk fault'));
  await engine.manager.receiveEvent(claim, input);
  const next = {
    ...claim,
    id: engine.ports.ids.next(),
    inbound: { ...claim.inbound, id: engine.ports.ids.next(), dedupeKey: 'next' },
  };
  await engine.manager.receiveEvent(next, { ...input, dedupeKey: 'next' });
  await engine.manager.waitForWebhookRecovery();
  blocked.mockRestore();
  const create = store.create.bind(store);
  vi.spyOn(store, 'create').mockImplementation((intent, receiptId) => {
    if (receiptId === claim.id) return Promise.reject(Error('disk fault'));
    return create(intent, receiptId);
  });
  const failed = store.failed.bind(store);
  vi.spyOn(store, 'failed').mockImplementation((id, code, retryAt) => {
    if (id === claim.id) return Promise.reject(Error('metadata fault'));
    return failed(id, code, retryAt);
  });
  for (let i = 0; i < 2; i++) {
    engine.ports.clock.advance(300_001);
    await engine.manager.retryPendingWebhooks();
    await engine.manager.waitForIdle();
    expect(await store.get(claim.id)).toMatchObject({ status: 'pending', attempts: 1 });
    expect(await store.get(next.id)).toMatchObject({ status: 'admitted' });
    expect(engine.ports.runs.runs.size).toBe(1);
  }
  expect(engine.ports.logger.lines).toContainEqual(
    expect.objectContaining({
      level: 'error',
      obj: expect.objectContaining({ code: 'EVENT_RECOVERY_FAILED' }),
    }),
  );
});
