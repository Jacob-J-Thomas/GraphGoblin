import type { RunRecord } from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { control, expect, publishLoop, test } from './fixtures.js';

test('pressure cleans only confirmed history and shows both pressure warnings without broadening consent', async ({
  page,
  request,
}) => {
  const instance = await control(request, '/apps', { tempPrefix: 'gg-wp-e3-' });
  const url = String(instance['url']);
  const loop = await publishLoop(request, minimalLoop(), url);
  const ids: string[] = [];
  for (let i = 0; i < 2; i++) {
    const start = await request.post(`${url}/loops/${loop}/runs`, { data: {} });
    const { run } = (await start.json()) as { run: RunRecord };
    ids.push(run.id);
    await expect
      .poll(async () =>
        Boolean(
          ((await (await request.get(`${url}/runs/${run.id}`)).json()) as RunRecord).finalizedAt,
        ),
      )
      .toBe(true);
  }
  await page.goto(`${url}/app/runs/${ids[0]}`);
  await expect(page.getByRole('status', { name: 'Storage pressure' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Review delete-ready history' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('permanently remove');
  await dialog.getByRole('button', { name: 'Confirm delete-ready selection' }).click();
  await expect(dialog).not.toBeVisible();
  expect((await request.get(`${url}/runs/${ids[0]}`)).status()).toBe(200);
  const pressure = await control(request, '/storage/capacity', {
    instanceId: instance['instanceId'],
    availableBytes: 0,
  });
  expect(pressure['deletedRuns']).toBe(1);
  expect((await request.get(`${url}/runs/${ids[0]}`)).status()).toBe(404);
  expect((await request.get(`${url}/runs/${ids[1]}`)).status()).toBe(200);
  await page.goto(`${url}/app/runs`);
  const notice = page.getByRole('status', { name: 'Storage pressure' });
  await expect(notice).toContainText('only history you marked delete-ready');
  await expect(notice).toHaveAttribute('aria-live', 'polite');
  await expect(notice.getByRole('link', { name: 'Review run history' })).toBeVisible();
  const none = await control(request, '/storage/capacity', {
    instanceId: instance['instanceId'],
    availableBytes: 0,
  });
  expect(none['state']).toBe('no-eligible');
  await page.reload();
  await expect(notice).toContainText('No approved eligible history');
  expect((await request.get(`${url}/runs/${ids[1]}`)).status()).toBe(200);
  await control(request, '/storage/capacity', {
    instanceId: instance['instanceId'],
    availableBytes: 50 * 1024 ** 3,
  });
  await page.reload();
  await expect(notice).toHaveCount(0);
});

test('clears confirmed selection and prunes selected rows removed by cleanup while Runs stays open', async ({
  page,
  request,
}) => {
  const instance = await control(request, '/apps', { tempPrefix: 'gg-wp-e3-' });
  const url = String(instance['url']);
  const loop = await publishLoop(request, minimalLoop(), url);
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const started = await request.post(`${url}/loops/${loop}/runs`, { data: {} });
    const { run } = (await started.json()) as { run: RunRecord };
    ids.push(run.id);
    await expect
      .poll(async () =>
        Boolean(
          ((await (await request.get(`${url}/runs/${run.id}`)).json()) as RunRecord).finalizedAt,
        ),
      )
      .toBe(true);
  }
  await page.goto(`${url}/app/runs`);
  for (const id of ids.slice(0, 2))
    await page.getByRole('checkbox', { name: `Select history ${id}` }).check();
  await page.getByRole('button', { name: 'Review delete-ready history' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirm delete-ready selection' })
    .click();
  await expect(page.getByText('0 selected', { exact: true })).toHaveAttribute(
    'aria-live',
    'polite',
  );
  for (const id of [ids[0]!, ids[2]!])
    await page.getByRole('checkbox', { name: `Select history ${id}` }).check();
  await control(request, '/storage/capacity', {
    instanceId: instance['instanceId'],
    availableBytes: 0,
  });
  await expect(page.getByRole('checkbox', { name: `Select history ${ids[0]}` })).toHaveCount(0);
  await expect(page.getByText('1 selected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Review delete-ready history' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(ids[2]!);
  await expect(dialog).not.toContainText(ids[0]!);
  await expect(
    dialog.getByRole('button', { name: 'Confirm delete-ready selection' }),
  ).toBeEnabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
});
