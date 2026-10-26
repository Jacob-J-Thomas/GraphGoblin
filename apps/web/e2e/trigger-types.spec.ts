import { approvalLoop, expect, openNode, test } from './fixtures.js';

for (const theme of ['light', 'dark']) {
  test(`trigger types and optional preset keyboard review in ${theme}`, async ({
    page,
    request,
  }, testInfo) => {
    await page.addInitScript(
      (selected) => localStorage.setItem('graphgoblin-theme', selected),
      theme,
    );
    const response = await request.post('/loops', {
      data: { definition: approvalLoop(`trigger types ${theme}`) },
    });
    expect(response.status()).toBe(201);
    const id = ((await response.json()) as { loop: { id: string } }).loop.id;
    await page.goto(`/app/loops/${id}/edit`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const dialog = await openNode(page, 'start');
    const type = dialog.getByLabel('Trigger type', { exact: true });
    await expect(type.locator('option')).toHaveText(['Manual', 'Cron', 'Poll', 'Event', 'Webhook']);
    await expect(dialog.getByRole('form', { name: 'GitHub preset setup' })).toHaveCount(0);
    await expect(dialog.locator('[data-field="inputSchema"]')).toBeVisible();
    await expect(dialog.locator('[data-field="exposeTo"]')).toBeVisible();

    // The native select remains the keyboard entry point; one undo returns to Manual.
    await type.focus();
    await page.keyboard.press('ArrowDown');
    await expect(type).toHaveValue('cron');
    await expect(dialog.getByLabel('Repeat')).toBeVisible();
    await expect(dialog.getByLabel('Timezone')).toBeVisible();
    await page.keyboard.press('Control+z');
    await expect(type).toHaveValue('manual');
    await expect(type).toBeFocused();
    await page.keyboard.press('Control+y');
    await expect(type).toHaveValue('cron');

    await type.selectOption('poll');
    await expect(dialog.getByLabel('Interval seconds')).toBeVisible();
    await expect(dialog.getByLabel('Fire when')).toBeVisible();
    await expect(dialog.locator('[data-field="items"]')).toBeVisible();
    await expect(dialog.getByLabel('Repeat')).toHaveCount(0);
    await type.selectOption('event');
    await expect(dialog.getByLabel('Event type')).toBeVisible();
    await expect(dialog.getByLabel('Filter', { exact: true })).toHaveCount(0);
    await expect(dialog.getByText(/Use a downstream decision for payload checks/)).toBeVisible();
    await type.selectOption('webhook');
    await expect(dialog.getByLabel('Filter', { exact: true })).toHaveCount(0);
    const signing = dialog.getByLabel('Authentication recipe');
    await expect(signing.locator('option:checked')).toHaveText('None');
    await signing.selectOption({ label: 'Timestamp and body HMAC' });
    await expect(dialog.getByLabel('Timestamp window (seconds)')).toBeVisible();
    await signing.selectOption({ label: 'Body HMAC' });
    await expect(dialog.getByLabel('Timestamp window (seconds)')).toHaveCount(0);
    await dialog.getByLabel('Secret name', { exact: true }).fill('synthetic-hook');
    const modes = dialog.getByRole('radiogroup', { name: 'Body mode' });
    await modes.getByText('text', { exact: true }).click();
    await expect(modes.getByRole('radio', { name: 'text', exact: true })).toBeChecked();
    await page.keyboard.press('Control+z');
    await expect(modes.getByRole('radio', { name: 'json', exact: true })).toBeChecked();
    await page.keyboard.press('Control+y');
    await dialog.getByLabel('Event type source').selectOption('header');
    await dialog.getByLabel('Event header').fill('x-provider-event');
    await expect(dialog.getByLabel('Fallback event type')).toHaveAttribute(
      'placeholder',
      'webhook',
    );

    const optional = dialog.getByRole('button', { name: 'Start from a preset' });
    await optional.focus();
    await page.keyboard.press('Enter');
    await expect(optional).toHaveAttribute('aria-expanded', 'true');
    const setup = dialog.getByRole('form', { name: 'GitHub preset setup' });
    await setup.getByLabel('Preset', { exact: true }).selectOption('issues-poll');
    await setup.getByLabel('Repository owner', { exact: true }).fill('octo-team');
    await setup.getByLabel('Repository', { exact: true }).fill('fixture-repo');
    await setup.getByLabel('Issue label').fill('ready');
    const previewButton = setup.getByRole('button', { name: 'Preview GitHub preset' });
    await previewButton.focus();
    await page.keyboard.press('Enter');
    const preview = dialog.getByRole('region', { name: 'Preset preview' });
    await expect(preview).toBeFocused();
    await expect(preview).toContainText('synthetic-hook');
    await expect(preview).toContainText('intervalSeconds');
    await expect(type).toHaveValue('webhook');
    await page.screenshot({ path: testInfo.outputPath(`preset-preview-${theme}.png`) });
    // JSON blocks are explicit tab stops, including when their content does not overflow.
    await page.keyboard.press('Tab');
    await expect(preview.getByRole('region', { name: 'Current configuration' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(preview.getByRole('region', { name: 'Preset configuration' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(preview.getByRole('button', { name: 'Cancel preview' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(previewButton).toBeFocused();
    await expect(type).toHaveValue('webhook');
    await page.keyboard.press('Enter');
    await expect(preview).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(preview.getByRole('region', { name: 'Current configuration' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(preview.getByRole('region', { name: 'Preset configuration' })).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(preview.getByRole('button', { name: 'Apply GitHub preset' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(type).toHaveValue('poll');
    await expect(type).toBeFocused();
    await expect(dialog.getByLabel('Interval seconds')).toHaveValue('60');
    await page.keyboard.press('Control+z');
    await expect(type).toHaveValue('webhook');
    await expect(dialog.getByLabel('Secret name', { exact: true })).toHaveValue('synthetic-hook');
    await expect(signing.locator('option:checked')).toHaveText('Body HMAC');
    await page.keyboard.press('Control+y');
    await expect(type).toHaveValue('poll');
    await expect(dialog.getByLabel('Max runs per poll')).toHaveValue('5');
    await page.screenshot({ path: testInfo.outputPath(`poll-fields-${theme}.png`) });
  });
}

for (const width of [360, 1440]) {
  test(`general webhook configuration persists and validates at ${width}px`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const created = await request.post('/loops', {
      data: { definition: approvalLoop(`general webhook ${width}`) },
    });
    expect(created.status()).toBe(201);
    const id = ((await created.json()) as { loop: { id: string } }).loop.id;
    await page.goto(`/app/loops/${id}/edit`);
    const dialog = await openNode(page, 'start');
    await dialog.getByLabel('Trigger type').selectOption('webhook');
    const auth = dialog.getByLabel('Authentication recipe');
    await expect(auth.locator('option:checked')).toHaveText('None');
    await auth.focus();
    await page.keyboard.press('ArrowDown');
    await expect(auth.locator('option:checked')).toHaveText('Body HMAC');
    await dialog.getByLabel('Secret name', { exact: true }).fill('synthetic-hook');
    await expect(dialog.getByLabel('Signing header')).toHaveAttribute(
      'placeholder',
      'x-hub-signature-256',
    );
    await auth.focus();
    await auth.selectOption({ label: 'Timestamp and body HMAC' });
    await expect(dialog.getByLabel('Timestamp window (seconds)')).toHaveAttribute(
      'placeholder',
      '300',
    );
    await page.keyboard.press('Control+z');
    await expect(auth.locator('option:checked')).toHaveText('Body HMAC');
    await expect(auth).toBeFocused();
    await auth.selectOption({ label: 'None' });
    await expect(dialog.getByLabel('Secret name', { exact: true })).toHaveCount(0);
    const modes = dialog.getByRole('radiogroup', { name: 'Body mode' });
    await modes.getByText('bytes', { exact: true }).click();
    await dialog.getByLabel('Event type source').selectOption('json-pointer');
    await dialog.getByLabel('JSON pointer').fill('/event~1type/0');
    await expect(
      dialog.getByText('JSON pointers require JSON body mode', { exact: true }).first(),
    ).toBeVisible();
    await modes.getByText('json', { exact: true }).click();
    await expect(
      dialog.getByText('JSON pointers require JSON body mode', { exact: true }),
    ).toHaveCount(0);
    const savedConfig = async () => {
      const exported = await request.get(`/loops/${id}/export?draft=true`);
      expect(exported.ok()).toBe(true);
      const value = (await exported.json()) as {
        loop: { nodes: { id: string; config: unknown }[] };
      };
      return value.loop.nodes.find((node) => node.id === 'start')?.config;
    };
    const implicitDefault = {
      type: 'webhook',
      authentication: { type: 'none' },
      body: { type: 'json' },
      eventType: { source: 'json-pointer', pointer: '/event~1type/0', fallback: 'webhook' },
    };
    // An omitted default may be drawn as a placeholder in the device copy. Check its
    // durable meaning, then author a distinct value whose exact persistence is observable.
    await expect.poll(savedConfig).toMatchObject(implicitDefault);
    const fallback = dialog.getByLabel('Fallback event type');
    await expect(fallback).toHaveAttribute('placeholder', 'webhook');
    await fallback.fill('fixture-webhook-type');
    const explicitFallback = {
      ...implicitDefault,
      eventType: { ...implicitDefault.eventType, fallback: 'fixture-webhook-type' },
    };
    await expect.poll(savedConfig).toMatchObject(explicitFallback);
    await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
    await page.reload();
    const reopened = await openNode(page, 'start');
    await expect(reopened.getByLabel('Authentication recipe').locator('option:checked')).toHaveText(
      'None',
    );
    await expect(reopened.getByLabel('JSON pointer')).toHaveValue('/event~1type/0');
    await expect(reopened.getByLabel('Fallback event type')).toHaveValue('fixture-webhook-type');
    expect(await savedConfig()).toMatchObject(explicitFallback);
  });
}
