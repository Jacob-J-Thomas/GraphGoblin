/**
 * Regression specs for the WP-D2 adversarial QA pass (docs/qa/2026-10-03-wp-d2.md). They drive
 * the built app against the in-process API; `control()` scripts the fake harness through the E2E
 * server's control port.
 */
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import {
  approvalLoop,
  closeNode,
  control,
  expect,
  openNode,
  publishLoop,
  showLoopPanel,
  test,
} from './fixtures.js';

const start = { id: 'start', kind: 'trigger', label: 'Start', config: { subtype: 'manual' } };
const done = { id: 'done', kind: 'exit', label: 'Done', config: {} };
function chain(name: string, middle: Record<string, unknown> & { id: string }) {
  return {
    schemaVersion: 3,
    name,
    nodes: [start, middle, done],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: middle.id } },
      { id: 'e2', from: { node: middle.id, port: 'out' }, to: { node: 'done' } },
    ],
  };
}
const ask = (prompt: string) => ({
  id: 'ask',
  kind: 'inference',
  label: 'Ask',
  config: { prompt: { template: prompt } },
});

async function startRun(request: APIRequestContext, loopId: string): Promise<string> {
  const res = await request.post(`/loops/${loopId}/runs`, { data: {} });
  expect(res.status()).toBe(202);
  return ((await res.json()) as { run: { id: string } }).run.id;
}

async function timelineSeqs(page: Page): Promise<number[]> {
  return page
    .getByRole('list', { name: 'Timeline' })
    .getByRole('button')
    .evaluateAll((buttons) =>
      buttons.map((b) => Number(/#(\d+)/.exec(b.textContent ?? '')?.[1] ?? NaN)),
    );
}

test('a subloop child run opens in the inspector and replays from its seeded thread', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Define this test's turn explicitly; the control server's harness is shared across specs.
  await control(request, '/harness/script', {
    turns: [{ matchPrompt: 'child turn', finalText: 'OK' }],
  });
  const childId = await publishLoop(request, chain('qa child', ask('child turn')));
  const parentId = await publishLoop(request, {
    ...chain('qa parent', {
      id: 'sub',
      kind: 'subloop',
      label: 'Sub',
      config: { loopRef: { loopId: childId } },
    }),
  });
  const parentRun = await startRun(request, parentId);
  await expect
    .poll(async () => {
      const res = await request.get(`/runs?parent=${parentRun}`);
      return ((await res.json()) as { items: unknown[] }).items.length;
    })
    .toBe(1);
  const children = (await (await request.get(`/runs?parent=${parentRun}`)).json()) as {
    items: { id: string }[];
  };
  await page.goto(`/app/runs/${children.items[0]!.id}`);
  await expect(page.getByText(/events, complete/)).toBeVisible();
  await expect(page.getByLabel('Messages')).toContainText('OK');
  // The first event: the seeded thread, before any node ran.
  await page.getByRole('list', { name: 'Timeline' }).getByRole('button').first().click();
  await expect(page.getByText('Thread at event 1')).toBeVisible();
  await expect(page.getByText('This screen failed to render')).toHaveCount(0);
  await expect(page.getByText(/cannot be reconstructed/)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('streams 1,200 harness items into the inspector without gaps, duplicates, or a refetch per event', async ({
  page,
  request,
}) => {
  await control(request, '/harness/script', {
    turns: [{ matchPrompt: 'MANY ITEMS', items: 1200, delayMs: 1500 }],
  });
  const loopId = await publishLoop(request, chain('qa many', ask('MANY ITEMS')));
  let runGets = 0;
  page.on('request', (r) => {
    if (/\/runs\/[0-9A-Z]{26}$/.test(new URL(r.url()).pathname)) runGets += 1;
  });
  const runId = await startRun(request, loopId);
  const started = Date.now();
  await page.goto(`/app/runs/${runId}`);
  await expect(page.getByText(/Timeline \(1212 events, complete\)/)).toBeVisible({
    timeout: 30_000,
  });
  const live = Date.now() - started;
  // Twelve lifecycle/evidence facts include the persisted exit evaluation; all 1,200 items remain.
  const timeline = page.getByRole('list', { name: 'Timeline' });
  await expect(timeline.getByRole('button', { name: /^#\d+ node\.progress ask$/ })).toHaveCount(
    1200,
  );
  await expect(timeline.getByRole('button', { name: /^#\d+ harness\.session ask$/ })).toHaveCount(
    1,
  );
  await expect(timeline.getByRole('button', { name: /^#\d+ harness\.usage ask$/ })).toHaveCount(1);
  await expect(timeline.getByRole('button').filter({ hasText: /exit.evaluated/ })).toHaveCount(1);
  const seqs = await timelineSeqs(page);
  expect(seqs).toEqual(Array.from({ length: 1212 }, (_, i) => i + 1));
  // The inspector refetches per 100 ms event batch. Load can stretch the stream beyond five
  // seconds, so budget for elapsed time plus initial/final reads, still rejecting one per item.
  const liveRunGets = runGets;
  expect(liveRunGets).toBeLessThanOrEqual(5 + Math.ceil(live / 100));
  expect(liveRunGets).toBeLessThan(1200);

  // Opening the finished run fresh, then selecting an event deep in the log.
  await page.evaluate(() => sessionStorage.clear());
  const fresh = Date.now();
  await page.reload();
  await expect(page.getByText(/Timeline \(1212 events, complete\)/)).toBeVisible();
  const freshMs = Date.now() - fresh;
  const click = Date.now();
  await page.getByRole('list', { name: 'Timeline' }).getByRole('button').nth(600).click();
  await expect(page.getByText('Thread at event 601')).toBeVisible();
  const clickMs = Date.now() - click;
  console.log(
    `1,212-event run: live to complete ${live} ms (1,500 ms scripted turn), fresh open ${freshMs} ms, select event ${clickMs} ms, ${liveRunGets} live run fetches`,
  );
  expect(freshMs).toBeLessThan(5_000);
  expect(clickMs).toBeLessThan(2_000);
});

test('failure reasons are typed and visible: harness failure and decider unavailable', async ({
  page,
  request,
}) => {
  await control(request, '/harness/script', {
    turns: [{ matchPrompt: 'FAIL THIS', error: { code: 'TURN_FAILED', message: 'scripted' } }],
  });
  const failing = await publishLoop(request, chain('qa failing', ask('FAIL THIS')));
  await page.goto(`/app/runs/${await startRun(request, failing)}`);
  await expect(page.getByText('Failed: HARNESS_TURN_FAILED')).toBeVisible();

  await control(request, '/deciders', { jev: true, codex: true });
  try {
    const decide = {
      schemaVersion: 3,
      name: 'qa decider',
      nodes: [
        start,
        {
          id: 'pick',
          kind: 'decision',
          label: 'Pick',
          config: {
            answer: {
              type: 'choice',
              options: [
                { id: 'a', label: 'A', criteria: 'Choose A' },
                { id: 'b', label: 'B', criteria: 'Choose B' },
              ],
            },
            evaluation: {
              kind: 'llm',
              harness: 'codex',
              model: { mode: 'inherit' },
              effort: { mode: 'inherit' },
              question: 'which?',
            },
          },
        },
        done,
      ],
      edges: [
        { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'pick' } },
        { id: 'e2', from: { node: 'pick', port: 'a' }, to: { node: 'done' } },
        { id: 'e3', from: { node: 'pick', port: 'b' }, to: { node: 'done' } },
      ],
    };
    const loopId = await publishLoop(request, decide);
    // Publication admits a ready evaluator; losing it later is a typed runtime failure.
    await control(request, '/deciders', { jev: true, codex: false });
    await page.goto(`/app/runs/${await startRun(request, loopId)}`);
    await expect(page.getByText('Failed: EVALUATION_UNAVAILABLE')).toBeVisible();
  } finally {
    await control(request, '/deciders', { jev: true, codex: true });
  }
});

test('the editor blocks publishing on template syntax errors and unparsed JSON, and the API agrees', async ({
  page,
  request,
}) => {
  const loopId = await publishLoop(request, approvalLoop('qa syntax'));
  await page.goto(`/app/loops/${loopId}/edit`);
  await showLoopPanel(page);
  await openNode(page, 'approve');
  const prompt = page.locator('[data-field="prompt"] .cm-content');
  await prompt.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Approve {% if x %}');
  // The node editor's badge, beside its title, counts the node's issues; its popover names them.
  const editor = page.getByRole('dialog', { name: 'Edit wait approve' });
  const issues = editor.getByRole('button', { name: /issues? on approve$/ });
  await expect(issues).toHaveAccessibleName('1 issue on approve');
  await issues.click();
  await expect(page.getByRole('dialog', { name: 'Issues on approve' })).toContainText(
    'TEMPLATE_INVALID',
  );
  // Esc closes the popover, not the editor.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Issues on approve' })).toBeHidden();
  await expect(editor).toBeVisible();
  // The page behind the node editor is inert: close it to reach Publish.
  await closeNode(page);
  await expect(page.getByRole('button', { name: '1 error' })).toBeVisible();
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Publish failed')).toBeVisible();
  await expect(page.getByText(/TEMPLATE_INVALID|template at node/).first()).toBeVisible();

  await openNode(page, 'approve');
  await prompt.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Approve?');
  await expect(issues).toHaveCount(0);

  // Input schema text that is not JSON blocks publishing until fixed, after the editor closes.
  const schema = page.locator('[data-field="inputSchema"] .cm-content');
  await schema.click();
  await page.keyboard.type('{"type": ');
  await expect(issues).toHaveAccessibleName('1 issue on approve');
  await issues.click();
  await expect(page.getByRole('dialog', { name: 'Issues on approve' })).toContainText(
    'FIELD_INPUT_INVALID',
  );
  await page.keyboard.press('Escape');
  await closeNode(page);
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(
    page.getByText(
      'Some fields hold input that is not a valid value yet; complete or discard it first.',
    ),
  ).toBeVisible();
  // Delete with focus on the Publish button must not delete the selected node.
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('node-approve')).toBeVisible();
  await openNode(page, 'approve');
  await schema.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await expect(issues).toHaveCount(0);
  // Delete and Backspace inside the editor edit the field, never the graph.
  await expect(page.getByTestId('node-approve')).toBeVisible();
  await closeNode(page);
  await expect(page.getByText('Ready to publish')).toBeVisible();
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText(/Published version 2\.|Nothing to publish/)).toBeVisible();
});

/**
 * Press Tab (or Shift+Tab) until `target` has focus, as a keyboard user would, failing after
 * `limit` presses.
 */
async function tabTo(page: Page, target: Locator, { back = false, limit = 80 } = {}) {
  for (
    let i = 0;
    i < limit && !(await target.evaluate((el) => el === document.activeElement));
    i += 1
  )
    await page.keyboard.press(back ? 'Shift+Tab' : 'Tab');
  await expect(target).toBeFocused();
}

test('keyboard only: add a node, connect it, and publish', async ({ page }) => {
  await page.goto('/app/loops');
  await page.getByLabel('New loop name').fill('qa keyboard');
  await page.getByLabel('New loop name').press('Enter');
  await expect(page.getByRole('heading', { name: 'qa keyboard' })).toBeVisible();

  // Every step from here is a key press: Tab and Shift+Tab move, Enter acts, the arrow keys change a
  // focused select (closed, as Edge and Chromium do on Windows and Linux), Esc closes.
  await tabTo(page, page.getByRole('button', { name: 'Add Wait node' }));
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('node-wait')).toBeInViewport();
  // Rewire start -> wait -> done with the Connect forms.
  // Canvas nodes are focusable; Enter opens the focused node's editor and Esc closes it.
  const startNode = page.locator('.react-flow__node[data-id="start"]');
  await tabTo(page, startNode);
  await page.keyboard.press('Enter');
  const startDialog = page.getByRole('dialog', { name: 'Edit trigger start' });
  await expect(startDialog).toBeVisible();
  await expect(startDialog.getByRole('heading', { name: 'Edit trigger start' })).toBeFocused();
  // Tab walks the dialog in visual order: close, id, label, the config form, connections.
  await page.keyboard.press('Tab');
  await expect(startDialog.getByRole('button', { name: 'Close' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(startDialog.getByLabel('Node id')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(startDialog.getByLabel('Label')).toBeFocused();
  await tabTo(page, startDialog.getByRole('button', { name: 'Remove edge e1' }));
  await page.keyboard.press('Enter');
  const startForm = page.getByRole('form', { name: 'Connect start' });
  await tabTo(page, startForm.getByLabel('To'));
  await expect(startForm.getByLabel('To')).toHaveValue('done');
  await page.keyboard.press('ArrowDown');
  await expect(startForm.getByLabel('To')).toHaveValue('wait');
  await tabTo(page, startForm.getByRole('button', { name: 'Connect' }));
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(startDialog).toHaveCount(0);
  await expect(startNode).toBeFocused();

  const waitNode = page.locator('.react-flow__node[data-id="wait"]');
  await tabTo(page, waitNode);
  await page.keyboard.press('Enter');
  const waitDialog = page.getByRole('dialog', { name: 'Edit wait wait' });
  await expect(waitDialog).toBeVisible();
  const waitForm = page.getByRole('form', { name: 'Connect wait' });
  await tabTo(page, waitForm.getByLabel('To'));
  await page.keyboard.press('ArrowDown');
  await expect(waitForm.getByLabel('To')).toHaveValue('wait');
  await page.keyboard.press('ArrowUp');
  await expect(waitForm.getByLabel('To')).toHaveValue('done');
  await tabTo(page, waitForm.getByRole('button', { name: 'Connect' }));
  await page.keyboard.press('Enter');
  // Past the last control, Tab comes back round to the first: focus stays in the dialog.
  await tabTo(page, waitDialog.getByRole('button', { name: 'Done' }));
  await page.keyboard.press('Tab');
  await expect(waitDialog.getByRole('button', { name: 'Close' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(waitDialog).toHaveCount(0);
  await expect(waitNode).toBeFocused();
  await expect(page.getByText('Ready to publish')).toBeVisible();
  await tabTo(page, page.getByRole('button', { name: 'Publish' }), { back: true });
  await page.keyboard.press('Enter');
  await expect(page.getByText('Published version 1.')).toBeVisible();
});

test('an edit made right before leaving the editor is kept', async ({ page, request }) => {
  const loopId = await publishLoop(request, approvalLoop('qa leave'));
  await page.goto(`/app/loops/${loopId}/edit`);
  await showLoopPanel(page);
  await page.getByLabel('Description').fill('typed just before leaving');
  // Leave inside the 600 ms autosave window.
  await page.getByRole('link', { name: 'Runs', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Runs' })).toBeVisible();
  await page.goto(`/app/loops/${loopId}/edit`);
  await showLoopPanel(page);
  await expect(page.getByLabel('Description')).toHaveValue('typed just before leaving');
  await expect
    .poll(async () => {
      const res = await request.get(`/loops/${loopId}`);
      return ((await res.json()) as { draft?: { definition: { description?: string } } }).draft
        ?.definition.description;
    })
    .toBe('typed just before leaving');
});

test('Settings defaults reach the next run without a restart', async ({ page, request }) => {
  const loopId = await publishLoop(request, chain('qa defaults', ask('defaults check')));
  await page.goto('/app/settings');
  const saved = page.waitForResponse(
    (response) => response.request().method() === 'PUT' && response.url().endsWith('/settings'),
  );
  const refreshed = page.waitForResponse(
    async (response) =>
      response.request().method() === 'GET' &&
      response.url().endsWith('/settings') &&
      ((await response.json()) as { defaults?: { byHarness?: { codex?: { effort?: string } } } })
        .defaults?.byHarness?.codex?.effort === 'high',
  );
  await page.getByLabel('Default effort').selectOption('high');
  expect((await saved).status()).toBe(200);
  // Observe the UI's refetch rather than repeatedly reading Settings while its save is pending.
  await refreshed;
  await expect(page.getByLabel('Default effort')).toHaveValue('high');
  const previous = (await control(request, '/harness/requests')) as { started: unknown[] };
  const previousTurns = previous.started.length;
  await startRun(request, loopId);
  await expect
    .poll(
      async () => {
        const { started } = (await control(request, '/harness/requests')) as {
          started: { effort?: string }[];
        };
        return started[previousTurns]?.effort;
      },
      { timeout: 30_000, intervals: [250, 500, 1000] },
    )
    .toBe('high');
  const removed = page.waitForResponse(
    (response) =>
      response.request().method() === 'DELETE' && response.url().endsWith('/settings/defaults'),
  );
  await page.getByLabel('Default effort').selectOption('');
  expect((await removed).status()).toBe(204);
  expect(await (await request.get('/settings')).json()).not.toHaveProperty('defaults');
});

test('with GG_REQUIRE_API_KEY the shell loads, asks for a key, and uses it', async ({
  browser,
}) => {
  const extra = (await (
    await fetch(`${process.env['GG_E2E_CONTROL_URL'] ?? ''}/apps`, {
      method: 'POST',
      body: JSON.stringify({ requireApiKey: true }),
    })
  ).json()) as { url: string; token: string };
  const context = await browser.newContext({ baseURL: extra.url, serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.goto('/app/loops');
  await expect(page.getByText('API key required')).toBeVisible();
  await page.getByRole('textbox', { name: 'API key' }).fill('gg_not_a_key');
  await page.getByRole('button', { name: 'Use key' }).click();
  await expect(page.getByText(/refused the key stored in this browser/)).toBeVisible();
  await page.getByRole('textbox', { name: 'API key' }).fill(extra.token);
  await page.getByRole('button', { name: 'Use key' }).click();
  await expect(page.getByText('API key required')).toHaveCount(0);
  await expect(page.getByText('No loops yet.')).toBeVisible();
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Forget key' }).click();
  await page.reload();
  await expect(page.getByText('API key required')).toBeVisible();
  await context.close();
});

test('with GG_REQUIRE_API_KEY, editor and inspector deep links go live once the key is entered', async ({
  browser,
  playwright,
}) => {
  const extra = (await (
    await fetch(`${process.env['GG_E2E_CONTROL_URL'] ?? ''}/apps`, {
      method: 'POST',
      body: JSON.stringify({ requireApiKey: true }),
    })
  ).json()) as { url: string; token: string };
  const api = await playwright.request.newContext({
    baseURL: extra.url,
    extraHTTPHeaders: { authorization: `Bearer ${extra.token}` },
  });
  const loopId = await publishLoop(api, approvalLoop('qa key deep links'));
  const run = await api.post(`/loops/${loopId}/runs`, { data: {} });
  const runId = ((await run.json()) as { run: { id: string } }).run.id;
  await api.dispose();

  for (const [path, live] of [
    [`/app/loops/${loopId}/edit`, 'heading'],
    [`/app/runs/${runId}`, 'timeline'],
  ] as const) {
    const context = await browser.newContext({ baseURL: extra.url, serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.goto(path);
    await expect(page.getByText('API key required')).toBeVisible();
    await page.getByRole('textbox', { name: 'API key' }).fill(extra.token);
    await page.getByRole('button', { name: 'Use key' }).click();
    if (live === 'heading') {
      await expect(page.getByRole('heading', { name: 'qa key deep links' })).toBeVisible();
    } else {
      await expect(page.getByText('Input requested')).toBeVisible();
      await expect(page.getByText(/events, live/)).toBeVisible();
    }
    await context.close();
  }
});

test('main screens fit 1024x768 without horizontal scrolling, and deep links load cold', async ({
  browser,
  request,
}) => {
  const loopId = await publishLoop(request, approvalLoop('qa viewport'));
  const runId = await startRun(request, loopId);
  const context = await browser.newContext({
    baseURL: process.env['GG_E2E_BASE_URL'] ?? '',
    viewport: { width: 1024, height: 768 },
  });
  const page = await context.newPage();
  for (const path of [
    '/app/loops',
    `/app/loops/${loopId}/edit`,
    '/app/runs',
    `/app/runs/new?loop=${loopId}`,
    `/app/runs/${runId}`,
    '/app/events',
    '/app/settings',
  ]) {
    await page.goto(path);
    await expect(page.locator('header').first()).toBeVisible();
    await page.waitForTimeout(500);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow, path).toBe(false);
  }
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  expect((await page.request.get('/app/assets/missing-123.js')).status()).toBe(404);
  const root = await page.request.get('/', { maxRedirects: 0 });
  expect(root.status()).toBe(302);
  expect(root.headers()['location']).toBe('/app/');
  await context.close();
});
