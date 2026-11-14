import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import { createSystemChatDefinition } from '@graphgoblin/domain';
import { fakeUlid, minimalLoop } from '@graphgoblin/contracts/testing';
import { FakeClock } from '@graphgoblin/engine/testing';
import { afterEach, expect, it } from 'vitest';
import { openDatabase, openReadOnlyDatabaseClient, type DatabaseHandle } from './db.js';
import { SqliteChatRepository } from './chat.js';
import { LoopNameConflictError } from './loop-names.js';
import { SqliteLoopRepository } from './loops.js';
import { guardCurrentStore } from './store-format.js';

const handles: DatabaseHandle[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) handle.close();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 }).catch(
      () => undefined,
    );
});

const definition = (name: string) => LoopDefinitionSchema.parse({ ...minimalLoop(), name });
function connect(file: string) {
  const handle = openDatabase({ url: 'file:' + file.replaceAll('\\', '/') });
  handles.push(handle);
  return handle;
}
function repository(handle: DatabaseHandle, prefix: string) {
  let next = 0;
  return new SqliteLoopRepository(handle.db, new FakeClock(), {
    next: () => fakeUlid(prefix + ++next),
  });
}

async function fileStore() {
  const directory = await mkdtemp(join(tmpdir(), 'gg-loop-names-'));
  directories.push(directory);
  const file = join(directory, 'names.db');
  const first = connect(file);
  await first.migrate();
  return { file, first };
}

it('uses a write transaction across connections and preserves owner scopes', async () => {
  const { file, first } = await fileStore();
  const second = connect(file);
  const one = repository(first, 'first');
  const two = repository(second, 'second');
  const held = await first.client.transaction('write');
  try {
    await expect(two.create('owner', definition('Raced name'))).rejects.toMatchObject({
      code: 'SQLITE_BUSY',
    });
  } finally {
    await held.rollback();
  }

  const firstLoop = await one.create('owner', definition('Raced  Name'));
  await expect(two.create('owner', definition(' raced\tname'))).rejects.toBeInstanceOf(
    LoopNameConflictError,
  );
  expect(await two.listLoops('owner')).toEqual([firstLoop.loop]);
  const other = await one.create('other owner', definition('raced name'));
  expect(other.loop.id).not.toBe(firstLoop.loop.id);
  expect(
    (await repository(connect(file), 'observer').listLoops('other owner')).map((loop) => loop.id),
  ).toEqual([other.loop.id]);
});

it('reports existing duplicate IDs read-only and accepts a manual repair without changing IDs', async () => {
  const { file, first } = await fileStore();
  const loops = repository(first, 'seed');
  const original = await loops.create('owner', definition('Nightly Écho'));
  const duplicate = await loops.create('owner', definition('Other'));
  await first.client.batch(
    [
      {
        sql: 'UPDATE loops SET name=? WHERE id=?',
        args: [' nightly\tÉCHO ', duplicate.loop.id],
      },
      {
        sql: "UPDATE loop_versions SET definition=json_set(definition,'$.name',?) WHERE id=?",
        args: [' nightly\tÉCHO ', duplicate.draft.id],
      },
    ],
    'write',
  );
  const readback = () => first.client.execute('SELECT id,name FROM loops ORDER BY id');
  const before = (await readback()).rows;
  const audit = openReadOnlyDatabaseClient(file);
  try {
    await expect(guardCurrentStore(audit)).rejects.toMatchObject({
      code: 'STORE_UNSUPPORTED',
      reason: expect.stringContaining(
        `Loops ${original.loop.id} and ${duplicate.loop.id} have equivalent names`,
      ),
    });
  } finally {
    audit.close();
  }
  expect((await readback()).rows).toEqual(before);
  const repaired = await loops.saveDraft(duplicate.loop.id, definition('Nightly Écho Copy'));
  expect(repaired.id).toBe(duplicate.draft.id);
  const reopened = connect(file);
  await expect(reopened.migrate()).resolves.toBeUndefined();
  const records = await repository(reopened, 'reopened').listLoops('owner');
  expect(records).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: original.loop.id, name: 'Nightly Écho' }),
      expect.objectContaining({ id: duplicate.loop.id, name: 'Nightly Écho Copy' }),
    ]),
  );
});

it('keeps an existing ordinary name when bootstrapping the system Chat loop', async () => {
  const { first } = await fileStore();
  const loops = repository(first, 'ordinary');
  const existing = await loops.create('owner', definition('GATEWAY chat'));
  const chat = new SqliteChatRepository(first.db, new FakeClock(), {
    next: (() => {
      let next = 0;
      return () => fakeUlid('gateway' + ++next);
    })(),
  });
  const gateway = createSystemChatDefinition({ name: 'Gateway chat', harness: 'codex' });
  const binding = await chat.ensureGateway('owner', gateway);
  expect(binding.loopId).not.toBe(existing.loop.id);
  expect(await chat.ensureGateway('owner', gateway)).toEqual(binding);
  expect(await loops.getLoop(existing.loop.id)).toMatchObject({ name: 'GATEWAY chat' });
  expect(await loops.getLoop(binding.loopId)).toMatchObject({ name: 'Gateway chat copy' });
  expect((await loops.getLatestPublished(binding.loopId))?.definition.name).toBe(
    'Gateway chat copy',
  );
});

it('diagnoses a legacy NUL without confusing it with valid replacement characters', async () => {
  const { file, first } = await fileStore();
  const loops = repository(first, 'legacy-text');
  const { loop } = await loops.create('owner', definition('Valid � and 🚀'));
  const audit = openReadOnlyDatabaseClient(file);
  try {
    await expect(guardCurrentStore(audit)).resolves.toBe('current');
    await first.client.execute({
      sql: 'UPDATE loops SET name=? WHERE id=?',
      args: ['Valid\u0000Hidden', loop.id],
    });
    await expect(guardCurrentStore(audit)).rejects.toMatchObject({
      code: 'STORE_UNSUPPORTED',
      reason: expect.stringContaining(`Loop ${loop.id} has a NUL`),
    });
  } finally {
    audit.close();
  }
});
