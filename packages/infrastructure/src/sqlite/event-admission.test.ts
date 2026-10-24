import { afterEach, beforeEach, expect, it } from 'vitest';
import { fakeUlid, FIXTURE_TS, samplePin } from '@graphgoblin/contracts/testing';
import {
  AdmissionConflictError,
  createInitialThread,
  type EventClaim,
  type RunAdmission,
} from '@graphgoblin/engine';
import { FakeClock } from '@graphgoblin/engine/testing';
import { SqliteTriggerAdmission } from './admission.js';
import { openMemoryDatabase, type DatabaseHandle } from './db.js';
import { SqliteEventStore } from './events.js';
import { SqliteInboundEvents } from './triggers.js';
let h: DatabaseHandle;
let store: SqliteTriggerAdmission;
beforeEach(async () => {
  h = await openMemoryDatabase();
  store = new SqliteTriggerAdmission(h.db, new SqliteEventStore(h.db, new FakeClock()));
});
afterEach(() => h.close());
function fixture(seed: string, key?: string, nodeKey?: string) {
  const run = {
    id: fakeUlid('run:' + seed),
    ownerId: 'local',
    loopId: fakeUlid('loop'),
    versionId: fakeUlid('version'),
    pinned: samplePin(),
    invocationId: fakeUlid('inv:' + seed),
    status: 'queued' as const,
    iteration: 1,
    createdAt: FIXTURE_TS,
    lastEventSeq: 0,
  };
  const initialThread = createInitialThread({
    runId: run.id,
    loopId: run.loopId,
    versionId: run.versionId,
    invocation: {
      id: run.invocationId,
      source: 'event',
      trigger: {
        nodeId: 'start',
        kind: 'event',
        eventType: 'ready',
        payload: null,
        receivedAt: FIXTURE_TS,
        ...((nodeKey ?? key) ? { dedupeKey: nodeKey ?? key } : {}),
      },
    },
  });
  const intent: RunAdmission = {
    run,
    initialThread,
    pinnedLoopIds: [run.loopId],
    queued: { type: 'run.queued', versionId: run.versionId, pinned: run.pinned, initialThread },
  };
  const claim: EventClaim = {
    id: fakeUlid('claim:' + seed),
    ownerId: 'local',
    loopId: run.loopId,
    versionId: run.versionId,
    triggerNodeId: 'start',
    inbound: {
      id: fakeUlid('inbound:' + seed),
      ownerId: 'local',
      type: 'ready',
      payload: null,
      source: 'api',
      receivedAt: FIXTURE_TS,
      runIds: [],
      ...(key ? { dedupeKey: key } : {}),
    },
    ...(nodeKey ? { nodeDedupeKey: nodeKey } : {}),
  };
  return { intent, claim };
}
it('atomically reserves request keys, returns the original receipt, commits once and exposes safe delivery metadata', async () => {
  const { claim, intent } = fixture('a', 'key');
  const { receipt } = await store.events.claim(claim, intent);
  expect(receipt.status).toBe('pending');
  expect(await store.events.hasPendingPin(claim.loopId)).toBe(true);
  expect(await store.events.hasPendingPin(fakeUlid('other'))).toBe(false);
  const retry = fixture('b', 'key');
  expect(await store.events.claim(retry.claim, retry.intent)).toMatchObject({
    duplicate: true,
    receipt: { id: claim.id },
  });
  expect(await store.events.find('local', claim.loopId, 'ready', 'key', 'start')).toHaveLength(1);
  expect(await store.events.find('local', claim.loopId, 'ready', 'key', 'other')).toEqual([]);
  expect(await store.events.get('absent')).toBeUndefined();
  await store.events.create(intent, claim.id);
  await store.events.create(intent, claim.id);
  expect(await new SqliteInboundEvents(h.db).get(claim.inbound.id)).toMatchObject({
    admissionId: claim.id,
    target: { versionId: claim.versionId },
    delivery: { state: 'admitted' },
    runIds: [intent.run.id],
  });
  expect(await store.events.hasPendingPin(claim.loopId)).toBe(false);
  expect((await h.client.execute('SELECT * FROM run_events')).rows).toHaveLength(1);
});
it('does not hash-suppress unkeyed inputs and reserves authored node keys before run admission', async () => {
  for (const seed of ['one', 'two']) {
    const f = fixture(seed);
    expect((await store.events.claim(f.claim, f.intent)).receipt.status).toBe('pending');
  }
  const first = fixture('node-one', 'request-one', 'business');
  await store.events.claim(first.claim, first.intent);
  const second = fixture('node-two', 'request-two', 'business');
  expect((await store.events.claim(second.claim, second.intent)).receipt.status).toBe(
    'deduplicated',
  );
  expect((await store.events.get(second.claim.id))?.intent).toBeUndefined();
  await expect(store.events.create(second.intent, second.claim.id)).rejects.toBeInstanceOf(
    AdmissionConflictError,
  );
  const committed = fixture('committed', undefined, 'old-run');
  await store.create(committed.intent);
  const duplicate = fixture('committed-repeat', undefined, 'old-run');
  expect((await store.events.claim(duplicate.claim, duplicate.intent)).receipt.status).toBe(
    'deduplicated',
  );
});
it('isolates request keys by owner, loop, node and type and preserves literal whitespace', async () => {
  for (const [i, owner, loop, node, type, key] of [
    [0, 'local', 'loop', 'start', 'ready', ' '],
    [1, 'other', 'loop', 'start', 'ready', ' '],
    [2, 'local', 'other-loop', 'start', 'ready', ' '],
    [3, 'local', 'loop', 'second', 'ready', ' '],
    [4, 'local', 'loop', 'start', 'other', ' '],
    [5, 'local', 'loop', 'start', 'ready', '  '],
  ] as const) {
    const f = fixture(String(i), key);
    f.claim.ownerId = owner;
    f.claim.inbound.ownerId = owner;
    f.intent.run.ownerId = owner;
    f.claim.loopId = fakeUlid(loop);
    f.intent.run.loopId = f.claim.loopId;
    f.intent.initialThread.run.loopId = f.claim.loopId;
    f.intent.pinnedLoopIds = [f.claim.loopId];
    f.claim.triggerNodeId = node;
    f.intent.initialThread.invocation.trigger.nodeId = node;
    f.claim.inbound.type = type;
    f.intent.initialThread.invocation.trigger.eventType = type;
    expect((await store.events.claim(f.claim, f.intent)).receipt.status).toBe('pending');
  }
  expect((await h.client.execute('SELECT * FROM event_receipts')).rows).toHaveLength(6);
});
it('bounds due work, records safe retry and terminal failures, and never reopens a failed request key', async () => {
  for (let i = 0; i < 7; i++) {
    const f = fixture(String(i));
    await store.events.claim(f.claim, f.intent);
  }
  expect(await store.events.due(FIXTURE_TS, 100)).toHaveLength(5);
  expect(await store.events.due(FIXTURE_TS, -1)).toEqual([]);
  const f = fixture('failed', 'key');
  await store.events.claim(f.claim, f.intent);
  await store.events.failed(f.claim.id, 'EVENT_ADMISSION_RETRY', '2099-01-01T00:00:00.000Z');
  expect(await store.events.get(f.claim.id)).toMatchObject({
    attempts: 1,
    status: 'pending',
    nextAttemptAt: '2099-01-01T00:00:00.000Z',
  });
  await store.events.failed(f.claim.id, 'EVENT_ADMISSION_EXHAUSTED');
  await store.events.failed(f.claim.id, 'EVENT_ADMISSION_RETRY');
  expect(await store.events.get(f.claim.id)).toMatchObject({
    attempts: 2,
    status: 'failed',
    failureCode: 'EVENT_ADMISSION_EXHAUSTED',
  });
});
it('rolls back partial run admission, rejects inconsistent identities and leaves corrupt history untouched', async () => {
  const f = fixture('atomic', 'key');
  await store.events.claim(f.claim, f.intent);
  await h.client.execute(
    "CREATE TRIGGER no_queue BEFORE INSERT ON run_events BEGIN SELECT RAISE(ABORT,'fault'); END",
  );
  await expect(store.events.create(f.intent, f.claim.id)).rejects.toThrow();
  expect((await h.client.execute('SELECT * FROM runs')).rows).toEqual([]);
  await h.client.execute('DROP TRIGGER no_queue');
  await h.client.execute("UPDATE event_receipts SET request_key='tampered'");
  await expect(store.events.create(f.intent, f.claim.id)).rejects.toBeInstanceOf(
    AdmissionConflictError,
  );
  await h.client.execute("UPDATE event_receipts SET intent='{'");
  await expect(store.events.get(f.claim.id)).rejects.toBeInstanceOf(AdmissionConflictError);
  expect(await store.events.find('local', f.claim.loopId, 'ready', 'tampered')).toHaveLength(1);
  await h.client.execute("UPDATE inbound_events SET payload='invalid'");
  await expect(store.events.get(f.claim.id)).rejects.toBeInstanceOf(AdmissionConflictError);
  await h.client.execute("UPDATE inbound_events SET payload='1e999'");
  await expect(store.events.get(f.claim.id)).rejects.toBeInstanceOf(AdmissionConflictError);
  await h.client.execute('DELETE FROM inbound_events');
  await expect(store.events.get(f.claim.id)).rejects.toBeInstanceOf(AdmissionConflictError);
});
it('refuses an event claim whose accepted target differs from the frozen run', async () => {
  const f = fixture('wrong');
  f.claim.versionId = fakeUlid('wrong');
  await expect(store.events.claim(f.claim, f.intent)).rejects.toBeInstanceOf(
    AdmissionConflictError,
  );
  expect((await h.client.execute('SELECT * FROM inbound_events')).rows).toEqual([]);
});

it('preserves webhook and poll key protection while a targeted Event is pending', async () => {
  const f = fixture('event', 'reserved');
  await store.events.claim(f.claim, f.intent);
  const webhook = fixture('webhook', 'reserved');
  webhook.intent.initialThread.invocation.source = 'webhook';
  webhook.intent.initialThread.invocation.trigger.kind = 'webhook';
  webhook.claim.inbound.type = 'webhook';
  webhook.claim.inbound.source = 'webhook:ep';
  const { versionId: _, nodeDedupeKey: __, ...base } = webhook.claim;
  const { inbound, ...scope } = base;
  const accepted = await store.claim(
    { ...scope, contentHash: 'a'.repeat(64), inbound },
    webhook.intent,
  );
  expect(accepted.receipt.status).toBe('deduplicated');
  const poll = fixture('poll', 'reserved');
  poll.intent.initialThread.invocation.source = 'poll';
  poll.intent.initialThread.invocation.trigger.kind = 'poll';
  expect(await store.createPollItem(poll.intent)).toBeUndefined();
});
it('preserves an existing webhook reservation for an authored Event node key', async () => {
  const f = fixture('hook', 'business');
  f.intent.initialThread.invocation.source = 'webhook';
  f.intent.initialThread.invocation.trigger.kind = 'webhook';
  f.claim.inbound.type = 'webhook';
  f.claim.inbound.source = 'webhook:ep';
  const { versionId: _, nodeDedupeKey: __, ...base } = f.claim;
  const { inbound, ...scope } = base;
  await store.claim({ ...scope, contentHash: 'b'.repeat(64), inbound }, f.intent);
  const event = fixture('event', 'new-request', 'business');
  expect((await store.events.claim(event.claim, event.intent)).receipt.status).toBe('deduplicated');
});
