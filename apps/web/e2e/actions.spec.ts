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
});
