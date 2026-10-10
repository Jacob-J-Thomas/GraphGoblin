import type { Locator, Page } from '@playwright/test';
import { expect } from './fixtures.js';

/** Help stays compact, accessible and independent of native radio selection inside the dialog. */
export async function checkAnswerTypeHelp(page: Page, dialog: Locator, screenshot: string) {
  const group = dialog.getByRole('radiogroup', { name: 'Answer type' });
  const selectedValue = await group.locator('input:checked').inputValue();
  const popup = page.getByRole('dialog', { name: 'Option help' });
  for (const label of ['Choice', 'Noul', 'Score']) {
    const radio = group.getByRole('radio', { name: label, exact: true });
    const description = await radio.evaluate((input) => {
      const text = document.getElementById(input.getAttribute('aria-describedby') ?? '');
      return { text: text?.textContent ?? '', hidden: text?.classList.contains('sr-only') };
    });
    expect(description.hidden).toBe(true);
    expect(description.text.length).toBeGreaterThan(20);
    await expect(radio).toHaveAccessibleDescription(description.text);
    const card = await radio.locator('..').boundingBox();
    expect(card?.height).toBeLessThanOrEqual(48);
    const help = group.getByRole('button', { name: `${label} help`, exact: true });
    const target = await help.boundingBox();
    if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) {
      expect(target?.width).toBeGreaterThanOrEqual(44);
      expect(target?.height).toBeGreaterThanOrEqual(44);
    }

    await help.hover();
    await expect(popup).toBeVisible();
    await expect(popup).toHaveText(description.text);
    await page.keyboard.press('Escape');
    await expect(popup).toHaveCount(0);

    // Keyboard focus opens the same help without selecting its answer.
    await radio.focus();
    await help.focus();
    await expect(popup).toBeVisible();
    await expect(popup).toHaveText(description.text);
    await page.keyboard.press('Escape');
    await expect(help).toBeFocused();
    await expect(popup).toHaveCount(0);

    await help.tap();
    await expect(popup).toBeVisible();
    await expect(popup).toHaveText(description.text);
    const box = await popup.boundingBox();
    if (!box) throw new Error('Help did not have a visible box.');
    const viewport = page.viewportSize();
    if (!viewport) throw new Error('The browser test needs a fixed viewport.');
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    if (label === 'Score') await page.screenshot({ path: screenshot });
    await help.tap();
    await expect(popup).toHaveCount(0);
    await expect(dialog).toBeVisible();
    expect(await group.locator('input:checked').inputValue()).toBe(selectedValue);
    await expect(radio).toHaveAccessibleDescription(description.text);
  }
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}
