/**
 * Narrow widths, touch, and zoom (#41): the header navigation, a stacked table, a one-column form,
 * the editor at its 768 px floor (select, edit, connect, validate, publish), no sideways page scroll
 * or cut-off control on any screen at 360, 768, 1024, and 1440 px, 44 px targets on a coarse
 * pointer, and reflow at 200% zoom.
 */
import type { Page } from '@playwright/test';
import { approvalLoop, closeNode, expect, publishLoop, test } from './fixtures.js';

const WIDTHS = [
  { width: 360, height: 780 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
];

/** Whether the page scrolls sideways. */
const pageOverflows = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

/**
 * Controls the user can see but cannot fully reach: any visible button, link, or field whose box
 * runs past either side of the window. Canvas nodes and edges are left out (the canvas pans), as
 * are visually hidden controls (one pixel, or clipped).
 */
const cutOffControls = (page: Page) =>
  page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    return [
      ...document.querySelectorAll<HTMLElement>(
        'button, a[href], input:not([type=hidden]), select, textarea, [role=link]',
      ),
    ]
      .filter((el) => {
        if (el.closest('.react-flow__node, .react-flow__edge, .react-flow__edgelabel-renderer'))
          return false;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 1 || rect.height <= 1) return false;
        const style = getComputedStyle(el);
        if (style.visibility === 'hidden' || style.opacity === '0') return false;
        // A transparent file input lies over its button; the button is what is drawn.
        if (el instanceof HTMLInputElement && el.type === 'file') return false;
        return rect.left < -1 || rect.right > width + 1;
      })
      .map((el) => el.getAttribute('aria-label') ?? el.textContent?.trim() ?? el.tagName);
  });

async function seed(request: Parameters<typeof publishLoop>[0]) {
  const loopId = await publishLoop(request, approvalLoop('responsive sweep'));
  const res = await request.post(`/loops/${loopId}/runs`, { data: {} });
  const runId = ((await res.json()) as { run: { id: string } }).run.id;
  await request.post('/events', { data: { type: 'issue.opened', payload: { number: 41 } } });
  return { loopId, runId };
}

test('no screen scrolls sideways or cuts a control off at 360, 768, 1024, and 1440 px', async ({
  page,
  request,
}) => {
  const { loopId, runId } = await seed(request);
  const screens = [
    ['/app/loops', 'responsive sweep'],
    [`/app/loops/${loopId}/edit`, 'Approve'],
    ['/app/runs', 'responsive sweep'],
    [`/app/runs/new?loop=${loopId}`, 'Start run'],
    [`/app/runs/${runId}`, 'Input requested'],
    ['/app/events', 'issue.opened'],
    ['/app/settings', 'Model catalog'],
    ['/app/nowhere', 'Page not found'],
  ] as const;
  for (const viewport of WIDTHS) {
    await page.setViewportSize(viewport);
    for (const [path, ready] of screens) {
      await page.goto(path);
      await expect(page.getByText(ready).filter({ visible: true }).first()).toBeVisible();
      expect(await pageOverflows(page), `${path} at ${viewport.width}`).toBe(false);
      expect(await cutOffControls(page), `${path} at ${viewport.width}`).toEqual([]);
    }
  }
});

test('the header navigation folds into a Menu at 360 px and shows its links at 768 px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/app/loops');
  const menu = page.getByRole('button', { name: 'Menu' });
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(nav.getByRole('link', { name: 'Runs' })).toBeHidden();
  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  for (const name of ['Loops', 'Runs', 'Events', 'Settings']) {
    const link = nav.getByRole('link', { name });
    await expect(link).toBeVisible();
    // Each link is a full-width row at least 44 px tall.
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await nav.getByRole('link', { name: 'Runs' }).click();
  await expect(page).toHaveURL(/\/app\/runs$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Runs' })).toBeVisible();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(nav.getByRole('link', { name: 'Loops' })).toBeHidden();
  // Escape closes it from inside and gives focus back to Menu.
  await menu.click();
  await nav.getByRole('link', { name: 'Loops' }).focus();
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  expect(await pageOverflows(page)).toBe(false);

  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(menu).toBeHidden();
  for (const name of ['Loops', 'Runs', 'Events', 'Settings'])
    await expect(nav.getByRole('link', { name })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Runs' })).toHaveAttribute('aria-current', 'page');
});

test('the runs table stacks its rows below 1024 px, keeping its column headers', async ({
  page,
  request,
}) => {
  const { runId } = await seed(request);
  await page.goto('/app/runs');
  const row = page.getByRole('row').filter({ hasText: runId });
  const status = row.getByRole('cell').filter({ has: page.locator('[data-status]') });
  for (const { width, height } of [
    { width: 360, height: 780 },
    { width: 768, height: 1024 },
  ]) {
    await page.setViewportSize({ width, height });
    await expect(row).toBeVisible();
    // A stacked row: each cell is a line under the previous one, starting with its column name.
    const cells = await row.getByRole('cell').evaluateAll((tds) =>
      tds.map((td) => ({
        display: getComputedStyle(td).display,
        label: getComputedStyle(td, '::before').content,
        top: td.getBoundingClientRect().top,
      })),
    );
    expect(cells.length).toBe(6);
    for (const [i, cell] of cells.entries()) {
      expect(cell.display).not.toBe('table-cell');
      if (i > 0) expect(cell.top).toBeGreaterThan(cells[i - 1]!.top);
    }
    expect(await status.evaluate((td) => getComputedStyle(td, '::before').content)).toContain(
      'Status',
    );
    // The drawn column name is decoration: the cell's name is still only its value.
    await expect(status).not.toHaveAccessibleName(/status/i);
    await expect(status).toHaveAccessibleName(/waiting/);
    // The headers stay for assistive technology, out of sight: their row group is clipped to 1 px.
    const header = page.getByRole('columnheader', { name: 'Status' });
    await expect(header).toHaveCount(1);
    const group = (await header.locator('xpath=ancestor::thead').boundingBox())!;
    expect(Math.max(group.width, group.height)).toBeLessThanOrEqual(1);
    await expect(header.locator('xpath=ancestor::thead')).toHaveCSS('overflow', 'hidden');
    expect(await pageOverflows(page)).toBe(false);
  }
  // From 1024 px it is a table again, its cells side by side.
  await page.setViewportSize({ width: 1024, height: 768 });
  const tops = await row
    .getByRole('cell')
    .evaluateAll((tds) => tds.map((td) => Math.round(td.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
  await expect(status).toHaveCSS('display', 'table-cell');
});

test('a Settings form turns into one column of full-width fields at 360 px', async ({ page }) => {
  await page.goto('/app/settings');
  const form = page.getByRole('form', { name: 'Set secret' });
  const name = form.getByLabel('Name');
  const value = form.getByLabel('Value');
  const submit = form.getByRole('button', { name: 'Set secret' });

  await page.setViewportSize({ width: 360, height: 780 });
  await expect(name).toBeVisible();
  const box = (await form.boundingBox())!;
  const nameBox = (await name.boundingBox())!;
  const valueBox = (await value.boundingBox())!;
  const submitBox = (await submit.boundingBox())!;
  // One column: Value under Name, the button under both, each field the form's full width.
  expect(valueBox.y).toBeGreaterThan(nameBox.y + nameBox.height);
  expect(submitBox.y).toBeGreaterThan(valueBox.y + valueBox.height);
  expect(nameBox.width).toBeGreaterThan(box.width - 2);
  expect(valueBox.width).toBeGreaterThan(box.width - 2);
  // The button keeps its own width at the start of its line.
  expect(submitBox.width).toBeLessThan(box.width / 2);
  expect(Math.abs(submitBox.x - box.x)).toBeLessThan(2);
  expect(await pageOverflows(page)).toBe(false);

  await page.setViewportSize({ width: 768, height: 1024 });
  const wideName = (await name.boundingBox())!;
  const wideValue = (await value.boundingBox())!;
  expect(Math.round(wideValue.y)).toBe(Math.round(wideName.y));
  expect(wideValue.x).toBeGreaterThan(wideName.x + wideName.width);
});

test('at 768 px the editor selects, edits, connects, validates, and publishes a node', async ({
  page,
  request,
}) => {
  // start -> approve, with the exit not yet connected: the loop starts with errors.
  const definition = approvalLoop('responsive editor');
  const created = await request.post('/loops', {
    data: { definition: { ...definition, edges: definition.edges.slice(0, 1) } },
  });
  const loopId = ((await created.json()) as { loop: { id: string } }).loop.id;
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto(`/app/loops/${loopId}/edit`);
  await expect(page.getByTestId('node-approve')).toBeVisible();
  expect(await pageOverflows(page)).toBe(false);
  // Every toolbar action is on screen, wrapped rather than cut off.
  for (const name of [/^Undo/, /^Redo/, /error/, /^Publish$/])
    await expect(page.getByRole('button', { name }).first()).toBeInViewport();
  await expect(page.getByRole('link', { name: 'Open in Runs' })).toBeInViewport();

  // Validate: the unconnected exit shows as errors beside Publish.
  const indicator = page.getByRole('button', { name: /\d+ errors?/ });
  await expect(indicator).toBeVisible();

  // Select and edit: a click opens the node's editor; rename its label.
  await page.getByTestId('node-approve').click({ position: { x: 60, y: 12 } });
  const dialog = page.getByRole('dialog', { name: 'Edit wait approve' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Label', { exact: true }).fill('Approve release');
  await closeNode(page);
  await expect(page.getByTestId('node-approve')).toContainText('Approve release');
  await expect(page.locator('.react-flow__node[data-id="approve"]')).toHaveClass(/selected/);

  // Connect: drag from the wait's output port to the exit's input on the canvas.
  await page.locator('.react-flow__controls-fitview').click();
  const from = page.locator('.react-flow__handle[data-nodeid="approve"][data-handleid="out"]');
  const to = page.locator('.react-flow__handle[data-nodeid="done"][data-handleid="in"]');
  await from.dragTo(to);
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);

  // Validated: nothing left to fix, then published.
  await expect(page.getByText('Ready to publish')).toBeVisible();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Published version 1.')).toBeVisible();

  // The loop panel floats over the canvas below 1024 px instead of narrowing it.
  const canvas = page.getByTestId('canvas');
  const before = (await canvas.boundingBox())!.width;
  await page.getByRole('button', { name: 'Show loop settings' }).click();
  const panel = page.getByRole('complementary', { name: 'Loop settings' });
  await expect(panel).toHaveCSS('position', 'absolute');
  expect((await canvas.boundingBox())!.width).toBeGreaterThanOrEqual(before);
  expect(await pageOverflows(page)).toBe(false);
});

/**
 * Visible buttons, fields, and links smaller than 44 px each way. A control that keeps a small
 * look counts by the touch box around it (`touch-target`, an absolute ::after).
 */
const smallTargets = (page: Page) =>
  page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        'button, a[href], [role=link], input:not([type=checkbox]):not([type=radio]):not([type=file]), select',
      ),
    ]
      .filter((el) => {
        if (el.closest('.react-flow__node, .react-flow__edge')) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 1 && rect.height > 1 && getComputedStyle(el).visibility !== 'hidden';
      })
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        const after = getComputedStyle(el, '::after');
        const touch =
          after.content !== 'none' && after.position === 'absolute'
            ? { width: parseFloat(after.width), height: parseFloat(after.height) }
            : { width: rect.width, height: rect.height };
        return Math.min(touch.width, touch.height) < 43.5;
      })
      .map((el) => el.getAttribute('aria-label') ?? el.textContent?.trim() ?? el.tagName),
  );

test('on a coarse pointer the controls are at least 44 px', async ({
  browser,
  baseURL,
  request,
}) => {
  const { loopId, runId } = await seed(request);
  const context = await browser.newContext({
    baseURL: baseURL as string,
    viewport: { width: 768, height: 1024 },
    hasTouch: true,
    isMobile: true,
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  try {
    for (const [path, ready] of [
      ['/app/settings', 'GPT-5.5'],
      ['/app/loops', 'responsive sweep'],
      [`/app/loops/${loopId}/edit`, 'Approve'],
      ['/app/runs', 'responsive sweep'],
      [`/app/runs/${runId}`, 'Input requested'],
      ['/app/events', 'issue.opened'],
    ] as const) {
      await page.goto(path);
      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
      await expect(page.getByText(ready).filter({ visible: true }).first()).toBeVisible();
      expect(await smallTargets(page), path).toEqual([]);
    }
    // The theme's segments (radios drawn as labelled segments).
    await page.goto('/app/settings');
    const segment = page.getByRole('radio', { name: 'Dark' }).locator('xpath=..');
    expect((await segment.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  } finally {
    await context.close();
  }
});

test('at 200% zoom (1024 by 768 px) Loops, the editor, a run, and Settings reflow without sideways scrolling', async ({
  page,
  request,
}) => {
  const { loopId, runId } = await seed(request);
  // 200% zoom of a 1024 by 768 window lays the page out in 512 by 384 CSS pixels.
  await page.setViewportSize({ width: 512, height: 384 });
  for (const [path, ready] of [
    ['/app/loops', 'responsive sweep'],
    [`/app/loops/${loopId}/edit`, 'Approve'],
    [`/app/runs/${runId}`, 'Input requested'],
    ['/app/settings', 'Model catalog'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByText(ready).filter({ visible: true }).first()).toBeVisible();
    expect(await pageOverflows(page), path).toBe(false);
    expect(await cutOffControls(page), path).toEqual([]);
  }
  // The editor keeps a usable canvas and its Publish button at that size.
  await page.goto(`/app/loops/${loopId}/edit`);
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeVisible();
  expect((await page.getByTestId('canvas').boundingBox())!.height).toBeGreaterThan(120);
});
