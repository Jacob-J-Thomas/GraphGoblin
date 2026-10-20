/**
 * The startup guard and stored definitions that predate ADR-0044 (#242). An exit that still
 * publishes an Event is a per-loop condition (refused with LOOP_UPGRADE_REQUIRED where the
 * definition is served or run), not a store-format refusal; anything else outside the current
 * contract still stops startup. The guard never rewrites the stored row.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { openMemoryDatabase, type DatabaseHandle } from './db.js';
import { SqliteLoopRepository } from './loops.js';
import { guardDatabaseUpgrade } from './upgrade.js';

const handles: DatabaseHandle[] = [];
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
});

let next = 0;
const ids = { next: () => `01M3Y7RKG0${String(++next).padStart(16, '0')}` };
const clock = { now: () => new Date('2026-10-20T12:00:00.000Z') };

/** A store with one published loop whose stored exit JSON is replaced by `exit`. */
async function storeWithExit(exit: unknown) {
  const handle = await openMemoryDatabase();
  handles.push(handle);
  const loops = new SqliteLoopRepository(handle.db, clock, ids);
  const { loop } = await loops.create('local', LoopDefinitionSchema.parse(minimalLoop()));
  const version = (await loops.publish(loop.id))!;
  const stored = JSON.stringify({
    ...version.definition,
    nodes: [version.definition.nodes[0], exit],
  });
  await handle.client.execute({
    sql: 'UPDATE loop_versions SET definition = ? WHERE id = ?',
    args: [stored, version.id],
  });
  const read = async () =>
    (
      await handle.client.execute({
        sql: 'SELECT definition FROM loop_versions WHERE id = ?',
        args: [version.id],
      })
    ).rows[0]?.['definition'];
  return { handle, stored, read };
}

const exitWith = (destinations: unknown[], extra: Record<string, unknown> = {}) => ({
  id: 'done',
  kind: 'exit',
  label: 'Done',
  config: { outcome: 'success', returns: '1', destinations, ...extra },
});

describe('startup guard and retired Event destinations (#242)', () => {
  it('lets a store start when a definition departs from the contract only by Event destinations', async () => {
    const { handle, stored, read } = await storeWithExit(
      exitWith([{ kind: 'caller' }, { kind: 'event', eventType: 'loop-done' }]),
    );
    expect(await guardDatabaseUpgrade(handle.client)).toBe('current');
    // Nothing is stripped or rewritten.
    expect(await read()).toBe(stored);
  });

  it.each([
    ['another invalid field beside it', exitWith([{ kind: 'event', eventType: 'x' }], { bad: 1 })],
    ['an invalid destination of another kind', exitWith([{ kind: 'queue' }])],
    [
      'an Event destination with an unknown field',
      exitWith([{ kind: 'event', eventType: 'x', y: 1 }]),
    ],
  ])('still refuses the store for %s', async (_name, exit) => {
    const { handle } = await storeWithExit(exit);
    await expect(guardDatabaseUpgrade(handle.client)).rejects.toMatchObject({
      code: 'DATA_UPGRADE_REQUIRED',
      message: expect.stringContaining('not strict current format'),
    });
  });

  it('still refuses a stored definition that is not JSON', async () => {
    const handle = await openMemoryDatabase();
    handles.push(handle);
    const loops = new SqliteLoopRepository(handle.db, clock, ids);
    const { loop } = await loops.create('local', LoopDefinitionSchema.parse(minimalLoop()));
    await handle.client.execute({
      sql: 'UPDATE loop_versions SET definition = ? WHERE loop_id = ?',
      args: ['{broken', loop.id],
    });
    await expect(guardDatabaseUpgrade(handle.client)).rejects.toMatchObject({
      code: 'DATA_UPGRADE_REQUIRED',
    });
  });
});
