// Child-process fixture for the reset tests: seed disposable real SQLite stores and exit, so the
// process exit releases libsql's native file handles before the tests copy and remove the files.
// Usage: node --import tsx --conditions=development seed-stores.ts <root>
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openDatabase } from '@graphgoblin/infrastructure/sqlite';
import { SEEDED_RUN_IDS } from './stores.js';

/**
 * Seed a store in a staging directory and, while its connection is still open, copy the database
 * and its write-ahead log to `directory`. Whether SQLite checkpoints the WAL when a process exits
 * depends on the native driver, so the copy is what makes every seeded store deterministically a
 * database plus a WAL that holds its committed rows, as a store left by a stopped server can be.
 */
async function seed(staging: string, directory: string, change?: string): Promise<void> {
  await mkdir(staging, { recursive: true });
  await mkdir(directory, { recursive: true });
  const handle = openDatabase({ url: pathToFileURL(join(staging, 'graphgoblin.db')).href });
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
  for (const name of ['graphgoblin.db', 'graphgoblin.db-wal'])
    await copyFile(join(staging, name), join(directory, name));
}

const root = process.argv[2];
if (root === undefined) throw new Error('usage: seed-stores.ts <root>');
const staging = join(root, '.staging');
await seed(join(staging, 'current'), join(root, 'current'));
// Synthesized older stores: a format-3 marker, and no marker at all (written before markers).
await seed(
  join(staging, 'format-3'),
  join(root, 'format-3'),
  'UPDATE gg_upgrade_state SET format_version = 3',
);
await seed(join(staging, 'unmarked'), join(root, 'unmarked'), 'DROP TABLE gg_upgrade_state');
await mkdir(join(root, 'corrupt'), { recursive: true });
await writeFile(join(root, 'corrupt', 'graphgoblin.db'), 'this is not a SQLite database');
process.stdout.write('seeded', () => process.exit(0));
