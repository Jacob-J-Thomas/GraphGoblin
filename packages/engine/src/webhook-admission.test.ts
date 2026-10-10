import { afterEach, describe, expect, it, vi } from 'vitest';
import { minimalLoop, fakeUlid } from '@graphgoblin/contracts/testing';
import { AdmissionConflictError, parseRunAdmission } from './admission.js';
import { RunManager } from './run-manager.js';
import { createTestEngine } from './testing/scenario.js';
import { DEFAULT_TEST_SETTINGS } from './testing/fakes.js';
const managers: RunManager[] = [];
afterEach(() => {
  for (const manager of managers.splice(0)) manager.stop();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
async function setup() {
  const engine = await createTestEngine();
  managers.push(engine.manager);
  const definition = minimalLoop();
  definition.nodes[0]!.config = {
    subtype: 'webhook',
    signature: { scheme: 'hmac-sha256-body', secretRef: 'secret' },
  };
  const version = engine.publish(definition);
  const input = {
    ownerId: 'local',
    loopId: version.loopId,
    versionId: version.id,
    triggerNodeId: 'start',
    triggerKind: 'webhook' as const,
    source: 'webhook' as const,
    payload: { id: 1 },
  };
  const claim = {
    id: engine.ports.ids.next(),
    ownerId: 'local',
    loopId: version.loopId,
    triggerNodeId: 'start',
    contentHash: 'a'.repeat(64),
    inbound: {
      id: engine.ports.ids.next(),
      ownerId: 'local',
      type: 'webhook',
      payload: { id: 1 },
      source: 'webhook:ep',
      receivedAt: engine.ports.clock.now().toISOString(),
      runIds: [],
    },
  };
  return { engine, version, input, claim };
}
describe('durable webhook admission', () => {
  it('consumes filtered content across versions and takes no execution pins', async () => {
    const { engine, input, claim } = await setup();
    expect((await engine.manager.receiveWebhook(claim, input, true)).state).toBe('filtered');
    expect(
      (await engine.manager.receiveWebhook({ ...claim, id: engine.ports.ids.next() }, input, false))
        .state,
    ).toBe('duplicate');
    expect(await engine.manager.loopInUse(input.loopId)).toBe(false);
    expect(engine.ports.runs.runs.size).toBe(0);
  });
  it('keeps business duplicate content terminal across a restarted manager and known webhook runs', async () => {
    const { engine, input, claim } = await setup();
    const keyedInput = { ...input, dedupeKey: 'key' };
    const keyedClaim = {
      ...claim,
      dedupeByKey: true as const,
      inbound: { ...claim.inbound, dedupeKey: 'key' },
    };
    expect((await engine.manager.receiveWebhook(keyedClaim, keyedInput, true)).state).toBe(
      'filtered',
    );
    engine.manager.stop();
    const restarted = new RunManager(engine.ports, DEFAULT_TEST_SETTINGS);
    managers.push(restarted);
    await restarted.start();
    const distinct = {
      ...keyedClaim,
      id: engine.ports.ids.next(),
      contentHash: 'b'.repeat(64),
      inbound: { ...keyedClaim.inbound, id: engine.ports.ids.next() },
    };
    const result = await restarted.receiveWebhook(distinct, keyedInput, false);
    expect(result.state).toBe('deduplicated');
    expect(result.receipt.intent).toBeUndefined();
    expect(await restarted.loopInUse(input.loopId)).toBe(false);
    expect(engine.ports.runs.runs.size).toBe(0);
    const historic = await restarted.startRun({ ...keyedInput, dedupeKey: 'historic' });
    await restarted.waitForIdle();
    const known = {
      ...distinct,
      id: engine.ports.ids.next(),
      contentHash: 'c'.repeat(64),
      inbound: { ...distinct.inbound, id: engine.ports.ids.next(), dedupeKey: 'historic' },
    };
    expect(
      (await restarted.receiveWebhook(known, { ...keyedInput, dedupeKey: 'historic' }, false))
        .state,
    ).toBe('deduplicated');
    expect([...engine.ports.runs.runs.keys()]).toEqual([historic.id]);
    Object.defineProperty(known, 'dedupeByKey', { value: false });
    expect(() => engine.ports.admission.claim(known)).toThrow(AdmissionConflictError);
  });
  it('uses items-only atomic admission without reusing, enqueuing or consuming pending reserved identities', async () => {
    const { engine, input, claim, version } = await setup();
    const keyed = { ...claim, inbound: { ...claim.inbound, dedupeKey: 'same' } };
    vi.spyOn(engine.ports.admission, 'create').mockRejectedValueOnce(new Error('retry'));
    const pending = await engine.manager.receiveWebhook(
      keyed,
      { ...input, dedupeKey: 'same' },
      false,
    );
    const definition = minimalLoop();
    definition.nodes[0]!.config = {
      subtype: 'poll',
      intervalSeconds: 5,
      probe: { kind: 'script', command: 'fake' },
      fireWhen: 'true',
      items: { select: 'probe.json', dedupeKey: 'item.key' },
    };
    const current = engine.publish(definition, { loopId: version.loopId, version: 2 });
    const poll = {
      ...input,
      versionId: current.id,
      source: 'poll' as const,
      triggerKind: 'poll' as const,
      dedupeKey: 'same',
    };
    expect(await engine.manager.startPollItem(poll)).toBeUndefined();
    expect(engine.ports.runs.runs.size).toBe(0);
    await engine.ports.admission.failed(pending.receipt.id, 'WEBHOOK_INTENT_CONFLICT');
    const admitted = await engine.manager.startPollItem(poll);
    expect(admitted).toBeDefined();
    await engine.manager.waitForIdle();
    expect(await engine.manager.startPollItem(poll)).toBeUndefined();
    expect(engine.ports.runs.runs.size).toBe(1);
    expect([...engine.ports.runs.runs.keys()]).toEqual([admitted!.id]);
    await expect(
      engine.manager.startPollItem({ ...poll, versionId: version.id }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    const actual = engine.ports.admission.receipts.get(pending.receipt.id)!.intent!;
    await expect(engine.ports.admission.createPollItem(actual)).rejects.toMatchObject({
      code: 'WEBHOOK_INTENT_CONFLICT',
    });
  });
  it('retains allocated identity and deletion pins before commit, then retries without redelivery', async () => {
    const { engine, input, claim } = await setup();
    const create = vi
      .spyOn(engine.ports.admission, 'create')
      .mockRejectedValueOnce(new Error('credential-marker'));
    const pending = await engine.manager.receiveWebhook(claim, input, false);
    expect(pending.state).toBe('pending');
    expect(engine.ports.runs.runs.size).toBe(0);
    expect(await engine.manager.deleteLoopUnlessInUse(input.loopId, () => Promise.resolve())).toBe(
      false,
    );
    await engine.manager.retryPendingWebhooks();
    expect(create).toHaveBeenCalledTimes(1);
    engine.ports.clock.advance(5000);
    await engine.manager.retryPendingWebhooks();
    await engine.manager.waitForIdle();
    expect([...engine.ports.runs.runs.keys()]).toEqual([pending.receipt.intent!.run.id]);
    expect(
      engine.ports.events
        .all(pending.receipt.intent!.run.id)
        .filter((e) => e.type === 'run.queued'),
    ).toHaveLength(1);
    expect(pending.receipt.status).toBe('admitted');
    expect(pending.receipt.attempts).toBe(1);
    expect(JSON.stringify([...engine.ports.admission.receipts.values()])).not.toContain(
      'credential-marker',
    );
  });
  it('refuses claim after deletion wins and serializes removal against claim commit', async () => {
    const { engine, input, claim, version } = await setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let entered!: () => void;
    const started = new Promise<void>((r) => {
      entered = r;
    });
    const deletion = engine.manager.deleteLoopUnlessInUse(input.loopId, async () => {
      entered();
      await gate;
      engine.ports.loops.versions.delete(version.id);
    });
    await started;
    const admission = engine.manager.receiveWebhook(claim, input, false);
    release();
    expect(await deletion).toBe(true);
    await expect(admission).rejects.toMatchObject({ code: 'LOOP_NOT_FOUND' });
    expect(engine.ports.admission.receipts.size).toBe(0);
  });
  it('boot and periodic sweep reuse a committed identity after a lost acknowledgement', async () => {
    const { engine, input, claim } = await setup();
    const original = engine.ports.admission.create.bind(engine.ports.admission);
    vi.spyOn(engine.ports.admission, 'create').mockImplementationOnce(async (intent, id) => {
      await original(intent, id);
      throw new Error('after-commit');
    });
    const pending = await engine.manager.receiveWebhook(claim, input, false);
    expect(pending.state).toBe('admitted');
    expect(pending.receipt.status).toBe('admitted');
    await engine.manager.waitForIdle();
    engine.manager.stop();
    const restarted = new RunManager(engine.ports, DEFAULT_TEST_SETTINGS);
    managers.push(restarted);
    await restarted.start();
    await restarted.waitForIdle();
    expect(engine.ports.runs.runs.size).toBe(1);
    expect(
      engine.ports.events
        .all(pending.receipt.intent!.run.id)
        .filter((e) => e.type === 'run.queued'),
    ).toHaveLength(1);
  });
  it('bounds sweeps at five, persists backoff and refuses a changed existing invocation permanently', async () => {
    const { engine, input, claim } = await setup();
    vi.spyOn(engine.ports.admission, 'create').mockRejectedValue(new Error('retry'));
    for (let i = 0; i < 7; i++)
      await engine.manager.receiveWebhook(
        {
          ...claim,
          id: engine.ports.ids.next(),
          contentHash: String(i).repeat(64),
          inbound: { ...claim.inbound, id: engine.ports.ids.next() },
        },
        input,
        false,
      );
    engine.ports.clock.advance(5000);
    const create = vi.spyOn(engine.ports.admission, 'create');
    create.mockClear();
    await Promise.all([
      engine.manager.retryPendingWebhooks(),
      engine.manager.retryPendingWebhooks(),
    ]);
    expect(create).toHaveBeenCalledTimes(5);
    const receipt = [...engine.ports.admission.receipts.values()][0]!;
    create.mockRejectedValue(new AdmissionConflictError());
    engine.ports.clock.advance(10000);
    await engine.manager.retryPendingWebhooks();
    expect(receipt.status).toBe('failed');
    expect(receipt.failureCode).toBe('WEBHOOK_INTENT_CONFLICT');
  });
  it('finishes ordinary boot recovery before admitting fresh pending webhook runs', async () => {
    const { engine, input, claim } = await setup();
    vi.spyOn(engine.ports.admission, 'create').mockRejectedValueOnce(new Error('retry'));
    const pending = await engine.manager.receiveWebhook(claim, input, false);
    const runId = pending.receipt.intent!.run.id;
    engine.manager.stop();
    engine.ports.clock.advance(5000);
    const original = engine.ports.runs.listByStatus.bind(engine.ports.runs);
    const ordinaryRecoverySawFreshRun: boolean[] = [];
    vi.spyOn(engine.ports.runs, 'listByStatus').mockImplementation((statuses) => {
      ordinaryRecoverySawFreshRun.push(engine.ports.runs.runs.has(runId));
      return original(statuses);
    });
    const restarted = new RunManager(engine.ports, DEFAULT_TEST_SETTINGS);
    managers.push(restarted);
    await restarted.start();
    await restarted.waitForIdle();
    expect(ordinaryRecoverySawFreshRun).toEqual([false]);
    expect(engine.ports.events.all(runId).filter((event) => event.type === 'run.started')).toEqual([
      expect.objectContaining({ attempt: 1 }),
    ]);
    expect(engine.ports.runs.runs.size).toBe(1);
  });
  it('rejects malformed immutable intent fields', async () => {
    const { engine, input, claim } = await setup();
    const accepted = await engine.manager.receiveWebhook(claim, input, false);
    await engine.manager.waitForIdle();
    const intent = accepted.receipt.intent!;
    for (const value of [
      null,
      {},
      { ...intent, run: { ...intent.run, status: 'running' } },
      { ...intent, pinnedLoopIds: [1] },
      { ...intent, run: { ...intent.run, id: fakeUlid('other') } },
      { ...intent, queued: { type: 'run.finished' } },
    ])
      expect(() => parseRunAdmission(value)).toThrow(AdmissionConflictError);
  });
});

it('periodic recovery runs without a restart and caps persisted backoff at five minutes', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const { engine, input, claim } = await setup();
  const create = vi.spyOn(engine.ports.admission, 'create').mockRejectedValue(new Error('retry'));
  const pending = await engine.manager.receiveWebhook(claim, input, false);
  for (let i = 0; i < 9; i++) {
    engine.ports.clock.advance(300000);
    await vi.advanceTimersByTimeAsync(15000);
    const next = Date.parse(pending.receipt.nextAttemptAt!) - engine.ports.clock.now().getTime();
    expect(next).toBeLessThanOrEqual(300000);
  }
  expect(pending.receipt.attempts).toBe(10);
  create.mockRestore();
  engine.ports.clock.advance(300000);
  await vi.advanceTimersByTimeAsync(15000);
  await engine.manager.waitForIdle();
  expect(pending.receipt.status).toBe('admitted');
  expect(engine.ports.runs.runs.size).toBe(1);
});
it('marks a removed saved target permanently failed and ignores stale already-admitted sweep rows', async () => {
  const { engine, input, claim, version } = await setup();
  const create = vi
    .spyOn(engine.ports.admission, 'create')
    .mockRejectedValueOnce(new Error('retry'));
  const pending = await engine.manager.receiveWebhook(claim, input, false);
  engine.ports.loops.versions.delete(version.id);
  engine.ports.clock.advance(5000);
  await engine.manager.retryPendingWebhooks();
  expect(pending.receipt.failureCode).toBe('WEBHOOK_TARGET_REMOVED');
  expect(pending.receipt.status).toBe('failed');
  expect(await engine.manager.loopInUse(input.loopId)).toBe(false);
  create.mockClear();
  vi.spyOn(engine.ports.admission, 'due').mockResolvedValue([
    { ...pending.receipt, status: 'admitted' },
  ]);
  await engine.manager.retryPendingWebhooks();
  expect(create).not.toHaveBeenCalled();
});
