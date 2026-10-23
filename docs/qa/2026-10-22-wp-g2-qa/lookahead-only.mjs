import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { mkdir, writeFile, appendFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.cwd(),
  out = resolve('docs/qa/2026-10-22-wp-g2-qa'),
  temp = join(tmpdir(), 'gg-qa-231-9896cf-independent'),
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
const log = join(out, 'lookahead-retest.jsonl');
await writeFile(log, '');
const clean = (s) =>
  String(s).split(root).join('<worktree>').split(process.env.USERPROFILE).join('<user>');
const rec = async (e) => {
  await appendFile(log, JSON.stringify(e) + '\n');
  console.log(e.id, e.result);
};
async function check(id, steps, expected, fn) {
  try {
    await rec({ id, steps, expected, actual: await fn(), result: 'PASS' });
  } catch (e) {
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
  return {
    isError: r.isError ?? false,
    body: (() => {
      const text = r.content
        .filter((x) => x.type === 'text')
        .map((x) => x.text)
        .join('\n');
      try {
        return JSON.parse(text);
      } catch {
        return { message: text };
      }
    })(),
  };
}
const count = async (p, n) => expect(p.locator('tbody tr')).toHaveCount(n, { timeout: 20000 });
async function snap(p, name) {
  await writeFile(join(out, name + '.txt'), clean(await p.locator('body').ariaSnapshot()));
  await p.screenshot({ path: join(temp, name + '.png') });
}
try {
  await start();
  const seed = JSON.parse(await readFile(join(out, 'seed.json'), 'utf8'));
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
    join(out, 'native-process.txt'),
    clean(nativeLog) || 'No diagnostics at silent log level.\n',
  );
  console.log('FUNCTIONAL_DONE; cleanup still required');
}
