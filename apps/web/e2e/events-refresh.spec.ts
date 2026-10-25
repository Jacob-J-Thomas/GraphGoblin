import { control, expect, publishEventLoop, test } from './fixtures.js';

async function seedEvents(
  send: Awaited<ReturnType<typeof publishEventLoop>>,
  type: string,
  count: number,
) {
  for (let start = 0; start < count; start += 20)
    await Promise.all(
      Array.from({ length: Math.min(20, count - start) }, (_, offset) =>
        send(type, { index: start + offset }),
      ),
    );
}

test('Events admits arrivals only on Refresh, preserves filters and pages again (#240)', async ({
  page,
  request,
}) => {
  const url = String((await control(request, '/apps'))['url']);
  const send = await publishEventLoop(request, ['refresh-events', 'other-type'], url);
  for (let i = 0; i < 101; i++) await send('refresh-events', { index: i });
  const path = '/app/events?type=refresh-events&before=2099-01-01T00%3A00%3A00.000Z';
  await page.goto(url + path);
  await expect(page.locator('tbody tr')).toHaveCount(100);
  // Delivery state and run links may change while the loaded Event membership stays fixed.
  const payloadRows = page.locator('[data-testid^="payload-"]');
  const first = await payloadRows.first().textContent();
  await send('refresh-events', { index: 'first-arrival' });
  await expect(page.getByText('New events available', { exact: true })).toBeVisible();
  expect(await payloadRows.first().textContent()).toBe(first);
  await expect(page.getByText(/first-arrival/)).toHaveCount(0);
  const more = page.getByRole('button', { name: 'Load more', exact: true });
  await more.click();
  await expect(page.locator('tbody tr')).toHaveCount(101);
  const end = page.getByText('All events loaded.', { exact: true });
  await expect(end).toBeFocused();
  const readingY = await page.evaluate(() => window.scrollY);
  const olderRows = await payloadRows.allTextContents();
  await send('other-type', { index: 'excluded' });
  await send('refresh-events', { index: 'older-arrival' });
  // Synchronize on an actual completed probe after the second arrival, not a fixed delay.
  await page.waitForResponse((response) => {
    const parsed = new URL(response.url());
    return parsed.pathname === '/events' && parsed.searchParams.get('limit') === '1';
  });
  expect(await payloadRows.allTextContents()).toEqual(olderRows);
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
  const send = await publishEventLoop(request, ['refresh-outage', 'other-type'], url);
  // Bound concurrent setup requests, avoiding 201 serial HTTP round trips under host load.
  for (let start = 0; start < 201; start += 20) {
    await Promise.all(
      Array.from({ length: Math.min(20, 201 - start) }, (_, offset) =>
        send('refresh-outage', { index: start + offset }),
      ),
    );
  }
  await send('other-type', { index: 'excluded' });
  const before = '2099-01-01T00:00:00.000Z';
  const filters = `type=refresh-outage&before=${encodeURIComponent(before)}`;
  const path = `/app/events?${filters}&keep=reader`;
  await page.goto(url + path);
  await expect(page.locator('tbody tr')).toHaveCount(100);
  await page.getByRole('button', { name: 'Load more', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(200);
  await send('refresh-outage', { index: 'notice-before-outage' });
  await expect(page.getByText('New events available', { exact: true })).toBeVisible();
  const payloadRows = page.locator('[data-testid^="payload-"]');
  const oldRows = await payloadRows.allTextContents();
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
    expect(await payloadRows.allTextContents()).toEqual(oldRows);
    await expect(page).toHaveURL(url + path);
    const failedBox = await anchor.boundingBox();
    if (!failedBox) throw new Error('The failed Refresh removed the reading anchor');
    expect(Math.abs(failedBox.y - oldBox.y)).toBeLessThanOrEqual(1);
  } finally {
    await control(request, '/api/listener', { instanceId, listening: true });
  }
  await send('refresh-outage', { index: 'after-outage' });
  const status = page.getByRole('status').filter({ hasText: 'New events available' });
  await expect(status).not.toContainText('Could not check for new events');
  expect(await payloadRows.allTextContents()).toEqual(oldRows);
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

test('Events drops an obsolete Refresh after clearing the filter, Back, a newer Refresh and paging (#240)', async ({
  page,
  request,
}) => {
  const url = String((await control(request, '/apps'))['url']);
  const send = await publishEventLoop(request, ['refresh-race'], url);
  await seedEvents(send, 'refresh-race', 201);
  const path = '/app/events?type=refresh-race&before=2099-01-01T00%3A00%3A00.000Z&keep=reader';
  await page.goto(url + path);
  const more = page.getByRole('button', { name: 'Load more', exact: true });
  const refresh = page.getByRole('button', { name: 'Refresh', exact: true });
  await more.click();
  await expect(page.locator('tbody tr')).toHaveCount(200);
  let unblock = () => {};
  let captured = () => {};
  let delivered = () => {};
  const latch = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  const held = new Promise<void>((resolve) => {
    captured = resolve;
  });
  const delivery = new Promise<void>((resolve) => {
    delivered = resolve;
  });
  let hold = true;
  await page.route('**/events?**', async (route) => {
    const parsed = new URL(route.request().url());
    const query = parsed.searchParams;
    if (
      parsed.pathname !== '/events' ||
      !hold ||
      query.get('type') !== 'refresh-race' ||
      query.has('cursor') ||
      query.has('limit') ||
      query.has('anchor')
    ) {
      await route.continue();
      return;
    }
    hold = false;
    const response = await route.fetch();
    captured();
    await latch;
    try {
      await route.fulfill({ response });
    } finally {
      delivered();
    }
  });
  try {
    await refresh.click();
    await held;
    await page.getByRole('button', { name: 'Clear type filter', exact: true }).click();
    await expect(refresh).toHaveAttribute('aria-busy', 'false');
    await page.goBack();
    await expect(page).toHaveURL(url + path);
    await send('refresh-race', { index: 'winning-refresh' });
    await refresh.click();
    await expect(page.locator('tbody tr').first()).toContainText('winning-refresh');
    await more.click();
    await expect(page.locator('tbody tr')).toHaveCount(200);
    const payloadRows = page.locator('[data-testid^="payload-"]');
    const snapshot = await payloadRows.allTextContents();
    const response = page.waitForResponse((result) => {
      const query = new URL(result.url()).searchParams;
      return (
        query.get('type') === 'refresh-race' &&
        !query.has('cursor') &&
        !query.has('limit') &&
        !query.has('anchor')
      );
    });
    unblock();
    await delivery;
    await (await response).finished();
    // Synchronize with response consumption and painting, without a timing sleep.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(page.locator('tbody tr')).toHaveCount(200);
    expect(await payloadRows.allTextContents()).toEqual(snapshot);
    await expect(page.getByText('Showing the newest events.', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(url + path);
  } finally {
    unblock();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('Events updates the hundredth pending receipt after a head arrival without Refresh (#240)', async ({
  page,
  request,
}) => {
  const url = String((await control(request, '/apps'))['url']);
  const send = await publishEventLoop(request, ['receipt-boundary'], url);
  await seedEvents(send, 'receipt-boundary', 101);
  const first = (await (await request.get(url + '/events?type=receipt-boundary')).json()) as {
    items: { id: string }[];
  };
  const receiptId = first.items[99]!.id;
  let admitted = false;
  // A valid response fixture controls UI delivery state; admission itself is not simulated evidence.
  await page.route('**/events?**', async (route) => {
    const parsed = new URL(route.request().url());
    if (parsed.pathname !== '/events' || parsed.searchParams.get('type') !== 'receipt-boundary') {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const body = (await response.json()) as {
      items: { id: string; runIds: string[]; delivery?: { state: string; attempts: number } }[];
      nextCursor: string | null;
    };
    body.items = body.items.map((item) =>
      item.id === receiptId
        ? {
            ...item, // Retain the real admissionId, frozen target and other Event fields.
            runIds: admitted ? item.runIds : [],
            delivery: { state: admitted ? 'admitted' : 'pending', attempts: 0 },
          }
        : item,
    );
    await route.fulfill({ response, json: body });
  });
  await page.goto(url + '/app/events?type=receipt-boundary');
  const receipt = page.getByRole('row').filter({ has: page.getByTestId(`payload-${receiptId}`) });
  await expect(receipt.getByText('Pending admission', { exact: true })).toBeVisible();
  const ids = () =>
    page
      .locator('[data-testid^="payload-"]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')));
  const before = await ids();
  await send('receipt-boundary', { index: 'new-arrival' });
  admitted = true;
  await expect(receipt.getByText('Admitted', { exact: true })).toBeVisible();
  expect(await ids()).toEqual(before);
  await expect(page.getByText('New events available', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Load more', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(101);
  expect(new Set(await ids()).size).toBe(101);
  await page.unrouteAll({ behavior: 'wait' });
});
