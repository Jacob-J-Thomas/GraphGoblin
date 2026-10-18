import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeUlid, FIXTURE_IDS, FIXTURE_TS } from '@graphgoblin/contracts/testing';
import {
  AdmissionConflictError,
  createInitialThread,
  type RunAdmission,
  type WebhookClaim,
} from '@graphgoblin/engine';
import { FakeClock } from '@graphgoblin/engine/testing';
import { SqliteTriggerAdmission } from './admission.js';
import { openMemoryDatabase, type DatabaseHandle } from './db.js';
import { SqliteEventStore } from './events.js';
import { SqliteRunRepository } from './runs.js';
import { SqliteInboundEvents } from './triggers.js';
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openDatabase } from './db.js';
let handle: DatabaseHandle;
let events: SqliteEventStore;
let admission: SqliteTriggerAdmission;
beforeEach(async () => {
  handle = await openMemoryDatabase();
  events = new SqliteEventStore(handle.db, new FakeClock());
  admission = new SqliteTriggerAdmission(handle.db, events);
});
afterEach(() => handle.close());
function intent(): RunAdmission {
  const run = {
    id: FIXTURE_IDS.run,
    ownerId: 'local',
    loopId: FIXTURE_IDS.loop,
    versionId: FIXTURE_IDS.version,
    invocationId: FIXTURE_IDS.invocation,
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
      source: 'webhook',
      trigger: { nodeId: 'start', kind: 'webhook', payload: null, receivedAt: FIXTURE_TS },
    },
  });
  return {
    run,
    initialThread,
    queued: {
      type: 'run.queued',
      initialThread,
      subloopVersions: { [fakeUlid('child')]: fakeUlid('child-version') },
    },
    pinnedLoopIds: [run.loopId, fakeUlid('child')],
  };
}
function scopedIntent(input: WebhookClaim): RunAdmission {
  const frozen = intent();
  frozen.run.ownerId = input.ownerId;
  frozen.run.loopId = input.loopId;
  frozen.initialThread.run.loopId = input.loopId;
  frozen.initialThread.invocation.trigger.nodeId = input.triggerNodeId;
  frozen.initialThread.invocation.trigger.dedupeKey = input.inbound.dedupeKey;
  frozen.pinnedLoopIds = [input.loopId];
  return frozen;
}
function claim(contentHash = 'a'.repeat(64)): WebhookClaim {
  return {
    id: fakeUlid('receipt:' + contentHash),
    ownerId: 'local',
    loopId: FIXTURE_IDS.loop,
    triggerNodeId: 'start',
    contentHash,
    inbound: {
      id: fakeUlid('inbound:' + contentHash),
      ownerId: 'local',
      type: 'webhook',
      payload: null,
      source: 'webhook:ep',
      receivedAt: FIXTURE_TS,
      runIds: [],
    },
  };
}
describe('SQLite atomic admission', () => {
  it('recovers the frozen run ID after closing the database immediately after claim', async () => {
    const file = join(tmpdir(), `gg-admission-${randomUUID()}.db`);
    const url = pathToFileURL(file).href;
    let persisted = openDatabase({ url });
    try {
      await persisted.migrate();
      const frozen = intent();
      const input = claim();
      frozen.initialThread.invocation.trigger.dedupeKey = 'durable-key';
      input.inbound.dedupeKey = 'durable-key';
      await new SqliteTriggerAdmission(
        persisted.db,
        new SqliteEventStore(persisted.db, new FakeClock()),
      ).claim(input, frozen);
      persisted.close();
      persisted = openDatabase({ url });
      await persisted.migrate();
      const restoredEvents = new SqliteEventStore(persisted.db, new FakeClock());
      const restored = new SqliteTriggerAdmission(persisted.db, restoredEvents);
      expect(await restored.due(FIXTURE_TS, 5)).toEqual([{ id: input.id, attempts: 0 }]);
      const saved = (await restored.get(input.id))!;
      expect(saved.intent).toEqual(frozen);
      const repeat = claim('b'.repeat(64));
      repeat.inbound.dedupeKey = 'durable-key';
      repeat.inbound.receivedAt = '2099-01-01T00:00:00.000Z';
      expect((await restored.claim(repeat, frozen)).receipt.status).toBe('deduplicated');
      expect((await restored.create(saved.intent!, saved.id)).id).toBe(frozen.run.id);
      expect((await restored.create(saved.intent!, saved.id)).id).toBe(frozen.run.id);
      expect(await restoredEvents.read(frozen.run.id)).toHaveLength(1);
      expect((await new SqliteInboundEvents(persisted.db).get(input.inbound.id))?.runIds).toEqual([
        frozen.run.id,
      ]);
    } finally {
      persisted.close();
      for (const suffix of ['', '-wal', '-shm']) await unlink(file + suffix).catch(() => undefined);
    }
  });
  it('refuses re-admission without a receipt when the stored first event is malformed', async () => {
    const input = intent();
    input.initialThread.invocation.source = 'manual.api';
    input.initialThread.invocation.trigger.kind = 'manual';
    const admitted = await admission.create(input);
    await handle.client.execute({
      sql: "UPDATE run_events SET type='node.finished', payload='{}' WHERE run_id=?",
      args: [admitted.id],
    });
    const storedEvents = (await handle.client.execute('SELECT * FROM run_events')).rows;
    expect(storedEvents).toHaveLength(1);
    expect(storedEvents[0]).toMatchObject({ type: 'node.finished', payload: '{}' });
    const notifications: number[] = [];
    events.subscribe(admitted.id, (event) => notifications.push(event.seq));

    await expect(admission.create(input)).rejects.toThrow(AdmissionConflictError);

    const repo = new SqliteRunRepository(handle.db);
    expect(await repo.get(admitted.id)).toEqual(admitted);
    expect(await repo.getInitialThread(admitted.id)).toEqual(input.initialThread);
    expect((await handle.client.execute('SELECT * FROM runs')).rows).toHaveLength(1);
    expect((await handle.client.execute('SELECT * FROM run_events')).rows).toEqual(storedEvents);
    expect((await handle.client.execute('SELECT * FROM webhook_receipts')).rows).toEqual([]);
    expect(notifications).toEqual([]);
  });

  it('refuses re-admission without a receipt when the invocation changes', async () => {
    const input = intent();
    input.initialThread.invocation.source = 'manual.api';
    input.initialThread.invocation.trigger.kind = 'manual';
    const admitted = await admission.create(input);
    const storedThread = structuredClone(input.initialThread);
    const storedEvents = await events.read(admitted.id);
    const notifications: number[] = [];
    events.subscribe(admitted.id, (event) => notifications.push(event.seq));
    input.initialThread.invocation.trigger.payload = { changed: true };

    await expect(admission.create(input)).rejects.toThrow(AdmissionConflictError);

    const repo = new SqliteRunRepository(handle.db);
    expect(await repo.get(admitted.id)).toEqual(admitted);
    expect(await repo.getInitialThread(admitted.id)).toEqual(storedThread);
    expect((await handle.client.execute('SELECT * FROM runs')).rows).toHaveLength(1);
    expect(await events.read(admitted.id)).toEqual(storedEvents);
    expect((await handle.client.execute('SELECT * FROM webhook_receipts')).rows).toEqual([]);
    expect(notifications).toEqual([]);
  });

  it('rolls back run and queued event together, keeps pending pins, then commits and notifies once', async () => {
    const frozen = intent(),
      input = claim();
    const receipt = await admission.claim(input, frozen);
    await handle.client.execute(
      "CREATE TRIGGER fail_queue BEFORE INSERT ON run_events BEGIN SELECT RAISE(ABORT,'injected'); END",
    );
    await expect(admission.create(frozen, receipt.receipt.id)).rejects.toThrow(
      'insert into "run_events"',
    );
    expect(await new SqliteRunRepository(handle.db).get(frozen.run.id)).toBeUndefined();
    expect(await events.read(frozen.run.id)).toEqual([]);
    expect(await admission.hasPendingPin(fakeUlid('child'))).toBe(true);
    expect((await new SqliteInboundEvents(handle.db).get(input.inbound.id))?.runIds).toEqual([]);
    await handle.client.execute('DROP TRIGGER fail_queue');
    const notifications: number[] = [];
    const off = events.subscribe(frozen.run.id, (e) => {
      notifications.push(e.seq);
      throw new Error('subscriber-failed');
    });
    const run = await admission.create(frozen, receipt.receipt.id);
    expect(run.lastEventSeq).toBe(1);
    expect(notifications).toEqual([1]);
    await new SqliteRunRepository(handle.db).update(run.id, { status: 'running' });
    expect((await admission.create(frozen, receipt.receipt.id)).status).toBe('running');
    expect(notifications).toEqual([1]);
    off();
    expect(await new SqliteInboundEvents(handle.db).get(input.inbound.id)).toMatchObject({
      runIds: [run.id],
      delivery: { state: 'admitted', attempts: 0 },
    });
    expect(await admission.hasPendingPin(fakeUlid('child'))).toBe(false);
    expect(await events.read(run.id)).toHaveLength(1);
  });
  it('allows identical unkeyed content across version and inbound identities', async () => {
    const input = claim();
    expect((await admission.claim(input, intent())).receipt.status).toBe('pending');
    expect(
      (
        await admission.claim(
          {
            ...input,
            id: fakeUlid('second'),
            inbound: { ...input.inbound, id: fakeUlid('second-event') },
          },
          intent(),
        )
      ).receipt.status,
    ).toBe('pending');
    expect(
      (
        await admission.claim(
          {
            ...input,
            id: fakeUlid('other-owner'),
            ownerId: 'other',
            inbound: { ...input.inbound, id: fakeUlid('other-event'), ownerId: 'other' },
          },
          scopedIntent({ ...input, ownerId: 'other' }),
        )
      ).receipt.status,
    ).toBe('pending');
    expect((await handle.client.execute('SELECT * FROM inbound_events')).rows).toHaveLength(3);
  });
  it('refuses changed immutable identity and malformed/missing receipt links without writing a run', async () => {
    const frozen = intent(),
      receipt = await admission.claim(claim(), frozen);
    await expect(
      admission.create(
        { ...frozen, initialThread: { ...frozen.initialThread, vars: { changed: true } } },
        receipt.receipt.id,
      ),
    ).rejects.toMatchObject({ code: 'WEBHOOK_INTENT_CONFLICT' });
    await expect(admission.create(frozen, 'missing')).rejects.toMatchObject({
      code: 'WEBHOOK_INTENT_CONFLICT',
    });
    await handle.client.execute('DELETE FROM inbound_events');
    await expect(admission.create(frozen, receipt.receipt.id)).rejects.toMatchObject({
      code: 'WEBHOOK_INTENT_CONFLICT',
    });
    expect((await handle.client.execute('SELECT * FROM runs')).rows).toHaveLength(0);
  });
  it.each(['filtered', 'pending', 'failed', 'admitted', 'deduplicated'] as const)(
    'consumes authored keys from prior %s receipts without retaining a new intent',
    async (state) => {
      const first = claim();
      first.inbound.dedupeKey = 'same';
      const frozen = intent();
      frozen.initialThread.invocation.trigger.dedupeKey = 'same';
      const receipt = await admission.claim(first, frozen);
      if (state === 'filtered')
        await handle.client.execute({
          sql: "UPDATE webhook_receipts SET status='filtered', intent=NULL, next_attempt_at=NULL WHERE id=?",
          args: [first.id],
        });
      if (state === 'failed') await admission.failed(first.id, 'WEBHOOK_INTENT_CONFLICT');
      if (state === 'admitted') await admission.create(frozen, first.id);
      const second = claim('b'.repeat(64));
      second.inbound.dedupeKey = 'same';
      const result = await admission.claim(second, frozen);
      expect(result).toMatchObject({
        receipt: { status: 'deduplicated', attempts: 0 },
      });
      expect(result.receipt.intent).toBeUndefined();
      expect(result.receipt.nextAttemptAt).toBeUndefined();
      expect((await new SqliteInboundEvents(handle.db).get(second.inbound.id))?.runIds).toEqual([]);
      await expect(admission.claim(second, frozen)).rejects.toThrow();
      if (state === 'deduplicated') {
        await handle.client.execute({
          sql: 'DELETE FROM webhook_receipts WHERE id=?',
          args: [receipt.receipt.id],
        });
        const third = claim('c'.repeat(64));
        third.inbound.dedupeKey = 'same';
        expect((await admission.claim(third, frozen)).receipt.status).toBe('deduplicated');
      }
      expect((await handle.client.execute('SELECT * FROM runs')).rows).toHaveLength(
        state === 'admitted' ? 1 : 0,
      );
    },
  );
  it('uses every authored key and isolates owner/loop/node', async () => {
    const frozen = intent();
    frozen.initialThread.invocation.trigger.dedupeKey = 'historical';
    await admission.create(frozen); // Timestamp webhook runs predate the receipt table.
    const input = claim();
    input.inbound.dedupeKey = 'historical';
    expect((await admission.claim(input, scopedIntent(input))).receipt.status).toBe('deduplicated');
    for (const scope of ['owner', 'loop', 'node'] as const) {
      const other = claim((scope === 'owner' ? 'b' : scope === 'loop' ? 'c' : 'd').repeat(64));
      other.inbound.dedupeKey = 'historical';
      if (scope === 'owner') {
        other.ownerId = 'other';
        other.inbound.ownerId = 'other';
      }
      if (scope === 'loop') other.loopId = fakeUlid('other-loop');
      if (scope === 'node') other.triggerNodeId = 'other-node';
      expect((await admission.claim(other, scopedIntent(other))).receipt.status).toBe('pending');
    }
    const hint = claim('e'.repeat(64));
    hint.inbound.dedupeKey = 'historical';
    expect((await admission.claim(hint, scopedIntent(hint))).receipt.status).toBe('deduplicated');
    expect(await admission.hasPendingPin(FIXTURE_IDS.loop)).toBe(true);
  });
  it.each(['pending', 'failed'] as const)(
    'keeps %s intent keys consumed when the inbound link is unavailable',
    async (state) => {
      const frozen = intent();
      const first = claim();
      first.inbound.dedupeKey = 'reserved';
      frozen.initialThread.invocation.trigger.dedupeKey = 'reserved';
      await admission.claim(first, frozen);
      if (state === 'failed') await admission.failed(first.id, 'WEBHOOK_INTENT_CONFLICT');
      await handle.client.execute('DELETE FROM inbound_events');
      const repeat = claim('b'.repeat(64));
      repeat.inbound.dedupeKey = 'reserved';
      expect((await admission.claim(repeat, frozen)).receipt.status).toBe('deduplicated');
      expect((await handle.client.execute('SELECT * FROM runs')).rows).toEqual([]);
    },
  );
  it('reserves pending webhook keys against atomic poll admission and releases only after permanent failure', async () => {
    const body = intent(),
      first = claim();
    body.initialThread.invocation.trigger.dedupeKey = 'same';
    first.inbound.dedupeKey = 'same';
    await admission.claim(first, body);
    const poll = intent();
    poll.run.id = fakeUlid('poll');
    poll.initialThread.run.id = poll.run.id;
    poll.run.invocationId = fakeUlid('poll-invocation');
    poll.initialThread.invocation.id = poll.run.invocationId;
    poll.initialThread.invocation.source = 'poll';
    poll.initialThread.invocation.trigger.kind = 'poll';
    poll.initialThread.invocation.trigger.dedupeKey = 'same';
    const notifications: number[] = [];
    events.subscribe(poll.run.id, (event) => {
      notifications.push(event.seq);
    });
    expect(await admission.createPollItem(poll)).toBeUndefined();
    expect(notifications).toEqual([]);
    expect((await handle.client.execute('SELECT * FROM runs')).rows).toHaveLength(0);
    await admission.failed(first.id, 'WEBHOOK_ADMISSION_RETRY', '2099-01-01T00:00:00.000Z');
    expect(await admission.createPollItem(poll)).toBeUndefined();
    await admission.failed(first.id, 'WEBHOOK_INTENT_CONFLICT');
    expect((await admission.createPollItem(poll))?.id).toBe(poll.run.id);
    expect(notifications).toEqual([1]);
    expect(await admission.createPollItem(poll)).toBeUndefined();
    expect(notifications).toEqual([1]);
    await expect(admission.create(body, first.id)).rejects.toMatchObject({
      code: 'WEBHOOK_INTENT_CONFLICT',
    });
    expect((await handle.client.execute('SELECT * FROM runs')).rows).toHaveLength(1);
    expect(await admission.due('2099-01-01T00:00:00.000Z', 5)).toEqual([]);
    const next = claim('f'.repeat(64));
    next.inbound.dedupeKey = 'same';
    // Remove the old receipt to prove the committed poll key is itself enough for body dedupe.
    await handle.client.execute({
      sql: 'DELETE FROM webhook_receipts WHERE id=?',
      args: [first.id],
    });
    expect((await admission.claim(next, body)).receipt.status).toBe('deduplicated');
  });
  it('refuses non-poll and missing-key intents at the items-only admission boundary', async () => {
    await expect(admission.createPollItem(intent())).rejects.toMatchObject({
      code: 'WEBHOOK_INTENT_CONFLICT',
    });
    const poll = intent();
    poll.initialThread.invocation.source = 'poll';
    poll.initialThread.invocation.trigger.kind = 'poll';
    await expect(admission.createPollItem(poll)).rejects.toMatchObject({
      code: 'WEBHOOK_INTENT_CONFLICT',
    });
    expect((await handle.client.execute('SELECT * FROM runs')).rows).toHaveLength(0);
  });
  it('bounds due recovery and retains safe permanent failure metadata while releasing pins', async () => {
    for (let i = 0; i < 7; i++) await admission.claim(claim(String(i).repeat(64)), intent());
    expect(await admission.due(FIXTURE_TS, 100)).toHaveLength(5);
    expect(await admission.due('2020-01-01T00:00:00.000Z', 5)).toHaveLength(0);
    const input = claim('0'.repeat(64));
    await admission.failed(input.id, 'WEBHOOK_ADMISSION_RETRY', '2099-01-01T00:00:00.000Z');
    expect(await admission.due(FIXTURE_TS, 5)).toHaveLength(5);
    await admission.failed(input.id, 'WEBHOOK_INTENT_CONFLICT');
    await admission.failed(input.id, 'WEBHOOK_ADMISSION_RETRY', FIXTURE_TS);
    expect((await new SqliteInboundEvents(handle.db).get(input.inbound.id))?.delivery).toEqual({
      state: 'failed',
      attempts: 2,
      failureCode: 'WEBHOOK_INTENT_CONFLICT',
    });
  });
});
