import type { RunRecord, RunSnapshot } from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import type { APIRequestContext } from '@playwright/test';
import { approvalLoop, control, expect, publishLoop, test } from './fixtures.js';

async function snapshot(request: APIRequestContext, url: string, id: string): Promise<RunSnapshot> {
  const response = await request.get(`${url}/runs/${id}`);
  expect(response.status()).toBe(200);
  return response.json() as Promise<RunSnapshot>;
}
async function start(request: APIRequestContext, url: string, loopId: string, terminal = true) {
  const response = await request.post(`${url}/loops/${loopId}/runs`, { data: {} });
  expect(response.status()).toBe(202);
  const { run } = (await response.json()) as { run: RunRecord };
  await expect
    .poll(async () => {
      const current = await snapshot(request, url, run.id);
      return terminal ? Boolean(current.finalizedAt) : current.status === 'waiting';
    })
    .toBe(true);
  return run.id;
}

test('individual review cancels safely, confirms persisted consent, and withdraws it', async ({
  page,
  request,
}) => {
  const instance = await control(request, '/apps', { tempPrefix: 'gg-wp-e3-' });
  const url = String(instance['url']);
  const loopId = await publishLoop(request, { ...minimalLoop(), name: 'Individual history' }, url);
  const id = await start(request, url, loopId);
  await page.goto(`${url}/app/runs/${id}`);
  await page.getByRole('button', { name: 'Review delete-ready history' }).click();
  let dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(id);
  await expect(dialog).toContainText(
    'permanently remove this history and its owned, unshared workspaces and artifacts',
  );
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await snapshot(request, url, id)).deletionApproval).toBeUndefined();
  await page.getByRole('button', { name: 'Review delete-ready history' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Confirm delete-ready selection' }).click();
  await expect(dialog).toBeHidden();
  expect((await snapshot(request, url, id)).deletionApproval?.confirmedBy).toEqual({
    ownerId: 'local',
    kind: 'user',
    id: 'local',
  });
  await expect(page.getByText(/Delete-ready: confirmed by local/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Delete-ready: confirmed by local/)).toBeVisible();
  await page.getByRole('button', { name: 'Withdraw delete-ready mark' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm withdrawal' }).click();
  await expect(page.getByText('History retained.', { exact: true })).toBeVisible();
  expect((await snapshot(request, url, id)).deletionApproval).toBeUndefined();
});

test('bulk confirmation covers exactly the frozen selection; later history remains retained', async ({
  page,
  request,
}) => {
  const instance = await control(request, '/apps', { tempPrefix: 'gg-wp-e3-' });
  const url = String(instance['url']);
  const loopId = await publishLoop(request, { ...minimalLoop(), name: 'Bulk history' }, url);
  const ids = [await start(request, url, loopId), await start(request, url, loopId)];
  await page.goto(`${url}/app/runs?loop=${loopId}`);
  for (const id of ids) await page.getByRole('checkbox', { name: `Select history ${id}` }).check();
  await page.getByRole('button', { name: 'Review delete-ready history' }).click();
  const dialog = page.getByRole('dialog');
  for (const id of ids) await expect(dialog).toContainText(id);
  const fresh = await start(request, url, loopId);
  await expect(dialog).not.toContainText(fresh);
  await dialog.getByRole('button', { name: 'Confirm delete-ready selection' }).click();
  await expect(dialog).toBeHidden();
  for (const id of ids) expect((await snapshot(request, url, id)).deletionApproval).toBeDefined();
  expect((await snapshot(request, url, fresh)).deletionApproval).toBeUndefined();
  await expect(page.getByText('Delete-ready', { exact: true })).toHaveCount(2);
  const selection = page.getByText('0 selected', { exact: true });
  await expect(selection).toBeFocused();
  await expect(page.getByText('2 runs marked delete-ready.', { exact: true })).toHaveAttribute(
    'aria-live',
    'polite',
  );
  for (const id of ids) await page.getByRole('checkbox', { name: `Select history ${id}` }).check();
  await page.getByRole('button', { name: 'Withdraw delete-ready mark' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm withdrawal' }).click();
  await expect(dialog).toBeHidden();
  await expect(selection).toBeFocused();
  await expect(
    page.getByText('Deletion approval withdrawn for 2 runs.', { exact: true }),
  ).toHaveAttribute('aria-live', 'polite');
  for (const id of ids) expect((await snapshot(request, url, id)).deletionApproval).toBeUndefined();
});

test('protected history and a stale confirmation refuse visibly; invalid selections cannot approve a subset', async ({
  page,
  request,
}) => {
  const instance = await control(request, '/apps', { tempPrefix: 'gg-wp-e3-' });
  const url = String(instance['url']);
  const loopId = await publishLoop(request, { ...minimalLoop(), name: 'Stale history' }, url);
  const id = await start(request, url, loopId);
  await page.goto(`${url}/app/runs/${id}`);
  await page.getByRole('button', { name: 'Review delete-ready history' }).click();
  let dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('button', { name: 'Confirm delete-ready selection' }),
  ).toBeEnabled();
  const observedSeq = (await snapshot(request, url, id)).recovery.observedSeq;
  const replay = await request.post(`${url}/runs/${id}/replay`, {
    data: { nodeId: 'done', observedSeq },
  });
  expect(replay.status()).toBe(202);
  await dialog.getByRole('button', { name: 'Confirm delete-ready selection' }).click();
  await expect(dialog.getByRole('alert')).toContainText('DELETION_SELECTION_STALE');
  expect((await snapshot(request, url, id)).deletionApproval).toBeUndefined();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  const waitingLoop = await publishLoop(request, approvalLoop('Protected history'), url);
  const waiting = await start(request, url, waitingLoop, false);
  expect((await request.post(`${url}/runs/${waiting}/pause`)).status()).toBe(200);
  await page.goto(`${url}/app/runs/${waiting}`);
  await page.getByRole('button', { name: 'Review delete-ready history' }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Run is paused');
  await expect(
    dialog.getByRole('button', { name: 'Confirm delete-ready selection' }),
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  expect((await snapshot(request, url, waiting)).deletionApproval).toBeUndefined();
  for (const runIds of [[], [id, id], [id, 'invalid']]) {
    expect(
      (
        await request.post(`${url}/runs/deletion-eligibility/preview`, { data: { runIds } })
      ).status(),
    ).toBe(400);
  }
});
