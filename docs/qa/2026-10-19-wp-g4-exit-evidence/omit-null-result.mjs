// QA 129, section 6: make one finished run look as a format-4 run recorded by an older build did,
// with the `null` result omitted from its `run.finished` event and from the runs table. Run it with
// the API stopped, against the disposable store only:
//   node docs/qa/2026-10-19-wp-g4-exit-evidence/omit-null-result.mjs <path to graphgoblin.db> <run id>
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { createClient } = require(
  resolve(process.cwd(), 'packages/infrastructure/node_modules/@libsql/client'),
);

const [database, runId] = process.argv.slice(2);
if (!database || !runId) {
  console.error('usage: node omit-null-result.mjs <path to graphgoblin.db> <run id>');
  process.exit(2);
}
const client = createClient({ url: 'file:' + resolve(database).replaceAll('\\', '/') });
const finished = await client.execute({
  sql: "UPDATE run_events SET payload = json_remove(payload, '$.result') WHERE run_id = ? AND type = 'run.finished'",
  args: [runId],
});
const row = await client.execute({
  sql: 'UPDATE runs SET result = NULL WHERE id = ?',
  args: [runId],
});
console.log(
  `amended run ${runId}: ${String(finished.rowsAffected)} run.finished event(s), ${String(row.rowsAffected)} run row(s)`,
);
client.close();
