import { approvalLoop, control, expect, publishLoop, test } from './fixtures.js';
import { ModelCatalogEntrySchema } from '@graphgoblin/contracts';
import type { Locator, Page } from '@playwright/test';

async function tabTo(page: Page, target: Locator) {
  for (
    let i = 0;
    i < 40 && !(await target.evaluate((element) => element === document.activeElement));
    i++
  )
    await page.keyboard.press('Tab');
  await expect(target).toBeFocused();
}

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

test('Keep followed by a runs poll leaves body focus and Space opens no confirmation', async ({
  page,
  request,
}) => {
  const name = `cancel-poll-${test.info().repeatEachIndex}`;
  const id = await publishLoop(request, approvalLoop(name));
  await page.goto('/app/loops');
  // Check this Edge version's removal events; the microtask must distinguish them from blur.
  const removalEvents = await page.evaluate(async () => {
    const probe = document.createElement('button');
    document.body.append(probe);
    const events: { duringEvent: boolean; afterMicrotask: boolean }[] = [];
    probe.addEventListener('focusout', () => {
      const event = { duringEvent: probe.isConnected, afterMicrotask: true };
      events.push(event);
      queueMicrotask(() => {
        event.afterMicrotask = probe.isConnected;
      });
    });
    probe.focus();
    probe.remove();
    await Promise.resolve();
    return events;
  });
  console.log(`Focused-element removal focusout events: ${JSON.stringify(removalEvents)}`);
  for (const event of removalEvents) expect(event.afterMicrotask).toBe(false);
  const trigger = page.getByRole('button', { name: `Delete ${name}`, exact: true });
  await trigger.click();
  await page.getByRole('button', { name: 'Keep', exact: true }).click();
  await expect(trigger).toBeFocused();
  await page.getByRole('heading', { name: 'Loops', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.activeElement === document.body)).toBe(true);
  const response = await request.post(`/loops/${id}/runs`, { data: {} });
  expect(response.status()).toBe(202);
  const { run } = (await response.json()) as { run: { id: string } };
  try {
    // The regular five-second runs poll must commit the new badge before checking focus.
    const row = page.getByRole('row').filter({ has: trigger });
    await expect(row.getByRole('link', { name: 'waiting', exact: true })).toHaveAttribute(
      'href',
      `/app/runs/${run.id}`,
    );
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
    await page.keyboard.press('Space');
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  } finally {
    await request.post(`/runs/${run.id}/cancel`);
    await expect
      .poll(
        async () =>
          ((await (await request.get(`/runs/${run.id}`)).json()) as { status: string }).status,
      )
      .toBe('cancelled');
    await request.delete(`/loops/${id}`);
  }
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

test('Settings catalog edits LiteLLM models, refuses Add, and reports a second-delete error', async ({
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
  const localSwitch = page.getByRole('switch', { name: 'Enable Actions model', exact: true });
  await localSwitch.click();
  await expect(localSwitch).toHaveAttribute('aria-busy', 'false');
  await expect(localSwitch).not.toBeChecked();
  await page.getByRole('button', { name: 'Edit actions-model', exact: true }).click();
  const edit = page.getByRole('form', { name: 'Edit actions-model' });
  await edit.getByLabel('Display name').fill('Edited actions model');
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      response.url().endsWith('/model-catalog/codex/actions-model'),
  );
  await edit.getByRole('button', { name: 'Save model' }).click();
  const put = await saved;
  expect(put.status()).toBe(200);
  expect(put.request().postDataJSON()).toEqual({
    displayName: 'Edited actions model',
    efforts: ['low'],
    defaultEffort: 'low',
  });
  expect(ModelCatalogEntrySchema.parse(await put.json())).toMatchObject({
    displayName: 'Edited actions model',
    source: 'litellm',
    enabled: false,
  });
  await expect(edit).toHaveCount(0);
  await page.getByRole('button', { name: 'Add model', exact: true }).click();
  const add = page.getByRole('form', { name: 'Add model' });
  await add.getByLabel('Model id').fill('local-unconfigured');
  const refused = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      response.url().endsWith('/model-catalog/codex/local-unconfigured'),
  );
  await add.getByRole('button', { name: 'Save model' }).click();
  const refusal = await refused;
  expect(refusal.status()).toBe(409);
  expect(refusal.request().postDataJSON()).toMatchObject({ source: 'litellm', enabled: true });
  expect(await refusal.json()).toMatchObject({ code: 'LITELLM_NOT_CONFIGURED' });
  await expect(add.getByRole('alert')).toHaveText(
    'LiteLLM is not configured. Adding local models is not available yet.',
  );
  await add.getByRole('button', { name: 'Cancel' }).click();
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
  // Recovery follows the committed row removal, which can lag query settlement.
  await expect(page.getByRole('heading', { name: 'Model catalog', exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Delete actions-model', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
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
    'Local models served through LiteLLM will appear here once the LiteLLM adapter is configured; see the Settings guide, Choose a model and effort.',
  );
  await expect(catalog.getByRole('link')).toHaveCount(0);
  const enabled = catalog.getByRole('switch', {
    name: `Enable ${before!.displayName}`,
    exact: true,
  });
  await tabTo(page, enabled);
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

test('Settings catalog preserves a disabled saved default until the owner changes it', async ({
  page,
  request,
}) => {
  const instance = await control(request, '/apps');
  const url = String(instance['url']);
  expect(
    (
      await request.put(`${url}/settings`, {
        data: { defaults: { byHarness: { codex: { model: 'gpt-6-luna' } } } },
      })
    ).status(),
  ).toBe(200);
  await page.goto(`${url}/app/settings`);
  const enabled = page.getByRole('switch', { name: 'Enable GPT-6 Luna', exact: true });
  await tabTo(page, enabled);
  await page.keyboard.press('Space');
  await expect(enabled).toHaveAttribute('aria-busy', 'false');
  const defaults = page.getByLabel('Default model', { exact: true });
  await expect(defaults).toHaveValue('gpt-6-luna');
  await expect(defaults.locator('option:checked')).toHaveText('GPT-6 Luna (disabled)');
  await expect(defaults).toHaveAccessibleDescription(
    'This saved model is unavailable. Choose an enabled catalog model or (server default) before publishing or running.',
  );
  expect(await (await request.get(`${url}/settings`)).json()).toMatchObject({
    defaults: { byHarness: { codex: { model: 'gpt-6-luna' } } },
  });
  // The truthful selection makes choosing the preceding server-default option fire a change.
  await defaults.press('ArrowUp');
  await defaults.press('Enter');
  await expect(defaults).toHaveValue('');
  await expect
    .poll(async () => {
      const values: unknown = await (await request.get(`${url}/settings`)).json();
      return values;
    })
    .not.toHaveProperty('defaults');
  await expect(page.getByText(/This saved model is unavailable/)).toHaveCount(0);
});

test('Settings catalog refreshes a vanished toggle and announces the reason at the heading', async ({
  page,
  request,
}) => {
  const instance = await control(request, '/apps');
  const url = String(instance['url']);
  const entries = ModelCatalogEntrySchema.array().parse(
    ((await (await request.get(`${url}/model-catalog`)).json()) as { items: unknown }).items,
  );
  let vanished = false;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`${url}/model-catalog`, async (route) => {
    await route.fulfill({
      json: { items: vanished ? entries.filter((entry) => entry.model !== 'gpt-6-luna') : entries },
    });
  });
  await page.route(`${url}/model-catalog/codex/gpt-6-luna`, async (route) => {
    await held;
    vanished = true;
    await route.fulfill({
      status: 404,
      contentType: 'application/problem+json',
      body: JSON.stringify({ status: 404, code: 'MODEL_NOT_FOUND' }),
    });
  });
  try {
    await page.goto(`${url}/app/settings`);
    const catalog = page.getByRole('region', { name: 'Model catalog' });
    const enabled = catalog.getByRole('switch', { name: 'Enable GPT-6 Luna', exact: true });
    await tabTo(page, enabled);
    const patch = page.waitForRequest(
      (req) => req.method() === 'PATCH' && req.url().endsWith('/model-catalog/codex/gpt-6-luna'),
    );
    await page.keyboard.press('Space');
    const submitted = await patch;
    expect(submitted.postDataJSON()).toEqual({ enabled: false });
    await expect(enabled).toHaveAttribute('aria-disabled', 'true');
    await expect(enabled).toHaveAttribute('aria-busy', 'true');
    await expect(enabled).not.toBeChecked();
    await expect(enabled).toBeFocused();
    release();
    // A GET starting does not mean React committed the removal and recovered focus.
    await expect(
      catalog.getByRole('heading', { name: 'Model catalog', exact: true }),
    ).toBeFocused();
    await expect(enabled).toHaveCount(0);
    await expect(
      catalog.getByRole('status').filter({ hasText: 'no longer in the catalog' }),
    ).toHaveText('GPT-6 Luna: This model is no longer in the catalog.');
    await expect(catalog).not.toContainText('Refresh Settings');
    await expect(
      page.getByLabel('Default model').getByRole('option', { name: 'GPT-6 Luna', exact: true }),
    ).toHaveCount(0);
  } finally {
    release();
  }
});

for (const theme of ['dark', 'light'] as const) {
  test(`Settings catalog has visible keyboard focus, pending and refused states in ${theme}`, async ({
    page,
    request,
  }, testInfo) => {
    const instance = await control(request, '/apps');
    const url = String(instance['url']);
    await page.addInitScript((choice) => localStorage.setItem('graphgoblin-theme', choice), theme);
    await request.patch(`${url}/model-catalog/codex/gpt-6-sol`, { data: { enabled: false } });
    await page.goto(`${url}/app/settings`);
    const catalog = page.getByRole('region', { name: 'Model catalog' });
    const enabled = catalog.getByRole('switch', { name: 'Enable GPT-6 Luna', exact: true });
    await tabTo(page, enabled);
    const appearance = await enabled.evaluate((element) => {
      const style = getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      return {
        width: bounds.width,
        height: bounds.height,
        outline: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        theme: document.documentElement.dataset['theme'],
      };
    });
    expect(appearance).toEqual({
      width: 44,
      height: 24,
      outline: 'solid',
      outlineWidth: '2px',
      theme,
    });
    await catalog.screenshot({ path: testInfo.outputPath(`model-catalog-${theme}.png`) });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let patches = 0;
    await page.route(`${url}/model-catalog/codex/gpt-6-luna`, async (route) => {
      patches += 1;
      await held;
      await route.fulfill({
        status: 403,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          status: 403,
          code: 'FORBIDDEN',
          detail: 'This API key cannot change model settings.',
        }),
      });
    });
    try {
      const patch = page.waitForRequest(
        (req) => req.method() === 'PATCH' && req.url().endsWith('/model-catalog/codex/gpt-6-luna'),
      );
      await page.keyboard.press('Space');
      expect((await patch).postDataJSON()).toEqual({ enabled: false });
      await expect(enabled).toHaveAttribute('aria-disabled', 'true');
      await expect(enabled).toHaveAttribute('aria-busy', 'true');
      await expect(enabled).not.toHaveAttribute('disabled');
      await expect(enabled).not.toBeChecked();
      await expect(enabled).toBeFocused();
      const row = enabled.locator('xpath=ancestor::tr');
      await expect(row.getByRole('status')).toContainText('Disabling…');
      await expect(row.locator('svg')).toHaveCount(1);
      await catalog.screenshot({ path: testInfo.outputPath(`model-catalog-${theme}-pending.png`) });
      // aria-disabled keeps focus and blocks duplicate keyboard activation.
      await page.keyboard.press('Enter');
      release();
      await expect(row.getByRole('alert')).toHaveText(
        'This API key cannot change model settings. (FORBIDDEN)',
      );
      expect(patches).toBe(1);
      await expect(enabled).toBeChecked();
      await expect(enabled).toHaveAttribute('aria-disabled', 'false');
      await expect(enabled).toHaveAttribute('aria-busy', 'false');
      await expect(enabled).toBeFocused();
      await expect(row.getByRole('status')).toContainText('Enabled');
      await expect(
        page.getByLabel('Default model').getByRole('option', { name: 'GPT-6 Luna', exact: true }),
      ).toHaveCount(1);
      await catalog.screenshot({ path: testInfo.outputPath(`model-catalog-${theme}-refused.png`) });
    } finally {
      release();
    }
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
        // Refused deletions keep their loop; repeated specs must not match its old action too.
        const name = `escape-${confirmWith}-${outcome}-${escapeCount}-${test.info().repeatEachIndex}`;
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
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(trigger).toBeFocused();
    release();
    // The removal watch focuses the heading once React commits the refreshed row's removal.
    await expect(page.getByRole('heading', { name: 'API keys', exact: true })).toBeFocused();
    await expect(trigger).toHaveCount(0);
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
  let releaseRetry!: () => void;
  const heldRetry = new Promise<void>((resolve) => {
    releaseRetry = resolve;
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
    if (requests === 1) await held;
    else {
      retried();
      await heldRetry;
    }
    await route.continue();
  });
  try {
    await page.getByRole('button', { name: 'Confirm revoke e2e' }).click();
    await started;
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    release();
    await expect(page.getByRole('heading', { name: 'API key required' })).toBeVisible();
    await retryStarted;
    // Focus must reach the key panel while the retry cannot complete.
    await expect(page.getByLabel('API key', { exact: true })).toBeFocused();
    releaseRetry();
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
    releaseRetry();
  }
});

test('review: keyboard export keeps focus and announces progress', async ({ page, request }) => {
  const name = `focus-export-${test.info().repeatEachIndex}`;
  const id = await publishLoop(request, approvalLoop(name));
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
    const button = page.getByRole('button', { name: `Export ${name}` });
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(button).toContainText('Exporting');
    await expect(button).toBeFocused();
    await expect(page.getByRole('status').filter({ hasText: `Exporting ${name}` })).toBeVisible();
    await page.keyboard.press('Enter');
    release();
    await expect(page.getByRole('alert')).toContainText('No version.');
    await expect(button).toBeFocused();
  } finally {
    release();
  }
});

test('review: pending double clicks cannot select status text', async ({ page, request }) => {
  const name = `selection-guard-${test.info().repeatEachIndex}`;
  const id = await publishLoop(request, approvalLoop(name));
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
    await page.getByRole('button', { name: `Delete ${name}`, exact: true }).click();
    const button = page.getByRole('button', { name: `Confirm delete ${name}` });
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
