import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { test, expect, control, openNode, closeNode } from './fixtures.js';

function inheritedInference(name: string, config: Record<string, unknown> = {}) {
  const source = minimalLoop();
  return {
    ...source,
    name,
    nodes: [
      source.nodes[0],
      {
        id: 'work',
        kind: 'inference',
        label: 'Work',
        ui: { x: 260, y: 80 },
        config: { prompt: { template: 'q' }, ...config },
      },
      source.nodes[1],
    ],
    edges: [
      { id: 'start-work', from: { node: 'start', port: 'out' }, to: { node: 'work' } },
      { id: 'work-done', from: { node: 'work', port: 'out' }, to: { node: 'done' } },
    ],
  };
}

test('open inherited labels refresh on focus after another tab saves Settings and match the next request', async ({
  page,
  request,
  context,
}) => {
  const instance = await control(request, '/apps');
  const url = String(instance['url']);
  const instanceId = String(instance['instanceId']);
  const created = await request.post(url + '/loops', {
    data: { definition: inheritedInference('205 refresh') },
  });
  expect(created.status()).toBe(201);
  const { loop } = (await created.json()) as { loop: { id: string } };
  expect((await request.post(url + `/loops/${loop.id}/publish`)).status()).toBe(200);
  await page.goto(url + `/app/loops/${loop.id}/edit`);
  let dialog = await openNode(page, 'work');
  await expect(dialog.getByLabel('Effort', { exact: true }).locator('option').first()).toHaveText(
    'Default (low)',
  );
  const settingsTab = await context.newPage();
  await settingsTab.bringToFront();
  await settingsTab.goto(url + '/app/settings');
  await settingsTab.getByLabel('Default model', { exact: true }).selectOption('gpt-6.1-sol');
  await expect(settingsTab.getByLabel('Default model', { exact: true })).toBeEnabled();
  await settingsTab.getByLabel('Default effort', { exact: true }).selectOption('high');
  await expect(settingsTab.getByLabel('Default effort', { exact: true })).toBeEnabled();
  expect(await (await request.get(url + '/settings')).json()).toMatchObject({
    defaults: { byHarness: { codex: { model: 'gpt-6.1-sol', effort: 'high' } } },
  });
  await page.bringToFront();
  // In default headless Edge both tabs stay visible/focused; bringToFront emits no window
  // focus event (recorded in round-3/browser-focus-diagnostic.log.txt). Exercise the public
  // DOM event explicitly; this case does not claim native window-activation coverage.
  await page.evaluate(() => window.dispatchEvent(new FocusEvent('focus')));
  await expect(dialog.getByLabel('Model', { exact: true })).toHaveAccessibleDescription(
    /Default model: gpt-6.1-sol/,
  );
  await expect(dialog.getByLabel('Effort', { exact: true }).locator('option').first()).toHaveText(
    'Default (high)',
  );
  expect((await request.post(url + `/loops/${loop.id}/runs`, { data: {} })).status()).toBe(202);
  await expect
    .poll(async () => (await control(request, '/harness/requests', { instanceId }))['started'])
    .toMatchObject([{ model: 'gpt-6.1-sol', effort: 'high' }]);
  await closeNode(page);
  expect((await request.delete(url + '/settings/defaults')).status()).toBe(204);
  dialog = await openNode(page, 'work');
  await expect(dialog.getByLabel('Effort', { exact: true }).locator('option').first()).toHaveText(
    'Default (low)',
  );
  await expect(dialog.getByLabel('Model', { exact: true })).toHaveAccessibleDescription(
    /Default model: gpt-6-luna/,
  );
  await settingsTab.close();
});

test('catalog pending and failure label effort as unknown without changing the selection', async ({
  page,
  request,
}) => {
  const instance = await control(request, '/apps');
  const url = String(instance['url']);
  const created = await request.post(url + '/loops', {
    data: { definition: inheritedInference('205 unknown catalog') },
  });
  const { loop } = (await created.json()) as { loop: { id: string } };
  let fail!: () => void;
  const pending = new Promise<void>((resolve) => {
    fail = resolve;
  });
  await page.route('**/model-catalog', async (route) => {
    await pending;
    await route.fulfill({
      status: 503,
      contentType: 'application/problem+json',
      body: JSON.stringify({ status: 503, code: 'FAILED', detail: 'catalog unavailable' }),
    });
  });
  await page.goto(url + `/app/loops/${loop.id}/edit`);
  const dialog = await openNode(page, 'work');
  await expect(dialog.getByLabel('Model', { exact: true })).toHaveAccessibleDescription(
    /Default model: gpt-6-luna/,
  );
  const effort = dialog.getByLabel('Effort', { exact: true });
  await expect(effort.locator('option').first()).toHaveText('Default (checking…)');
  fail();
  await expect(effort.locator('option').first()).toHaveText('Default (unavailable)');
  await expect(effort).toHaveValue('');
});

for (const explicit of [false, true]) {
  test(`Claude ready capabilities refuse high before admission and still run low (explicit=${explicit})`, async ({
    page,
    request,
  }) => {
    const instance = await control(request, '/apps', {
      claude: true,
      env: {
        GG_DEFAULTS: JSON.stringify({
          byHarness: { claude: { model: 'claude-opus-5-5', effort: 'high' } },
        }),
      },
    });
    const url = String(instance['url']);
    const instanceId = String(instance['instanceId']);
    const created = await request.post(url + '/loops', {
      data: {
        definition: inheritedInference('205 Claude capability', {
          harness: 'claude',
          harnessOptions: { sandbox: 'read-only', approval: 'never' },
          ...(explicit ? { model: 'claude-opus-5-5', effort: 'high' } : {}),
        }),
      },
    });
    expect(created.status()).toBe(201);
    const { loop } = (await created.json()) as { loop: { id: string } };
    expect((await request.post(url + `/loops/${loop.id}/publish`)).status()).toBe(200);
    await control(request, '/harness/preflight', {
      instanceId,
      harness: 'claude',
      state: 'ready',
      models: [{ model: 'claude-opus-5-5', efforts: ['low'] }],
    });
    await page.goto(url + `/app/loops/${loop.id}/edit`);
    const dialog = await openNode(page, 'work');
    const effort = dialog.getByLabel('Effort', { exact: true });
    await expect(effort).toHaveValue(explicit ? 'high' : '');
    await expect(effort).toHaveAccessibleDescription(/not supported/);
    if (!explicit)
      await expect(effort).toHaveAccessibleDescription(
        /Default effort: high.*not supported by this model/,
      );
    const rejected = await request.post(url + `/loops/${loop.id}/runs`, { data: {} });
    expect(rejected.status()).toBe(422);
    expect(await rejected.json()).toMatchObject({
      errors: [
        expect.objectContaining({
          nodeId: 'work',
          code: 'EFFORT_UNSUPPORTED',
          path: 'config.effort',
        }),
      ],
    });
    expect(
      (await control(request, '/harness/requests', { instanceId, harness: 'claude' }))['started'],
    ).toEqual([]);
    await effort.selectOption('low');
    await closeNode(page);
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByText('Published version 2.')).toBeVisible();
    expect((await request.post(url + `/loops/${loop.id}/runs`, { data: {} })).status()).toBe(202);
    await expect
      .poll(
        async () =>
          (await control(request, '/harness/requests', { instanceId, harness: 'claude' }))[
            'started'
          ],
      )
      .toMatchObject([{ model: 'claude-opus-5-5', effort: 'low' }]);
  });
}

for (const kind of ['inference', 'llm'] as const) {
  for (const level of ['explicit', 'loop', 'Settings', 'ecosystem', 'process'] as const) {
    test(`${kind} ${level} effort survives editing, save, reload and adapter request`, async ({
      page,
      request,
    }) => {
      const instance = await control(request, '/apps', {
        env:
          level === 'process'
            ? {
                GG_DEFAULTS: JSON.stringify({
                  byHarness: { codex: { model: 'gpt-6.1-sol', effort: 'high' } },
                }),
              }
            : {},
      });
      const url = String(instance['url']);
      const instanceId = String(instance['instanceId']);
      const defaults = { byHarness: { codex: { model: 'gpt-6.1-sol', effort: 'high' } } };
      if (level === 'Settings')
        expect((await request.put(url + '/settings', { data: { defaults } })).status()).toBe(200);
      const source = minimalLoop();
      const definition = LoopDefinitionSchema.parse({
        ...source,
        name: `205 ${kind} ${level}`,
        settings: { ...source.settings, ...(level === 'loop' ? { defaults } : {}) },
        nodes: [
          source.nodes[0],
          {
            id: 'work',
            label: 'Work',
            kind: kind === 'inference' ? kind : 'decision',
            ui: { x: 260, y: 80 },
            config:
              kind === 'inference'
                ? { prompt: { template: 'Choose' } }
                : {
                    kind: 'llm',
                    harness: 'codex',
                    instructions: 'Choose',
                    model: { mode: 'inherit' },
                    effort: { mode: 'inherit' },
                    routes: [
                      { id: 'yes', label: 'Yes' },
                      { id: 'no', label: 'No' },
                    ],
                  },
          },
          source.nodes[1],
        ],
        edges: [
          { id: 'start-work', from: { node: 'start', port: 'out' }, to: { node: 'work' } },
          ...(kind === 'inference' ? ['out'] : ['yes', 'no']).map((port) => ({
            id: port,
            from: { node: 'work', port },
            to: { node: 'done' },
          })),
        ],
      });
      const created = await request.post(url + '/loops', { data: { definition } });
      expect(created.status()).toBe(201);
      const { loop } = (await created.json()) as { loop: { id: string } };
      await page.goto(url + `/app/loops/${loop.id}/edit`);
      const dialog = await openNode(page, 'work');
      const effort = dialog.getByLabel('Effort', { exact: true });
      const inherited = ['loop', 'Settings', 'process'].includes(level) ? 'high' : 'low';
      await expect(effort.locator('option').first()).toHaveText(`Default (${inherited})`);
      await expect(effort).toBeVisible();
      await expect(dialog.getByRole('group', { name: 'Effort', exact: true })).toHaveCount(0);
      // Exercise both transitions: Default must discard the explicit value rather than pin it.
      await effort.selectOption('high');
      if (level !== 'explicit') await effort.selectOption('');
      const expectedEffort = level === 'explicit' ? 'high' : inherited;
      const expectedModel = ['loop', 'Settings', 'process'].includes(level)
        ? 'gpt-6.1-sol'
        : 'gpt-6-luna';
      if (kind === 'llm')
        await expect(dialog.getByLabel('Model', { exact: true })).toHaveAccessibleDescription(
          new RegExp(`Default model: ${expectedModel}`),
        );
      else
        await expect(
          dialog.getByLabel('Model', { exact: true }).locator('option').first(),
        ).toHaveText(`(loop default) (${expectedModel})`);
      if (level === 'loop') {
        await effort.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `../../docs/qa/2026-10-23-wp-f2b-205/round-3/after-${kind}.png`,
        });
      }
      await closeNode(page);
      await page.getByRole('button', { name: 'Publish', exact: true }).click();
      await expect(page.getByText('Published version 1.')).toBeVisible();
      await page.reload();
      const reopened = await openNode(page, 'work');
      await expect(reopened.getByLabel('Effort', { exact: true })).toHaveValue(
        level === 'explicit' ? 'high' : '',
      );
      await closeNode(page);
      const saved = await request.get(url + `/loops/${loop.id}`);
      const data = (await saved.json()) as { current: { definition: unknown } };
      const config = LoopDefinitionSchema.parse(data.current.definition).nodes.find(
        (node) => node.id === 'work',
      )!.config;
      if (level === 'explicit')
        expect(config).toHaveProperty(
          'effort',
          kind === 'llm' ? { mode: 'explicit', value: 'high' } : 'high',
        );
      else if (kind === 'llm') expect(config).toHaveProperty('effort', { mode: 'inherit' });
      else expect(config).not.toHaveProperty('effort');
      expect(
        (await request.post(url + `/loops/${loop.id}/runs`, { data: { input: null } })).status(),
      ).toBe(202);
      await expect
        .poll(async () => {
          const result = await control(
            request,
            kind === 'llm' ? '/deciders/requests' : '/harness/requests',
            { instanceId },
          );
          return result[kind === 'llm' ? 'routes' : 'started'];
        })
        .toMatchObject([{ model: expectedModel, effort: expectedEffort }]);
    });
  }
}

test('classifier keeps Question, Model, Answer visible and has no effort', async ({
  page,
  request,
}) => {
  const source = minimalLoop();
  const created = await request.post('/loops', {
    data: {
      definition: {
        ...source,
        name: '205 classifier order',
        nodes: [
          source.nodes[0],
          {
            id: 'pick',
            kind: 'decision',
            label: 'Pick',
            ui: { x: 260, y: 80 },
            config: {
              kind: 'classifier',
              model: 'jev',
              question: 'Choose',
              answer: {
                type: 'choice',
                options: [
                  { id: 'yes', label: 'Yes', criteria: 'yes' },
                  { id: 'no', label: 'No', criteria: 'no' },
                ],
              },
            },
          },
          source.nodes[1],
        ],
        edges: [
          { id: 'start-pick', from: { node: 'start', port: 'out' }, to: { node: 'pick' } },
          ...['yes', 'no'].map((port) => ({
            id: port,
            from: { node: 'pick', port },
            to: { node: 'done' },
          })),
        ],
      },
    },
  });
  expect(created.status()).toBe(201);
  const { loop } = (await created.json()) as { loop: { id: string } };
  await page.goto(`/app/loops/${loop.id}/edit`);
  const dialog = await openNode(page, 'pick');
  const fields = dialog.locator('[data-field-scope="config"]');
  for (const name of ['question', 'model', 'answer'])
    await expect(fields.locator(`[data-field="${name}"]`).first()).toBeVisible();
  expect(
    await fields
      .locator('[data-field]')
      .evaluateAll((elements) => [
        ...new Set(
          elements
            .map((element) => element.getAttribute('data-field'))
            .filter((name) => ['question', 'model', 'answer'].includes(name ?? '')),
        ),
      ]),
  ).toEqual(['question', 'model', 'answer']);
  await expect(dialog.getByLabel('Effort', { exact: true })).toHaveCount(0);
  await page.screenshot({
    path: '../../docs/qa/2026-10-23-wp-f2b-205/round-3/after-classifier.png',
  });
});

test('a saved unsupported effort stays visible and is refused before the adapter', async ({
  page,
  request,
}) => {
  const instance = await control(request, '/apps');
  const url = String(instance['url']);
  const instanceId = String(instance['instanceId']);
  const entry = {
    instanceId,
    harness: 'codex',
    model: 'effort-limited',
    displayName: 'Limited',
    efforts: ['low', 'high'],
    defaultEffort: 'low',
    enabled: true,
    source: 'harness',
  };
  await control(request, '/catalog/upsert', entry);
  const source = minimalLoop();
  const created = await request.post(url + '/loops', {
    data: {
      definition: {
        ...source,
        name: '205 unsupported effort',
        nodes: [
          source.nodes[0],
          {
            id: 'work',
            kind: 'inference',
            label: 'Work',
            config: { model: entry.model, effort: 'high', prompt: { template: 'q' } },
            ui: { x: 260, y: 80 },
          },
          source.nodes[1],
        ],
        edges: [
          { id: 'start-work', from: { node: 'start', port: 'out' }, to: { node: 'work' } },
          { id: 'work-done', from: { node: 'work', port: 'out' }, to: { node: 'done' } },
        ],
      },
    },
  });
  expect(created.status()).toBe(201);
  const { loop } = (await created.json()) as { loop: { id: string } };
  expect((await request.post(url + `/loops/${loop.id}/publish`)).status()).toBe(200);
  await control(request, '/catalog/upsert', { ...entry, efforts: ['low'] });
  await page.goto(url + `/app/loops/${loop.id}/edit`);
  const dialog = await openNode(page, 'work');
  const effort = dialog.getByLabel('Effort', { exact: true });
  await expect(effort).toHaveValue('high');
  await expect(effort).toHaveAccessibleDescription(/not supported/);
  await expect(effort.locator('option:checked')).toHaveText('high (not supported by this model)');
  await closeNode(page);
  await page.reload();
  await expect((await openNode(page, 'work')).getByLabel('Effort', { exact: true })).toHaveValue(
    'high',
  );
  // Published runs are queued before execution-time model resolution; refusal happens before
  // the provider call, rather than at admission after a catalog capability change.
  const queued = await request.post(url + `/loops/${loop.id}/runs`, { data: { input: null } });
  expect(queued.status()).toBe(202);
  const { run } = (await queued.json()) as { run: { id: string } };
  await expect
    .poll(async () => {
      const response = await request.get(url + `/runs/${run.id}`);
      return (await response.json()) as unknown;
    })
    .toMatchObject({
      status: 'failed',
      failure: {
        code: 'EVALUATION_INVALID_CONFIGURATION',
        details: { code: 'EFFORT_UNSUPPORTED' },
      },
    });
  expect((await control(request, '/harness/requests', { instanceId }))['started']).toEqual([]);
});
