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
  : await mkdtemp(join(tmpdir(), 'gg-wp-g2-summary-'));
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
  const log = createWriteStream(join(root, 'native-api.log'), { flags: 'a' });
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
try {
  await start();
  db = createClient({ url: 'file:' + join(data, 'graphgoblin.db').replaceAll('\\', '/') });
  const loopId = await newLoop('terminal event with unreadable latest snapshot');
  const olderId = (await ok(`/loops/${loopId}/runs`, 'POST', {})).run.id;
  await until(async () => (await ok(`/runs/${olderId}`)).status === 'succeeded');
  await db.execute(
    "CREATE TRIGGER audit_lost_terminal_status BEFORE UPDATE OF status ON runs WHEN NEW.status = 'succeeded' BEGIN UPDATE runs SET pinned = '{broken' WHERE id = NEW.id; SELECT RAISE(IGNORE); END",
  );
  const id = (await ok(`/loops/${loopId}/runs`, 'POST', {})).run.id;
  await until(
    async () =>
      (
        await db.execute({
          sql: "SELECT seq FROM run_events WHERE run_id=? AND type='run.finished'",
          args: [id],
        })
      ).rows.length > 0,
  );
  const stored = (
    await db.execute({ sql: 'SELECT status,pinned FROM runs WHERE id=?', args: [id] })
  ).rows[0];
  const terminal = JSON.parse(
    (
      await db.execute({
        sql: `SELECT payload FROM run_events WHERE run_id=? AND type='run.finished'`,
        args: [id],
      })
    ).rows[0].payload,
  );
  assert.equal(stored.status, 'running');
  assert.equal(stored.pinned, '{broken');
  assert.equal(terminal.status, 'succeeded');
  await db.execute('DROP TRIGGER audit_lost_terminal_status');
  db.close();
  db = undefined;
  await stop();
  await start();
  const summary = (await ok('/loops')).items.find((loop) => loop.id === loopId);
  const inspector = await call(`/runs/${id}`);
  const diagnostics = await ok('/runs/diagnostics');
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(base + '/app/loops');
  const row = page.getByRole('row').filter({
    has: page.getByRole('link', {
      name: 'terminal event with unreadable latest snapshot',
      exact: true,
    }),
  });
  await row.waitFor();
  const visible = await row.innerText();
  await page.screenshot({ path: join(root, 'latest-summary.png'), fullPage: true });
  const proof = { stored, terminal, summary, inspector, diagnostics, visible };
  await writeFile(join(root, 'proof.json'), JSON.stringify(proof, null, 2));
  console.log(
    JSON.stringify({
      stored,
      terminalStatus: terminal.status,
      latestRun: summary.latestRun,
      runCount: summary.runCount,
      inspector,
      visible,
    }),
  );
  assert.equal(summary.runCount, 2);
  assert.equal(
    summary.latestRun,
    null,
    'unreadable latest snapshot must be unavailable, never a stale badge or older run',
  );
  assert.equal(inspector.status, 500);
  assert.equal(inspector.body.code, 'STORED_RUN_INVALID');
  assert.ok(
    diagnostics.items.some((item) => item.runId === id && item.code === 'HISTORY_UNREADABLE'),
  );
  await row.getByText('latest run unavailable', { exact: true }).waitFor();
  await row.getByText('Check run history diagnostics.', { exact: true }).waitFor();
  assert.equal(await row.getByRole('link', { name: /^(running|succeeded)$/ }).count(), 0);
  assert.equal(await row.getByText('never run', { exact: true }).count(), 0);
  console.log(
    'PASS: built API restart and Edge report unavailable, count 2, diagnostics identify the latest row.',
  );
} finally {
  await browser?.close();
  db?.close();
  await stop();
}
