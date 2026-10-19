import { HarnessReadinessStateSchema } from '@graphgoblin/contracts';
import { readinessMessage } from '@graphgoblin/domain';
import { expect, test } from './fixtures.js';

const LABELS = {
  ready: 'Ready',
  unknown: 'Unknown',
  'cli-missing': 'CLI not found',
  'cli-incompatible': 'CLI update needed',
  auth: 'Sign-in needed',
  quota: 'Usage limit',
  transport: 'Connection failed',
} as const;

function claudeItem(state: keyof typeof LABELS) {
  return {
    harness: 'claude',
    state,
    ok: state === 'ready',
    authenticated: state === 'ready',
    problems: state === 'ready' ? [] : [readinessMessage('claude', state)],
    models: [{ model: 'claude-opus-5-5', efforts: ['high'] }],
  };
}

for (const state of HarnessReadinessStateSchema.options) {
  test(`Settings labels ${state} separately from model support`, async ({ page }) => {
    await page.route('**/harness/preflight', (route) =>
      route.fulfill({ json: { items: [claudeItem(state)] } }),
    );
    await page.goto('/app/settings');
    const region = page.getByRole('region', { name: 'Harness preflight' });
    const badge = region.locator(`[data-state="${state}"]`);
    await expect(badge).toHaveText(LABELS[state]);
    await expect(region.getByText('listed by adapter', { exact: true })).toBeVisible();
    await expect(region.getByText(/do not confirm account access/)).toBeVisible();
    await expect(region.getByText(/supported by adapter|model unavailable/)).toHaveCount(0);
    if (state !== 'ready')
      await expect(
        region.getByText(readinessMessage('claude', state), { exact: true }),
      ).toBeVisible();
  });
}

test('Settings keeps the last result while rechecking, shows a failed lookup once and retries', async ({
  page,
}) => {
  let hold: Promise<void> | undefined;
  let fail = false;
  let release!: () => void;
  await page.route('**/harness/preflight', async (route) => {
    if (hold) await hold;
    if (fail)
      await route.fulfill({
        status: 503,
        json: { code: 'TEMPORARY_FAILURE', detail: 'Synthetic lookup failure' },
      });
    else await route.fulfill({ json: { items: [claudeItem('auth')] } });
  });
  await page.goto('/app/settings');
  const region = page.getByRole('region', { name: 'Harness preflight' });
  const retry = region.getByRole('button', { name: 'Retry preflight' });
  await expect(region.locator('[data-state="auth"]')).toHaveText('Sign-in needed');

  hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await retry.click();
  await expect(retry).toBeDisabled();
  await expect(region.getByRole('status')).toHaveText('Rechecking…');
  // The last result stays; nothing flips to a checking badge or a duplicate paragraph.
  await expect(region.locator('[data-state="auth"]')).toHaveText('Sign-in needed');
  await expect(region.locator('[data-state="checking"]')).toHaveCount(0);
  await expect(
    region.getByText(/Checking harness readiness|Harness readiness unknown/),
  ).toHaveCount(0);
  fail = true;
  release();
  hold = undefined;
  await expect(region.getByText('Could not load preflight', { exact: true })).toBeVisible();
  await expect(region.locator('[data-state]')).toHaveCount(0);
  await expect(region.getByRole('status')).toHaveText('');
  await expect(retry).toBeEnabled();

  fail = false;
  await retry.click();
  await expect(region.locator('[data-state="auth"]')).toHaveText('Sign-in needed');
  await expect(region.getByText('Could not load preflight', { exact: true })).toHaveCount(0);
});

test('Settings shows the loading text during the first check', async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/harness/preflight', async (route) => {
    await pending;
    await route.fulfill({ json: { items: [claudeItem('ready')] } });
  });
  await page.goto('/app/settings');
  const region = page.getByRole('region', { name: 'Harness preflight' });
  await expect(region.getByText('Loading preflight…', { exact: true })).toBeVisible();
  await expect(region.getByRole('button', { name: 'Retry preflight' })).toBeDisabled();
  release();
  await expect(region.locator('[data-state="ready"]')).toHaveText('Ready');
});
