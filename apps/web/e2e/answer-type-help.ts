import type { Locator, Page } from '@playwright/test';
import { expect } from './fixtures.js';

/** Help stays compact, accessible and independent of native radio selection inside the dialog. */
export async function checkAnswerTypeHelp(
  page: Page,
  dialog: Locator,
  screenshot: string,
  hasTouch: boolean,
) {
  const group = dialog.getByRole('radiogroup', { name: 'Answer type' });
  const selectedValue = await group.locator('input:checked').inputValue();
  const popup = page.getByRole('dialog', { name: 'Option help' });
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(hasTouch);
  // The group has one Tab stop, regardless of its pointer help buttons.
  const selected = group.locator('input:checked');
  await selected.focus();
  await page.keyboard.press('Shift+Tab');
  expect(await group.evaluate((element) => element.contains(document.activeElement))).toBe(false);
  await page.keyboard.press('Tab');
  await expect(selected).toBeFocused();
  await expect(popup).toBeVisible();
  await page.keyboard.press('Tab');
  expect(await group.evaluate((element) => element.contains(document.activeElement))).toBe(false);
  await expect(popup).toHaveCount(0);
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
    expect(card?.height).toBeLessThanOrEqual(hasTouch ? 48 : 40);
    const help = group.getByRole('button', { name: `${label} help`, exact: true });
    const target = await help.boundingBox();
    await expect(help).toHaveAttribute('tabindex', '-1');
    if (hasTouch) {
      expect(card?.height).toBeGreaterThanOrEqual(44);
      expect(target?.width).toBeGreaterThanOrEqual(44);
      expect(target?.height).toBeGreaterThanOrEqual(44);
      const labelBox = await group
        .locator(`[id="${await radio.getAttribute('aria-labelledby')}"]`)
        .boundingBox();
      if (!labelBox || !target) throw new Error('Answer label or help button is missing.');
      expect(
        Math.abs(labelBox.y + labelBox.height / 2 - (target.y + target.height / 2)),
      ).toBeLessThanOrEqual(1);
    }

    await help.hover();
    await expect(popup).toBeVisible();
    await expect(popup).toHaveText(description.text);
    await page.keyboard.press('Escape');
    await expect(popup).toHaveCount(0);

    // Keyboard focus opens the same help without selecting its answer.
    await page.keyboard.press('Tab');
    await radio.focus();
    await expect(popup).toBeVisible();
    await expect(popup).toHaveText(description.text);
    if (label === 'Score') await page.screenshot({ path: screenshot });
    await page.keyboard.press('Escape');
    await expect(radio).toBeFocused();
    await expect(popup).toHaveCount(0);

    if (hasTouch) {
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
    }
    await expect(dialog).toBeVisible();
    expect(await group.locator('input:checked').inputValue()).toBe(selectedValue);
    await expect(radio).toHaveAccessibleDescription(description.text);
  }
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}
