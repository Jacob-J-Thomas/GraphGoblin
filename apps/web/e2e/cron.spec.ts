import { approvalLoop, closeNode, expect, openNode, test } from './fixtures.js';

test('cron presets, keyboard days, timezone and custom source round trip through the real API', async ({
  page,
  request,
}) => {
  const definition = approvalLoop('cron builder');
  const created = await request.post('/loops', {
    data: {
      definition: {
        ...definition,
        nodes: definition.nodes.map((node) =>
          node.id === 'start'
            ? {
                ...node,
                config: { subtype: 'cron', expression: '*/7 3-5 * * 1,3', timezone: 'UTC' },
              }
            : node,
        ),
      },
    },
  });
  expect(created.status()).toBe(201);
  const id = ((await created.json()) as { loop: { id: string } }).loop.id;
  await page.goto(`/app/loops/${id}/edit`);
  let dialog = await openNode(page, 'start');
  await expect(dialog.getByLabel('Repeat')).toHaveValue('custom');
  await expect(dialog.getByText('Custom expression: */7 3-5 * * 1,3, UTC')).toBeVisible();
  await expect(dialog.locator('time')).toHaveCount(5);
  await dialog.getByLabel('Timezone').fill('Europe/London');
  await closeNode(page);
  await expect
    .poll(async () => {
      const data = (await (await request.get(`/loops/${id}`)).json()) as {
        draft: { definition: { nodes: { config: { expression?: string } }[] } };
      };
      return data.draft.definition.nodes[0]!.config.expression;
    })
    .toBe('*/7 3-5 * * 1,3');
  dialog = await openNode(page, 'start');
  await expect(dialog.getByLabel('Repeat')).toHaveValue('custom');
  await expect(dialog.getByLabel('Timezone')).toHaveValue('Europe/London');
  await dialog.getByLabel('Repeat').selectOption('weekly');
  await dialog.getByLabel('Wednesday').focus();
  await page.keyboard.press('Space');
  await dialog.getByLabel('At time').fill('09:30');
  await expect(dialog.getByText('Every Monday, Wednesday at 09:30, Europe/London')).toBeVisible();
  const advanced = dialog.getByRole('button', { name: 'Advanced Cron expression' });
  await advanced.focus();
  await page.keyboard.press('Enter');
  await expect(dialog.getByLabel('Cron expression')).toHaveValue('30 9 * * 1,3');
  await expect(dialog.locator('time')).toHaveCount(5);
  await closeNode(page);
  await expect
    .poll(async () => {
      const data = (await (await request.get(`/loops/${id}`)).json()) as {
        draft: { definition: { nodes: { config: unknown }[] } };
      };
      return data.draft.definition.nodes[0]!.config;
    })
    .toEqual({
      subtype: 'cron',
      expression: '30 9 * * 1,3',
      timezone: 'Europe/London',
      missedFirePolicy: 'skip',
      enabled: true,
    });
  await page.reload();
  dialog = await openNode(page, 'start');
  await expect(dialog.getByLabel('Repeat')).toHaveValue('weekly');
  await expect(dialog.getByLabel('Wednesday')).toBeChecked();
  await expect(dialog.getByLabel('At time')).toHaveValue('09:30');
});

test('preview and displayed slots equal the scheduler across London DST; invalid and unreachable feedback', async ({
  page,
  request,
}, testInfo) => {
  const expression = '0 9 * * *';
  const timezone = 'Europe/London';
  const from = '2026-03-27T10:00:00.000Z';
  // The API test checks this same sequence directly against CronScheduler.nextFire.
  const expected = [
    '2026-03-28T09:00:00.000Z',
    '2026-03-29T08:00:00.000Z',
    '2026-03-30T08:00:00.000Z',
    '2026-03-31T08:00:00.000Z',
    '2026-04-01T08:00:00.000Z',
  ];
  const preview = await request.post('/triggers/cron/preview', {
    data: { expression, timezone, from },
  });
  expect(preview.status()).toBe(200);
  expect(await preview.json()).toEqual({ next: expected });
  // Pin only the request's clock; the response is computed by the real preview endpoint.
  await page.route('**/triggers/cron/preview', async (route) => {
    const body = route.request().postDataJSON() as { expression: string; timezone: string };
    await route.continue({ postData: JSON.stringify({ ...body, from }) });
  });
  const definition = approvalLoop('cron DST');
  const created = await request.post('/loops', {
    data: {
      definition: {
        ...definition,
        nodes: definition.nodes.map((node) =>
          node.id === 'start'
            ? { ...node, config: { subtype: 'cron', expression, timezone } }
            : node,
        ),
      },
    },
  });
  const id = ((await created.json()) as { loop: { id: string } }).loop.id;
  await page.goto(`/app/loops/${id}/edit`);
  const dialog = await openNode(page, 'start');
  await expect(dialog.locator('time')).toHaveCount(5);
  expect(
    await dialog
      .locator('time')
      .evaluateAll((slots) => slots.map((slot) => slot.getAttribute('datetime'))),
  ).toEqual(expected);
  await expect(dialog.locator('time').nth(0)).toContainText('09:00:00');
  await expect(dialog.locator('time').nth(1)).toContainText('09:00:00');
  await expect(dialog.locator('time').nth(1)).toContainText('GMT+1');
  await expect(dialog.getByText(/^Your time:/)).toHaveCount(5);
  for (const theme of ['dark', 'light']) {
    await page.evaluate(
      (value) => document.documentElement.setAttribute('data-theme', value),
      theme,
    );
    await page.screenshot({ path: testInfo.outputPath(`cron-${theme}.png`) });
  }
  await dialog.getByLabel('Timezone').fill('Mars/Olympus');
  await expect(dialog.getByRole('alert')).toContainText('IANA');
  await expect(dialog.locator('time')).toHaveCount(0);
  await dialog.getByLabel('Timezone').fill('UTC');
  await dialog.getByRole('button', { name: 'Advanced Cron expression' }).click();
  await dialog.getByLabel('Cron expression').fill('broken');
  await expect(dialog.getByText(/^Invalid schedule:/)).toBeVisible();
  await page.unroute('**/triggers/cron/preview');
  await page.route('**/triggers/cron/preview', (route) => route.abort('connectionrefused'));
  await dialog.getByLabel('Cron expression').fill('0 10 * * *');
  await expect(dialog.getByText(/^Preview unavailable\./)).toBeVisible();
  await expect(dialog.getByLabel('Cron expression')).toHaveValue('0 10 * * *');
});
