import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LoopDefinitionSchema,
  RunFailureSchema,
  WaitSpecSchema,
  ProgressItemSchema,
} from '@graphgoblin/contracts';
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
            failure: { code: 'EVENT_INVALID', resumable: false, nodeId: 'work' },
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
    expect(record).toMatchObject({
      status: 'failed',
      failure: { code: 'HARNESS_DELIVERY_UNCERTAIN' },
    });
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
    const itemIdBound = ProgressItemSchema.options[0].shape.id.maxLength!;
    t.fake.harness.script([
      {
        items: [{ id: 'x'.repeat(itemIdBound + 1), type: 'message', summary: 'oversized item id' }],
      },
    ]);
    const run = await t.start(await t.publish('inference', { prompt: { template: 'hello' } }));
    await t.manager.waitForIdle();
    expect(await t.runs.get(run.id)).toMatchObject({ status: 'failed' });
    expect(t.fake.harness.started).toHaveLength(1);
    const before = await t.events.read(run.id);
    t.manager.stop();
    handle.close();
    handles.splice(handles.indexOf(handle), 1);
    const reopened = await fixture(openDatabase({ url }));
    await reopened.manager.start();
    await reopened.manager.waitForIdle();
    expect(await reopened.events.read(run.id)).toEqual(before);
    expect(reopened.fake.harness.started).toHaveLength(0);
    expect(reopened.fake.harness.resumed).toHaveLength(0);
    expect(await reopened.runs.get(run.id)).toMatchObject({
      status: 'failed',
      failure: { code: 'EVENT_INVALID' },
    });
  });

  it.each([
    'json',
    'schema',
    'row',
    'row-schema',
    'snapshot',
    'snapshot-schema',
    'initial-schema',
    'terminal',
  ])('recovers healthy queued work beside unreadable %s history', async (damage) => {
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
    if (damage === 'initial-schema')
      await t.handle.client.execute({
        sql: 'UPDATE runs SET initial_thread = ? WHERE id = ?',
        args: ['{}', bad.id],
      });
    else if (damage === 'snapshot' || damage === 'snapshot-schema')
      await t.handle.client.execute({
        sql: 'UPDATE runs SET thread_snapshot = ?, thread_snapshot_seq = 1 WHERE id = ?',
        args: [damage === 'snapshot' ? '{broken' : '{}', bad.id],
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
  });

  it.each(['get', 'listChildren', 'transition', 'update', 'claimCancel'] as const)(
    'attributes damaged JSON to its run through %s',
    async (reader) => {
      const t = await fixture();
      t.manager.stop();
      const run = await t.start(await t.publish('wait', { mode: 'input', prompt: 'hello' }));
      await t.runs.update(run.id, { parentRunId: run.id });
      await t.handle.client.execute({
        sql: 'UPDATE runs SET failure = ? WHERE id = ?',
        args: ['{broken', run.id],
      });
      const read = () => {
        switch (reader) {
          case 'get':
            return t.runs.get(run.id);
          case 'listChildren':
            return t.runs.listChildren(run.id);
          case 'transition':
            return t.runs.transition(run.id, ['queued'], { iteration: 2 });
          case 'update':
            return t.runs.update(run.id, { iteration: 2 });
          case 'claimCancel':
            return t.runs.claimCancel(run.id, ['queued'], t.fake.clock.now().toISOString());
        }
      };
      await expect(read()).rejects.toMatchObject({
        name: 'UnreadableRunHistoryError',
        code: 'HISTORY_UNREADABLE',
        runId: run.id,
      });
    },
  );

  it('recovers healthy work beside a cancel-requested parent with a damaged child row', async () => {
    const t = await fixture();
    t.manager.stop();
    const loopId = await t.publish('wait', { mode: 'input', prompt: 'healthy' });
    const parent = await t.start(loopId);
    const child = await t.start(loopId);
    const healthy = await t.start(loopId);
    await t.runs.update(child.id, { parentRunId: parent.id });
    await t.runs.claimCancel(parent.id, ['queued'], t.fake.clock.now().toISOString());
    await t.handle.client.execute({
      sql: 'UPDATE runs SET waiting = ? WHERE id = ?',
      args: ['{broken', child.id],
    });
    await expect(t.manager.start()).resolves.toBeUndefined();
    await t.manager.waitForIdle();
    expect(await t.runs.get(healthy.id)).toMatchObject({ status: 'waiting' });
    expect(t.fake.logger.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          obj: expect.objectContaining({ runId: child.id, code: 'HISTORY_UNREADABLE' }),
        }),
      ]),
    );
  });

  it('reads metadata without touching damaged thread snapshots, but isolates them at recovery', async () => {
    const t = await fixture();
    t.manager.stop();
    const run = await t.start(await t.publish('wait', { mode: 'input', prompt: 'hello' }));
    await t.handle.client.execute({
      sql: 'UPDATE runs SET thread_snapshot = ? WHERE id = ?',
      args: ['{}', run.id],
    });
    await expect(t.runs.get(run.id)).resolves.toMatchObject({ id: run.id, status: 'queued' });
    await t.manager.start();
    await t.manager.waitForIdle();
    expect(t.fake.logger.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          obj: expect.objectContaining({
            runId: run.id,
            code: 'HISTORY_UNREADABLE',
            reason: expect.stringContaining('thread_snapshot'),
          }),
        }),
      ]),
    );
    expect(await t.runs.get(run.id)).toMatchObject({ status: 'queued' });
  });

  it('maps only named run fields when storage adds an internal column', async () => {
    const t = await fixture();
    t.manager.stop();
    const run = await t.start(await t.publish('wait', { mode: 'input', prompt: 'hello' }));
    await t.handle.client.execute(
      "ALTER TABLE runs ADD COLUMN internal_diagnostic TEXT DEFAULT '{broken'",
    );
    await expect(t.runs.get(run.id)).resolves.toMatchObject({ id: run.id, status: 'queued' });
    await expect(t.runs.list({ status: ['queued'] })).resolves.toHaveLength(1);
    await expect(t.runs.listRunReferences([])).resolves.toEqual([]);
  });
});
