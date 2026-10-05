/**
 * Regression specs for #15: validation issues as a badge with a popover on each node, the same
 * badge beside the node editor's title, and the loop's counts beside Publish, in a real browser:
 * hover and keyboard paths, the top layer, placement at the viewport's edge, and dragging, which
 * jsdom cannot show.
 */
import type { APIRequestContext, Page } from '@playwright/test';
import { approvalLoop, closeNode, expect, openNode, test } from './fixtures.js';

async function createLoop(request: APIRequestContext, definition: unknown): Promise<string> {
  const created = await request.post('/loops', { data: { definition } });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { loop: { id: string } }).loop.id;
}

const card = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const badge = (page: Page, id: string) =>
  card(page, id).getByRole('button', { name: new RegExp(`^\\d+ issues? on ${id}$`) });
const popover = (page: Page, id: string) => page.getByRole('dialog', { name: `Issues on ${id}` });

const mutate = (id: string, ui: { x: number; y: number }) => ({
  id,
  kind: 'mutate',
  label: id,
  config: { operations: [{ op: 'append-message', role: 'note', content: 'x' }] },
  ui,
});

/**
 * The approval loop plus nodes with one issue (a warning), two errors, and an error with a
 * warning: `done`'s criterion is above the loop's ceiling, `stray` is unconnected and unreachable,
 * and `late` is an unreachable exit whose criterion is above the ceiling too.
 */
function issuesLoop(name: string) {
  const loop = approvalLoop(name);
  const aboveCeiling = { criteria: [{ when: 'max-iterations', value: 99 }] };
  return {
    ...loop,
    nodes: [
      ...loop.nodes.map((n) => (n.id === 'done' ? { ...n, config: aboveCeiling } : n)),
      mutate('stray', { x: 260, y: 260 }),
      { id: 'late', kind: 'exit', label: 'Late', config: aboveCeiling, ui: { x: 520, y: 260 } },
    ],
  };
}

/** Open the trigger's editor and type text that is not JSON into its input schema. */
async function breakInputSchema(page: Page): Promise<void> {
  await openNode(page, 'start');
  await page.locator('[data-field="inputSchema"] .cm-content').click();
  await page.keyboard.type('{"type": ');
  await closeNode(page);
}

test('badges count each node’s issues and tell errors from warnings by more than colour', async ({
  page,
  request,
}) => {
  const loopId = await createLoop(request, issuesLoop('qa badges'));
  await page.goto(`/app/loops/${loopId}/edit`);
  // One issue: the icon alone (the name carries the count); a warning is a triangle.
  const done = badge(page, 'done');
  await expect(done).toHaveAccessibleName('1 issue on done');
  await expect(done).toHaveText('');
  await expect(done.locator('svg')).toHaveAttribute('data-icon', 'alert');
  // Several: the count too; any error makes it a cross.
  await expect(badge(page, 'stray')).toHaveAccessibleName('2 issues on stray');
  await expect(badge(page, 'stray')).toHaveText('2');
  await expect(badge(page, 'stray').locator('svg')).toHaveAttribute('data-icon', 'failed');
  const late = badge(page, 'late');
  await expect(late).toHaveAccessibleName('2 issues on late');
  await expect(late.locator('svg')).toHaveAttribute('data-icon', 'failed');
  await expect(card(page, 'start').getByRole('button')).toHaveCount(0);
  // At least 24 px across, before the canvas zoom.
  const size = await done.evaluate((el: HTMLElement) => [el.offsetWidth, el.offsetHeight]);
  expect(Math.min(...size)).toBeGreaterThanOrEqual(24);
  // The counts beside Publish come from the same list.
  await expect(page.getByRole('button', { name: '3 errors, 2 warnings' })).toBeVisible();

  // Mixed: the popover says which is which, in words as well as icons.
  await late.click();
  const list = popover(page, 'late');
  await expect(list).toContainText('1 error, 1 warning on late');
  await expect(list.getByRole('button', { name: /^Error NODE_UNREACHABLE/ })).toBeVisible();
  await expect(
    list.getByRole('button', { name: /^Warning CRITERION_ABOVE_CEILING/ }),
  ).toBeVisible();
});

test('hover: the popover opens, stays while the pointer is in it, and choosing an issue focuses its field', async ({
  page,
  request,
}) => {
  const loopId = await createLoop(request, approvalLoop('qa badge hover'));
  await page.goto(`/app/loops/${loopId}/edit`);
  await breakInputSchema(page);
  const start = badge(page, 'start');
  await expect(start).toHaveAccessibleName('1 issue on start');

  await start.hover();
  const list = popover(page, 'start');
  await expect(list).toBeVisible();
  await expect(start).toHaveAttribute('aria-expanded', 'true');
  // In the top layer, and not scaled by the canvas.
  expect(await list.evaluate((el) => el.matches(':popover-open'))).toBe(true);
  // The pointer moves into it: it stays, well past the grace period.
  const row = list.getByRole('button', { name: /FIELD_UNPARSED/ });
  await expect(row).toContainText('config.inputSchema');
  await row.hover();
  await page.waitForTimeout(600);
  await expect(list).toBeVisible();
  // Leaving both closes it shortly after.
  await page.mouse.move(700, 120);
  await expect(list).toBeHidden();

  // Hover again and choose the issue: the node opens with the field focused.
  await start.hover();
  await row.click();
  const editor = page.getByRole('dialog', { name: 'Edit trigger start' });
  await expect(editor).toBeVisible();
  await expect(editor.locator('[data-field="inputSchema"] .cm-content')).toBeFocused();
  await expect(list).toBeHidden();
  // The editor's own badge, beside its title, lists it too.
  await expect(editor.getByRole('button', { name: '1 issue on start' })).toBeVisible();
});

test('keyboard: Tab to the badge opens it, Enter keeps it, the arrow keys reach a row, Esc closes it', async ({
  page,
  request,
}) => {
  const loopId = await createLoop(request, approvalLoop('qa badge keys'));
  await page.goto(`/app/loops/${loopId}/edit`);
  await breakInputSchema(page);
  const start = badge(page, 'start');
  const list = popover(page, 'start');
  const row = list.getByRole('button', { name: /FIELD_UNPARSED/ });

  // From the node, Tab reaches its badge, which opens the popover on focus.
  await card(page, 'start').focus();
  await page.keyboard.press('Tab');
  await expect(start).toBeFocused();
  await expect(list).toBeVisible();
  // Enter keeps it open (a second Enter would close it); ArrowDown moves into it.
  await page.keyboard.press('Enter');
  await expect(list).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(row).toBeFocused();
  // Esc closes it and puts focus back on the badge.
  await page.keyboard.press('Escape');
  await expect(list).toBeHidden();
  await expect(start).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Tab moves from the badge into the list, as it comes next; Enter chooses.
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(list).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(row).toBeFocused();
  await page.keyboard.press('Enter');
  const editor = page.getByRole('dialog', { name: 'Edit trigger start' });
  await expect(editor).toBeVisible();
  await expect(editor.locator('[data-field="inputSchema"] .cm-content')).toBeFocused();

  // In the editor, the badge's popover closes on Esc without closing the editor.
  await editor.getByRole('button', { name: '1 issue on start' }).click();
  await expect(page.getByRole('dialog', { name: 'Issues on start' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Issues on start' })).toBeHidden();
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('button', { name: '1 issue on start' })).toBeFocused();
});

test('Discard text in the popover drops unparsed text and its issue', async ({ page, request }) => {
  const loopId = await createLoop(request, approvalLoop('qa badge discard'));
  await page.goto(`/app/loops/${loopId}/edit`);
  await breakInputSchema(page);
  await expect(page.getByRole('button', { name: '1 error' })).toBeVisible();
  await badge(page, 'start').click();
  await popover(page, 'start')
    .getByRole('button', { name: 'Discard unparsed text at inputSchema' })
    .click();
  await expect(badge(page, 'start')).toHaveCount(0);
  await expect(page.getByText('Ready to publish')).toBeVisible();
  // The badge went with its last issue: focus is on the node, not lost.
  await expect(card(page, 'start')).toBeFocused();
  const editor = await openNode(page, 'start');
  await expect(editor.locator('[data-field="inputSchema"] .cm-content')).not.toContainText('type');
});

test('an issue only the server finds (a bad cron expression) shows on the badge after a save', async ({
  page,
  request,
}) => {
  const loopId = await createLoop(request, {
    schemaVersion: 1,
    name: 'qa badge cron',
    nodes: [
      {
        id: 'nightly',
        kind: 'trigger',
        label: 'Nightly',
        config: { subtype: 'cron', expression: '0 2 * * *' },
        ui: { x: 0, y: 80 },
      },
      { id: 'done', kind: 'exit', label: 'Done', config: {}, ui: { x: 320, y: 80 } },
    ],
    edges: [{ id: 'e1', from: { node: 'nightly', port: 'out' }, to: { node: 'done' } }],
  });
  await page.goto(`/app/loops/${loopId}/edit`);
  await expect(page.getByText('Ready to publish')).toBeVisible();
  const editor = await openNode(page, 'nightly');
  await editor.getByLabel('Expression').fill('every night');
  await closeNode(page);
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
  const nightly = badge(page, 'nightly');
  await expect(nightly).toHaveAccessibleName('1 issue on nightly');
  await expect(page.getByRole('button', { name: '1 error' })).toBeVisible();
  await nightly.click();
  const row = popover(page, 'nightly').getByRole('button', { name: /CRON_INVALID/ });
  await expect(row).toContainText('cron trigger "nightly"');
  const message = (await row.locator('span.text-sm').textContent()) ?? '';
  await page.keyboard.press('Escape');
  // Publish refuses with the same message.
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Publish failed')).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Publish failed' })).toContainText(
    message,
  );
});

test('loop-level issues stay in sight beside Publish, which refuses with the same message', async ({
  page,
  request,
}) => {
  const loopId = await createLoop(request, {
    schemaVersion: 1,
    name: 'qa badge no exit',
    nodes: [
      {
        id: 'start',
        kind: 'trigger',
        label: 'Start',
        config: { subtype: 'manual' },
        ui: { x: 0, y: 80 },
      },
    ],
    edges: [],
  });
  await page.goto(`/app/loops/${loopId}/edit`);
  const indicator = page.getByRole('button', { name: '3 errors' });
  await indicator.hover();
  const list = page.getByRole('dialog', { name: 'Loop issues' });
  await expect(list).toBeVisible();
  const loopGroup = list.getByRole('group', { name: 'Loop and connections' });
  await expect(loopGroup).toContainText('NO_EXIT');
  await expect(loopGroup).toContainText('a loop needs at least one exit node');
  await expect(list.getByRole('group', { name: 'Nodes' }).getByRole('button')).toHaveText([
    'start: 2 issues',
  ]);
  await page.keyboard.press('Escape');
  await expect(list).toBeHidden();
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Publish failed' })).toContainText(
    'a loop needs at least one exit node',
  );

  // A node row opens that node.
  await indicator.click();
  await list.getByRole('button', { name: 'start: 2 issues' }).click();
  await expect(page.getByRole('dialog', { name: 'Edit trigger start' })).toBeVisible();
});

test('a popover by the viewport’s edge stays inside it and never covers its badge', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 900, height: 600 });
  const loopId = await createLoop(request, {
    ...approvalLoop('qa badge edge'),
    nodes: [...approvalLoop('x').nodes, mutate('corner', { x: 760, y: 460 })],
  });
  await page.goto(`/app/loops/${loopId}/edit`);
  const corner = badge(page, 'corner');
  await corner.click();
  const list = popover(page, 'corner');
  await expect(list).toBeVisible();
  const pop = (await list.boundingBox())!;
  const own = (await corner.boundingBox())!;
  expect(pop.x).toBeGreaterThanOrEqual(0);
  expect(pop.y).toBeGreaterThanOrEqual(0);
  expect(pop.x + pop.width).toBeLessThanOrEqual(900);
  expect(pop.y + pop.height).toBeLessThanOrEqual(600);
  const overlaps =
    pop.x < own.x + own.width &&
    own.x < pop.x + pop.width &&
    pop.y < own.y + own.height &&
    own.y < pop.y + pop.height;
  expect(overlaps).toBe(false);
  // Near the bottom it opens above its badge.
  if (own.y > 300) expect(pop.y + pop.height).toBeLessThanOrEqual(own.y);
});

test('dragging a node with its popover open moves the node and closes the popover', async ({
  page,
  request,
}) => {
  const loopId = await createLoop(request, issuesLoop('qa badge drag'));
  await page.goto(`/app/loops/${loopId}/edit`);
  const stray = badge(page, 'stray');
  await stray.click();
  const list = popover(page, 'stray');
  await expect(list).toBeVisible();
  // Pressing the badge started no drag and opened no editor.
  await expect(page.getByRole('dialog', { name: /^Edit / })).toHaveCount(0);

  const node = card(page, 'stray');
  const before = (await node.boundingBox())!;
  await page.mouse.move(before.x + 60, before.y + 12);
  await page.mouse.down();
  await page.mouse.move(before.x + 100, before.y + 60, { steps: 6 });
  await page.mouse.move(before.x + 160, before.y + 120, { steps: 6 });
  await page.mouse.up();
  await expect(list).toBeHidden();
  const after = (await node.boundingBox())!;
  expect(after.x - before.x).toBeGreaterThan(50);
  expect(after.y - before.y).toBeGreaterThan(50);
  await expect(page.getByRole('dialog', { name: /^Edit / })).toHaveCount(0);

  // A zoom closes it too, and a zoomed canvas does not scale it (it is in the top layer).
  await page.locator('.react-flow__controls-zoomin').click();
  await page.locator('.react-flow__controls-zoomin').click();
  await stray.click();
  await expect(list).toBeVisible();
  const scale = await list.evaluate(
    (el: HTMLElement) => el.getBoundingClientRect().width / el.offsetWidth,
  );
  expect(scale).toBeCloseTo(1, 2);
  await page.mouse.move(1000, 860);
  await page.mouse.wheel(0, 300);
  await expect(list).toBeHidden();
});
