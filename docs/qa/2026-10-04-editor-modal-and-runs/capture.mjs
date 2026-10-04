#!/usr/bin/env node
/**
 * Before and after screenshots for #13 (node editor dialog, collapsible loop panel) and #46 (runs
 * start only from Runs).
 *
 *   node docs/qa/2026-10-04-editor-modal-and-runs/capture.mjs before   # the editor before the change
 *   node docs/qa/2026-10-04-editor-modal-and-runs/capture.mjs after    # the dialog, panel, New run
 *
 * Run `pnpm build` first (`before` needs a build of the commit before the change). The script
 * starts apps/web/e2e/server.ts (the in-memory API with the fake harness, serving apps/web/dist),
 * seeds loops and runs through the API, and photographs each screen at 1024x768 and 1440x900 in
 * Dark and Light (chosen the way Settings → Appearance does: the stored theme, shown by the boot
 * script). Playwright comes from apps/web's devDependencies; on Windows the installed Edge is used,
 * as in the E2E config (set GG_E2E_BROWSER_CHANNEL to override). Pass a third argument to write
 * elsewhere, and set GG_CAPTURE_ONLY to a comma-separated list of screen names to take only those.
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

const trigger = { id: 'start', kind: 'trigger', label: 'Start', config: { subtype: 'manual' } };

function chain(name, description, middle) {
  const nodes = [{ ...trigger, ui: { x: 0, y: 80 } }];
  middle.forEach((node, i) => nodes.push({ ...node, ui: { x: 260 * (i + 1), y: 80 } }));
  nodes.push({
    id: 'done',
    kind: 'exit',
    label: 'Done',
    config: {},
    ui: { x: 260 * (middle.length + 1), y: 80 },
  });
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
      n(
        'nightly',
        'trigger',
        'Nightly',
        {
          subtype: 'manual',
          inputSchema: {
            type: 'object',
            properties: { repo: { type: 'string' }, limit: { type: 'integer' } },
            required: ['repo'],
          },
        },
        0,
        0,
      ),
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

  const unpublished = await create(
    chain('release-notes', 'Drafts release notes from merged pull requests', [
      ask('notes', 'Write notes', 'Release notes for {{ trigger.payload }}'),
    ]),
  );

  // Two published versions, then a draft on top, so the version choice has something to show.
  const nightly = await create(nightlyTriage(review));
  await publish(nightly);
  const second = nightlyTriage(review);
  second.nodes[1].label = 'Triage new issues';
  await call(base, `/loops/${nightly}/draft`, 'PUT', { definition: second });
  await publish(nightly);
  const edited = nightlyTriage(review);
  edited.nodes[1].label = 'Triage the new issues';
  await call(base, `/loops/${nightly}/draft`, 'PUT', { definition: edited });

  // A loop of its own for the conflict screen, whose draft the screen changes behind the editor.
  const conflict = await create(
    chain('conflict-demo', 'Changed in another tab while a node is open here', [
      { id: 'approve', kind: 'wait', label: 'Approve', config: { mode: 'input', prompt: 'OK?' } },
    ]),
  );

  return { nightly, unpublished, conflict };
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

/**
 * The screens. `modes` limits a screen to one mode: the Run tab exists only before the change, the
 * collapsed panel and the New run flow only after it.
 */
function screens({ base, nightly, unpublished, conflict }) {
  const editor = `${base}/app/loops/${nightly}/edit`;
  return [
    ...KIND_NODES.map(([kind, id]) => ({
      name: `editor-${kind}`,
      url: editor,
      ready: 'Needs a fix?',
      // Before: the node is selected and the side panel shows it. After: the dialog opens.
      click: `[data-testid="node-${id}"]`,
      dialog: mode === 'after',
    })),
    { name: 'editor-loop-panel', url: editor, ready: 'Needs a fix?', panel: 'expanded' },
    {
      name: 'editor-loop-collapsed',
      url: editor,
      ready: 'Needs a fix?',
      panel: 'collapsed',
      modes: ['after'],
    },
    {
      name: 'editor-run-tab',
      url: editor,
      ready: 'Needs a fix?',
      button: 'Run',
      modes: ['before'],
    },
    {
      name: 'editor-unpublished',
      url: `${base}/app/loops/${unpublished}/edit`,
      ready: 'Write notes',
      focus: mode === 'after' ? 'Open in Runs' : undefined,
    },
    { name: 'runs', url: `${base}/app/runs`, ready: 'Children' },
    {
      name: 'new-run',
      url: `${base}/app/runs/new?loop=${nightly}`,
      ready: 'Start run',
      modes: ['after'],
    },
    {
      name: 'new-run-choose',
      url: `${base}/app/runs/new`,
      ready: 'Choose a published loop',
      modes: ['after'],
    },
    {
      name: 'new-run-unpublished',
      url: `${base}/app/runs/new?loop=${unpublished}`,
      ready: 'has no published version',
      modes: ['after'],
    },
    {
      // Start run with the required input empty: refused before anything is sent.
      name: 'new-run-invalid',
      url: `${base}/app/runs/new?loop=${nightly}`,
      ready: 'Start run',
      button: 'Start run',
      modes: ['after'],
    },
    {
      // Another tab saves while a node is open here; the next edit meets the conflict, which the
      // dialog shows with its answers.
      name: 'editor-conflict',
      url: `${base}/app/loops/${conflict}/edit`,
      ready: 'Approve',
      click: '[data-testid="node-approve"]',
      dialog: true,
      conflict: { loopId: conflict, base },
      modes: ['after'],
    },
    {
      // Below 768 px the dialog is a sheet along the bottom edge; at 768 px it is centred again.
      name: 'editor-sheet',
      url: editor,
      ready: 'Needs a fix?',
      keyboardOpen: 'nightly',
      sizes: [
        { suffix: '390', width: 390, height: 844 },
        { suffix: '768', width: 768, height: 1024 },
      ],
      modes: ['after'],
    },
  ];
}

async function shoot(browser, screen, size, theme, dir) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
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
  await page.goto(screen.url);
  await page.getByText(screen.ready).first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  if (screen.click) {
    await page.locator(screen.click).click({ position: { x: 60, y: 12 } });
    if (screen.dialog) await page.getByRole('dialog').waitFor();
  }
  if (screen.keyboardOpen) {
    await page.locator(`.react-flow__node[data-id="${screen.keyboardOpen}"]`).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('dialog').waitFor();
  }
  if (screen.conflict) {
    const { loopId, base } = screen.conflict;
    const detail = await call(base, `/loops/${loopId}`);
    const theirs = {
      ...detail.draft.definition,
      description: `Saved in another tab at ${Date.now()}`,
    };
    await call(base, `/loops/${loopId}/draft`, 'PUT', { definition: theirs });
    await page
      .getByRole('dialog')
      .getByLabel('Label', { exact: true })
      .fill(`Approve (${size.suffix})`);
    await page.getByRole('dialog').getByText('The draft changed on the server').waitFor();
  }
  if (screen.button) await page.getByRole('button', { name: screen.button, exact: true }).click();
  if (screen.panel && mode === 'before') {
    await page.getByRole('button', { name: 'Loop settings' }).click();
  } else if (screen.panel) {
    const toggle = page.getByRole('button', { name: 'Loop settings' });
    const expanded = (await toggle.getAttribute('aria-expanded')) === 'true';
    if (expanded !== (screen.panel === 'expanded')) await toggle.click();
  }
  if (screen.focus) {
    // Keyboard focus on a control (Tab then Shift+Tab, so the focus ring shows).
    await page.getByRole('link', { name: screen.focus }).focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
  }
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(dir, `${screen.name}-${size.suffix}.png`) });
  await context.close();
}

async function main() {
  const { child, base, control } = await startServer();
  try {
    const seeded = await seed(base, control);
    const browser = await chromium.launch(channel ? { channel } : {});
    const only = process.env['GG_CAPTURE_ONLY']?.split(',');
    const list = screens({ base, ...seeded }).filter(
      (screen) =>
        (!only || only.includes(screen.name)) && (!screen.modes || screen.modes.includes(mode)),
    );
    for (const theme of THEMES) {
      const dir = join(out, `${mode}-${theme}`);
      mkdirSync(dir, { recursive: true });
      for (const screen of list) {
        for (const size of screen.sizes ?? SIZES) {
          await shoot(browser, screen, size, theme, dir);
          console.log(`${mode} ${theme} ${screen.name}-${size.suffix}`);
        }
      }
    }
    await browser.close();
  } finally {
    child.stdin.end('stop\n');
  }
}

await main();
