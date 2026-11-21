// D5b W-OWN: read-only durable ownership/journal evidence from the retained D5 attempt-1 SQLite file.
// Usage: node d5b-ownership.mjs <dataDir>
import { join } from 'node:path';
import { recorder, imp } from './lib/rec.mjs';

const r = recorder('d5b');
const dataDir = process.argv[2];
const { openReadOnlyDatabaseClient } = await imp('packages/infrastructure/dist/sqlite/index.js');
const client = openReadOnlyDatabaseClient(join(dataDir, 'graphgoblin.db'));
const q = async (sql) => (await client.execute(sql)).rows.map((row) => ({ ...row }));
try {
  const runCols = (await q('PRAGMA table_info(runs)')).map((c) => c.name);
  const loopCols = (await q('PRAGMA table_info(loops)')).map((c) => c.name);
  r.raw('columns', { runCols, loopCols });
  const runs = await q('SELECT r.id AS id, l.name AS name FROM runs r JOIN loops l ON l.id = r.loop_id');
  const resources = await q("SELECT key, owner_run_id, kind, path FROM run_resources WHERE kind = 'workspace'");
  const refs = await q('SELECT id, run_id, path FROM workspace_references');
  r.raw('tables', { runs, resources, refs });
  const byName = (prefix) => runs.filter((x) => String(x.name).startsWith(prefix + ' ')).map((x) => x.id);
  const owned = new Set(resources.map((x) => x.owner_run_id));
  const tmpRuns = byName('W-TMP');
  const fixedRuns = [...byName('W-F'), ...byName('W-R'), ...byName('W-T'), ...byName('W-REUSE')];
  r.check('W-OWN-temp', 'temp-workspace run owns exactly its <dataDir>/workspaces/<runId> claim', tmpRuns.length === 1 && resources.filter((x) => x.owner_run_id === tmpRuns[0]).length === 1 && String(resources.find((x) => x.owner_run_id === tmpRuns[0])?.path ?? '').includes(tmpRuns[0]), { tmpRuns, claims: resources.filter((x) => tmpRuns.includes(x.owner_run_id)) }, 'NATIVE-SQLITE');
  r.check('W-OWN-fixed', 'fixed/relative/template-workspace runs have no ownership claim (no deletion authority over shared dirs)', fixedRuns.length >= 4 && fixedRuns.every((id) => !owned.has(id)), { fixedRuns, owned: [...owned] }, 'NATIVE-SQLITE');
  r.check('W-OWN-journal', 'shared journal references recorded for fixed/template runs (canonical-use journal)', fixedRuns.some((id) => refs.some((x) => x.run_id === id)), { refs: refs.filter((x) => fixedRuns.includes(x.run_id)) }, 'NATIVE-SQLITE');
} finally {
  client.close();
}
r.finish({ dataDir });
