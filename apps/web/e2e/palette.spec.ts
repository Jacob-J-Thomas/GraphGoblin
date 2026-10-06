import type { APIRequestContext, Locator, Page } from '@playwright/test';
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

  // Confirm the real keyboard path from the toolbar's last control into either palette state.
  await page.getByRole('button', { name: 'Publish', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: /^(Show|Hide) palette$/ })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Add Trigger node' })).toBeFocused();
}

async function expectInsetFocusRing(button: Locator, size: number): Promise<void> {
  await button.focus();
  const metrics = await button.evaluate((element) => {
    const clip =
      element.closest<HTMLElement>('[data-testid$="-rail-content"]') ??
      element.closest<HTMLElement>('aside');
    if (!clip) throw new Error('Rail control is outside its side panel');
    const rect = element.getBoundingClientRect();
    const clipRect = clip.getBoundingClientRect();
    const styles = getComputedStyle(element);
    const clipLeft = clipRect.left + clip.clientLeft;
    const clipTop = clipRect.top + clip.clientTop;
    return {
      focusVisible: element.matches(':focus-visible'),
      outlineColor: styles.outlineColor,
      outlineOffset: styles.outlineOffset,
      outlineStyle: styles.outlineStyle,
      outlineWidth: styles.outlineWidth,
      height: rect.height,
      width: rect.width,
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      clipLeft,
      clipTop,
      clipRight: clipLeft + clip.clientWidth,
      clipBottom: clipTop + clip.clientHeight,
    };
  });
  expect(metrics.focusVisible).toBe(true);
  expect(metrics.outlineStyle).toBe('solid');
  expect(metrics.outlineWidth).toBe('2px');
  expect(metrics.outlineOffset).toBe('-2px');
  expect(metrics.outlineColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(metrics.width).toBe(size);
  expect(metrics.height).toBe(size);
  expect(metrics.left).toBeGreaterThanOrEqual(metrics.clipLeft);
  expect(metrics.top).toBeGreaterThanOrEqual(metrics.clipTop);
  expect(metrics.right).toBeLessThanOrEqual(metrics.clipRight);
  expect(metrics.bottom).toBeLessThanOrEqual(metrics.clipBottom);
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
  expect(Math.round((await show.boundingBox())!.height)).toBe(40);
  expect(Math.round((await palette.boundingBox())!.width)).toBe(44);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('graphgoblin-palette')))
    .toBe('unknown');
  await expect(palette.getByRole('button')).toHaveCount(10);
  await expectEditorTabOrder(page);

  const wait = page.getByRole('button', { name: 'Add Wait node' });
  await expect(wait).toHaveAttribute('title', 'Wait: Parks until input, time, or a signal');
  await wait.click();
  await expect(page.getByTestId('node-wait')).toBeVisible();

  const script = page.getByRole('button', { name: 'Add Script node' });
  await script.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('node-script')).toBeVisible();

  await page.getByRole('button', { name: 'Show palette' }).click();
  await expect(page.getByRole('heading', { name: 'Palette', exact: true })).toBeFocused();
  expect(Math.round((await palette.boundingBox())!.width)).toBe(200);
  await expect(page.getByRole('button', { name: 'Add Wait node' })).toHaveAttribute(
    'title',
    'Wait: Parks until input, time, or a signal',
  );
  await expectEditorTabOrder(page);
  await expect(
    page.getByRole('button', { name: 'Show loop settings' }).locator('svg'),
  ).toHaveAttribute('data-icon', 'sliders');
  await page.getByRole('button', { name: 'Show loop settings' }).click();
  await expect(page.getByRole('heading', { name: 'Loop settings', exact: true })).toBeFocused();
  await expectEditorTabOrder(page);
  // The incomplete Subloop produces a save notice with its own toolbar tab stop.
  // Exercise drag after the tab-order checks so that notice cannot change their keyboard path.
  await page.getByRole('button', { name: 'Add Subloop node' }).dragTo(page.getByTestId('canvas'));
  await expect(page.getByTestId('node-subloop')).toBeVisible();
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

test('rail controls keep their complete focus ring in dark and light themes', async ({
  page,
  request,
}) => {
  const loopId = await createLoop(request, approvalLoop('qa rail focus rings'));
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto(`/app/loops/${loopId}/edit`);
  await page.evaluate(() => {
    localStorage.setItem('graphgoblin-palette', 'collapsed');
    localStorage.setItem('graphgoblin-loop-panel', 'collapsed');
  });
  await page.reload();
  await page.getByRole('button', { name: 'Publish', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Show palette' })).toBeFocused();

  const paletteControls = [
    page.getByRole('button', { name: 'Show palette' }),
    ...[
      'Trigger',
      'Decision',
      'Inference',
      'Script',
      'Mutate',
      'Subloop',
      'Wait',
      'Heartbeat',
      'Exit',
    ].map((label) => page.getByRole('button', { name: `Add ${label} node` })),
  ];
  const loopShow = page.getByRole('button', { name: 'Show loop settings' });
  await expect(paletteControls[0]!.locator('svg')).toHaveAttribute('data-icon', 'panel');
  await expect(loopShow.locator('svg')).toHaveAttribute('data-icon', 'sliders');

  for (const theme of ['dark', 'light']) {
    await page.evaluate((nextTheme) => {
      document.documentElement.dataset['theme'] = nextTheme;
    }, theme);
    for (const control of paletteControls) await expectInsetFocusRing(control, 40);
    await expectInsetFocusRing(loopShow, 40);
  }
});

test('the rail scrolls by itself at 1000 × 520', async ({ page, request }) => {
  const loopId = await createLoop(request, approvalLoop('qa short palette rail'));
  await page.setViewportSize({ width: 1000, height: 520 });
  await page.goto(`/app/loops/${loopId}/edit`);
  await page.evaluate(() => {
    localStorage.setItem('graphgoblin-palette', 'collapsed');
    localStorage.setItem('graphgoblin-loop-panel', 'collapsed');
  });
  await page.reload();

  const rail = page.getByTestId('palette-rail-content');
  await expect
    .poll(() => rail.evaluate((element) => element.scrollHeight > element.clientHeight))
    .toBe(true);
  const bounds = await rail.boundingBox();
  if (!bounds) throw new Error('The palette rail is not visible');
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.wheel(0, 1000);
  await expect.poll(() => rail.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: 'Show palette' })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Add Heartbeat node' })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Add Exit node' })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(520);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('the rail keeps 44 px controls on a coarse pointer', async ({ page, request }) => {
  const loopId = await createLoop(request, approvalLoop('qa coarse palette rail'));
  const browser = page.context().browser();
  if (!browser) throw new Error('The Playwright browser is unavailable');
  const context = await browser.newContext({
    baseURL: process.env['GG_E2E_BASE_URL'] ?? '',
    viewport: { width: 1000, height: 800 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    await context.addInitScript(() => {
      localStorage.setItem('graphgoblin-palette', 'collapsed');
      localStorage.setItem('graphgoblin-loop-panel', 'collapsed');
    });
    const touchPage = await context.newPage();
    await touchPage.goto(`/app/loops/${loopId}/edit`);
    await expect
      .poll(() => touchPage.evaluate(() => matchMedia('(pointer: coarse)').matches))
      .toBe(true);
    const paletteRail = touchPage.getByRole('complementary', { name: 'Palette' });
    const loopRail = touchPage.getByRole('complementary', { name: 'Loop settings' });
    const show = touchPage.getByRole('button', { name: 'Show palette' });
    const loopShow = touchPage.getByRole('button', { name: 'Show loop settings' });
    const trigger = touchPage.getByRole('button', { name: 'Add Trigger node' });
    expect(Math.round((await paletteRail.boundingBox())!.width)).toBe(45);
    expect(Math.round((await loopRail.boundingBox())!.width)).toBe(45);
    expect(Math.round((await show.boundingBox())!.width)).toBe(44);
    expect(Math.round((await loopShow.boundingBox())!.width)).toBe(44);
    expect(Math.round((await trigger.boundingBox())!.width)).toBe(44);
  } finally {
    await context.close();
  }
});
