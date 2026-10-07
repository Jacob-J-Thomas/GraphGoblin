import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunRecord } from '@graphgoblin/contracts';
import {
  FIXTURE_TS,
  fakeUlid,
  minimalLoop,
  sampleInvocation,
  sampleThread,
} from '@graphgoblin/contracts/testing';
import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import { FakeClock, FakeIds } from '@graphgoblin/engine/testing';
import { openMemoryDatabase, type DatabaseHandle } from './db.js';
import { SqliteLoopRepository } from './loops.js';
import { SqliteRunRepository } from './runs.js';
import {
  SqliteInboundEvents,
  SqliteScheduleStore,
  SqliteWebhookEndpoints,
  type InboundEventRecord,
  type ScheduleDraft,
  type WebhookEndpointDraft,
} from './triggers.js';

let handle: DatabaseHandle;
let clock: FakeClock;
let ids: FakeIds;

beforeEach(async () => {
  handle = await openMemoryDatabase();
  clock = new FakeClock();
  ids = new FakeIds();
});

afterEach(() => {
  handle.close();
});

const cron = (triggerNodeId: string, nextFireAt?: string): ScheduleDraft => ({
  ownerId: 'local',
  triggerNodeId,
  expression: '* * * * *',
  timezone: 'UTC',
  missedFirePolicy: 'skip',
  enabled: true,
  nextFireAt,
});

const hook = (triggerNodeId: string): WebhookEndpointDraft => ({
  ownerId: 'local',
  triggerNodeId,
  secretRef: 'hook-secret',
  signatureHeader: 'x-graphgoblin-signature',
  signatureScheme: 'hmac-sha256',
  replayWindowSeconds: 300,
});

describe('SqliteScheduleStore', () => {
  it('replaces a loop version, keeping existing rows of the same version', async () => {
    const store = new SqliteScheduleStore(handle.db, clock, ids);
    const first = await store.replaceForVersion('loop', 'v1', [
      cron('a', '2026-10-02T12:01:00.000Z'),
      cron('b'),
    ]);
    expect(first.map((s) => [s.versionId, s.triggerNodeId, s.enabled])).toEqual([
      ['v1', 'a', true],
      ['v1', 'b', true],
    ]);
    expect(first[0]?.nextFireAt).toBe('2026-10-02T12:01:00.000Z');
    expect(first[1]?.nextFireAt).toBeUndefined();

    // Re-arming the same version keeps rows (and their next fire times).
    await store.markFired(first[0]!.id, {
      lastFiredAt: '2026-10-02T12:01:00.000Z',
      nextFireAt: '2026-10-02T12:02:00.000Z',
    });
    const again = await store.replaceForVersion('loop', 'v1', [cron('a', 'ignored'), cron('b')]);
    expect(again).toHaveLength(2);
    expect(again.find((s) => s.triggerNodeId === 'a')).toMatchObject({
      lastFiredAt: '2026-10-02T12:01:00.000Z',
      nextFireAt: '2026-10-02T12:02:00.000Z',
    });

    clock.advance(1000);
    const next = await store.replaceForVersion('loop', 'v2', [
      cron('a', '2026-10-02T12:05:00.000Z'),
    ]);
    expect(next.map((s) => [s.versionId, s.triggerNodeId, s.enabled])).toEqual([
      ['v2', 'a', true],
      ['v1', 'a', false],
      ['v1', 'b', false],
    ]);
    expect((await store.listEnabled()).map((s) => s.versionId)).toEqual(['v2']);
    expect(await store.listDue(new Date('2026-10-02T12:04:00.000Z'))).toEqual([]);
    expect(await store.listDue(new Date('2026-10-02T12:05:00.000Z'))).toHaveLength(1);

    await store.markFired(next[0]!.id, { nextFireAt: undefined });
    expect((await store.listEnabled())[0]?.nextFireAt).toBeUndefined();

    await store.disableLoop('loop');
    expect(await store.listEnabled()).toEqual([]);
  });
});

describe('SqliteWebhookEndpoints', () => {
  it('keeps a trigger node token across versions and prefers the enabled row', async () => {
    const endpoints = new SqliteWebhookEndpoints(handle.db, clock, ids);
    let minted = 0;
    const newToken = () => `token-${(minted += 1)}`;
    const v1 = await endpoints.replaceForVersion('loop', 'v1', [hook('a'), hook('b')], newToken);
    expect(v1.map((e) => [e.triggerNodeId, e.token, e.enabled])).toEqual([
      ['a', 'token-1', true],
      ['b', 'token-2', true],
    ]);
    const same = await endpoints.replaceForVersion('loop', 'v1', [hook('a'), hook('b')], newToken);
    expect(same).toHaveLength(2);
    expect(minted).toBe(2);

    clock.advance(1000);
    const v2 = await endpoints.replaceForVersion('loop', 'v2', [hook('a'), hook('c')], newToken);
    expect(v2.filter((e) => e.enabled).map((e) => [e.triggerNodeId, e.token])).toEqual([
      ['a', 'token-1'],
      ['c', 'token-3'],
    ]);
    expect(await endpoints.findByToken('token-1')).toMatchObject({
      versionId: 'v2',
      enabled: true,
    });
    expect(await endpoints.findByToken('token-2')).toMatchObject({
      versionId: 'v1',
      enabled: false,
    });
    expect(await endpoints.findByToken('nope')).toBeUndefined();

    await endpoints.disableLoop('loop');
    expect((await endpoints.listForLoop('loop')).some((e) => e.enabled)).toBe(false);
  });
});

describe('SqliteInboundEvents', () => {
  const event = (id: string, overrides: Partial<InboundEventRecord> = {}): InboundEventRecord => ({
    id,
    ownerId: 'local',
    type: 'issue.ready',
    payload: { n: id },
    source: 'api',
    receivedAt: '2026-10-02T12:00:00.000Z',
    runIds: [],
    ...overrides,
  });

  it('inserts, lists newest first, pages, and records started runs', async () => {
    const events = new SqliteInboundEvents(handle.db);
    await events.insert(event('e1', { receivedAt: '2026-10-02T12:00:00.000Z' }));
    await events.insert(
      event('e2', { receivedAt: '2026-10-02T12:01:00.000Z', type: 'other', dedupeKey: 'k' }),
    );
    await events.insert(event('e3', { receivedAt: '2026-10-02T12:02:00.000Z', ownerId: 'else' }));
    expect((await events.list('local')).map((e) => e.id)).toEqual(['e2', 'e1']);
    expect((await events.list('local', { limit: 1 })).map((e) => e.id)).toEqual(['e2']);
    expect((await events.list('local', { type: 'issue.ready' })).map((e) => e.id)).toEqual(['e1']);
    expect(
      (await events.list('local', { before: '2026-10-02T12:01:00.000Z' })).map((e) => e.id),
    ).toEqual(['e1']);
    await events.setRunIds('e1', ['r1', 'r2']);
    expect(await events.get('e1')).toMatchObject({ runIds: ['r1', 'r2'] });
    expect((await events.get('e2'))?.dedupeKey).toBe('k');
    expect((await events.get('e1'))?.dedupeKey).toBeUndefined();
    expect(await events.get('missing')).toBeUndefined();
  });

  it('finds duplicates by type, source, and window, and inserts atomically', async () => {
    const events = new SqliteInboundEvents(handle.db);
    const first = await events.insertUnlessDuplicate(
      event('e1', { dedupeKey: 'k', source: 'webhook:ep1' }),
      { ownerId: 'local', type: 'issue.ready', dedupeKey: 'k' },
    );
    expect(first.duplicate).toBeUndefined();
    const second = await events.insertUnlessDuplicate(event('e2', { dedupeKey: 'k' }), {
      ownerId: 'local',
      type: 'issue.ready',
      dedupeKey: 'k',
    });
    expect(second.duplicate?.id).toBe('e1');
    expect(await events.get('e2')).toBeUndefined();
    await events.insertUnlessDuplicate(event('e3'), undefined);
    expect(await events.get('e3')).toBeDefined();

    expect(
      await events.findDuplicate({ ownerId: 'local', dedupeKey: 'k', source: 'webhook:ep1' }),
    ).toMatchObject({ id: 'e1' });
    expect(
      await events.findDuplicate({ ownerId: 'local', dedupeKey: 'k', source: 'webhook:ep2' }),
    ).toBeUndefined();
    expect(
      await events.findDuplicate({
        ownerId: 'local',
        dedupeKey: 'k',
        since: '2026-10-02T12:00:01.000Z',
      }),
    ).toBeUndefined();
    expect(
      await events.findDuplicate({ ownerId: 'local', dedupeKey: 'k', type: 'other' }),
    ).toBeUndefined();
  });
});

describe('trigger lookups on runs and loops', () => {
  it('finds runs by trigger dedupe key and lists published loops across owners', async () => {
    const runs = new SqliteRunRepository(handle.db);
    const loops = new SqliteLoopRepository(handle.db, clock, ids);
    const definition = LoopDefinitionSchema.parse(minimalLoop());
    const a = await loops.create('local', definition);
    await loops.create('other', definition);
    await loops.publish(a.loop.id);
    expect((await loops.listPublished()).map((l) => l.id)).toEqual([a.loop.id]);

    const run: RunRecord = {
      id: fakeUlid('run:dedupe'),
      ownerId: 'local',
      loopId: a.loop.id,
      versionId: a.draft.id,
      invocationId: fakeUlid('inv:dedupe'),
      status: 'queued',
      iteration: 1,
      createdAt: FIXTURE_TS,
      lastEventSeq: 0,
    };
    const invocation = sampleInvocation({
      trigger: {
        nodeId: 'hook',
        kind: 'webhook',
        payload: null,
        receivedAt: FIXTURE_TS,
        dedupeKey: 'delivery-1',
      },
    });
    await runs.create(run, sampleThread({ invocation }));
    expect(await runs.hasTriggerDedupe(a.loop.id, 'hook', 'delivery-1')).toBe(true);
    expect(await runs.hasTriggerDedupe(a.loop.id, 'hook', 'delivery-2')).toBe(false);
    expect(await runs.hasTriggerDedupe(a.loop.id, 'other', 'delivery-1')).toBe(false);
    const select = vi.spyOn(handle.db, 'select');
    expect(
      await runs.findTriggerDedupeKeys(
        a.loop.id,
        'hook',
        Array.from({ length: 200 }, (_, index) => `delivery-${index}`),
      ),
    ).toEqual(new Set(['delivery-1']));
    expect(select).toHaveBeenCalledOnce();
    select.mockClear();
    expect(await runs.findTriggerDedupeKeys(a.loop.id, 'hook', [])).toEqual(new Set());
    expect(select).not.toHaveBeenCalled();
    expect(await runs.findTriggerDedupeKeys(a.loop.id, 'other', ['delivery-1'])).toEqual(new Set());
    expect(
      await runs.findTriggerDedupeKeys(fakeUlid('unrelated-loop'), 'hook', ['delivery-1']),
    ).toEqual(new Set());
    select.mockRestore();
  });
});
