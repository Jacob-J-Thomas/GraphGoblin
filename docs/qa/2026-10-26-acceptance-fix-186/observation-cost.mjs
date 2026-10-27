// #186 review round 1, finding 1: cost of GET /runs/{id}/observation on an ungated cyclic loop as
// its history grows. Adapted from the PR #418 review probe (observation-cost.mjs in its evidence):
// an accepted ungated cycle runs past 500 events and is paused; the stopped store is then extended
// with copies of its stored ungated decision (synthetic history, so the decision count grows
// without waiting for execution), and the built API reads /observation nine times per size.
// Also records SQLite's plan for the latest-gate lookup and how many rows each partial index holds.
//
// usage: node observation-cost.mjs <label>   (writes observation-cost-<label>.json and .log.txt)
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { makeTemp, removeTemp, startApi, restClient, cycle, until, logger, HERE, ROOT } from './lib.mjs';

const label = process.argv[2];
if (!label) throw new Error('usage: node observation-cost.mjs <label>');
const PORT = 6514;
const log = logger(`observation-cost-${label}.log.txt`);
const dataDir = await makeTemp('obs');
const require = createRequire(join(ROOT, 'packages/infrastructure/package.json'));
const { createClient } = require('@libsql/client');
const result = { label, fixture: 'ungated cyclic decision, extended with synthetic stored history', samples: [] };
let server;
let database;
try {
  server = await startApi({ port: PORT, dataDir, log });
  const api = restClient(server.url);
  const definition = cycle({ name: 'Ungated cycle', passes: 1_000_000 });
  const gate = definition.nodes.find((node) => node.id === 'gate');
  delete gate.config.routes[0].repeat;
  delete gate.config.maxPasses;
  definition.edges = definition.edges.filter((edge) => edge.from.port !== 'limit-reached');
  const created = await api.createLoop(definition);
  const run = await api.start(created.loop.id);
  await until(async () => (await api('GET', `/runs/${run.id}`)).lastEventSeq > 500, { timeout: 120_000 });
  await api('POST', `/runs/${run.id}/pause`);
  const page = await api('GET', `/runs/${run.id}/events?limit=500`);
  const decision = page.items.find((event) => event.type === 'decision.made');
  if (!decision || decision.gate) throw new Error('Expected an accepted ungated decision');
  await server.kill();
  server = undefined;
  database = createClient({ url: `file:${join(dataDir, 'graphgoblin.db').replaceAll('\\', '/')}` });
  const condition = `"run_events"."type" = 'decision.made' and case when json_valid("run_events"."payload") then json_type("run_events"."payload", '$.gate') is not null else 1 end`;
  const hasIndex = (
    await database.execute("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'run_events_gate_idx'")
  ).rows.length > 0;
  result.gateIndex = hasIndex;
  const row = (
    await database.execute({ sql: 'SELECT * FROM run_events WHERE run_id = ? AND seq = ?', args: [run.id, decision.seq] })
  ).rows[0];
  let tail = Number(
    (await database.execute({ sql: 'SELECT max(seq) AS tail FROM run_events WHERE run_id = ?', args: [run.id] })).rows[0].tail,
  );
  for (const extra of [0, 10_000, 90_000]) {
    if (extra) {
      await database.execute({
        sql: `WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i < ?)
          INSERT INTO run_events(run_id,seq,ts,type,node_id,payload)
          SELECT ?, ?+i, ?, ?, ?, ? FROM n`,
        args: [extra, run.id, tail, row.ts, row.type, row.node_id, row.payload],
      });
      tail += extra;
      await database.execute({ sql: 'UPDATE runs SET last_event_seq = ? WHERE id = ?', args: [tail, run.id] });
    }
    const decisions = Number(
      (
        await database.execute({
          sql: "SELECT count(*) AS n FROM run_events WHERE run_id = ? AND type = 'decision.made'",
          args: [run.id],
        })
      ).rows[0].n,
    );
    const gated = hasIndex
      ? Number(
          (
            await database.execute({
              sql: `SELECT count(*) AS n FROM run_events INDEXED BY run_events_gate_idx WHERE run_id = ? AND ${condition}`,
              args: [run.id],
            })
          ).rows[0].n,
        )
      : null;
    database.close();
    database = undefined;
    server = await startApi({ port: PORT, dataDir, log });
    const live = restClient(server.url);
    const timings = [];
    for (let i = 0; i < 9; i++) {
      const start = performance.now();
      const evidence = await live('GET', `/runs/${run.id}/observation`);
      if (evidence.gate !== undefined) throw new Error('Unexpected gate evidence');
      timings.push(performance.now() - start);
    }
    timings.sort((a, b) => a - b);
    const sample = { decisions, rowsInGateIndex: gated, medianObservationMs: +timings[4].toFixed(1) };
    result.samples.push(sample);
    log(sample);
    await server.kill();
    server = undefined;
    database = createClient({ url: `file:${join(dataDir, 'graphgoblin.db').replaceAll('\\', '/')}` });
  }
} catch (error) {
  log('ERROR', String(error?.stack ?? error));
  result.error = String(error?.stack ?? error);
} finally {
  database?.close();
  await server?.kill();
  await writeFile(join(HERE, `observation-cost-${label}.json`), JSON.stringify(result, null, 2) + '\n');
  await removeTemp(dataDir);
  await log.flush();
}
