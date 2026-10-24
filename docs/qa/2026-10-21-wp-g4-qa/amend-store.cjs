const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createClient } = require('../../../packages/infrastructure/node_modules/@libsql/client');
const dir = __dirname;
const ids = JSON.parse(fs.readFileSync(path.join(dir, 'ids.json')));
const store = path.join(os.tmpdir(), 'gg-qa-129-dbca0fea');
const c = createClient({ url: 'file:' + path.join(store, 'graphgoblin.db').replaceAll('\\', '/') });
(async () => {
  const evidence = [];
  for (const name of ['kept', 'null']) {
    const id = ids[name].run;
    const before = await c.execute({
      sql: "SELECT payload FROM run_events WHERE run_id = ? AND type = 'run.finished'",
      args: [id],
    });
    const event = await c.execute({
      sql: "UPDATE run_events SET payload = json_remove(payload, '$.result') WHERE run_id = ? AND type = 'run.finished'",
      args: [id],
    });
    const row = await c.execute({ sql: 'UPDATE runs SET result = NULL WHERE id = ?', args: [id] });
    const after = await c.execute({
      sql: "SELECT payload FROM run_events WHERE run_id = ? AND type = 'run.finished'",
      args: [id],
    });
    evidence.push({
      name,
      runId: id,
      before: before.rows,
      sql: [
        "UPDATE run_events SET payload = json_remove(payload, '$.result') WHERE run_id = ? AND type = 'run.finished'",
        'UPDATE runs SET result = NULL WHERE id = ?',
      ],
      rowsAffected: [event.rowsAffected, row.rowsAffected],
      after: after.rows,
    });
  }
  c.close();
  fs.writeFileSync(
    path.join(dir, 'store-amendment.json'),
    JSON.stringify({ store: '%TEMP%/gg-qa-129-dbca0fea', evidence }, null, 2),
  );
  console.log('Amended exactly two recorded runs; one event and one run row each.');
})().catch((e) => {
  c.close();
  console.error(e.message);
  process.exitCode = 1;
});
