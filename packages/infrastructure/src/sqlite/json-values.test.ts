import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { JsonValue, RunRecord } from '@graphgoblin/contracts';
import { fakeUlid, FIXTURE_TS, samplePin, sampleThread } from '@graphgoblin/contracts/testing';
import { FakeClock } from '@graphgoblin/engine/testing';
import { openDatabase, type DatabaseHandle } from './db.js';
import { SqliteRunRepository } from './runs.js';
import { SqliteSettings } from './settings.js';
import { SqliteInboundEvents } from './triggers.js';

const handles: DatabaseHandle[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const handle of handles.splice(0)) handle.close();
  global.gc?.();
  for (const dir of directories.splice(0))
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const values: { name: string; value: JsonValue | undefined }[] = [
  { name: 'absent', value: undefined },
  { name: 'null', value: null },
  { name: 'false', value: false },
  { name: 'zero', value: 0 },
  { name: 'empty string', value: '' },
  { name: 'array', value: [] },
  { name: 'object', value: {} },
  { name: 'nested null', value: { inner: null } },
];

async function database() {
  const dir = await mkdtemp(join(tmpdir(), 'gg-json-values-'));
  directories.push(dir);
  const url = `file:${join(dir, 'store.db').replaceAll('\\', '/')}`;
  const handle = openDatabase({ url });
  handles.push(handle);
  await handle.migrate();
  return {
    handle,
    reopen: async () => {
      handle.close();
      const next = openDatabase({ url });
      handles.push(next);
      await next.migrate();
      return next;
    },
  };
}

function record(id: string, result: JsonValue | undefined): RunRecord {
  return {
    id: fakeUlid(id),
    ownerId: 'local',
    loopId: fakeUlid('loop'),
    versionId: fakeUlid('version'),
    pinned: samplePin(),
    invocationId: fakeUlid('invocation'),
    status: 'queued',
    iteration: 1,
    createdAt: FIXTURE_TS,
    lastEventSeq: 0,
    ...(result !== undefined ? { result } : {}),
  };
}

describe('JSON values in real SQLite', () => {
  it.each(values)(
    'preserves $name on create, update, transition and reopen',
    async ({ name, value }) => {
      const { handle, reopen } = await database();
      const repo = new SqliteRunRepository(handle.db);
      const created = record(`create:${name}`, value);
      const updated = record(`update:${name}`, 'previous');
      const transitioned = record(`transition:${name}`, 'previous');
      await repo.create(created, sampleThread());
      await repo.create(updated, sampleThread());
      await repo.create(transitioned, sampleThread());
      await repo.update(updated.id, { result: value });
      await repo.transition(transitioned.id, ['queued'], { result: value });
      const verify = async (reader: SqliteRunRepository) => {
        for (const run of [created, updated, transitioned]) {
          const stored = await reader.get(run.id);
          expect(stored?.result).toEqual(value);
          expect(Object.hasOwn(stored!, 'result')).toBe(value !== undefined);
        }
      };
      await verify(repo);
      await verify(new SqliteRunRepository((await reopen()).db));
    },
  );

  it.each(['update', 'transition'] as const)(
    'rejects an invalid %s without changing prior values',
    async (method) => {
      const { handle, reopen } = await database();
      const repo = new SqliteRunRepository(handle.db);
      const run = record('invalid', { previous: null });
      await repo.create(run, sampleThread());
      const changes = { result: null, iteration: 0 };
      await expect(
        method === 'update'
          ? repo.update(run.id, changes)
          : repo.transition(run.id, ['queued'], changes),
      ).rejects.toThrow();
      expect(await repo.get(run.id)).toEqual(run);
      await expect(repo.update(run.id, { result: Number.NaN })).rejects.toThrow();
      expect(await repo.get(run.id)).toEqual(run);
      expect(await new SqliteRunRepository((await reopen()).db).get(run.id)).toEqual(run);
    },
  );

  it('preserves nested null and falsy values in optional object columns and thread snapshots', async () => {
    const { handle, reopen } = await database();
    const repo = new SqliteRunRepository(handle.db);
    const run = {
      ...record('nested', null),
      waiting: {
        nodeId: 'w',
        kind: 'input' as const,
        prompt: '',
        beat: 0,
        inputSchema: { const: null },
        waitId: 'fixture-wait',
        startedSeq: 1,
      },
      failure: { code: 'INTERNAL_ERROR' as const, message: '', resumable: false, details: null },
    };
    const thread = sampleThread();
    thread.vars = { nil: null, no: false, zero: 0, empty: '', array: [], object: {} };
    thread.invocation.trigger.payload = null;
    await repo.create(run, thread);
    const snapshot = { ...thread, vars: { ...thread.vars, changed: null } };
    await repo.saveThread(run.id, snapshot, 0);
    expect(await repo.get(run.id)).toEqual(run);
    const reader = new SqliteRunRepository((await reopen()).db);
    expect(await reader.get(run.id)).toEqual(run);
    expect(await reader.getInitialThread(run.id)).toEqual(thread);
    expect(await reader.getThreadCheckpoint(run.id)).toEqual({ thread: snapshot, seq: 0 });
    await reader.update(run.id, { waiting: undefined, failure: undefined });
    const cleared = await reader.get(run.id);
    expect(Object.hasOwn(cleared!, 'waiting')).toBe(false);
    expect(Object.hasOwn(cleared!, 'failure')).toBe(false);
    expect(cleared?.result).toBeNull();
  });

  it('preserves all accepted settings and inbound payload values across reopen', async () => {
    const { handle, reopen } = await database();
    const settings = new SqliteSettings(handle.db, new FakeClock());
    const inbound = new SqliteInboundEvents(handle.db);
    expect(await settings.get('local', 'absent')).toBeUndefined();
    for (const { name, value } of values) {
      if (value === undefined) continue;
      await settings.set('local', name, value);
      await inbound.insert({
        id: fakeUlid(name),
        ownerId: 'local',
        type: 'test',
        payload: value,
        source: 'api',
        receivedAt: FIXTURE_TS,
        runIds: [],
      });
      expect(await settings.get('local', name)).toEqual(value);
      expect((await inbound.get(fakeUlid(name)))?.payload).toEqual(value);
    }
    const next = await reopen();
    const reader = new SqliteSettings(next.db, new FakeClock());
    const all = await reader.getAll('local');
    for (const { name, value } of values) {
      expect(await reader.get('local', name)).toEqual(value);
      if (value === undefined) continue;
      expect(all[name]).toEqual(value);
      expect((await new SqliteInboundEvents(next.db).get(fakeUlid(name)))?.payload).toEqual(value);
    }
    await expect(reader.set('local', 'null', Number.NaN)).rejects.toThrow();
    expect(await reader.get('local', 'null')).toBeNull();
    expect(await reader.delete('local', 'null')).toBe(true);
    expect(await reader.get('local', 'null')).toBeUndefined();
  });
});
