#!/usr/bin/env node
/**
 * Before and after screenshots for #8 (form controls and field layout): every form in the app, in
 * Dark and Light.
 *
 *   node docs/qa/2026-10-04-issue-8-forms/capture.mjs before   # the forms before the change
 *   node docs/qa/2026-10-04-issue-8-forms/capture.mjs after    # the forms after it
 *
 * Run `pnpm build` first (`before` needs a build of the commit before the change). The script
 * starts apps/web/e2e/server.ts (the in-memory API with the fake harness, serving apps/web/dist),
 * seeds loops and a waiting run through the API, and photographs each form as an element
 * screenshot in a tall window, so a long node form fits in its dialog. The theme is chosen the way
 * Settings → Appearance does (the stored theme, shown by the boot script). Playwright comes from
 * apps/web's devDependencies; on Windows the installed Edge is used, as in the E2E config (set
 * GG_E2E_BROWSER_CHANNEL to override). Pass a third argument to write elsewhere, and set
 * GG_CAPTURE_ONLY to a comma-separated list of screen names to take only those.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..');
const webRoot = join(root, 'apps', 'web');
const require = createRequire(join(webRoot, 'package.json'));
const { chromium } = require('@playwright/test');

const mode = process.argv[2] ?? 'after';
const out = process.argv[3] ? resolve(process.argv[3]) : here;
const channel =
  process.env['GG_E2E_BROWSER_CHANNEL'] ?? (process.platform === 'win32' ? 'msedge' : undefined);
const THEMES = ['dark', 'light'];

function startServer() {
  const child = spawn(
    process.execPath,
    ['--conditions=development', '--import', 'tsx', 'e2e/server.ts'],
    { cwd: webRoot, stdio: ['pipe', 'pipe', 'inherit'] },
  );
  return new Promise((resolveStart, reject) => {
    let buffer = '';
    const urls = {};
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const control = /GG_E2E_CONTROL (\S+)/.exec(buffer);
      if (control) urls.control = control[1];
      const ready = /GG_E2E_READY (\S+)/.exec(buffer);
      if (ready) resolveStart({ child, base: ready[1], control: urls.control });
    });
    child.once('exit', (code) => reject(new Error(`the E2E server exited with ${code}`)));
  });
}

async function call(base, path, method = 'GET', body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? undefined : res.json();
}

/** The run input every form below asks for: required and optional fields of each control type. */
const RUN_INPUT = {
  type: 'object',
  required: ['repo', 'priority'],
  properties: {
    repo: { type: 'string', title: 'Repository', description: 'owner/name on GitHub' },
    limit: { type: 'integer', title: 'Issue limit' },
    dryRun: { type: 'boolean', title: 'Dry run' },
    priority: { enum: ['low', 'normal', 'high'], title: 'Priority' },
    area: { enum: ['web', 'api', 'engine', 'contracts', 'docs', 'infra'], title: 'Area' },
    labels: { type: 'array', title: 'Labels' },
  },
};

const n = (id, kind, label, config, x, y) => ({ id, kind, label, config, ui: { x, y } });

/** One node of each kind, configured so its form shows most of the control types. */
function gallery(childLoopId) {
  return {
    schemaVersion: 1,
    name: 'form-gallery',
    description: 'One node of each kind, for looking at the forms',
    settings: { maxIterations: 5 },
    variables: { severity: { type: 'integer', minimum: 0 } },
    nodes: [
      n('nightly', 'trigger', 'Nightly', { subtype: 'manual', inputSchema: RUN_INPUT }, 0, 0),
      n(
        'triage',
        'inference',
        'Triage issues',
        {
          prompt: { template: 'Triage: {{ trigger.payload }}' },
          effort: 'medium',
          session: { policy: 'resume-named', key: 'triage' },
          harnessOptions: {
            sandbox: 'read-only',
            networkAccess: true,
            configOverrides: { model_reasoning_summary: 'auto' },
          },
        },
        260,
        0,
      ),
      n(
        'needs-fix',
        'decision',
        'Needs a fix?',
        {
          routes: [
            { label: 'yes', description: 'A code change would resolve the issue' },
            { label: 'no', description: 'Nothing to change' },
          ],
          question: 'Does {{ lastOutput }} call for a code change?',
          strategy: ['expression', 'codex'],
          codex: { effort: 'high' },
          expression: { jsonata: 'vars.severity >= 2 ? "yes" : "no"' },
        },
        520,
        0,
      ),
      n(
        'run-tests',
        'script',
        'Run tests',
        {
          command: 'pnpm',
          args: ['test', '--filter', '{{ vars.package }}'],
          env: { CI: 'true', NODE_OPTIONS: '--max-old-space-size=4096' },
          stdin: 'none',
          exitCodeRoutes: { '1': 'failed' },
          timeoutSeconds: 600,
        },
        0,
        200,
      ),
      n('open-pr', 'subloop', 'Open PR', { loopRef: { loopId: childLoopId } }, 260, 200),
      n(
        'watch-ci',
        'heartbeat',
        'Watch CI',
        { intervalSeconds: 60, maxBeats: 30, until: 'lastOutput.status = "done"' },
        520,
        200,
      ),
      n(
        'record',
        'mutate',
        'Record outcome',
        {
          operations: [
            { op: 'append-message', role: 'note', content: 'No fix needed' },
            { op: 'set', path: '/vars/fixed', value: { kind: 'literal', value: false } },
          ],
        },
        0,
        400,
      ),
      n(
        'approve',
        'wait',
        'Approve merge',
        {
          mode: 'input',
          prompt: 'Merge the fix?',
          inputSchema: RUN_INPUT,
          timeoutSeconds: 86400,
        },
        260,
        400,
      ),
      n('done', 'exit', 'Done', { loopBack: { targetNodeId: 'triage' } }, 520, 400),
    ],
    edges: [
      { id: 'e1', from: { node: 'nightly', port: 'out' }, to: { node: 'triage' } },
      { id: 'e2', from: { node: 'triage', port: 'out' }, to: { node: 'needs-fix' } },
      { id: 'e3', from: { node: 'needs-fix', port: 'yes' }, to: { node: 'run-tests' } },
      { id: 'e4', from: { node: 'needs-fix', port: 'no' }, to: { node: 'record' } },
      { id: 'e5', from: { node: 'run-tests', port: 'out' }, to: { node: 'open-pr' } },
      { id: 'e6', from: { node: 'open-pr', port: 'out' }, to: { node: 'watch-ci' } },
      { id: 'e7', from: { node: 'watch-ci', port: 'out' }, to: { node: 'approve' } },
      { id: 'e8', from: { node: 'record', port: 'out' }, to: { node: 'done' } },
      { id: 'e9', from: { node: 'approve', port: 'out' }, to: { node: 'done' } },
      { id: 'e10', from: { node: 'done', port: 'loopBack' }, to: { node: 'triage' } },
    ],
  };
}

/** A manual trigger with RUN_INPUT, a wait for input with RUN_INPUT, and an exit. */
function approvalGate() {
  return {
    schemaVersion: 1,
    name: 'approval-gate',
    description: 'Asks a person before it finishes',
    nodes: [
      n('start', 'trigger', 'Start', { subtype: 'manual', inputSchema: RUN_INPUT }, 0, 80),
      n(
        'approve',
        'wait',
        'Approve',
        { mode: 'input', prompt: 'Ship the release?', inputSchema: RUN_INPUT },
        260,
        80,
      ),
      n('done', 'exit', 'Done', {}, 520, 80),
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'approve' } },
      { id: 'e2', from: { node: 'approve', port: 'out' }, to: { node: 'done' } },
    ],
  };
}

async function waitForStatus(base, runId, statuses) {
  for (let i = 0; i < 100; i += 1) {
    const run = await call(base, `/runs/${runId}`);
    if (statuses.includes(run.status)) return run;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`run ${runId} never reached ${statuses.join(' or ')}`);
}

async function seed(base) {
  const create = async (definition) => (await call(base, '/loops', 'POST', { definition })).loop.id;
  const child = await create({
    schemaVersion: 1,
    name: 'pr-review',
    description: 'Reviews an open pull request',
    nodes: [
      n('start', 'trigger', 'Start', { subtype: 'manual' }, 0, 80),
      n('done', 'exit', 'Done', {}, 260, 80),
    ],
    edges: [{ id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'done' } }],
  });
  await call(base, `/loops/${child}/publish`, 'POST');
  const galleryId = await create(gallery(child));
  const gate = await create(approvalGate());
  await call(base, `/loops/${gate}/publish`, 'POST');
  const started = await call(base, `/loops/${gate}/runs`, 'POST', {
    input: { repo: 'acme/widgets', priority: 'normal' },
  });
  const runId = started.run.id;
  await waitForStatus(base, runId, ['waiting']);
  await call(base, '/secrets/github-token', 'PUT', { value: 'x' });
  return { galleryId, gate, runId };
}

/** The node id of each kind in the gallery loop. */
const KIND_NODES = [
  ['trigger', 'nightly'],
  ['inference', 'triage'],
  ['decision', 'needs-fix'],
  ['script', 'run-tests'],
  ['subloop', 'open-pr'],
  ['heartbeat', 'watch-ci'],
  ['mutate', 'record'],
  ['wait', 'approve'],
  ['exit', 'done'],
];

/**
 * The screens: where to go, what to wait for, what to do first, and which element to photograph.
 * `target` is a function from the page to a locator.
 */
function screens({ base, control, galleryId, gate, runId }) {
  const editor = `${base}/app/loops/${galleryId}/edit`;
  const dialog = (page) => page.getByRole('dialog');
  const region = (name) => (page) => page.getByRole('region', { name, exact: true });
  return [
    ...KIND_NODES.map(([kind, id]) => ({
      name: `node-${kind}`,
      url: editor,
      ready: 'Needs a fix?',
      before: async (page) => {
        await page.locator(`[data-testid="node-${id}"]`).click({ position: { x: 60, y: 12 } });
        await page.getByRole('dialog').waitFor();
      },
      target: dialog,
    })),
    {
      // A required field left empty, and an id that cannot apply: the error patterns.
      name: 'node-errors',
      url: editor,
      ready: 'Needs a fix?',
      before: async (page) => {
        await page.locator('[data-testid="node-run-tests"]').click({ position: { x: 60, y: 12 } });
        const box = page.getByRole('dialog');
        await box.waitFor();
        await box.getByLabel('Command', { exact: true }).fill('');
        await box.getByLabel('Node id', { exact: true }).fill('2 bad');
        await box.getByLabel('Node id', { exact: true }).press('Enter');
      },
      target: dialog,
    },
    {
      name: 'loop-panel',
      url: editor,
      ready: 'Needs a fix?',
      before: async (page) => {
        const toggle = page.getByRole('button', { name: 'Loop settings' });
        if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
      },
      target: (page) => page.locator('#loop-panel'),
    },
    { name: 'loops-forms', url: `${base}/app/loops`, ready: 'form-gallery', target: loopsCard },
    {
      name: 'loops-import-error',
      url: `${base}/app/loops`,
      ready: 'form-gallery',
      before: async (page) => {
        await page.getByLabel('Import an exported loop (JSON)').setInputFiles({
          name: 'not-a-loop.json',
          mimeType: 'application/json',
          buffer: Buffer.from('not json'),
        });
        await page.getByText('is not a JSON document').waitFor();
      },
      target: loopsCard,
    },
    {
      name: 'settings',
      url: `${base}/app/settings`,
      ready: 'Model catalog',
      target: (page) => page.locator('.gap-section.p-page').first(),
    },
    {
      name: 'settings-add-model',
      url: `${base}/app/settings`,
      ready: 'Model catalog',
      before: async (page) => {
        await page.getByRole('button', { name: 'Add model' }).click();
        await page.getByRole('form', { name: 'Add model' }).waitFor();
      },
      target: region('Model catalog'),
    },
    {
      name: 'settings-secrets',
      url: `${base}/app/settings`,
      ready: 'Model catalog',
      before: async (page) => {
        await page.getByLabel('Name', { exact: true }).fill('2-bad-name');
      },
      target: region('Secrets'),
    },
    {
      name: 'settings-api-keys',
      url: `${base}/app/settings`,
      ready: 'Model catalog',
      target: region('API keys'),
    },
    {
      name: 'settings-defaults',
      url: `${base}/app/settings`,
      ready: 'Model catalog',
      target: region('Defaults'),
    },
    {
      name: 'api-key-panel',
      url: async () => {
        const instance = await call(control, '/apps', 'POST', { requireApiKey: true });
        return `${instance.url}/app/loops`;
      },
      ready: 'API key required',
      target: region('API key required'),
    },
    {
      name: 'new-run',
      url: `${base}/app/runs/new?loop=${gate}`,
      ready: 'Start run',
      target: (page) => page.locator('section').first(),
    },
    {
      name: 'new-run-invalid',
      url: `${base}/app/runs/new?loop=${gate}`,
      ready: 'Start run',
      before: async (page) => {
        await page.getByRole('button', { name: 'Start run', exact: true }).click();
        await page.getByRole('alert').first().waitFor();
      },
      target: (page) => page.locator('section').first(),
    },
    {
      name: 'wait-input',
      url: `${base}/app/runs/${runId}`,
      ready: 'Ship the release?',
      target: region('Input requested'),
    },
  ];
}

function loopsCard(page) {
  return page.locator('section').first();
}

async function shoot(browser, screen, theme, dir) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 3200 },
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  await context.addInitScript((t) => {
    try {
      window.localStorage.setItem('graphgoblin-theme', t);
    } catch {
      // A page without storage keeps the default.
    }
  }, theme);
  const page = await context.newPage();
  await page.goto(typeof screen.url === 'function' ? await screen.url() : screen.url);
  await page.getByText(screen.ready).first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  if (screen.before) await screen.before(page);
  await page.waitForTimeout(500);
  await screen.target(page).screenshot({ path: join(dir, `${screen.name}.png`) });
  await context.close();
}

async function main() {
  const { child, base, control } = await startServer();
  try {
    const seeded = await seed(base);
    const browser = await chromium.launch(channel ? { channel } : {});
    const only = process.env['GG_CAPTURE_ONLY']?.split(',');
    const list = screens({ base, control, ...seeded }).filter(
      (screen) => !only || only.includes(screen.name),
    );
    for (const theme of THEMES) {
      const dir = join(out, `${mode}-${theme}`);
      mkdirSync(dir, { recursive: true });
      for (const screen of list) {
        await shoot(browser, screen, theme, dir);
        console.log(`${mode} ${theme} ${screen.name}`);
      }
    }
    await browser.close();
  } finally {
    child.stdin.end('stop\n');
  }
}

await main();
