import { approvalLoop, control, expect, publishLoop, test } from './fixtures.js';

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
  await request.put('/model-catalog/codex/actions-model', {
    data: {
      displayName: 'Actions model',
      efforts: ['low'],
      defaultEffort: 'low',
      enabled: true,
    },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/settings');
  await page.getByRole('button', { name: 'Delete actions-model', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('returns at the next server start');
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
  await expect(dialog).toContainText('this browser will lose access and show the API key panel');
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
