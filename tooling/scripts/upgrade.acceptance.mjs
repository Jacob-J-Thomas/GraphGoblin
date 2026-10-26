// Ordinary current-format evolution only (ADR-0042). Run after pnpm build.
// Older definition/store formats are refused; this suite never invokes a converter.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('../../', import.meta.url));
const main = join(root, 'apps/api/dist/main.js');
const moduleUrl = (path) => JSON.stringify(pathToFileURL(join(root, path)).href);
const sqlite = moduleUrl('packages/infrastructure/dist/sqlite/index.js');
const fixtures = moduleUrl('packages/infrastructure/dist/sqlite/testing/index.js');
const contracts = moduleUrl('packages/contracts/dist/index.js');
const execute = promisify(execFile);
const child = (script) =>
  execute(process.execPath, ['--input-type=module', '-e', script], {
    cwd: root,
    windowsHide: true,
    timeout: 120_000,
  });
const url = (dir) => 'file:' + join(dir, 'graphgoblin.db').replaceAll('\\', '/');
const environment = (dir, port) => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GG_'))),
  GG_DATA_DIR: dir,
  GG_PORT: String(port),
  GG_WEB_DIST: '',
  GG_LOG_LEVEL: 'warn',
});

async function freePort() {
  for (let port = 6300; port <= 6309; port++) {
    const server = createServer();
    const available = await new Promise((resolve) => {
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
    });
    if (available) return port;
  }
  throw new Error('No disposable WP-B3 port is free in 6300..6309');
}

async function start(dir) {
  const port = await freePort();
  const server = spawn(process.execPath, [main], {
    cwd: root,
    env: environment(dir, port),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  server.stdout.on('data', (chunk) => {
    output += chunk;
  });
  server.stderr.on('data', (chunk) => {
    output += chunk;
  });
  const exited = new Promise((resolve) => server.once('exit', (code) => resolve(code)));
  try {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline && server.exitCode === null) {
      const healthy = await fetch(`http://127.0.0.1:${port}/healthz`).then(
        (response) => response.ok,
        () => false,
      );
      if (healthy) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.fail(`API did not start: ${output}`);
  } finally {
    if (server.exitCode === null) server.kill('SIGTERM');
    await exited;
  }
}

test(
  'fresh and earlier current-format stores start; ordinary migrations preserve data and receipts',
  { timeout: 300_000 },
  async () => {
    const base = await mkdtemp(join(tmpdir(), 'gg-wp-b3-int-current-'));
    try {
      const fresh = join(base, 'fresh');
      await mkdir(fresh);
      await start(fresh);
      const older = join(base, 'earlier-main');
      await mkdir(older);
      // A genuine current-format store at main's shipped prefix, before #246. Later SQL and
      // the receipt rewrite must run on startup without invoking format conversion or reset.
      await child(`
      const { openStoreBefore } = await import(${fixtures});
      const { LoopDefinitionSchema } = await import(${contracts});
      const h = await openStoreBefore(${JSON.stringify(url(older))}, '0015_webhook_delivery_journal');
      const definition = LoopDefinitionSchema.parse({ schemaVersion: 4, name: 'retained current loop',
        nodes: [{ id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
          { id: 'done', kind: 'exit', label: 'Done', config: {} }],
        edges: [{ id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'done' } }] });
      await h.client.execute({ sql: 'INSERT INTO loops (id,owner_id,name,draft_version_id,created_at,updated_at) VALUES (?,?,?,?,?,?)',
        args: ['01J00000000000000000000001','local',definition.name,'01J00000000000000000000002','2026-10-18T00:00:00.000Z','2026-10-18T00:00:00.000Z'] });
      await h.client.execute({ sql: 'INSERT INTO loop_versions (id,loop_id,version,status,definition,created_at) VALUES (?,?,1,?,?,?)',
        args: ['01J00000000000000000000002','01J00000000000000000000001','draft',JSON.stringify(definition),'2026-10-18T00:00:00.000Z'] });
      await h.client.execute({ sql: 'INSERT INTO run_events (run_id,seq,ts,type,payload) VALUES (?,1,?,?,?)',
        args: ['01J00000000000000000000003','2026-10-18T00:00:00.000Z','return.delivered',JSON.stringify({channel:{kind:'webhook',url:'https://example.test/hook'},target:'retained'})] });
      await h.client.execute({sql: 'INSERT INTO settings (owner_id,key,value,updated_at) VALUES (?,?,?,?)', args: ['local','retained',JSON.stringify('exact bytes'),'2026-10-18T00:00:00.000Z']});
      h.close();
      process.exit(0);
    `);
      await start(older);
      const inspect = await child(`
      const assert = await import('node:assert/strict');
      const { openDatabase, guardCurrentStore, verifyStoreHead } = await import(${sqlite});
      const h = openDatabase({url:${JSON.stringify(url(older))}});
      assert.equal(await guardCurrentStore(h.client), 'current');
      await verifyStoreHead(h.client);
      assert.equal(await h.pendingMigrations(), 0);
      assert.equal((await h.client.execute("SELECT value FROM settings WHERE key='retained'")).rows[0].value, '"exact bytes"');
      assert.equal((await h.client.execute('SELECT name FROM loops')).rows[0].name, 'retained current loop');
      const event = (await h.client.execute('SELECT type,payload FROM run_events')).rows[0];
      assert.equal(event.type, 'delivery.finished');
      const delivery = JSON.parse(event.payload).delivery;
      assert.equal(delivery.status, 'delivered');
      assert.equal(delivery.channel.url, 'https://example.test/hook');
      process.stdout.write('current format: full ledger, retained loop/settings, migrated receipt');
      h.close(); process.exit(0);
    `);
      assert.match(inspect.stdout, /full ledger/);
      // Restart at head exercises the idempotent ordinary-migration path too.
      await start(older);
    } finally {
      await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  },
);

test(
  'format-3 and unmarked stores refuse startup with exit 1 and the reset guidance',
  { timeout: 300_000 },
  async () => {
    const base = await mkdtemp(join(tmpdir(), 'gg-wp-b3-int-refused-'));
    try {
      for (const [name, mutation, found] of [
        ['format3', 'UPDATE gg_upgrade_state SET format_version=3', 'format 3'],
        ['unmarked', 'DROP TABLE gg_upgrade_state', 'no valid format marker'],
      ]) {
        const dir = join(base, name);
        await mkdir(dir);
        await child(`const {openDatabase}=await import(${sqlite});
        const h=openDatabase({url:${JSON.stringify(url(dir))}}); await h.migrate();
        await h.client.execute(${JSON.stringify(mutation)}); h.close(); process.exit(0);`);
        await assert.rejects(
          execute(process.execPath, [main], {
            cwd: root,
            env: environment(dir, await freePort()),
            windowsHide: true,
            timeout: 120_000,
          }),
          (error) => {
            assert.equal(error.code, 1);
            assert.ok(error.stderr.includes(found), error.stderr);
            assert.match(error.stderr, /Requires:\s+format 4/);
            assert.match(error.stderr, /No stored data was changed/);
            assert.match(error.stderr, /--reset --data-dir/);
            return true;
          },
        );
      }
    } finally {
      await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  },
);
