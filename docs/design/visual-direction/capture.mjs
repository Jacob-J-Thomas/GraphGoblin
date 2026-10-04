#!/usr/bin/env node
/**
 * Screenshots for the visual-direction sample (#7).
 *
 *   node docs/design/visual-direction/capture.mjs sample   # the static sample, every view and width
 *   node docs/design/visual-direction/capture.mjs before   # the real app with seeded data
 *
 * `before` needs `pnpm build` first: it starts apps/web/e2e/server.ts (the in-memory API with the
 * fake harness, serving apps/web/dist), seeds loops and runs through the API, and photographs the
 * corresponding real screens. Playwright comes from apps/web's devDependencies; on Windows the
 * installed Edge is used, as in the E2E config (set GG_E2E_BROWSER_CHANNEL to override).
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..');
const webRoot = join(root, 'apps', 'web');
const out = join(here, 'screenshots');
const require = createRequire(join(webRoot, 'package.json'));
const { chromium } = require('@playwright/test');

const channel =
  process.env['GG_E2E_BROWSER_CHANNEL'] ?? (process.platform === 'win32' ? 'msedge' : undefined);

async function browser() {
  return chromium.launch(channel ? { channel } : {});
}

// ---------------------------------------------------------------------------------------------
// The sample
// ---------------------------------------------------------------------------------------------

/** One screenshot of sample.html: the view (URL hash), the viewport, and an optional action. */
const SAMPLE_SHOTS = [
  { name: 'loops-1440', view: 'loops', width: 1440, height: 900 },
  { name: 'loops-390', view: 'loops', width: 390, height: 844 },
  { name: 'editor-1440', view: 'editor', width: 1440, height: 900 },
  { name: 'editor-1440-tall', view: 'editor', width: 1440, height: 1760 },
  { name: 'editor-768', view: 'editor', width: 768, height: 1024 },
  { name: 'editor-768-sheet-collapsed', view: 'editor', width: 768, height: 1024, sheet: false },
  { name: 'nav-1440', view: 'nav', width: 1440, height: 900 },
  { name: 'nav-390', view: 'nav', width: 390, height: 844 },
  { name: 'nav-390-menu-open', view: 'nav', width: 390, height: 844, menu: true },
  { name: 'inspector-1440', view: 'inspector', width: 1440, height: 900 },
  { name: 'inspector-768', view: 'inspector', width: 768, height: 1024 },
  { name: 'components-1440', view: 'components', width: 1440, height: 900 },
];

async function captureSample() {
  const url = pathToFileURL(join(here, 'sample.html')).href;
  const b = await browser();
  for (const shot of SAMPLE_SHOTS) {
    const page = await b.newPage({ viewport: { width: shot.width, height: shot.height } });
    await page.goto(`${url}#${shot.view}`);
    await page.evaluate(() => document.fonts.ready);
    if (shot.menu) await page.locator(`#${shot.view} [data-menu-toggle]`).click();
    if (shot.sheet === false) await page.locator(`#${shot.view} [data-sheet-toggle]`).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(out, `${shot.name}.png`), fullPage: true });
    console.log(`sample ${shot.name}`);
    await page.close();
  }
  await b.close();
}

// ---------------------------------------------------------------------------------------------
// The real app, before the cutover
// ---------------------------------------------------------------------------------------------

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

/** The editor sample's loop: one node of each kind, with a loop-back from the exit. */
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

  return { nightly, waitingRun };
}

const BEFORE_SIZES = [
  { suffix: '1024', width: 1024, height: 768 },
  { suffix: '1440', width: 1440, height: 900 },
];

async function captureBefore() {
  const { child, base, control } = await startServer();
  try {
    const { nightly, waitingRun } = await seed(base, control);
    const b = await browser();
    const views = [
      { name: 'loops', path: '/app/loops', ready: 'nightly-triage' },
      {
        name: 'editor',
        path: `/app/loops/${nightly}/edit`,
        ready: 'Needs a fix?',
        select: '[data-testid="node-needs-fix"]',
      },
      { name: 'inspector', path: `/app/runs/${waitingRun}`, ready: 'Input requested' },
    ];
    for (const size of BEFORE_SIZES) {
      for (const view of views) {
        const page = await b.newPage({ viewport: { width: size.width, height: size.height } });
        await page.goto(`${base}${view.path}`);
        await page.getByText(view.ready).first().waitFor();
        if (view.select) await page.locator(view.select).click({ position: { x: 40, y: 12 } });
        await page.waitForTimeout(600);
        await page.screenshot({ path: join(out, `before-${view.name}-${size.suffix}.png`) });
        if (view.name === 'loops') {
          await page.screenshot({
            path: join(out, `before-nav-${size.suffix}.png`),
            clip: { x: 0, y: 0, width: size.width, height: 48 },
          });
        }
        console.log(`before ${view.name}-${size.suffix}`);
        await page.close();
      }
    }
    // The narrow widths the sample proposes layouts for, to show today's behaviour there.
    for (const [view, width, height] of [
      ['loops', 390, 844],
      ['editor', 768, 1024],
      ['inspector', 768, 1024],
    ]) {
      const spec = views.find((v) => v.name === view);
      const page = await b.newPage({ viewport: { width, height } });
      await page.goto(`${base}${spec.path}`);
      await page.getByText(spec.ready).first().waitFor();
      if (spec.select) await page.locator(spec.select).click({ position: { x: 40, y: 12 } });
      await page.waitForTimeout(600);
      await page.screenshot({ path: join(out, `before-${view}-${width}.png`) });
      console.log(`before ${view}-${width}`);
      await page.close();
    }
    await b.close();
  } finally {
    child.stdin.end('stop\n');
  }
}

mkdirSync(out, { recursive: true });
const mode = process.argv[2] ?? 'sample';
if (mode === 'sample' || mode === 'all') await captureSample();
if (mode === 'before' || mode === 'all') await captureBefore();
