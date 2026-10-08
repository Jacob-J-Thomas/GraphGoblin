import { expect, test } from './fixtures.js';

test('opens the starter gallery with the keyboard and creates an unpublished parent draft', async ({
  page,
}) => {
  await page.goto('/loops');
  const galleryButton = page.getByRole('button', { name: 'New from template' });
  await galleryButton.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Choose a template' })).toBeVisible();

  const useTemplate = page.getByRole('button', { name: /^Use / }).first();
  await useTemplate.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('does not need GitHub or a repository checkout');
  await expect(dialog).toContainText('The parent opens as a draft');
  await expect(dialog).toContainText('Assistant model');

  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/templates\/[^/]+\/instantiate$/.test(new URL(response.url()).pathname),
  );
  await dialog.getByRole('button', { name: 'Create draft' }).click();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  const result = (await response.json()) as {
    instance: {
      parentLoopId: string;
      settings: { kind: string; instruction: string; maxIterations: number };
      loops: { loopId: string; status: string }[];
    };
  };
  expect(result.instance.settings).toMatchObject({ kind: 'starter' });
  expect(result.instance.settings.instruction.trim().length).toBeGreaterThan(0);
  expect(result.instance.settings.maxIterations).toBeGreaterThan(0);
  expect(result.instance.loops.every((loop) => loop.status === 'draft')).toBe(true);

  await expect(page).toHaveURL(new RegExp(`/loops/${result.instance.parentLoopId}/edit$`));
  const loopsResponse = await page.request.get('/loops');
  expect(loopsResponse.ok()).toBe(true);
  const loops = (await loopsResponse.json()) as {
    items: { id: string; currentVersionId?: string; draftVersionId?: string }[];
  };
  const parent = loops.items.find((loop) => loop.id === result.instance.parentLoopId);
  expect(parent?.currentVersionId).toBeUndefined();
  expect(parent?.draftVersionId).toBeTruthy();
});

test('rechecks edited starter settings before creating the draft', async ({ page }) => {
  await page.goto('/loops');
  await page.getByRole('button', { name: 'New from template' }).click();
  await page.getByRole('button', { name: /^Use / }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/instruction/i).fill('Summarize this request and suggest one next step.');
  await dialog.getByLabel(/maximum iterations/i).fill('4');
  const create = dialog.getByRole('button', { name: 'Create draft' });
  await expect(create).toBeDisabled();

  const checkResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/templates\/[^/]+\/prerequisites$/.test(new URL(response.url()).pathname),
  );
  await dialog.getByRole('button', { name: 'Check requirements' }).click();
  expect((await checkResponse).ok()).toBe(true);
  await expect(create).toBeEnabled();

  const instantiateResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/templates\/[^/]+\/instantiate$/.test(new URL(response.url()).pathname),
  );
  await create.click();
  const payload = (await (await instantiateResponse).json()) as {
    instance: { settings: { instruction: string; maxIterations: number } };
  };
  expect(payload.instance.settings).toMatchObject({
    instruction: 'Summarize this request and suggest one next step.',
    maxIterations: 4,
  });
  await expect(page).toHaveURL(/\/loops\/[^/]+\/edit$/);
});
