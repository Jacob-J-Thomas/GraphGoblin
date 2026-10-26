import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
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
const log = join(out, 'two-tabs-retest.jsonl');
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
    body: JSON.parse(
      r.content
        .filter((x) => x.type === 'text')
        .map((x) => x.text)
        .join('\n'),
    ),
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
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({
      serviceWorkers: 'block',
      viewport: { width: 1440, height: 900 },
    }),
    a = await context.newPage(),
    b = await context.newPage();
  await check(
    'two-tabs-explicit-activation',
    'Open two real Edge tabs; activate each before navigation and clicking Load more, using existing timeouts',
    'Both tabs independently load100 then105 unique rows with identical order',
    async () => {
      const url = base + '/app/runs?loop=' + seed.paging;
      await a.bringToFront();
      await a.goto(url);
      await count(a, 100);
      await b.bringToFront();
      await b.goto(url);
      await count(b, 100);
      await a.bringToFront();
      await a.getByRole('button', { name: 'Load more', exact: true }).click();
      await count(a, 105);
      await b.bringToFront();
      await b.getByRole('button', { name: 'Load more', exact: true }).click();
      await count(b, 105);
      const ai = await a.locator('tbody tr td:first-child a').allTextContents(),
        bi = await b.locator('tbody tr td:first-child a').allTextContents();
      assert.equal(new Set(ai).size, 105);
      assert.deepEqual(ai, bi);
      return { tabRows: [105, 105], unique: [new Set(ai).size, new Set(bi).size], sameOrder: true };
    },
  );
} catch (e) {
  await rec({ id: 'two-tabs-harness', result: 'FAIL', actual: clean(e.stack) });
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  await stop();
  console.log('TWO_TABS_DONE');
}
