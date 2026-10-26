/** Disposable file-backed SQLite/API measurement; no execution providers are invoked. */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { minimalLoop, sampleThread, FIXTURE_TS } from '@graphgoblin/contracts/testing';
import { createTestApp } from '../src/testing/test-app.js';

const phase = process.argv[2];
if (phase !== 'before' && phase !== 'after') throw new Error('Pass before or after.');
const directory = await mkdtemp(join(tmpdir(), 'gg-wp-g2-summary-'));
const t = await createTestApp({
  env: {
    GG_DATA_DIR: directory,
    GG_DB_URL: pathToFileURL(join(directory, 'history.db')).href,
  },
});
try {
  const names = ['older history', 'no history', 'paging runs', 'busy history'];
  const loops = [];
  for (const name of names) {
    const id = await t.publishLoop({ ...minimalLoop(), name });
    const loop = await t.container.repos.loops.getLoop(id);
    if (!loop?.currentVersionId) throw new Error('Expected a published loop.');
    loops.push({ id, versionId: loop.currentVersionId });
  }
  const [old, , paging, busy] = loops;
  const thread = JSON.stringify(sampleThread());
  const client = t.container.handle.client;
  // This connection belongs only to the fresh disposable benchmark store above.
  if (phase === 'before') await client.execute('DROP INDEX IF EXISTS runs_loop_owner_history_idx');
  const index = await client.execute(
    "SELECT name FROM sqlite_master WHERE type='index' AND name='runs_loop_owner_history_idx'",
  );
  if (index.rows.length > 0 !== (phase === 'after'))
    throw new Error('Index does not match measurement phase.');
  for (let start = 1; start <= 50_000; start += 1000) {
    await client.execute({
      sql: `WITH RECURSIVE seq(n) AS (
      SELECT ? UNION ALL SELECT n + 1 FROM seq WHERE n < ?
    ), data AS (SELECT '01M3Y7RKG0' || printf('%016d', n) AS id,
      CASE WHEN n = 1 THEN ? WHEN n <= 106 THEN ? ELSE ? END AS loop_id,
      CASE WHEN n = 1 THEN ? WHEN n <= 106 THEN ? ELSE ? END AS version_id FROM seq)
    INSERT INTO runs (id, owner_id, loop_id, version_id, invocation_id, status, iteration,
      created_at, finished_at, last_event_seq, initial_thread, thread_snapshot)
    SELECT id, 'local', loop_id, version_id, id, 'succeeded', 1, ?, ?, 0,
      json_set(?, '$.run.id', id, '$.run.loopId', loop_id, '$.run.versionId', version_id),
      json_set(?, '$.run.id', id, '$.run.loopId', loop_id, '$.run.versionId', version_id)
    FROM data`,
      args: [
        start,
        start + 999,
        old!.id,
        paging!.id,
        busy!.id,
        old!.versionId,
        paging!.versionId,
        busy!.versionId,
        FIXTURE_TS,
        FIXTURE_TS,
        thread,
        thread,
      ],
    });
  }
  async function measure() {
    const start = performance.now();
    const response = await t.app.inject('/loops');
    const elapsed = performance.now() - start;
    if (response.statusCode !== 200) throw new Error(response.body);
    const result = response.json<{ items: { runCount: number }[] }>();
    if (result.items.reduce((total, loop) => total + loop.runCount, 0) !== 50_000)
      throw new Error('Incorrect count.');
    return elapsed;
  }
  await measure();
  const samples = [];
  for (let i = 0; i < 7; i++) samples.push(await measure());
  const sorted = [...samples].sort((a, b) => a - b);
  process.stdout.write(
    JSON.stringify(
      {
        phase,
        node: process.version,
        runs: 50_000,
        loops: 4,
        distribution: [1, 0, 105, 49_894],
        threadBytes: Buffer.byteLength(thread),
        index: index.rows.length > 0,
        samplesMs: samples,
        medianMs: sorted[3],
        meanMs: samples.reduce((sum, n) => sum + n, 0) / samples.length,
        dataDirectory: directory,
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  await t.close();
}
