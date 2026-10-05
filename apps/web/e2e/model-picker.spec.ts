import { LoopDefinitionSchema, ModelCatalogEntrySchema } from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { closeNode, control, expect, openNode, showLoopPanel, test } from './fixtures.js';

function inferenceLoop(name: string, model?: string) {
  const source = minimalLoop();
  return {
    ...source,
    name,
    nodes: [
      source.nodes[0]!,
      {
        id: 'infer',
        kind: 'inference',
        label: 'Infer',
        config: { prompt: { template: 'picker run' }, ...(model ? { model } : {}) },
      },
      source.nodes[1]!,
    ].map((node, i) => ({ ...node, ui: { x: i * 260, y: 80 } })),
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'infer' } },
      { id: 'e2', from: { node: 'infer', port: 'out' }, to: { node: 'done' } },
    ],
  };
}

for (const theme of ['dark', 'light']) {
  test(`catalog model and effort publish and reach the harness (${theme})`, async ({
    page,
    request,
  }) => {
    const selected = `picker-${theme}`;
    await control(request, '/catalog/upsert', {
      harness: 'codex',
      model: selected,
      displayName: `Picker ${theme}`,
      efforts: ['low', 'high'],
      defaultEffort: 'low',
      enabled: true,
      source: 'harness',
    });
    const created = await request.post('/loops', {
      data: { definition: inferenceLoop(`picker ${theme}`) },
    });
    expect(created.status()).toBe(201);
    const { loop } = (await created.json()) as { loop: { id: string } };
    await page.addInitScript((choice) => localStorage.setItem('graphgoblin-theme', choice), theme);
    await page.goto(`/app/loops/${loop.id}/edit`);
    const dialog = await openNode(page, 'infer');
    const model = dialog.getByLabel('Model', { exact: true });
    await expect(model).toHaveValue('');
    await model.focus();
    await page.keyboard.type(`Picker ${theme}`);
    await page.keyboard.press('Enter');
    await expect(model).toHaveValue(selected);
    const effort = dialog.getByLabel('Effort', { exact: true });
    await expect(effort.locator('option')).toHaveText([
      '(inherited effort; catalog default: low)',
      'low',
      'high',
    ]);
    await effort.focus();
    await page.keyboard.press('h');
    await page.keyboard.press('Enter');
    await expect(effort).toHaveValue('high');
    await closeNode(page);
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByText('Published version 1.')).toBeVisible();
    const read = await request.get(`/loops/${loop.id}`);
    const stored = (await read.json()) as { current: { definition: unknown } };
    const config = LoopDefinitionSchema.parse(stored.current.definition).nodes.find(
      (node) => node.id === 'infer',
    )?.config;
    expect(config).toMatchObject({ model: selected, effort: 'high' });
    await control(request, '/harness/script', { turns: [{ finalText: 'picker done' }] });
    const before = (await control(request, '/harness/requests')) as {
      started: { model: string; effort: string }[];
    };
    await page.getByRole('link', { name: 'Open in Runs' }).first().click();
    await page.getByRole('button', { name: 'Start run', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/runs\/[0-9A-Z]{26}$/);
    await expect
      .poll(async () =>
        ((await control(request, '/harness/requests')) as typeof before).started.slice(
          before.started.length,
        ),
      )
      .toEqual([{ model: selected, effort: 'high' }]);
    await expect(page.locator('[data-status="succeeded"]').first()).toBeVisible();
  });
}

test('an unknown model in an imported loop stays selected and field warnings include the API warning', async ({
  page,
  request,
}) => {
  const imported = await request.post('/loops/import', {
    data: inferenceLoop('imported unknown picker', 'imported-unknown-model'),
  });
  expect(imported.status()).toBe(201);
  const { loop } = (await imported.json()) as { loop: { id: string } };
  await page.goto(`/app/loops/${loop.id}/edit`);
  const dialog = await openNode(page, 'infer');
  const model = dialog.getByLabel('Model', { exact: true });
  await expect(model).toHaveValue('imported-unknown-model');
  await expect(model.locator('option:checked')).toHaveText(
    'imported-unknown-model (not in catalog)',
  );
  await expect(model).toHaveAccessibleDescription(/not in catalog/);
  await expect(model).toHaveAccessibleDescription(/MODEL_NOT_IN_CATALOG/);
  await expect(dialog.getByRole('link', { name: 'Model catalog in Settings' })).toHaveAttribute(
    'href',
    '/app/settings',
  );
  await closeNode(page);
  await page.route('**/model-catalog', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/problem+json',
      body: JSON.stringify({ status: 503, code: 'FAILED', detail: 'catalog unavailable' }),
    }),
  );
  await page.reload();
  const offlineDialog = await openNode(page, 'infer');
  const offlineModel = offlineDialog.getByLabel('Model', { exact: true });
  await expect(offlineModel).toHaveValue('imported-unknown-model');
  await expect(offlineModel).toHaveAttribute('readonly', '');
  await expect(offlineModel).toHaveAccessibleDescription(/Cannot load the model catalog/);
  await expect(offlineModel).toHaveAccessibleDescription(/MODEL_NOT_IN_CATALOG/);
});

test('catalog failure preserves the current values until retry and loop defaults share the picker', async ({
  page,
  request,
}) => {
  const catalog = ModelCatalogEntrySchema.array().parse(
    ((await (await request.get('/model-catalog')).json()) as { items: unknown }).items,
  );
  const chosen = catalog.find((entry) => entry.enabled && entry.harness === 'codex')!;
  const created = await request.post('/loops', {
    data: { definition: inferenceLoop('failed catalog picker', chosen.model) },
  });
  const { loop } = (await created.json()) as { loop: { id: string } };
  await page.route('**/model-catalog', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/problem+json',
      body: JSON.stringify({ status: 503, code: 'FAILED', detail: 'catalog unavailable' }),
    }),
  );
  await page.goto(`/app/loops/${loop.id}/edit`);
  const dialog = await openNode(page, 'infer');
  const model = dialog.getByLabel('Model', { exact: true });
  await expect(model).toHaveValue(chosen.model);
  await expect(model).toHaveAttribute('readonly', '');
  await expect(model).toHaveAccessibleDescription(/Cannot load the model catalog/);
  await page.unroute('**/model-catalog');
  await dialog.getByRole('button', { name: 'Retry model catalog' }).first().click();
  await expect(model).not.toHaveAttribute('readonly');
  await expect(model).toHaveValue(chosen.model);
  await closeNode(page);
  await showLoopPanel(page);
  const settings = page.getByRole('form', { name: 'Loop settings form' });
  await settings.getByLabel('Model', { exact: true }).selectOption(chosen.model);
  await expect(settings.getByLabel('Effort', { exact: true }).locator('option')).toHaveCount(
    chosen.efforts.length + 1,
  );
  await expect(settings.getByLabel('Model', { exact: true }).locator('option').first()).toHaveText(
    '(owner default)',
  );
});

test('the decision Codex group uses catalog models and keeps unsupported efforts', async ({
  page,
  request,
}) => {
  await control(request, '/catalog/upsert', {
    harness: 'codex',
    model: 'picker-decision',
    displayName: 'Picker decision',
    efforts: ['low', 'high'],
    defaultEffort: 'low',
    enabled: true,
    source: 'harness',
  });
  const source = inferenceLoop('decision picker');
  const created = await request.post('/loops', {
    data: {
      definition: {
        ...source,
        nodes: source.nodes.map((node) =>
          node.id === 'infer'
            ? {
                ...node,
                kind: 'decision',
                config: {
                  routes: [
                    { label: 'yes', description: '' },
                    { label: 'no', description: '' },
                  ],
                  question: 'q',
                  strategy: ['codex'],
                  codex: { model: 'picker-decision', effort: 'max' },
                },
              }
            : node,
        ),
        edges: [
          source.edges[0],
          { id: 'yes', from: { node: 'infer', port: 'yes' }, to: { node: 'done' } },
          { id: 'no', from: { node: 'infer', port: 'no' }, to: { node: 'done' } },
        ],
      },
    },
  });
  expect(created.status()).toBe(201);
  const { loop } = (await created.json()) as { loop: { id: string } };
  await page.goto(`/app/loops/${loop.id}/edit`);
  const dialog = await openNode(page, 'infer');
  const group = dialog.getByRole('group', { name: 'Codex', exact: true });
  const model = group.getByLabel('Model', { exact: true });
  const effort = group.getByLabel('Effort', { exact: true });
  await expect(model).toHaveValue('picker-decision');
  await expect(effort).toHaveValue('max');
  await expect(effort).toHaveAccessibleDescription(/not supported/);
  await effort.selectOption('high');
  await closeNode(page);
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Published version 1.')).toBeVisible();
  const read = await request.get(`/loops/${loop.id}`);
  const stored = (await read.json()) as { current: { definition: unknown } };
  expect(
    LoopDefinitionSchema.parse(stored.current.definition).nodes.find((node) => node.id === 'infer')
      ?.config,
  ).toMatchObject({ codex: { model: 'picker-decision', effort: 'high' } });
});
