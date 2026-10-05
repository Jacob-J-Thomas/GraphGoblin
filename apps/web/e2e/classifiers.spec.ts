/**
 * #43, the UI half: Settings → Classifier models and the decision's classifier picker, against an
 * API instance with the real classifier catalog, secret resolution, and HTTP transport
 * (`createTestApp({ realClassifiers: true })`) and a loopback Choice endpoint
 * (`startFakeClassifierEndpoint`), both started through the E2E control server.
 */
import { ClassifierModelSummarySchema, RunEventSchema } from '@graphgoblin/contracts';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { control, expect, openNode, test } from './fixtures.js';

interface Instance {
  url: string;
  endpoint: string;
}

async function instance(request: APIRequestContext): Promise<Instance> {
  const app = await control(request, '/apps', { realClassifiers: true });
  const fake = await control(request, '/classifier/start');
  return { url: String(app['url']), endpoint: String(fake['endpoint']) };
}

interface EndpointRequest {
  url: string;
  model: string;
  bearer: boolean;
  labels: string[];
}

async function endpointRequests(
  request: APIRequestContext,
  endpoint: string,
): Promise<EndpointRequest[]> {
  return (await control(request, '/classifier/requests', { endpoint }))[
    'requests'
  ] as EndpointRequest[];
}

/** Register `kev` on the endpoint through the API, enabled. */
async function registerKev(request: APIRequestContext, { url, endpoint }: Instance) {
  const put = await request.put(`${url}/classifier-models/kev`, {
    data: {
      displayName: 'Kev 4B',
      providerModel: 'kev-latest',
      endpoint,
      primitives: ['choice'],
      provider: 'http',
    },
  });
  expect(put.status()).toBe(200);
  expect(
    (await request.patch(`${url}/classifier-models/kev`, { data: { enabled: true } })).status(),
  ).toBe(200);
}

async function classifierList(request: APIRequestContext, url: string) {
  const body = (await (await request.get(`${url}/classifier-models`)).json()) as {
    items: unknown;
  };
  return ClassifierModelSummarySchema.array().parse(body.items);
}

const start = {
  id: 'start',
  kind: 'trigger',
  label: 'Start',
  config: { subtype: 'manual' },
  ui: { x: 0, y: 80 },
};

/**
 * A manual trigger, a decision `pick` between `yes` and `no`, and an exit per route. With `lone`,
 * `no` leads instead to a second decision whose only strategy is the built-in Jev.
 */
function decisionLoop(name: string, config: Record<string, unknown>, lone = false) {
  return {
    schemaVersion: 1,
    name,
    nodes: [
      start,
      {
        id: 'pick',
        kind: 'decision',
        label: 'Pick',
        config: {
          routes: [
            { label: 'yes', description: 'The work is done' },
            { label: 'no', description: 'More work is needed' },
          ],
          question: 'Is the work done?',
          ...config,
        },
        ui: { x: 260, y: 80 },
      },
      { id: 'done', kind: 'exit', label: 'Done', config: {}, ui: { x: 540, y: 0 } },
      { id: 'again', kind: 'exit', label: 'Again', config: {}, ui: { x: 540, y: 180 } },
      ...(lone
        ? [
            {
              id: 'lone',
              kind: 'decision',
              label: 'Lone',
              config: {
                routes: [
                  { label: 'a', description: 'A' },
                  { label: 'b', description: 'B' },
                ],
                question: 'Which?',
                strategy: ['jev'],
              },
              ui: { x: 260, y: 300 },
            },
          ]
        : []),
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'pick' } },
      { id: 'e2', from: { node: 'pick', port: 'yes' }, to: { node: 'done' } },
      ...(lone
        ? [
            { id: 'e3', from: { node: 'pick', port: 'no' }, to: { node: 'lone' } },
            { id: 'e4', from: { node: 'lone', port: 'a' }, to: { node: 'done' } },
            { id: 'e5', from: { node: 'lone', port: 'b' }, to: { node: 'again' } },
          ]
        : [{ id: 'e3', from: { node: 'pick', port: 'no' }, to: { node: 'again' } }]),
    ],
  };
}

async function createLoop(request: APIRequestContext, url: string, definition: unknown) {
  const created = await request.post(`${url}/loops`, { data: { definition } });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { loop: { id: string } }).loop.id;
}

/** Start a run of the published version and wait for it to finish; returns its events. */
async function run(request: APIRequestContext, url: string, loopId: string) {
  const started = await request.post(`${url}/loops/${loopId}/runs`, { data: {} });
  expect(started.status()).toBe(202);
  const runId = ((await started.json()) as { run: { id: string } }).run.id;
  await expect
    .poll(
      async () =>
        ((await (await request.get(`${url}/runs/${runId}`)).json()) as { status: string }).status,
    )
    .toMatch(/^(succeeded|failed)$/);
  const events = (await (await request.get(`${url}/runs/${runId}/events`)).json()) as {
    items: unknown[];
  };
  const parsed = events.items.map((event) => RunEventSchema.parse(event));
  const status = ((await (await request.get(`${url}/runs/${runId}`)).json()) as { status: string })
    .status;
  return { status, events: parsed };
}

async function tabTo(page: Page, target: Locator) {
  for (
    let i = 0;
    i < 60 && !(await target.evaluate((element) => element === document.activeElement));
    i++
  )
    await page.keyboard.press('Tab');
  await expect(target).toBeFocused();
}

const card = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const badge = (page: Page, id: string) =>
  card(page, id).getByRole('button', { name: new RegExp(`^\\d+ issues? on ${id}$`) });

test('Settings registers, enables, edits, disables, and deletes a classifier from the keyboard, and it persists', async ({
  page,
  request,
}) => {
  const target = await instance(request);
  await page.goto(`${target.url}/app/settings`);
  const section = page.getByRole('region', { name: 'Classifier models' });
  // Below the LLM catalog; the built-in is listed first and needs its key.
  const headings = await page.getByRole('heading', { level: 2 }).allTextContents();
  expect(headings.indexOf('Classifier models')).toBe(headings.indexOf('Model catalog') + 1);
  const jevRow = section.getByRole('switch', { name: 'Enable Jev' }).locator('xpath=ancestor::tr');
  await expect(jevRow).toContainText('Needs a key');
  await expect(jevRow).toContainText(
    "Missing or blank secret 'jev-api-key'. Set it in Settings, Secrets.",
  );
  await expect(jevRow.getByRole('button')).toHaveCount(0);
  await expect(section.getByRole('columnheader', { name: 'Actions' })).toHaveCount(0);

  // Add, from the keyboard only.
  const add = section.getByRole('button', { name: 'Add classifier' });
  await tabTo(page, add);
  await page.keyboard.press('Enter');
  const form = page.getByRole('form', { name: 'Add classifier' });
  await expect(form.getByLabel('Id', { exact: true })).toBeFocused();
  await page.keyboard.type('kev');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Kev 4B');
  await page.keyboard.press('Tab');
  await page.keyboard.type('kev-latest');
  await page.keyboard.press('Tab');
  await page.keyboard.type(`${target.endpoint}/v1/systemone`);
  const save = form.getByRole('button', { name: 'Save classifier' });
  await tabTo(page, save);
  await page.keyboard.press('Enter');
  // The contract's rule, in a sentence beside the field, which takes focus.
  await expect(form.getByLabel('Endpoint', { exact: true })).toBeFocused();
  await expect(form.getByRole('alert')).toHaveText(
    'Enter the API root only; GraphGoblin adds /v1/systemone itself.',
  );
  await page.keyboard.press('Control+A');
  await page.keyboard.type(target.endpoint);
  const created = page.waitForResponse(
    (r) => r.request().method() === 'PUT' && r.url().endsWith('/classifier-models/kev'),
  );
  await page.keyboard.press('Enter');
  const put = await created;
  expect(put.status()).toBe(200);
  expect(put.request().postDataJSON()).toEqual({
    displayName: 'Kev 4B',
    providerModel: 'kev-latest',
    endpoint: target.endpoint,
    primitives: ['choice'],
    provider: 'http',
  });
  const edit = section.getByRole('button', { name: 'Edit classifier kev' });
  await expect(edit).toBeFocused();
  const kev = section.getByRole('switch', { name: 'Enable Kev 4B' });
  await expect(kev).not.toBeChecked();
  const kevRow = kev.locator('xpath=ancestor::tr');
  await expect(kevRow).toContainText('Configured');
  await expect(kevRow).toContainText('Choice / classification');

  // Enable with Space; focus stays on the switch.
  await tabTo(page, kev);
  const enabled = page.waitForResponse(
    (r) => r.request().method() === 'PATCH' && r.url().endsWith('/classifier-models/kev'),
  );
  await page.keyboard.press('Space');
  expect((await enabled).request().postDataJSON()).toEqual({ enabled: true });
  await expect(kev).toBeChecked();
  await expect(kev).toBeFocused();
  await expect(kevRow.getByRole('status')).toContainText('Enabled');

  // Edit the name: the id is fixed and enabled is kept.
  await page.keyboard.press('Shift+Tab');
  await tabTo(page, edit);
  await page.keyboard.press('Enter');
  const editForm = page.getByRole('form', { name: 'Edit classifier kev' });
  await expect(editForm.getByLabel('Display name')).toBeFocused();
  await expect(editForm.getByLabel('Id', { exact: true })).toHaveAttribute('readonly', '');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Kev local');
  const edited = page.waitForResponse(
    (r) => r.request().method() === 'PUT' && r.url().endsWith('/classifier-models/kev'),
  );
  await page.keyboard.press('Enter');
  expect((await edited).request().postDataJSON()).not.toHaveProperty('enabled');
  await expect(edit).toBeFocused();
  await expect(section.getByRole('switch', { name: 'Enable Kev local' })).toBeChecked();

  // Reload: the entry and its state persist.
  await page.reload();
  const reloaded = section.getByRole('switch', { name: 'Enable Kev local' });
  await expect(reloaded).toBeChecked();
  expect((await classifierList(request, target.url)).map((e) => [e.id, e.enabled])).toEqual([
    ['jev', true],
    ['kev', true],
  ]);

  // Disable again, then delete: Escape keeps it, confirming removes it and focuses the heading.
  await tabTo(page, reloaded);
  await page.keyboard.press('Space');
  await expect(reloaded).not.toBeChecked();
  await expect(reloaded).toHaveAttribute('aria-busy', 'false');
  const remove = section.getByRole('button', { name: 'Delete classifier kev' });
  await tabTo(page, remove);
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Decision nodes that select kev keep the id.');
  await expect(dialog.getByRole('button', { name: 'Keep' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(remove).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Confirm delete kev' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(remove).toHaveCount(0);
  await expect(section.getByRole('heading', { name: 'Classifier models' })).toBeFocused();
  expect((await classifierList(request, target.url)).map((e) => e.id)).toEqual(['jev']);
});

test('a decision selects the classifier, publishes, and runs against its endpoint', async ({
  page,
  request,
}) => {
  const target = await instance(request);
  await registerKev(request, target);
  const loopId = await createLoop(
    request,
    target.url,
    decisionLoop('classifier run', {
      strategy: ['jev', 'expression'],
      expression: { jsonata: '"no"' },
    }),
  );
  await page.goto(`${target.url}/app/loops/${loopId}/edit`);
  const editor = await openNode(page, 'pick');
  await editor.getByRole('button', { name: 'Add jev' }).click();
  const picker = editor
    .getByRole('group', { name: 'Jev' })
    .getByRole('combobox', { name: 'Model' });
  await expect(picker.locator('option:checked')).toHaveText('Jev (jev), the default (needs a key)');
  await expect(picker.getByRole('option')).toHaveText([
    'Jev (jev), the default (needs a key)',
    'Kev 4B (kev)',
  ]);
  const saved = page.waitForRequest(
    (r) =>
      r.method() === 'PUT' &&
      r.url().endsWith(`/loops/${loopId}/draft`) &&
      JSON.stringify(r.postDataJSON()).includes('"model":"kev"'),
  );
  await picker.selectOption('kev');
  const draft = (await saved).postDataJSON() as {
    definition: { nodes: { id: string; config: { jev?: unknown } }[] };
  };
  // The primitive keeps its default (Choice), which the form leaves for the contract to fill in.
  expect(draft.definition.nodes.find((n) => n.id === 'pick')!.config.jev).toMatchObject({
    model: 'kev',
  });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const published = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith(`/loops/${loopId}/publish`),
  );
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  expect((await published).status()).toBe(200);

  const { status, events } = await run(request, target.url, loopId);
  expect(status).toBe('succeeded');
  const made = events.find((e) => e.type === 'decision.made');
  expect(made).toMatchObject({ strategy: 'jev', classifierModel: 'kev', route: 'yes' });
  expect(await endpointRequests(request, target.endpoint)).toEqual([
    { url: '/v1/systemone', model: 'kev-latest', bearer: false, labels: ['yes', 'no'] },
  ]);
});

test('missing-key, disabled, and deleted classifiers warn or block, and runs fall back', async ({
  page,
  request,
}, testInfo) => {
  const target = await instance(request);
  await registerKev(request, target);
  const loopId = await createLoop(
    request,
    target.url,
    decisionLoop(
      'classifier diagnostics',
      {
        strategy: ['jev', 'expression'],
        jev: { primitive: 'choice', model: 'kev' },
        // The fallback answers yes, which ends the run; `no` would reach the lone decision.
        expression: { jsonata: '"yes"' },
      },
      true,
    ),
  );
  expect((await request.post(`${target.url}/loops/${loopId}/publish`)).status()).toBe(200);

  // Disabled: a warning on the node, the picker keeps the selection, the run falls back.
  expect(
    (
      await request.patch(`${target.url}/classifier-models/kev`, { data: { enabled: false } })
    ).status(),
  ).toBe(200);
  await page.goto(`${target.url}/app/loops/${loopId}/edit`);
  const pick = badge(page, 'pick');
  await expect(pick).toHaveAccessibleName('1 issue on pick');
  await pick.click();
  const issues = page.getByRole('dialog', { name: 'Issues on pick' });
  const disabled = issues.getByRole('button', { name: /^Warning CLASSIFIER_MODEL_DISABLED/ });
  await expect(disabled).toContainText(
    "Decision 'Pick' (pick), classifier 'Kev 4B' (kev): model is disabled. Enable it in Settings, Classifier models. This strategy will be skipped.",
  );
  await expect(disabled).toContainText('config.jev.model');
  await disabled.click();
  const editor = page.getByRole('dialog', { name: 'Edit decision pick' });
  const picker = editor
    .getByRole('group', { name: 'Jev' })
    .getByRole('combobox', { name: 'Model' });
  await expect(picker).toBeFocused();
  await expect(picker.locator('option:checked')).toHaveText('Kev 4B (kev) (disabled)');
  await expect(picker).toHaveAccessibleDescription(
    /Kev 4B \(kev\) is disabled, so this decision skips its Jev strategy/,
  );
  await page.keyboard.press('Escape');
  let result = await run(request, target.url, loopId);
  expect(result.status).toBe('succeeded');
  expect(
    result.events.find((e) => e.type === 'decision.made' && e.nodeId === 'pick'),
  ).toMatchObject({
    strategy: 'expression',
    route: 'yes',
  });
  expect(await endpointRequests(request, target.endpoint)).toEqual([]);

  // Missing key, with no later strategy: the popover explains the decision cannot route.
  const lone = badge(page, 'lone');
  await lone.click();
  const loneIssues = page.getByRole('dialog', { name: 'Issues on lone' });
  const missing = loneIssues.getByRole('button', { name: /^Warning CLASSIFIER_SECRET_MISSING/ });
  await expect(missing).toContainText(
    "Decision 'Lone' (lone), classifier 'Jev' (jev): Missing or blank secret 'jev-api-key'. Set it in Settings, Secrets. This strategy will be skipped and the decision cannot currently produce a route.",
  );
  await loneIssues.screenshot({ path: testInfo.outputPath('classifier-issue-popover-dark.png') });
  await missing.click();
  // No Jev options yet: focus lands on the button that adds them, next to the picker.
  const loneEditor = page.getByRole('dialog', { name: 'Edit decision lone' });
  await expect(loneEditor.getByRole('button', { name: 'Add jev' })).toBeFocused();
  await page.keyboard.press('Escape');

  // Deleted while a published loop refers to it: an error blocks publishing the draft, the
  // picker keeps the id, and the published version still runs through the fallback.
  expect((await request.delete(`${target.url}/classifier-models/kev`)).status()).toBe(204);
  await page.reload();
  await expect(badge(page, 'pick')).toHaveAccessibleName('1 issue on pick');
  await badge(page, 'pick').click();
  await expect(
    page
      .getByRole('dialog', { name: 'Issues on pick' })
      .getByRole('button', { name: /^Error CLASSIFIER_MODEL_NOT_FOUND/ }),
  ).toContainText(
    'model not found. Register it in Settings, Classifier models, or select an existing model.',
  );
  await page.keyboard.press('Escape');
  await openNode(page, 'pick');
  await expect(
    page
      .getByRole('dialog', { name: 'Edit decision pick' })
      .getByRole('group', { name: 'Jev' })
      .getByRole('combobox', { name: 'Model' })
      .locator('option:checked'),
  ).toHaveText('kev (not in catalog)');
  await page.keyboard.press('Escape');
  const validate = await request.post(`${target.url}/loops/${loopId}/validate`, {
    data: {
      definition: (
        (await (await request.get(`${target.url}/loops/${loopId}`)).json()) as {
          current: { definition: unknown };
        }
      ).current.definition,
    },
  });
  expect(((await validate.json()) as { publishable: boolean }).publishable).toBe(false);
  result = await run(request, target.url, loopId);
  expect(result.status).toBe('succeeded');
  expect(
    result.events.find((e) => e.type === 'decision.made' && e.nodeId === 'pick'),
  ).toMatchObject({
    strategy: 'expression',
    route: 'yes',
  });
  expect(await endpointRequests(request, target.endpoint)).toEqual([]);
});

for (const theme of ['dark', 'light'] as const) {
  test(`Settings and the picker in ${theme}, at 768 px: empty, with a custom entry, a missing secret`, async ({
    page,
    request,
  }, testInfo) => {
    const target = await instance(request);
    await page.addInitScript((choice) => localStorage.setItem('graphgoblin-theme', choice), theme);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${target.url}/app/settings`);
    const section = page.getByRole('region', { name: 'Classifier models' });
    await expect(section.getByRole('switch', { name: 'Enable Jev' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.dataset['theme'])).toBe(theme);
    await section.screenshot({ path: testInfo.outputPath(`classifier-models-empty-${theme}.png`) });

    // The Add form's checks, before anything is sent.
    await section.getByRole('button', { name: 'Add classifier' }).click();
    const form = page.getByRole('form', { name: 'Add classifier' });
    await form.getByLabel('Endpoint', { exact: true }).fill('http://127.0.0.1:0');
    await form.getByRole('button', { name: 'Save classifier' }).click();
    await expect(form.getByRole('alert')).toHaveCount(4);
    await form.screenshot({ path: testInfo.outputPath(`classifier-form-errors-${theme}.png`) });
    await form.getByRole('button', { name: 'Cancel' }).click();

    // With a custom entry; the switch's focus ring shows in this theme.
    await registerKev(request, target);
    await page.reload();
    const kev = section.getByRole('switch', { name: 'Enable Kev 4B' });
    await tabTo(page, kev);
    expect(await kev.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
    await section.screenshot({
      path: testInfo.outputPath(`classifier-models-custom-${theme}.png`),
    });

    // A missing secret: Kev now authenticates with a key that is not set.
    const put = await request.put(`${target.url}/classifier-models/kev`, {
      data: {
        displayName: 'Kev 4B',
        providerModel: 'kev-latest',
        endpoint: target.endpoint,
        primitives: ['choice'],
        provider: 'http',
        secretRef: 'kev-key',
      },
    });
    expect(put.status()).toBe(200);
    await page.reload();
    const kevRow = kev.locator('xpath=ancestor::tr');
    await expect(kevRow).toContainText('Needs a key');
    await expect(kevRow).toContainText(
      "Missing or blank secret 'kev-key'. Set it in Settings, Secrets.",
    );
    await section.screenshot({
      path: testInfo.outputPath(`classifier-models-missing-secret-${theme}.png`),
    });
    // The link goes to Secrets with focus on its heading; setting the key configures Kev.
    await kevRow.getByRole('link', { name: 'Open Secrets' }).click();
    await expect(page.getByRole('heading', { name: 'Secrets', exact: true })).toBeFocused();
    await page.getByLabel('Name', { exact: true }).fill('kev-key');
    await page.getByLabel('Value', { exact: true }).fill('fixture-only');
    await page.getByRole('button', { name: 'Set secret' }).click();
    await expect(kevRow).toContainText('Configured');

    // 768 px: the page does not scroll sideways and the table fits its card.
    await page.setViewportSize({ width: 768, height: 1000 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(768);
    const fits = await section.locator('table').evaluate((table) => {
      const box = table.parentElement!;
      return table.scrollWidth <= box.clientWidth;
    });
    expect(fits).toBe(true);
    await section.screenshot({ path: testInfo.outputPath(`classifier-models-768-${theme}.png`) });

    // The picker in the node editor.
    await page.setViewportSize({ width: 1280, height: 900 });
    const loopId = await createLoop(
      request,
      target.url,
      decisionLoop('classifier picker', {
        strategy: ['jev', 'expression'],
        jev: { primitive: 'choice', model: 'kev', minConfidence: 0.5 },
        expression: { jsonata: '"no"' },
      }),
    );
    await page.goto(`${target.url}/app/loops/${loopId}/edit`);
    const editor = await openNode(page, 'pick');
    const jev = editor.getByRole('group', { name: 'Jev' });
    const picker = jev.getByRole('combobox', { name: 'Model' });
    await expect(picker).toHaveValue('kev');
    await picker.focus();
    await jev.screenshot({ path: testInfo.outputPath(`classifier-picker-${theme}.png`) });

    // A disabled selection stays selected, with the reason under the field.
    await request.patch(`${target.url}/classifier-models/kev`, { data: { enabled: false } });
    await page.reload();
    const reopened = (await openNode(page, 'pick')).getByRole('group', { name: 'Jev' });
    await expect(
      reopened.getByRole('combobox', { name: 'Model' }).locator('option:checked'),
    ).toHaveText('Kev 4B (kev) (disabled)');
    await reopened.screenshot({
      path: testInfo.outputPath(`classifier-picker-disabled-${theme}.png`),
    });
  });
}
