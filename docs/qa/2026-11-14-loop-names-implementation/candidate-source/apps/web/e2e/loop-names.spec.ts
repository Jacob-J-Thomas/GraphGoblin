/**
 * #209 loop-name admission through the real API and the built app: Create, rename in the editor,
 * import and the stale-draft precedence. One owner cannot keep two names that differ only in letter
 * case or spacing; a refusal changes nothing, explains the rule and offers the API's advisory
 * suggestion, and only a deliberate attempt creates or renames. Template copies are covered in
 * template-gallery.spec.ts, which owns the Starter assistant name on this shared gateway.
 */
import type { APIRequestContext, Page, Response } from '@playwright/test';
import {
  approvalLoop,
  expect,
  openDraftTab,
  showLoopPanel,
  test,
  uniqueLoopName,
} from './fixtures.js';

// A type alias, not an interface, so it is a record for Playwright's `toMatchObject`.
type Detail = {
  loop: { id: string; name: string };
  draft?: { id: string; definition: { name: string; nodes: unknown[]; edges: unknown[] } };
};

async function createLoop(request: APIRequestContext, name: string) {
  const created = await request.post('/loops', { data: { definition: approvalLoop(name) } });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { loop: { id: string; name: string } }).loop;
}

async function detail(request: APIRequestContext, loopId: string): Promise<Detail> {
  return (await (await request.get(`/loops/${loopId}`)).json()) as Detail;
}

/** The same name to the API: other letter case, with non-breaking and doubled spaces. */
function equivalent(name: string): string {
  return ` ${name.toUpperCase().replaceAll(' ', '  ')} `;
}

function answer(page: Page, method: string, path: string): Promise<Response> {
  return page.waitForResponse(
    (response) =>
      response.request().method() === method && new URL(response.url()).pathname === path,
  );
}

async function noSidewaysScroll(page: Page, width: number) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    width,
  );
}

test('Create refuses an equivalent name, keeps the original and creates on a deliberate retry', async ({
  page,
  request,
}) => {
  const base = uniqueLoopName('Nightly triage');
  const original = await createLoop(request, base);
  const before = await detail(request, original.id);
  await page.goto('/app/loops');
  const field = page.getByRole('textbox', { name: 'New loop name' });
  await field.fill(equivalent(base));
  const refused = answer(page, 'POST', '/loops');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  const refusal = await refused;
  expect(refusal.status()).toBe(409);
  const problem = (await refusal.json()) as { code: string; suggestedName: string };
  expect(problem.code).toBe('LOOP_NAME_CONFLICT');
  expect(typeof problem.suggestedName).toBe('string');

  await expect(page.getByRole('alert')).toContainText('letter case or spacing');
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(page).toHaveURL(/\/app\/loops$/);
  expect(await detail(request, original.id)).toMatchObject(before);

  // The suggestion only fills the field; Enter is the deliberate second attempt.
  await page.getByRole('button', { name: `Use “${problem.suggestedName}”` }).click();
  await expect(field).toBeFocused();
  await expect(field).toHaveValue(problem.suggestedName);
  await expect(field).not.toHaveAttribute('aria-invalid');
  const accepted = answer(page, 'POST', '/loops');
  await page.keyboard.press('Enter');
  const created = await accepted;
  expect(created.status()).toBe(201);
  const result = (await created.json()) as { loop: { id: string; name: string } };
  expect(result.loop.id).not.toBe(original.id);
  expect(result.loop.name).toBe(problem.suggestedName);
  await expect(page).toHaveURL(new RegExp(`/loops/${result.loop.id}/edit$`));
  expect(await detail(request, original.id)).toMatchObject(before);
});

test('an equivalent rename keeps the authored draft on the device and both loops on the server', async ({
  page,
  request,
}) => {
  const otherName = uniqueLoopName('Daily report');
  const other = await createLoop(request, otherName);
  const mine = await createLoop(request, uniqueLoopName('Weekly report'));
  const [mineBefore, otherBefore] = [
    await detail(request, mine.id),
    await detail(request, other.id),
  ];
  await openDraftTab(page, mine.id, mine.name);
  await showLoopPanel(page);
  const field = page.getByRole('textbox', { name: 'Name', exact: true });
  const authored = ` ${otherName.toLowerCase()} `;
  const refused = answer(page, 'PUT', `/loops/${mine.id}/draft`);
  await field.fill(authored);
  const refusal = await refused;
  expect(refusal.status()).toBe(409);
  expect(await refusal.json()).toMatchObject({ code: 'LOOP_NAME_CONFLICT' });

  const notice = page.getByRole('status').filter({ hasText: 'Another loop already has this name' });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('letter case or spacing');
  await expect(page.getByTestId('save-state')).toHaveText('Not saved: name in use');
  await expect(page.getByText('The draft changed on the server')).toHaveCount(0);
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  expect(await detail(request, mine.id)).toMatchObject(mineBefore);
  expect(await detail(request, other.id)).toMatchObject(otherBefore);

  // The authored name comes back from this device after a reload, and is refused again.
  const refusedAgain = answer(page, 'PUT', `/loops/${mine.id}/draft`);
  await page.reload();
  expect((await refusedAgain).status()).toBe(409);
  await expect(notice).toBeVisible();
  await expect(field).toHaveValue(authored);
  expect(await detail(request, mine.id)).toMatchObject(mineBefore);

  // Edit name focuses the field; a name no other loop has saves under the same loop id.
  await notice.getByRole('button', { name: 'Edit name' }).click();
  await expect(field).toBeFocused();
  const fixed = uniqueLoopName('Weekly report renamed');
  const saved = answer(page, 'PUT', `/loops/${mine.id}/draft`);
  await field.fill(fixed);
  expect((await saved).status()).toBe(200);
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
  await expect(notice).toHaveCount(0);
  await expect(field).not.toHaveAttribute('aria-invalid');
  const after = await detail(request, mine.id);
  expect(after.loop).toMatchObject({ id: mine.id, name: fixed });
  expect(after.draft?.definition.nodes).toEqual(mineBefore.draft?.definition.nodes);
  expect(after.draft?.definition.edges).toEqual(mineBefore.draft?.definition.edges);
  expect(await detail(request, other.id)).toMatchObject(otherBefore);
});

test('Import retries the unchanged upload under an explicit name and keeps the graph', async ({
  page,
  request,
}) => {
  const original = await createLoop(request, uniqueLoopName('Imported report'));
  const exported = (await (
    await request.get(`/loops/${original.id}/export?draft=true`)
  ).json()) as {
    loop: { nodes: unknown[]; edges: unknown[] };
  };
  const before = await detail(request, original.id);
  await page.goto('/app/loops');
  const refused = answer(page, 'POST', '/loops/import');
  await page.getByLabel('Import an exported loop (JSON)').setInputFiles({
    name: 'report.graphgoblin.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(exported)),
  });
  expect((await refused).status()).toBe(409);
  const panel = page.getByRole('region', { name: 'Import under another name' });
  await expect(panel).toContainText('report.graphgoblin.json was not imported');
  const field = panel.getByRole('textbox', { name: 'Name for the imported loop' });
  await expect(field).toBeFocused();
  const suggested = await field.inputValue();
  expect(suggested).not.toBe('');
  expect(await detail(request, original.id)).toMatchObject(before);

  const imported = answer(page, 'POST', '/loops/import');
  await page.keyboard.press('Enter');
  const response = await imported;
  expect(response.status()).toBe(201);
  expect(new URL(response.url()).searchParams.get('name')).toBe(suggested);
  expect(response.request().postDataJSON()).toEqual(exported);
  const copy = (await response.json()) as Detail;
  expect(copy.loop.id).not.toBe(original.id);
  expect(copy.loop.name).toBe(suggested);
  expect(copy.draft?.definition.nodes).toEqual(exported.loop.nodes);
  expect(copy.draft?.definition.edges).toEqual(exported.loop.edges);
  await expect(page.getByText(`Imported "${suggested}".`)).toBeVisible();
  await expect(panel).toHaveCount(0);
  expect(await detail(request, original.id)).toMatchObject(before);
});

test('a stale draft is a draft conflict first; overwriting it then meets the name refusal', async ({
  context,
  request,
}) => {
  const otherName = uniqueLoopName('Stale target');
  await createLoop(request, otherName);
  const mine = await createLoop(request, uniqueLoopName('Stale source'));
  const a = await context.newPage();
  await openDraftTab(a, mine.id, mine.name);
  const b = await context.newPage();
  await openDraftTab(b, mine.id, mine.name);

  // Tab A saves first, so tab B's base is stale.
  await a.bringToFront();
  await showLoopPanel(a);
  const savedByA = answer(a, 'PUT', `/loops/${mine.id}/draft`);
  await a.getByLabel('Description').fill('from tab A');
  expect((await savedByA).status()).toBe(200);
  const afterA = await detail(request, mine.id);

  await b.bringToFront();
  await showLoopPanel(b);
  const stale = answer(b, 'PUT', `/loops/${mine.id}/draft`);
  await b.getByRole('textbox', { name: 'Name', exact: true }).fill(equivalent(otherName));
  const staleAnswer = await stale;
  expect(staleAnswer.status()).toBe(409);
  expect(await staleAnswer.json()).toMatchObject({ code: 'DRAFT_CONFLICT' });
  await expect(b.getByText('The draft changed on the server')).toBeVisible();
  await expect(b.getByText('Another loop already has this name')).toHaveCount(0);
  await expect(b.getByTestId('save-state')).toHaveText('Draft changed elsewhere');

  const overwrite = answer(b, 'PUT', `/loops/${mine.id}/draft`);
  await b.getByRole('button', { name: 'Overwrite with this copy' }).click();
  const named = await overwrite;
  expect(named.status()).toBe(409);
  expect(await named.json()).toMatchObject({ code: 'LOOP_NAME_CONFLICT' });
  await expect(b.getByText('Another loop already has this name')).toBeVisible();
  await expect(b.getByText('The draft changed on the server')).toHaveCount(0);
  expect(await detail(request, mine.id)).toMatchObject(afterA);
});

test('at 360 px the Create and Import name guidance reflows and works from the keyboard', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const base = uniqueLoopName('Narrow report');
  const original = await createLoop(request, base);
  await page.goto('/app/loops');
  const field = page.getByRole('textbox', { name: 'New loop name' });
  await field.focus();
  await page.keyboard.type(base.toLowerCase());
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText('letter case or spacing');
  await expect(field).toBeFocused();
  await noSidewaysScroll(page, 360);
  // Tab reaches Create, then the suggestion; Enter on it returns to the field with its text.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  const use = page.getByRole('button', { name: /^Use “/ });
  await expect(use).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(field).toBeFocused();
  await expect(page.getByRole('alert')).toHaveCount(0);

  const exported = await (await request.get(`/loops/${original.id}/export?draft=true`)).json();
  await page.getByLabel('Import an exported loop (JSON)').setInputFiles({
    name: 'narrow.graphgoblin.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(exported)),
  });
  const panel = page.getByRole('region', { name: 'Import under another name' });
  const name = panel.getByRole('textbox', { name: 'Name for the imported loop' });
  await expect(name).toBeFocused();
  await noSidewaysScroll(page, 360);
  for (const control of [name, panel.getByRole('button', { name: 'Import as new loop' })]) {
    const box = await control.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(360);
  }
  await page.keyboard.press('Tab');
  await expect(panel.getByRole('button', { name: 'Import as new loop' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(panel.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(panel).toHaveCount(0);
  await expect(page.getByLabel('Import an exported loop (JSON)')).toBeFocused();
});
