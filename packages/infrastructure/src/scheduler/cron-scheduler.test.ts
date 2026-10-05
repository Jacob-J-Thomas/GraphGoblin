import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    expect(CronScheduler.validate('*/5 * * * *', 'Europe/Stockholm')).toBeUndefined();
    expect(CronScheduler.validate('not a cron', 'UTC')).toEqual({
      field: 'expression',
      message: expect.any(String),
    });
    expect(CronScheduler.validate('* * * * *', 'Not/AZone')).toEqual({
      field: 'timezone',
      message: expect.any(String),
    });
    expect(CronScheduler.validate('* * * * *', '')).toEqual({
      field: 'timezone',
      message: 'A time zone is required.',
    });
    expect(CronScheduler.validate('0 0 0 1 1 * 1900', 'Not/AZone')).toMatchObject({
      field: 'timezone',
    });
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
    let entered = false;
    scheduler.onFire(() => {
      entered = true;
      return gate;
    });
    const first = scheduler.poll();
    // Wait until the first poll is inside its listener, however long that takes under load.
    await vi.waitFor(() => expect(entered).toBe(true), { timeout: 5000 });
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
    // Wait for the interval to fire the due slot (a generous bound) rather than a fixed sleep.
    await vi.waitFor(() => expect(fires).toHaveLength(1), { timeout: 5000 });
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

  it.each([undefined, 2])(
    'skip moves to the next future slot without firing (cap %s)',
    async (cap) => {
      const { fires, count, row } = await outage('skip', cap);
      expect(count).toBe(0);
      expect(fires).toEqual([]);
      expect(row?.nextFireAt).toBe('2026-03-01T05:00:00.000Z');
      expect(row?.lastFiredAt).toBeUndefined();
      expect(logger.lines).toEqual([]);
    },
  );

  it.each([undefined, 2])('run-once fires the latest missed slot (cap %s)', async (cap) => {
    const { fires, count, row } = await outage('run-once', cap);
    expect(count).toBe(1);
    expect(fires.map((f) => [f.scheduledFor, f.catchUp])).toEqual([
      ['2026-03-01T04:00:00.000Z', true],
    ]);
    expect(row).toMatchObject({
      lastFiredAt: '2026-03-01T04:00:00.000Z',
      nextFireAt: '2026-03-01T05:00:00.000Z',
    });
    expect(logger.lines).toEqual([]);
  });

  it.each([undefined, 4])(
    'run-each fires every slot up to the cap without a warning (cap %s)',
    async (cap) => {
      const { fires, count, scheduler } = await outage('run-each', cap);
      expect(count).toBe(4);
      expect(fires.map((f) => f.scheduledFor)).toEqual([
        '2026-03-01T01:00:00.000Z',
        '2026-03-01T02:00:00.000Z',
        '2026-03-01T03:00:00.000Z',
        '2026-03-01T04:00:00.000Z',
      ]);
      expect(logger.lines).toEqual([]);
      // Nothing is due again until 05:00.
      expect(await scheduler.poll()).toBe(0);
    },
  );

  it('run-each with a zero cap drops all missed slots without firing', async () => {
    const { fires, count, row } = await outage('run-each', 0);
    expect(count).toBe(0);
    expect(fires).toEqual([]);
    expect(row?.lastFiredAt).toBeUndefined();
    expect(row?.nextFireAt).toBe('2026-03-01T05:00:00.000Z');
    expect(logger.lines).toEqual([
      {
        level: 'warn',
        obj: { scheduleId: row?.id, cap: 0, dropped: 4, firstRetainedSlot: undefined },
        msg: 'cron catch-up capped; older missed slots dropped: 4; first retained slot: none',
      },
    ]);
  });

  it('run-each retains the latest slots at the cap and warns', async () => {
    const { fires, count, row } = await outage('run-each', 2);
    expect(count).toBe(2);
    expect(fires.map((f) => f.scheduledFor)).toEqual([
      '2026-03-01T03:00:00.000Z',
      '2026-03-01T04:00:00.000Z',
    ]);
    expect(row).toMatchObject({
      lastFiredAt: '2026-03-01T04:00:00.000Z',
      nextFireAt: '2026-03-01T05:00:00.000Z',
    });
    expect(logger.lines).toEqual([
      {
        level: 'warn',
        obj: {
          scheduleId: row?.id,
          cap: 2,
          dropped: 2,
          firstRetainedSlot: '2026-03-01T03:00:00.000Z',
        },
        msg: 'cron catch-up capped; older missed slots dropped: 2; first retained slot: 2026-03-01T03:00:00.000Z',
      },
    ]);
  });

  it('run-each drops the 50 oldest of 150 missed slots and fires the latest 100 oldest first', async () => {
    expect(RUN_EACH_CAP).toBe(100);
    await store.replaceForVersion('loop', 'v1', [
      draft({
        expression: '* * * * *',
        missedFirePolicy: 'run-each',
        nextFireAt: '2026-03-01T00:00:00.000Z',
      }),
    ]);
    // Include the slot exactly at recovery: 00:00 through 02:29 is 150 missed slots.
    clock.set('2026-03-01T02:29:00.000Z');
    const scheduler = new CronScheduler(store, clock, { logger });
    const fires = collect(scheduler);
    expect(await scheduler.recover()).toBe(100);
    const firstRetainedSlot = '2026-03-01T00:50:00.000Z';
    expect(fires.map((f) => [f.scheduledFor, f.catchUp])).toEqual(
      Array.from({ length: 100 }, (_, i) => [
        new Date(Date.parse(firstRetainedSlot) + i * 60_000).toISOString(),
        true,
      ]),
    );
    const [row] = await store.listEnabled();
    expect(row).toMatchObject({
      lastFiredAt: '2026-03-01T02:29:00.000Z',
      nextFireAt: '2026-03-01T02:30:00.000Z',
    });
    expect(logger.lines).toEqual([
      {
        level: 'warn',
        obj: { scheduleId: row?.id, cap: 100, dropped: 50, firstRetainedSlot },
        msg: 'cron catch-up capped; older missed slots dropped: 50; first retained slot: 2026-03-01T00:50:00.000Z',
      },
    ]);
    expect(await scheduler.recover()).toBe(0);
    expect(await scheduler.poll()).toBe(0);
    expect(fires).toHaveLength(100);
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
