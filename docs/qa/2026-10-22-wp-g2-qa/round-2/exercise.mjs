import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { mkdir, writeFile, appendFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.cwd(),
  out = resolve('docs/qa/2026-10-22-wp-g2-qa/round-2'),
  temp = await mkdtemp(join(tmpdir(), 'gg-qa-g2-a9df185-')),
  data = join(temp, 'store'),
  base = 'http://127.0.0.1:5633';
const ri = createRequire(resolve('packages/infrastructure/package.json')),
  rm = createRequire(resolve('apps/mcp/package.json')),
  rw = createRequire(resolve('apps/web/package.json'));
const { createClient } = ri('@libsql/client'),
  { chromium, expect } = rw('@playwright/test');
const { Client } = await import(
  pathToFileURL(rm.resolve('@modelcontextprotocol/sdk/client/index.js'))
);
const { StdioClientTransport } = await import(
  pathToFileURL(rm.resolve('@modelcontextprotocol/sdk/client/stdio.js'))
);
await mkdir(data, { recursive: true });
await writeFile(
  join(out, 'fixture-location.json'),
  JSON.stringify({ tempLeaf: basename(temp), port: 5633 }, null, 2),
);
const log = join(out, 'checks.log.txt');
await writeFile(log, '');
const clean = (s) =>
  String(s)
    .split(root)
    .join('<worktree>')
    .split(process.env.USERPROFILE)
    .join('<user>')
    .replace(/(?<![A-Za-z0-9_-])gg_[A-Za-z0-9_-]{32}(?![A-Za-z0-9_-])/g, '<generated-api-key>');
const rec = async (e) => {
  await appendFile(log, JSON.stringify(e) + '\n');
  console.log(e.id, e.result);
};
async function check(id, steps, expected, fn) {
  try {
    await rec({ id, steps, expected, actual: await fn(), result: 'PASS' });
  } catch (e) {
    process.exitCode = 1;
    await rec({ id, steps, expected, actual: clean(e.stack), result: 'FAIL' });
  }
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(path, opt = {}) {
  const r = await fetch(base + path, { signal: AbortSignal.timeout(15000), ...opt });
  return { status: r.status, contentType: r.headers.get('content-type'), body: await r.json() };
}
const env = {
  ...process.env,
  GG_DATA_DIR: data,
  GG_PORT: '5633',
  GG_HOST: '127.0.0.1',
  GG_WEB_DIST: resolve('apps/web/dist'),
  GG_REQUIRE_API_KEY: 'false',
  GG_LOG_LEVEL: 'silent',
  LIVE: '0',
};
for (const k of [
  'GG_DB_URL',
  'GG_MASTER_KEY',
  'GG_JEV_API_KEY',
  'JEV_API_KEY',
  'GG_DEFAULT_MODEL',
  'GG_DEFAULT_EFFORT',
  'GG_DEFAULTS',
])
  delete env[k];
let child,
  browser,
  mcp,
  transport,
  sql,
  nativeLog = '';
async function start() {
  child = spawn(process.execPath, ['apps/api/dist/main.js'], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.on('data', (b) => (nativeLog += b));
  child.stderr.on('data', (b) => (nativeLog += b));
  for (let i = 0; i < 180; i++) {
    if (child.exitCode !== null) throw Error(clean(nativeLog));
    try {
      if ((await api('/healthz')).status === 200) return;
    } catch {}
    await delay(500);
  }
  throw Error('API readiness deadline');
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await Promise.race([
    exited,
    delay(10000).then(() => {
      throw Error('QA stop deadline');
    }),
  ]);
}
async function tool(name, args) {
  const r = await mcp.callTool({ name, arguments: args });
  const text = r.content
    .filter((x) => x.type === 'text')
    .map((x) => x.text)
    .join('\n');
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { message: text };
  }
  return { isError: r.isError ?? false, body };
}
const count = async (p, n) => expect(p.locator('tbody tr')).toHaveCount(n, { timeout: 20000 });
async function snap(p, name) {
  await writeFile(join(out, name + '.txt'), clean(await p.locator('body').ariaSnapshot()));
  await p.screenshot({ path: join(temp, name + '.png') });
}
try {
  await start();
  const seedProc = spawn(
    process.execPath,
    ['docs/qa/2026-10-19-wp-g2-paging-summaries/seed-visual.mjs', base],
    { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let seedText = '',
    seedErr = '';
  seedProc.stdout.on('data', (b) => (seedText += b));
  seedProc.stderr.on('data', (b) => (seedErr += b));
  assert.equal((await once(seedProc, 'exit'))[0], 0, clean(seedErr));
  const seed = JSON.parse(seedText);
  await writeFile(join(out, 'seed.json'), JSON.stringify(seed, null, 2));
  sql = createClient({ url: 'file:' + join(data, 'graphgoblin.db').replaceAll('\\', '/') });
  const update = (t, c, v, id) =>
    sql.execute({ sql: 'UPDATE ' + t + ' SET ' + c + '=? WHERE id=?', args: [v, id] });
  transport = new StdioClientTransport({
    command: process.execPath,
    args: ['apps/mcp/dist/main.js', '--api-url', base],
    cwd: root,
    stderr: 'pipe',
    env: Object.fromEntries(Object.entries(env).filter(([, v]) => typeof v === 'string')),
  });
  mcp = new Client({ name: 'wp-g2-independent-qa', version: '1' });
  await mcp.connect(transport);
  await check(
    'seed-summaries',
    'Unmodified recipe seed; GET /loops',
    'Counts1/0/105/501; correct older succeeded run and empty control',
    async () => {
      const r = await api('/loops');
      assert.equal(r.status, 200);
      const rows = [seed.old, seed.empty, seed.paging, seed.busy].map((id) =>
        r.body.items.find((x) => x.id === id),
      );
      assert.deepEqual(
        rows.map((x) => x.runCount),
        [1, 0, 105, 501],
      );
      assert.equal(rows[0].latestRun.id, seed.oldRun);
      assert.equal(rows[0].latestRun.status, 'succeeded');
      assert.ok(rows[1].latestRun == null);
      return rows.map(({ id, runCount, latestRun }) => ({ id, runCount, latestRun }));
    },
  );
  const runId = seed.oldRun,
    saved = (
      await sql.execute({
        sql: 'SELECT payload FROM run_events WHERE run_id=? AND seq=2',
        args: [runId],
      })
    ).rows[0].payload;
  for (const bad of ['{}', '{invalid'])
    await check(
      'run-lookahead-' + bad,
      'Healthy after0/limit1; damage only seq2; repeat; request own page and limit5; MCP compare; restore',
      '200 seq1/nextAfter1/hasMore true; requested corruption500 STORED_EVENT_INVALID naming seq2; MCP agrees; restored200',
      async () => {
        const path = '/runs/' + runId + '/events',
          healthy = await api(path + '?after=0&limit=1');
        assert.equal(healthy.status, 200);
        await sql.execute({
          sql: 'UPDATE run_events SET payload=? WHERE run_id=? AND seq=2',
          args: [bad, runId],
        });
        try {
          const first = await api(path + '?after=0&limit=1');
          assert.equal(first.status, 200);
          assert.deepEqual(first.body, healthy.body);
          assert.equal(first.body.items[0].seq, 1);
          assert.equal(first.body.nextAfter, 1);
          assert.equal(first.body.hasMore, true);
          const own = await api(path + '?after=1&limit=1'),
            middle = await api(path + '?after=0&limit=5');
          for (const r of [own, middle]) {
            assert.equal(r.status, 500);
            assert.equal(r.body.code, 'STORED_EVENT_INVALID');
            assert.match(r.body.detail, /seq 2/);
          }
          const a = await tool('read_run_events', { runId, after: 0, limit: 1 }),
            b = await tool('read_run_events', { runId, after: 1, limit: 1 });
          assert.equal(a.isError, false);
          assert.deepEqual(a.body, first.body);
          assert.equal(b.isError, true);
          assert.match(JSON.stringify(b.body), /STORED_EVENT_INVALID/);
          return { healthy, first, own, middle, mcp: a, mcpRequested: b };
        } finally {
          await sql.execute({
            sql: 'UPDATE run_events SET payload=? WHERE run_id=? AND seq=2',
            args: [saved, runId],
          });
          assert.equal((await api(path + '?after=0&limit=5')).status, 200);
        }
      },
    );
  const inbound = (
    await sql.execute(
      'SELECT id,payload,run_ids,received_at FROM inbound_events ORDER BY received_at DESC,id DESC',
    )
  ).rows;
  for (const column of ['payload', 'run_ids'])
    await check(
      'inbound-lookahead-' + column,
      'Damage only row2 JSON; limit1, own cursor page, limit5; restore',
      'First page200+opaque cursor; requested corruption500 typed INTERNAL_ERROR; restoration200',
      async () => {
        const healthy = await api('/events?limit=1');
        await update('inbound_events', column, '{invalid', inbound[1].id);
        try {
          const first = await api('/events?limit=1');
          assert.equal(first.status, 200);
          assert.deepEqual(first.body, healthy.body);
          assert.ok(first.body.nextCursor);
          const own = await api('/events?limit=1&cursor=' + first.body.nextCursor),
            middle = await api('/events?limit=5');
          for (const r of [own, middle]) {
            assert.equal(r.status, 500);
            assert.equal(r.body.code, 'INTERNAL_ERROR');
            assert.match(r.contentType, /problem\+json/);
          }
          return { first, own, middle, hasMore: first.body.nextCursor !== null };
        } finally {
          await update('inbound_events', column, inbound[1][column], inbound[1].id);
          assert.equal((await api('/events?limit=5')).status, 200);
        }
      },
    );
  const runs = (
    await sql.execute({
      sql: 'SELECT id,pinned,created_at FROM runs WHERE loop_id=? ORDER BY created_at DESC,id DESC',
      args: [seed.paging],
    })
  ).rows;
  await check(
    'runs-corrupt-lookahead-mcp-diagnostics',
    'Damage second pinned run row; API/MCP limit1, own empty page, next page, inspector and diagnostics; restore',
    'Healthy first page unchanged; empty unreadable page retains cursor; next healthy run reachable; inspector STORED_RUN_INVALID; diagnostic identity',
    async () => {
      const q = 'loopId=' + seed.paging + '&status=succeeded&parent=none&limit=1',
        healthy = await api('/runs?' + q);
      await update('runs', 'pinned', '{invalid', runs[1].id);
      try {
        const first = await api('/runs?' + q),
          second = await api('/runs?' + q + '&cursor=' + first.body.nextCursor),
          third = await api('/runs?' + q + '&cursor=' + second.body.nextCursor);
        assert.equal(first.status, 200);
        assert.deepEqual(first.body, healthy.body);
        assert.deepEqual(second.body.items, []);
        assert.ok(second.body.nextCursor);
        assert.equal(third.body.items[0].id, runs[2].id);
        const a = await tool('list_runs', {
            loopId: seed.paging,
            status: ['succeeded'],
            parentRunId: 'none',
            limit: 1,
          }),
          b = await tool('list_runs', {
            loopId: seed.paging,
            status: ['succeeded'],
            parentRunId: 'none',
            limit: 1,
            cursor: first.body.nextCursor,
          });
        assert.equal(a.isError, false);
        assert.equal(a.body.nextCursor, first.body.nextCursor);
        assert.deepEqual(b.body.items, []);
        assert.equal(b.body.nextCursor, second.body.nextCursor);
        const inspector = await api('/runs/' + runs[1].id);
        assert.equal(inspector.status, 500);
        assert.equal(inspector.body.code, 'STORED_RUN_INVALID');
        let cursor, found;
        for (let i = 0; i < 50; i++) {
          const r = await api('/runs/diagnostics' + (cursor ? '?cursor=' + cursor : ''));
          assert.equal(r.status, 200);
          found = r.body.items.find((x) => x.runId === runs[1].id);
          if (found || !r.body.nextCursor) break;
          cursor = r.body.nextCursor;
        }
        assert.ok(found);
        return {
          firstIds: first.body.items.map((x) => x.id),
          firstCursor: first.body.nextCursor,
          second,
          thirdIds: third.body.items.map((x) => x.id),
          mcpFirst: a,
          mcpSecond: b,
          inspector,
          diagnostic: found,
        };
      } finally {
        await update('runs', 'pinned', runs[1].pinned, runs[1].id);
      }
    },
  );
  await writeFile(join(temp, 'fixtures.json'), JSON.stringify({ seed, inbound, runs }));
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  await writeFile(join(out, 'browser-version.txt'), browser.version());
  const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      serviceWorkers: 'block',
    }),
    page = await context.newPage();
  const ui = await import('./browser-cases.mjs');
  await ui.run({
    page,
    check,
    api,
    tool,
    sql,
    update,
    seed,
    inbound,
    runs,
    base,
    count,
    snap,
    start,
    stop,
  });
  await (await import('./latest-run.mjs')).run({ page, check, api, sql, base, snap, start, stop });
} catch (e) {
  await rec({ id: 'harness', result: 'FAIL', actual: clean(e.stack) });
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  await mcp?.close().catch(() => {});
  await transport?.close().catch(() => {});
  sql?.close();
  await stop().catch(async (e) => rec({ id: 'stop', result: 'FAIL', actual: clean(e.message) }));
  await writeFile(
    join(out, 'native-process.log.txt'),
    clean(nativeLog) || 'No diagnostics at silent log level.\n',
  );
  console.log('FUNCTIONAL_DONE; cleanup still required');
}
