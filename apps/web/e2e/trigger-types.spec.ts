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
    await expect(dialog.getByLabel('Filter', { exact: true })).toBeVisible();
    await type.selectOption('webhook');
    const signing = dialog.getByLabel('Signing protocol');
    await expect(signing.locator('option:checked')).toHaveText('Timestamp and body');
    await expect(dialog.getByLabel('Replay window seconds')).toBeVisible();
    await signing.selectOption({ label: 'Body only (GitHub)' });
    await expect(dialog.getByLabel('Replay window seconds')).toHaveCount(0);
    await dialog.getByLabel('Secret ref').fill('synthetic-hook');

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
    await page.keyboard.press('Tab');
    await expect(preview.getByRole('button', { name: 'Cancel preview' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(previewButton).toBeFocused();
    await expect(type).toHaveValue('webhook');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(preview.getByRole('button', { name: 'Apply GitHub preset' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(type).toHaveValue('poll');
    await expect(type).toBeFocused();
    await expect(dialog.getByLabel('Interval seconds')).toHaveValue('60');
    await page.keyboard.press('Control+z');
    await expect(type).toHaveValue('webhook');
    await expect(dialog.getByLabel('Secret ref')).toHaveValue('synthetic-hook');
    await expect(signing.locator('option:checked')).toHaveText('Body only (GitHub)');
    await page.keyboard.press('Control+y');
    await expect(type).toHaveValue('poll');
    await expect(dialog.getByLabel('Max runs per poll')).toHaveValue('5');
    await page.screenshot({ path: testInfo.outputPath(`poll-fields-${theme}.png`) });
  });
}
