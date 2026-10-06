/**
 * The Font control (#40): Geist by default; a face chosen in Settings → Appearance applies at once,
 * is in place from the first paint after a reload (no flash), follows other tabs, and is served by
 * the service worker offline. A font file that fails to load leaves the fallback stack without
 * breaking the layout, and storage that throws or holds an unknown value shows Geist.
 *
 * "Rendered in" is the browser's own answer (CSS.getPlatformFontsForNode over CDP), so a check
 * passes only when the face was actually drawn, not just requested.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

declare global {
  interface Window {
    /** data-font and the font preloads when <body> first exists, before the app's scripts run. */
    __ggFontFirst?: { font: string | null; preloads: (string | null)[] };
    /** The body's family and --font-ui at the first rendering frame (nothing paints earlier). */
    __ggFontPaint?: { family: string; ui: string };
    /** Every later change to data-font on <html>. */
    __ggFontChanges?: (string | null)[];
  }
}

/** Record the font state at the first paint and every data-font change after it; only observes. */
async function recordFirstPaint(page: Page) {
  await page.addInitScript(() => {
    window.__ggFontChanges = [];
    new MutationObserver((_records, observer) => {
      if (!document.body) return;
      const root = document.documentElement;
      window.__ggFontFirst = {
        font: root.getAttribute('data-font'),
        preloads: [...document.querySelectorAll('link[rel="preload"][as="font"]')].map((link) =>
          link.getAttribute('href'),
        ),
      };
      observer.disconnect();
      new MutationObserver(() =>
        window.__ggFontChanges?.push(root.getAttribute('data-font')),
      ).observe(root, { attributes: true, attributeFilter: ['data-font'] });
    }).observe(document, { childList: true, subtree: true });
    // Rendering waits for the stylesheet, so the first animation frame is the first paint's style.
    const frame = () => {
      if (!document.body) {
        requestAnimationFrame(frame);
        return;
      }
      window.__ggFontPaint = {
        family: getComputedStyle(document.body).fontFamily,
        ui: getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim(),
      };
    };
    requestAnimationFrame(frame);
  });
}

const first = (page: Page) => page.evaluate(() => window.__ggFontFirst);
const paint = async (page: Page) => {
  await expect.poll(() => page.evaluate(() => window.__ggFontPaint !== undefined)).toBe(true);
  return page.evaluate(() => window.__ggFontPaint);
};
const changes = (page: Page) => page.evaluate(() => window.__ggFontChanges);
const shown = (page: Page) => page.evaluate(() => document.documentElement.dataset['font']);
const family = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((element) => getComputedStyle(element).fontFamily);

/** The font families the browser actually drew an element's own text in. */
async function renderedIn(page: Page, target: Locator): Promise<string[]> {
  await page.evaluate(() => document.fonts.ready);
  await target.first().evaluate((element) => element.setAttribute('data-gg-probe', ''));
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await cdp.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: '[data-gg-probe]',
    });
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    return fonts.map((font) => font.familyName);
  } finally {
    await cdp.detach();
    await target.first().evaluate((element) => element.removeAttribute('data-gg-probe'));
  }
}

/** Text in the text face on Settings: the Font control's help line. */
const helpText = (page: Page) => page.getByText(/^Geist is the default\. The font applies/);
const pageTitle = (page: Page) => page.getByRole('heading', { level: 1 });

/** The status of the face's @font-face rules (several for a family with static weights). */
const faceStatus = (page: Page, name: string) =>
  page.evaluate(
    (wanted) =>
      [...document.fonts]
        .filter((face) => face.family.replace(/"/g, '') === wanted)
        .map((face) => face.status),
    name,
  );

const fontGroup = (page: Page) => page.getByRole('radiogroup', { name: 'Font' });
const choose = (page: Page, name: string) =>
  fontGroup(page).getByText(name, { exact: true }).click();

/** No horizontal page scroll, and every font option keeps its text inside its box. */
async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    options: [...document.querySelectorAll('label[data-font]')]
      .filter((option) => option.scrollWidth > option.clientWidth + 1)
      .map((option) => option.getAttribute('data-font')),
  }));
  expect(overflow).toEqual({ page: 0, options: [] });
}

test('Geist is the default from the first paint, with only its file preloaded', async ({
  page,
}) => {
  await recordFirstPaint(page);
  await page.goto('/app/settings');
  await expect(fontGroup(page)).toBeVisible();
  expect(await first(page)).toEqual({ font: null, preloads: ['/app/fonts/Geist-Variable.woff2'] });
  expect((await paint(page))?.family).toMatch(/^"?Geist"?, /);
  expect(await changes(page)).toEqual([]);
  await expect(fontGroup(page).getByRole('radio', { name: 'Geist' })).toBeChecked();
  expect(await renderedIn(page, helpText(page))).toEqual(['Geist']);
});

test('a chosen face applies at once, survives reloads without a flash, and keeps code in Geist Mono', async ({
  page,
}) => {
  await recordFirstPaint(page);
  await page.goto('/app/settings');
  await choose(page, 'Inter');
  await expect(fontGroup(page).getByRole('radio', { name: 'Inter' })).toBeChecked();
  expect(await shown(page)).toBe('inter');
  expect(await family(page, 'body')).toMatch(/^"?Inter"?, /);
  expect(await renderedIn(page, helpText(page))).toEqual(['Inter']);
  expect(await page.evaluate(() => localStorage.getItem('graphgoblin-font'))).toBe('inter');
  await expect(page.getByRole('heading', { name: 'Model catalog' })).toBeVisible();
  expect(await family(page, 'code')).toMatch(/^"?Geist Mono"?, /);

  for (let reload = 0; reload < 2; reload += 1) {
    await page.reload();
    await expect(fontGroup(page)).toBeVisible();
    // Inter before the app's scripts ran and at the first frame, and never anything else: no flash.
    expect(await first(page)).toEqual({
      font: 'inter',
      preloads: ['/app/fonts/Inter-Variable.woff2'],
    });
    const painted = await paint(page);
    expect(painted?.family).toMatch(/^"?Inter"?, /);
    expect(painted?.ui).toMatch(/^"?Inter"?, /);
    expect(await changes(page)).toEqual([]);
    await expect(fontGroup(page).getByRole('radio', { name: 'Inter' })).toBeChecked();
  }

  // Another screen keeps it, and headings take the same face.
  await page.getByRole('link', { name: 'Runs' }).click();
  await expect(page.getByRole('heading', { name: 'Runs', level: 1 })).toBeVisible();
  expect(await shown(page)).toBe('inter');
  expect(await family(page, 'h1')).toMatch(/^"?Inter"?, /);
  expect(await renderedIn(page, pageTitle(page))).toEqual(['Inter']);
});

test('Chakra Petch sets headings and the wordmark only, chosen with the keyboard', async ({
  page,
}) => {
  await page.goto('/app/settings');
  await fontGroup(page).getByRole('radio', { name: 'Geist' }).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(fontGroup(page).getByRole('radio', { name: 'Chakra Petch' })).toBeChecked();
  await expect(fontGroup(page).getByRole('radio', { name: 'Chakra Petch' })).toBeFocused();
  expect(await shown(page)).toBe('chakra-petch');
  // The page title is bold: the Bold file, whose family name is plain "Chakra Petch".
  expect(await renderedIn(page, pageTitle(page))).toEqual(['Chakra Petch']);
  expect(await renderedIn(page, page.getByRole('heading', { name: 'Appearance' }))).toEqual([
    'Chakra Petch SemiBold',
  ]);
  expect(await family(page, 'body')).toMatch(/^"?Geist"?, /);
  expect(await renderedIn(page, helpText(page))).toEqual(['Geist']);
  const wordmark = page.locator('header .font-display').first();
  expect(await wordmark.evaluate((element) => getComputedStyle(element).fontFamily)).toMatch(
    /^"?Chakra Petch"?, /,
  );
});

test('another tab follows the face chosen here', async ({ page, context }) => {
  await page.goto('/app/settings');
  const other = await context.newPage();
  await other.goto('/app/loops');
  await expect(other.getByRole('heading', { name: 'Loops', level: 1 })).toBeVisible();
  await choose(page, 'OpenDyslexic');
  await expect.poll(() => shown(other)).toBe('opendyslexic');
  expect(await family(other, 'body')).toMatch(/^"?OpenDyslexic"?, /);
  await choose(page, 'Geist');
  await expect.poll(() => shown(other)).toBe('geist');
  await other.close();
});

test('offline, the service worker serves the chosen face and the shell renders in it', async ({
  page,
  context,
}) => {
  await page.goto('/app/settings');
  await choose(page, 'Atkinson Hyperlegible');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // The worker does not claim existing clients; the next navigation uses it.
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);

  await context.setOffline(true);
  try {
    const served: { url: string; status: number; fromWorker: boolean }[] = [];
    page.on('response', (response) => {
      if (response.url().endsWith('.woff2')) {
        served.push({
          url: new URL(response.url()).pathname,
          status: response.status(),
          fromWorker: response.fromServiceWorker(),
        });
      }
    });
    await page.reload();
    await expect(fontGroup(page)).toBeVisible();
    await expect(page.getByText('You are offline', { exact: true })).toBeVisible();
    expect(await shown(page)).toBe('atkinson-hyperlegible');
    expect(await renderedIn(page, helpText(page))).toEqual(['Atkinson Hyperlegible Next']);
    expect(await faceStatus(page, 'Atkinson Hyperlegible Next')).toEqual(['loaded']);
    expect(served).toContainEqual({
      url: '/app/fonts/AtkinsonHyperlegibleNext-Variable.woff2',
      status: 200,
      fromWorker: true,
    });
  } finally {
    await context.setOffline(false);
  }
});

test.describe('without the service worker', () => {
  test.use({ serviceWorkers: 'block' });

  test('a font file that fails to load leaves the fallback stack and the layout intact', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/fonts/OpenDyslexic-*.woff2', (route) => route.abort('failed'));
    await page.addInitScript(() => window.localStorage.setItem('graphgoblin-font', 'opendyslexic'));
    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/app/settings');
      await expect(fontGroup(page)).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Model catalog' })).toBeVisible();
      expect(await shown(page)).toBe('opendyslexic');
      expect(await family(page, 'body')).toMatch(/^"?OpenDyslexic"?, ui-sans-serif, /);
      await expect.poll(() => faceStatus(page, 'OpenDyslexic')).toContain('error');
      // The browser drew the text in a fallback face from the stack, not the missing one.
      const drawn = await renderedIn(page, helpText(page));
      expect(drawn.length).toBeGreaterThan(0);
      expect(drawn).not.toContain('OpenDyslexic');
      await expectNoOverflow(page);
      await expect(fontGroup(page).getByRole('radio', { name: 'OpenDyslexic' })).toBeChecked();
    }
    // The control still works: Geist comes back at once.
    await choose(page, 'Geist');
    expect(await renderedIn(page, helpText(page))).toEqual(['Geist']);
    expect(errors).toEqual([]);
  });
});

test('a stored value this build does not know shows Geist and is left in place', async ({
  page,
}) => {
  await recordFirstPaint(page);
  await page.goto('/app/settings');
  await page.evaluate(() => localStorage.setItem('graphgoblin-font', 'comic-sans'));
  await page.reload();
  await expect(fontGroup(page)).toBeVisible();
  expect(await first(page)).toEqual({ font: null, preloads: ['/app/fonts/Geist-Variable.woff2'] });
  expect((await paint(page))?.family).toMatch(/^"?Geist"?, /);
  await expect(fontGroup(page).getByRole('radio', { name: 'Geist' })).toBeChecked();
  expect(await page.evaluate(() => localStorage.getItem('graphgoblin-font'))).toBe('comic-sans');
});

test('storage that throws shows Geist and the choice still applies for the page', async ({
  page,
}) => {
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
  await expect(fontGroup(page)).toBeVisible();
  expect(await first(page)).toEqual({ font: null, preloads: ['/app/fonts/Geist-Variable.woff2'] });
  await choose(page, 'Space Grotesk');
  expect(await shown(page)).toBe('space-grotesk');
  // The variable file names its default instance "Space Grotesk Light".
  expect(await renderedIn(page, helpText(page))).toEqual([
    expect.stringMatching(/^Space Grotesk\b/),
  ]);
  await page.reload();
  await expect(fontGroup(page)).toBeVisible();
  expect(await shown(page)).toBeUndefined();
  await expect(fontGroup(page).getByRole('radio', { name: 'Geist' })).toBeChecked();
  expect(errors).toEqual([]);
});
