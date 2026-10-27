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
          path: test.info().outputPath(`after-${kind}.png`),
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

test('Codex effort choices follow the model: no minimal, max is offered and requested unchanged, but not for GPT-5.5', async ({
  page,
  request,
}) => {
  const instance = await control(request, '/apps');
  const url = String(instance['url']);
  const instanceId = String(instance['instanceId']);
  const created = await request.post(url + '/loops', {
    data: { definition: inheritedInference('205 Codex max', { model: 'gpt-6-luna' }) },
  });
  expect(created.status()).toBe(201);
  const { loop } = (await created.json()) as { loop: { id: string } };
  await page.goto(url + `/app/loops/${loop.id}/edit`);
  const dialog = await openNode(page, 'work');
  const model = dialog.getByLabel('Model', { exact: true });
  const effort = dialog.getByLabel('Effort', { exact: true });
  const offered = () =>
    effort
      .locator('option')
      .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
  // The Codex CLI's own model catalog lists no minimal for any model, and the provider refuses it
  // for GPT-6 Luna (F2 LP-5), so it is never offered.
  expect(await offered()).toEqual(['', 'low', 'medium', 'high', 'xhigh', 'max']);
  await effort.selectOption('max');
  // GPT-5.5 tops out at xhigh in the Codex CLI's own model catalog, so max is not a choice there.
  await model.selectOption('gpt-5.5');
  await expect(effort.locator('option:checked')).toHaveText('max (not supported by this model)');
  await expect(effort).toHaveAccessibleDescription(/not supported/);
  await effort.selectOption('xhigh');
  expect(await offered()).toEqual(['', 'low', 'medium', 'high', 'xhigh']);
  await model.selectOption('gpt-6-luna');
  await effort.selectOption('max');
  await closeNode(page);
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Published version 1.')).toBeVisible();
  await page.reload();
  await expect((await openNode(page, 'work')).getByLabel('Effort', { exact: true })).toHaveValue(
    'max',
  );
  await closeNode(page);
  expect(
    (await request.post(url + `/loops/${loop.id}/runs`, { data: { input: null } })).status(),
  ).toBe(202);
  await expect
    .poll(async () => (await control(request, '/harness/requests', { instanceId }))['started'])
    .toMatchObject([{ model: 'gpt-6-luna', effort: 'max' }]);
});

for (const kind of ['inference', 'llm'] as const) {
  test(`${kind}: a max kept after switching to GPT-5.5 is named on the field and the node until a supported effort is chosen`, async ({
    page,
    request,
  }) => {
    const instance = await control(request, '/apps');
    const url = String(instance['url']);
    const source = minimalLoop();
    const definition = LoopDefinitionSchema.parse({
      ...source,
      name: `205 kept max ${kind}`,
      nodes: [
        source.nodes[0],
        {
          id: 'work',
          label: 'Work',
          kind: kind === 'inference' ? kind : 'decision',
          ui: { x: 260, y: 80 },
          config:
            kind === 'inference'
              ? { prompt: { template: 'Choose' }, model: 'gpt-6-luna', effort: 'max' }
              : {
                  kind: 'llm',
                  harness: 'codex',
                  instructions: 'Choose',
                  model: { mode: 'explicit', value: 'gpt-6-luna' },
                  effort: { mode: 'explicit', value: 'max' },
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
    const message = 'Effort max is not supported by GPT-5.5. Choose a supported effort or Default.';
    let dialog = await openNode(page, 'work');
    await dialog.getByLabel('Model', { exact: true }).selectOption('gpt-5.5');
    // The choice is kept and the field explains it as soon as the model changes.
    const effort = dialog.getByLabel('Effort', { exact: true });
    await expect(effort).toHaveValue('max');
    await expect(effort).toHaveAccessibleDescription(new RegExp(message));
    await expect(dialog.getByRole('button', { name: '1 issue on work' })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`kept-max-${kind}.png`) });
    await closeNode(page);
    // Publish cannot save the draft; the issue list now points at the node.
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByText(/fix the issues below first/)).toBeVisible();
    await expect(page.getByRole('button', { name: '1 issue on work' })).toBeVisible();
    await page.getByRole('button', { name: '1 error', exact: true }).click();
    await page.getByRole('button', { name: 'work: 1 issue' }).click();
    dialog = page.getByRole('dialog', { name: /Edit/ });
    await expect(dialog.getByLabel('Effort', { exact: true })).toHaveValue('max');
    await dialog.getByLabel('Effort', { exact: true }).selectOption('xhigh');
    await expect(dialog.getByRole('button', { name: /issues? on work/ })).toHaveCount(0);
    await expect(dialog.getByLabel('Effort', { exact: true })).not.toHaveAccessibleDescription(
      /not supported/,
    );
    await closeNode(page);
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByText('Published version 1.')).toBeVisible();
  });
}

for (const kind of ['inference', 'llm'] as const) {
  test(`${kind}: a Codex minimal saved before the catalog change is named on the field and the node until a supported effort is chosen`, async ({
    page,
    request,
  }) => {
    const instance = await control(request, '/apps');
    const url = String(instance['url']);
    const instanceId = String(instance['instanceId']);
    const catalog = (await (await request.get(url + '/model-catalog')).json()) as {
      items: Record<string, unknown>[];
    };
    const { ecosystemDefault: _, ...luna } = catalog.items.find(
      (entry) => entry['harness'] === 'codex' && entry['model'] === 'gpt-6-luna',
    )!;
    expect(luna['efforts']).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    // A draft saved while the shipped catalog still offered minimal (before #205's F2 fix); the next
    // start restores the shipped efforts.
    await control(request, '/catalog/upsert', {
      ...luna,
      instanceId,
      efforts: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
    });
    const source = minimalLoop();
    const definition = LoopDefinitionSchema.parse({
      ...source,
      name: `205 kept minimal ${kind}`,
      nodes: [
        source.nodes[0],
        {
          id: 'work',
          label: 'Work',
          kind: kind === 'inference' ? kind : 'decision',
          ui: { x: 260, y: 80 },
          config:
            kind === 'inference'
              ? { prompt: { template: 'Choose' }, model: 'gpt-6-luna', effort: 'minimal' }
              : {
                  kind: 'llm',
                  harness: 'codex',
                  instructions: 'Choose',
                  model: { mode: 'explicit', value: 'gpt-6-luna' },
                  effort: { mode: 'explicit', value: 'minimal' },
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
    await control(request, '/catalog/upsert', { ...luna, instanceId });
    await page.goto(url + `/app/loops/${loop.id}/edit`);
    const dialog = await openNode(page, 'work');
    const effort = dialog.getByLabel('Effort', { exact: true });
    // The saved choice is kept, never changed for the user, and explained on the field and node.
    await expect(effort).toHaveValue('minimal');
    await expect(effort.locator('option:checked')).toHaveText(
      'minimal (not supported by this model)',
    );
    await expect(effort).toHaveAccessibleDescription(
      /Effort minimal is not supported by GPT-6 Luna\. Choose a supported effort or Default\./,
    );
    await expect(dialog.getByRole('button', { name: '1 issue on work' })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`kept-minimal-${kind}.png`) });
    await closeNode(page);
    // The saved draft cannot be published; the refusal names the node and the reason.
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Publish failed' })).toContainText(
      'work: The selected reasoning effort is not supported by this model',
    );
    const reopened = await openNode(page, 'work');
    await reopened.getByLabel('Effort', { exact: true }).selectOption('low');
    await expect(reopened.getByRole('button', { name: /issues? on work/ })).toHaveCount(0);
    await closeNode(page);
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByText('Published version 1.')).toBeVisible();
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
      .toMatchObject([{ model: 'gpt-6-luna', effort: 'low' }]);
  });
}

test('Settings Codex default effort follows the server default model and names an unsupported effort', async ({
  page,
  request,
}) => {
  const instance = await control(request, '/apps');
  const url = String(instance['url']);
  const instanceId = String(instance['instanceId']);
  const catalog = (await (await request.get(url + '/model-catalog')).json()) as {
    items: Record<string, unknown>[];
  };
  const { ecosystemDefault: _, ...luna } = catalog.items.find(
    (entry) => entry['harness'] === 'codex' && entry['model'] === 'gpt-6-luna',
  )!;
  const withMinimal = {
    ...luna,
    instanceId,
    efforts: ['minimal', ...(luna['efforts'] as string[])],
  };
  const message =
    'Effort minimal is not supported by GPT-6 Luna. Choose a supported effort or Default.';
  await page.goto(url + '/app/settings');
  const effort = page.getByLabel('Default effort', { exact: true });
  const offered = () =>
    effort
      .locator('option')
      .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
  // Default model "(server default)" is the process default, GPT-6 Luna (PR #426 QA D-1).
  await expect(page.getByLabel('Default model', { exact: true })).toHaveValue('');
  await expect.poll(offered).toEqual(['', 'low', 'medium', 'high', 'xhigh', 'max']);

  // A catalog this page read before the server stopped offering minimal: the refusal names the
  // effort and model on the field, not only a generic footer.
  await control(request, '/catalog/upsert', withMinimal);
  await page.reload();
  await expect.poll(offered).toContain('minimal');
  await control(request, '/catalog/upsert', { ...luna, instanceId });
  await effort.selectOption('minimal');
  await expect(page.getByRole('alert').filter({ hasText: 'Not saved.' })).toHaveText(
    `Not saved. ${message}`,
  );
  await expect(effort).toHaveAccessibleDescription(new RegExp(message));
  await expect(page.getByText(/invalid harness defaults/)).toHaveCount(0);

  // A minimal default stored before the upgrade is kept and explained (QA O-2).
  await control(request, '/catalog/upsert', withMinimal);
  expect(
    (
      await request.put(url + '/settings', {
        data: { defaults: { byHarness: { codex: { effort: 'minimal' } } } },
      })
    ).status(),
  ).toBe(200);
  await control(request, '/catalog/upsert', { ...luna, instanceId });
  await page.reload();
  await expect(effort).toHaveValue('minimal');
  await expect(effort.locator('option:checked')).toHaveText(
    'minimal (not supported by this model)',
  );
  await expect(effort).toHaveAccessibleDescription(message);
  await page
    .getByRole('region', { name: 'codex defaults' })
    .screenshot({ path: test.info().outputPath('settings-kept-minimal.png') });
  await effort.selectOption('low');
  await expect
    .poll(
      async () =>
        ((await (await request.get(url + '/settings')).json()) as Record<string, unknown>)[
          'defaults'
        ],
    )
    .toEqual({ byHarness: { codex: { effort: 'low' } } });
  await expect(effort).not.toHaveAccessibleDescription(/not supported/);
});

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
    path: test.info().outputPath('after-classifier.png'),
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
