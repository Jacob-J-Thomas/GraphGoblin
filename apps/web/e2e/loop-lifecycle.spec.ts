import type { Page } from '@playwright/test';
import { approvalLoop, expect, publishLoop, test } from './fixtures.js';

function handle(page: Page, nodeId: string, handleId: string) {
  return page.locator(`.react-flow__handle[data-nodeid="${nodeId}"][data-handleid="${handleId}"]`);
}

test('draw a loop in the editor, publish it, run it, watch events, and provide input', async ({
  page,
}) => {
  await page.goto('/app/loops');
  await page.getByLabel('New loop name').fill('e2e approval');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/app\/loops\/[0-9A-Z]{26}\/edit$/);
  await expect(page.getByRole('heading', { name: 'e2e approval' })).toBeVisible();

  // Add a wait node from the palette and rewire start -> wait -> done on the canvas.
  await page.getByRole('button', { name: 'Add Wait node' }).click();
  await expect(page.getByTestId('node-wait')).toBeVisible();
  await page.getByTestId('node-start').click();
  await page.getByRole('button', { name: 'Remove edge e1' }).click();
  await page.locator('.react-flow__controls-fitview').click();

  await handle(page, 'start', 'out').dragTo(handle(page, 'wait', 'in'));
  await handle(page, 'wait', 'out').dragTo(handle(page, 'done', 'in'));
  await expect(page.getByText('✓ Ready to publish')).toBeVisible();

  // A connection into a trigger is refused by the canvas.
  await handle(page, 'done', 'loopBack').dragTo(page.getByTestId('node-start'));
  await expect(page.getByText('✓ Ready to publish')).toBeVisible();

  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published version 1.')).toBeVisible();

  await page.getByRole('button', { name: 'Run' }).click();
  await page.getByRole('button', { name: 'Start run' }).click();
  await expect(page).toHaveURL(/\/app\/runs\/[0-9A-Z]{26}$/);

  const timeline = page.getByRole('list', { name: 'Timeline' });
  await expect(timeline.getByText('run.waiting')).toBeVisible();
  await expect(page.getByText('Input requested')).toBeVisible();
  await expect(page.getByText('Approve?')).toBeVisible();

  await page.getByLabel('Input (JSON)').fill('{"approved": true}');
  await page.getByRole('button', { name: 'Submit input' }).click();
  await expect(timeline.getByText('run.finished')).toBeVisible();
  await expect(page.locator('[data-status="succeeded"]')).toBeVisible();
  await expect(page.getByLabel('Messages')).toContainText('approved');

  // The run shows on the runs list, linked from its loop's last-run status.
  await page.getByRole('link', { name: 'Loops' }).click();
  await expect(
    page.getByRole('row', { name: /e2e approval/ }).locator('[data-status="succeeded"]'),
  ).toBeVisible();
});

test('cancel a waiting run from the inspector', async ({ page, request }) => {
  const loopId = await publishLoop(request, approvalLoop('e2e cancel'));
  await page.goto(`/app/loops/${loopId}/edit`);
  await page.getByRole('button', { name: 'Run' }).click();
  await page.getByRole('button', { name: 'Start run' }).click();
  await expect(page.getByText('Input requested')).toBeVisible();

  await page.getByRole('button', { name: 'Cancel run' }).click();
  await expect(page.locator('[data-status="cancelled"]').first()).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Timeline' }).getByText('run.cancelled'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel run' })).toHaveCount(0);

  // A reload resumes from the stored cursor: the timeline is complete and not duplicated.
  const count = await page.getByRole('list', { name: 'Timeline' }).getByRole('button').count();
  await page.reload();
  await expect(page.getByRole('list', { name: 'Timeline' }).getByRole('button')).toHaveCount(count);
});
