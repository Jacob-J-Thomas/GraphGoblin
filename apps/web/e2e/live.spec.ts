/**
 * One real Codex turn driven entirely through the UI. Costs subscription quota, so it runs only
 * with LIVE=1 (`LIVE=1 pnpm --filter @graphgoblin/web test:e2e -- e2e/live.spec.ts`); otherwise
 * it is skipped. Model gpt-6-luna, effort low, read-only sandbox, a temporary working directory.
 */
import { expect, test } from './fixtures.js';

test.skip(process.env['LIVE'] !== '1', 'live Codex check: set LIVE=1');

test('LIVE: build, publish, and run an inference loop against Codex from the UI', async ({
  browser,
  request,
}) => {
  test.setTimeout(300_000);
  const res = await request.post(`${process.env['GG_E2E_CONTROL_URL'] ?? ''}/apps/live`, {
    data: {},
    timeout: 60_000,
  });
  expect(res.ok()).toBe(true);
  const { url } = (await res.json()) as { url: string };
  const context = await browser.newContext({ baseURL: url, serviceWorkers: 'block' });
  const page = await context.newPage();

  await page.goto('/app/loops');
  await page.getByLabel('New loop name').fill('live ok');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: 'live ok' })).toBeVisible();

  await page.getByRole('button', { name: 'Add Inference node' }).click();
  const props = page.getByRole('region', { name: 'Node properties' });
  const prompt = props.locator('[data-field="prompt.template"] .cm-content');
  await prompt.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Reply with exactly the single word OK and nothing else.');
  await props.getByLabel('Model', { exact: true }).fill('gpt-6-luna');
  await props.getByLabel('Effort', { exact: true }).selectOption('low');
  await props.getByLabel('Sandbox', { exact: true }).selectOption('read-only');

  // Rewire start -> inference -> done.
  await page.getByTestId('node-start').click();
  await page.getByRole('button', { name: 'Remove edge e1' }).click();
  const fromStart = page.getByRole('form', { name: 'Connect start' });
  await fromStart.getByLabel('To').selectOption('inference');
  await fromStart.getByRole('button', { name: 'Connect' }).click();
  await page.getByTestId('node-inference').click();
  const fromInference = page.getByRole('form', { name: 'Connect inference' });
  await fromInference.getByLabel('To').selectOption('done');
  await fromInference.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByText('Ready to publish')).toBeVisible();

  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published version 1.')).toBeVisible();
  await page.getByRole('button', { name: 'Run' }).click();
  await page.getByRole('button', { name: 'Start run' }).click();
  await expect(page).toHaveURL(/\/app\/runs\/[0-9A-Z]{26}$/);

  await expect(page.getByRole('list', { name: 'Timeline' }).getByText('run.finished')).toBeVisible({
    timeout: 240_000,
  });
  await expect(page.locator('[data-status="succeeded"]').first()).toBeVisible();
  const messages = page.getByRole('list', { name: 'Messages' });
  await expect(messages.getByText('assistant')).toBeVisible();
  // The message body is the assistant's whole reply.
  await expect(messages.locator('li p').last()).toHaveText(/^\s*OK\.?\s*$/);
  await page.getByText(/Node progress/).click();
  await expect(page.getByText('harness.session').first()).toBeVisible();
  await context.close();
});
