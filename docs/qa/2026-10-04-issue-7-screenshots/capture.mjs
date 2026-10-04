#!/usr/bin/env node
/**
 * Before and after screenshots for the #7 token cutover.
 *
 *   node docs/qa/2026-10-04-issue-7-screenshots/capture.mjs before   # the app before the cutover
 *   node docs/qa/2026-10-04-issue-7-screenshots/capture.mjs after    # dark and light after it
 *
 * Run `pnpm build` first. The script starts apps/web/e2e/server.ts (the in-memory API with the
 * fake harness, serving apps/web/dist), seeds loops, runs, and inbound events through the API, and
 * photographs every screen at 1024x768 and 1440x900. `after` takes each shot twice, choosing
 * Dark and then Light the way Settings → Appearance does (the stored theme, shown by the boot
 * script). Playwright comes from apps/web's devDependencies; on Windows the installed Edge is
 * used, as in the E2E config (set GG_E2E_BROWSER_CHANNEL to override). Pass a third argument to
 * write elsewhere (for example a scratch folder for extra checks), and set GG_CAPTURE_ONLY to a
 * comma-separated list of screen names to take only those.
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

const SIZES = [
  { suffix: '1024', width: 1024, height: 768 },
  { suffix: '1440', width: 1440, height: 900 },
];

const THEMES =
  mode === 'before'
    ? [{ theme: undefined, dir: join(out, 'before') }]
    : [
        { theme: 'dark', dir: join(out, 'after-dark') },
        { theme: 'light', dir: join(out, 'after-light') },
      ];

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

const trigger = { id: 'start', kind: 'trigger', label: 'Start', config: { subtype: 'manual' } };
const done = (x, y) => ({ id: 'done', kind: 'exit', label: 'Done', config: {}, ui: { x, y } });

function chain(name, description, middle) {
  const nodes = [{ ...trigger, ui: { x: 0, y: 80 } }];
  middle.forEach((node, i) => nodes.push({ ...node, ui: { x: 260 * (i + 1), y: 80 } }));
  nodes.push(done(260 * (middle.length + 1), 80));
  const edges = nodes.slice(1).map((node, i) => ({
    id: `e${i + 1}`,
    from: { node: nodes[i].id, port: 'out' },
    to: { node: node.id },
  }));
  return { schemaVersion: 1, name, description, nodes, edges };
}

const ask = (id, label, template) => ({
  id,
  kind: 'inference',
  label,
  config: { prompt: { template } },
});

/** One node of each kind, with a decision, a subloop, and a loop-back from the exit. */
function nightlyTriage(childLoopId) {
  const n = (id, kind, label, config, x, y) => ({ id, kind, label, config, ui: { x, y } });
  return {
    schemaVersion: 1,
    name: 'nightly-triage',
    description: 'Triages new issues every night and opens a fix when one is needed',
    nodes: [
      n('nightly', 'trigger', 'Nightly', { subtype: 'manual' }, 0, 0),
      n(
        'triage',
        'inference',
        'Triage issues',
        { prompt: { template: 'Triage: {{ trigger.payload }}' } },
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
          strategy: ['expression'],
          expression: { jsonata: 'vars.severity >= 2 ? "yes" : "no"' },
        },
        520,
        0,
      ),
      n('run-tests', 'script', 'Run tests', { command: 'pnpm', args: ['test'] }, 0, 200),
      n('open-pr', 'subloop', 'Open PR', { loopRef: { loopId: childLoopId } }, 260, 200),
      n('watch-ci', 'heartbeat', 'Watch CI', { intervalSeconds: 60, maxBeats: 30 }, 520, 200),
      n(
        'record',
        'mutate',
        'Record outcome',
        { operations: [{ op: 'append-message', role: 'note', content: 'No fix needed' }] },
        0,
        400,
      ),
      n('approve', 'wait', 'Approve merge', { mode: 'input', prompt: 'Merge the fix?' }, 260, 400),
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

async function waitForStatus(base, runId, statuses) {
  for (let i = 0; i < 100; i += 1) {
    const run = await call(base, `/runs/${runId}`);
    if (statuses.includes(run.status)) return run;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`run ${runId} never reached ${statuses.join(' or ')}`);
}

async function seed(base, control) {
  await call(control, '/harness/script', 'POST', {
    turns: [
      {
        matchPrompt: 'LABEL',
        error: { code: 'TURN_FAILED', message: 'The harness exited before the turn finished' },
      },
      { matchPrompt: 'SUMMARY', items: 6, finalText: 'Three issues need a decision.' },
    ],
  });
  const create = async (definition) => (await call(base, '/loops', 'POST', { definition })).loop.id;
  const publish = (id) => call(base, `/loops/${id}/publish`, 'POST');
  const run = async (id) => (await call(base, `/loops/${id}/runs`, 'POST', {})).run.id;

  const review = await create(
    chain('pr-review', 'Reviews an open pull request and leaves comments', [
      ask('review', 'Review diff', 'Review the diff: {{ lastMessage.content }}'),
    ]),
  );
  await publish(review);
  await waitForStatus(base, await run(review), ['succeeded']);

  const labeller = await create(
    chain('issue-labeller', 'Labels incoming issues by area and type', [
      ask('label', 'Label issue', 'LABEL the issue: {{ trigger.payload }}'),
    ]),
  );
  await publish(labeller);
  await waitForStatus(base, await run(labeller), ['failed']);

  const approval = await create(
    chain('weekly-summary', 'Drafts the weekly summary and waits for approval', [
      ask('draft', 'Draft summary', 'SUMMARY of the week: {{ trigger.payload }}'),
      {
        id: 'approve',
        kind: 'wait',
        label: 'Approve',
        config: { mode: 'input', prompt: 'Post this summary?' },
      },
    ]),
  );
  await publish(approval);
  const waitingRun = await run(approval);
  await waitForStatus(base, waitingRun, ['waiting']);

  const docs = await create(
    chain('docs-sync', 'Keeps the user guide in step with the API reference', [
      { id: 'hold', kind: 'wait', label: 'Hold', config: { mode: 'input', prompt: 'Continue?' } },
    ]),
  );
  await publish(docs);
  const docsRun = await run(docs);
  await waitForStatus(base, docsRun, ['waiting']);
  await call(base, `/runs/${docsRun}/cancel`, 'POST');
  await waitForStatus(base, docsRun, ['cancelled']);

  await create(
    chain('release-notes', 'Drafts release notes from merged pull requests', [
      ask('notes', 'Write notes', 'Release notes for {{ trigger.payload }}'),
    ]),
  );

  const nightly = await create(nightlyTriage(review));
  await publish(nightly);
  const edited = nightlyTriage(review);
  edited.nodes[1].label = 'Triage new issues';
  await call(base, `/loops/${nightly}/draft`, 'PUT', { definition: edited });

  await call(base, '/events', 'POST', {
    type: 'issue.opened',
    payload: { repo: 'graphgoblin', number: 482, title: 'Editor crashes on paste' },
    dedupeKey: 'issue-482',
  });
  await call(base, '/events', 'POST', { type: 'build.finished', payload: { ok: true } });

  await call(base, '/model-catalog/codex/gpt-6-astra', 'PUT', {
    displayName: 'GPT-6 Astra',
    efforts: ['medium', 'high', 'xhigh'],
    defaultEffort: 'high',
    enabled: false,
  });
  await call(base, '/secrets/GITHUB_TOKEN', 'PUT', { value: 'not-a-real-token' });

  return { nightly, waitingRun };
}

/** The node id of each kind in the nightly-triage loop. */
const KIND_NODES = [
  ['trigger', 'nightly'],
  ['decision', 'needs-fix'],
  ['inference', 'triage'],
  ['script', 'run-tests'],
  ['mutate', 'record'],
  ['subloop', 'open-pr'],
  ['wait', 'approve'],
  ['heartbeat', 'watch-ci'],
  ['exit', 'done'],
];

function screens({ base, apiKeyBase, nightly, waitingRun }) {
  return [
    { name: 'loops', url: `${base}/app/loops`, ready: 'nightly-triage' },
    ...KIND_NODES.map(([kind, id]) => ({
      name: `editor-${kind}`,
      url: `${base}/app/loops/${nightly}/edit`,
      ready: 'Needs a fix?',
      select: `[data-testid="node-${id}"]`,
    })),
    {
      name: 'editor-search',
      url: `${base}/app/loops/${nightly}/edit`,
      ready: 'Needs a fix?',
      select: '[data-testid="node-triage"]',
      search: { field: 'prompt.template', text: 'payload' },
    },
    { name: 'runs', url: `${base}/app/runs`, ready: 'Children' },
    { name: 'inspector', url: `${base}/app/runs/${waitingRun}`, ready: 'Input requested' },
    { name: 'events', url: `${base}/app/events`, ready: 'issue.opened' },
    { name: 'settings', url: `${base}/app/settings`, ready: 'GPT-6 Astra' },
    {
      name: 'settings-appearance',
      url: `${base}/app/settings`,
      ready: 'GPT-6 Astra',
      focus: 'input[name="theme"]:checked',
    },
    { name: 'api-key', url: `${apiKeyBase}/app/loops`, ready: 'API key required' },
    { name: 'not-found', url: `${base}/app/nowhere`, ready: 'Page not found.' },
    { name: 'offline', url: `${base}/app/loops`, ready: 'nightly-triage', offline: true },
    { name: 'update-toast', url: `${base}/app/loops`, ready: 'nightly-triage', toast: true },
  ];
}

async function shoot(browser, screen, size, theme, dir) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  if (theme) {
    // Choose the theme the way Settings does: the boot script in index.html shows it on load.
    await context.addInitScript((t) => {
      try {
        window.localStorage.setItem('graphgoblin-theme', t);
      } catch {
        // A page without storage keeps the default.
      }
    }, theme);
  }
  const page = await context.newPage();
  await page.goto(screen.url);
  await page.getByText(screen.ready).first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  if (screen.select) {
    await page.locator(screen.select).click({ position: { x: 60, y: 12 } });
  }
  if (screen.search) {
    // CodeMirror's search panel (Ctrl+F) in the template field, with a match selected.
    await page.locator(`[data-field="${screen.search.field}"] .cm-content`).click();
    await page.keyboard.press('Control+f');
    await page
      .locator(`[data-field="${screen.search.field}"] .cm-textfield[name="search"]`)
      .fill(screen.search.text);
    await page.keyboard.press('Enter');
    await page.locator(`[data-field="${screen.search.field}"] .cm-search`).scrollIntoViewIfNeeded();
  }
  if (screen.focus) {
    // Keyboard focus on a control (Tab then Shift+Tab, so the focus ring shows).
    await page.locator(screen.focus).focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
  }
  if (screen.offline) {
    await context.setOffline(true);
    await page.getByText('You are offline').waitFor();
  }
  if (screen.toast) {
    await page.evaluate(() => window.graphgoblinPwa?.simulateUpdate());
    await page.getByText('A new version is available').waitFor();
  }
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(dir, `${screen.name}-${size.suffix}.png`) });
  await context.close();
}

async function main() {
  const { child, base, control } = await startServer();
  try {
    const seeded = await seed(base, control);
    const extra = await call(control, '/apps', 'POST', { requireApiKey: true });
    const browser = await chromium.launch(channel ? { channel } : {});
    const only = process.env['GG_CAPTURE_ONLY']?.split(',');
    const list = screens({ base, apiKeyBase: extra.url, ...seeded }).filter(
      (screen) => !only || only.includes(screen.name),
    );
    for (const { theme, dir } of THEMES) {
      mkdirSync(dir, { recursive: true });
      for (const size of SIZES) {
        for (const screen of list) {
          await shoot(browser, screen, size, theme, dir);
          console.log(`${mode} ${theme ?? ''} ${screen.name}-${size.suffix}`);
        }
      }
    }
    await browser.close();
  } finally {
    child.stdin.end('stop\n');
  }
}

await main();
