import { readMigrationFiles } from 'drizzle-orm/migrator';
import { SHIPPED_MIGRATIONS, FORMAT_BASELINES } from './readiness.js';
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
import { openDatabase, openMemoryDatabase, type DatabaseHandle } from './db.js';
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

describe('0013 trigger configuration', () => {
  const insert = `INSERT INTO webhook_endpoints (id,owner_id,loop_id,version_id,trigger_node_id,token,auth_type,signature_message,signature_header,secret_ref,window_seconds,enabled,created_at) VALUES (?,'local','loop','version','hook','token',?,?,?,?,?,1,'2026-10-02T12:00:00.000Z')`;
  it.each([
    ['none', null, null, null, null],
    ['hmac-sha256', 'body', 'x-signature', 'key', null],
    ['hmac-sha256', 'timestamp-body', 'x-signature', 'key', 1],
    ['hmac-sha256', 'timestamp-body', 'x-signature', 'key', 86400],
  ])('accepts exactly the %s recipe fields (%s, %s, %s, %s)', async (...recipe) => {
    await expect(
      handle.client.execute({ sql: insert, args: ['valid', ...recipe] }),
    ).resolves.toBeDefined();
    const store = new SqliteWebhookEndpoints(handle.db, clock, ids);
    if (recipe[0] === 'none')
      await expect(store.findByToken('token')).rejects.toThrow(
        'Unsupported webhook signing configuration',
      );
    else
      expect(await store.findByToken('token')).toMatchObject({
        secretRef: 'key',
        signatureHeader: 'x-signature',
        signatureScheme: recipe[1] === 'body' ? 'hmac-sha256-body' : 'hmac-sha256',
        replayWindowSeconds: recipe[4],
      });
  });
  it.each([
    ['none', 'body', null, null, null],
    ['none', null, 'x-signature', null, null],
    ['none', null, null, 'key', null],
    ['none', null, null, null, 300],
    ['hmac-sha256', null, 'x-signature', 'key', null],
    ['hmac-sha256', 'body', null, 'key', null],
    ['hmac-sha256', 'body', 'x-signature', null, null],
    ['hmac-sha256', 'body', 'x-signature', 'key', 300],
    ['hmac-sha256', 'timestamp-body', null, 'key', 300],
    ['hmac-sha256', 'timestamp-body', 'x-signature', null, 300],
    ['hmac-sha256', 'timestamp-body', 'x-signature', 'key', null],
    ['hmac-sha256', 'timestamp-body', 'x-signature', 'key', 0],
    ['hmac-sha256', 'timestamp-body', 'x-signature', 'key', 86401],
    ['hmac-sha256', 'timestamp-body', 'x-signature', 'key', 1.5],
    ['custom', 'body', 'x-signature', 'key', null],
    ['hmac-sha256', 'custom', 'x-signature', 'key', null],
  ])('rejects inconsistent recipe %j / %j / %j / %j / %j', async (...recipe) => {
    await expect(
      handle.client.execute({ sql: insert, args: ['invalid', ...recipe] }),
    ).rejects.toThrow('CHECK constraint failed');
    expect((await handle.client.execute('SELECT * FROM webhook_endpoints')).rows).toEqual([]);
  });
  it('maps both old signing rows without changing identities, tokens or timestamps and removes content uniqueness', async () => {
    const past = openDatabase({ url: ':memory:' });
    try {
      const migrations = readMigrationFiles({ migrationsFolder: SHIPPED_MIGRATIONS });
      for (const migration of migrations.slice(0, 13))
        for (const statement of migration.sql) await past.client.execute(statement);
      for (const scheme of ['hmac-sha256', 'hmac-sha256-body'])
        await past.client.execute({
          sql: `INSERT INTO webhook_endpoints VALUES (?,'local','loop','version','hook',?,'key','x-signature',?,?,1,'2026-10-02T12:00:00.000Z')`,
          args: [scheme, scheme, scheme, scheme === 'hmac-sha256' ? 300 : null],
        });
      for (const statement of migrations[13]!.sql) await past.client.execute(statement);
      const migrated = (await past.client.execute('SELECT * FROM webhook_endpoints ORDER BY id'))
        .rows;
      expect(migrated).toEqual(
        ['hmac-sha256', 'hmac-sha256-body'].map((id) => ({
          id,
          owner_id: 'local',
          loop_id: 'loop',
          version_id: 'version',
          trigger_node_id: 'hook',
          token: id,
          auth_type: 'hmac-sha256',
          signature_message: id === 'hmac-sha256' ? 'timestamp-body' : 'body',
          signature_header: 'x-signature',
          secret_ref: 'key',
          window_seconds: id === 'hmac-sha256' ? 300 : null,
          enabled: 1,
          created_at: '2026-10-02T12:00:00.000Z',
        })),
      );
      expect(
        (await past.client.execute("PRAGMA index_list('webhook_endpoints')")).rows.map(
          (row) => row.name,
        ),
      ).toEqual(
        expect.arrayContaining(['webhook_endpoints_token_idx', 'webhook_endpoints_loop_idx']),
      );
      for (const id of ['first', 'second'])
        await past.client.execute({
          sql: `INSERT INTO webhook_receipts (id,owner_id,loop_id,trigger_node_id,content_hash,inbound_id,status) VALUES (?,'local','loop','hook',?,?,'filtered')`,
          args: [id, 'a'.repeat(64), id],
        });
      expect((await past.client.execute('SELECT * FROM webhook_receipts')).rows).toHaveLength(2);
      expect(FORMAT_BASELINES[4]).toBe('0013_trigger_configuration');
    } finally {
      past.close();
    }
  });
});
