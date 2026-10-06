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

  // Let each tab finish foreground initialization before opening the next one.
  const a = await context.newPage();
  await a.goto(`/app/loops/${loopId}/edit`);
  await expect(a.getByRole('heading', { name: 'qa conflict' })).toBeVisible();
  const b = await context.newPage();
  await b.goto(`/app/loops/${loopId}/edit`);
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

test('a restored-draft notice stays dismissed through edits and returns after a restoring reload', async ({
  page,
  request,
}) => {
  const created = await request.post('/loops', {
    data: { definition: approvalLoop('server copy') },
  });
  expect(created.status()).toBe(201);
  const { loop } = (await created.json()) as { loop: { id: string } };
  const localDefinition = approvalLoop('older local copy');
  await page.goto('/app/loops');

  // Seed an older unsynced browser copy so the editor offers it separately from the server draft.
  await page.evaluate(
    async ({ loopId, definition }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        // Version 2 is the app's current store version; an older version would be retired on load.
        const request = indexedDB.open('graphgoblin', 2);
        request.onupgradeneeded = () => request.result.createObjectStore('drafts');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
      });
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('drafts', 'readwrite');
        transaction.objectStore('drafts').put(
          {
            loopId,
            definition,
            savedAt: '2000-01-01T00:00:00.000Z',
            synced: false,
          },
          loopId,
        );
        transaction.oncomplete = () => resolve();
        transaction.onerror = () =>
          reject(transaction.error ?? new Error('IndexedDB write failed'));
        transaction.onabort = () =>
          reject(transaction.error ?? new Error('IndexedDB write aborted'));
      });
      db.close();
    },
    { loopId: loop.id, definition: localDefinition },
  );

  // Keep the accepted local copy unsynced so the reload below exercises restoration again.
  await page.route(`**/loops/${loop.id}/draft`, (route) =>
    route.request().method() === 'PUT' ? route.abort() : route.continue(),
  );
  await page.goto(`/app/loops/${loop.id}/edit`);
  await expect(page.getByRole('heading', { name: 'server copy' })).toBeVisible();
  await page.getByRole('button', { name: "Use this device's copy instead" }).click();
  await expect(page.getByRole('heading', { name: 'older local copy' })).toBeVisible();
  const restoredNotice = page.getByText('Restored unsaved changes from this device.');
  await expect(restoredNotice).toBeVisible();
  await expect(page.getByTestId('save-state')).toHaveText('Offline: saved on this device');

  const dismissButtons = page.getByRole('button', { name: 'Dismiss notice' });
  await dismissButtons.nth(0).click();
  await expect(restoredNotice).toBeHidden();
  await expect(page.getByText('Notice dismissed')).toBeAttached();
  await expect(dismissButtons).toHaveCount(1);
  await expect(dismissButtons).toBeFocused();
  await dismissButtons.click();
  await expect(page.getByTestId('save-state')).toBeFocused();
  await expect(page.getByTestId('save-state')).toHaveAttribute('tabindex', '-1');

  await showLoopPanel(page);
  await page.getByLabel('Description').fill('edited while the restore notice is dismissed');
  await expect(restoredNotice).toBeHidden();
  await expect(page.getByTestId('save-state')).toHaveText('Offline: saved on this device');
  await expect(
    page.getByText('Offline: the draft is kept on this device and saved when the API is back.'),
  ).toBeHidden();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'older local copy' })).toBeVisible();
  await expect(page.getByText('Restored unsaved changes from this device.')).toBeVisible();
});

test('an older version’s open connection blocks device drafts: the editor says so until it closes (review F2)', async ({
  context,
  request,
}) => {
  const created = await request.post('/loops', {
    data: { definition: approvalLoop('qa blocked storage') },
  });
  expect(created.status()).toBe(201);
  const loopId = ((await created.json()) as { loop: { id: string } }).loop.id;

  // A tab of the previous version: its version 1 connection stays open and ignores
  // `versionchange`, so this version's store upgrade waits for it.
  const older = await context.newPage();
  await older.goto('/app/loops');
  await older.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('graphgoblin', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('drafts');
        request.onsuccess = () => {
          (window as unknown as { olderTab: IDBDatabase }).olderTab = request.result;
          resolve();
        };
        request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
      }),
  );

  const page = await context.newPage();
  await page.goto(`/app/loops/${loopId}/edit`);
  await expect(page.getByRole('heading', { name: 'qa blocked storage' })).toBeVisible();
  await expect(page.getByText('Changes are not kept on this device')).toBeVisible();
  await expect(page.getByText(/Close other GraphGoblin tabs and windows\./)).toBeVisible();

  // A schema-invalid edit (a subloop without its loop) cannot go to the server, and the device
  // refuses it: the editor says it is in this window only.
  await page.getByRole('button', { name: 'Add Subloop node' }).click();
  await expect(page.getByTestId('save-state')).toHaveText('Kept in this window only');
  await expect(
    page.getByText(
      'Fix the schema errors to save to the server. Changes are kept in this window only.',
    ),
  ).toBeVisible();

  // The older tab closes its connection: the upgrade completes, and the edit is on the device.
  await older.evaluate(() => (window as unknown as { olderTab: IDBDatabase }).olderTab.close());
  await expect(page.getByText('Changes are not kept on this device')).toBeHidden();
  await expect(page.getByTestId('save-state')).toHaveText('Saved on this device only');
  await page.reload();
  await expect(page.getByText('Restored unsaved changes from this device.')).toBeVisible();
  await expect(page.locator('.react-flow__node[data-id="subloop"]')).toBeVisible();
});
