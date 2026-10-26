import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile, appendFile, readFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(process.argv[2]);
const repo = process.cwd();
const data = join(root, 'store');
await mkdir(data, { recursive: true });
const reqApi = createRequire(join(repo, 'apps/api/package.json'));
const reqMcp = createRequire(join(repo, 'apps/mcp/package.json'));
const { createClient: sqlite } = createRequire(join(repo, 'packages/infrastructure/package.json'))(
  '@libsql/client',
);
const {
  createGraphGoblinClient: createClient,
  runs,
  events,
} = await import(pathToFileURL(join(repo, 'packages/api-client/dist/index.js')));
const { Client } = await import(
  pathToFileURL(reqMcp.resolve('@modelcontextprotocol/sdk/client/index.js'))
);
const { StdioClientTransport } = await import(
  pathToFileURL(reqMcp.resolve('@modelcontextprotocol/sdk/client/stdio.js'))
);
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
    .filter((k) => process.env[k])
    .map((k) => [k, process.env[k]]),
);
Object.assign(env, {
  GG_DATA_DIR: data,
  GG_PORT: '5620',
  GG_HOST: '127.0.0.1',
  GG_REQUIRE_API_KEY: 'false',
  GG_LOG_LEVEL: 'warn',
  GG_WEB_DIST: join(repo, 'apps/web/dist'),
});
let child, db, transport, mcp, browser;
const results = [];
const record = async (name, details, pass = true) => {
  const item = { name, pass, details };
  results.push(item);
  await appendFile(join(root, 'probe.jsonl'), JSON.stringify(item) + '\n');
  console.log(JSON.stringify(item));
};
const check = async (name, fn) => {
  try {
    await record(name, await fn());
  } catch (e) {
    await record(name, { error: String(e), stack: e.stack }, false);
  }
};
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 30000) {
  const end = Date.now() + ms;
  do {
    const v = await fn();
    if (v) return v;
    await delay(50);
  } while (Date.now() < end);
  throw Error('observable-state deadline');
}
async function call(path, method = 'GET', body) {
  const r = await fetch(base + path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  let b;
  try {
    b = JSON.parse(text);
  } catch {
    b = text;
  }
  return { status: r.status, type: r.headers.get('content-type'), body: b };
}
async function ok(path, method, body) {
  const r = await call(path, method, body);
  assert.ok(r.status >= 200 && r.status < 300, JSON.stringify(r));
  return r.body;
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
    if (child.exitCode !== null) throw Error('API exited ' + child.exitCode);
    try {
      return (await call('/loops')).status === 200;
    } catch {
      return false;
    }
  }, 60000);
}
async function stop() {
  if (child && child.exitCode === null && child.signalCode === null) {
    const done = once(child, 'exit');
    child.kill('SIGKILL');
    await done;
  }
}
const client = createClient({ baseUrl: base });
const uid = (n) => String(n).padStart(26, '0');
const time = '2026-10-02T12:00:00.000Z';
const before = '2026-10-03T00:00:00.000Z';
const cursorText = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
const decode = (v) => JSON.parse(Buffer.from(v, 'base64url').toString());
async function newLoop(name) {
  const spec = await ok('/openapi.json');
  const schemaVersion = spec.components.schemas.LoopDefinitionInput.properties.schemaVersion.const;
  const created = await ok('/loops', 'POST', {
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
  await ok('/loops/' + created.loop.id + '/publish', 'POST', {});
  return created.loop.id;
}
async function tool(name, args) {
  const r = await mcp.callTool({ name, arguments: args });
  if (r.isError) return { error: r };
  return JSON.parse(r.content.find((x) => x.type === 'text').text);
}
try {
  await start();
  db = sqlite({ url: 'file:' + join(data, 'graphgoblin.db').replaceAll('\\', '/') });
  const { chromium } = createRequire(join(repo, 'apps/web/package.json'))('@playwright/test');
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const name = 'audit durable success unreadable event';
  const loop = await newLoop(name);
  const prior = (await ok('/loops/' + loop + '/runs', 'POST', {})).run.id;
  await until(async () => {
    const r = await db.execute({ sql: 'SELECT finalized_at FROM runs WHERE id=?', args: [prior] });
    return r.rows[0]?.finalized_at;
  });
  await db.execute(
    "CREATE TRIGGER audit_lost_terminal_status BEFORE UPDATE OF status ON runs WHEN NEW.status='succeeded' AND NEW.loop_id='" +
      loop +
      "' BEGIN UPDATE run_events SET payload='{}' WHERE run_id=NEW.id AND seq=1; SELECT RAISE(IGNORE); END",
  );
  const id = (await ok('/loops/' + loop + '/runs', 'POST', {})).run.id;
  const terminal = await until(async () => {
    const r = await db.execute({
      sql: "SELECT seq,payload FROM run_events WHERE run_id=? AND type='run.finished'",
      args: [id],
    });
    return r.rows[0];
  });
  await until(async () => {
    const r = await db.execute({
      sql: 'SELECT payload FROM run_events WHERE run_id=? AND seq=1',
      args: [id],
    });
    return r.rows[0]?.payload === '{}';
  });
  const before = (await db.execute({ sql: 'SELECT * FROM runs WHERE id=?', args: [id] })).rows[0];
  assert.equal(JSON.parse(terminal.payload).status, 'succeeded');
  assert.equal(before.status, 'running');
  const contracts = await import(pathToFileURL(join(repo, 'packages/contracts/dist/index.js')));
  contracts.ContextThreadSchema.parse(JSON.parse(before.initial_thread));
  contracts.ContextThreadSchema.parse(JSON.parse(before.thread_snapshot));
  await db.execute('DROP TRIGGER audit_lost_terminal_status');
  await stop();
  db.close();
  db = undefined;
  await start();
  db = sqlite({ url: 'file:' + join(data, 'graphgoblin.db').replaceAll('\\', '/') });
  const after = (
    await db.execute({ sql: 'SELECT status,finalized_at FROM runs WHERE id=?', args: [id] })
  ).rows[0];
  const summary = (await ok('/loops')).items.find((x) => x.id === loop),
    run = await call('/runs/' + id),
    eventPage = await call('/runs/' + id + '/events'),
    diagnostics = (await ok('/runs/diagnostics')).items;
  await page.goto(base + '/app/loops');
  const row = page.getByRole('row').filter({ has: page.getByRole('link', { name, exact: true }) });
  await row.waitFor();
  const text = await row.innerText();
  await page.screenshot({ path: join(root, 'event-history-badge.png'), fullPage: true });
  const result = {
    loop,
    id,
    prior,
    terminal: JSON.parse(terminal.payload),
    after,
    summary: { latestRun: summary.latestRun, count: summary.runCount },
    snapshot: { status: run.status, runStatus: run.body.status },
    eventPage: { status: eventPage.status, body: eventPage.body },
    diagnostics,
    ui: text,
  };
  assert.equal(summary.runCount, 2);
  assert.ok(diagnostics.some((x) => x.runId === id));
  assert.equal(after.status, 'running');
  await record(
    'durable success with unreadable earlier event after restart',
    result,
    summary.latestRun === null,
  );
  if (summary.latestRun !== null) process.exitCode = 1;
} finally {
  await browser?.close();
  db?.close();
  await stop();
  await writeFile(join(root, 'results.json'), JSON.stringify(results, null, 2));
}
