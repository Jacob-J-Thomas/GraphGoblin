/**
 * Screenshots of every screen and its main states at four widths in both themes (#41, #11).
 *
 *   pnpm build
 *   pnpm --filter @graphgoblin/web capture:screens
 *
 * The capture runs against the E2E server (the real API over an in-memory database with the fake
 * harness, serving apps/web/dist), seeds loops, runs in every state (succeeded, failed, waiting,
 * cancelled, running, paused, and one of a few hundred events), inbound events, a disabled catalog
 * model, a secret, and an API key through the API, plus a second instance that requires a key, and
 * photographs each screen with reduced motion so pulses hold still. Output goes to docs/qa/2026-10-05-issue-41-sweep/<theme>/
 * as `<screen>-<width>.png` (Settings as a full-page shot).
 *
 * Options, as environment variables:
 *   GG_CAPTURE_SET=before   only the light-theme "before" set (Loops, the editor, the run inspector,
 *                           and Settings at 768 and 1440 px) into before-light/; run it on a build
 *                           of the commit before the change
 *   GG_CAPTURE_ONLY=a,b     only these screens
 *   GG_CAPTURE_WIDTHS=360   only these widths (360, 768, 1024, 1440)
 *   GG_CAPTURE_THEMES=light only these themes (dark, light)
 *   GG_CAPTURE_OUT=<dir>    write there instead (for example a scratch folder)
 */
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { APIRequestContext, Browser, Page } from '@playwright/test';
import { request as requestFactory } from '@playwright/test';
import { control, test } from './fixtures.js';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(
  process.env['GG_CAPTURE_OUT'] ??
    join(here, '..', '..', '..', 'docs', 'qa', '2026-10-05-issue-41-sweep'),
);
const BEFORE = process.env['GG_CAPTURE_SET'] === 'before';
const list = (name: string) => process.env[name]?.split(',').map((s) => s.trim());

const WIDTHS = [
  { width: 360, height: 780 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
] as const;

/** A turn the fake harness never finishes on its own (cancelling the run ends it). */
const HELD = 2 ** 31 - 1;

interface Seeded {
  nightly: string;
  attention: string;
  weekly: string;
  waitingRun: string;
  liveRun: string;
  succeededRun: string;
  failedRun: string;
  /** A run of a few hundred events, which the inspector renders in batches. */
  batchRun: string;
  /** A held run paused from the API, when the engine paused it in time. */
  pausedRun: string | undefined;
  apiKeyBase: string;
  /** A key of the instance that requires one, stored in the browser for its Settings. */
  apiKeyToken: string;
}

interface Screen {
  name: string;
  path: (s: Seeded) => string;
  /** Text that shows once the screen has loaded. */
  ready: string | RegExp;
  /** Load from the API instance that requires a key. */
  apiKey?: boolean;
  /** Only at these widths (a narrow-only state). */
  widths?: readonly number[];
  /** localStorage entries set before the app loads (panel states, a stored key). */
  storage?: (s: Seeded) => Record<string, string>;
  /** Skip the screen when the seed could not make its state. */
  when?: (s: Seeded) => boolean;
  fullPage?: boolean;
  /** Part of the light "before" set. */
  before?: boolean;
  act?: (page: Page) => Promise<void>;
  setup?: (page: Page) => Promise<void>;
}

const at = (x: number, y: number) => ({ x, y });
const trigger = { id: 'start', kind: 'trigger', label: 'Start', config: { subtype: 'manual' } };

function chain(name: string, description: string, middle: Record<string, unknown>[]) {
  const nodes: Record<string, unknown>[] = [{ ...trigger, ui: at(0, 80) }];
  middle.forEach((node, i) => nodes.push({ ...node, ui: at(260 * (i + 1), 80) }));
  nodes.push({
    id: 'done',
    kind: 'exit',
    label: 'Done',
    config: {},
    ui: at(260 * (middle.length + 1), 80),
  });
  const edges = nodes.slice(1).map((node, i) => ({
    id: `e${i + 1}`,
    from: { node: nodes[i]!['id'], port: 'out' },
    to: { node: node['id'] },
  }));
  return { schemaVersion: 1, name, description, nodes, edges };
}

const ask = (id: string, label: string, template: string) => ({
  id,
  kind: 'inference',
  label,
  config: { prompt: { template } },
});

/** One node of each kind, with a decision, a subloop, a cron trigger, and a loop-back. */
function nightlyTriage(childLoopId: string) {
  const n = (id: string, kind: string, label: string, config: unknown, x: number, y: number) => ({
    id,
    kind,
    label,
    config,
    ui: at(x, y),
  });
  return {
    schemaVersion: 1,
    name: 'nightly-triage',
    description: 'Triages new issues every night and opens a fix when one is needed',
    nodes: [
      n('nightly', 'trigger', 'Nightly', { subtype: 'cron', expression: '0 2 * * 1-5' }, 0, 0),
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
] as const;

async function json<T>(response: Awaited<ReturnType<APIRequestContext['get']>>): Promise<T> {
  if (!response.ok())
    throw new Error(`${response.url()}: ${response.status()} ${await response.text()}`);
  return (await response.json()) as T;
}

async function waitForStatus(api: APIRequestContext, runId: string, statuses: string[]) {
  for (let i = 0; i < 100; i += 1) {
    const run = await json<{ status: string }>(await api.get(`/runs/${runId}`));
    if (statuses.includes(run.status)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`run ${runId} never reached ${statuses.join(' or ')}`);
}

async function seed(api: APIRequestContext): Promise<Seeded> {
  await control(api, '/harness/script', {
    turns: [
      {
        matchPrompt: 'LABEL',
        error: { code: 'TURN_FAILED', message: 'The harness exited before the turn finished' },
      },
      { matchPrompt: 'SUMMARY', items: 6, finalText: 'Three issues need a decision.' },
      { matchPrompt: 'HELD', items: 3, delayMs: HELD },
      { matchPrompt: 'PAUSE', items: 2, delayMs: HELD },
      { matchPrompt: 'MANY', items: 240, finalText: 'Digest ready.' },
    ],
  });
  const create = async (definition: unknown) =>
    (await json<{ loop: { id: string } }>(await api.post('/loops', { data: { definition } }))).loop
      .id;
  const publish = async (id: string) => json(await api.post(`/loops/${id}/publish`));
  const run = async (id: string) =>
    (await json<{ run: { id: string } }>(await api.post(`/loops/${id}/runs`, { data: {} }))).run.id;

  const review = await create(
    chain('pr-review', 'Reviews an open pull request and leaves comments', [
      ask('review', 'Review diff', 'Review the diff: {{ lastMessage.content }}'),
    ]),
  );
  await publish(review);
  const succeededRun = await run(review);
  await waitForStatus(api, succeededRun, ['succeeded']);

  const labeller = await create(
    chain('issue-labeller', 'Labels incoming issues by area and type', [
      ask('label', 'Label issue', 'LABEL the issue: {{ trigger.payload }}'),
    ]),
  );
  await publish(labeller);
  const failedRun = await run(labeller);
  await waitForStatus(api, failedRun, ['failed']);

  const weekly = await create(
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
  await publish(weekly);
  const waitingRun = await run(weekly);
  await waitForStatus(api, waitingRun, ['waiting']);

  const docs = await create(
    chain('docs-sync', 'Keeps the user guide in step with the API reference', [
      { id: 'hold', kind: 'wait', label: 'Hold', config: { mode: 'input', prompt: 'Continue?' } },
    ]),
  );
  await publish(docs);
  const docsRun = await run(docs);
  await waitForStatus(api, docsRun, ['waiting']);
  await api.post(`/runs/${docsRun}/cancel`);
  await waitForStatus(api, docsRun, ['cancelled']);

  const watch = await create(
    chain('ci-watch', 'Watches a long CI run and reports when it settles', [
      ask('watch', 'Watch CI', 'HELD watch of {{ trigger.payload }}'),
    ]),
  );
  await publish(watch);
  const liveRun = await run(watch);
  await waitForStatus(api, liveRun, ['running']);

  const digest = await create(
    chain('changelog-digest', 'Summarises a busy day of merged changes', [
      ask('digest', 'Digest', 'MANY changes in {{ trigger.payload }}'),
    ]),
  );
  await publish(digest);
  const batchRun = await run(digest);
  await waitForStatus(api, batchRun, ['succeeded']);

  const backup = await create(
    chain('nightly-backup', 'Backs up the workspace and pauses for review', [
      ask('backup', 'Back up', 'PAUSE before the backup of {{ trigger.payload }}'),
    ]),
  );
  await publish(backup);
  let pausedRun: string | undefined = await run(backup);
  await waitForStatus(api, pausedRun, ['running']);
  await api.post(`/runs/${pausedRun}/pause`);
  try {
    await waitForStatus(api, pausedRun, ['paused']);
  } catch {
    // The engine pauses between nodes; a turn held this long may not reach one in time.
    await api.post(`/runs/${pausedRun}/cancel`);
    pausedRun = undefined;
  }

  await create(
    chain('release-notes', 'Drafts release notes from merged pull requests', [
      ask('notes', 'Write notes', 'Release notes for {{ trigger.payload }}'),
    ]),
  );

  const attention = await create(
    chain('needs-attention', 'A draft with problems to fix before publishing', [
      ask('draft', 'Draft reply', 'Reply to {{ trigger.payload '),
      {
        id: 'pick',
        kind: 'decision',
        label: 'Pick',
        // An expression that does not parse, and an edge from a port it does not have.
        config: {
          routes: [
            { label: 'send', description: 'The reply is ready to send' },
            { label: 'hold', description: 'The reply needs a person' },
          ],
          question: 'Is {{ lastOutput }} ready to send?',
          strategy: ['expression'],
          expression: { jsonata: 'vars.ready ? "send" : ' },
        },
      },
    ]),
  );

  const nightly = await create(nightlyTriage(review));
  await publish(nightly);
  const edited = nightlyTriage(review);
  (edited.nodes[1] as { label: string }).label = 'Triage new issues';
  await json(await api.put(`/loops/${nightly}/draft`, { data: { definition: edited } }));

  await json(
    await api.post('/events', {
      data: {
        type: 'issue.opened',
        payload: { repo: 'graphgoblin', number: 482, title: 'Editor crashes on paste' },
        dedupeKey: 'issue-482',
      },
    }),
  );
  await json(
    await api.post('/events', { data: { type: 'build.finished', payload: { ok: true } } }),
  );
  await json(await api.patch('/model-catalog/codex/gpt-6-astra', { data: { enabled: false } }));
  await api.put('/secrets/GITHUB_TOKEN', { data: { value: 'not-a-real-token' } });
  await json(await api.post('/api-keys', { data: { label: 'ci-bot', scopes: ['*'] } }));

  const extra = await control(api, '/apps', { requireApiKey: true });
  return {
    nightly,
    attention,
    weekly,
    waitingRun,
    liveRun,
    succeededRun,
    failedRun,
    batchRun,
    pausedRun,
    apiKeyBase: String(extra['url']),
    apiKeyToken: String(extra['token']),
  };
}

const EDITOR_READY = 'Needs a fix?';
const expanded = () => ({
  'graphgoblin-palette': 'expanded',
  'graphgoblin-loop-panel': 'expanded',
});

/** Open a node's editor from the keyboard, which works however small the canvas draws it. */
async function openNodeDialog(page: Page, id: string) {
  await page.locator(`.react-flow__node[data-id="${id}"]`).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('dialog').waitFor();
}

const SCREENS: Screen[] = [
  { name: 'loops', path: () => '/app/loops', ready: 'nightly-triage', before: true },
  {
    name: 'loops-import-refused',
    path: () => '/app/loops',
    ready: 'nightly-triage',
    act: async (page) => {
      await page.locator('#import-loop').setInputFiles({
        name: 'broken.graphgoblin.json',
        mimeType: 'application/json',
        buffer: Buffer.from(
          JSON.stringify({ format: 'graphgoblin.loop', definition: { name: 7 } }),
        ),
      });
      await page.locator('#import-loop-result').waitFor();
    },
  },
  {
    name: 'loops-delete-confirm',
    path: () => '/app/loops',
    ready: 'nightly-triage',
    act: async (page) => {
      await page.getByRole('button', { name: 'Delete release-notes' }).click();
      await page.getByRole('alertdialog').waitFor();
    },
  },
  {
    name: 'nav-menu',
    path: () => '/app/runs',
    ready: 'Children',
    widths: [360],
    act: async (page) => {
      await page.getByRole('button', { name: 'Menu' }).click();
      await page.getByRole('navigation', { name: 'Main' }).waitFor();
    },
  },
  {
    name: 'editor',
    path: (s) => `/app/loops/${s.nightly}/edit`,
    ready: EDITOR_READY,
    before: true,
  },
  {
    name: 'editor-panels-open',
    path: (s) => `/app/loops/${s.nightly}/edit`,
    ready: EDITOR_READY,
    storage: expanded,
  },
  {
    name: 'editor-issues',
    path: (s) => `/app/loops/${s.attention}/edit`,
    ready: 'Draft reply',
    act: async (page) => {
      await page.getByRole('button', { name: /^\d+ issues? on draft$/ }).click();
      await page.getByRole('dialog', { name: 'Issues on draft' }).waitFor();
    },
  },
  {
    name: 'editor-publish-refused',
    path: (s) => `/app/loops/${s.attention}/edit`,
    ready: 'Draft reply',
    act: async (page) => {
      await page.getByRole('button', { name: 'Publish', exact: true }).click();
      await page.getByText('Publish failed').waitFor();
    },
  },
  ...KIND_NODES.map(([kind, id]): Screen => ({
    name: `node-${kind}`,
    path: (s) => `/app/loops/${s.nightly}/edit`,
    ready: EDITOR_READY,
    act: (page) => openNodeDialog(page, id),
  })),
  { name: 'runs', path: () => '/app/runs', ready: 'Children' },
  { name: 'new-run', path: (s) => `/app/runs/new?loop=${s.weekly}`, ready: 'Start run' },
  {
    name: 'inspector-waiting',
    path: (s) => `/app/runs/${s.waitingRun}`,
    ready: 'Input requested',
    before: true,
  },
  { name: 'inspector-live', path: (s) => `/app/runs/${s.liveRun}`, ready: /events, live/ },
  {
    name: 'inspector-finished',
    path: (s) => `/app/runs/${s.succeededRun}`,
    ready: /events, complete/,
    act: async (page) => {
      const rows = page.getByRole('list', { name: 'Timeline' }).getByRole('button');
      const finished = rows.filter({ hasText: 'node.finished' }).filter({ hasText: 'review' });
      if ((await finished.count()) > 0) await finished.first().click();
      await page
        .getByText(/^Patch from/)
        .first()
        .waitFor();
    },
  },
  { name: 'inspector-failed', path: (s) => `/app/runs/${s.failedRun}`, ready: 'Failed:' },
  {
    name: 'inspector-paused',
    path: (s) => `/app/runs/${s.pausedRun ?? ''}`,
    ready: 'Resume',
    when: (s) => s.pausedRun !== undefined,
  },
  {
    // Several hundred events arrive and render in batches; the timeline scrolls in its card.
    name: 'inspector-event-batches',
    path: (s) => `/app/runs/${s.batchRun}`,
    ready: /\d{3} events, complete/,
  },
  { name: 'events', path: () => '/app/events', ready: 'issue.opened' },
  {
    name: 'settings',
    path: () => '/app/settings',
    ready: 'GPT-6 Astra',
    fullPage: true,
    before: true,
  },
  {
    // The instance that requires a key, with one stored: API keys mark this browser's own.
    name: 'settings-api-keys',
    path: () => '/app/settings',
    ready: 'This browser',
    apiKey: true,
    storage: (s) => ({ 'graphgoblin-api-key': s.apiKeyToken }),
    act: async (page) => {
      await page.getByRole('heading', { name: 'API keys' }).scrollIntoViewIfNeeded();
    },
  },
  { name: 'api-key', path: () => '/app/loops', ready: 'API key required', apiKey: true },
  {
    name: 'offline',
    path: () => '/app/loops',
    ready: 'nightly-triage',
    act: async (page) => {
      await page.context().setOffline(true);
      await page.getByText('You are offline').waitFor();
    },
  },
  {
    name: 'update-toast',
    path: () => '/app/loops',
    ready: 'nightly-triage',
    act: async (page) => {
      await page.evaluate(() => window.graphgoblinPwa?.simulateUpdate());
      await page.getByText('A new version is available').waitFor();
    },
  },
  {
    name: 'error-boundary',
    path: () => '/app/events',
    ready: 'This screen failed to render',
    // A malformed event list (no runIds) makes the Events screen throw while rendering.
    setup: async (page) => {
      await page.route(
        (url) => url.pathname === '/events',
        (route) =>
          route.fulfill({
            json: {
              items: [
                { id: 'broken', type: 'x', source: 'api', receivedAt: new Date().toISOString() },
              ],
            },
          }),
      );
    },
  },
  { name: 'not-found', path: () => '/app/nowhere', ready: /not found/i },
];

async function shoot(
  browser: Browser,
  base: string,
  seeded: Seeded,
  screen: Screen,
  size: (typeof WIDTHS)[number],
  theme: 'dark' | 'light',
  dir: string,
) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  // Contexts made here do not take the config's timeouts: a state that never shows fails the shot.
  context.setDefaultTimeout(20_000);
  try {
    await context.addInitScript(
      ({ theme, storage }) => {
        try {
          window.localStorage.setItem('graphgoblin-theme', theme);
          for (const [key, value] of Object.entries(storage))
            window.localStorage.setItem(key, value);
        } catch {
          // A page without storage keeps the defaults.
        }
      },
      { theme, storage: screen.storage?.(seeded) ?? {} },
    );
    const page = await context.newPage();
    await screen.setup?.(page);
    await page.goto(`${screen.apiKey ? seeded.apiKeyBase : base}${screen.path(seeded)}`);
    await page.getByText(screen.ready).filter({ visible: true }).first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    await screen.act?.(page);
    await page.waitForTimeout(400);
    await page.screenshot({
      path: join(dir, `${screen.name}-${size.width}.png`),
      fullPage: screen.fullPage ?? false,
    });
  } finally {
    await context.close();
  }
}

test('capture every screen', async ({ browser, baseURL }) => {
  const base = baseURL as string;
  const api = await requestFactory.newContext({ baseURL: base });
  const seeded = await seed(api);
  const only = list('GG_CAPTURE_ONLY');
  const widths = list('GG_CAPTURE_WIDTHS')?.map(Number);
  const themes = (list('GG_CAPTURE_THEMES') ?? ['dark', 'light']) as ('dark' | 'light')[];
  const sets = BEFORE
    ? [{ theme: 'light' as const, dir: join(OUT, 'before-light') }]
    : themes.map((theme) => ({ theme, dir: join(OUT, theme) }));
  const failures: string[] = [];
  try {
    for (const { theme, dir } of sets) {
      mkdirSync(dir, { recursive: true });
      for (const size of WIDTHS) {
        if (widths && !widths.includes(size.width)) continue;
        if (BEFORE && size.width !== 768 && size.width !== 1440) continue;
        for (const screen of SCREENS) {
          if (only && !only.includes(screen.name)) continue;
          if (BEFORE && !screen.before) continue;
          if (screen.widths && !screen.widths.includes(size.width)) continue;
          if (screen.when && !screen.when(seeded)) {
            console.log(`skipped ${screen.name}: the seed could not make its state`);
            continue;
          }
          try {
            await shoot(browser, base, seeded, screen, size, theme, dir);
            console.log(`${theme} ${screen.name}-${size.width}`);
          } catch (error) {
            failures.push(`${theme} ${screen.name}-${size.width}: ${String(error)}`);
            console.log(`FAILED ${theme} ${screen.name}-${size.width}: ${String(error)}`);
          }
        }
      }
    }
  } finally {
    // Release the held turns; the runs end now rather than in 24 days.
    await api.post(`/runs/${seeded.liveRun}/cancel`);
    if (seeded.pausedRun) await api.post(`/runs/${seeded.pausedRun}/cancel`);
    await api.dispose();
  }
  if (failures.length > 0) throw new Error(`Screens not captured:\n${failures.join('\n')}`);
});
