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
  server.stdout.on('data', (x) => (log += x));
  server.stderr.on('data', (x) => (log += x));
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
  const r = await fetch(base + path, {
    method,
    ...(data === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }),
  });
  return { status: r.status, body: await r.json() };
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
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
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
    join(evidence, 'served-results.json'),
    sanitize(JSON.stringify(results, null, 2)) + '\n',
  );
}
const failure = { status: 503, json: { code: 'QA_UNAVAILABLE', detail: 'Controlled QA failure' } };
try {
  await start();
  await api('/settings', 'PUT', {
    defaults: {
      byHarness: {
        claude: { model: 'claude-opus-5-5', effort: 'xhigh' },
        codex: { model: 'gpt-6.1-sol', effort: 'high' },
      },
    },
  });
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  results.push({
    id: 'environment',
    actual: {
      node: process.version,
      edge: browser.version(),
      port,
      preflight: await api('/harness/preflight'),
    },
    verdict: 'PASS',
  });
  await check(
    'B2-loop-sibling',
    'Settings Opus/xhigh, loop Fable/low, switch Astra/minimal; publish/reopen/run with inherited sibling.',
    'Both requests Fable/low; read-only/never; same saved/reopened values.',
    async () => {
      await api('/settings', 'PUT', {
        defaults: {
          byHarness: {
            claude: { model: 'claude-opus-5-5', effort: 'xhigh' },
            codex: { model: 'gpt-6.1-sol', effort: 'high' },
          },
        },
      });
      await open({
        defaults: { claude: { model: 'claude-fable-5-1', effort: 'low' } },
        sibling: true,
      });
      await loaded();
      await sw('claude');
      await fields('claude-fable-5-1', 'low');
      await expect(dialog().getByLabel('Sandbox and approval policy', { exact: true })).toHaveValue(
        '0',
      );
      const r = await persist();
      expect(r.config.harnessOptions).toEqual({ sandbox: 'read-only', approval: 'never' });
      expect(r.requests).toEqual([
        { model: 'claude-fable-5-1', effort: 'low' },
        { model: 'claude-fable-5-1', effort: 'low' },
      ]);
      return r;
    },
  );
  await check(
    'B1-no-wait',
    'Hold all three first responses; fully inheriting node switches both directions; release and publish/reopen/run.',
    'No wait or extra lookup; absent overrides persisted; Settings resolved at execution.',
    async () => {
      let release;
      const hold = new Promise((r) => (release = r));
      try {
        await open({ inherit: true, noEffort: true }, async (p) => {
          for (const path of ['model-catalog', 'settings', 'harness/preflight'])
            await p.route('**/' + path, async (r) => {
              await hold;
              await r.continue();
            });
        });
        await sw('claude');
        await expect(dialog().getByRole('radio', { name: 'claude', exact: true })).toBeChecked();
        await fields('', '');
        await expect(page.getByText(/Waiting for the first/)).toHaveCount(0);
        await sw('codex');
        await sw('claude');
        const before = { ...counts };
        expect(before).toEqual({ catalog: 1, settings: 1, preflight: 1 });
        release();
        await page.unrouteAll({ behavior: 'wait' });
        const r = await persist();
        expect(r.config).not.toHaveProperty('model');
        expect(r.config).not.toHaveProperty('effort');
        expect(r.requests).toEqual([{ model: 'claude-opus-5-5', effort: 'xhigh' }]);
        return { before, ...r };
      } finally {
        release?.();
        await page.unrouteAll({ behavior: 'wait' });
      }
    },
  );
  for (const [old, next] of [
    ['high', 'high'],
    ['minimal', 'xhigh'],
  ])
    await check(
      'effort-only-' + old,
      'Switch effort-only Codex ' + old + ' to Claude; persist/reopen/run.',
      'Model stays inherited; effort ' + next,
      async () => {
        await open({ inherit: true, effort: old });
        await loaded();
        await sw('claude');
        await expect(dialog().getByRole('radio', { name: 'claude', exact: true })).toBeChecked();
        await fields('', next);
        const r = await persist();
        expect(r.config).not.toHaveProperty('model');
        expect(r.config.effort).toBe(next);
        expect(r.requests).toEqual([{ model: 'claude-opus-5-5', effort: next }]);
        return r;
      },
    );
  await check(
    'B3-first-load',
    'Hold all initial queries; request switch during mount; release and save.',
    'Waiting then automatic Fable/low, one load each, draft saves.',
    async () => {
      let release;
      const hold = new Promise((r) => (release = r));
      let mount;
      try {
        await open(
          { defaults: { claude: { model: 'claude-fable-5-1', effort: 'low' } } },
          async (p) => {
            p.on('response', (r) => {
              if (r.url().endsWith('/loops/' + id)) mount = performance.now();
            });
            for (const path of ['model-catalog', 'settings', 'harness/preflight'])
              await p.route('**/' + path, async (r) => {
                await hold;
                await r.continue();
              });
          },
        );
        const elapsed = performance.now() - mount;
        await sw('claude');
        await expect(page.getByText(/Waiting for the first/)).toBeVisible();
        await expect(dialog().getByRole('radio', { name: 'codex', exact: true })).toBeChecked();
        const before = { ...counts };
        release();
        await page.unrouteAll({ behavior: 'wait' });
        await fields('claude-fable-5-1', 'low');
        const r = await persist();
        return { mountResponseToSwitchMs: Math.round(elapsed), before, ...r };
      } finally {
        release?.();
        await page.unrouteAll({ behavior: 'wait' });
      }
    },
  );
  for (const kind of ['catalog', 'settings', 'readiness'])
    await check(
      'failure-' + kind,
      'Inject ' +
        kind +
        ' failure; switch; inspect retry notice, validation and API draft rejection; recover.',
      'Authored values retained; named action under Harness; unavailable validation on catalog failure; incompatible write rejected.',
      async () => {
        let failed = true;
        const path = {
          catalog: 'model-catalog',
          settings: 'settings',
          readiness: 'harness/preflight',
        }[kind];
        const real = kind === 'readiness' ? await api('/harness/preflight') : null;
        await open({}, async (p) =>
          p.route('**/' + path, (r) =>
            failed
              ? kind === 'readiness'
                ? r.fulfill({
                    json: {
                      items: real.items.map((x) =>
                        x.harness === 'claude'
                          ? {
                              ...x,
                              state: 'auth',
                              ok: false,
                              authenticated: false,
                              problems: ['QA Claude sign-in needed'],
                            }
                          : x,
                      ),
                    },
                  })
                : r.fulfill(failure)
              : r.continue(),
          ),
        );
        if (kind === 'catalog')
          await dialog()
            .getByRole('button', { name: 'Retry model catalog', exact: true })
            .waitFor();
        else await loaded();
        await sw('claude');
        await fields('gpt-6-astra', 'minimal');
        await expect(dialog().getByRole('radio', { name: 'claude', exact: true })).toBeChecked();
        const notices = await dialog().getByRole('status').allTextContents();
        expect(notices.join(' ')).toMatch(
          {
            catalog: /Retry model catalog/,
            settings: /Reload the editor/,
            readiness: /Retry Claude preflight/,
          }[kind],
        );
        const unavailable = await page
          .getByText('Validation unavailable', { exact: true })
          .isVisible();
        if (kind === 'catalog') expect(unavailable).toBe(true);
        const denied = await req('/loops/' + id + '/draft', 'PUT', {
          definition: def({ harness: 'claude' }),
        });
        expect(denied.status).toBeGreaterThanOrEqual(400);
        const buttons = await dialog().getByRole('button').allTextContents();
        failed = false;
        if (kind === 'catalog')
          await dialog().getByRole('button', { name: 'Retry model catalog', exact: true }).click();
        if (kind === 'readiness')
          await dialog()
            .getByRole('button', { name: 'Retry Claude preflight', exact: true })
            .click();
        await page.unrouteAll({ behavior: 'wait' });
        await fields('gpt-6-astra', 'minimal');
        return { notices, buttons, validationUnavailable: unavailable, apiSave: denied };
      },
    );
  await check(
    'B3-known-failure',
    'Fail catalog while first Settings is held, switch, release.',
    'Immediate harness switch and retained authored fields; no wait or later rewrite.',
    async () => {
      let release;
      const hold = new Promise((r) => (release = r));
      try {
        await open({}, async (p) => {
          await p.route('**/model-catalog', (r) => r.fulfill(failure));
          await p.route('**/settings', async (r) => {
            await hold;
            await r.continue();
          });
        });
        await dialog().getByRole('button', { name: 'Retry model catalog', exact: true }).waitFor();
        await sw('claude');
        await expect(dialog().getByRole('radio', { name: 'claude', exact: true })).toBeChecked();
        await fields('gpt-6-astra', 'minimal');
        await expect(page.getByText(/Waiting for the first/)).toHaveCount(0);
        release();
        await page.unrouteAll({ behavior: 'wait' });
        await fields('gpt-6-astra', 'minimal');
        return { counts, notices: await dialog().getByRole('status').allTextContents() };
      } finally {
        release?.();
        await page.unrouteAll({ behavior: 'wait' });
      }
    },
  );
  await check(
    'B3-retry-not-first',
    'Fail catalog; hold explicit retry; switch; release and explicitly correct/save.',
    'No first-load queue or later rewrite; corrected draft saves.',
    async () => {
      let attempt = 0,
        release,
        retrying = false;
      const hold = new Promise((r) => (release = r));
      try {
        await open({}, async (p) =>
          p.route('**/model-catalog', async (r) => {
            attempt++;
            if (!retrying) await r.fulfill(failure);
            else {
              await hold;
              await r.continue();
            }
          }),
        );
        await expect(
          dialog().getByRole('button', { name: 'Retry model catalog', exact: true }),
        ).toBeEnabled();
        retrying = true;
        await dialog().getByRole('button', { name: 'Retry model catalog', exact: true }).click();
        await expect.poll(() => attempt).toBeGreaterThanOrEqual(2);
        await sw('claude');
        await expect(dialog().getByRole('radio', { name: 'claude', exact: true })).toBeChecked();
        await fields('gpt-6-astra', 'minimal');
        await expect(page.getByText(/Waiting for the first/)).toHaveCount(0);
        release();
        await page.unrouteAll({ behavior: 'wait' });
        await fields('gpt-6-astra', 'minimal');
        await sw('codex');
        await sw('claude');
        await fields('claude-opus-5-5', 'xhigh');
        return { attempt, ...(await persist()) };
      } finally {
        release?.();
        await page.unrouteAll({ behavior: 'wait' });
      }
    },
  );
  await check(
    'no-extra-lookups',
    'After shared loads, open Start and Done, then Infer and switch.',
    'Request counts remain exactly one each.',
    async () => {
      await open();
      await loaded();
      await done();
      const before = { ...counts };
      for (const n of ['start', 'done', 'infer']) {
        await page.getByTestId('node-' + n).click({ position: { x: 60, y: 12 } });
        if (n !== 'infer') await done();
        else {
          await dialog()
            .getByRole('button', { name: /^Advanced/ })
            .click();
          await sw('claude');
          await fields('claude-opus-5-5', 'xhigh');
        }
      }
      expect(counts).toEqual(before);
      return { before, after: counts };
    },
  );
  await check(
    'undo-switch',
    'Switch to Claude then one Undo/Redo. Disable both Claude entries, switch and Undo warning.',
    'Harness/model/effort/policy are one history step, Undo clears notice and disabled flags stay off.',
    async () => {
      await open();
      await loaded();
      await sw('claude');
      await fields('claude-opus-5-5', 'xhigh');
      await page.keyboard.press('Control+z');
      await fields('gpt-6-astra', 'minimal');
      await expect(dialog().getByRole('radio', { name: 'codex', exact: true })).toBeChecked();
      await page.keyboard.press('Control+Shift+z');
      await fields('claude-opus-5-5', 'xhigh');
      await expect(dialog().getByLabel('Sandbox and approval policy', { exact: true })).toHaveValue(
        '0',
      );
      for (const m of ['claude-fable-5-1', 'claude-opus-5-5'])
        await api('/model-catalog/claude/' + m, 'PATCH', { enabled: false });
      try {
        await open();
        await loaded();
        await sw('claude');
        await fields('gpt-6-astra', 'minimal');
        await expect(
          page.getByText(/No enabled compatible configured or ecosystem default/),
        ).toBeVisible();
        const notice = await dialog().getByRole('status').allTextContents();
        await page.keyboard.press('Control+z');
        await expect(
          page.getByText(/No enabled compatible configured or ecosystem default/),
        ).toHaveCount(0);
        return {
          notice,
          catalog: (await api('/model-catalog')).items
            .filter((x) => x.harness === 'claude')
            .map((x) => ({ model: x.model, enabled: x.enabled })),
        };
      } finally {
        for (const m of ['claude-fable-5-1', 'claude-opus-5-5'])
          await api('/model-catalog/claude/' + m, 'PATCH', { enabled: true });
      }
    },
  );
  await check(
    'restart',
    'Save/publish Fable/low; stop owned API and start new process on same disposable store; reopen/run.',
    'Values survive real process restart and request remains Fable/low.',
    async () => {
      await open({ defaults: { claude: { model: 'claude-fable-5-1', effort: 'low' } } });
      await loaded();
      await sw('claude');
      await fields('claude-fable-5-1', 'low');
      await persist();
      const old = server.pid;
      await stop();
      await start();
      await page.reload();
      await page.getByTestId('node-infer').click({ position: { x: 60, y: 12 } });
      await dialog()
        .getByRole('button', { name: /^Advanced/ })
        .click();
      await fields('claude-fable-5-1', 'low');
      const r = await run();
      expect(r).toEqual([{ model: 'claude-fable-5-1', effort: 'low' }]);
      return { newProcess: old !== server.pid, requests: r };
    },
  );

  await check(
    'recipe-ui',
    'Follow configured-default recipe in Settings, both editor switch directions, save/reopen/reload, publish, Open in Runs and Start run.',
    'Settings Sol/high and Opus/xhigh; loop Astra/low and Fable/low override them; actual CLI requests agree.',
    async () => {
      await api('/settings', 'PUT', { defaults: { byHarness: {} } });
      await page?.close();
      page = await browser.newPage();
      await page?.close();
      page = await browser.newPage();
      await page.goto(base + '/app/settings');
      async function select(label, value) {
        const r = page.waitForResponse(
          (r) =>
            r.url().startsWith(base + '/settings') &&
            ['PUT', 'DELETE'].includes(r.request().method()),
        );
        await page.getByLabel(label, { exact: true }).selectOption(value);
        expect((await r).ok()).toBe(true);
      }
      await select('Default model', 'gpt-6.1-sol');
      await select('Default effort', 'high');
      await select('Default model (claude)', 'claude-opus-5-5');
      await select('Default effort (claude)', 'xhigh');
      const settings = await api('/settings');
      await open({
        harness: 'claude',
        model: 'claude-opus-5-5',
        effort: 'high',
        defaults: {
          codex: { model: 'gpt-6-astra', effort: 'low' },
          claude: { model: 'claude-fable-5-1', effort: 'low' },
        },
      });
      await fields('claude-opus-5-5', 'high');
      await sw('codex');
      await fields('gpt-6-astra', 'high');
      await expect(dialog().getByRole('radio', { name: 'codex', exact: true })).toBeFocused();
      await effort().selectOption('minimal');
      await sw('claude');
      await fields('claude-fable-5-1', 'low');
      await sw('codex');
      await fields('gpt-6-astra', 'low');
      await sw('claude');
      await fields('claude-fable-5-1', 'low');
      const saved = await persist();
      await fields('claude-fable-5-1', 'low');
      await done();
      async function uiRun() {
        const before = (await requests()).length;
        await page.getByRole('link', { name: 'Open in Runs' }).first().click();
        await page.getByRole('button', { name: 'Start run', exact: true }).click();
        await expect(page).toHaveURL(/\/app\/runs\/[0-9A-Z]{26}$/);
        await expect(page.locator('[data-status="succeeded"]').first()).toBeVisible();
        return (await requests()).slice(before);
      }
      const claudeRun = await uiRun();
      expect(claudeRun).toEqual([{ model: 'claude-fable-5-1', effort: 'low' }]);
      await page.goto(base + '/app/loops/' + id + '/edit');
      await page.getByTestId('node-infer').click({ position: { x: 60, y: 12 } });
      await dialog()
        .getByRole('button', { name: /^Advanced/ })
        .click();
      await sw('codex');
      await fields('gpt-6-astra', 'low');
      await done();
      await page.getByRole('button', { name: 'Publish', exact: true }).click();
      await page.getByText('Published version 2.').waitFor();
      const codexRun = await uiRun();
      expect(codexRun).toEqual([{ model: 'gpt-6-astra', effort: 'low' }]);
      return { settings: settings.defaults, saved, claudeRun, codexRun };
    },
  );
  await check(
    'recipe-absent-disabled',
    'Clear Settings efforts then models in UI; verify ecosystem choices; configure Fable/xhigh, disable it in Settings catalog, switch; disable Opus and inspect blocked state; restore without rewrite.',
    'Opus/high and Luna/high with absent defaults; disabled defaults not re-enabled; no enabled default retains authored values.',
    async () => {
      await page?.close();
      page = await browser.newPage();
      await page.goto(base + '/app/settings');
      async function select(label, value) {
        const loc = page.getByLabel(label, { exact: true });
        await expect(loc).toBeVisible();
        if ((await loc.inputValue()) === value) return;
        const r = page.waitForResponse(
          (r) =>
            r.url().startsWith(base + '/settings') &&
            ['PUT', 'DELETE'].includes(r.request().method()),
        );
        await loc.selectOption(value);
        expect((await r).ok()).toBe(true);
      }
      for (const suffix of ['', ' (claude)']) {
        await select('Default effort' + suffix, '');
        await select('Default model' + suffix, '');
      }
      await open();
      await loaded();
      await sw('claude');
      await fields('claude-opus-5-5', 'high');
      await sw('codex');
      await fields('gpt-6-luna', 'high');
      await page.goto(base + '/app/settings');
      await select('Default model (claude)', 'claude-fable-5-1');
      await select('Default effort (claude)', 'xhigh');
      const toggle = page.getByRole('switch', { name: 'Enable Claude Fable 5.1', exact: true });
      await toggle.click();
      await expect(toggle).not.toBeChecked();
      try {
        await open();
        await loaded();
        await sw('claude');
        await fields('claude-opus-5-5', 'xhigh');
        const preference = (await api('/model-catalog')).items.find(
          (x) => x.model === 'claude-fable-5-1',
        ).enabled;
        expect(preference).toBe(false);
        await api('/model-catalog/claude/claude-opus-5-5', 'PATCH', { enabled: false });
        await open();
        await loaded();
        await sw('claude');
        await expect(dialog().getByRole('radio', { name: 'claude', exact: true })).toBeChecked();
        await fields('gpt-6-astra', 'minimal');
        await expect(
          page.getByText(/No enabled compatible configured or ecosystem default/),
        ).toBeVisible();
        const notice = await dialog().getByRole('status').allTextContents();
        await page.keyboard.press('Control+z');
        await expect(
          page.getByText(/No enabled compatible configured or ecosystem default/),
        ).toHaveCount(0);
        for (const m of ['claude-fable-5-1', 'claude-opus-5-5'])
          await api('/model-catalog/claude/' + m, 'PATCH', { enabled: true });
        await page.reload();
        await page.getByTestId('node-infer').click({ position: { x: 60, y: 12 } });
        await dialog()
          .getByRole('button', { name: /^Advanced/ })
          .click();
        await fields('gpt-6-astra', 'minimal');
        await sw('claude');
        await fields('claude-fable-5-1', 'xhigh');
        return {
          preference,
          notice,
          recovered: { model: await model().inputValue(), effort: await effort().inputValue() },
        };
      } finally {
        for (const m of ['claude-fable-5-1', 'claude-opus-5-5'])
          await api('/model-catalog/claude/' + m, 'PATCH', { enabled: true });
      }
    },
  );
  await check(
    'effort-only-cleared',
    'No configured effort; controlled catalog suggests unsupported minimal for Claude; switch effort-only Codex minimal.',
    'Model remains absent and effort clears to inheritance; saved/reopened config has neither property; effort inherits high from the process configuration.',
    async () => {
      await api('/settings', 'PUT', { defaults: { byHarness: {} } });
      const catalog = await api('/model-catalog');
      await open({ inherit: true, defaults: { claude: { model: 'claude-opus-5-5' } } }, async (p) =>
        p.route('**/model-catalog', (r) =>
          r.fulfill({
            json: {
              items: catalog.items.map((x) =>
                x.harness === 'claude' ? { ...x, defaultEffort: 'minimal' } : x,
              ),
            },
          }),
        ),
      );
      await loaded();
      await sw('claude');
      await expect(dialog().getByRole('radio', { name: 'claude', exact: true })).toBeChecked();
      await fields('', '');
      const r = await persist();
      expect(r.config).not.toHaveProperty('model');
      expect(r.config).not.toHaveProperty('effort');
      expect(r.requests).toEqual([{ model: 'claude-opus-5-5', effort: 'high' }]);
      return {
        controlledCatalog: true,
        processDefaults: '{"byHarness":{"claude":{"model":"claude-opus-5-5","effort":"high"}}}',
        ...r,
      };
    },
  );
  await check(
    'ecosystem-flag',
    'Controlled successful catalog swaps Claude ecosystemDefault flags and Settings has an incompatible model.',
    'Explicit switch uses the flagged supported Fable, proving no hard-coded web default.',
    async () => {
      await api('/settings', 'PUT', { defaults: { byHarness: {} } });
      const catalog = await api('/model-catalog');
      await open({}, async (p) => {
        await p.route('**/model-catalog', (r) =>
          r.fulfill({
            json: {
              items: catalog.items.map((x) =>
                x.harness === 'claude'
                  ? { ...x, ecosystemDefault: x.model === 'claude-fable-5-1' }
                  : x,
              ),
            },
          }),
        );
        await p.route('**/settings', (r) =>
          r.fulfill({
            json: { defaults: { byHarness: { claude: { model: 'gpt-6-astra', effort: 'high' } } } },
          }),
        );
      });
      await loaded();
      await sw('claude');
      await fields('claude-fable-5-1', 'high');
      return {
        controlledResponses: true,
        model: await model().inputValue(),
        effort: await effort().inputValue(),
      };
    },
  );

  await check(
    'cached-catalog-failure',
    'Cache Codex Astra/minimal, wait 2.1s, fail visibility-triggered catalog refetch, switch Claude, retry catalog.',
    'Unavailable status and disabled Publish have catalog tooltip; values/notice retained; switch adds no lookup; retry restores saved-draft readiness; API refuses incompatible values.',
    async () => {
      let failed = false;
      await open({}, (p) =>
        p.route('**/model-catalog', (r) => (failed ? r.fulfill(failure) : r.continue())),
      );
      await loaded();
      await expect(page.getByText('Ready to publish', { exact: true })).toBeVisible();
      await page.waitForTimeout(2100);
      failed = true;
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
        Reflect.deleteProperty(document, 'visibilityState');
        document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
      });
      const retry = dialog().getByRole('button', { name: 'Retry model catalog', exact: true });
      await expect(retry).toBeEnabled();
      await expect(model()).toHaveAccessibleDescription(/catalog may be out of date/);
      const before = { ...counts };
      await sw('claude');
      await expect(dialog().getByRole('radio', { name: 'claude', exact: true })).toBeChecked();
      await fields('gpt-6-astra', 'minimal');
      const status = page.getByText('Validation unavailable', { exact: true });
      const publish = page.getByRole('button', { name: 'Publish', exact: true });
      const reason = 'A model catalog could not be loaded. Retry its lookup before publishing.';
      await expect(status).toBeVisible();
      await expect(status).toHaveAttribute('title', reason);
      await expect(publish).toBeDisabled();
      await expect(publish).toHaveAttribute('title', reason);
      await expect(page.getByText('Ready to publish', { exact: true })).toHaveCount(0);
      expect(counts).toEqual(before);
      const notice = dialog().getByText(
        /Validation is unavailable while the catalog cannot be loaded/,
      );
      const message = await notice.textContent();
      const during = {
        counts: { ...counts },
        model: await model().inputValue(),
        effort: await effort().inputValue(),
        notice: message,
        status: await status.textContent(),
        publishDisabled: await publish.isDisabled(),
        publishTitle: await publish.getAttribute('title'),
      };
      failed = false;
      await retry.click();
      await expect(model()).not.toHaveAttribute('aria-readonly', 'true');
      await fields('gpt-6-astra', 'minimal');
      await expect(notice).toHaveText(message);
      await expect(page.getByText('Ready to publish', { exact: true })).toBeVisible();
      await expect(publish).toBeEnabled();
      const definition = def({ harness: 'claude' });
      const validation = await req('/loops/' + id + '/validate', 'POST', { definition });
      expect(validation.status).toBe(200);
      expect(validation.body.publishable).toBe(false);
      expect(validation.body.issues.some((x) => x.code === 'MODEL_HARNESS_MISMATCH')).toBe(true);
      const denied = await req('/loops/' + id + '/draft', 'PUT', { definition });
      expect(denied.status).toBe(400);
      expect(denied.body.errors.some((x) => x.code === 'MODEL_HARNESS_MISMATCH')).toBe(true);
      expect(
        (await api('/loops/' + id)).draft.definition.nodes.find((n) => n.id === 'infer').config
          .harness,
      ).toBe('codex');
      return {
        before,
        during,
        recovery: {
          counts: { ...counts },
          model: await model().inputValue(),
          effort: await effort().inputValue(),
          notice: await notice.textContent(),
          ready: true,
          publishEnabled: true,
        },
        apiValidation: validation,
        apiSave: denied,
        savedDraftHarness: 'codex',
      };
    },
  );
  await check(
    'server-check-only-failure',
    'Block only POST /validate on valid saved draft; inspect tooltips; close unchanged dialog and publish.',
    'Default unavailable tooltip; Publish enabled; POST /publish retries real server validation and succeeds.',
    async () => {
      let checks = 0,
        publishes = 0;
      await open({}, async (p) => {
        p.on('request', (r) => {
          if (r.method() === 'POST' && r.url().endsWith('/publish')) publishes++;
        });
        await p.route('**/loops/*/validate', (r) => {
          checks++;
          return r.fulfill(failure);
        });
      });
      await loaded();
      const status = page.getByText('Validation unavailable', { exact: true });
      await expect(status).toBeVisible();
      const title = await status.getAttribute('title');
      expect(title).toContain(
        'checks (cron expressions, subloops) could not run; Publish runs them again.',
      );
      const publish = page.getByRole('button', { name: 'Publish', exact: true });
      await expect(publish).toBeEnabled();
      expect(await publish.getAttribute('title')).toBeNull();
      const before = { checks, publishes, counts: { ...counts } };
      await done();
      await publish.click();
      await expect(page.getByText('Published version 1.')).toBeVisible();
      expect(publishes).toBe(1);
      expect((await api('/loops/' + id)).current.version).toBe(1);
      return {
        title,
        publishEnabled: true,
        before,
        after: { checks, publishes, counts: { ...counts } },
        published: 1,
        note: 'POST /publish runs real server validation again; background /validate remains deliberately blocked.',
      };
    },
  );
  await check(
    'classifier-catalog-failure',
    'Cache classifier catalog, fail only its stale visibility refetch; unblock and reload.',
    'Cached classifier error uses catalog tooltip and disables Publish; recovery restores readiness.',
    async () => {
      let failed = false;
      await open({}, (p) =>
        p.route('**/classifier-models', (r) => (failed ? r.fulfill(failure) : r.continue())),
      );
      await loaded();
      await expect(page.getByText('Ready to publish', { exact: true })).toBeVisible();
      await page.waitForTimeout(2100);
      failed = true;
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
        Reflect.deleteProperty(document, 'visibilityState');
        document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
      });
      await expect(page.getByText('Validation unavailable', { exact: true })).toBeVisible();
      const publish = page.getByRole('button', { name: 'Publish', exact: true });
      await expect(publish).toBeDisabled();
      const title = await publish.getAttribute('title');
      expect(title).toBe(
        'A model catalog could not be loaded. Retry its lookup before publishing.',
      );
      failed = false;
      await done();
      await page.reload();
      await expect(page.getByText('Ready to publish', { exact: true })).toBeVisible();
      await expect(publish).toBeEnabled();
      return {
        title,
        publishDisabledDuringFailure: true,
        recovery: 'Unblock and reload restores readiness',
      };
    },
  );
  await check(
    'api-publication-defense',
    'Validate/save invalid Claude/Astra/minimal; seed exact normalized rejected definition only into owned disposable draft; POST /publish; restore.',
    'Validate false; save 400; final publication 422 MODEL_HARNESS_MISMATCH with no published version.',
    async () => {
      const { loop } = await api('/loops', 'POST', { definition: def() });
      const good = await api('/loops/' + loop.id);
      const definition = structuredClone(good.draft.definition);
      Object.assign(definition.nodes.find((n) => n.id === 'infer').config, {
        harness: 'claude',
        model: 'gpt-6-astra',
        effort: 'minimal',
        harnessOptions: { sandbox: 'read-only', approval: 'never' },
      });
      const validation = await req('/loops/' + loop.id + '/validate', 'POST', { definition });
      const save = await req('/loops/' + loop.id + '/draft', 'PUT', { definition });
      expect(validation.body.publishable).toBe(false);
      expect(save.status).toBe(400);
      const db = openDatabase({
        url: 'file:' + join(dir, 'data', 'graphgoblin.db').replaceAll('\\', '/'),
      });
      try {
        await db.client.execute({
          sql: "UPDATE loop_versions SET definition=? WHERE id=? AND status='draft'",
          args: [JSON.stringify(definition), good.draft.id],
        });
        expect(
          (await api('/loops/' + loop.id)).draft.definition.nodes.find((n) => n.id === 'infer')
            .config.harness,
        ).toBe('claude');
        const publish = await req('/loops/' + loop.id + '/publish', 'POST', {});
        expect(publish.status).toBe(422);
        expect(publish.body.errors.some((x) => x.code === 'MODEL_HARNESS_MISMATCH')).toBe(true);
        expect((await api('/loops/' + loop.id)).current).toBeUndefined();
        return {
          fixture:
            'API rejects admission; direct normalized row seed only in owned disposable store.',
          validation,
          save,
          publish,
          publishedVersionCreated: false,
        };
      } finally {
        await db.client.execute({
          sql: "UPDATE loop_versions SET definition=? WHERE id=? AND status='draft'",
          args: [JSON.stringify(good.draft.definition), good.draft.id],
        });
        db.close();
      }
    },
  );
  await check(
    'B1-all-failed',
    'Return failures for all shared lookups, then switch fully inheriting node both directions.',
    'No wait or extra request; no explicit fields appear despite failed checks.',
    async () => {
      const finished = { catalog: 0, settings: 0, preflight: 0 };
      await open({ inherit: true, noEffort: true }, async (p) => {
        p.on('requestfinished', (r) => {
          if (r.method() !== 'GET') return;
          const path = new URL(r.url()).pathname;
          if (path === '/model-catalog') finished.catalog++;
          if (path === '/settings') finished.settings++;
          if (path === '/harness/preflight') finished.preflight++;
        });
        for (const path of ['model-catalog', 'settings', 'harness/preflight'])
          await p.route('**/' + path, (r) => r.fulfill(failure));
      });
      // Bootstrap retries each failed lookup once. Observe every response, not just the
      // first Retry control, so unfinished initial requests cannot count as switch fetches.
      await expect.poll(() => finished).toEqual({ catalog: 2, settings: 2, preflight: 2 });
      await page.waitForLoadState('networkidle');
      await dialog().getByRole('button', { name: 'Retry model catalog', exact: true }).waitFor();
      await dialog().getByRole('button', { name: 'Retry Codex preflight', exact: true }).waitFor();
      const initiallySettled = { ...finished };
      const before = { ...counts };
      await sw('claude');
      await expect(dialog().getByRole('radio', { name: 'claude', exact: true })).toBeChecked();
      await fields('', '');
      await sw('codex');
      await expect(dialog().getByRole('radio', { name: 'codex', exact: true })).toBeChecked();
      await fields('', '');
      await expect(page.getByText(/Waiting for the first/)).toHaveCount(0);
      expect(counts).toEqual(before);
      expect(finished).toEqual(initiallySettled);
      return { initiallySettled, before, after: { ...counts } };
    },
  );
  await check(
    'effort-only-failed',
    'Fail catalog and switch effort-only Codex minimal to Claude.',
    'Inherited model stays absent and authored minimal effort stays; API rejects incompatible draft.',
    async () => {
      await open({ inherit: true }, (p) => p.route('**/model-catalog', (r) => r.fulfill(failure)));
      await dialog().getByRole('button', { name: 'Retry model catalog', exact: true }).waitFor();
      await sw('claude');
      await expect(dialog().getByRole('radio', { name: 'claude', exact: true })).toBeChecked();
      await fields('', 'minimal');
      const rejected = await req('/loops/' + id + '/draft', 'PUT', {
        definition: def({ harness: 'claude', inherit: true }),
      });
      expect(rejected.status).toBe(400);
      return { model: await model().inputValue(), effort: await effort().inputValue(), rejected };
    },
  );
  await check(
    'pending-dismiss',
    'Hold first Settings, request explicit switch, dismiss dialog, release response and reopen.',
    'Pending action cancels; original harness/model/effort remain; later explicit switch succeeds.',
    async () => {
      let release;
      const hold = new Promise((r) => (release = r));
      try {
        await open({}, (p) =>
          p.route('**/settings', async (r) => {
            await hold;
            await r.continue();
          }),
        );
        await sw('claude');
        await expect(page.getByText(/Waiting for the first/)).toBeVisible();
        await done();
        release();
        await page.unrouteAll({ behavior: 'wait' });
        await page.getByTestId('node-infer').click({ position: { x: 60, y: 12 } });
        await dialog()
          .getByRole('button', { name: /^Advanced/ })
          .click();
        await expect(dialog().getByRole('radio', { name: 'codex', exact: true })).toBeChecked();
        await fields('gpt-6-astra', 'minimal');
        await sw('claude');
        await fields('claude-opus-5-5', 'xhigh');
        return { cancelled: true, ...(await persist()) };
      } finally {
        release?.();
        await page.unrouteAll({ behavior: 'wait' });
      }
    },
  );

  await check(
    'pending-prompt-edit',
    'Hold initial Settings, request Claude, edit the prompt, then release Settings.',
    'Cancelled action clears its waiting notice; Codex/Astra/minimal and the edited prompt save and reopen.',
    async () => {
      let release;
      const hold = new Promise((r) => (release = r));
      const edited = 'Edited while the harness switch was pending';
      try {
        await open({}, (p) =>
          p.route('**/settings', async (r) => {
            await hold;
            await r.continue();
          }),
        );
        await sw('claude');
        await expect(page.getByText(/Waiting for the first/)).toBeVisible();
        const prompt = dialog().getByRole('textbox', { name: 'Template', exact: true });
        await prompt.fill(edited);
        await expect(prompt).toHaveText(edited);
        const readConfig = async () =>
          (await api('/loops/' + id)).draft.definition.nodes.find((n) => n.id === 'infer').config;
        await expect.poll(async () => (await readConfig()).prompt.template).toBe(edited);
        const settings = page.waitForResponse((r) => new URL(r.url()).pathname === '/settings');
        release();
        await (await settings).finished();
        await expect(dialog().getByRole('radio', { name: 'codex', exact: true })).toBeChecked();
        await fields('gpt-6-astra', 'minimal');
        await expect(page.getByText(/The harness change will apply/)).toHaveCount(0);
        const config = await readConfig();
        expect(config).toMatchObject({
          harness: 'codex',
          model: 'gpt-6-astra',
          effort: 'minimal',
          prompt: { template: edited },
        });
        await done();
        await page.reload();
        await page.getByTestId('node-infer').click({ position: { x: 60, y: 12 } });
        await dialog()
          .getByRole('button', { name: /^Advanced/ })
          .click();
        await fields('gpt-6-astra', 'minimal');
        await expect(dialog().getByRole('radio', { name: 'codex', exact: true })).toBeChecked();
        await expect(dialog().getByRole('textbox', { name: 'Template', exact: true })).toHaveText(
          edited,
        );
        return { cancelled: true, waitingNoticeCleared: true, config };
      } finally {
        release?.();
        await page.unrouteAll({ behavior: 'wait' });
      }
    },
  );

  await check(
    'undo-persistence',
    'Switch to Claude, save; one Undo and save; one Redo and save. Read public draft after each.',
    'Harness, model, effort and sandbox/approval policy restore together in one history step.',
    async () => {
      await open();
      await loaded();
      await sw('claude');
      await fields('claude-opus-5-5', 'xhigh');
      await done();
      const read = async () => {
        const d = await api('/loops/' + id);
        const c = (d.draft ?? d.current).definition.nodes.find((n) => n.id === 'infer').config;
        return {
          harness: c.harness,
          model: c.model,
          effort: c.effort,
          harnessOptions: c.harnessOptions,
        };
      };
      await expect.poll(read, { timeout: 15000 }).toEqual({
        harness: 'claude',
        model: 'claude-opus-5-5',
        effort: 'xhigh',
        harnessOptions: { sandbox: 'read-only', approval: 'never' },
      });
      async function reopen(h) {
        await page.getByTestId('node-infer').click({ position: { x: 60, y: 12 } });
        await dialog()
          .getByRole('button', { name: /^Advanced/ })
          .click();
        await dialog().getByRole('radio', { name: h, exact: true }).focus();
      }
      await reopen('claude');
      await page.keyboard.press('Control+z');
      await fields('gpt-6-astra', 'minimal');
      await done();
      const old = {
        harness: 'codex',
        model: 'gpt-6-astra',
        effort: 'minimal',
        harnessOptions: { sandbox: 'workspace-write', approval: 'never' },
      };
      await expect.poll(read, { timeout: 15000 }).toEqual(old);
      const undone = await read();
      await reopen('codex');
      await page.keyboard.press('Control+Shift+z');
      await fields('claude-opus-5-5', 'xhigh');
      await done();
      const next = {
        harness: 'claude',
        model: 'claude-opus-5-5',
        effort: 'xhigh',
        harnessOptions: { sandbox: 'read-only', approval: 'never' },
      };
      await expect.poll(read, { timeout: 15000 }).toEqual(next);
      return { undone, redone: await read() };
    },
  );

  await check(
    'B2-disabled-loop-and-settings',
    'Start with loop Fable/low and Settings Fable/xhigh, disable Fable after loop creation, reload catalog, then switch an explicit Codex node.',
    'Neither disabled configured model is chosen; flagged Opus is chosen; supported loop low effort wins; disabled preference stays off.',
    async () => {
      await api('/settings', 'PUT', {
        defaults: { byHarness: { claude: { model: 'claude-fable-5-1', effort: 'xhigh' } } },
      });
      await open({ defaults: { claude: { model: 'claude-fable-5-1', effort: 'low' } } });
      await loaded();
      await done();
      await api('/model-catalog/claude/claude-fable-5-1', 'PATCH', { enabled: false });
      try {
        counts = { catalog: 0, settings: 0, preflight: 0 };
        await page.reload();
        await page.getByTestId('node-infer').click({ position: { x: 60, y: 12 } });
        await dialog()
          .getByRole('button', { name: /^Advanced/ })
          .click();
        await loaded();
        await sw('claude');
        await fields('claude-opus-5-5', 'low');
        const enabled = (await api('/model-catalog')).items.find(
          (x) => x.model === 'claude-fable-5-1',
        ).enabled;
        expect(enabled).toBe(false);
        return {
          model: await model().inputValue(),
          effort: await effort().inputValue(),
          disabledPreferencePreserved: !enabled,
          note: 'Existing disabled loop default itself still requires correction before saving/publishing; this check does not claim that invalid loop is publishable.',
        };
      } finally {
        await api('/model-catalog/claude/claude-fable-5-1', 'PATCH', { enabled: true });
      }
    },
  );
} finally {
  await page?.unrouteAll({ behavior: 'wait' });
  await browser?.close();
  await stop();
  await writeFile(
    join(evidence, 'served-results.json'),
    sanitize(JSON.stringify(results, null, 2)) + '\n',
  );
  await writeFile(join(dir, 'api.log'), log);
  await writeFile(
    join(evidence, 'served-lifecycle.json'),
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
  console.log('Owned disposable directory: ' + dir.split(/[\\/]/).at(-1));
}
if (results.some((x) => x.verdict === 'FAIL')) process.exitCode = 1;
