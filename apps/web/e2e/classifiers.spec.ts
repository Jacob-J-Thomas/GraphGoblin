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
  method: string;
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
 * `no` leads to a second expression decision.
 */
function decisionLoop(name: string, config: Record<string, unknown>, lone = false) {
  return {
    schemaVersion: 2,
    name,
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
              { id: 'yes', label: 'Yes', criteria: 'The work is done' },
              { id: 'no', label: 'No', criteria: 'More work is needed' },
            ],
          },
          evaluation: config,
          recordAlternatives: true,
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
                answer: {
                  type: 'choice',
                  options: [
                    { id: 'a', label: 'A', criteria: 'A' },
                    { id: 'b', label: 'B', criteria: 'B' },
                  ],
                },
                evaluation: { kind: 'expression', jsonata: '"a"' },
                recordAlternatives: true,
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
  // Add creates only: a second create of the id is refused and changes nothing.
  expect(await put.request().headerValue('if-none-match')).toBe('*');
  const again = await request.put(`${target.url}/classifier-models/kev`, {
    headers: { 'if-none-match': '*' },
    data: { ...put.request().postDataJSON(), providerModel: 'replaced' },
  });
  expect(again.status()).toBe(409);
  expect(await again.json()).toMatchObject({ code: 'CLASSIFIER_EXISTS' });
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
  const editRequest = (await edited).request();
  expect(editRequest.postDataJSON()).not.toHaveProperty('enabled');
  expect(editRequest.postDataJSON()).toMatchObject({ providerModel: 'kev-latest' });
  expect(await editRequest.headerValue('if-none-match')).toBeNull();
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
      kind: 'classifier',
      model: 'jev',
      question: 'Is the work done?',
      context: { messages: 'last', includeLastOutput: true },
    }),
  );
  await page.goto(`${target.url}/app/loops/${loopId}/edit`);
  const editor = await openNode(page, 'pick');
  const picker = editor.getByRole('combobox', { name: 'Model' });
  await expect(picker).toHaveValue('jev');
  await expect(picker.getByRole('option')).toContainText(['Jev (jev)', 'Kev 4B (kev)']);
  const saved = page.waitForRequest(
    (r) =>
      r.method() === 'PUT' &&
      r.url().endsWith(`/loops/${loopId}/draft`) &&
      JSON.stringify(r.postDataJSON()).includes('"model":"kev"'),
  );
  await picker.selectOption('kev');
  const draft = (await saved).postDataJSON() as {
    definition: { nodes: { id: string; config: { evaluation?: unknown } }[] };
  };
  // The primitive keeps its default (Choice), which the form leaves for the contract to fill in.
  expect(draft.definition.nodes.find((n) => n.id === 'pick')!.config.evaluation).toMatchObject({
    kind: 'classifier',
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
  expect(made).toMatchObject({
    answer: { optionId: 'yes' },
    portId: 'yes',
    provenance: { kind: 'classifier', classifierId: 'kev' },
  });
  expect(await endpointRequests(request, target.endpoint)).toEqual([
    {
      method: 'POST',
      url: '/v1/systemone',
      model: 'kev-latest',
      bearer: false,
      labels: ['yes', 'no'],
    },
  ]);
});

test('an unavailable explicit classifier fails without switching evaluator', async ({
  page,
  request,
}) => {
  const target = await instance(request);
  await registerKev(request, target);
  const loopId = await createLoop(
    request,
    target.url,
    decisionLoop('explicit classifier', {
      kind: 'classifier',
      model: 'kev',
      question: 'Is the work done?',
      context: { messages: 'last', includeLastOutput: true },
    }),
  );
  expect((await request.post(`${target.url}/loops/${loopId}/publish`)).status()).toBe(200);

  expect(
    (
      await request.patch(`${target.url}/classifier-models/kev`, { data: { enabled: false } })
    ).status(),
  ).toBe(200);
  await page.goto(`${target.url}/app/loops/${loopId}/edit`);
  await expect(badge(page, 'pick')).toHaveAccessibleName('1 issue on pick');
  const editor = await openNode(page, 'pick');
  const picker = editor.getByRole('combobox', { name: 'Model' });
  await expect(picker).toHaveValue('kev');
  await expect(picker).toHaveAccessibleDescription(/Kev 4B \(kev\) is disabled/);
  await page.keyboard.press('Escape');

  const result = await run(request, target.url, loopId);
  expect(result.status).toBe('failed');
  expect(result.events.some((event) => event.type === 'decision.made')).toBe(false);
  expect(result.events.find((event) => event.type === 'run.failed')).toMatchObject({
    failure: { code: 'EVALUATION_UNAVAILABLE' },
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
        kind: 'classifier',
        model: 'kev',
        minConfidence: 0.5,
        question: 'Which option?',
        context: { messages: 'last', includeLastOutput: true },
      }),
    );
    await page.goto(`${target.url}/app/loops/${loopId}/edit`);
    const editor = await openNode(page, 'pick');
    const method = editor.getByRole('radiogroup', { name: 'Evaluation method' });
    await expect(method.getByRole('radio', { name: 'Classifier' })).toBeChecked();
    const picker = editor.getByRole('combobox', { name: 'Model' });
    await expect(picker).toHaveValue('kev');
    await picker.focus();
    await editor.screenshot({ path: testInfo.outputPath(`classifier-picker-${theme}.png`) });

    // A disabled selection stays selected, with the reason under the field.
    await request.patch(`${target.url}/classifier-models/kev`, { data: { enabled: false } });
    await page.reload();
    const reopened = await openNode(page, 'pick');
    await expect(
      reopened.getByRole('combobox', { name: 'Model' }).locator('option:checked'),
    ).toHaveText('Kev 4B (kev) (disabled)');
    await expect(
      reopened.getByText(
        'Kev 4B (kev) is disabled. Enable it in Settings or choose another classifier.',
      ),
    ).toBeVisible();
    await reopened.screenshot({
      path: testInfo.outputPath(`classifier-picker-disabled-${theme}.png`),
    });

    // Selecting the classifier evaluator never invents a classifier model or selects a fallback.
    const plainId = await createLoop(
      request,
      target.url,
      decisionLoop('classifier picker default', {
        kind: 'expression',
        jsonata: '"no"',
      }),
    );
    await page.goto(`${target.url}/app/loops/${plainId}/edit`);
    const plain = await openNode(page, 'pick');
    const methodPicker = plain.getByRole('radiogroup', { name: 'Evaluation method' });
    const classifierChoice = methodPicker.getByRole('radio', { name: 'Classifier' });
    await classifierChoice.focus();
    await page.keyboard.press('Space');
    await expect(classifierChoice).toBeChecked();
    await expect(plain.getByRole('combobox', { name: 'Model' })).toHaveValue('');
    await expect(
      plain.getByText('Choose an enabled classifier that supports Choice.'),
    ).toBeVisible();
    await plain.screenshot({ path: testInfo.outputPath(`classifier-picker-default-${theme}.png`) });
  });
}
