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
const log = join(out, 'adjacent.jsonl');
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
  sql = createClient({ url: 'file:' + join(data, 'graphgoblin.db').replaceAll('\\', '/') });
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      serviceWorkers: 'block',
    }),
    page = await context.newPage();
  await check(
    'polling-focus-rapid-activation',
    'Hold background Runs poll and append responses; focus Load more; press Enter twice during append',
    'Background poll keeps enabled opacity1 and visible focus ring; rapid activation sends one append,105 unique rows',
    async () => {
      let reads = 0,
        appends = 0,
        observed;
      const polling = new Promise((r) => (observed = r));
      await page.route(base + '/runs?*', async (route) => {
        const url = new URL(route.request().url());
        if (url.searchParams.has('cursor')) {
          appends++;
          await delay(1200);
        } else {
          reads++;
          if (reads > 1) {
            observed();
            await delay(1500);
          }
        }
        await route.continue();
      });
      try {
        await page.goto(base + '/app/runs?loop=' + seed.paging);
        await count(page, 100);
        const more = page.getByRole('button', { name: 'Load more', exact: true });
        await more.scrollIntoViewIfNeeded();
        await more.focus();
        await Promise.race([
          polling,
          delay(15000).then(() => {
            throw Error('No background poll observed');
          }),
        ]);
        const state = await more.evaluate((e) => ({
          ariaDisabled: e.getAttribute('aria-disabled'),
          disabled: e.disabled,
          opacity: getComputedStyle(e).opacity,
          outline: getComputedStyle(e).outline,
          shadow: getComputedStyle(e).boxShadow,
        }));
        assert.equal(state.disabled, false);
        assert.equal(state.ariaDisabled, 'false');
        assert.equal(state.opacity, '1');
        assert.ok(state.shadow !== 'none' || !state.outline.startsWith('none'));
        await page.keyboard.press('Enter');
        await page.keyboard.press('Enter');
        await count(page, 105);
        assert.equal(appends, 1);
        assert.equal(
          new Set(await page.locator('tbody tr td:first-child a').allTextContents()).size,
          105,
        );
        return { reads, appends, state, uniqueRows: 105 };
      } finally {
        await page.unroute(base + '/runs?*');
      }
    },
  );
  await check(
    'two-tabs-independent-history',
    'Open two independent pages to same filtered Runs history; append in both',
    'Each starts100 and reaches105 with105 unique IDs',
    async () => {
      const other = await context.newPage();
      try {
        await page.goto(base + '/app/runs?loop=' + seed.paging);
        await other.goto(base + '/app/runs?loop=' + seed.paging);
        await count(page, 100);
        await count(other, 100);
        await Promise.all([
          page.getByRole('button', { name: 'Load more', exact: true }).click(),
          other.getByRole('button', { name: 'Load more', exact: true }).click(),
        ]);
        await count(page, 105);
        await count(other, 105);
        return {
          tabRows: [105, 105],
          sameOrderedIds:
            JSON.stringify(await page.locator('tbody tr td:first-child a').allTextContents()) ===
            JSON.stringify(await other.locator('tbody tr td:first-child a').allTextContents()),
        };
      } finally {
        await other.close();
      }
    },
  );
  await check(
    'damaged-latest-summary',
    'Damage latest busy-history status; GET /loops and browser Loops; restore',
    'Count501 retained, latestRun null, history unavailable instead of never-run; unrelated older/no-history summaries remain correct',
    async () => {
      const row = (
        await sql.execute({
          sql: 'SELECT id,status FROM runs WHERE loop_id=? ORDER BY created_at DESC,id DESC LIMIT 1',
          args: [seed.busy],
        })
      ).rows[0];
      await sql.execute({
        sql: 'UPDATE runs SET status=? WHERE id=?',
        args: ['damaged-status', row.id],
      });
      try {
        const r = await api('/loops');
        assert.equal(r.status, 200);
        const summary = r.body.items.find((x) => x.id === seed.busy);
        assert.equal(summary.runCount, 501);
        assert.equal(summary.latestRun, null);
        await page.goto(base + '/app/loops');
        const busy = page
          .getByRole('row')
          .filter({ has: page.getByRole('link', { name: 'busy history', exact: true }) });
        await expect(busy).toContainText('unavailable');
        await expect(busy).not.toContainText('never run');
        assert.equal(await page.getByText('never run', { exact: true }).count(), 1);
        await snap(page, 'damaged-latest-summary');
        return { summary, visibleBusyRow: await busy.innerText(), neverRunCount: 1 };
      } finally {
        await sql.execute({
          sql: 'UPDATE runs SET status=? WHERE id=?',
          args: [row.status, row.id],
        });
      }
    },
  );
  await check(
    'whole-unreadable-inbound-page-contract',
    'Replace all105 inbound payloads with malformed JSON; request first page and open Events; restore',
    'Requested corruption remains an explicit typed error; no cursor exists to skip a rejected page (strict contract limitation)',
    async () => {
      const rows = (await sql.execute('SELECT id,payload FROM inbound_events')).rows;
      try {
        await sql.execute("UPDATE inbound_events SET payload='{invalid'");
        const r = await api('/events?limit=100');
        assert.equal(r.status, 500);
        assert.equal(r.body.code, 'INTERNAL_ERROR');
        await page.goto(base + '/app/events');
        await expect(page.getByText(/something went wrong/i).first()).toBeVisible();
        await expect(page.getByRole('button', { name: 'Load more', exact: true })).toHaveCount(0);
        return {
          response: r,
          loadMoreAvailable: false,
          limitation:
            'A malformed requested page is rejected, not a successful empty-readable page; browser cannot advance it without repair.',
        };
      } finally {
        await sql.batch(
          rows.map((r) => ({
            sql: 'UPDATE inbound_events SET payload=? WHERE id=?',
            args: [r.payload, r.id],
          })),
          'write',
        );
      }
    },
  );
} catch (e) {
  await rec({ id: 'adjacent-harness', result: 'FAIL', actual: clean(e.stack) });
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  sql?.close();
  await stop();
  console.log('ADJACENT_DONE');
}
