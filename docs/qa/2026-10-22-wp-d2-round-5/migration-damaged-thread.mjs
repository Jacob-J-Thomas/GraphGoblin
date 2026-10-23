import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const root = process.cwd(),
  out = resolve(process.env.WP_D2_EVIDENCE),
  fixture = JSON.parse(
    await readFile(
      join(process.env.TEMP, 'gg-audit-d2-20261022/upgrade/retained-fixture.json'),
      'utf8',
    ),
  );
const store = resolve(process.env.TEMP, 'gg-wp-d2-round5-migration-damaged-thread-' + Date.now());
await cp(join(fixture.root, 'original'), store, { recursive: true });
const db = new DatabaseSync(join(store, 'graphgoblin.db'));
const row = db.prepare('SELECT initial_thread FROM runs WHERE id=?').get(fixture.childId);
const thread = JSON.parse(row.initial_thread);
thread.invocation.returnDefaults = ['corrupt'];
db.prepare('UPDATE runs SET initial_thread=? WHERE id=?').run(
  JSON.stringify(thread),
  fixture.childId,
);
const before = db.prepare('SELECT count(*) n FROM __drizzle_migrations').get();
db.close();
const env = Object.fromEntries(
  Object.entries(process.env).filter(([k]) =>
    [
      'PATH',
      'SYSTEMROOT',
      'WINDIR',
      'TEMP',
      'TMP',
      'APPDATA',
      'LOCALAPPDATA',
      'USERPROFILE',
      'COMSPEC',
      'PATHEXT',
    ].includes(k.toUpperCase()),
  ),
);
Object.assign(env, {
  GG_DATA_DIR: store,
  GG_PORT: '5644',
  GG_HOST: '127.0.0.1',
  GG_REQUIRE_API_KEY: 'false',
  GG_WEB_DIST: '',
  GG_MASTER_KEY: Buffer.alloc(32, 17).toString('base64'),
  GG_SWAGGER_UI: 'false',
});
const child = spawn(process.execPath, ['apps/api/dist/main.js'], {
  cwd: root,
  env,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '',
  timedOut = false;
child.stdout.on('data', (b) => (log += b));
child.stderr.on('data', (b) => (log += b));
const timer = setTimeout(() => {
  timedOut = true;
  child.kill('SIGKILL');
}, 30000);
const [exitCode, signal] = await once(child, 'exit');
clearTimeout(timer);
const afterDb = new DatabaseSync(join(store, 'graphgoblin.db'), { readOnly: true });
const after = afterDb.prepare('SELECT count(*) n FROM __drizzle_migrations').get();
afterDb.close();
const result = {
  exitCode,
  signal,
  timedOut,
  served: log.includes('Server listening'),
  beforeMigrations: before.n,
  afterMigrations: after.n,
  injectedReturnDefaults: ['corrupt'],
  log,
};
await writeFile(join(out, 'migration-damaged-thread.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
