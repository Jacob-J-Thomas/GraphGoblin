import { expect, test } from './fixtures.js';

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
