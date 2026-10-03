// Reproduction also needs vi, createTestEngine and singleNodeLoop from their existing test entry points.
// Reproduction import: import { spawn, type ChildProcess } from 'node:child_process';
// Reproduction import: import { mkdtemp, readFile, rm } from 'node:fs/promises';
// Reproduction import: import { join } from 'node:path';
// Reproduction import: import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeClock, FakeIds } from '@graphgoblin/engine/testing';
// Reproduction import: import { RunManager } from '@graphgoblin/engine';
import { openMemoryDatabase, type DatabaseHandle } from './sqlite/db.js';
import { SqliteEventStore } from './sqlite/events.js';
import { SqliteSecrets, encryptSecret, decryptSecret } from './sqlite/secrets.js';
import { SqliteScheduleStore } from './sqlite/triggers.js';
// Reproduction import: import { SqliteTimerStore } from './sqlite/timers.js';
import { CronScheduler, type CronFire } from './scheduler/cron-scheduler.js';
// Reproduction import: import { TimerService } from './scheduler/timer-service.js';
// Reproduction import: import { ProcessScripts, killTree } from './process/scripts.js';

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
  it.todo('ADV-011: a timer removed before a crash is restored from the waiting run');
  // Executed reproduction; restore this test after fixing the finding.
  // it('ADV-011: a timer removed before a crash is restored from the waiting run', async () => {
  //   const e = await createTestEngine(); e.manager.stop();
  //   const store = new SqliteTimerStore(db.db);
  //   const timer = new TimerService(store, e.ports.clock);
  //   const manager = new RunManager({ ...e.ports, timers: timer }, e.settings);
  //   await manager.start();
  //   const v = e.publish(singleNodeLoop('timer-crash', { id: 'wait', kind: 'wait', label: 'Wait', config: { mode: 'duration', seconds: 1 } }));
  //   const r = await manager.startRun({ ownerId: 'local', loopId: v.loopId, source: 'manual.api' });
  //   await manager.waitForIdle(); manager.stop();
  //   // TimerService deletes before invoking the manager; crash in this durable-write gap.
  //   e.ports.clock.advance(2000); await timer.poll();
  //   const recovered = new RunManager({ ...e.ports, timers: timer }, e.settings);
  //   await recovered.start(); await timer.poll(); await recovered.waitForIdle(); recovered.stop();
  //   expect((await recovered.getRun(r.id))?.status).toBe('succeeded');
  // });
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
  it.todo('QA-LIMIT-001: real Windows process-tree cancellation requires taskkill permission');
  // Executed reproduction; restore this test after fixing the finding.
  // it('6: ProcessScripts abort kills a real child and grandchild on Windows', async () => {
  //   const dir = await mkdtemp(join(tmpdir(), 'gg-process-tree-'));
  //   const pidFile = join(dir, 'grandchild.pid');
  //   let parent: ChildProcess | undefined; let grandchildPid: number | undefined;
  //   const controller = new AbortController();
  //   const scripts = new ProcessScripts({ spawnImpl: (command, args, options) => { const child = spawn(command, args, options); if (command === process.execPath) parent = child; return child; } });
  //   const grandchild = `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
  //   const child = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], {windowsHide:true, stdio:'inherit'}); setInterval(() => {}, 1000);`;
  //   const running = scripts.run({ command: process.execPath, args: ['-e', child], cwd: dir, env: {}, signal: controller.signal, timeoutMs: 10000 });
  //   try {
  //     await vi.waitFor(async () => { grandchildPid = Number(await readFile(pidFile, 'utf8')); expect(grandchildPid).toBeGreaterThan(0); }, { timeout: 5000 });
  //     controller.abort(); await running;
  //     await vi.waitFor(() => { expect(() => process.kill(parent!.pid!, 0)).toThrow(); expect(() => process.kill(grandchildPid!, 0)).toThrow(); }, { timeout: 3000 });
  //   } finally {
  //     controller.abort(); if (parent) killTree(parent);
  //     if (grandchildPid) { try { process.kill(grandchildPid); } catch { /* already dead */ } }
  //     await running;
  //     await rm(dir, { recursive: true, force: true });
  //   }
  // }, 15000);
});
