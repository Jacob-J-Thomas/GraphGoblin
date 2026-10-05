import type { APIRequestContext, Page } from '@playwright/test';
import { approvalLoop, expect, test } from './fixtures.js';

async function createLoop(request: APIRequestContext, definition: unknown): Promise<string> {
  const created = await request.post('/loops', { data: { definition } });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { loop: { id: string } }).loop.id;
}

async function expectEditorTabOrder(page: Page): Promise<void> {
  const toolbar = page
    .locator('header')
    .filter({ has: page.getByRole('button', { name: 'Publish', exact: true }) })
    .first();
  const ordered = await toolbar.evaluate((toolbarElement) => {
    const palette = document.getElementById('palette');
    const canvas = document.querySelector('[data-testid="canvas"]');
    const loop = document.getElementById('loop-panel');
    if (!palette || !canvas || !loop) return false;
    const follows = (first: Node, second: Node) =>
      Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
    return follows(toolbarElement, palette) && follows(palette, canvas) && follows(canvas, loop);
  });
  expect(ordered).toBe(true);
}

test('the palette rail adds nodes, supports drag, and remembers its state', async ({
  page,
  request,
}) => {
  const loopId = await createLoop(request, approvalLoop('qa palette rail'));
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto(`/app/loops/${loopId}/edit`);
  await page.evaluate(() => localStorage.setItem('graphgoblin-palette', 'unknown'));
  await page.reload();

  const toolbar = page
    .locator('header')
    .filter({ has: page.getByRole('button', { name: 'Publish', exact: true }) })
    .first();
  await expect(toolbar.getByRole('button', { name: 'Loop settings' })).toHaveCount(0);
  await expect(toolbar.getByRole('button', { name: 'Palette' })).toHaveCount(0);
  const palette = page.getByRole('complementary', { name: 'Palette' });
  const show = page.getByRole('button', { name: 'Show palette' });
  await expect(show).toHaveAttribute('aria-expanded', 'false');
  await expect(show).toHaveAttribute('aria-controls', 'palette');
  expect(Math.round((await show.boundingBox())!.height)).toBe(44);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('graphgoblin-palette')))
    .toBe('unknown');
  await expect(palette.getByRole('button')).toHaveCount(10);
  await expectEditorTabOrder(page);

  const wait = page.getByRole('button', { name: 'Add Wait node' });
  await expect(wait).toHaveAttribute('title', 'Parks until input, time, or a signal');
  await wait.click();
  await expect(page.getByTestId('node-wait')).toBeVisible();

  const script = page.getByRole('button', { name: 'Add Script node' });
  await script.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('node-script')).toBeVisible();

  await page.getByRole('button', { name: 'Add Subloop node' }).dragTo(page.getByTestId('canvas'));
  await expect(page.getByTestId('node-subloop')).toBeVisible();

  await page.getByRole('button', { name: 'Show palette' }).click();
  await expect(page.getByRole('heading', { name: 'Palette', exact: true })).toBeFocused();
  expect(Math.round((await palette.boundingBox())!.width)).toBe(200);
  await expectEditorTabOrder(page);
  await page.getByRole('button', { name: 'Show loop' }).click();
  await expect(page.getByRole('heading', { name: 'Loop', exact: true })).toBeFocused();
  await expectEditorTabOrder(page);
  const hide = page.getByRole('button', { name: 'Hide palette' });
  await expect(hide).toHaveAttribute('aria-expanded', 'true');
  await expect(hide).toHaveAttribute('aria-controls', 'palette');
  await page.getByRole('button', { name: 'Hide palette' }).click();
  await expect(page.getByRole('button', { name: 'Show palette' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Show palette' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  expect(Math.round((await palette.boundingBox())!.width)).toBe(44);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('graphgoblin-palette')))
    .toBe('collapsed');

  await page.reload();
  await expect(page.getByRole('button', { name: 'Show palette' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await page.getByRole('button', { name: 'Show palette' }).click();
  await expect(page.getByRole('heading', { name: 'Palette', exact: true })).toBeFocused();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Hide palette' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('graphgoblin-palette')))
    .toBe('expanded');
});
