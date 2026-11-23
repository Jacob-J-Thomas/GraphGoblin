// QA helper for GraphGoblin #434: seed one disposable, real current-format store with the
// checkout's own built infrastructure (openDatabase + migrate), in a child process so libsql's
// native handles close on exit. Mirrors apps/api/src/reset/__fixtures__/seed-stores.ts: the
// database and its WAL are copied while the connection is open, as a stopped server can leave it.
// Usage: node seed-store.mjs <checkout> <stagingDir> <targetDir> <runId>[,<runId>...]
import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [checkout, staging, target, ids] = process.argv.slice(2);
if (!checkout || !staging || !target || !ids) {
  process.stderr.write('usage: seed-store.mjs <checkout> <staging> <target> <runIds>\n');
  process.exit(2);
}
const { openDatabase } = await import(
  pathToFileURL(join(checkout, 'packages', 'infrastructure', 'dist', 'sqlite', 'index.js')).href
);
await mkdir(staging, { recursive: true });
await mkdir(target, { recursive: true });
const handle = openDatabase({ url: pathToFileURL(join(staging, 'graphgoblin.db')).href });
await handle.migrate();
for (const id of ids.split(','))
  await handle.client.execute({
    sql: 'INSERT INTO runs (id, owner_id, loop_id, version_id, invocation_id, status, iteration, created_at, initial_thread) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    args: [id, 'local', 'loop', 'version', `invocation-${id}`, 'succeeded', 1, '2026-11-19T00:00:00.000Z', '{}'],
  });
for (const name of ['graphgoblin.db', 'graphgoblin.db-wal'])
  await copyFile(join(staging, name), join(target, name));
process.stdout.write('seeded', () => process.exit(0));
