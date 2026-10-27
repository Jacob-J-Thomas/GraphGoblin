import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import { FIXTURE_TS, minimalLoop, samplePin, sampleThread } from '@graphgoblin/contracts/testing';
import { reconcileThread, replayStateAt } from '@graphgoblin/domain';
import { RunManager, type EventStorePort } from '@graphgoblin/engine';
import { createFakePorts, DEFAULT_TEST_SETTINGS } from '@graphgoblin/engine/testing';
import { openDatabase } from './db.js';
import { SqliteEventStore } from './events.js';
import { SqliteRunRepository } from './runs.js';

it('migrates shipped snapshots without inventing state, then persists checkpoint proof across reopen', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gg-wp-g1-116-migration-'));
  const folder = join(dir, 'migrations');
  await mkdir(join(folder, 'meta'), { recursive: true });
  const shipped = fileURLToPath(new URL('../../drizzle/', import.meta.url));
  const journal = JSON.parse(await readFile(join(shipped, 'meta/_journal.json'), 'utf8')) as {
    entries: { idx: number; tag: string }[];
  };
  const shippedCount = journal.entries.length;
  journal.entries = journal.entries.filter((entry) => entry.idx < 18);
  await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(journal));
  for (const entry of journal.entries)
    await copyFile(join(shipped, entry.tag + '.sql'), join(folder, entry.tag + '.sql'));
  const url = 'file:' + join(dir, 'store.db').replaceAll('\\', '/');
  const old = openDatabase({ url, migrationsFolder: folder });
  const initial = sampleThread({ vars: {} });
  const id = initial.run.id;
  await old.migrate();
  try {
    await old.client.execute({
      sql: "INSERT INTO loop_versions (id, loop_id, version, status, definition, created_at) VALUES (?, ?, 1, 'published', ?, ?)",
      args: [
        initial.run.versionId,
        initial.run.loopId,
        JSON.stringify(LoopDefinitionSchema.parse(minimalLoop())),
        FIXTURE_TS,
      ],
    });
    await old.client.execute({
      sql: "INSERT INTO runs (id, owner_id, loop_id, version_id, invocation_id, status, iteration, created_at, initial_thread, pinned) VALUES (?, 'local', ?, ?, ?, 'queued', 1, ?, ?, ?)",
      args: [
        id,
        initial.run.loopId,
        initial.run.versionId,
        initial.invocation.id,
        FIXTURE_TS,
        JSON.stringify(initial),
        JSON.stringify(samplePin()),
      ],
    });
    const store = new SqliteEventStore(old.db, createFakePorts().clock);
    await store.append(id, [
      { type: 'node.started', nodeId: 'a', kind: 'mutate', attempt: 1, configHash: '0'.repeat(64) },
      {
        type: 'node.finished',
        nodeId: 'a',
        durationMs: 1,
        patch: [{ op: 'add', path: '/vars/items', value: ['a'] }],
      },
      { type: 'node.started', nodeId: 'b', kind: 'mutate', attempt: 1, configHash: '0'.repeat(64) },
      {
        type: 'node.finished',
        nodeId: 'a',
        durationMs: 1,
        patch: [{ op: 'add', path: '/vars/items/-', value: 'duplicate' }],
      },
    ]);
    const prefix = await store.read(id);
    const seq = prefix.at(-1)!.seq;
    const snapshot = reconcileThread(initial, prefix);
    await old.client.execute({
      sql: 'UPDATE runs SET thread_snapshot = ?, thread_snapshot_seq = ? WHERE id = ?',
      args: [JSON.stringify(snapshot), seq, id],
    });
    await store.append(id, [
      {
        type: 'node.finished',
        nodeId: 'b',
        durationMs: 1,
        patch: [{ op: 'add', path: '/vars/items/-', value: 'b' }],
      },
    ]);
  } finally {
    old.close();
  }
  const current = openDatabase({ url });
  try {
    // Every migration from 0018 on is pending, however many have shipped since.
    expect(await current.pendingMigrations()).toBe(shippedCount - 18);
    const before = (
      await current.client.execute(
        'SELECT initial_thread, thread_snapshot, thread_snapshot_seq FROM runs',
      )
    ).rows;
    await current.migrate();
    await current.migrate();
    expect(await current.pendingMigrations()).toBe(0);
    expect(
      (
        await current.client.execute(
          'SELECT initial_thread, thread_snapshot, thread_snapshot_seq FROM runs',
        )
      ).rows,
    ).toEqual(before);
    expect(
      (await current.client.execute('SELECT thread_snapshot_replay_state FROM runs')).rows[0]?.[
        'thread_snapshot_replay_state'
      ],
    ).toBeNull();
    const runs = new SqliteRunRepository(current.db);
    const fake = createFakePorts();
    const store = new SqliteEventStore(current.db, fake.clock);
    const reads: { after: number; rows: number }[] = [];
    const events: EventStorePort = {
      append: (...args) => store.append(...args),
      subscribe: (...args) => store.subscribe(...args),
      recoveryFacts: (...args) => store.recoveryFacts(...args),
      async read(runId, after = 0, limit) {
        const result = await store.read(runId, after, limit);
        reads.push({ after, rows: result.length });
        return result;
      },
    };
    const reader = new RunManager({ ...fake, runs, events }, DEFAULT_TEST_SETTINGS);
    const history = await store.read(id);
    const expected = reconcileThread(initial, history);
    const checkpoint = (await runs.getThreadCheckpoint(id))!;
    expect(checkpoint.replayState).toBeUndefined();
    const bytes = async () =>
      JSON.stringify((await current.client.execute('SELECT * FROM runs')).rows);
    const previous = await bytes();
    expect((await reader.getThread(id))?.vars.items).toEqual(['a', 'b']);
    expect(reads).toEqual([{ after: 0, rows: history.length }]);
    expect(await bytes()).toBe(previous);
    await runs.saveThread(
      id,
      checkpoint.thread,
      checkpoint.seq,
      replayStateAt(history, checkpoint.seq),
    );
    reads.length = 0;
    expect(await reader.getThread(id)).toEqual(expected);
    expect(reads).toEqual([{ after: checkpoint.seq - 1, rows: 2 }]);
  } finally {
    current.close();
  }
  const reopened = openDatabase({ url });
  try {
    const repository = new SqliteRunRepository(reopened.db);
    const checkpoint = (await repository.getThreadCheckpoint(id))!;
    expect(checkpoint.replayState).toEqual({ openNodeId: 'b', strict: true });
    // A read bounded before the checkpoint leaves it undecoded, so its damage cannot fail it.
    expect(await repository.getThreadCheckpoint(id, checkpoint.seq)).toEqual(checkpoint);
    await reopened.client.execute({
      sql: 'UPDATE runs SET thread_snapshot = ? WHERE id = ?',
      args: ['{invalid-json', id],
    });
    expect(await repository.getThreadCheckpoint(id, checkpoint.seq - 1)).toBeUndefined();
    await expect(repository.getThreadCheckpoint(id, checkpoint.seq)).rejects.toThrow(
      'thread_snapshot',
    );
  } finally {
    reopened.close();
  }
});
