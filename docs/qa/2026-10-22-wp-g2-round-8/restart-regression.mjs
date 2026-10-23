// Run from the repository root after pnpm build with Node 22. No live providers.
// Replays D-029's public HTTP / real SQLite / native restart fault, then checks Edge.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join, resolve, relative } from 'node:path';

const repo = process.cwd();
const root = process.argv[2]
  ? resolve(process.argv[2])
  : await mkdtemp(join(tmpdir(), 'gg-wp-g2-round8-'));
assert.ok(basename(root).startsWith('gg-wp-g2-'));
assert.ok(!relative(tmpdir(), root).startsWith('..'));
const data = join(root, 'store');
await mkdir(data, { recursive: true });
const { createClient } = createRequire(join(repo, 'packages/infrastructure/package.json'))(
  '@libsql/client',
);
const { chromium } = createRequire(join(repo, 'apps/web/package.json'))('@playwright/test');
const base = 'http://127.0.0.1:5620';
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
  GG_PORT: '5620',
  GG_HOST: '127.0.0.1',
  GG_REQUIRE_API_KEY: 'false',
  GG_LOG_LEVEL: 'warn',
  GG_WEB_DIST: join(repo, 'apps/web/dist'),
});
let child, db, browser;
async function until(check) {
  const deadline = Date.now() + 60_000;
  while (!(await check())) {
    assert.ok(Date.now() < deadline, 'disposable API state deadline');
    await new Promise((done) => setTimeout(done, 50));
  }
}
async function call(path, method = 'GET', body) {
  const response = await fetch(base + path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}
async function ok(path, method, body) {
  const response = await call(path, method, body);
  assert.ok(response.status >= 200 && response.status < 300, JSON.stringify(response));
  return response.body;
}
async function start() {
  child = spawn(process.execPath, ['apps/api/dist/main.js'], {
    cwd: repo,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = createWriteStream(join(root, 'native-api.log.txt'), { flags: 'a' });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.once('exit', () => log.end());
  await until(async () => {
    assert.equal(child.exitCode, null, 'API must remain alive');
    try {
      return (await call('/loops')).status === 200;
    } catch {
      return false;
    }
  });
}
async function stop() {
  if (child && child.exitCode === null) {
    const done = once(child, 'exit');
    child.kill('SIGKILL');
    await done;
  }
}
async function newLoop(name) {
  const schemaVersion = (await ok('/openapi.json')).components.schemas.LoopDefinitionInput
    .properties.schemaVersion.const;
  const { loop } = await ok('/loops', 'POST', {
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
  await ok(`/loops/${loop.id}/publish`, 'POST', {});
  return loop.id;
}
const results = [];
const connect = () =>
  createClient({ url: 'file:' + join(data, 'graphgoblin.db').replaceAll('\\', '/') });
try {
  await start();
  db = connect();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  for (const [column, damage] of [
    ['pinned', '{broken'],
    ['initial_thread', '{}'],
    ['thread_snapshot', '{}'],
    ['events', '{}'],
  ]) {
    const name = 'unreadable latest ' + column;
    const loopId = await newLoop(name);
    const prior = (await ok('/loops/' + loopId + '/runs', 'POST', {})).run.id;
    await until(
      async () =>
        (await db.execute({ sql: 'SELECT finalized_at FROM runs WHERE id=?', args: [prior] }))
          .rows[0]?.finalized_at,
    );
    // Columns/damage are fixed cases; loopId is the API's validated ULID, not authored SQL.
    const mutation =
      column === 'events'
        ? "UPDATE run_events SET payload='{}' WHERE run_id=NEW.id AND seq=1"
        : 'UPDATE runs SET ' + column + "='" + damage + "' WHERE id=NEW.id";
    await db.execute(
      "CREATE TRIGGER audit_lost_terminal_status BEFORE UPDATE OF status ON runs WHEN NEW.status='succeeded' AND NEW.loop_id='" +
        loopId +
        "' BEGIN " +
        mutation +
        '; SELECT RAISE(IGNORE); END',
    );
    const id = (await ok('/loops/' + loopId + '/runs', 'POST', {})).run.id;
    let terminal;
    await until(async () => {
      const row = (
        await db.execute({
          sql: "SELECT payload FROM run_events WHERE run_id=? AND type='run.finished'",
          args: [id],
        })
      ).rows[0];
      if (row) terminal = JSON.parse(row.payload);
      return Boolean(row);
    });
    await until(
      async () =>
        (
          await db.execute({
            sql:
              column === 'events'
                ? 'SELECT payload AS bad FROM run_events WHERE run_id=? AND seq=1'
                : 'SELECT ' + column + ' AS bad FROM runs WHERE id=?',
            args: [id],
          })
        ).rows[0]?.bad === damage,
    );
    assert.equal(terminal.status, 'succeeded');
    await db.execute('DROP TRIGGER audit_lost_terminal_status');
    db.close();
    db = undefined;
    await stop();
    await start();
    db = connect();
    const stored = (
      await db.execute({
        sql:
          column === 'events'
            ? 'SELECT status,(SELECT payload FROM run_events WHERE run_id=runs.id AND seq=1) AS bad FROM runs WHERE id=?'
            : 'SELECT status,' + column + ' AS bad FROM runs WHERE id=?',
        args: [id],
      })
    ).rows[0];
    assert.equal(stored.status, 'running');
    assert.equal(stored.bad, damage);
    const summary = (await ok('/loops')).items.find((loop) => loop.id === loopId);
    const diagnostics = await ok('/runs/diagnostics');
    const inspector = await call('/runs/' + id);
    const thread = await call('/runs/' + id + '/thread');
    const eventPage = await call('/runs/' + id + '/events');
    if (column === 'events') {
      assert.equal(inspector.status, 200);
      assert.equal(thread.status, 200);
      assert.equal(eventPage.body.code, 'STORED_EVENT_INVALID');
    }
    const { SqliteLoopRepository, databaseView } = await import(
      new URL('../../../packages/infrastructure/dist/sqlite/index.js', import.meta.url)
    );
    const repositorySummary = (
      await new SqliteLoopRepository(
        databaseView(db),
        { now: () => new Date() },
        {
          next: () => {
            throw Error('unexpected id allocation');
          },
        },
      ).listWithRunSummaries('local')
    ).find((loop) => loop.id === loopId);
    await page.goto(base + '/app/loops');
    const row = page
      .getByRole('row')
      .filter({ has: page.getByRole('link', { name, exact: true }) });
    await row.waitFor();
    const ui = await row.innerText();
    const unavailable = await row.getByText('latest run unavailable', { exact: true }).isVisible();
    const guidance = await row
      .getByText('Check run history diagnostics.', { exact: true })
      .isVisible();
    const badges = await row.getByRole('link', { name: /^(running|succeeded)$/ }).count();
    await page.screenshot({ path: join(root, column + '.png'), fullPage: true });
    const failures = [];
    if (repositorySummary.latestRun !== null || repositorySummary.runCount !== 2)
      failures.push(column + ': repository must also report unavailable with exact count 2');
    if (summary.latestRun !== null)
      failures.push(
        column + ': expected latestRun null; received ' + JSON.stringify(summary.latestRun),
      );
    if (summary.runCount !== 2)
      failures.push(column + ': expected exact count 2; received ' + summary.runCount);
    if (!diagnostics.items.some((item) => item.runId === id && item.code === 'HISTORY_UNREADABLE'))
      failures.push(column + ': missing HISTORY_UNREADABLE diagnostic');
    if (
      !unavailable ||
      !guidance ||
      badges ||
      (await row.getByText('never run', { exact: true }).count())
    )
      failures.push(
        column +
          ': Edge must show unavailable with diagnostics, never running, succeeded or never run',
      );
    const proof = {
      column,
      id,
      prior,
      terminal,
      stored,
      summary,
      inspector,
      thread,
      diagnostics,
      eventPage,
      repositorySummary,
      ui,
      failures,
      pass: failures.length === 0,
    };
    results.push(proof);
    console.log(JSON.stringify(proof));
  }
  if (results.some((result) => !result.pass)) process.exitCode = 1;
} finally {
  await browser?.close();
  db?.close();
  await stop();
  await writeFile(join(root, 'results.json'), JSON.stringify(results, null, 2) + '\n');
}
