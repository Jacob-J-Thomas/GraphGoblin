import type { APIRequestContext } from '@playwright/test';
import { approvalLoop, closeNode, expect, openNode, test } from './fixtures.js';

type CronConfig = { subtype: 'cron'; expression: string; timezone?: string };
async function createCronLoop(request: APIRequestContext, name: string, config: CronConfig) {
  const definition = approvalLoop(name);
  const created = await request.post('/loops', {
    data: {
      definition: {
        ...definition,
        nodes: definition.nodes.map((node) => (node.id === 'start' ? { ...node, config } : node)),
      },
    },
  });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { loop: { id: string } }).loop.id;
}
async function storedCron(request: APIRequestContext, id: string) {
  const data = (await (await request.get(`/loops/${id}`)).json()) as {
    draft: { definition: { nodes: { id: string; config: CronConfig }[] } };
  };
  return data.draft.definition.nodes.find((node) => node.id === 'start')!.config;
}

for (const timezone of ['Etc/UTC', 'Asia/Kolkata']) {
  test(`saved ${timezone} previews through the real endpoint without a false zone error`, async ({
    page,
    request,
  }, testInfo) => {
    const id = await createCronLoop(request, `zone ${timezone}`, {
      subtype: 'cron',
      expression: '0 9 * * *',
      timezone,
    });
    await page.goto(`/app/loops/${id}/edit`);
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith('/triggers/cron/preview') &&
        response.request().postDataJSON().timezone === timezone,
    );
    const dialog = await openNode(page, 'start');
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    await expect(dialog.locator('time')).toHaveCount(5);
    await expect(dialog.getByLabel('Timezone')).toHaveValue(timezone);
    await expect(dialog.getByLabel('Timezone')).not.toHaveAttribute('aria-invalid', 'true');
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    expect(
      await dialog
        .locator('time')
        .evaluateAll((slots) => slots.map((slot) => slot.getAttribute('datetime'))),
    ).toEqual(((await response.json()) as { next: string[] }).next);
    await page.screenshot({ path: testInfo.outputPath('accepted-zone.png') });
    await closeNode(page);
    expect((await storedCron(request, id)).timezone).toBe(timezone);
  });
}

for (const scenario of [
  { name: 'time', expression: '30 9 * * *', control: 'At time' },
  { name: 'every', expression: '*/5 * * * *', control: 'Every (minutes)' },
  { name: 'monthly day', expression: '0 9 12 * *', control: 'Day of month' },
  { name: 'weekly days', expression: '0 9 * * 1', control: 'Monday' },
]) {
  test(`clearing ${scenario.name} leaves the saved expression unchanged and reopens correctly`, async ({
    page,
    request,
  }, testInfo) => {
    const id = await createCronLoop(request, `clear ${scenario.name}`, {
      subtype: 'cron',
      expression: scenario.expression,
      timezone: 'UTC',
    });
    await page.goto(`/app/loops/${id}/edit`);
    let dialog = await openNode(page, 'start');
    await expect(dialog.locator('time')).toHaveCount(5);
    let previews = 0;
    page.on('request', (req) => {
      if (req.url().endsWith('/triggers/cron/preview')) previews++;
    });
    if (scenario.name === 'weekly days') await dialog.getByLabel(scenario.control).uncheck();
    else await dialog.getByLabel(scenario.control).fill('');
    await expect(dialog.getByRole('alert')).toBeVisible();
    await page.waitForTimeout(800);
    expect(previews).toBe(0);
    expect((await storedCron(request, id)).expression).toBe(scenario.expression);
    // Expose the unchanged backing value alongside the incomplete builder for evidence.
    await dialog.getByRole('button', { name: 'Advanced Cron expression' }).click();
    await expect(dialog.getByLabel('Cron expression')).toHaveValue(scenario.expression);
    await page.screenshot({ path: testInfo.outputPath('incomplete-keeps-saved.png') });
    await closeNode(page);
    dialog = await openNode(page, 'start');
    await expect(dialog.getByLabel('Repeat')).not.toHaveValue('custom');
    if (scenario.name === 'weekly days') await expect(dialog.getByLabel('Monday')).toBeChecked();
    else await expect(dialog.getByLabel(scenario.control)).not.toHaveValue('');
  });
}

test('switching subtype to cron waits for a schedule without a preview or mount edit', async ({
  page,
  request,
}, testInfo) => {
  const created = await request.post('/loops', {
    data: { definition: approvalLoop('choose a cron schedule') },
  });
  const id = ((await created.json()) as { loop: { id: string } }).loop.id;
  await page.goto(`/app/loops/${id}/edit`);
  const dialog = await openNode(page, 'start');
  let previews = 0;
  page.on('request', (req) => {
    if (req.url().endsWith('/triggers/cron/preview')) previews++;
  });
  await dialog.getByLabel('Subtype').selectOption('cron');
  await expect(dialog.getByLabel('Repeat')).toHaveValue('empty');
  await expect(dialog.getByLabel('Repeat').locator('option:checked')).toHaveText(
    'Choose a schedule…',
  );
  await expect(
    dialog
      .locator('p:not([role])')
      .filter({ hasText: /^Choose a schedule to see upcoming runs\.$/ }),
  ).toBeVisible();
  await page.waitForTimeout(800);
  expect(previews).toBe(0);
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByRole('region', { name: 'Upcoming runs' })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('choose-schedule.png') });
  // One undo returns to manual: opening the empty builder added no extra history step.
  await dialog.getByLabel('Subtype').focus();
  await page.keyboard.press('Control+z');
  await expect(dialog.getByLabel('Subtype').locator('option:checked')).toHaveText('manual');
  await page.keyboard.press('Control+y');
  await expect(dialog.getByLabel('Repeat')).toHaveValue('empty');
  await dialog.getByLabel('Repeat').selectOption('daily');
  await expect(dialog.locator('time')).toHaveCount(5);
  await expect.poll(async () => (await storedCron(request, id)).expression).toBe('0 9 * * *');
});

test('custom selection and an expression field issue reveal and focus raw text', async ({
  page,
  request,
}) => {
  const id = await createCronLoop(request, 'raw expression focus', {
    subtype: 'cron',
    expression: '0 9 * * *',
    timezone: 'UTC',
  });
  await page.goto(`/app/loops/${id}/edit`);
  await openNode(page, 'start');
  const dialog = page.getByRole('dialog', { name: 'Edit trigger start' });
  await dialog.getByLabel('Repeat').selectOption('custom');
  await expect(dialog.getByLabel('Cron expression')).toBeVisible();
  await expect(dialog.getByLabel('Cron expression')).toBeFocused();
  await dialog.getByLabel('Cron expression').fill('broken');
  await expect(dialog.getByText(/^Invalid schedule:/)).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Advanced Cron expression 1 error' }),
  ).toBeVisible();
  await dialog.getByLabel('Cron expression').fill('');
  await dialog.getByRole('button', { name: 'Advanced Cron expression 1 error' }).click();
  await expect(dialog.getByLabel('Cron expression')).not.toBeVisible();
  const badge = dialog.getByRole('button', { name: /issues? on start$/ });
  await badge.click();
  await page
    .getByRole('dialog', { name: 'Issues on start' })
    .getByRole('button', { name: /Error SCHEMA.*config.expression/ })
    .click();
  await expect(dialog.getByLabel('Cron expression')).toBeVisible();
  await expect(dialog.getByLabel('Cron expression')).toBeFocused();
});

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
  await expect(dialog.getByText('Custom expression: */7 3-5 * * 1,3 · UTC')).toBeVisible();
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
  await expect(
    dialog.getByText('Every Monday and Wednesday at 09:30, Europe/London'),
  ).toBeVisible();
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
