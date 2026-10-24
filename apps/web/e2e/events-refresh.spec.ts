import { control, expect, test } from './fixtures.js';

test('Events admits arrivals only on Refresh, preserves filters and pages again (#240)', async ({
  page,
  request,
}) => {
  const url = String((await control(request, '/apps'))['url']);
  const send = async (type: string, index: number | string) => {
    expect(
      (await request.post(url + '/events', { data: { type, payload: { index } } })).status(),
    ).toBe(202);
  };
  for (let i = 0; i < 101; i++) await send('refresh-events', i);
  const path = '/app/events?type=refresh-events&before=2099-01-01T00%3A00%3A00.000Z';
  await page.goto(url + path);
  await expect(page.locator('tbody tr')).toHaveCount(100);
  const first = await page.locator('tbody tr').first().innerText();
  await send('refresh-events', 'first-arrival');
  await expect(page.getByText('New events available', { exact: true })).toBeVisible();
  expect(await page.locator('tbody tr').first().innerText()).toBe(first);
  await expect(page.getByText(/first-arrival/)).toHaveCount(0);
  const more = page.getByRole('button', { name: 'Load more', exact: true });
  await more.click();
  await expect(page.locator('tbody tr')).toHaveCount(101);
  const end = page.getByText('All events loaded.', { exact: true });
  await expect(end).toBeFocused();
  const readingY = await page.evaluate(() => window.scrollY);
  const olderRows = await page.locator('tbody').innerText();
  await send('other-type', 'excluded');
  await send('refresh-events', 'older-arrival');
  // Synchronize on an actual completed probe after the second arrival, not a fixed delay.
  await page.waitForResponse((response) => {
    const parsed = new URL(response.url());
    return parsed.pathname === '/events' && parsed.searchParams.get('limit') === '1';
  });
  expect(await page.locator('tbody').innerText()).toBe(olderRows);
  await expect(end).toBeFocused();
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - readingY)).toBeLessThanOrEqual(1);
  await expect(page).toHaveURL(url + path);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(100);
  await expect(page.locator('tbody tr').first()).toContainText('older-arrival');
  await expect(page.getByText('New events available', { exact: true })).toHaveCount(0);
  await expect(page.getByText('other-type', { exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(url + path);
  await more.click();
  await expect(page.locator('tbody tr')).toHaveCount(103);
  await expect(end).toBeFocused();
  const payloads = await page.locator('tbody tr td:last-child pre').allTextContents();
  expect(new Set(payloads).size).toBe(103);
  await page.goto(url + '/app/events?type=empty-refresh-filter');
  await expect(page.getByText('No inbound events match these filters.')).toBeVisible();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByText('No inbound events match these filters.')).toBeVisible();
});

test('Events keeps an offline Refresh snapshot, recovers deliberately and clears filters with the keyboard (#240)', async ({
  page,
  request,
}) => {
  const instance = await control(request, '/apps');
  const url = String(instance['url']);
  const instanceId = String(instance['instanceId']);
  const send = async (type: string, index: number | string) => {
    expect(
      (await request.post(url + '/events', { data: { type, payload: { index } } })).status(),
    ).toBe(202);
  };
  // Bound concurrent setup requests, avoiding 201 serial HTTP round trips under host load.
  for (let start = 0; start < 201; start += 20) {
    await Promise.all(
      Array.from({ length: Math.min(20, 201 - start) }, (_, offset) =>
        send('refresh-outage', start + offset),
      ),
    );
  }
  await send('other-type', 'excluded');
  const before = '2099-01-01T00:00:00.000Z';
  const filters = `type=refresh-outage&before=${encodeURIComponent(before)}`;
  const path = `/app/events?${filters}&keep=reader`;
  await page.goto(url + path);
  await expect(page.locator('tbody tr')).toHaveCount(100);
  await page.getByRole('button', { name: 'Load more', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(200);
  await send('refresh-outage', 'notice-before-outage');
  await expect(page.getByText('New events available', { exact: true })).toBeVisible();
  const oldRows = await page.locator('tbody').innerText();
  const anchor = page.locator('tbody tr').nth(140);
  const refresh = page.getByRole('button', { name: 'Refresh', exact: true });
  try {
    // Stop this isolated API's real HTTP listener; the control server stays available.
    await control(request, '/api/listener', { instanceId, listening: false });
    const status = page.getByRole('status').filter({ hasText: 'New events available' });
    await expect(status).toContainText('Could not check for new events');
    await anchor.scrollIntoViewIfNeeded();
    const oldBox = await anchor.boundingBox();
    if (!oldBox) throw new Error('The loaded reading anchor is not visible');
    await refresh.evaluate((element) => element.focus({ preventScroll: true }));
    await page.keyboard.press('Enter');
    await expect(status).toContainText('Refresh failed');
    await expect(status).toContainText('Refresh to try again.');
    await expect(page.locator('tbody tr')).toHaveCount(200);
    expect(await page.locator('tbody').innerText()).toBe(oldRows);
    await expect(page).toHaveURL(url + path);
    const failedBox = await anchor.boundingBox();
    if (!failedBox) throw new Error('The failed Refresh removed the reading anchor');
    expect(Math.abs(failedBox.y - oldBox.y)).toBeLessThanOrEqual(1);
  } finally {
    await control(request, '/api/listener', { instanceId, listening: true });
  }
  await send('refresh-outage', 'after-outage');
  const status = page.getByRole('status').filter({ hasText: 'New events available' });
  await expect(status).not.toContainText('Could not check for new events');
  expect(await page.locator('tbody').innerText()).toBe(oldRows);
  await refresh.click();
  await expect(page.locator('tbody tr')).toHaveCount(100);
  await expect(page.locator('tbody tr').first()).toContainText('after-outage');
  await expect(page.getByText('Showing the newest events.', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(url + path);
  const first = (await (await request.get(`${url}/events?${filters}`)).json()) as {
    items: { id: string }[];
    nextCursor: string;
  };
  const second = (await (
    await request.get(`${url}/events?${filters}&cursor=${encodeURIComponent(first.nextCursor)}`)
  ).json()) as { items: { id: string }[] };
  await page.getByRole('button', { name: 'Load more', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(200);
  const loaded = await page
    .locator('tbody [data-testid^="payload-"]')
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-testid')?.slice('payload-'.length)),
    );
  expect(loaded).toEqual([...first.items, ...second.items].map((event) => event.id));
  expect(new Set(loaded).size).toBe(200);
  await refresh.focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Clear type filter', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(
    `${url}/app/events?before=${encodeURIComponent(before)}&keep=reader`,
  );
  await expect(refresh).toBeFocused();
  await expect(page.getByText('other-type', { exact: true })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: 'Clear before filter', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`${url}/app/events?keep=reader`);
  await expect(refresh).toBeFocused();
});
