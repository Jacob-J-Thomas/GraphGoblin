import { join } from 'node:path';
import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import { FakeClock, FakeIds } from '@graphgoblin/engine/testing';
import { SqliteLoopRepository } from '@graphgoblin/infrastructure/sqlite';
import { openStoreBefore } from '@graphgoblin/infrastructure/sqlite/testing';

export interface StoredLoopBefore {
  /** The store's libsql URL, for `GG_DB_URL`: starting the gateway on it applies `tag` onwards. */
  url: string;
  loopId: string;
  draftId: string;
}

/**
 * Saves a loop the way a gateway from before migration `tag` stored it: in a genuine store
 * migrated only that far, with `remove` (JSON paths) deleted from the saved draft. Starting a
 * gateway on `url` then upgrades it through every later shipped migration.
 */
export async function storeLoopBefore(options: {
  dataDir: string;
  tag: string;
  /** Parsed as the current definition contract before it is saved. */
  definition: unknown;
  publish: boolean;
  remove: string[];
}): Promise<StoredLoopBefore> {
  const url = 'file:' + join(options.dataDir, 'graphgoblin.db').replaceAll('\\', '/');
  const handle = await openStoreBefore(url, options.tag);
  try {
    const loops = new SqliteLoopRepository(handle.db, new FakeClock(), new FakeIds());
    const { loop, draft } = await loops.create(
      'local',
      LoopDefinitionSchema.parse(options.definition),
    );
    if (options.publish) await loops.publish(loop.id);
    for (const path of options.remove)
      await handle.client.execute({
        sql: 'UPDATE loop_versions SET definition = json_remove(definition, ?) WHERE id = ?',
        args: [path, draft.id],
      });
    return { url, loopId: loop.id, draftId: draft.id };
  } finally {
    handle.close();
  }
}
