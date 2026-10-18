import type { LoopDefinition } from '@graphgoblin/contracts';
import { approvalLoop, expect, openNode, test } from './fixtures.js';

for (const theme of ['light', 'dark']) {
  test(`GitHub graph preview, cancel, apply and keyboard undo in ${theme}`, async ({
    page,
    request,
  }, testInfo) => {
    await page.addInitScript(
      (selected) => localStorage.setItem('graphgoblin-theme', selected),
      theme,
    );
    const created = await request.post('/loops', {
      data: { definition: approvalLoop(`GitHub checks ${theme}`) },
    });
    expect(created.status()).toBe(201);
    const id = ((await created.json()) as { loop: { id: string } }).loop.id;
    const saved = async () => {
      const response = await request.get(`/loops/${id}`);
      expect(response.ok()).toBe(true);
      return ((await response.json()) as { draft: { definition: LoopDefinition } }).draft
        .definition;
    };
    const before = await saved();
    await page.goto(`/app/loops/${id}/edit`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const dialog = await openNode(page, 'start');
    await dialog.getByRole('button', { name: 'Start from a preset' }).click();
    const setup = dialog.getByRole('form', { name: 'GitHub preset setup' });
    await setup.getByLabel('Preset', { exact: true }).selectOption('issues-labeled');
    await setup.getByLabel('Repository owner', { exact: true }).fill('octo-team');
    await setup.getByLabel('Repository', { exact: true }).fill('fixture-repo');
    await setup.getByLabel('Issue label').fill('ready "now"');
    await setup.getByLabel('Signing secret name').fill('synthetic-hook');
    const previewButton = setup.getByRole('button', { name: 'Preview GitHub preset' });
    await previewButton.click();
    const preview = dialog.getByRole('region', { name: 'Preset preview' });
    await expect(preview).toBeFocused();
    for (const text of [
      'event-check',
      'restore-output',
      'quiet-exit',
      'rewireEdges',
      'signature',
      'dedupeKey',
    ])
      await expect(preview).toContainText(text);
    expect(await saved()).toEqual(before);
    await page.screenshot({ path: testInfo.outputPath(`github-checks-preview-${theme}.png`) });
    await page.keyboard.press('Tab');
    await expect(preview.getByRole('region', { name: 'Current configuration' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(preview.getByRole('region', { name: 'Preset configuration' })).toBeFocused();
    await preview.getByRole('button', { name: 'Cancel preview' }).click();
    await expect(previewButton).toBeFocused();
    expect(await saved()).toEqual(before);
    await previewButton.click();
    await expect(preview).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(preview.getByRole('region', { name: 'Current configuration' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(preview.getByRole('region', { name: 'Preset configuration' })).toBeFocused();
    await preview.getByRole('button', { name: 'Apply GitHub preset' }).click();
    await expect(dialog.getByLabel('Trigger type', { exact: true })).toBeFocused();
    await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
    await expect.poll(async () => (await saved()).nodes.length).toBe(before.nodes.length + 3);
    const applied = await saved();
    expect(applied.nodes.find((node) => node.id === 'start')!.config).not.toHaveProperty('filter');
    for (const edge of before.edges.filter((edge) => edge.from.node === 'start'))
      expect(applied.edges.find((candidate) => candidate.id === edge.id)).toEqual({
        ...edge,
        from: { ...edge.from, node: 'restore-output' },
      });
    await page.keyboard.press('Control+z');
    await expect.poll(saved).toEqual(before);
    await page.keyboard.press('Control+y');
    await expect.poll(saved).toEqual(applied);
    await page.screenshot({ path: testInfo.outputPath(`github-checks-applied-${theme}.png`) });
  });
}
