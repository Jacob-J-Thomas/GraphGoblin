import { describe, expect, it } from 'vitest';
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
  it('fires due timers once, removes them first, and keeps going when a listener fails', async () => {
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
    expect(logger.lines.some((l) => l.msg === 'timer listener failed')).toBe(true);
    expect(await store.list('r1')).toEqual([]);
    off();
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
    expect(await broken.poll()).toBe(0);
    expect(logger.lines.at(-1)?.msg).toBe('timer poll failed');
    const silent = new TimerService(
      {
        ...store,
        listDue: () => Promise.reject(new Error('db down')),
      } as unknown as MemoryTimerStore,
      clock,
    );
    expect(await silent.poll()).toBe(0);
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
    await new Promise((r) => setTimeout(r, 60));
    service.stop();
    service.stop();
    expect(fired).toEqual(['r1']);
  });
});
