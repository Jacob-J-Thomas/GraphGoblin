import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CapturingLogger, FakeClock, FakeIds } from '@graphgoblin/engine/testing';
import { openMemoryDatabase, type DatabaseHandle } from '../sqlite/db.js';
import { SqliteScheduleStore, type ScheduleDraft } from '../sqlite/triggers.js';
import { CronScheduler, RUN_EACH_CAP, type CronFire } from './cron-scheduler.js';
import type { ScheduleRecord, ScheduleStore } from './schedule-store.js';

let handle: DatabaseHandle;
let clock: FakeClock;
let store: SqliteScheduleStore;
let logger: CapturingLogger;

beforeEach(async () => {
  handle = await openMemoryDatabase();
  clock = new FakeClock(Date.parse('2026-03-01T00:00:00.000Z'));
  store = new SqliteScheduleStore(handle.db, clock, new FakeIds());
  logger = new CapturingLogger();
});

afterEach(() => {
  handle.close();
});

function draft(overrides: Partial<ScheduleDraft> = {}): ScheduleDraft {
  return {
    ownerId: 'local',
    triggerNodeId: 'cron',
    expression: '0 * * * *',
    timezone: 'UTC',
    missedFirePolicy: 'skip',
    enabled: true,
    nextFireAt: undefined,
    ...overrides,
  };
}

function collect(scheduler: CronScheduler): CronFire[] {
  const fires: CronFire[] = [];
  scheduler.onFire((fire) => {
    fires.push(fire);
  });
  return fires;
}

describe('CronScheduler.nextFire', () => {
  it('computes slots in the schedule timezone, across daylight saving time', () => {
    const winter = CronScheduler.nextFire(
      '0 9 * * *',
      'America/New_York',
      new Date('2026-01-15T00:00:00Z'),
    );
    const summer = CronScheduler.nextFire(
      '0 9 * * *',
      'America/New_York',
      new Date('2026-07-15T00:00:00Z'),
    );
    expect(winter?.toISOString()).toBe('2026-01-15T14:00:00.000Z');
    expect(summer?.toISOString()).toBe('2026-07-15T13:00:00.000Z');
    expect(
      CronScheduler.nextFire('0 9 * * *', 'UTC', new Date('2026-01-15T00:00:00Z'))?.toISOString(),
    ).toBe('2026-01-15T09:00:00.000Z');
    expect(
      CronScheduler.nextFire(
        '0 9 * * *',
        'Asia/Tokyo',
        new Date('2026-01-15T00:00:00Z'),
      )?.toISOString(),
    ).toBe('2026-01-16T00:00:00.000Z');
  });

  it('returns undefined when there is no future slot and validates input', () => {
    expect(CronScheduler.nextFire('0 0 1 1 *', 'UTC', new Date('2026-01-01T00:00:00Z'))).toEqual(
      new Date('2027-01-01T00:00:00Z'),
    );
    expect(
      CronScheduler.nextFire('0 0 0 1 1 * 2020', 'UTC', new Date('2026-01-01T00:00:00Z')),
    ).toBeUndefined();
    expect(CronScheduler.validate('*/5 * * * *', 'Europe/Stockholm')).toBeNull();
    expect(CronScheduler.validate('not a cron', 'UTC')).toEqual(expect.any(String));
    expect(CronScheduler.validate('* * * * *', 'Not/AZone')).toEqual(expect.any(String));
  });
});

describe('CronScheduler.poll', () => {
  it('fires due schedules once, advances them, and ignores disabled ones', async () => {
    await store.replaceForVersion('loop', 'v1', [
      draft({ nextFireAt: '2026-03-01T01:00:00.000Z' }),
      draft({ triggerNodeId: 'off', enabled: false, nextFireAt: '2026-03-01T00:00:00.000Z' }),
    ]);
    const scheduler = new CronScheduler(store, clock, { logger });
    const fires = collect(scheduler);
    expect(await scheduler.poll()).toBe(0);
    clock.set('2026-03-01T01:00:30.000Z');
    expect(await scheduler.poll()).toBe(1);
    expect(await scheduler.poll()).toBe(0);
    expect(fires).toHaveLength(1);
    expect(fires[0]).toMatchObject({ scheduledFor: '2026-03-01T01:00:00.000Z', catchUp: false });
    const [row] = await store.listEnabled();
    expect(row).toMatchObject({
      lastFiredAt: '2026-03-01T01:00:00.000Z',
      nextFireAt: '2026-03-01T02:00:00.000Z',
    });
  });

  it('keeps going when a listener throws and logs store failures', async () => {
    await store.replaceForVersion('loop', 'v1', [
      draft({ nextFireAt: '2026-03-01T00:00:00.000Z' }),
    ]);
    const scheduler = new CronScheduler(store, clock, { logger });
    const off = scheduler.onFire(() => {
      throw new Error('listener boom');
    });
    const fires = collect(scheduler);
    expect(await scheduler.poll()).toBe(1);
    expect(fires).toHaveLength(1);
    expect(logger.lines.some((l) => l.msg === 'cron listener failed')).toBe(true);
    off();

    const broken: ScheduleStore = {
      listEnabled: () => Promise.reject(new Error('db down')),
      listDue: () => Promise.reject(new Error('db down')),
      markFired: () => Promise.resolve(),
    };
    const failing = new CronScheduler(broken, clock, { logger });
    expect(await failing.poll()).toBe(0);
    expect(await failing.recover()).toBe(0);
    expect(logger.lines.map((l) => l.msg)).toEqual(
      expect.arrayContaining(['cron poll failed', 'cron recovery failed']),
    );
    const silent = new CronScheduler(broken, clock);
    expect(await silent.poll()).toBe(0);
    expect(await silent.recover()).toBe(0);
  });

  it('disarms a schedule whose expression no longer parses', async () => {
    await store.replaceForVersion('loop', 'v1', [
      draft({ expression: 'bogus', nextFireAt: '2026-03-01T00:00:00.000Z' }),
    ]);
    const scheduler = new CronScheduler(store, clock, { logger });
    expect(await scheduler.poll()).toBe(1);
    const [row] = await store.listEnabled();
    expect(row?.nextFireAt).toBeUndefined();
    expect(logger.lines.some((l) => l.msg === 'cron expression failed; schedule disarmed')).toBe(
      true,
    );
    const silent = new CronScheduler(store, clock);
    expect(await silent.recover()).toBe(0);
  });

  it('skips overlapping polls', async () => {
    await store.replaceForVersion('loop', 'v1', [
      draft({ nextFireAt: '2026-03-01T00:00:00.000Z' }),
    ]);
    const scheduler = new CronScheduler(store, clock);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    scheduler.onFire(() => gate);
    const first = scheduler.poll();
    await new Promise((r) => setTimeout(r, 20));
    expect(await scheduler.poll()).toBe(0);
    expect(await scheduler.recover()).toBe(0);
    release();
    expect(await first).toBe(1);
  });

  it('polls on an interval between start and stop', async () => {
    await store.replaceForVersion('loop', 'v1', [
      draft({ nextFireAt: '2026-03-01T01:00:00.000Z' }),
    ]);
    const scheduler = new CronScheduler(store, clock, { pollIntervalMs: 10 });
    const fires = collect(scheduler);
    await scheduler.start();
    await scheduler.start();
    clock.set('2026-03-01T01:00:00.000Z');
    await new Promise((r) => setTimeout(r, 80));
    scheduler.stop();
    scheduler.stop();
    expect(fires).toHaveLength(1);
  });
});

describe('CronScheduler.recover (missed-fire policies)', () => {
  async function outage(policy: ScheduleRecord['missedFirePolicy'], cap?: number) {
    // Armed at 00:00 with the 01:00 slot next; the process is down until 04:30.
    await store.replaceForVersion('loop', 'v1', [
      draft({ missedFirePolicy: policy, nextFireAt: '2026-03-01T01:00:00.000Z' }),
    ]);
    clock.set('2026-03-01T04:30:00.000Z');
    const scheduler = new CronScheduler(store, clock, {
      logger,
      ...(cap !== undefined ? { maxCatchUp: cap } : {}),
    });
    const fires = collect(scheduler);
    const count = await scheduler.recover();
    const [row] = await store.listEnabled();
    return { scheduler, fires, count, row };
  }

  it('skip moves to the next future slot without firing', async () => {
    const { fires, count, row } = await outage('skip');
    expect(count).toBe(0);
    expect(fires).toEqual([]);
    expect(row?.nextFireAt).toBe('2026-03-01T05:00:00.000Z');
    expect(row?.lastFiredAt).toBeUndefined();
  });

  it('run-once fires one catch-up run for the latest missed slot', async () => {
    const { fires, count, row } = await outage('run-once');
    expect(count).toBe(1);
    expect(fires.map((f) => [f.scheduledFor, f.catchUp])).toEqual([
      ['2026-03-01T04:00:00.000Z', true],
    ]);
    expect(row).toMatchObject({
      lastFiredAt: '2026-03-01T04:00:00.000Z',
      nextFireAt: '2026-03-01T05:00:00.000Z',
    });
  });

  it('run-each fires once per missed slot', async () => {
    const { fires, scheduler } = await outage('run-each');
    expect(fires.map((f) => f.scheduledFor)).toEqual([
      '2026-03-01T01:00:00.000Z',
      '2026-03-01T02:00:00.000Z',
      '2026-03-01T03:00:00.000Z',
      '2026-03-01T04:00:00.000Z',
    ]);
    // Nothing is due again until 05:00.
    expect(await scheduler.poll()).toBe(0);
  });

  it('run-each stops at the cap and warns', async () => {
    const { fires, row } = await outage('run-each', 2);
    expect(fires.map((f) => f.scheduledFor)).toEqual([
      '2026-03-01T01:00:00.000Z',
      '2026-03-01T02:00:00.000Z',
    ]);
    expect(row?.nextFireAt).toBe('2026-03-01T05:00:00.000Z');
    expect(logger.lines.some((l) => l.msg.startsWith('cron catch-up capped'))).toBe(true);
    expect(RUN_EACH_CAP).toBe(100);
  });

  it('arms schedules without a next slot and leaves future ones alone', async () => {
    await store.replaceForVersion('loop', 'v1', [
      draft(),
      draft({ triggerNodeId: 'later', nextFireAt: '2026-03-02T00:00:00.000Z' }),
    ]);
    const scheduler = new CronScheduler(store, clock);
    expect(await scheduler.recover()).toBe(0);
    const rows = await store.listEnabled();
    expect(rows.map((r) => [r.triggerNodeId, r.nextFireAt])).toEqual([
      ['cron', '2026-03-01T01:00:00.000Z'],
      ['later', '2026-03-02T00:00:00.000Z'],
    ]);
  });

  it('start applies the policy before polling', async () => {
    await store.replaceForVersion('loop', 'v1', [
      draft({ missedFirePolicy: 'run-once', nextFireAt: '2026-02-28T00:00:00.000Z' }),
    ]);
    const scheduler = new CronScheduler(store, clock, { pollIntervalMs: 60_000 });
    const fires = collect(scheduler);
    await scheduler.start();
    scheduler.stop();
    expect(fires).toHaveLength(1);
    expect(fires[0]?.scheduledFor).toBe('2026-03-01T00:00:00.000Z');
  });
});
