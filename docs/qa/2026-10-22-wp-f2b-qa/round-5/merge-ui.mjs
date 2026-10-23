import { chromium, expect } from '../../../../apps/web/node_modules/@playwright/test/index.mjs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../../../../packages/infrastructure/dist/sqlite/index.js';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const evidence = process.env.QA_OUTPUT_DIR
  ? resolve(process.env.QA_OUTPUT_DIR)
  : fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.QA_PORT ?? 5880);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid QA_PORT');
const prefix = process.env.QA_TEMP_PREFIX ?? 'gg-qa-204-r3-served-';
if (!/^[a-zA-Z0-9_-]+$/.test(prefix)) throw Error('Invalid QA_TEMP_PREFIX');
const dir = await mkdtemp(join(tmpdir(), prefix));
const bin = join(dir, 'bin'),
  base = `http://127.0.0.1:${port}`,
  results = [];
let activeCheck = 'environment';
const observations = [],
  caseTimes = [],
  allLogs = [],
  starts = new WeakMap();
function observe(p) {
  p.on('request', (r) => starts.set(r, { case: activeCheck, utc: new Date().toISOString() }));
  p.on('requestfinished', async (r) => {
    const initial = starts.get(r),
      response = await r.response();
    observations.push({
      ...initial,
      source: 'Edge',
      method: r.method(),
      path: new URL(r.url()).pathname,
      status: response?.status(),
      timing: r.timing(),
    });
  });
  p.on('requestfailed', (r) =>
    observations.push({
      ...starts.get(r),
      source: 'Edge',
      method: r.method(),
      path: new URL(r.url()).pathname,
      failure: r.failure(),
      timing: r.timing(),
    }),
  );
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const compile = spawn(
  'powershell.exe',
  [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    join(root, 'tooling/scripts/model-switch-fake-cli.ps1'),
    '-Directory',
    bin,
  ],
  { windowsHide: true, stdio: 'ignore' },
);
if ((await once(compile, 'exit'))[0] !== 0) throw Error('fixture compile failed');
let server,
  log = '',
  browser,
  page,
  id,
  counts;
async function start() {
  log = '';
  server = spawn(process.execPath, [join(root, 'apps/api/dist/main.js')], {
    cwd: root,
    windowsHide: true,
    env: {
      ...process.env,
      GG_HOST: '127.0.0.1',
      GG_PORT: String(port),
      GG_DATA_DIR: join(dir, 'data'),
      GG_DEFAULTS: '{"byHarness":{"claude":{"model":"claude-opus-5-5","effort":"high"}}}',
      GG_DB_URL: 'file:' + join(dir, 'data', 'graphgoblin.db').replaceAll('\\', '/'),
      GG_WEB_DIST: join(root, 'apps/web/dist'),
      GG_CODEX_BINARY: join(bin, 'codex.exe'),
      GG_CLAUDE_BINARY: join(bin, 'claude.exe'),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (x) => {
    log += x;
    allLogs.push(String(x));
  });
  server.stderr.on('data', (x) => {
    log += x;
    allLogs.push(String(x));
  });
  await expect
    .poll(
      () => {
        if (server.exitCode !== null) throw Error(log);
        return log.includes('"msg":"GraphGoblin API listening"');
      },
      { timeout: 60000 },
    )
    .toBe(true);
}
const exits = [];
async function stop() {
  if (server?.exitCode === null) {
    const p = once(server, 'exit');
    server.kill('SIGTERM');
    const [exitCode, signalCode] = await p;
    exits.push({ pid: server.pid, exitObserved: true, exitCode, signalCode });
  }
}
async function req(path, method = 'GET', data) {
  const began = performance.now(),
    caseId = activeCheck,
    utc = new Date().toISOString();
  const r = await fetch(base + path, {
    method,
    ...(data === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }),
  });
  const body = await r.json();
  observations.push({
    case: caseId,
    utc,
    source: 'Node fetch',
    method,
    path,
    status: r.status,
    durationMs: performance.now() - began,
  });
  return { status: r.status, body };
}
async function api(path, method = 'GET', data) {
  const r = await req(path, method, data);
  if (r.status >= 400)
    throw Error(method + ' ' + path + ' ' + r.status + ' ' + JSON.stringify(r.body));
  return r.body;
}
function def(o = {}) {
  return {
    schemaVersion: 4,
    name: 'Independent switch QA',
    settings: { defaults: { byHarness: o.defaults ?? {} } },
    nodes: [
      {
        id: 'start',
        kind: 'trigger',
        label: 'Start',
        config: { type: 'manual' },
        ui: { x: 0, y: 80 },
      },
      {
        id: 'infer',
        kind: 'inference',
        label: 'Infer',
        config: {
          harness: o.harness ?? 'codex',
          ...(o.inherit ? {} : { model: o.model ?? 'gpt-6-astra' }),
          ...(o.noEffort ? {} : { effort: o.effort ?? 'minimal' }),
          prompt: { template: 'Synthetic QA only' },
          harnessOptions: {
            sandbox: o.harness === 'claude' ? 'read-only' : 'workspace-write',
            approval: 'never',
          },
        },
        ui: { x: 260, y: 80 },
      },
      ...(o.sibling
        ? [
            {
              id: 'sibling',
              kind: 'inference',
              label: 'Sibling',
              config: {
                harness: 'claude',
                prompt: { template: 'Synthetic QA sibling' },
                harnessOptions: { sandbox: 'read-only', approval: 'never' },
              },
              ui: { x: 520, y: 80 },
            },
          ]
        : []),
      {
        id: 'done',
        kind: 'exit',
        label: 'Done',
        config: {},
        ui: { x: o.sibling ? 780 : 520, y: 80 },
      },
    ],
    edges: [
      { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'infer' } },
      {
        id: 'b',
        from: { node: 'infer', port: 'out' },
        to: { node: o.sibling ? 'sibling' : 'done' },
      },
      ...(o.sibling
        ? [{ id: 'c', from: { node: 'sibling', port: 'out' }, to: { node: 'done' } }]
        : []),
    ],
  };
}
const dialog = () => page.getByRole('dialog'),
  model = () => dialog().getByLabel('Model', { exact: true }),
  effort = () => dialog().getByLabel('Effort', { exact: true });
async function fields(m, e) {
  await expect(model()).toHaveValue(m);
  await expect(effort()).toHaveValue(e);
}
async function sw(h) {
  const r = dialog().getByRole('radio', { name: h, exact: true });
  await r.focus();
  await page.keyboard.press('Space');
}
async function open(o = {}, route) {
  await page?.unrouteAll({ behavior: 'wait' });
  await page?.close();
  page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 1000 } });
  observe(page);
  page.setDefaultTimeout(15000);
  counts = { catalog: 0, settings: 0, preflight: 0 };
  page.on('request', (r) => {
    if (r.method() !== 'GET') return;
    const p = new URL(r.url()).pathname;
    if (p === '/model-catalog') counts.catalog++;
    if (p === '/settings') counts.settings++;
    if (p === '/harness/preflight') counts.preflight++;
  });
  id = (await api('/loops', 'POST', { definition: def(o) })).loop.id;
  globalThis.qaLoopId = id;
  if (route) await route(page);
  await page.goto(base + '/app/loops/' + id + '/edit');
  await page.getByTestId('node-infer').click({ position: { x: 60, y: 12 } });
  await dialog()
    .getByRole('button', { name: /^Advanced/ })
    .click();
}
async function loaded() {
  await expect(model().locator('option[value="gpt-6-astra"]')).toBeAttached();
  await expect.poll(() => counts).toEqual({ catalog: 1, settings: 1, preflight: 1 });
}
async function done() {
  await dialog().getByRole('button', { name: 'Done', exact: true }).click();
}
async function requests() {
  try {
    return (await readFile(join(bin, 'requests.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(JSON.parse);
  } catch {
    return [];
  }
}
async function run() {
  const before = (await requests()).length;
  const { run } = await api('/loops/' + id + '/runs', 'POST', { input: null });
  await expect
    .poll(async () => (await api('/runs/' + run.id)).status, { timeout: 60000 })
    .toBe('succeeded');
  return (await requests()).slice(before);
}
async function persist() {
  await done();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await page.getByText('Published version 1.').waitFor();
  const config = (await api('/loops/' + id)).current.definition.nodes.find(
    (n) => n.id === 'infer',
  ).config;
  await page.reload();
  await page.getByTestId('node-infer').click({ position: { x: 60, y: 12 } });
  await dialog()
    .getByRole('button', { name: /^Advanced/ })
    .click();
  return {
    config,
    reopened: { model: await model().inputValue(), effort: await effort().inputValue() },
    requests: await run(),
  };
}
function sanitize(s) {
  return String(s)
    .replaceAll(root, '<checkout>/')
    .replaceAll(dir, '<disposable>')
    .replaceAll(root.replaceAll('\\', '/'), '<checkout>/')
    .replaceAll(dir.replaceAll('\\', '/'), '<disposable>');
}
async function check(id, steps, expected, fn) {
  if (process.env.QA_ONLY && !process.env.QA_ONLY.split(',').includes(id)) return;
  activeCheck = id;
  const caseStart = performance.now(),
    startedUtc = new Date().toISOString();
  try {
    await api('/settings', 'PUT', {
      defaults: {
        byHarness: {
          claude: { model: 'claude-opus-5-5', effort: 'xhigh' },
          codex: { model: 'gpt-6.1-sol', effort: 'high' },
        },
      },
    });
    const actual = await fn();
    results.push({ id, steps, expected, actual, verdict: actual?.qaFailure ? 'FAIL' : 'PASS' });
    console.log((actual?.qaFailure ? 'FAIL ' : 'PASS ') + id);
  } catch (e) {
    results.push({
      id,
      steps,
      expected,
      actual: {
        error: sanitize(e.stack),
        pageText: page
          ? await page
              .locator('body')
              .innerText()
              .catch(() => '')
          : '',
        loop: await api('/loops/' + globalThis.qaLoopId).catch(() => null),
      },
      verdict: 'FAIL',
    });
    console.log('FAIL ' + id + ': ' + e.message);
  }
  await writeFile(
    join(evidence, 'merge-results.json'),
    sanitize(JSON.stringify(results, null, 2)) + '\n',
  );
  caseTimes.push({
    id,
    startedUtc,
    elapsedMs: performance.now() - caseStart,
    assertionDefaultMs: 5000,
    pageDefaultMs: 15000,
  });
  await writeFile(
    join(evidence, 'merge-timings.json'),
    sanitize(JSON.stringify({ caseTimes, requests: observations }, null, 2)) +
      String.fromCharCode(10),
  );
}
let width = 1440;
const policy = () => dialog().getByLabel('Sandbox and approval policy', { exact: true });
const savedClaude = { harness: 'claude', model: 'claude-opus-5-5', effort: 'high' };
let native, overrideProblems;
const f1Profiles = JSON.parse(
  await readFile(join(evidence, 'f1-editor-profiles.json'), 'utf8'),
).profiles;
const labels = {
  ready: 'Ready',
  unknown: 'Unknown',
  'cli-missing': 'CLI not found',
  'cli-incompatible': 'CLI update needed',
  auth: 'Sign-in needed',
  quota: 'Usage limit',
  transport: 'Connection failed',
};
const details = {
  unknown:
    'Claude readiness could not be established. Inspect the local CLI setup, then retry preflight.',
  'cli-missing': 'Claude CLI was not found. Install Claude Code, then retry preflight.',
  'cli-incompatible': 'Claude CLI needs an update. Update Claude Code, then retry preflight.',
  auth: 'Claude sign-in is missing or invalid. Run claude auth login, then retry preflight.',
  quota: 'Claude reported a usage limit. Check account usage, then retry preflight.',
  transport:
    "Claude reported a connection or provider service error. Check the network connection and the provider's service status, then retry preflight.",
};
function stateBody(state) {
  const body = structuredClone(native);
  const c = body.items.find((x) => x.harness === 'claude');
  c.state = state;
  c.ok = state === 'ready';
  c.problems = overrideProblems ?? (state === 'ready' ? [] : [details[state]]);
  if (state !== 'ready') {
    delete c.authenticated;
    delete c.authMethod;
    if (state === 'auth') c.authenticated = false;
  }
  return body;
}
async function routeState(p, state) {
  await p.route('**/harness/preflight', (r) => r.fulfill({ json: stateBody(state) }));
}
async function noInventedLogin() {
  expect(await dialog().innerText()).not.toMatch(/signed out|not signed in|Sign-in needed/i);
}
async function capture(name) {
  const file = name + '-' + width + '.png';
  await page.screenshot({ path: join(evidence, file) });
  return file;
}
async function snapshot() {
  return {
    width,
    model: await model().inputValue(),
    effort: await effort().inputValue(),
    policyOptions: await policy().locator('option').allTextContents(),
    policyReadonly: await policy().getAttribute('aria-readonly'),
    modelReadonly: await model().getAttribute('aria-readonly'),
    text: await dialog().innerText(),
    counts: { ...counts },
  };
}
try {
  await start();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  native = await api('/harness/preflight');
  results.push({
    id: 'environment',
    verdict: 'PASS',
    actual: {
      node: process.version,
      edge: browser.version(),
      port,
      nativePreflight: native,
      tier: 'Built app in Edge, real disposable API and tooling fixture CLIs. Readiness fault/state matrix uses public HTTP route interception; no native provider parsing claim.',
    },
  });
  for (width of [1440, 390]) {
    await check(
      'ready-switch-' + width,
      'Ready preflight; explicit Codex Astra/minimal, loop Claude Fable/low; select Claude with keyboard, inspect policies, then switch back while policy shown.',
      'Fable/low and read-only/never; two supported policies; no switch-induced lookups; Codex policy control restored.',
      async () => {
        await open({ defaults: { claude: { model: 'claude-fable-5-1', effort: 'low' } } }, (p) =>
          routeState(p, 'ready'),
        );
        await loaded();
        await sleep(100);
        const before = { ...counts };
        await sw('claude');
        await fields('claude-fable-5-1', 'low');
        await expect(policy()).toHaveValue('0');
        expect(await policy().locator('option').count()).toBe(2);
        expect(await policy().getAttribute('aria-readonly')).toBe(null);
        const actual = await snapshot();
        actual.capture = await capture('ready-policy');
        expect(counts).toEqual(before);
        await sw('codex');
        await expect(dialog().getByLabel('Sandbox', { exact: true })).toBeVisible();
        await fields('gpt-6.1-sol', 'low');
        actual.afterBack = {
          model: await model().inputValue(),
          effort: await effort().inputValue(),
          counts: { ...counts },
        };
        expect(counts).toEqual(before);
        return actual;
      },
    );
    await check(
      'checking-switch-' + width,
      'Hold first readiness response, switch explicit Codex to Claude, release ready response.',
      'Waiting notice and authored fields while pending; then Fable/low and supported policy.',
      async () => {
        let release;
        const gate = new Promise((r) => (release = r));
        await open(
          { defaults: { claude: { model: 'claude-fable-5-1', effort: 'low' } } },
          async (p) =>
            p.route('**/harness/preflight', async (r) => {
              await gate;
              await r.fulfill({ json: stateBody('ready') });
            }),
        );
        await loaded();
        try {
          await sw('claude');
          await expect(dialog().getByText(/Waiting for the first model catalog/)).toBeVisible();
          await fields('gpt-6-astra', 'minimal');
          const held = { text: await dialog().innerText(), counts: { ...counts } };
          release();
          await fields('claude-fable-5-1', 'low');
          await expect(policy()).toHaveValue('0');
          return { held, settled: await snapshot() };
        } finally {
          release();
        }
      },
    );
    await check(
      'checking-policy-' + width,
      'Open saved Claude while first readiness response is held; inspect policy fallback; switch to Codex while policy is shown, then release ready.',
      'Checking line, saved unverified policy, retained model/effort while pending; switching completes once first response finishes.',
      async () => {
        let release;
        const gate = new Promise((r) => (release = r));
        await open(savedClaude, async (p) =>
          p.route('**/harness/preflight', async (r) => {
            await gate;
            await r.fulfill({ json: stateBody('ready') });
          }),
        );
        try {
          await expect(policy()).toHaveAttribute('aria-readonly', 'true');
          await expect(
            dialog().getByText('Claude readiness: Checking… The saved policy is unchanged.', {
              exact: true,
            }),
          ).toBeVisible();
          await fields('claude-opus-5-5', 'high');
          const held = await snapshot();
          await sw('codex');
          await expect(dialog().getByText(/Waiting for the first model catalog/)).toBeVisible();
          release();
          await fields('gpt-6.1-sol', 'high');
          await expect(dialog().getByLabel('Sandbox', { exact: true })).toBeVisible();
          return {
            held,
            settled: {
              model: await model().inputValue(),
              effort: await effort().inputValue(),
              counts: { ...counts },
            },
          };
        } finally {
          release();
        }
      },
    );
    for (const state of [
      'ready',
      'unknown',
      'cli-missing',
      'cli-incompatible',
      'auth',
      'quota',
      'transport',
    ]) {
      await check(
        'typed-' + state + '-' + width,
        'Open saved Claude with controlled public preflight state ' +
          state +
          '; inspect model/policy and typed readiness line.',
        'Ready: choices editable; otherwise saved values, read-only fallback, exact readinessLine; absent login evidence produces no invented sign-out.',
        async () => {
          await open(savedClaude, (p) => routeState(p, state));
          await expect.poll(() => counts.preflight).toBe(1);
          await fields('claude-opus-5-5', 'high');
          if (state === 'ready') {
            await expect(policy()).toHaveValue('0');
            expect(await policy().locator('option').count()).toBe(2);
            expect(await model().getAttribute('aria-readonly')).toBe(null);
          } else {
            await expect(policy()).toHaveAttribute('aria-readonly', 'true');
            await expect(model()).toHaveAttribute('aria-readonly', 'true');
            await expect(
              dialog().getByText(
                'Claude readiness: ' + labels[state] + '. The saved policy is unchanged.',
                { exact: true },
              ),
            ).toBeVisible();
            await expect(policy().locator('option:checked')).toHaveText(
              'Current policy: read-only / never (saved; not verified)',
            );
          }
          if (state !== 'auth') await noInventedLogin();
          const actual = await snapshot();
          if (state === 'transport') actual.capture = await capture('typed-transport');
          return actual;
        },
      );
    }
    for (const profile of f1Profiles) {
      await check(
        'F1-' + profile.id + '-' + width,
        'Replay signed-off F1 ' +
          profile.id +
          ' public state/problem in the current Claude editor.',
        'Saved values and policy pair retained; exact typed readiness line and supplied diagnostic; no sign-out inferred for unknown/quota/transport.',
        async () => {
          overrideProblems = profile.claudeProblems;
          try {
            await open(savedClaude, (p) => routeState(p, profile.state));
            await fields('claude-opus-5-5', 'high');
            if (profile.state === 'ready') {
              await expect(policy()).toHaveValue('0');
            } else {
              await expect(
                dialog().getByText(
                  'Claude readiness: ' + profile.label + '. The saved policy is unchanged.',
                  { exact: true },
                ),
              ).toBeVisible();
              await expect(model()).toHaveAttribute('aria-readonly', 'true');
              const text = await dialog().innerText();
              expect(text).toContain(profile.claudeProblems[0]);
            }
            if (profile.state !== 'auth') await noInventedLogin();
            const dimensions = await page.evaluate(() => ({
              innerWidth,
              scrollWidth: document.documentElement.scrollWidth,
            }));
            expect(dimensions.scrollWidth).toBeLessThanOrEqual(width);
            return { ...(await snapshot()), profile: profile.id, dimensions };
          } finally {
            overrideProblems = undefined;
          }
        },
      );
    }
    await check(
      'failed-switch-' + width,
      'Finished preflight state transport, switch explicit Codex Astra/minimal to Claude.',
      'Harness changes; model/effort retained; Connection failed switch notice and saved policy fallback; no new lookup.',
      async () => {
        await open({}, (p) => routeState(p, 'transport'));
        await loaded();
        await sleep(100);
        const before = { ...counts };
        await sw('claude');
        await expect(dialog().getByRole('radio', { name: 'claude', exact: true })).toBeChecked();
        await fields('gpt-6-astra', 'minimal');
        await expect(
          dialog().getByText(
            'Claude readiness: Connection failed. Model and effort are unchanged. Retry Claude preflight, then choose a model or switch harness again.',
            { exact: true },
          ),
        ).toBeVisible();
        await expect(policy()).toHaveAttribute('aria-readonly', 'true');
        await noInventedLogin();
        expect(counts).toEqual(before);
        return snapshot();
      },
    );
    await check(
      'unavailable-switch-' + width,
      'Fail completed public preflight HTTP lookup, switch explicit Codex to Claude; Retry Claude preflight with successful response.',
      'Could not check Claude readiness; retained model/effort, unverified policy; Retry restores choices without rewriting authored values or switch notice.',
      async () => {
        let failed = true;
        await open({}, async (p) =>
          p.route('**/harness/preflight', (r) =>
            r.fulfill(
              failed
                ? {
                    status: 503,
                    json: { code: 'QA_UNAVAILABLE', detail: 'Controlled QA lookup failure' },
                  }
                : { json: stateBody('ready') },
            ),
          ),
        );
        await loaded();
        await expect(dialog().getByText(/Could not check Codex readiness/)).toBeVisible();
        const before = { ...counts };
        await sw('claude');
        await expect(dialog().getByRole('radio', { name: 'claude', exact: true })).toBeChecked();
        const notice =
          'Could not check Claude readiness. Model and effort are unchanged. Retry Claude preflight, then choose a model or switch harness again.';
        await expect(dialog().getByText(notice, { exact: true })).toBeVisible();
        await fields('gpt-6-astra', 'minimal');
        await expect(policy()).toHaveAttribute('aria-readonly', 'true');
        expect(counts).toEqual(before);
        await noInventedLogin();
        const actual = await snapshot();
        actual.capture = await capture('lookup-unavailable');
        failed = false;
        await dialog().getByRole('button', { name: 'Retry Claude preflight', exact: true }).click();
        await expect(policy()).toHaveValue('0');
        await fields('gpt-6-astra', 'minimal');
        await expect(dialog().getByText(notice, { exact: true })).toBeVisible();
        actual.recovered = await snapshot();
        return actual;
      },
    );
    await check(
      'background-recheck-' + width,
      'Saved Claude ready; make stale focus refetch wait; inspect retained ready choices; release transport; Retry while holding another response, then recover ready.',
      'Background keeps last ready result; completed failure uses typed fallback; retry preserves last failed line until ready; authored values remain.',
      async () => {
        let phase = 'ready',
          release;
        let gate;
        await open(savedClaude, async (p) =>
          p.route('**/harness/preflight', async (r) => {
            if (phase === 'pending') {
              await gate;
              await r.fulfill({ json: stateBody('transport') });
            } else if (phase === 'retry-pending') {
              await gate;
              await r.fulfill({ json: stateBody('ready') });
            } else await r.fulfill({ json: stateBody('ready') });
          }),
        );
        await expect(policy()).toHaveValue('0');
        await fields('claude-opus-5-5', 'high');
        await sleep(2200);
        phase = 'pending';
        gate = new Promise((r) => (release = r));
        try {
          const before = counts.preflight;
          await page.evaluate(() => {
            Object.defineProperty(document, 'visibilityState', {
              configurable: true,
              value: 'hidden',
            });
            document.dispatchEvent(new Event('visibilitychange'));
            Object.defineProperty(document, 'visibilityState', {
              configurable: true,
              value: 'visible',
            });
            document.dispatchEvent(new Event('visibilitychange'));
          });
          await expect.poll(() => counts.preflight).toBe(before + 1);
          await expect(policy()).toHaveValue('0');
          expect(await policy().getAttribute('aria-readonly')).toBe(null);
          expect(await model().getAttribute('aria-readonly')).toBe(null);
          const heldReady = await snapshot();
          release();
          await expect(
            dialog().getByText(
              'Claude readiness: Connection failed. The saved policy is unchanged.',
              { exact: true },
            ),
          ).toBeVisible();
          const failed = await snapshot();
          phase = 'retry-pending';
          gate = new Promise((r) => (release = r));
          await dialog()
            .getByRole('button', { name: 'Retry Claude preflight', exact: true })
            .click();
          await expect.poll(() => counts.preflight).toBe(before + 2);
          await expect(
            dialog().getByText(
              'Claude readiness: Connection failed. The saved policy is unchanged.',
              { exact: true },
            ),
          ).toBeVisible();
          await expect(policy()).toHaveAttribute('aria-readonly', 'true');
          const heldFailed = await snapshot();
          release();
          await expect(policy()).toHaveValue('0');
          await fields('claude-opus-5-5', 'high');
          return { heldReady, failed, heldFailed, recovered: await snapshot() };
        } finally {
          release?.();
        }
      },
    );
  }
} finally {
  await page?.unrouteAll({ behavior: 'wait' });
  await browser?.close();
  await stop();
  await writeFile(
    join(evidence, 'merge-results.json'),
    sanitize(JSON.stringify(results, null, 2)) + '\n',
  );
  await writeFile(
    join(evidence, 'merge-timings.json'),
    sanitize(JSON.stringify({ caseTimes, requests: observations }, null, 2)) + '\n',
  );
  await writeFile(join(evidence, 'merge-api.log.txt'), sanitize(allLogs.join('')));
  await writeFile(
    join(evidence, 'merge-lifecycle.json'),
    JSON.stringify(
      {
        directory: dir.split(/[\\/]/).at(-1),
        processExited: exits.some((x) => x.pid === server?.pid),
        exits,
      },
      null,
      2,
    ) + '\n',
  );
}
if (results.some((x) => x.verdict === 'FAIL')) process.exitCode = 1;
