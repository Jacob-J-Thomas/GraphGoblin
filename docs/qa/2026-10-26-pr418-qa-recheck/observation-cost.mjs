import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import {
  startApi,
  restClient,
  cycle,
  until,
} from './lib.mjs';

const root = resolve(import.meta.dirname, '../../..');
const dataDir = await mkdtemp(join(tmpdir(), 'gg-qa-418r-observation-'));
const require = createRequire(join(root, 'packages/infrastructure/package.json'));
const { createClient } = require('@libsql/client');
const result = {
  fixture: 'ungated cyclic decision, followed by synthetic stored history',
  samples: [],
};
let server;
let database;
try {
  server = await startApi({ port: 6614, dataDir, log: console.log });
  const api = restClient(server.url);
  const definition = cycle({ name: 'Review ungated cycle', passes: 1_000_000 });
  const gate = definition.nodes.find((node) => node.id === 'gate');
  delete gate.config.routes[0].repeat;
  delete gate.config.maxPasses;
  definition.edges = definition.edges.filter((edge) => edge.from.port !== 'limit-reached');
  const created = await api.createLoop(definition);
  const run = await api.start(created.loop.id);
  await until(async () => (await api('GET', `/runs/${run.id}`)).lastEventSeq > 500);
  await api('POST', `/runs/${run.id}/pause`);
  const before = await api('GET', `/runs/${run.id}`);
  const page = await api('GET', `/runs/${run.id}/events?limit=500`);
  const decision = page.items.find((event) => event.type === 'decision.made');
  if (!decision || decision.gate) throw new Error('Expected an accepted ungated decision');
  result.acceptedRun = {
    status: before.status,
    lastEventSeq: before.lastEventSeq,
    gateAbsent: true,
  };
  await server.kill();
  server = undefined;
  database = createClient({ url: `file:${join(dataDir, 'graphgoblin.db').replaceAll('\\', '/')}` });
  const query = `SELECT seq FROM run_events WHERE run_id = ? AND type = 'decision.made'
    AND CASE WHEN json_valid(payload) THEN json_type(payload, '$.gate') IS NOT NULL ELSE 1 END
    ORDER BY seq DESC LIMIT 1`;
  result.plan = (
    await database.execute({ sql: `EXPLAIN QUERY PLAN ${query}`, args: [run.id] })
  ).rows;
  const stored = await database.execute({
    sql: 'SELECT * FROM run_events WHERE run_id = ? AND seq = ?',
    args: [run.id, decision.seq],
  });
  const row = stored.rows[0];
  let tail = Number(
    (
      await database.execute({
        sql: 'SELECT max(seq) AS tail FROM run_events WHERE run_id = ?',
        args: [run.id],
      })
    ).rows[0].tail,
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
      await database.execute({
        sql: 'UPDATE runs SET last_event_seq = ? WHERE id = ?',
        args: [tail, run.id],
      });
    }
    const count = Number(
      (
        await database.execute({
          sql: "SELECT count(*) AS n FROM run_events WHERE run_id = ? AND type = 'decision.made'",
          args: [run.id],
        })
      ).rows[0].n,
    );
    server = await startApi({ port: 6614, dataDir, log: console.log });
    const live = restClient(server.url);
    const timings = [];
    for (let i = 0; i < 9; i++) {
      const start = performance.now();
      const evidence = await live('GET', `/runs/${run.id}/observation`);
      if (evidence.gate !== undefined) throw new Error('Unexpected gate evidence');
      timings.push(performance.now() - start);
    }
    result.samples.push({
      decisions: count,
      medianObservationMs: timings.sort((a, b) => a - b)[4],
    });
    await server.kill();
    server = undefined;
  }
  console.log(JSON.stringify(result));
  await writeFile(
    join(import.meta.dirname, 'observation-cost.json'),
    JSON.stringify(result, null, 2),
  );
} finally {
  if (server) await server.kill();
  database?.close();
}
