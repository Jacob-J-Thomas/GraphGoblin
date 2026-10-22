import { readFile } from 'node:fs/promises';
import type { APIRequestContext, Page } from '@playwright/test';
import { approvalLoop, expect, test } from './fixtures.js';

/**
 * A device draft an older build left in this browser (#266, ADR-0042): the editor refuses it
 * clearly, never converts or saves it, and only an explicit discard of that one copy opens the
 * editor again.
 */

async function create(request: APIRequestContext, name: string) {
  const response = await request.post('/loops', { data: { definition: approvalLoop(name) } });
  expect(response.status()).toBe(201);
  return (await response.json()) as { loop: { id: string } };
}

/** Write a record as a format-3 build stored it, through IndexedDB itself. */
async function storeOldDraft(page: Page, loopId: string) {
  const record = {
    loopId,
    definition: {
      schemaVersion: 3,
      name: 'format 3 device work',
      nodes: [
        { id: 'start', kind: 'trigger', label: 'Start', config: { subtype: 'manual' } },
        { id: 'done', kind: 'exit', label: 'Done', config: {} },
      ],
      edges: [{ id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'done' } }],
    },
    savedAt: 'before the format-4 cutover',
    synced: false,
    baseToken: 'format-3-token',
  };
  await storeRecord(page, record);
  return record;
}

/** Put one raw record under its loop's active device-draft key. */
async function storeRecord(page: Page, record: { loopId: string }) {
  await page.evaluate(async (copy) => {
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
  }, record);
}

async function storedDraft(page: Page, loopId: string): Promise<unknown> {
  return page.evaluate(async (key) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('graphgoblin', 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
    });
    const value = await new Promise<unknown>((resolve, reject) => {
      const read = db.transaction('drafts').objectStore('drafts').get(key);
      read.onsuccess = () => resolve(read.result);
      read.onerror = () => reject(read.error ?? new Error('IndexedDB read failed'));
    });
    db.close();
    return value;
  }, loopId);
}

test('an older device draft is refused, never converted or saved, and discarded only on request', async ({
  page,
  request,
}) => {
  const { loop } = await create(request, 'server work');
  await page.goto('/app/loops');
  const record = await storeOldDraft(page, loop.id);
  let puts = 0;
  page.on('request', (r) => {
    if (r.method() === 'PUT' && r.url().endsWith(`/loops/${loop.id}/draft`)) puts += 1;
  });

  await page.goto(`/app/loops/${loop.id}/edit`);
  await expect(
    page.getByText('This browser holds a device draft this build cannot open'),
  ).toBeVisible();
  const notice = `This browser holds an unsaved draft of “format 3 device work” (loop ${loop.id}), saved before the format-4 cutover, in format 3. This build opens only format 4 drafts and does not convert older ones. Discarding removes only this copy from this browser; the loop on the server and drafts in other browsers stay as they are.`;
  await expect(page.getByText('Unsupported device draft (format 3)')).toBeVisible();
  const discard = page.getByRole('button', { name: 'Discard this device draft' });
  await expect(discard).toHaveAccessibleDescription(notice);
  await expect(page.getByRole('heading', { name: 'server work' })).toBeHidden();

  // Reloading keeps refusing: nothing was converted, saved or removed meanwhile.
  await page.reload();
  await expect(page.getByText('Unsupported device draft (format 3)')).toBeVisible();
  expect(await storedDraft(page, loop.id)).toEqual(record);
  expect(puts).toBe(0);

  await discard.click();
  await expect(page.getByRole('heading', { name: 'server work' })).toBeVisible();
  await expect(
    page.getByText('This browser holds a device draft this build cannot open'),
  ).toBeHidden();
  expect(await storedDraft(page, loop.id)).toBeUndefined();
  const server = (await (await request.get(`/loops/${loop.id}`)).json()) as {
    draft?: { definition: { name: string } };
  };
  expect(server.draft?.definition.name).toBe('server work');
});

for (const [kind, extra] of [
  ['no definition', {}],
  ['a null definition', { definition: null }],
] as const) {
  test(`a device record with ${kind} keeps export and discard instead of failing to render`, async ({
    page,
    request,
  }) => {
    const { loop } = await create(request, 'server work');
    await page.goto('/app/loops');
    const record = { loopId: loop.id, savedAt: 'long ago', synced: false, ...extra };
    await storeRecord(page, record);
    await page.goto(`/app/loops/${loop.id}/edit`);
    await expect(page.getByText('Unsupported device draft (an unknown format)')).toBeVisible();
    await expect(page.getByText('This screen failed to render')).toBeHidden();
    const downloadReady = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export this device draft' }).click();
    const path = await (await downloadReady).path();
    if (!path) throw new Error('Expected local download');
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(record);
    await page.getByRole('button', { name: 'Discard this device draft' }).click();
    await expect(page.getByRole('heading', { name: 'server work' })).toBeVisible();
    expect(await storedDraft(page, loop.id)).toBeUndefined();
  });
}
