import { control, expect, test } from './fixtures.js';

test('Events admits arrivals only on Refresh, preserves filters and pages again (#240)', async ({
  page,
  request,
}) => {
  const url = process.env['GG_E2E_CONTROL_URL']
    ? String((await control(request, '/apps'))['url'])
    : process.env['GG_E2E_BASE_URL'];
  if (!url) throw new Error('The Events browser setup did not provide a URL');
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
