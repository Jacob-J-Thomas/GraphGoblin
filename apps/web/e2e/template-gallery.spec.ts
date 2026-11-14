import { TemplateDraftResponseSchema, type LoopVersionRecord } from '@graphgoblin/contracts';
import type { Page } from '@playwright/test';
import { expect, openNode, showLoopPanel, test, uniqueLoopName } from './fixtures.js';

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

test('offers one green Use action per card without setup requests or fields', async ({ page }) => {
  const setupRequests: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (/model-catalog|system\/preflight|prerequisites|instantiate|template-instances/.test(path))
      setupRequests.push(path);
  });
  await page.goto('/app/loops');
  await page.getByRole('button', { name: 'New from template' }).click();
  const gallery = page.getByRole('region', { name: 'Choose a template' });
  const catalogResponse = await page.request.get('/templates');
  expect(catalogResponse.ok()).toBe(true);
  const catalog = (await catalogResponse.json()) as {
    items: { manifest: { title: string; description: string } }[];
  };
  expect(catalog.items).toHaveLength(4);
  for (const { manifest } of catalog.items) {
    const card = gallery.getByRole('region', { name: manifest.title, exact: true });
    await expect(card.getByText(manifest.description, { exact: true })).toBeVisible();
    await expect(card.getByRole('button')).toHaveCount(1);
    const use = card.getByRole('button', { name: `Use ${manifest.title}`, exact: true });
    await expect(use).toHaveClass(/bg-accent/);
    await expect(use).toBeEnabled();
  }
  await expect(gallery.getByRole('textbox')).toHaveCount(0);
  await expect(gallery.getByRole('combobox')).toHaveCount(0);
  await expect(
    gallery.getByText(/requirements|setup needed|Configure automation|isolation-unavailable/),
  ).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(setupRequests).toEqual([]);
});

for (const width of [1440, 390, 320]) {
  test(`gallery fits at ${width}px and its Use button follows the opener in keyboard order`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/app/loops');
    const opener = page.getByRole('button', { name: 'New from template' });
    await opener.focus();
    await page.keyboard.press('Enter');
    const use = page.getByRole('button', { name: 'Use Starter assistant', exact: true });
    await page.keyboard.press('Tab');
    await expect(use).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    const gallery = page.getByRole('region', { name: 'Choose a template' });
    for (const card of await gallery.getByRole('region').all()) {
      const button = card.getByRole('button');
      const box = await button.boundingBox();
      const cardBox = await card.boundingBox();
      expect(box).not.toBeNull();
      expect(cardBox).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(cardBox!.x);
      expect(box!.x + box!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      expect(await card.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
    }
    await page.screenshot({ path: testInfo.outputPath(`gallery-${width}.png`), fullPage: true });
  });
}

// Each template's own name can be created once per owner (#209): this shared gateway's first
// Starter assistant copy belongs to the first test, so the tests below that need an ordinary
// first copy use the Review and Implementation templates, and the repeated-copy test asks for names.
test('retains keyboard focus and guards all cards while a copy is pending', async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let submissions = 0;
  await page.route('**/templates/*/draft', async (route) => {
    submissions += 1;
    await pending;
    await route.continue();
  });
  await page.goto('/app/loops');
  await page.getByRole('button', { name: 'New from template' }).click();
  const create = page
    .getByRole('region', { name: 'Review workflow', exact: true })
    .getByRole('button');
  await create.focus();
  await page.keyboard.press('Enter');
  await expect(create).toHaveAttribute('aria-busy', 'true');
  await expect(create).toBeFocused();
  await expect(page.getByRole('status').filter({ hasText: 'Creating draft' })).toBeVisible();
  await page.keyboard.press('Enter');
  const other = page.getByRole('button', { name: 'Use Implementation workflow', exact: true });
  await other.focus();
  await expect(other).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Enter');
  await expect(other).toBeFocused();
  expect(submissions).toBe(1);
  release();
  await expect(page).toHaveURL(/\/loops\/[^/]+\/edit$/);
  expect(submissions).toBe(1);
});

test('announces failed creation, keeps focus and retries only on a new activation', async ({
  page,
}) => {
  let submissions = 0;
  await page.route('**/templates/*/draft', async (route) => {
    submissions += 1;
    if (submissions === 1) {
      await route.fulfill({
        status: 503,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'about:blank',
          title: 'Draft unavailable',
          status: 503,
          code: 'DRAFT_UNAVAILABLE',
          detail: 'The draft service is unavailable.',
        }),
      });
    } else await route.continue();
  });
  await page.goto('/app/loops');
  await page.getByRole('button', { name: 'New from template' }).click();
  const create = page.getByRole('button', { name: 'Use Implementation workflow', exact: true });
  await create.focus();
  await page.keyboard.press('Enter');
  const error = page
    .getByRole('alert')
    .filter({ hasText: 'Could not create the Implementation workflow draft' });
  await expect(error).toBeVisible();
  await expect(error).toContainText('check the loop list');
  await expect(create).toBeFocused();
  await expect(create).not.toHaveAttribute('aria-busy', 'true');
  expect(submissions).toBe(1);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/loops\/[^/]+\/edit$/);
  expect(submissions).toBe(2);
});

/** A definition without its display name, so graphs compare apart from their distinct names. */
function graphOf(definition: LoopVersionRecord['definition']) {
  const { name: _name, ...graph } = definition;
  return graph;
}

async function loopIds(page: Page): Promise<string[]> {
  const listed = (await (await page.request.get('/loops')).json()) as { items: { id: string }[] };
  return listed.items.map((loop) => loop.id).sort();
}

test('a repeated Use asks for a name, then creates independent copies of the same graph (#209)', async ({
  page,
}) => {
  const catalogBefore = (await (await page.request.get('/templates/starter')).json()) as unknown;
  // The template's own name is taken: by the first test's copy, or here when run alone.
  const seeded = await page.request.post('/templates/starter/draft', { data: {} });
  expect([201, 409]).toContain(seeded.status());
  const listed = (await (await page.request.get('/loops')).json()) as {
    items: { id: string; name: string }[];
  };
  const original = listed.items.find((loop) => loop.name === 'Starter assistant');
  if (!original) throw new Error('No loop holds the Starter assistant name.');
  const originalBefore = (await (await page.request.get(`/loops/${original.id}`)).json()) as {
    loop: unknown;
    draft: LoopVersionRecord;
  };

  const copies = [];
  for (const choice of ['typed', 'suggested'] as const) {
    const idsBefore = await loopIds(page);
    await page.goto('/app/loops');
    await page.getByRole('button', { name: 'New from template' }).click();
    const card = page.getByRole('region', { name: 'Starter assistant', exact: true });
    const isDraftRequest = (item: { request: () => { method: () => string }; url: () => string }) =>
      item.request().method() === 'POST' &&
      new URL(item.url()).pathname === '/templates/starter/draft';
    const refused = page.waitForResponse(isDraftRequest);
    await card.getByRole('button', { name: 'Use Starter assistant', exact: true }).click();
    const refusal = await refused;
    expect(refusal.status()).toBe(409);
    const problem = (await refusal.json()) as { code: string; suggestedName: string };
    expect(problem.code).toBe('LOOP_NAME_CONFLICT');
    expect(typeof problem.suggestedName).toBe('string');

    // The refusal created nothing and changed neither the catalog nor the original copy.
    const field = card.getByRole('textbox', { name: 'Name for the new draft' });
    await expect(field).toBeFocused();
    await expect(field).toHaveValue(problem.suggestedName);
    await expect(card).toContainText('Another loop already has the name this template uses.');
    await expect(card.getByRole('button', { name: 'Use Starter assistant' })).toHaveCount(0);
    await expect(page).toHaveURL(/\/app\/loops$/);
    expect(await loopIds(page)).toEqual(idsBefore);
    expect(await (await page.request.get('/templates/starter')).json()).toEqual(catalogBefore);
    expect(await (await page.request.get(`/loops/${original.id}`)).json()).toMatchObject(
      originalBefore,
    );

    // A deliberate second attempt: a typed name, then the API's suggestion as offered.
    const name = choice === 'typed' ? uniqueLoopName('Starter assistant') : problem.suggestedName;
    if (choice === 'typed') await field.fill(name);
    const response = page.waitForResponse(isDraftRequest);
    await card.getByRole('button', { name: 'Create draft', exact: true }).click();
    const created = await response;
    expect(created.status()).toBe(201);
    expect(created.request().postDataJSON()).toEqual({ name });
    const result = TemplateDraftResponseSchema.parse(await created.json());
    expect(result.loop.name).toBe(name);
    copies.push(result);
    await expect(page).toHaveURL(new RegExp(`/loops/${result.loop.id}/edit$`));
    const detail = (await (await page.request.get(`/loops/${result.loop.id}`)).json()) as {
      templateInstanceId?: string;
    };
    expect(detail.templateInstanceId).toBeUndefined();
  }
  const [first, second] = copies;
  expect(new Set([original.id, first!.loop.id, second!.loop.id]).size).toBe(3);
  expect(first!.draft.id).not.toBe(second!.draft.id);
  expect(first!.loop.name).not.toBe(second!.loop.name);
  // The same starting graph under distinct display names.
  expect(graphOf(first!.draft.definition)).toEqual(graphOf(second!.draft.definition));
  await page.goto(`/app/loops/${first!.loop.id}/edit`);
  await showLoopPanel(page);
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      new URL(response.url()).pathname === `/loops/${first!.loop.id}/draft`,
  );
  await page
    .getByRole('textbox', { name: 'Description', exact: true })
    .fill('Only this copy was edited.');
  expect((await saved).ok()).toBe(true);
  const inference = first!.draft.definition.nodes.find((node) => node.kind === 'inference');
  if (!inference) throw new Error('The starter has no inference node.');
  const dialog = await openNode(page, inference.id);
  const promptSaved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      new URL(response.url()).pathname === `/loops/${first!.loop.id}/draft`,
  );
  await dialog.getByRole('tab', { name: /^Context\b/ }).click();
  await dialog
    .locator('[data-field="prompt.template"] .cm-content')
    .fill('Only this copy uses this prompt.');
  expect((await promptSaved).ok()).toBe(true);
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const firstAfter = (await (await page.request.get(`/loops/${first!.loop.id}`)).json()) as {
    draft: LoopVersionRecord;
  };
  const secondAfter = (await (await page.request.get(`/loops/${second!.loop.id}`)).json()) as {
    draft: LoopVersionRecord;
  };
  expect(firstAfter.draft.definition.description).toBe('Only this copy was edited.');
  expect(firstAfter.draft.definition.nodes.find((node) => node.id === inference.id)).toMatchObject({
    config: { prompt: { template: 'Only this copy uses this prompt.' } },
  });
  expect(secondAfter.draft.definition).toEqual(second!.draft.definition);
  expect(await (await page.request.get('/templates/starter')).json()).toEqual(catalogBefore);
  // A fresh copy needs a name of its own too, and still starts from the unedited graph.
  const freshName = uniqueLoopName('Starter assistant fresh');
  const freshResponse = await page.request.post('/templates/starter/draft', {
    data: { name: freshName },
  });
  expect(freshResponse.status()).toBe(201);
  const fresh = TemplateDraftResponseSchema.parse(await freshResponse.json());
  expect(fresh.draft.definition.name).toBe(freshName);
  expect(graphOf(fresh.draft.definition)).toEqual(graphOf(first!.draft.definition));
});

for (const width of [390, 320]) {
  test(`the naming form after a refused Use fits at ${width}px and keeps keyboard order (#209)`, async ({
    page,
  }) => {
    // Starter assistant is taken by now, so Use is refused and creates nothing.
    const idsBefore = await loopIds(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/app/loops');
    await page.getByRole('button', { name: 'New from template' }).click();
    const card = page.getByRole('region', { name: 'Starter assistant', exact: true });
    const use = card.getByRole('button', { name: 'Use Starter assistant', exact: true });
    await use.focus();
    await page.keyboard.press('Enter');
    const field = card.getByRole('textbox', { name: 'Name for the new draft' });
    await expect(field).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    expect(await card.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    const cardBox = (await card.boundingBox())!;
    for (const control of [
      field,
      card.getByRole('button', { name: 'Create draft', exact: true }),
      card.getByRole('button', { name: 'Cancel', exact: true }),
    ]) {
      const box = (await control.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(cardBox.x);
      expect(box.x + box.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
    }
    await page.keyboard.press('Tab');
    await expect(card.getByRole('button', { name: 'Create draft', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(card.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(use).toBeFocused();
    await expect(field).toHaveCount(0);
    expect(await loopIds(page)).toEqual(idsBefore);
  });
}

test('opens the QA starting point as an ordinary copy without configured-parent isolation warnings', async ({
  page,
}) => {
  const instanceRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/template-instances/'))
      instanceRequests.push(request.url());
  });
  await page.goto('/app/loops');
  await page.getByRole('button', { name: 'New from template' }).click();
  const copied = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/templates/qa/draft',
  );
  await page.getByRole('button', { name: 'Use QA assessment', exact: true }).click();
  const copy = TemplateDraftResponseSchema.parse(await (await copied).json());
  await expect(page).toHaveURL(new RegExp(`/loops/${copy.loop.id}/edit$`));
  await expect(page.getByText('Ready to publish', { exact: true })).toBeVisible();
  await expect(page.getByText('QA execution is blocked')).toHaveCount(0);
  await expect(page.getByText('Graph ready to publish; QA execution blocked')).toHaveCount(0);
  expect(instanceRequests).toEqual([]);
});
