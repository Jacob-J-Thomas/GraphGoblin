import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeClock, FakeIds, createTestEngine, singleNodeLoop } from '@graphgoblin/engine/testing';
import { RunManager } from '@graphgoblin/engine';
import { openMemoryDatabase, type DatabaseHandle } from './sqlite/db.js';
import { SqliteEventStore } from './sqlite/events.js';
import { SqliteRunRepository } from './sqlite/runs.js';
import { SqliteSecrets, encryptSecret, decryptSecret } from './sqlite/secrets.js';
import { SqliteScheduleStore } from './sqlite/triggers.js';
import { SqliteTimerStore } from './sqlite/timers.js';
import { CronScheduler, type CronFire } from './scheduler/cron-scheduler.js';
import { TimerService } from './scheduler/timer-service.js';
import { MemoryTimerStore } from './scheduler/memory-timer-store.js';
import { ProcessScripts } from './process/scripts.js';

let db: DatabaseHandle;
beforeEach(async () => {
  db = await openMemoryDatabase();
});
afterEach(() => {
  db.close();
});

describe('adversarial infrastructure invariants (forks pool)', () => {
  it('3: concurrent SQLite batches have no sequence gaps', async () => {
    const events = new SqliteEventStore(db.db, new FakeClock());
    await Promise.all(
      Array.from({ length: 100 }, () =>
        events.append('run', [
          { type: 'signal.received', name: 'a', payload: null },
          { type: 'signal.received', name: 'b', payload: null },
        ]),
      ),
    );
    expect((await events.read('run')).map((x) => x.seq)).toEqual(
      Array.from({ length: 200 }, (_, i) => i + 1),
    );
  });
  it.each(['skip', 'run-once', 'run-each'] as const)(
    '15: %s catches missed daily slots across spring DST',
    async (missedFirePolicy) => {
      const clock = new FakeClock(Date.parse('2026-03-09T15:00:00.000Z'));
      const store = new SqliteScheduleStore(db.db, clock, new FakeIds());
      await store.replaceForVersion('loop', 'v1', [
        {
          ownerId: 'local',
          triggerNodeId: 'cron',
          expression: '0 9 * * *',
          timezone: 'America/New_York',
          missedFirePolicy,
          enabled: true,
          nextFireAt: '2026-03-07T14:00:00.000Z',
        },
      ]);
      const scheduler = new CronScheduler(store, clock);
      const fires: CronFire[] = [];
      scheduler.onFire((fire) => {
        fires.push(fire);
      });
      await scheduler.recover();
      expect(fires.map((f) => f.scheduledFor)).toEqual(
        missedFirePolicy === 'skip'
          ? []
          : missedFirePolicy === 'run-once'
            ? ['2026-03-09T13:00:00.000Z']
            : ['2026-03-07T14:00:00.000Z', '2026-03-08T13:00:00.000Z', '2026-03-09T13:00:00.000Z'],
      );
      expect((await store.listEnabled())[0]?.nextFireAt).toBe('2026-03-10T13:00:00.000Z');
      expect(await scheduler.recover()).toBe(0);
    },
  );
  it('ADV-010: run-once chooses the latest missed slot even beyond the run-each cap', async () => {
    const clock = new FakeClock(Date.parse('2026-03-02T00:00:00.000Z'));
    const store = new SqliteScheduleStore(db.db, clock, new FakeIds());
    await store.replaceForVersion('loop', 'v1', [
      {
        ownerId: 'local',
        triggerNodeId: 'cron',
        expression: '* * * * *',
        timezone: 'UTC',
        missedFirePolicy: 'run-once',
        enabled: true,
        nextFireAt: '2026-03-01T00:00:00.000Z',
      },
    ]);
    const scheduler = new CronScheduler(store, clock);
    const fires: CronFire[] = [];
    scheduler.onFire((fire) => {
      fires.push(fire);
    });
    await scheduler.recover();
    expect(fires[0]?.scheduledFor).toBe('2026-03-02T00:00:00.000Z');
  });
  it('15: two scheduler instances have no shared lease (documented single-process limit)', async () => {
    const clock = new FakeClock();
    const store = new SqliteScheduleStore(db.db, clock, new FakeIds());
    await store.replaceForVersion('loop', 'v1', [
      {
        ownerId: 'local',
        triggerNodeId: 'cron',
        expression: '* * * * *',
        timezone: 'UTC',
        missedFirePolicy: 'skip',
        enabled: true,
        nextFireAt: clock.now().toISOString(),
      },
    ]);
    const a = new CronScheduler(store, clock);
    const b = new CronScheduler(store, clock);
    const fires: CronFire[] = [];
    a.onFire((f) => {
      fires.push(f);
    });
    b.onFire((f) => {
      fires.push(f);
    });
    await Promise.all([a.poll(), b.poll()]);
    expect(fires).toHaveLength(2);
    expect(fires[0]?.scheduledFor).toBe(fires[1]?.scheduledFor);
  });
  it.each([
    ['duration', { mode: 'duration', seconds: 1 }, 'timer'],
    [
      'input timeout',
      { mode: 'input', prompt: '?', timeoutSeconds: 1, onTimeout: 'continue' },
      'timeout',
    ],
  ] as const)(
    'ADV-011: a %s timer lost before a crash is re-armed from the waiting run',
    async (_name, config, key) => {
      const e = await createTestEngine();
      e.manager.stop();
      const store = new SqliteTimerStore(db.db);
      const timer = new TimerService(store, e.ports.clock);
      const manager = new RunManager({ ...e.ports, timers: timer }, e.settings);
      await manager.start();
      const v = e.publish(
        singleNodeLoop(`timer-crash-${key}`, { id: 'wait', kind: 'wait', label: 'Wait', config }),
      );
      const r = await manager.startRun({
        ownerId: 'local',
        loopId: v.loopId,
        source: 'manual.api',
      });
      await manager.waitForIdle();
      manager.stop();
      const seq = (await e.ports.runs.get(r.id))!.waiting!.startedSeq;
      expect((await store.list(r.id)).map((t) => t.key)).toEqual([`${key}@${seq}`]);
      // The row is gone but the run still waits: a fire consumed before its wake was recorded.
      await store.remove(r.id);
      e.ports.clock.advance(2000);
      const recovered = new RunManager({ ...e.ports, timers: timer }, e.settings);
      await recovered.start();
      expect((await store.list(r.id)).map((t) => t.key)).toEqual([`${key}@${seq}`]);
      await timer.poll();
      await recovered.waitForIdle();
      recovered.stop();
      expect((await recovered.getRun(r.id))?.status).toBe('succeeded');
      expect(await store.list(r.id)).toEqual([]);
    },
  );
  it('ADV-011: a fire interrupted mid-delivery is delivered again after a restart', async () => {
    const e = await createTestEngine();
    e.manager.stop();
    const store = new SqliteTimerStore(db.db);
    const first = new TimerService(store, e.ports.clock);
    const manager = new RunManager({ ...e.ports, timers: first }, e.settings);
    await manager.start();
    const v = e.publish(
      singleNodeLoop('timer-gap', {
        id: 'wait',
        kind: 'wait',
        label: 'Wait',
        config: { mode: 'duration', seconds: 1 },
      }),
    );
    const r = await manager.startRun({ ownerId: 'local', loopId: v.loopId, source: 'manual.api' });
    await manager.waitForIdle();
    // The process dies inside the wake: before the waiting-to-running write lands.
    const transition = e.ports.runs.transition.bind(e.ports.runs);
    const spy = vi
      .spyOn(e.ports.runs, 'transition')
      .mockImplementation((id, from, changes) =>
        changes.status === 'running' && from.includes('waiting')
          ? new Promise(() => undefined)
          : transition(id, from, changes),
      );
    e.ports.clock.advance(2000);
    void first.poll();
    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
    manager.stop();
    spy.mockRestore();
    expect((await store.list(r.id)).map((t) => t.key)).toEqual([
      `timer@${(await e.ports.runs.get(r.id))!.waiting!.startedSeq}`,
    ]);
    const second = new TimerService(store, e.ports.clock);
    const recovered = new RunManager({ ...e.ports, timers: second }, e.settings);
    await recovered.start();
    expect(await second.poll()).toBe(1);
    await recovered.waitForIdle();
    recovered.stop();
    expect((await recovered.getRun(r.id))?.status).toBe('succeeded');
    expect(e.events(r.id).filter((x) => x.type === 'run.woken')).toHaveLength(1);
  });
  it('18: concurrent set of one secret preserves one authenticated ciphertext', async () => {
    const key = Buffer.alloc(32, 4);
    const secrets = new SqliteSecrets(db.db, new FakeClock(), key, 'local');
    const values = Array.from({ length: 25 }, (_, i) => `secret-${i}`);
    await Promise.all(values.map((value) => secrets.set('same', value)));
    expect(await secrets.list()).toHaveLength(1);
    expect(values).toContain(await secrets.resolve('same'));
    const rows = await db.client.execute('select ciphertext from secrets');
    const ciphertext = rows.rows[0]?.['ciphertext'];
    expect(typeof ciphertext).toBe('string');
    expect(values).not.toContain(ciphertext);
    expect(() => encryptSecret(Buffer.alloc(31), 'value')).toThrow(/32/);
    expect(() => decryptSecret(Buffer.alloc(32, 5), ciphertext as string)).toThrow();
  });
  it('6/QA-LIMIT-001: ProcessScripts abort kills a real child and its grandchild', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gg-process-tree-'));
    const pidFile = join(dir, 'grandchild.pid');
    let parent: ChildProcess | undefined;
    let grandchildPid: number | undefined;
    const controller = new AbortController();
    const spawnAndRecord = ((command: string, args: readonly string[], options: SpawnOptions) => {
      const child = spawn(command, args, options);
      if (command === process.execPath) parent = child;
      return child;
    }) as typeof spawn;
    const scripts = new ProcessScripts({ spawnImpl: spawnAndRecord });
    // The grandchild is a sleeper the script starts; it must die with the script's process tree.
    const grandchild = `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
    const child = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { windowsHide: true, stdio: 'inherit' }); setInterval(() => {}, 1000);`;
    const alive = (pid: number): boolean => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    const running = scripts.run({
      command: process.execPath,
      args: ['-e', child],
      cwd: dir,
      env: {},
      signal: controller.signal,
      timeoutMs: 20_000,
    });
    try {
      await vi.waitFor(
        async () => {
          grandchildPid = Number(await readFile(pidFile, 'utf8'));
          expect(grandchildPid).toBeGreaterThan(0);
        },
        { timeout: 10_000 },
      );
      expect(alive(grandchildPid!)).toBe(true);
      controller.abort();
      expect((await running).timedOut).toBe(false);
      await vi.waitFor(
        () => {
          expect(alive(parent!.pid!)).toBe(false);
          expect(alive(grandchildPid!)).toBe(false);
        },
        { timeout: 5_000 },
      );
    } finally {
      controller.abort();
      if (grandchildPid && alive(grandchildPid)) process.kill(grandchildPid);
      await running;
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('timer delivery (review of WP-G)', () => {
  const waitLoop = (name: string, config: unknown) =>
    singleNodeLoop(name, { id: 'wait', kind: 'wait', label: 'Wait', config });

  it('a throwing timer listener leaves the timer for another delivery', async () => {
    const store = new MemoryTimerStore();
    const timer = new TimerService(store, new FakeClock());
    const listener = vi.fn().mockRejectedValue(new Error('transient store error'));
    timer.onFire(listener);
    await timer.schedule('r', 'timer', new Date(0));
    await timer.poll();
    await timer.poll();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(await store.list('r')).toHaveLength(1);
  });

  it('a failed manager wake does not consume the timer', async () => {
    const e = await createTestEngine();
    e.manager.stop();
    const store = new MemoryTimerStore();
    const timer = new TimerService(store, e.ports.clock);
    const manager = new RunManager({ ...e.ports, timers: timer }, e.settings);
    await manager.start();
    const v = e.publish(waitLoop('wake-failure', { mode: 'duration', seconds: 1 }));
    const r = await manager.startRun({ ownerId: 'local', loopId: v.loopId, source: 'manual.api' });
    await manager.waitForIdle();
    const transition = e.ports.runs.transition.bind(e.ports.runs);
    const spy = vi
      .spyOn(e.ports.runs, 'transition')
      .mockImplementation((id, from, changes) =>
        changes.status === 'running'
          ? Promise.reject(new Error('transient'))
          : transition(id, from, changes),
      );
    e.ports.clock.advance(2000);
    await timer.poll();
    spy.mockRestore();
    // The wake is durable already; the next poll finds the run woken and acknowledges.
    await timer.poll();
    await manager.waitForIdle();
    manager.stop();
    expect((await manager.getRun(r.id))?.status).toBe('succeeded');
  });

  it('a duration with a timeout re-arms both lost deadlines (SQLite)', async () => {
    const e = await createTestEngine();
    e.manager.stop();
    const store = new SqliteTimerStore(db.db);
    const timer = new TimerService(store, e.ports.clock);
    const ports = { ...e.ports, timers: timer };
    const manager = new RunManager(ports, e.settings);
    await manager.start();
    const v = e.publish(
      waitLoop('two-deadlines', {
        mode: 'duration',
        seconds: 3600,
        timeoutSeconds: 1,
        onTimeout: 'fail-run',
      }),
    );
    const r = await manager.startRun({ ownerId: 'local', loopId: v.loopId, source: 'manual.api' });
    await manager.waitForIdle();
    manager.stop();
    const seq = (await e.ports.runs.get(r.id))!.waiting!.startedSeq;
    expect((await store.list(r.id)).map((t) => t.key).sort()).toEqual([
      `timeout@${seq}`,
      `timer@${seq}`,
    ]);
    await store.remove(r.id);
    e.ports.clock.advance(2000);
    const recovered = new RunManager(ports, e.settings);
    await recovered.start();
    expect(await store.list(r.id)).toHaveLength(2);
    await timer.poll();
    await recovered.waitForIdle();
    recovered.stop();
    expect((await recovered.getRun(r.id))?.failure?.code).toBe('WAIT_TIMEOUT');
  });

  it('an obsolete timeout in the same poll batch does not wake a later input wait', async () => {
    const e = await createTestEngine();
    e.manager.stop();
    const store = new MemoryTimerStore();
    const timer = new TimerService(store, e.ports.clock);
    const manager = new RunManager({ ...e.ports, timers: timer }, e.settings);
    await manager.start();
    const def = waitLoop('stale-timeout', { mode: 'duration', seconds: 1, timeoutSeconds: 2 });
    def.nodes.push({
      id: 'input',
      kind: 'wait',
      label: 'Input',
      config: { mode: 'input', prompt: '?' },
    });
    def.edges[1]!.to.node = 'input';
    def.edges.push({ id: 'end', from: { node: 'input', port: 'out' }, to: { node: 'done' } });
    const r = await manager.startRun({
      ownerId: 'local',
      loopId: e.publish(def).loopId,
      source: 'manual.api',
    });
    await manager.waitForIdle();
    // Between the two fires of one poll, the run reaches the input wait.
    timer.onFire(() => manager.waitForIdle());
    e.ports.clock.advance(3000);
    await timer.poll();
    await manager.waitForIdle();
    manager.stop();
    expect(await manager.getRun(r.id)).toMatchObject({
      status: 'waiting',
      waiting: { nodeId: 'input', kind: 'input' },
    });
  });
});

describe('finalization on SQLite (review of WP-G, fourth round)', () => {
  it('a resumed failed run is finalized again after a crash on its next terminal status', async () => {
    const e = await createTestEngine();
    e.manager.stop();
    const runs = new SqliteRunRepository(db.db);
    const events = new SqliteEventStore(db.db, e.ports.clock);
    const ports = { ...e.ports, runs, events };
    const manager = new RunManager(ports, e.settings);
    await manager.start();
    e.ports.harness.script([{ error: { code: 'transient', message: 'retry me' } }]);
    const def = singleNodeLoop(
      'resumed-finalization',
      { id: 'infer', kind: 'inference', label: 'I', config: { prompt: { template: 'go' } } },
      { return: { mapping: '7', channels: [{ kind: 'log' }] } },
    );
    const r = await manager.startRun({
      ownerId: 'local',
      loopId: e.publish(def).loopId,
      source: 'manual.api',
    });
    await manager.waitForIdle();
    expect((await runs.get(r.id))?.failure?.resumable).toBe(true);
    expect(await runs.listUnfinalized()).toHaveLength(0);
    const transition = runs.transition.bind(runs);
    let blocked = false;
    const spy = vi.spyOn(runs, 'transition').mockImplementation(async (id, from, changes) => {
      const out = await transition(id, from, changes);
      if (changes.status === 'succeeded') {
        blocked = true;
        return new Promise<never>(() => undefined);
      }
      return out;
    });
    await manager.resume(r.id);
    await vi.waitFor(() => expect(blocked).toBe(true));
    manager.stop();
    spy.mockRestore();
    const second = new RunManager(ports, e.settings);
    await second.start();
    await second.waitForIdle();
    second.stop();
    expect((await runs.get(r.id))?.status).toBe('succeeded');
    expect(e.ports.delivery.logged).toHaveLength(1);
    expect(await runs.listUnfinalized()).toHaveLength(0);
  });

  it.each(['next success', 'durable resume'] as const)(
    'an older finalizer in flight cannot hide the %s',
    async (crashPoint) => {
      const e = await createTestEngine();
      e.manager.stop();
      const runs = new SqliteRunRepository(db.db);
      const events = new SqliteEventStore(db.db, e.ports.clock);
      const ports = { ...e.ports, runs, events };
      const manager = new RunManager(ports, e.settings);
      await manager.start();
      e.ports.harness.script([{ error: { code: 'transient', message: 'retry me' } }]);
      const def = singleNodeLoop(
        'stale-finalizer',
        { id: 'infer', kind: 'inference', label: 'I', config: { prompt: { template: 'go' } } },
        { return: { mapping: '7', channels: [{ kind: 'log' }] } },
      );
      let entered!: () => void;
      const enteredP = new Promise<void>((resolve) => (entered = resolve));
      let release!: () => void;
      const releaseP = new Promise<void>((resolve) => (release = resolve));
      const mark = runs.markFinalized.bind(runs);
      let first = true;
      const markSpy = vi.spyOn(runs, 'markFinalized').mockImplementation(async (id) => {
        if (first) {
          first = false;
          entered();
          await releaseP;
        }
        return mark(id);
      });
      const r = await manager.startRun({
        ownerId: 'local',
        loopId: e.publish(def).loopId,
        source: 'manual.api',
      });
      await enteredP;
      let blocked = false;
      const transition = runs.transition.bind(runs);
      const append = events.append.bind(events);
      const statusSpy = vi
        .spyOn(runs, 'transition')
        .mockImplementation(async (id, from, changes) => {
          const out = await transition(id, from, changes);
          if (crashPoint === 'next success' && changes.status === 'succeeded') {
            blocked = true;
            return new Promise<never>(() => undefined);
          }
          return out;
        });
      const appendSpy = vi
        .spyOn(events, 'append')
        .mockImplementation(async (id, drafts, options) => {
          const out = await append(id, drafts, options);
          if (crashPoint === 'durable resume' && drafts.some((d) => d.type === 'run.resumed')) {
            blocked = true;
            return new Promise<never>(() => undefined);
          }
          return out;
        });
      const resumed = manager.resume(r.id);
      release();
      if (crashPoint === 'next success') await resumed;
      await vi.waitFor(() => expect(blocked).toBe(true));
      manager.stop();
      markSpy.mockRestore();
      statusSpy.mockRestore();
      appendSpy.mockRestore();
      const second = new RunManager(ports, e.settings);
      await second.start();
      await second.waitForIdle();
      second.stop();
      expect((await runs.get(r.id))?.status).toBe('succeeded');
      expect(e.ports.delivery.logged).toHaveLength(1);
      expect(await runs.listUnfinalized()).toHaveLength(0);
    },
  );

  it.each(['same failure', 'newer non-resumable failure'] as const)(
    'of two concurrent resumes of one failure, only one acts (%s)',
    async (scenario) => {
      const e = await createTestEngine();
      e.manager.stop();
      const runs = new SqliteRunRepository(db.db);
      const events = new SqliteEventStore(db.db, e.ports.clock);
      const manager = new RunManager({ ...e.ports, runs, events }, e.settings);
      await manager.start();
      e.ports.harness.script([{ error: { code: 'transient', message: 'retry me' } }]);
      const exitFailure = scenario === 'newer non-resumable failure';
      const def = singleNodeLoop(
        'concurrent-resume',
        { id: 'infer', kind: 'inference', label: 'I', config: { prompt: { template: 'go' } } },
        {
          ...(exitFailure
            ? {
                criteria: [
                  {
                    when: 'predicate',
                    strategy: 'expression',
                    jsonata: 'true',
                    outcome: 'failure',
                  },
                ],
              }
            : {}),
          return: { mapping: '7', channels: [{ kind: 'log' }] },
        },
      );
      const r = await manager.startRun({
        ownerId: 'local',
        loopId: e.publish(def).loopId,
        source: 'manual.api',
      });
      await manager.waitForIdle();
      expect((await runs.get(r.id))?.failure?.resumable).toBe(true);
      let entered!: () => void;
      const enteredP = new Promise<void>((resolve) => (entered = resolve));
      let gate!: () => void;
      const gateP = new Promise<void>((resolve) => (gate = resolve));
      const clear = runs.clearFinalized.bind(runs);
      let first = true;
      vi.spyOn(runs, 'clearFinalized').mockImplementation(async (id) => {
        if (first) {
          first = false;
          entered();
          await gateP;
        }
        return clear(id);
      });
      const a = manager.resume(r.id);
      await enteredP;
      const b = manager.resume(r.id);
      await new Promise((resolve) => setTimeout(resolve, 10));
      gate();
      const outcomes = await Promise.allSettled([a, b]);
      await manager.waitForIdle();
      manager.stop();
      expect(outcomes.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      const log = await events.read(r.id);
      expect(log.filter((x) => x.type === 'run.resumed')).toHaveLength(1);
      expect(log.filter((x) => x.type === 'run.finished')).toHaveLength(1);
      expect((await runs.get(r.id))?.status).toBe(exitFailure ? 'failed' : 'succeeded');
    },
  );
});
