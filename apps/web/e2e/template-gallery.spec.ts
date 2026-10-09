import { expect, test } from './fixtures.js';

test('opens the starter gallery with the keyboard and creates an editable draft directly', async ({
  page,
}) => {
  await page.goto('/app/loops');
  const galleryButton = page.getByRole('button', { name: 'New from template' });
  await galleryButton.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Choose a template' })).toBeVisible();

  const useTemplate = page.getByRole('button', { name: /^Use / }).first();
  await useTemplate.focus();
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/templates\/[^/]+\/draft$/.test(new URL(response.url()).pathname),
  );
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  const result = (await response.json()) as {
    loop: { id: string; draftVersionId?: string; currentVersionId?: string };
    draft: { definition: { name: string; nodes: { id: string; kind: string }[] } };
    issues: { severity: string }[];
  };
  expect(result.loop.id).toBeTruthy();
  expect(result.draft.definition.name).toBe('Starter assistant');
  expect(result.draft.definition.nodes.map((node) => node.kind)).toEqual([
    'trigger',
    'mutate',
    'inference',
    'exit',
  ]);
  expect(result.issues.filter((issue) => issue.severity === 'error')).toHaveLength(0);
  expect(result.loop.currentVersionId).toBeUndefined();
  expect(result.loop.draftVersionId).toBeTruthy();

  await expect(page).toHaveURL(new RegExp(`/loops/${result.loop.id}/edit$`));
  const loopsResponse = await page.request.get('/loops');
  expect(loopsResponse.ok()).toBe(true);
  const loops = (await loopsResponse.json()) as {
    items: { id: string; currentVersionId?: string; draftVersionId?: string }[];
  };
  const created = loops.items.find((loop) => loop.id === result.loop.id);
  expect(created?.currentVersionId).toBeUndefined();
  expect(created?.draftVersionId).toBeTruthy();
});

test('keeps repository automation setup as an optional, separate action', async ({ page }) => {
  await page.goto('/app/loops');
  await page.getByRole('button', { name: 'New from template' }).click();
  const configure = page.getByRole('button', {
    name: 'Configure automation for Implementation workflow',
  });
  await expect(configure).toBeVisible();
  await configure.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Checkout path');
  await expect(dialog).toContainText('Repository owner');
  await expect(page.getByRole('button', { name: 'Use Implementation workflow' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Create draft' })).toBeDisabled();
});
