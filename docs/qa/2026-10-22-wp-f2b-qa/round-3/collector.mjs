import { fileURLToPath } from 'node:url';
import process from 'node:process';
import console from 'node:console';
import { setTimeout } from 'node:timers';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { chromium, expect } from '../../../../apps/web/node_modules/@playwright/test/index.mjs';
import { CURRENT_DEFINITION_FORMAT } from '../../../../packages/contracts/dist/index.js';
import { manualTriggerConfig } from '../../../../apps/web/src/__fixtures__/triggers.ts';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
process.env.GG_SWITCH_EXPECT_FIXED ??= '1';
const directory = await mkdtemp(join(tmpdir(), 'gg-qa-204-r3-collector-'));
const binaries = join(directory, 'bin');
const compile = spawn(
  'powershell.exe',
  [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    join(root, 'tooling/scripts/model-switch-fake-cli.ps1'),
    '-Directory',
    binaries,
  ],
  { stdio: 'inherit', windowsHide: true },
);
if ((await once(compile, 'exit'))[0] !== 0) throw new Error('fixture build failed');
const port = Number(process.env.GG_SWITCH_PORT);
if (!Number.isInteger(port) || port < 5880 || port > 5889)
  throw new Error('Set GG_SWITCH_PORT to an unused port from 5880 through 5889');
const url = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [join(root, 'apps/api/dist/main.js')], {
  cwd: root,
  windowsHide: true,
  env: {
    ...process.env,
    GG_PORT: String(port),
    GG_HOST: '127.0.0.1',
    GG_DATA_DIR: join(directory, 'data'),
    GG_DB_URL: 'file:' + join(directory, 'data', 'graphgoblin.db').replaceAll('\\', '/'),
    GG_WEB_DIST: join(root, 'apps/web/dist'),
    GG_CODEX_BINARY: join(binaries, 'codex.exe'),
    GG_CLAUDE_BINARY: join(binaries, 'claude.exe'),
    GG_DEFAULTS: JSON.stringify({ byHarness: {} }),
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', (chunk) => {
  log += chunk;
});
server.stderr.on('data', (chunk) => {
  log += chunk;
});
async function api(path, method = 'GET', data) {
  const response = await globalThis.fetch(url + path, {
    method,
    ...(data === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${text}`);
  return text ? JSON.parse(text) : undefined;
}
let browser;
let page;
try {
  let listening = false;
  for (let i = 0; i < 600; i++) {
    if (server.exitCode !== null) throw new Error(log);
    // Wait for this child's successful bind, so an unrelated existing listener is never used.
    if (log.includes('"msg":"GraphGoblin API listening"')) {
      listening = true;
      break;
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  if (!listening) throw new Error('The disposable API did not start: ' + log);
  console.log(
    JSON.stringify({
      directory: directory.split(/[\\/]/).at(-1),
      preflight: await api('/harness/preflight'),
    }),
  );
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(15_000);
  const results = [];
  for (const from of ['codex', 'claude']) {
    const to = from === 'codex' ? 'claude' : 'codex';
    const oldModel = from === 'codex' ? 'gpt-6-astra' : 'claude-fable-5-1';
    const configured = to === 'claude' ? 'claude-fable-5-1' : 'gpt-6-astra';
    const ecosystem = to === 'claude' ? 'claude-opus-5-5' : 'gpt-6-luna';
    for (const scenario of [
      'configured',
      'absent',
      'disabled',
      'failed',
      'inherited',
      'effort-only',
      'loop-over-owner',
      'early',
    ]) {
      await api('/settings', 'PUT', {
        defaults: {
          byHarness:
            scenario === 'absent'
              ? {}
              : {
                  [to]: {
                    model: scenario === 'loop-over-owner' ? ecosystem : configured,
                    effort: 'high',
                  },
                },
        },
      });
      if (scenario === 'disabled')
        await api(`/model-catalog/${to}/${configured}`, 'PATCH', { enabled: false });
      const definition = {
        schemaVersion: CURRENT_DEFINITION_FORMAT,
        name: `${from} ${scenario}`,
        settings: {
          defaults: {
            byHarness:
              scenario === 'loop-over-owner' ? { [to]: { model: configured, effort: 'low' } } : {},
          },
        },
        nodes: [
          {
            id: 'start',
            kind: 'trigger',
            label: 'Start',
            config: manualTriggerConfig(),
            ui: { x: 0, y: 80 },
          },
          {
            id: 'infer',
            kind: 'inference',
            label: 'Infer',
            config: {
              harness: from,
              ...(scenario === 'inherited'
                ? {}
                : {
                    ...(scenario === 'effort-only' ? {} : { model: oldModel }),
                    effort: from === 'codex' ? 'minimal' : 'high',
                  }),
              prompt: { template: 'Synthetic switch QA' },
              harnessOptions: { sandbox: 'read-only', approval: 'never' },
            },
            ui: { x: 260, y: 80 },
          },
          { id: 'done', kind: 'exit', label: 'Done', config: {}, ui: { x: 520, y: 80 } },
        ],
        edges: [
          { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'infer' } },
          { id: 'b', from: { node: 'infer', port: 'out' }, to: { node: 'done' } },
        ],
      };
      const { loop } = await api('/loops', 'POST', { definition });
      if (scenario === 'failed')
        await page.route('**/model-catalog', (route) =>
          route.fulfill({ status: 503, json: { code: 'FIXTURE_CATALOG_FAILED' } }),
        );
      if (scenario === 'early') {
        for (const path of ['settings', 'harness/preflight'])
          await page.route('**/' + path, async (route) => {
            await new Promise((done) => setTimeout(done, 1500));
            await route.continue();
          });
      }
      const inheritedLoads = ['inherited', 'loop-over-owner'].includes(scenario)
        ? Promise.all(
            ['settings', 'harness/preflight'].map((path) =>
              page.waitForResponse((response) => response.url() === url + '/' + path),
            ),
          )
        : undefined;
      await page.goto(url + '/app/loops/' + loop.id + '/edit');
      await page.getByTestId('node-infer').click({ position: { x: 60, y: 12 } });
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: /^Advanced/ }).click();
      const model = dialog.getByLabel('Model', { exact: true });
      if (scenario === 'failed') await dialog.getByText(/Cannot load the model catalog/).waitFor();
      else if (!['inherited', 'effort-only'].includes(scenario))
        await model.locator(`option[value="${oldModel}"]`).waitFor({ state: 'attached' });
      await inheritedLoads;
      await dialog.getByRole('radio', { name: to, exact: true }).focus();
      await page.keyboard.press('Space');
      const waitedForFirstCheck = await dialog.getByText(/Waiting for the first/).isVisible();
      const expected =
        scenario === 'failed'
          ? oldModel
          : ['inherited', 'effort-only'].includes(scenario)
            ? ''
            : ['configured', 'loop-over-owner', 'early'].includes(scenario)
              ? configured
              : ecosystem;
      if (process.env.GG_SWITCH_EXPECT_FIXED === '1') {
        await expect(dialog.getByRole('radio', { name: to, exact: true })).toBeChecked({
          timeout: 15000,
        });
        await expect(model).toHaveValue(expected, { timeout: 15000 });
        if (scenario === 'early' && !waitedForFirstCheck)
          throw new Error('Early switch did not display loading');
      } else await page.waitForTimeout(scenario === 'early' ? 2500 : 600);
      const result = {
        from,
        to,
        scenario,
        waitedForFirstCheck,
        model: await model.inputValue(),
        effort: await dialog.getByLabel('Effort', { exact: true }).inputValue(),
        label: await model.locator('option:checked').textContent(),
        notices: await dialog.getByRole('status').allTextContents(),
      };
      results.push(result);
      console.log(JSON.stringify(result));
      if (process.env.GG_SWITCH_EXPECT_FIXED === '1' && scenario !== 'failed') {
        if (result.model !== expected) console.log(await dialog.innerText());
        if (result.model !== expected)
          throw new Error(`Expected ${expected}: ${JSON.stringify(result)}`);
        await dialog.getByRole('button', { name: 'Done', exact: true }).click();
        // Publication waits for pending autosave through the product toolbar.
        await page.getByRole('button', { name: 'Publish', exact: true }).click();
        await page.getByText('Published version 1.').waitFor();
        const detail = await api('/loops/' + loop.id);
        result.authored = detail.current.definition.nodes.find(
          (node) => node.id === 'infer',
        ).config;
        if (
          (['inherited', 'effort-only'].includes(scenario) && 'model' in result.authored) ||
          (scenario === 'inherited' && 'effort' in result.authored)
        )
          throw new Error('Inheritance was pinned on the saved node');
        await page.reload();
        await page.getByTestId('node-infer').click({ position: { x: 60, y: 12 } });
        await dialog.getByRole('button', { name: /^Advanced/ }).click();
        if (
          (await model.inputValue()) !== expected ||
          (await dialog.getByLabel('Effort', { exact: true }).inputValue()) !== result.effort
        )
          throw new Error('Reopened model or effort differs');
        const run = await api(`/loops/${loop.id}/runs`, 'POST', { input: null });
        let succeeded = false;
        for (let i = 0; i < 600; i++) {
          const state = await api('/runs/' + run.run.id);
          if (state.status === 'succeeded') {
            succeeded = true;
            break;
          }
          if (state.status === 'failed') throw new Error(JSON.stringify(state));
          await new Promise((done) => setTimeout(done, 100));
        }
        if (!succeeded)
          throw new Error('Synthetic run did not finish within the observation budget');
        result.runStatus = 'succeeded';
        const requests = (await readFile(join(binaries, 'requests.jsonl'), 'utf8'))
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line));
        const actual = requests.at(-1);
        const expectedRequestModel = ['inherited', 'effort-only'].includes(scenario)
          ? configured
          : expected;
        const expectedRequestEffort = scenario === 'inherited' ? 'high' : result.effort;
        if (actual.model !== expectedRequestModel || actual.effort !== expectedRequestEffort)
          throw new Error('Fake CLI request differs: ' + JSON.stringify(actual));
        result.request = actual;
        console.log('FAKE_REQUEST ' + JSON.stringify(actual));
      }
      await page.unrouteAll({ behavior: 'wait' });
      if (scenario === 'disabled') {
        const catalog = await api('/model-catalog');
        if (
          catalog.items.find((entry) => entry.harness === to && entry.model === configured)
            ?.enabled !== false
        )
          throw new Error('Switch changed the disabled catalog preference');
        result.disabledPreferencePreserved = true;
        await api(`/model-catalog/${to}/${configured}`, 'PATCH', { enabled: true });
      }
    }
  }
  const evidencePath = join(root, 'docs/qa/2026-10-22-wp-f2b-qa/round-3/collector-results.json');
  await writeFile(evidencePath, JSON.stringify(results, null, 2) + '\n');
  console.log('Evidence: ' + evidencePath);
} finally {
  await page?.unrouteAll({ behavior: 'wait' });
  await browser?.close();
  if (server.exitCode === null) {
    const stopped = once(server, 'exit');
    server.kill('SIGTERM');
    await stopped;
  }
  await writeFile(join(directory, 'api.log'), log);
  await writeFile(
    join(root, 'docs/qa/2026-10-22-wp-f2b-qa/round-3/collector-lifecycle.json'),
    JSON.stringify(
      {
        directory: directory.split(/[\\/]/).at(-1),
        pid: server.pid,
        processExited: server.exitCode !== null || server.signalCode !== null,
        signalCode: server.signalCode,
      },
      null,
      2,
    ) + '\n',
  );
  console.log('Owned disposable directory: ' + directory.split(/[\\/]/).at(-1));
}
