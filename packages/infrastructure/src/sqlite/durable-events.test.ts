import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LoopDefinitionSchema, RunFailureSchema, WaitSpecSchema } from '@graphgoblin/contracts';
import { RunManager } from '@graphgoblin/engine';
import {
  createFakePorts,
  DEFAULT_TEST_SETTINGS,
  singleNodeLoop,
} from '@graphgoblin/engine/testing';
import { openDatabase, openMemoryDatabase, type DatabaseHandle } from './db.js';
import { SqliteEventStore } from './events.js';
import { SqliteRunRepository } from './runs.js';
import { SqliteLoopRepository } from './loops.js';
import { SqliteTriggerAdmission } from './admission.js';

const promptBound = WaitSpecSchema.shape.prompt.unwrap().maxLength!;
const failureBound = RunFailureSchema.shape.message.maxLength!;
const handles: DatabaseHandle[] = [];
const managers: RunManager[] = [];
afterEach(() => {
  for (const manager of managers.splice(0)) manager.stop();
  for (const handle of handles.splice(0)) handle.close();
});

async function fixture(database?: DatabaseHandle) {
  const handle = database ?? (await openMemoryDatabase());
  handles.push(handle);
  const fake = createFakePorts();
  const runs = new SqliteRunRepository(handle.db);
  const events = new SqliteEventStore(handle.db, fake.clock);
  const loops = new SqliteLoopRepository(handle.db, fake.clock, fake.ids);
  const ports = {
    ...fake,
    runs,
    events,
    loops,
    admission: new SqliteTriggerAdmission(handle.db, events),
  };
  const manager = new RunManager(ports, DEFAULT_TEST_SETTINGS);
  managers.push(manager);
  const publish = async (kind: 'wait' | 'inference', config: unknown) => {
    const created = await loops.create(
      'local',
      LoopDefinitionSchema.parse(
        singleNodeLoop(`boundary-${fake.ids.next()}`, { id: 'work', kind, label: 'Work', config }),
      ),
    );
    await loops.publish(created.loop.id);
    return created.loop.id;
  };
  const start = (loopId: string, payload: string = '') =>
    manager.startRun({
      ownerId: 'local',
      loopId,
      source: 'manual.api',
      payload,
    });
  return { handle, fake, runs, events, ports, manager, publish, start };
}

describe('generated durable event boundaries with SQLite', () => {
  it.each([false, true])(
    'records the exact prompt bound and fails one over (template=%s)',
    async (template) => {
      const t = await fixture();
      await t.manager.start();
      for (const length of [promptBound, promptBound + 1]) {
        const value = 'x'.repeat(length);
        const loopId = await t.publish('wait', {
          mode: 'input',
          prompt: template ? '{{ trigger.payload }}' : value,
        });
        const run = await t.start(loopId, value);
        await t.manager.waitForIdle();
        const record = await t.runs.get(run.id);
        if (length === promptBound) expect(record?.waiting?.prompt).toBe(value);
        else
          expect(record).toMatchObject({
            status: 'failed',
            failure: { code: 'EVENT_INVALID', resumable: false },
          });
        await expect(t.events.read(run.id)).resolves.toBeDefined();
      }
    },
  );

  it('bounds a generated harness failure without stranding a running run', async () => {
    const t = await fixture();
    await t.manager.start();
    t.fake.harness.script([
      { error: { code: 'provider_failed', message: 'failure:'.repeat(failureBound) } },
    ]);
    const run = await t.start(await t.publish('inference', { prompt: { template: 'hello' } }));
    await t.manager.waitForIdle();
    const record = await t.runs.get(run.id);
    expect(record).toMatchObject({ status: 'failed', failure: { code: 'HARNESS_TURN_FAILED' } });
    expect(record?.failure?.message.length).toBe(failureBound);
    expect(record?.failure?.message).toContain('[truncated; original ');
    await expect(t.events.read(run.id)).resolves.toBeDefined();
  });

  it('reopens an oversized-event failure without executing the node again', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gg-durable-events-'));
    const url = `file:${join(dir, 'store.db').replaceAll('\\', '/')}`;
    const handle = openDatabase({ url });
    await handle.migrate();
    const t = await fixture(handle);
    await t.manager.start();
    const run = await t.start(
      await t.publish('wait', { mode: 'input', prompt: 'x'.repeat(promptBound + 1) }),
    );
    await t.manager.waitForIdle();
    expect(await t.runs.get(run.id)).toMatchObject({ status: 'failed' });
    const before = await t.events.read(run.id);
    t.manager.stop();
    handle.close();
    handles.splice(handles.indexOf(handle), 1);
    const reopened = await fixture(openDatabase({ url }));
    await reopened.manager.start();
    await reopened.manager.waitForIdle();
    expect(await reopened.events.read(run.id)).toEqual(before);
    expect(await reopened.runs.get(run.id)).toMatchObject({
      status: 'failed',
      failure: { code: 'EVENT_INVALID' },
    });
  });

  it.each(['json', 'schema', 'row', 'row-schema', 'snapshot', 'terminal'])(
    'recovers healthy queued work beside unreadable %s history',
    async (damage) => {
      const t = await fixture();
      t.manager.stop();
      const loopId = await t.publish('wait', { mode: 'input', prompt: 'healthy' });
      const bad = await t.start(loopId);
      const healthy = await t.start(loopId);
      if (damage === 'terminal')
        await t.runs.transition(bad.id, ['queued'], {
          status: 'failed',
          failure: { code: 'INTERNAL_ERROR', message: 'previous failure', resumable: false },
        });
      if (damage === 'snapshot')
        await t.handle.client.execute({
          sql: 'UPDATE runs SET thread_snapshot = ?, thread_snapshot_seq = 1 WHERE id = ?',
          args: ['{broken', bad.id],
        });
      else if (damage === 'row-schema')
        await t.handle.client.execute({
          sql: 'UPDATE runs SET waiting = ? WHERE id = ?',
          args: ['{}', bad.id],
        });
      else if (damage === 'row')
        await t.handle.client.execute({
          sql: 'UPDATE runs SET waiting = ? WHERE id = ?',
          args: ['{broken', bad.id],
        });
      else
        await t.handle.client.execute({
          sql: 'UPDATE run_events SET payload = ? WHERE run_id = ?',
          args: [damage === 'json' ? '{broken' : '{"extra":true}', bad.id],
        });
      await expect(t.manager.start()).resolves.toBeUndefined();
      await t.manager.waitForIdle();
      expect(await t.runs.get(healthy.id)).toMatchObject({
        status: 'waiting',
        waiting: { prompt: 'healthy' },
      });
      expect(await t.events.read(healthy.id)).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'run.waiting' })]),
      );
      expect(t.fake.logger.lines).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            obj: expect.objectContaining({ runId: bad.id, code: 'HISTORY_UNREADABLE' }),
          }),
        ]),
      );
    },
  );
});
