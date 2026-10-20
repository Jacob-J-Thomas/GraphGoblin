import { describe, expect, it, vi } from 'vitest';
import { CapturingLogger, FakeClock } from '@graphgoblin/engine/testing';
import { MemoryTimerStore } from './memory-timer-store.js';
import { TimerService } from './timer-service.js';

describe('MemoryTimerStore', () => {
  it('upserts, lists due timers in order, and removes by key or run', async () => {
    const store = new MemoryTimerStore();
    await store.upsert('r1', 'a', new Date(2000));
    await store.upsert('r1', 'b', new Date(1000));
    await store.upsert('r2', 'a', new Date(3000));
    await store.upsert('r1', 'a', new Date(500));
    expect((await store.listDue(new Date(1500))).map((t) => `${t.runId}:${t.key}`)).toEqual([
      'r1:a',
      'r1:b',
    ]);
    expect((await store.listDue(new Date(5000), 1)).map((t) => t.key)).toEqual(['a']);
    expect((await store.list('r1')).map((t) => t.key)).toEqual(['a', 'b']);
    await store.remove('r1', 'a');
    expect((await store.list('r1')).map((t) => t.key)).toEqual(['b']);
    await store.remove('r1');
    expect(await store.list('r1')).toEqual([]);
    expect(await store.list('r2')).toHaveLength(1);
  });
});

describe('TimerService', () => {
  it('keeps a timer whose listener failed and delivers it again on the next poll', async () => {
    const store = new MemoryTimerStore();
    const clock = new FakeClock();
    const logger = new CapturingLogger();
    const service = new TimerService(store, clock, { logger, batchSize: 10 });
    const fired: string[] = [];
    service.onFire((runId, key) => {
      fired.push(`${runId}:${key}`);
    });
    const off = service.onFire(() => {
      throw new Error('listener boom');
    });
    await service.schedule('r1', 'timer', new Date(clock.now().getTime() + 1000));
    await service.schedule('r2', 'timeout', new Date(clock.now().getTime() + 5000));
    expect(await service.poll()).toBe(0);
    clock.advance(1000);
    expect(await service.poll()).toBe(1);
    expect(fired).toEqual(['r1:timer']);
    expect(logger.lines.some((l) => l.msg.startsWith('timer listener failed'))).toBe(true);
    // Not acknowledged: the next poll delivers it again, and once every listener succeeds it goes.
    expect(await store.list('r1')).toHaveLength(1);
    off();
    clock.advance(1000);
    expect(await service.poll()).toBe(1);
    expect(fired).toEqual(['r1:timer', 'r1:timer']);
    expect(await store.list('r1')).toEqual([]);
    await service.cancel('r2');
    clock.advance(10_000);
    expect(await service.poll()).toBe(0);
  });

  it('skips overlapping polls and logs store failures', async () => {
    const store = new MemoryTimerStore();
    const clock = new FakeClock();
    const logger = new CapturingLogger();
    const service = new TimerService(store, clock, { logger });
    await service.schedule('r1', 'k', new Date(0));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    service.onFire(() => gate);
    const first = service.poll();
    expect(await service.poll()).toBe(0);
    release();
    expect(await first).toBe(1);

    const broken = new TimerService(
      {
        ...store,
        listDue: () => Promise.reject(new Error('db down')),
      } as unknown as MemoryTimerStore,
      clock,
      { logger },
    );
    broken.onFire(() => undefined);
    expect(await broken.poll()).toBe(0);
    expect(logger.lines.at(-1)?.msg).toBe('timer poll failed');
    const silent = new TimerService(
      {
        ...store,
        listDue: () => Promise.reject(new Error('db down')),
      } as unknown as MemoryTimerStore,
      clock,
    );
    silent.onFire(() => undefined);
    expect(await silent.poll()).toBe(0);
  });

  it('delivers at least once: a timer stays until its listeners return, and a re-arm survives', async () => {
    const store = new MemoryTimerStore();
    const clock = new FakeClock();
    // No listener: nothing can deliver, so nothing is consumed.
    const idle = new TimerService(store, clock);
    await idle.schedule('r1', 'heartbeat', new Date(0));
    expect(await idle.poll()).toBe(0);
    expect(await store.list('r1')).toHaveLength(1);

    // A listener that dies mid-delivery (a crash) leaves the timer for the next process.
    const crashed = new TimerService(store, clock);
    let delivering = false;
    crashed.onFire(() => {
      delivering = true;
      return new Promise<void>(() => undefined);
    });
    void crashed.poll();
    await vi.waitFor(() => expect(delivering).toBe(true), { timeout: 5000 });
    expect(await store.list('r1')).toHaveLength(1);

    // The next process delivers it; the listener re-arms the same key, which is kept.
    const next = new TimerService(store, clock);
    const later = new Date(60_000);
    next.onFire((runId, key) => next.schedule(runId, key, later));
    expect(await next.poll()).toBe(1);
    expect(await store.list('r1')).toEqual([{ runId: 'r1', key: 'heartbeat', at: later }]);
    await store.acknowledge('r1', 'heartbeat', later);
    expect(await store.list('r1')).toEqual([]);
  });

  it('polls on an interval between start and stop', async () => {
    const store = new MemoryTimerStore();
    const clock = new FakeClock();
    const service = new TimerService(store, clock, { pollIntervalMs: 10 });
    const fired: string[] = [];
    service.onFire((runId) => {
      fired.push(runId);
    });
    await service.schedule('r1', 'k', new Date(0));
    service.start();
    service.start();
    // Wait for the interval to fire rather than a fixed sleep, which is flaky under load.
    await vi.waitFor(async () => expect(await store.list('r1')).toEqual([]), { timeout: 5000 });
    service.stop();
    service.stop();
    expect(fired).toEqual(['r1']);
  });
});

describe('deferred timer delivery', () => {
  it.each([50, 1000])(
    'retains an early delivery until a listener accepts it (%i ms)',
    async (pollIntervalMs) => {
      const store = new MemoryTimerStore();
      const clock = new FakeClock();
      const timer = new TimerService(store, clock, { pollIntervalMs });
      let ready = false;
      let deliveries = 0;
      timer.onFire(() => {
        deliveries++;
        return ready;
      });
      await timer.schedule('r', 'timer@observed', clock.now());
      expect(await timer.poll()).toBe(1);
      expect(await store.list('r')).toHaveLength(1);
      ready = true;
      expect(await timer.poll()).toBe(0);
      clock.advance(pollIntervalMs);
      expect(await timer.poll()).toBe(1);
      expect(await store.list('r')).toEqual([]);
      expect(deliveries).toBe(2);
    },
  );
});

it('moves deferred rows out of a full batch without replacing a listener re-arm', async () => {
  const store = new MemoryTimerStore();
  const clock = new FakeClock();
  const timer = new TimerService(store, clock, { batchSize: 1, pollIntervalMs: 50 });
  await timer.schedule('early', 'timer@a', clock.now());
  await timer.schedule('ready', 'timer@b', clock.now());
  const accepted: string[] = [];
  timer.onFire((id) => {
    if (id === 'early') return false;
    accepted.push(id);
    return true;
  });
  await timer.poll();
  await timer.poll();
  expect(accepted).toEqual(['ready']);
  const deferred = (await store.list('early'))[0]!;
  const later = new Date(clock.now().getTime() + 10000);
  await store.upsert('early', 'timer@a', later);
  await store.defer('early', 'timer@a', deferred.at, new Date(0));
  expect((await store.list('early'))[0]?.at).toEqual(later);
  await store.defer('missing', 'timer@none', new Date(0), later);
});

it('keeps an identical-deadline re-arm requested by a delivery listener', async () => {
  const store = new MemoryTimerStore();
  const clock = new FakeClock();
  const timer = new TimerService(store, clock);
  let calls = 0;
  timer.onFire(async () => {
    calls += 1;
    if (calls === 1) await timer.schedule('run', 'timer@same', clock.now());
  });
  await timer.schedule('run', 'timer@same', clock.now());
  await timer.poll();
  expect(await store.list('run')).toHaveLength(1);
  await timer.poll();
  expect(calls).toBe(2);
  expect(await store.list('run')).toHaveLength(0);
});

it('preserves mutation order and recovers the queue after a failed schedule', async () => {
  class FailedScheduleStore extends MemoryTimerStore {
    private fail = true;
    override async upsert(...args: Parameters<MemoryTimerStore['upsert']>) {
      if (this.fail) {
        this.fail = false;
        throw Error('schedule write failed');
      }
      return super.upsert(...args);
    }
  }
  const store = new FailedScheduleStore();
  const clock = new FakeClock();
  const timer = new TimerService(store, clock);
  let delivered = 0;
  timer.onFire(() => {
    delivered += 1;
  });
  await expect(timer.schedule('run', 'timer@same', clock.now())).rejects.toThrow(
    'schedule write failed',
  );
  const scheduled = timer.schedule('run', 'timer@same', clock.now());
  const cancelled = timer.cancel('run');
  await Promise.all([scheduled, cancelled]);
  expect(await store.list('run')).toHaveLength(0);
  await Promise.all([
    timer.schedule('run', 'timer@same', clock.now()),
    timer.schedule('run', 'timer@same', clock.now()),
  ]);
  await timer.poll();
  expect(delivered).toBe(1);
  expect(await store.list('run')).toHaveLength(0);
});
