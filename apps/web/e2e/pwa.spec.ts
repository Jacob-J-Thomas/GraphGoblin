import { approvalLoop, expect, publishLoop, test } from './fixtures.js';

test('registers the service worker and asks before applying an update', async ({ page }) => {
  await page.goto('/app/');
  await expect(page.getByRole('heading', { name: 'Loops' })).toBeVisible();

  // The production build registers the worker for the /app/ scope.
  await expect
    .poll(() =>
      page.evaluate(
        async () => (await navigator.serviceWorker.getRegistration('/app/'))?.scope ?? null,
      ),
    )
    .toMatch(/\/app\/$/);

  // The manifest is installable: name, scope, and icons are served.
  const manifest = await page.request.get('/app/manifest.webmanifest');
  expect(manifest.ok()).toBe(true);
  const body = (await manifest.json()) as { scope: string; icons: { src: string }[] };
  expect(body.scope).toBe('/app/');
  for (const icon of body.icons)
    expect((await page.request.get(`/app/${icon.src}`)).ok()).toBe(true);

  // A new worker is waiting: the toast appears and nothing activates until the user confirms.
  await page.evaluate(() => window.graphgoblinPwa?.simulateUpdate());
  const toast = page.getByRole('status').filter({ hasText: 'A new version is available' });
  await expect(toast).toBeVisible();
  expect(await page.evaluate(() => window.graphgoblinPwa?.appliedUpdates)).toBe(0);
  await toast.getByRole('button', { name: 'Update' }).click();
  await expect(toast).toBeHidden();
  expect(await page.evaluate(() => window.graphgoblinPwa?.appliedUpdates)).toBe(1);
});

test('cold offline Loops reload recovers on reconnect without navigating', async ({
  page,
  context,
  request,
}) => {
  const name = 'cold offline reconnect';
  await publishLoop(request, approvalLoop(name));
  await page.goto('/app/loops');
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // The worker deliberately does not claim existing clients; the next navigation uses it.
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);

  await context.setOffline(true);
  try {
    await page.reload();
    const offline = page.getByText(/Loops needs the GraphGoblin API/);
    await expect(offline).toBeVisible();
    await expect(page.getByText('You are offline', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name, exact: true })).toBeHidden();

    const recovered = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/loops' && response.status() === 200,
      { timeout: 5_000 },
    );
    await context.setOffline(false);
    await recovered;
    await expect(page.getByRole('link', { name, exact: true })).toBeVisible({ timeout: 5_000 });
    await expect(offline).toBeHidden();
    await expect(page.getByText('You are offline', { exact: true })).toBeHidden();
    await expect(page).toHaveURL(/\/app\/loops$/);
  } finally {
    await context.setOffline(false);
  }
});
