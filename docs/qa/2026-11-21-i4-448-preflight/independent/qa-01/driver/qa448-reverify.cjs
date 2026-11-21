const fs = require('fs'); const path = require('path'); const os = require('os'); const { DatabaseSync } = require('node:sqlite');
const F = process.argv[2]; const out = {};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qa448-reverify-'));
for (const [name, withWal] of [['golden', false], ['missing', false], ['walonly-snapshot', false], ['walonly-snapshot', true], ['P01-after-preflight', true], ['P03-after-preflight', true], ['S01-after-startup', true]]) {
  const d = path.join(tmp, name + (withWal ? '+wal' : '-base')); fs.mkdirSync(d);
  fs.copyFileSync(path.join(F, name, 'gateway.db'), path.join(d, 'g.db'));
  if (withWal && fs.existsSync(path.join(F, name, 'gateway.db-wal'))) fs.copyFileSync(path.join(F, name, 'gateway.db-wal'), path.join(d, 'g.db-wal'));
  const db = new DatabaseSync(path.join(d, 'g.db'));
  const rows = db.prepare('SELECT harness, model, enabled FROM model_catalog ORDER BY harness, model').all();
  const mig = db.prepare('SELECT COUNT(*) n FROM __drizzle_migrations').get().n;
  const fmt = db.prepare('SELECT format_version f FROM gg_upgrade_state').get().f;
  db.close();
  out[name + (withWal ? ' (db+wal)' : ' (db only)')] = { catalogRows: rows.length, terra: rows.find(r => r.model === 'gpt-6.1-terra')?.enabled ?? 'absent', opus: rows.find(r => r.model === 'claude-opus-5-5')?.enabled ?? 'absent', migrations: mig, format: fmt };
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(JSON.stringify({ tmpRemoved: !fs.existsSync(tmp), results: out }, null, 1));
