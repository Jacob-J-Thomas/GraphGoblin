import { approvalLoop, control, expect, showLoopPanel, test } from './fixtures.js';

for (const status of ['draft', 'published'] as const) {
  test(`editor reopens stored ${status} with omitted additive deadline defaults`, async ({
    page,
    request,
  }) => {
    // A genuine store from before 0019; the gateway's startup applies 0019 and every later one.
    // The Node/tsx control server owns backend imports and disposable store teardown.
    const stored = await control(request, '/apps/stored-loop-defaults', {
      definition: approvalLoop(`Stored ${status}`),
      status,
    });
    expect(stored['pendingMigrations']).toBe(0);
    const url = String(stored['url']);
    const loop = { id: String(stored['loopId']) };
    await page.goto(`${url}/app/loops/${loop.id}/edit`);
    await expect(
      page.getByRole('heading', { name: `Stored ${status}`, exact: true }),
    ).toBeVisible();
    await showLoopPanel(page);
    await expect(
      page.getByRole('combobox', { name: 'Structured completion milliseconds mode' }),
    ).toHaveValue('unlimited');
    await expect(page.getByRole('combobox', { name: 'Run deadline seconds mode' })).toHaveValue(
      'unlimited',
    );
    await expect(page.getByText('Could not load loop', { exact: true })).toBeHidden();
    process.stdout.write(
      JSON.stringify({
        status,
        opened: true,
        structuredTimeoutMs: null,
        runDeadlineSeconds: null,
      }) + '\n',
    );
  });
}
