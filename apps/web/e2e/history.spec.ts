import { minimalLoop } from '@graphgoblin/contracts/testing';
import { control, expect, publishLoop, test } from './fixtures.js';

test('Runs appends a second page and preserves loop, status and parent filters', async ({
  page,
  request,
}) => {
  const loopId = await publishLoop(request, { ...minimalLoop(), name: 'paging runs' });
  const ids: string[] = [];
  for (let i = 0; i < 101; i++) {
    const response = await request.post(`/loops/${loopId}/runs`, { data: {} });
    expect(response.status()).toBe(202);
    ids.push(((await response.json()) as { run: { id: string } }).run.id);
  }
  await expect
    .poll(
      async () =>
        (
          (await (
            await request.get(`/runs?loopId=${loopId}&status=succeeded&limit=500`)
          ).json()) as { items: unknown[] }
        ).items.length,
    )
    .toBe(101);
  await page.goto(`/app/runs?loop=${loopId}&status=succeeded&parent=none`);
  await expect(page.locator('tbody tr')).toHaveCount(100);
  const first = page.locator('tbody tr').first();
  const firstText = await first.innerText();
  const more = page.getByRole('button', { name: 'Load more' });
  await expect(more).toBeVisible();
  await more.scrollIntoViewIfNeeded();
  const readingY = await page.evaluate(() => window.scrollY);
  await more.click();
  await expect(page.locator('tbody tr')).toHaveCount(101);
  expect(await first.innerText()).toBe(firstText);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(readingY - 1);
  await expect(more).toBeHidden();
  const links = await page.locator('tbody tr td:first-child a').allTextContents();
  expect(new Set(links)).toEqual(new Set(ids));
  await expect(page.getByLabel('Loop')).toHaveValue(loopId);
  await expect(page.getByLabel('Status')).toHaveValue('succeeded');
  await expect(page.getByLabel('Parent')).toHaveValue('none');
});

test('Events appends beyond the first page with its type filter and reading position intact', async ({
  page,
  request,
}) => {
  for (let i = 0; i < 101; i++) {
    expect(
      (
        await request.post('/events', { data: { type: 'paging-events', payload: { index: i } } })
      ).status(),
    ).toBe(202);
  }
  await request.post('/events', { data: { type: 'unrelated-event' } });
  await page.goto('/app/events?type=paging-events');
  await expect(page.locator('tbody tr')).toHaveCount(100);
  const firstText = await page.locator('tbody tr').first().innerText();
  const more = page.getByRole('button', { name: 'Load more' });
  await expect(more).toBeVisible();
  await more.scrollIntoViewIfNeeded();
  const readingY = await page.evaluate(() => window.scrollY);
  await more.click();
  await expect(page.locator('tbody tr')).toHaveCount(101);
  expect(await page.locator('tbody tr').first().innerText()).toBe(firstText);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(readingY - 1);
  await expect(more).toBeHidden();
  await expect(page.getByText('unrelated-event', { exact: true })).toHaveCount(0);
});

test('Loops shows older history beyond 500 unrelated runs and a genuine never-run control', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const oldId = await publishLoop(request, { ...minimalLoop(), name: 'older history' });
  const oldResponse = await request.post(`/loops/${oldId}/runs`, { data: {} });
  const old = ((await oldResponse.json()) as { run: { id: string } }).run;
  await publishLoop(request, { ...minimalLoop(), name: 'no history' });
  await control(request, '/clock/advance', { milliseconds: 1 });
  const busyId = await publishLoop(request, { ...minimalLoop(), name: 'busy history' });
  for (let i = 0; i < 501; i++) {
    expect((await request.post(`/loops/${busyId}/runs`, { data: {} })).status()).toBe(202);
  }
  await page.goto('/app/loops');
  const row = page
    .getByRole('row')
    .filter({ has: page.getByRole('link', { name: 'older history', exact: true }) });
  await expect(row.getByRole('link', { name: 'succeeded', exact: true })).toHaveAttribute(
    'href',
    `/app/runs/${old.id}`,
  );
  const empty = page
    .getByRole('row')
    .filter({ has: page.getByRole('link', { name: 'no history', exact: true }) });
  await expect(empty).toContainText('never run');
  await page.getByRole('button', { name: 'Delete busy history', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('all its runs (501)');
  await page.getByRole('button', { name: 'Keep', exact: true }).click();
});
