import { ApiKeyListResponseSchema } from '@graphgoblin/contracts';
import { control, expect, test } from './fixtures.js';

const warning =
  'Revoking this key will sign this browser out and show the API key panel. Enter another valid key to continue.';

for (const theme of ['dark', 'light'] as const) {
  test(`current key: two browsers revoke the other key then their own with keyboard in ${theme}`, async ({
    browser,
    request,
  }) => {
    const instance = await control(request, '/apps', { requireApiKey: true });
    const url = String(instance['url']);
    const tokenA = String(instance['token']);
    const created = await request.post(`${url}/api-keys`, {
      headers: { authorization: `Bearer ${tokenA}` },
      data: { label: 'B', scopes: ['*'] },
    });
    expect(created.status()).toBe(201);
    const b = (await created.json()) as { key: { id: string }; token: string };
    const listed = await request.get(`${url}/api-keys`, {
      headers: { authorization: `Bearer ${tokenA}` },
    });
    const a = ApiKeyListResponseSchema.parse(await listed.json()).items.find((key) => key.current)!;
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    try {
      for (const context of [contextA, contextB])
        await context.addInitScript(
          (value) => localStorage.setItem('graphgoblin-theme', value),
          theme,
        );
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();
      for (const [page, token] of [
        [pageA, tokenA],
        [pageB, b.token],
      ] as const) {
        await page.goto(`${url}/app/settings`);
        await page.getByLabel('API key', { exact: true }).fill(token);
        await page.getByRole('button', { name: 'Use key' }).click();
        await expect(page.getByRole('heading', { name: 'API key required' })).toHaveCount(0);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      }
      const rowA = pageA
        .getByRole('listitem')
        .filter({ has: pageA.getByRole('button', { name: 'Revoke e2e', exact: true }) });
      const rowB = pageA
        .getByRole('listitem')
        .filter({ has: pageA.getByRole('button', { name: 'Revoke B', exact: true }) });
      await expect(pageA.getByText('This browser', { exact: true })).toHaveCount(1);
      await expect(rowA.getByText('This browser', { exact: true })).toBeVisible();
      await expect(rowB.getByText('This browser', { exact: true })).toHaveCount(0);
      await expect(
        pageB
          .getByRole('listitem')
          .filter({ has: pageB.getByRole('button', { name: 'Revoke B', exact: true }) })
          .getByText('This browser', { exact: true }),
      ).toBeVisible();
      await expect(pageB.getByText('This browser', { exact: true })).toHaveCount(1);
      const listedB = await request.get(`${url}/api-keys`, {
        headers: { authorization: `Bearer ${b.token}` },
      });
      expect(
        ApiKeyListResponseSchema.parse(await listedB.json())
          .items.filter((key) => key.current)
          .map((key) => key.id),
      ).toEqual([b.key.id]);

      await pageA.getByRole('button', { name: 'Revoke B', exact: true }).focus();
      await pageA.keyboard.press('Enter');
      const dialog = pageA.getByRole('alertdialog');
      await expect(dialog).toContainText('Clients using this API key will get 401 immediately.');
      await expect(dialog).not.toContainText(warning);
      await expect(dialog.getByRole('button', { name: 'Keep' })).toBeFocused();
      await pageA.keyboard.press('Tab');
      await expect(dialog.getByRole('button', { name: 'Confirm revoke B' })).toBeFocused();
      await pageA.keyboard.press('Shift+Tab');
      await expect(dialog.getByRole('button', { name: 'Keep' })).toBeFocused();
      await pageA.keyboard.press('Tab');
      const deleteB = pageA.waitForResponse(
        (response) =>
          response.url() === `${url}/api-keys/${b.key.id}` &&
          response.request().method() === 'DELETE',
      );
      await pageA.keyboard.press('Enter');
      expect((await deleteB).status()).toBe(204);
      await expect(dialog).toHaveCount(0);
      await expect(pageA.getByRole('button', { name: 'Revoke B', exact: true })).toHaveCount(0);
      expect(
        (
          await request.get(`${url}/api-keys`, { headers: { authorization: `Bearer ${b.token}` } })
        ).status(),
      ).toBe(401);
      expect(
        (
          await request.get(`${url}/api-keys`, { headers: { authorization: `Bearer ${tokenA}` } })
        ).status(),
      ).toBe(200);
      await pageB.reload();
      await expect(pageB.getByRole('heading', { name: 'API key required' })).toBeVisible();
      await expect(pageB.getByLabel('API key', { exact: true })).toBeFocused();
      await pageA.reload();
      await expect(pageA.getByText('This browser', { exact: true })).toHaveCount(1);
      await pageA.getByRole('button', { name: 'Revoke e2e', exact: true }).focus();
      await pageA.keyboard.press('Enter');
      await expect(dialog).toContainText(warning);
      await expect(dialog.getByRole('button', { name: 'Keep' })).toBeFocused();
      await pageA.keyboard.press('Tab');
      const deleteA = pageA.waitForResponse(
        (response) =>
          response.url() === `${url}/api-keys/${a.id}` && response.request().method() === 'DELETE',
      );
      const refresh = pageA.waitForResponse(
        (response) => response.url() === `${url}/api-keys` && response.request().method() === 'GET',
      );
      await pageA.keyboard.press('Enter');
      expect((await deleteA).status()).toBe(204);
      await expect(dialog).toHaveCount(0);
      expect((await refresh).status()).toBe(401);
      await expect(pageA.getByRole('heading', { name: 'API key required' })).toBeVisible();
      await expect(pageA.getByLabel('API key', { exact: true })).toBeFocused();
    } finally {
      await contextB.close();
      await contextA.close();
    }
  });

  for (const bearer of [false, true]) {
    test(`trusted mode has no current-key marker or browser warning in ${theme}, bearer=${bearer}`, async ({
      page,
      request,
    }) => {
      const instance = await control(request, '/apps');
      const url = String(instance['url']);
      await page.addInitScript(
        ({ theme, token }) => {
          localStorage.setItem('graphgoblin-theme', theme);
          if (token) localStorage.setItem('graphgoblin-api-key', token);
        },
        { theme, token: bearer ? String(instance['token']) : '' },
      );
      await page.goto(`${url}/app/settings`);
      await page.getByRole('button', { name: 'Revoke e2e', exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.getByText('This browser', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('alertdialog')).not.toContainText(warning);
      await expect(page.getByRole('alertdialog')).toContainText('401 immediately');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Revoke e2e', exact: true })).toBeFocused();
    });
  }
}
