// Child-process fixture for the reset tests: seed disposable real SQLite stores and exit, so the
// process exit releases libsql's native file handles before the tests copy and remove the files.
// Usage: node --import tsx --conditions=development seed-stores.ts <root>
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openDatabase } from '@graphgoblin/infrastructure/sqlite';
import { SEEDED_RUN_IDS } from './stores.js';

async function seed(directory: string, change?: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  const handle = openDatabase({ url: pathToFileURL(join(directory, 'graphgoblin.db')).href });
  await handle.migrate();
  for (const id of SEEDED_RUN_IDS)
    await handle.client.execute({
      sql: 'INSERT INTO runs (id, owner_id, loop_id, version_id, invocation_id, status, iteration, created_at, initial_thread) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      args: [
        id,
        'local',
        'loop',
        'version',
        `invocation-${id}`,
        'succeeded',
        1,
        '2026-10-18T00:00:00.000Z',
        '{}',
      ],
    });
  if (change) await handle.client.execute(change);
  handle.close();
}

const root = process.argv[2];
if (root === undefined) throw new Error('usage: seed-stores.ts <root>');
await seed(join(root, 'current'));
// Synthesized older stores: a format-3 marker, and no marker at all (written before markers).
await seed(join(root, 'format-3'), 'UPDATE gg_upgrade_state SET format_version = 3');
await seed(join(root, 'unmarked'), 'DROP TABLE gg_upgrade_state');
await mkdir(join(root, 'corrupt'), { recursive: true });
await writeFile(join(root, 'corrupt', 'graphgoblin.db'), 'this is not a SQLite database');
// Exit at once, as a stopped server does: the committed rows stay in each store's WAL, which a
// reset must count as part of the database.
process.stdout.write('seeded', () => process.exit(0));
