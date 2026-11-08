import { join } from 'node:path';
import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import { FakeClock, FakeIds } from '@graphgoblin/engine/testing';
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
    // A historical fixture uses the original base columns, never a current repository whose
    // reads may join tables introduced by the very migrations this fixture has not run yet.
    const definition = LoopDefinitionSchema.parse(options.definition);
    const ids = new FakeIds();
    const loopId = ids.next();
    const draftId = ids.next();
    const now = new FakeClock().now().toISOString();
    await handle.client.batch(
      [
        {
          sql: 'INSERT INTO loops (id, owner_id, name, description, current_version_id, draft_version_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          args: [
            loopId,
            'local',
            definition.name,
            definition.description ?? null,
            options.publish ? draftId : null,
            options.publish ? null : draftId,
            now,
            now,
          ],
        },
        {
          sql: 'INSERT INTO loop_versions (id, loop_id, version, status, definition, created_at, published_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          args: [
            draftId,
            loopId,
            1,
            options.publish ? 'published' : 'draft',
            JSON.stringify(definition),
            now,
            options.publish ? now : null,
          ],
        },
      ],
      'write',
    );
    for (const path of options.remove)
      await handle.client.execute({
        sql: 'UPDATE loop_versions SET definition = json_remove(definition, ?) WHERE id = ?',
        args: [path, draftId],
      });
    return { url, loopId, draftId };
  } finally {
    handle.close();
  }
}
