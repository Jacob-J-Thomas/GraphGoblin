import { approvalLoop, control, expect, publishLoop, test } from './fixtures.js';
import { ModelCatalogEntrySchema } from '@graphgoblin/contracts';

test('Loops keeps on cancel, contains keyboard focus, exports, and deletes on confirmation', async ({
  page,
  request,
}) => {
  const id = await publishLoop(request, approvalLoop('actions loop'));
  await page.goto('/app/loops');
  const trigger = page.getByRole('button', { name: 'Delete actions loop', exact: true });
  await trigger.click();
  const dialog = page.getByRole('alertdialog', { name: 'Delete “actions loop”?' });
  await expect(dialog).toContainText('all its versions and its triggers');
  await expect(dialog.getByRole('button', { name: 'Keep' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Confirm delete actions loop' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Keep' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect((await request.get(`/loops/${id}`)).status()).toBe(200);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export actions loop' }).click();
  expect((await download).suggestedFilename()).toBe('actions-loop.graphgoblin.json');
  await trigger.click();
  await page.getByRole('button', { name: 'Confirm delete actions loop' }).click();
  await expect(trigger).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Loops', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('heading', { name: 'Loops', exact: true })).not.toHaveAttribute(
    'tabindex',
  );
  expect((await request.get(`/loops/${id}`)).status()).toBe(404);
});

test('Settings keeps on cancel and deletes a secret after explicit confirmation', async ({
  page,
  request,
}) => {
  expect(
    (await request.put('/secrets/actions-secret', { data: { value: 'fixture-only' } })).status(),
  ).toBe(200);
  await page.goto('/app/settings');
  const trigger = page.getByRole('button', { name: 'Delete secret actions-secret' });
  await trigger.click();
  let dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('503 HOOK_NOT_READY');
  await expect(dialog).toContainText('secret:actions-secret');
  await dialog.getByRole('button', { name: 'Keep' }).click();
  await expect(trigger).toBeFocused();
  await expect(dialog).toHaveCount(0);
  const secrets = await request.get('/secrets');
  expect(await secrets.json()).toMatchObject({
    items: expect.arrayContaining([expect.objectContaining({ name: 'actions-secret' })]),
  });
  await trigger.click();
  dialog = page.getByRole('alertdialog');
  await dialog.getByRole('button', { name: 'Confirm delete actions-secret' }).click();
  await expect(trigger).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Secrets', exact: true })).toBeFocused();
});

test('Settings confirms model removal and reports an API second-delete error', async ({
  page,
  request,
}) => {
  await control(request, '/catalog/upsert', {
    harness: 'codex',
    model: 'actions-model',
    source: 'litellm',
    displayName: 'Actions model',
    efforts: ['low'],
    defaultEffort: 'low',
    enabled: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/settings');
  await expect(page.getByRole('button', { name: 'Add model', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit actions-model', exact: true })).toBeVisible();
  const harnessRow = page
    .getByRole('switch', { name: 'Enable GPT-6 Luna' })
    .locator('xpath=ancestor::tr');
  await expect(harnessRow.getByRole('button')).toHaveCount(0);
  await page.getByRole('button', { name: 'Delete actions-model', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText(
    'Removing a LiteLLM model leaves its loops referencing it.',
  );
  expect(
    await page.getByRole('alertdialog').evaluate((element) => ({
      fits: element.scrollWidth <= element.clientWidth,
      alignment: getComputedStyle(element).textAlign,
      wraps: getComputedStyle(element).whiteSpace,
    })),
  ).toEqual({ fits: true, alignment: 'left', wraps: 'normal' });
  expect((await request.delete('/model-catalog/codex/actions-model')).status()).toBe(204);
  await page.getByRole('button', { name: 'Confirm delete actions-model' }).click();
  await expect(page.getByRole('alert')).toContainText('MODEL_NOT_FOUND');
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('button', { name: 'Keep' }).click();
  await expect(page.getByRole('button', { name: 'Delete actions-model', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole('heading', { name: 'Model catalog', exact: true })).toBeFocused();
});

test('Settings harness switches follow keyboard toggles and update Default model', async ({
  page,
  request,
}) => {
  const instance = await control(request, '/apps');
  const url = String(instance['url']);
  const before = ModelCatalogEntrySchema.array()
    .parse(((await (await request.get(`${url}/model-catalog`)).json()) as { items: unknown }).items)
    .find((entry) => entry.model === 'gpt-6-luna');
  await page.goto(`${url}/app/settings`);
  const catalog = page.getByRole('region', { name: 'Model catalog' });
  await expect(catalog.getByRole('button')).toHaveCount(0);
  await expect(catalog.getByRole('columnheader', { name: 'Actions' })).toHaveCount(0);
  await expect(catalog).toContainText(
    'Local models served through LiteLLM will appear here once the LiteLLM adapter is configured.',
  );
  const guide = catalog.getByRole('link', { name: 'Learn about local models' });
  await expect(guide).toHaveAttribute(
    'href',
    'https://github.com/Jacob-J-Thomas/GraphGoblin/blob/main/docs/guide/06-settings-and-secrets.md#choose-a-model-and-effort',
  );
  // Reach the guide and then the chosen row through the catalog's keyboard order.
  for (
    let i = 0;
    i < 12 && !(await guide.evaluate((element) => element === document.activeElement));
    i++
  ) {
    await page.keyboard.press('Tab');
  }
  await expect(guide).toBeFocused();
  const enabled = catalog.getByRole('switch', {
    name: `Enable ${before!.displayName}`,
    exact: true,
  });
  for (
    let i = 0;
    i < (await catalog.getByRole('switch').count()) &&
    !(await enabled.evaluate((element) => element === document.activeElement));
    i++
  ) {
    await page.keyboard.press('Tab');
  }
  await expect(enabled).toBeFocused();
  await expect(enabled).toBeChecked();
  const defaults = page.getByLabel('Default model', { exact: true });
  await expect(
    defaults.getByRole('option', { name: before!.displayName, exact: true }),
  ).toHaveCount(1);
  const patch = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      response.url().endsWith('/model-catalog/codex/gpt-6-luna'),
  );
  await page.keyboard.press('Space');
  expect((await patch).status()).toBe(200);
  await expect(enabled).not.toBeChecked();
  await expect(enabled).toBeEnabled();
  await expect(
    defaults.getByRole('option', { name: before!.displayName, exact: true }),
  ).toHaveCount(0);
  await expect(enabled.locator('xpath=ancestor::tr').getByRole('status')).toContainText('Disabled');
  const disabled = ModelCatalogEntrySchema.array()
    .parse(((await (await request.get(`${url}/model-catalog`)).json()) as { items: unknown }).items)
    .find((entry) => entry.model === 'gpt-6-luna');
  expect(disabled).toEqual({ ...before, enabled: false });
  await expect(enabled).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(enabled).toBeChecked();
  await expect(enabled).toBeEnabled();
  await expect(
    defaults.getByRole('option', { name: before!.displayName, exact: true }),
  ).toHaveCount(1);
  await expect(enabled.locator('xpath=ancestor::tr').getByRole('status')).toContainText('Enabled');
});

test('Settings holds a catalog toggle, announces refusal, and restores the switch and Defaults', async ({
  page,
  request,
}) => {
  const instance = await control(request, '/apps');
  const url = String(instance['url']);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`${url}/model-catalog/codex/gpt-6-luna`, async (route) => {
    expect(route.request().method()).toBe('PATCH');
    expect(route.request().postDataJSON()).toEqual({ enabled: false });
    await held;
    await route.fulfill({
      status: 404,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        type: 'about:blank',
        title: 'MODEL_NOT_FOUND',
        status: 404,
        code: 'MODEL_NOT_FOUND',
      }),
    });
  });
  try {
    await page.goto(`${url}/app/settings`);
    const enabled = page.getByRole('switch', { name: 'Enable GPT-6 Luna', exact: true });
    const row = enabled.locator('xpath=ancestor::tr');
    await enabled.click();
    await expect(enabled).toBeDisabled();
    await expect(enabled).toHaveAttribute('aria-busy', 'true');
    await expect(enabled).not.toBeChecked();
    await expect(row.getByRole('status')).toContainText('Disabling…');
    await expect(row.locator('svg')).toHaveCount(1);
    const defaults = page.getByLabel('Default model');
    await expect(defaults.getByRole('option', { name: 'GPT-6 Luna', exact: true })).toHaveCount(1);
    release();
    await expect(row.getByRole('alert')).toHaveText(
      'This model is no longer in the catalog. Refresh Settings to see the current models.',
    );
    await expect(enabled).toBeChecked();
    await expect(enabled).toBeEnabled();
    await expect(enabled).toHaveAttribute('aria-busy', 'false');
    await expect(row.getByRole('status')).toContainText('Enabled');
    await expect(defaults.getByRole('option', { name: 'GPT-6 Luna', exact: true })).toHaveCount(1);
  } finally {
    release();
  }
});

for (const theme of ['dark', 'light'] as const) {
  test(`Settings catalog has visible keyboard focus in ${theme}`, async ({
    page,
    request,
  }, testInfo) => {
    const instance = await control(request, '/apps');
    const url = String(instance['url']);
    await page.addInitScript((choice) => localStorage.setItem('graphgoblin-theme', choice), theme);
    await request.patch(`${url}/model-catalog/codex/gpt-6-sol`, { data: { enabled: false } });
    await page.goto(`${url}/app/settings`);
    const catalog = page.getByRole('region', { name: 'Model catalog' });
    const guide = catalog.getByRole('link', { name: 'Learn about local models' });
    for (
      let i = 0;
      i < 12 && !(await guide.evaluate((element) => element === document.activeElement));
      i++
    )
      await page.keyboard.press('Tab');
    await expect(guide).toBeFocused();
    const enabled = catalog.getByRole('switch', { name: 'Enable GPT-6 Luna', exact: true });
    for (
      let i = 0;
      i < (await catalog.getByRole('switch').count()) &&
      !(await enabled.evaluate((element) => element === document.activeElement));
      i++
    ) {
      await page.keyboard.press('Tab');
    }
    await expect(enabled).toBeFocused();
    const appearance = await enabled.evaluate((element) => {
      const style = getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      return {
        width: bounds.width,
        height: bounds.height,
        outline: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        outlineColour: style.outlineColor,
        theme: document.documentElement.dataset['theme'],
      };
    });
    expect(appearance).toMatchObject({
      width: 44,
      height: 24,
      outline: 'solid',
      outlineWidth: '2px',
      theme,
    });
    await catalog.screenshot({ path: testInfo.outputPath(`model-catalog-${theme}.png`) });
  });
}

test('revoking this browser key warns and brings up the API key panel', async ({
  page,
  request,
}) => {
  const instance = await control(request, '/apps', { requireApiKey: true });
  const url = String(instance['url']);
  const token = String(instance['token']);
  await page.goto(`${url}/app/settings`);
  await page.getByLabel('API key', { exact: true }).fill(token);
  await page.getByRole('button', { name: 'Use key' }).click();
  const trigger = page.getByRole('button', { name: 'Revoke e2e', exact: true });
  await trigger.click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('401 immediately');
  await expect(dialog).toContainText(
    'Revoking this key will sign this browser out and show the API key panel. Enter another valid key to continue.',
  );
  await dialog.getByRole('button', { name: 'Confirm revoke e2e' }).click();
  await expect(page.getByRole('heading', { name: 'API key required' })).toBeVisible();
  await expect(page.getByLabel('API key', { exact: true })).toBeFocused();
});

for (const confirmWith of ['mouse', 'keyboard'] as const) {
  for (const outcome of ['409', 'success'] as const) {
    for (const escapeCount of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 20]) {
      test(`busy Escape: ${confirmWith}, ${outcome}, ${escapeCount} presses`, async ({
        page,
        request,
      }) => {
        const name = `escape-${confirmWith}-${outcome}-${escapeCount}`;
        const id = await publishLoop(request, approvalLoop(name));
        let release!: () => void;
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        let arrived!: () => void;
        const started = new Promise<void>((resolve) => {
          arrived = resolve;
        });
        await page.route(`**/loops/${id}`, async (route) => {
          if (route.request().method() !== 'DELETE') {
            await route.continue();
            return;
          }
          arrived();
          await held;
          if (outcome === 'success') {
            await route.continue();
            return;
          }
          await route.fulfill({
            status: 409,
            contentType: 'application/problem+json',
            body: JSON.stringify({
              type: 'about:blank',
              title: 'LOOP_IN_USE',
              status: 409,
              code: 'LOOP_IN_USE',
              detail: 'The loop has active runs; finish them first.',
            }),
          });
        });
        try {
          await page.goto('/app/loops');
          const trigger = page.getByRole('button', { name: `Delete ${name}`, exact: true });
          await trigger.click();
          const confirmation = page.getByRole('button', { name: `Confirm delete ${name}` });
          if (confirmWith === 'mouse') await confirmation.click();
          else {
            await confirmation.focus();
            await page.keyboard.press('Enter');
          }
          await started;
          const modal = page.locator('dialog:modal');
          await modal.evaluate((element) => {
            const root = document.documentElement;
            root.dataset['busyCloses'] = '0';
            root.dataset['busyFocusChanges'] = '0';
            element.addEventListener('close', () => {
              root.dataset['busyCloses'] = String(Number(root.dataset['busyCloses']) + 1);
            });
            document.addEventListener('focusin', () => {
              root.dataset['busyFocusChanges'] = String(
                Number(root.dataset['busyFocusChanges']) + 1,
              );
            });
          });
          for (let i = 0; i < escapeCount; i++) await page.keyboard.press('Escape');
          await expect(modal).toHaveCount(1);
          await expect(modal).toHaveAttribute('aria-busy', 'true');
          expect(
            await page.evaluate(() => ({
              closes: Number(document.documentElement.dataset['busyCloses']),
              focusChanges: Number(document.documentElement.dataset['busyFocusChanges']),
            })),
          ).toEqual({ closes: 0, focusChanges: 0 });
          await expect(modal).toBeFocused();
          release();
          if (outcome === 'success') {
            await expect(trigger).toHaveCount(0);
            await expect(modal).toHaveCount(0);
            await expect(page.getByRole('heading', { name: 'Loops', exact: true })).toBeFocused();
            expect((await request.get(`/loops/${id}`)).status()).toBe(404);
          } else {
            await expect(modal.getByRole('alert')).toContainText(
              'The loop has active runs; finish them first.',
            );
            await modal.getByRole('button', { name: 'Keep' }).click();
            await expect(modal).toHaveCount(0);
            await trigger.click();
            await expect(page.locator('dialog:modal')).toHaveCount(1);
            await page.keyboard.press('Escape');
            await expect(modal).toHaveCount(0);
            await expect(trigger).toBeFocused();
          }
        } finally {
          release();
        }
      });
    }
  }
}

test('revocation closes before a held key-list refresh removes the action later', async ({
  page,
  request,
}) => {
  const response = await request.post('/api-keys', {
    data: { label: 'late-refresh', scopes: ['*'] },
  });
  expect(response.status()).toBe(201);
  await page.goto('/app/settings');
  const trigger = page.getByRole('button', { name: 'Revoke late-refresh', exact: true });
  await trigger.click();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let arrived!: () => void;
  const started = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  await page.route('**/api-keys', async (route) => {
    if (route.request().method() === 'GET') {
      arrived();
      await held;
    }
    await route.continue();
  });
  try {
    await page.getByRole('button', { name: 'Confirm revoke late-refresh' }).click();
    await started;
    await expect(page.getByRole('alertdialog')).toHaveCount(0, { timeout: 1000 });
    await expect(trigger).toBeFocused();
    release();
    await expect(trigger).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'API keys', exact: true })).toBeFocused();
  } finally {
    release();
  }
});

test('own-key revocation closes before the held 401 refetch and focuses the key panel without waiting for retry', async ({
  page,
  request,
}) => {
  const instance = await control(request, '/apps', { requireApiKey: true });
  const url = String(instance['url']);
  await page.goto(`${url}/app/settings`);
  await page.getByLabel('API key', { exact: true }).fill(String(instance['token']));
  await page.getByRole('button', { name: 'Use key' }).click();
  await page.getByRole('button', { name: 'Revoke e2e', exact: true }).click();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let arrived!: () => void;
  const started = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  let retried!: () => void;
  const retryStarted = new Promise<void>((resolve) => {
    retried = resolve;
  });
  let requests = 0;
  await page.route(`${url}/api-keys`, async (route) => {
    requests++;
    arrived();
    if (requests === 2) retried();
    await held;
    await route.continue();
  });
  try {
    await page.getByRole('button', { name: 'Confirm revoke e2e' }).click();
    await started;
    await expect(page.getByRole('alertdialog')).toHaveCount(0, { timeout: 1000 });
    release();
    await expect(page.getByRole('heading', { name: 'API key required' })).toBeVisible();
    await expect(page.getByLabel('API key', { exact: true })).toBeFocused({ timeout: 500 });
    await retryStarted;
    await expect(
      page.getByRole('alert').filter({ hasText: 'Could not load api keys' }),
    ).toBeVisible();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(page.getByLabel('API key', { exact: true })).toBeFocused();
  } finally {
    release();
  }
});

test('review: keyboard export keeps focus and announces progress', async ({ page, request }) => {
  const id = await publishLoop(request, approvalLoop('focus-export'));
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/loops/${id}/export*`, async (route) => {
    await held;
    await route.fulfill({
      status: 404,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        type: 'about:blank',
        title: 'VERSION_NOT_FOUND',
        status: 404,
        code: 'VERSION_NOT_FOUND',
        detail: 'No version.',
      }),
    });
  });
  try {
    await page.goto('/app/loops');
    const button = page.getByRole('button', { name: 'Export focus-export' });
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(button).toContainText('Exporting');
    await expect(button).toBeFocused();
    await expect(
      page.getByRole('status').filter({ hasText: 'Exporting focus-export' }),
    ).toBeVisible();
    await page.keyboard.press('Enter');
    release();
    await expect(page.getByRole('alert')).toContainText('No version.');
    await expect(button).toBeFocused();
  } finally {
    release();
  }
});

test('review: pending double clicks cannot select status text', async ({ page, request }) => {
  const id = await publishLoop(request, approvalLoop('selection-guard'));
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/loops/${id}`, async (route) => {
    if (route.request().method() !== 'DELETE') {
      await route.continue();
      return;
    }
    await held;
    await route.fulfill({
      status: 409,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        type: 'about:blank',
        title: 'LOOP_IN_USE',
        status: 409,
        code: 'LOOP_IN_USE',
        detail: 'Still in use.',
      }),
    });
  });
  try {
    await page.goto('/app/loops');
    await page.getByRole('button', { name: 'Delete selection-guard', exact: true }).click();
    const button = page.getByRole('button', { name: 'Confirm delete selection-guard' });
    const box = await button.boundingBox();
    if (!box) throw new Error('Confirm is not visible');
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    const dialog = page.locator('dialog:modal');
    await expect(dialog).toHaveAttribute('aria-busy', 'true');
    expect(await dialog.evaluate((element) => getComputedStyle(element).userSelect)).toBe('none');
    await dialog.getByRole('status').dblclick();
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
    release();
    await expect(dialog.getByRole('alert')).toContainText('Still in use.');
    await dialog.getByRole('button', { name: 'Keep' }).click();
  } finally {
    release();
  }
});
