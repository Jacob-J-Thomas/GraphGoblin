import type { APIRequestContext, Page } from '@playwright/test';
import { approvalLoop, expect, showLoopPanel, test } from './fixtures.js';

async function create(request: APIRequestContext, name: string) {
  const response = await request.post('/loops', { data: { definition: approvalLoop(name) } });
  expect(response.status()).toBe(201);
  return (await response.json()) as { loop: { id: string }; draftToken: string };
}

async function seed(page: Page, loopId: string, name: string, baseToken: string, synced = false) {
  await page.evaluate(
    async (copy) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('graphgoblin', 2);
        request.onupgradeneeded = () => request.result.createObjectStore('drafts');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
      });
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('drafts', 'readwrite');
        transaction.objectStore('drafts').put(copy, copy.loopId);
        transaction.oncomplete = () => resolve();
        transaction.onabort = transaction.onerror = () =>
          reject(transaction.error ?? new Error('IndexedDB transaction failed'));
      });
      db.close();
    },
    {
      loopId,
      definition: approvalLoop(name),
      savedAt: '2999-01-01T00:00:00.000Z',
      synced,
      baseToken,
    },
  );
}

async function token(request: APIRequestContext, id: string) {
  return ((await (await request.get(`/loops/${id}`)).json()) as { draftToken: string }).draftToken;
}

function gate() {
  let release = () => {};
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, release };
}

for (const synced of [false, true]) {
  test(`slow server renders device work before its answer (synced=${synced})`, async ({
    page,
    request,
  }) => {
    const { loop } = await create(request, 'slow server');
    await page.goto('/app/loops');
    await seed(page, loop.id, 'immediate device', await token(request, loop.id), synced);
    const server = gate();
    let answered = false;
    let puts = 0;
    await page.route(`**/loops/${loop.id}`, async (route) => {
      await server.wait;
      answered = true;
      await route.continue();
    });
    page.on('request', (r) => {
      if (r.method() === 'PUT' && r.url().endsWith(`/loops/${loop.id}/draft`)) puts += 1;
    });
    await page.goto(`/app/loops/${loop.id}/edit`);
    await expect(page.getByRole('heading', { name: 'immediate device' })).toBeVisible();
    expect(answered).toBe(false);
    expect(puts).toBe(0);
    server.release();
    if (synced) await expect(page.getByRole('heading', { name: 'slow server' })).toBeVisible();
    else await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
    await expect(page.getByText('The draft changed on the server', { exact: true })).toBeHidden();
  });
}

test('warm navigation keeps the latest copy for each of two loops while reads are slow', async ({
  page,
  request,
}) => {
  const a = await create(request, 'warm A');
  const b = await create(request, 'warm B');
  await page.goto(`/app/loops/${a.loop.id}/edit`);
  await showLoopPanel(page);
  // Invalid drafts cannot be flushed to the server when navigating away.
  await page.getByRole('button', { name: 'Add Subloop node' }).click();
  await page.getByLabel('Description').fill('latest A');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Loops', exact: true })
    .click();
  await page.getByRole('link', { name: 'warm B', exact: true }).click();
  await showLoopPanel(page);
  await page.getByRole('button', { name: 'Add Subloop node' }).click();
  await page.getByLabel('Description').fill('latest B');
  const server = gate();
  await page.route(`**/loops/${a.loop.id}`, async (route) => {
    await server.wait;
    await route.continue();
  });
  await page.route(`**/loops/${b.loop.id}`, async (route) => {
    await server.wait;
    await route.continue();
  });
  for (const [name, description] of [
    ['warm A', 'latest A'],
    ['warm B', 'latest B'],
  ] as const) {
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Loops', exact: true })
      .click();
    await page.getByRole('link', { name, exact: true }).click();
    await showLoopPanel(page);
    await expect(page.getByLabel('Description')).toHaveValue(description);
    await expect(page.locator('.react-flow__node[data-id="subloop"]')).toBeVisible();
  }
  server.release();
});

test('a late newer server response preserves new edits and asks before overwriting', async ({
  page,
  request,
}) => {
  const { loop } = await create(request, 'late server');
  await page.goto('/app/loops');
  await seed(page, loop.id, 'device edit', 'old-token');
  const server = gate();
  await page.route(`**/loops/${loop.id}`, async (route) => {
    await server.wait;
    await route.continue();
  });
  await page.goto(`/app/loops/${loop.id}/edit`);
  await showLoopPanel(page);
  await page.getByLabel('Description').fill('typed before server answered');
  server.release();
  await expect(page.getByText('The draft changed on the server', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Description')).toHaveValue('typed before server answered');
  expect(
    (
      (await (await request.get(`/loops/${loop.id}`)).json()) as {
        draft: { definition: { description?: string } };
      }
    ).draft.definition.description,
  ).toBeUndefined();
  await page.getByRole('button', { name: 'Overwrite with this copy' }).click();
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
  await expect(page.getByLabel('Description')).toHaveValue('typed before server answered');
});

test('offline API reload restores device work; recovery saves only after reconciliation', async ({
  page,
  request,
}) => {
  const { loop } = await create(request, 'offline server');
  await page.goto('/app/loops');
  await seed(page, loop.id, 'offline device', await token(request, loop.id));
  await page.route(`**/loops/${loop.id}`, (route) => route.abort());
  await page.route(`**/loops/${loop.id}/draft`, (route) => route.abort());
  await page.goto(`/app/loops/${loop.id}/edit`);
  await showLoopPanel(page);
  await page.getByLabel('Description').fill('offline edit');
  await expect(page.getByTestId('save-state')).toHaveText('Offline: saved on this device');
  await page.reload();
  await showLoopPanel(page);
  await expect(page.getByLabel('Description')).toHaveValue('offline edit');
  await page.unroute(`**/loops/${loop.id}`);
  await page.unroute(`**/loops/${loop.id}/draft`);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
  await expect(page.getByText('The draft changed on the server', { exact: true })).toBeHidden();
});
