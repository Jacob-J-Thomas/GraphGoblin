// Run from the worktree root with Node 22 after pnpm build. Uses only disposable storage.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';

const repo = process.cwd();
const root = process.argv[2]
  ? resolve(process.argv[2])
  : await mkdtemp(join(tmpdir(), 'gg-wp-g2-round7-upgrade-'));
assert.ok(basename(root).startsWith('gg-wp-g2-'));
assert.ok(!relative(tmpdir(), root).startsWith('..'));
const data = join(root, 'store');
const historical = join(root, 'main-0015');
await mkdir(data, { recursive: true });
await mkdir(join(historical, 'meta'), { recursive: true });
const shipped = join(repo, 'packages/infrastructure/drizzle');
const journal = JSON.parse(await readFile(join(shipped, 'meta/_journal.json'), 'utf8'));
const prefix = { ...journal, entries: journal.entries.filter((entry) => entry.idx <= 15) };
assert.equal(prefix.entries.length, 16);
assert.equal(prefix.entries.at(-1).tag, '0015_webhook_delivery_journal');
assert.equal(prefix.entries.at(-1).when, 1792454400000);
await writeFile(join(historical, 'meta/_journal.json'), JSON.stringify(prefix));
for (const entry of prefix.entries)
  await copyFile(join(shipped, entry.tag + '.sql'), join(historical, entry.tag + '.sql'));
// Load the built public sqlite entry point under its ESM import condition.
const { openDatabase } = await import('../../../packages/infrastructure/dist/sqlite/index.js');
const url = 'file:' + join(data, 'graphgoblin.db').replaceAll('\\', '/');
let handle = openDatabase({ url, migrationsFolder: historical });
let child;
const results = { pass: false };
const base = 'http://127.0.0.1:5621';
async function call(path, method = 'GET', body) {
  const response = await fetch(base + path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const value = await response.json();
  assert.ok(response.ok, JSON.stringify({ path, status: response.status, value }));
  return value;
}
async function until(check) {
  const deadline = Date.now() + 60_000;
  while (!(await check())) {
    assert.ok(Date.now() < deadline, 'disposable API state deadline');
    await new Promise((done) => setTimeout(done, 50));
  }
}
try {
  await handle.migrate();
  const before = await handle.client.execute(
    'SELECT created_at FROM __drizzle_migrations ORDER BY created_at',
  );
  assert.equal(before.rows.length, 16);
  assert.equal(before.rows.at(-1).created_at, 1792454400000);
  assert.equal(
    (
      await handle.client.execute(
        "SELECT name FROM sqlite_master WHERE name='runs_loop_owner_history_idx'",
      )
    ).rows.length,
    0,
  );
  handle.close();
  handle = openDatabase({ url });
  const pendingBefore = await handle.pendingMigrations();
  assert.equal(pendingBefore, 1);
  handle.close();
  handle = undefined;
  // Inherit OS settings only: no owner application configuration or credentials.
  const env = Object.fromEntries(
    [
      'PATH',
      'SystemRoot',
      'WINDIR',
      'COMSPEC',
      'APPDATA',
      'LOCALAPPDATA',
      'TEMP',
      'TMP',
      'USERPROFILE',
    ]
      .filter((key) => process.env[key])
      .map((key) => [key, process.env[key]]),
  );
  Object.assign(env, {
    GG_DATA_DIR: data,
    GG_PORT: '5621',
    GG_HOST: '127.0.0.1',
    GG_REQUIRE_API_KEY: 'false',
    GG_LOG_LEVEL: 'warn',
    GG_WEB_DIST: join(repo, 'apps/web/dist'),
  });
  child = spawn(process.execPath, ['apps/api/dist/main.js'], {
    cwd: repo,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = createWriteStream(join(root, 'native-api.log.txt'));
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.once('exit', () => log.end());
  await until(async () => {
    assert.equal(child.exitCode, null, 'API must remain alive');
    try {
      return Boolean(await call('/loops'));
    } catch {
      return false;
    }
  });
  handle = openDatabase({ url });
  const after = await handle.client.execute(
    'SELECT created_at FROM __drizzle_migrations ORDER BY created_at',
  );
  const pendingAfter = await handle.pendingMigrations();
  assert.equal(pendingAfter, 0);
  assert.equal(after.rows.length, 17);
  assert.equal(after.rows.at(-1).created_at, 1792472004405);
  const index = (
    await handle.client.execute("PRAGMA index_info('runs_loop_owner_history_idx')")
  ).rows.map((row) => row.name);
  assert.deepEqual(index, ['loop_id', 'owner_id', 'created_at', 'id']);
  assert.equal(
    (
      await handle.client.execute(
        "SELECT name FROM sqlite_master WHERE name='run_events_delivery_idx'",
      )
    ).rows.length,
    1,
  );
  const schemaVersion = (await call('/openapi.json')).components.schemas.LoopDefinitionInput
    .properties.schemaVersion.const;
  async function newLoop(name) {
    const { loop } = await call('/loops', 'POST', {
      definition: {
        schemaVersion,
        name,
        nodes: [
          { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
          { id: 'done', kind: 'exit', label: 'Done', config: {} },
        ],
        edges: [{ id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'done' } }],
      },
    });
    await call(`/loops/${loop.id}/publish`, 'POST', {});
    return loop.id;
  }
  const loopId = await newLoop('0015 upgrade paging');
  const emptyId = await newLoop('0015 upgrade no history');
  const runIds = [];
  for (let i = 0; i < 3; i++) runIds.push((await call(`/loops/${loopId}/runs`, 'POST', {})).run.id);
  await until(
    async () =>
      (await call(`/runs?loopId=${loopId}&status=succeeded&limit=500`)).items.length === 3,
  );
  // Real SQLite ties exercise the opaque cursor's id component after the migration.
  const timestamp = '2026-10-22T00:00:00.000Z';
  await handle.client.execute({
    sql: 'UPDATE runs SET created_at=? WHERE loop_id=?',
    args: [timestamp, loopId],
  });
  const runs = [];
  let cursor;
  let runPages = 0;
  do {
    const page = await call(
      `/runs?loopId=${loopId}&status=succeeded&parent=none&limit=1` +
        (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''),
    );
    runPages++;
    assert.equal(page.items.length, 1);
    runs.push(...page.items.map((run) => run.id));
    cursor = page.nextCursor;
    assert.ok(runPages <= 3, 'cursor must exhaust');
  } while (cursor);
  assert.deepEqual(runs, [...runIds].sort().reverse());
  for (let i = 0; i < 3; i++)
    await call('/events', 'POST', { type: 'upgrade-paging', payload: { i } });
  await handle.client.execute({
    sql: 'UPDATE inbound_events SET received_at=? WHERE type=?',
    args: [timestamp, 'upgrade-paging'],
  });
  const events = [];
  let eventPages = 0;
  do {
    const page = await call(
      '/events?type=upgrade-paging&limit=1' +
        (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''),
    );
    eventPages++;
    assert.equal(page.items.length, 1);
    events.push(...page.items.map((event) => event.id));
    cursor = page.nextCursor;
    assert.ok(eventPages <= 3, 'event cursor must exhaust');
  } while (cursor);
  assert.equal(new Set(events).size, 3);
  assert.deepEqual(events, [...events].sort().reverse());
  const loops = (await call('/loops')).items;
  const summary = loops.find((loop) => loop.id === loopId);
  const empty = loops.find((loop) => loop.id === emptyId);
  assert.equal(summary.runCount, 3);
  assert.equal(summary.latestRun.id, runs[0]);
  assert.equal(summary.latestRun.status, 'succeeded');
  assert.equal(empty.runCount, 0);
  assert.equal(empty.latestRun, null);
  Object.assign(results, {
    pass: true,
    ledgerBefore: before.rows.map((row) => row.created_at),
    ledgerAfter: after.rows.map((row) => row.created_at),
    pendingBefore,
    pendingAfter,
    index,
    runPages,
    runIds: runs,
    eventPages,
    eventIds: events,
    summary,
    empty,
  });
  console.log(JSON.stringify(results));
} finally {
  handle?.close();
  if (child && child.exitCode === null) {
    const stopped = once(child, 'exit');
    child.kill('SIGKILL');
    await stopped;
  }
  await writeFile(join(root, 'results.json'), JSON.stringify(results, null, 2) + '\n');
}
