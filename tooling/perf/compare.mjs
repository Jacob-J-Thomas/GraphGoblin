/* global process */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dependency } from './common.mjs';
import { equivalence } from './equivalence.mjs';

// Use --experimental-import-meta-resolve, like measure.mjs. All store access is read-only.
const { openReadOnlyDatabaseClient, databaseView, SqliteRunRepository, SqliteEventStore } =
  await dependency('@graphgoblin/infrastructure/sqlite');
const { reconcileThread, stableStringify } = await dependency('@graphgoblin/domain');
const [beforePath, afterPath, output] = process.argv.slice(2);
if (!output)
  throw new Error(
    'Usage: node --experimental-import-meta-resolve tooling/perf/compare.mjs before-raw-summary.json after-raw-summary.json output.json',
  );
const records = await Promise.all(
  [beforePath, afterPath].map(async (path) => JSON.parse(await readFile(path, 'utf8'))),
);
async function capture(record, entry) {
  const client = openReadOnlyDatabaseClient(join(record.dataDir, 'graphgoblin.db'));
  try {
    const db = databaseView(client);
    const runs = new SqliteRunRepository(db);
    const events = new SqliteEventStore(db, { now: () => new Date(0) });
    const run = await runs.get(entry.runId);
    const initial = await runs.getInitialThread(entry.runId);
    const checkpoint = await runs.getThreadCheckpoint(entry.runId);
    const observed = equivalence();
    const history = [],
      normalized = [];
    let cursor = 0;
    for (;;) {
      const page = await events.read(entry.runId, cursor, 256);
      if (!page.length) break;
      for (const event of page) {
        if (event.seq !== ++cursor) throw new Error('Stored sequence gap');
        history.push(event);
        normalized.push(observed.event(event));
      }
    }
    const thread = reconcileThread(initial, history, checkpoint);
    const replayMatchesCheckpoint =
      stableStringify(thread) === stableStringify(reconcileThread(initial, history));
    return {
      digest: observed.finish(thread, run),
      normalized,
      count: cursor,
      replayMatchesCheckpoint,
    };
  } finally {
    client.close();
  }
}
const cases = [];
for (let index = 0; index < records[0].cases.length; index++) {
  const entries = records.map((record) => record.cases[index]);
  if (
    entries.some((entry) => !entry) ||
    entries[0].specification.passes !== entries[1].specification.passes
  )
    throw new Error('Workload size mismatch');
  const captures = [];
  for (let side = 0; side < 2; side++) captures.push(await capture(records[side], entries[side]));
  const [before, after] = captures;
  const mismatch = before.normalized.findIndex(
    (event, i) => JSON.stringify(event) !== JSON.stringify(after.normalized[i]),
  );
  cases.push({
    passes: entries[0].specification.passes,
    events: before.count,
    before: before.digest,
    after: after.digest,
    replayMatchesCheckpoint: [before.replayMatchesCheckpoint, after.replayMatchesCheckpoint],
    equal:
      before.replayMatchesCheckpoint &&
      after.replayMatchesCheckpoint &&
      before.count === after.count &&
      before.digest.eventsSha256 === after.digest.eventsSha256 &&
      before.digest.stateSha256 === after.digest.stateSha256,
    ...(mismatch < 0
      ? {}
      : {
          firstDifference: {
            seq: mismatch + 1,
            before: before.normalized[mismatch],
            after: after.normalized[mismatch],
          },
        }),
  });
}
await writeFile(output, JSON.stringify({ cases }, null, 2) + '\n');
if (cases.some((entry) => !entry.equal)) process.exitCode = 1;
