import { HarnessReadinessStateSchema } from '@graphgoblin/contracts';
import { readinessMessage } from '@graphgoblin/domain';
import { expect, test } from './fixtures.js';

for (const state of HarnessReadinessStateSchema.options) {
  test(`Settings reports ${state} separately from model support`, async ({ page }) => {
    await page.route('**/harness/preflight', (route) =>
      route.fulfill({
        json: {
          items: [
            {
              harness: 'claude',
              state,
              ok: state === 'ready',
              authenticated: state === 'ready',
              problems: state === 'ready' ? [] : [readinessMessage('claude', state)],
              models: [{ model: 'claude-opus-5-5', efforts: ['high'] }],
            },
          ],
        },
      }),
    );
    await page.goto('/app/settings');
    const region = page.getByRole('region', { name: 'Harness preflight' });
    await expect(region.getByText(state, { exact: true })).toBeVisible();
    await expect(region.getByText('listed by adapter', { exact: true })).toBeVisible();
    await expect(region.getByText(/do not confirm account access/)).toBeVisible();
    await expect(region.getByText(/supported by adapter|model unavailable/)).toHaveCount(0);
    if (state !== 'ready')
      await expect(
        region.getByText(readinessMessage('claude', state), { exact: true }),
      ).toBeVisible();
  });
}

test('Settings shows checking during a pending lookup and unknown after failure', async ({
  page,
}) => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route('**/harness/preflight', async (route) => {
    await pending;
    await route.fulfill({
      status: 503,
      json: { code: 'TEMPORARY_FAILURE', message: 'Synthetic lookup failure' },
    });
  });
  await page.goto('/app/settings');
  const region = page.getByRole('region', { name: 'Harness preflight' });
  await expect(region.getByText('Checking harness readiness.', { exact: true })).toBeVisible();
  finish();
  await expect(
    region.getByText('Harness readiness unknown. Retry preflight.', { exact: true }),
  ).toBeVisible();
  await expect(region.getByText('ready', { exact: true })).toHaveCount(0);
});
