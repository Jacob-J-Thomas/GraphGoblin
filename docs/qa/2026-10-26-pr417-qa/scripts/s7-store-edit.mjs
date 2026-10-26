// Edits a STOPPED disposable GraphGoblin store the way an older build could have left it (used by
// s7-stored-effort.mjs; runs as its own process so the SQLite handle is gone when it exits).
//   node s7-store-edit.mjs <db> nodes <loopId>...   published versions of these loops: gpt-6-luna -> gpt-5.5,
//                                                     and the gpt-5.5 catalog row lists max again (old seed)
//   node s7-store-edit.mjs <db> settings             owner Settings defaults: gpt-6-luna -> gpt-5.5
// Prints the affected rows before and after as JSON.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const { createClient } = createRequire(path.join(root, 'packages', 'infrastructure', 'package.json'))('@libsql/client');
const [dbPath, mode, ...loopIds] = process.argv.slice(2);
if (!/gg-qa-417-/.test(dbPath)) throw new Error('refusing to edit a store outside the gg-qa-417- disposable directories');
const db = createClient({ url: 'file:' + dbPath });

async function snapshot() {
  const catalog = (await db.execute(`SELECT model, efforts FROM model_catalog WHERE harness = 'codex' AND model = 'gpt-5.5'`)).rows.map((r) => ({ model: r.model, efforts: JSON.parse(r.efforts) }));
  const versions = loopIds.length
    ? (await db.execute({ sql: `SELECT loop_id, definition FROM loop_versions WHERE status = 'published' AND loop_id IN (${loopIds.map(() => '?').join(',')})`, args: loopIds })).rows.map((r) => {
        const def = JSON.parse(r.definition);
        return { loop: r.loop_id, nodes: def.nodes.filter((n) => n.config?.model || n.config?.effort).map((n) => ({ id: n.id, model: n.config.model, effort: n.config.effort })) };
      })
    : [];
  const settings = (await db.execute(`SELECT key, value FROM settings WHERE key = 'defaults'`)).rows.map((r) => ({ key: r.key, value: JSON.parse(r.value) }));
  return { catalog, versions, settings };
}

const before = await snapshot();
if (mode === 'nodes') {
  await db.execute(`UPDATE model_catalog SET efforts = '["minimal","low","medium","high","xhigh","max"]' WHERE harness = 'codex' AND model = 'gpt-5.5'`);
  for (const id of loopIds)
    await db.execute({ sql: `UPDATE loop_versions SET definition = replace(definition, '"gpt-6-luna"', '"gpt-5.5"') WHERE status = 'published' AND loop_id = ?`, args: [id] });
} else if (mode === 'settings') {
  await db.execute(`UPDATE settings SET value = replace(value, '"gpt-6-luna"', '"gpt-5.5"') WHERE key = 'defaults'`);
} else throw new Error('mode must be nodes or settings');
const after = await snapshot();
db.close();
console.log(JSON.stringify({ mode, before, after }));
