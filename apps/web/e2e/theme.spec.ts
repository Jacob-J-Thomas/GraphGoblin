/**
 * The theme control (#11): Dark by default, Light from Settings → Appearance, remembered across
 * reloads and shown before first paint, with storage that is cleared or throwing falling back to
 * Dark without breaking the app.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

declare global {
  interface Window {
    /** data-theme and theme-color when <body> first exists, before the app's scripts run. */
    __ggFirst?: { theme: string | null; chrome: string | null | undefined };
    /** Every later change to data-theme on <html>. */
    __ggChanges?: (string | null)[];
  }
}

/**
 * Record what the page shows as soon as <body> is parsed (nothing can paint earlier) and every
 * data-theme change after that. Only observes; it never sets the theme.
 */
async function recordFirstPaint(page: Page) {
  await page.addInitScript(() => {
    window.__ggChanges = [];
    // The init script runs before <html> exists; everything is read when <body> appears.
    new MutationObserver((_records, observer) => {
      if (!document.body) return;
      const root = document.documentElement;
      window.__ggFirst = {
        theme: root.getAttribute('data-theme'),
        chrome: document.querySelector('meta[name="theme-color"]')?.getAttribute('content'),
      };
      observer.disconnect();
      new MutationObserver(() => window.__ggChanges?.push(root.getAttribute('data-theme'))).observe(
        root,
        { attributes: true, attributeFilter: ['data-theme'] },
      );
    }).observe(document, { childList: true, subtree: true });
  });
}

const shown = (page: Page) => page.evaluate(() => document.documentElement.dataset['theme']);
const chrome = (page: Page) =>
  page.evaluate(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    return { content: meta?.content, dark: meta?.dataset['dark'], light: meta?.dataset['light'] };
  });
const first = (page: Page) => page.evaluate(() => window.__ggFirst);
const changes = (page: Page) => page.evaluate(() => window.__ggChanges);

test('Dark is the default, from the first paint', async ({ page }) => {
  await recordFirstPaint(page);
  await page.goto('/app/settings');
  await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible();
  const colours = await chrome(page);
  expect(colours.dark).toMatch(/^#[0-9a-f]{6}$/);
  expect(colours.light).toMatch(/^#[0-9a-f]{6}$/);
  expect(await first(page)).toEqual({ theme: 'dark', chrome: colours.dark });
  expect(await shown(page)).toBe('dark');
  expect(await changes(page)).toEqual([]);
  await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked();
});

test('Light applies at once, survives reloads without a flash, and Dark comes back', async ({
  page,
}) => {
  await recordFirstPaint(page);
  await page.goto('/app/settings');
  const group = page.getByRole('group', { name: 'Theme' });
  await group.getByText('Light', { exact: true }).click();
  await expect(group.getByRole('radio', { name: 'Light' })).toBeChecked();
  expect(await shown(page)).toBe('light');
  const colours = await chrome(page);
  expect(colours.content).toBe(colours.light);

  for (let reload = 0; reload < 2; reload += 1) {
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible();
    // Light before the app's scripts ran, and never anything else afterwards: no flash.
    expect(await first(page)).toEqual({ theme: 'light', chrome: colours.light });
    expect(await changes(page)).toEqual([]);
    await expect(page.getByRole('radio', { name: 'Light' })).toBeChecked();
  }

  // Another screen keeps it, and the keyboard switches back.
  await page.getByRole('link', { name: 'Loops' }).click();
  expect(await shown(page)).toBe('light');
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('radio', { name: 'Light' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked();
  expect(await shown(page)).toBe('dark');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible();
  expect(await first(page)).toEqual({ theme: 'dark', chrome: colours.dark });
});

test('cleared storage falls back to Dark', async ({ page }) => {
  await recordFirstPaint(page);
  await page.goto('/app/settings');
  await page.getByText('Light', { exact: true }).click();
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible();
  expect((await first(page))?.theme).toBe('dark');
  await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked();
});

test('storage that throws does not break the app', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
  });
  await recordFirstPaint(page);
  await page.goto('/app/settings');
  await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Model catalog' })).toBeVisible();
  expect((await first(page))?.theme).toBe('dark');
  // The choice still applies for this page; it cannot be remembered.
  await page.getByText('Light', { exact: true }).click();
  expect(await shown(page)).toBe('light');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible();
  expect(await shown(page)).toBe('dark');
  expect(errors).toEqual([]);
});
