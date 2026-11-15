// Scan-1 reviewer probe (read-only with respect to the repository): in-memory libsql only.
// Usage: node key-identity-probe.mjs <repo-root>
import { createRequire } from 'node:module';
import path from 'node:path';

const repo = process.argv[2];
const require = createRequire(path.join(repo, 'packages/infrastructure/package.json'));
const { createClient } = require('@libsql/client');

const client = createClient({ url: ':memory:' });
await client.execute('CREATE TABLE runs (id TEXT PRIMARY KEY, initial_thread TEXT NOT NULL)');
const keys = {
  ascii: 'a',
  loneHigh: 'a\uD800',
  replacement: 'a�',
  nulB: 'a\u0000b',
  nulC: 'a\u0000c',
  pair: 'a😀',
};
const ver = await client.execute('select sqlite_version() as v');
console.log(JSON.stringify({ node: process.version, sqlite: ver.rows[0].v }));
for (const [id, key] of Object.entries(keys)) {
  await client.execute({
    sql: 'INSERT INTO runs (id, initial_thread) VALUES (?, ?)',
    args: [id, JSON.stringify({ invocation: { trigger: { dedupeKey: key } } })],
  });
}
const extracted = await client.execute(
  "SELECT id, hex(json_extract(initial_thread, '$.invocation.trigger.dedupeKey')) AS h, length(json_extract(initial_thread, '$.invocation.trigger.dedupeKey')) AS len FROM runs ORDER BY id",
);
for (const row of extracted.rows) console.log(JSON.stringify({ stored: row.id, extractedHex: row.h, len: row.len }));
for (const [probe, key] of Object.entries(keys)) {
  const bound = await client.execute({ sql: 'SELECT hex(?) AS h', args: [key] });
  const matched = await client.execute({
    sql: "SELECT id FROM runs WHERE json_extract(initial_thread, '$.invocation.trigger.dedupeKey') = ? ORDER BY id",
    args: [key],
  });
  console.log(
    JSON.stringify({ lookup: probe, boundHex: bound.rows[0].h, matches: matched.rows.map((r) => r.id) }),
  );
}
client.close();
