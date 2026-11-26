import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// An external, headless public-interface check. Invoke only after the chosen repo's built API
// and web dependencies are ready. Both the baseline and candidate use exactly this script.
const repo = resolve(process.env.GG_QA_REPO ?? 'work/repair');
const dist = resolve(process.env.GG_QA_WEB_DIST ?? join(repo, 'apps/web/dist'));
const out = resolve(process.env.GG_QA_OUT ?? 'work/aidlc/inspector-independent-qa/run');
const require = createRequire(pathToFileURL(join(repo, 'apps/web/package.json')));
const { chromium, request, expect } = require('@playwright/test');
const evidence = { repo, dist, events: [], requests: [], failures: [], responses: [] };
const event = (kind, detail = {}) =>
  evidence.events.push({ at: new Date().toISOString(), kind, ...detail });
const deferred = () => {
  let resolvePromise;
  const promise = new Promise((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
};
async function until(check, description, ms = 20_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 50));
  }
  throw new Error(`Timed out waiting for ${description}`);
}
async function gateway() {
  const child = spawn(process.execPath, ['--conditions=development', '--import', 'tsx', 'e2e/server.ts'], {
    cwd: join(repo, 'apps/web'),
    env: { ...process.env, GG_E2E_WEB_DIST: dist, GG_E2E_MAIN_PORT: '0', GG_E2E_CONTROL_PORT: '0' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  try {
    await until(() => /GG_E2E_READY (\S+)/.test(stdout) && /GG_E2E_CONTROL (\S+)/.test(stdout), 'disposable E2E gateway', 60_000);
    return {
      api: /GG_E2E_READY (\S+)/.exec(stdout)[1],
      control: /GG_E2E_CONTROL (\S+)/.exec(stdout)[1],
      child,
      logs: () => ({ stdout, stderr }),
    };
  } catch (error) {
    child.kill('SIGTERM');
    throw new Error(`${error.message}\nGateway stderr:\n${stderr}`);
  }
}

await mkdir(out, { recursive: true });
let server;
let context;
let api;
let listenerDown = false;
let browser;
let page;
let outcome = 'failed';
let failure;
let releaseSecond;
let restoredAt = 0;
try {
  server = await gateway();
  event('gateway-ready', { api: server.api, control: server.control });
  api = await request.newContext({ baseURL: server.api });
  const unique = `Independent outage ${Date.now()}`;
  const definition = {
    schemaVersion: 4,
    name: unique,
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' }, ui: { x: 0, y: 80 } },
      { id: 'approve', kind: 'wait', label: 'Approve', config: { mode: 'input', prompt: 'Approve?' }, ui: { x: 260, y: 80 } },
      { id: 'done', kind: 'exit', label: 'Done', config: {}, ui: { x: 520, y: 80 } },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'approve' } },
      { id: 'e2', from: { node: 'approve', port: 'out' }, to: { node: 'done' } },
    ],
  };
  const created = await api.post('/loops', { data: { definition } });
  assert.equal(created.status(), 201);
  const { loop } = await created.json();
  const published = await api.post(`/loops/${loop.id}/publish`);
  assert.equal(published.status(), 200);
  const started = await api.post(`/loops/${loop.id}/runs`, {
    data: { triggerNodeId: 'start', input: {} },
  });
  assert.equal(started.status(), 202);
  const { run } = await started.json();
  const runPath = `/runs/${run.id}`;
  event('run-created', { runId: run.id, loopId: loop.id });
  await until(async () => {
    const res = await api.get(runPath);
    return res.ok() && (await res.json()).status === 'waiting';
  }, 'waiting run', 30_000);

  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'allow' });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  page = await context.newPage();
  const secondReady = deferred();
  releaseSecond = deferred();
  let runGets = 0;
  let secondDelivered = false;
  page.on('request', (req) => {
    const path = new URL(req.url()).pathname;
    if (path.startsWith('/runs')) evidence.requests.push({ at: new Date().toISOString(), method: req.method(), path, listenerDown });
  });
  page.on('requestfailed', (req) => {
    const path = new URL(req.url()).pathname;
    evidence.failures.push({ at: new Date().toISOString(), method: req.method(), path, error: req.failure()?.errorText, listenerDown });
  });
  page.on('response', (res) => {
    const path = new URL(res.url()).pathname;
    if (path.startsWith('/runs')) evidence.responses.push({ at: new Date().toISOString(), atMs: Date.now(), path, status: res.status(), listenerDown });
  });
  await page.route((url) => url.pathname === runPath, async (route) => {
    runGets += 1;
    const ordinal = runGets;
    event('browser-run-get', { ordinal, listenerDown });
    if (ordinal !== 2) return route.continue();
    // The server really answers this GET before loss. Holding the body makes its later arrival
    // unambiguously older than the listener outage without injecting a fabricated run record.
    const upstream = await route.fetch();
    assert.equal(upstream.status(), 200);
    const body = await upstream.body();
    event('preloss-run-response-held', { bytes: body.length });
    secondReady.resolve();
    await releaseSecond.promise;
    await route.fulfill({ status: 200, contentType: 'application/json', body });
    secondDelivered = true;
    event('preloss-run-response-delivered');
  });

  await page.goto(`${server.api}/app/runs/${run.id}`);
  const heading = page.getByRole('heading', { name: `Run ${run.id}` });
  const answer = page.getByLabel('Input (JSON)');
  const submit = page.getByRole('button', { name: 'Submit input' });
  await expect(heading).toBeVisible();
  await answer.fill('{"approved":true}');
  await expect(submit).toBeEnabled();
  await Promise.race([secondReady.promise, new Promise((_, reject) => setTimeout(() => reject(new Error('No second browser run GET from initial live event batch')), 10_000))]);
  event('before-loss-ready', { runGets });

  const stopped = await api.post(`${server.control}/api/listener`, { data: { listening: false } });
  assert.equal(stopped.status(), 200);
  assert.deepEqual(await stopped.json(), { ok: true });
  listenerDown = true;
  event('listener-stopped');
  await until(
    () => evidence.failures.some((item) => item.path === `${runPath}/events` && item.listenerDown),
    'actual browser event-stream transport failure',
  );
  await expect(page.getByText('Cannot reach the GraphGoblin API')).toBeVisible({ timeout: 20_000 });
  event('global-outage-visible');
  releaseSecond.resolve();
  await until(() => secondDelivered, 'held preloss response delivery');
  const stale = page.getByText('Last observed, may be out of date', { exact: true });
  await expect(stale).toBeVisible({ timeout: 20_000 });
  await expect(heading).toBeVisible();
  await expect(answer).toHaveValue('{"approved":true}');
  assert.equal(await page.evaluate(() => navigator.onLine), true);
  for (const button of [
    submit,
    page.getByRole('button', { name: /Pause/ }),
    page.getByRole('button', { name: /Cancel run/ }),
    page.getByRole('button', { name: 'Replay...' }),
    page.getByRole('button', { name: 'Review delete-ready history' }),
  ]) await expect(button).toBeDisabled();
  await page.getByRole('form', { name: 'Submit input' }).evaluate((form) => form.requestSubmit());
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const pageWrites = () => evidence.requests.filter((item) => item.method !== 'GET');
  assert.deepEqual(pageWrites(), []);
  event('stale-gate-verified', { runGets });

  const restored = await api.post(`${server.control}/api/listener`, { data: { listening: true } });
  assert.equal(restored.status(), 200);
  assert.deepEqual(await restored.json(), { ok: true });
  listenerDown = false;
  restoredAt = Date.now();
  event('listener-restored');
  await until(
    () => evidence.responses.some((item) => item.path === runPath && item.status === 200 && item.atMs > restoredAt),
    'successful later browser run GET',
    45_000,
  );
  await expect(stale).toBeHidden({ timeout: 45_000 });
  await expect(submit).toBeEnabled();
  await expect(answer).toHaveValue('{"approved":true}');
  assert.deepEqual(pageWrites(), []);
  await submit.click();
  await until(() => pageWrites().some((item) => item.method === 'POST' && item.path === `${runPath}/input`), 'one deliberate input write');
  assert.deepEqual(pageWrites().map((item) => `${item.method} ${item.path}`), [`POST ${runPath}/input`]);
  await until(async () => {
    const res = await api.get(runPath);
    return res.ok() && (await res.json()).status === 'succeeded';
  }, 'run succeeded', 30_000);
  event('recovery-and-submit-verified');
  outcome = 'passed';
} catch (error) {
  failure = error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
  event('failure', failure);
  if (page) await page.screenshot({ path: join(out, 'failure.png'), fullPage: true }).catch(() => undefined);
} finally {
  releaseSecond?.resolve();
  if (listenerDown && api && server) {
    await api.post(`${server.control}/api/listener`, { data: { listening: true } }).catch(() => undefined);
    event('listener-restored-in-finally');
  }
  if (context) await context.tracing.stop({ path: join(out, 'trace.zip') }).catch(() => undefined);
  if (browser) await browser.close().catch(() => undefined);
  if (api) await api.dispose().catch(() => undefined);
  if (server) {
    server.child.stdin.end('stop\n');
    await Promise.race([
      new Promise((done) => server.child.once('exit', done)),
      new Promise((done) => setTimeout(done, 10_000)),
    ]);
    if (server.child.exitCode === null) server.child.kill('SIGTERM');
    await writeFile(join(out, 'gateway.log'), JSON.stringify(server.logs(), null, 2));
  }
  await writeFile(join(out, 'result.json'), JSON.stringify({ outcome, failure, ...evidence }, null, 2));
}
if (outcome !== 'passed') process.exitCode = 1;
