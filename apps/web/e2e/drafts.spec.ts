/**
 * Draft edit conflicts (D26, docs/07 and docs/09): two tabs edit one loop. The draft save sends
 * `If-Match` with the token the tab loaded; a stale one answers 409 `DRAFT_CONFLICT`, and the
 * editor asks before reloading or overwriting.
 */
import type { APIRequestContext, Page } from '@playwright/test';
import { approvalLoop, expect, showLoopPanel, test } from './fixtures.js';

async function serverDescription(request: APIRequestContext, loopId: string) {
  const res = await request.get(`/loops/${loopId}`);
  const body = (await res.json()) as {
    draft?: { definition: { description?: string } };
    current?: { definition: { description?: string } };
  };
  return (body.draft ?? body.current)?.definition.description;
}

async function describeLoop(page: Page, text: string): Promise<void> {
  await showLoopPanel(page);
  await page.getByLabel('Description').fill(text);
}

test('two tabs editing one draft: the stale tab is asked to reload or overwrite', async ({
  context,
  request,
}) => {
  const created = await request.post('/loops', {
    data: { definition: approvalLoop('qa conflict') },
  });
  expect(created.status()).toBe(201);
  const loopId = ((await created.json()) as { loop: { id: string } }).loop.id;

  const a = await context.newPage();
  const b = await context.newPage();
  await a.goto(`/app/loops/${loopId}/edit`);
  await b.goto(`/app/loops/${loopId}/edit`);
  await expect(a.getByRole('heading', { name: 'qa conflict' })).toBeVisible();
  await expect(b.getByRole('heading', { name: 'qa conflict' })).toBeVisible();

  // Tab A saves first.
  await describeLoop(a, 'from tab A');
  await expect(a.getByTestId('save-state')).toHaveText('All changes saved');
  await expect.poll(() => serverDescription(request, loopId)).toBe('from tab A');

  // Tab B, still on the copy it loaded, is refused and asked; nothing is overwritten.
  await describeLoop(b, 'from tab B');
  await expect(b.getByText('The draft changed on the server')).toBeVisible();
  await expect(b.getByTestId('save-state')).toHaveText('Draft changed elsewhere');
  expect(await serverDescription(request, loopId)).toBe('from tab A');

  // Reload: tab B shows tab A's draft.
  await b.getByRole('button', { name: 'Reload server draft' }).click();
  await expect(b.getByText('The draft changed on the server')).toBeHidden();
  await showLoopPanel(b);
  await expect(b.getByLabel('Description')).toHaveValue('from tab A');

  // Tab A saves again; tab B edits again, conflicts, and overwrites this time.
  await describeLoop(a, 'tab A again');
  await expect.poll(() => serverDescription(request, loopId)).toBe('tab A again');
  await describeLoop(b, 'tab B wins');
  await expect(b.getByText('The draft changed on the server')).toBeVisible();
  await b.getByRole('button', { name: 'Overwrite with this copy' }).click();
  await expect(b.getByTestId('save-state')).toHaveText('All changes saved');
  await expect.poll(() => serverDescription(request, loopId)).toBe('tab B wins');

  // Tab A is now the stale one.
  await describeLoop(a, 'tab A late');
  await expect(a.getByText('The draft changed on the server')).toBeVisible();
  expect(await serverDescription(request, loopId)).toBe('tab B wins');
});
