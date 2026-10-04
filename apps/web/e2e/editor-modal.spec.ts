/**
 * Regression specs for #13 (a node's editor in a modal dialog, the collapsible loop panel) and #46
 * (runs start only from Runs), against the built app in a real browser: pointer drags, the top
 * layer and inert page, focus, and storage that jsdom cannot show.
 */
import type { APIRequestContext, Page } from '@playwright/test';
import { approvalLoop, closeNode, expect, openNode, publishLoop, test } from './fixtures.js';

async function createLoop(request: APIRequestContext, definition: unknown): Promise<string> {
  const created = await request.post('/loops', { data: { definition } });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { loop: { id: string } }).loop.id;
}

const card = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);

/** The approval loop with a manual trigger that requires a repository name. */
function inputLoop(name: string) {
  const loop = approvalLoop(name);
  const start = {
    id: 'start',
    kind: 'trigger',
    label: 'Start',
    config: {
      subtype: 'manual',
      inputSchema: {
        type: 'object',
        properties: { repo: { type: 'string' } },
        required: ['repo'],
      },
    },
    ui: { x: 0, y: 80 },
  };
  return { ...loop, nodes: [start, ...loop.nodes.slice(1)] };
}

test('a click opens the node editor; a drag moves the node and opens nothing', async ({
  page,
  request,
}) => {
  const loopId = await createLoop(request, approvalLoop('qa modal pointer'));
  await page.goto(`/app/loops/${loopId}/edit`);
  const node = card(page, 'approve');
  await expect(node).toBeVisible();
  const before = (await node.boundingBox())!;

  // A drag well past the click distance: the node moves, no dialog.
  await page.mouse.move(before.x + 60, before.y + 12);
  await page.mouse.down();
  await page.mouse.move(before.x + 100, before.y + 50, { steps: 6 });
  await page.mouse.move(before.x + 160, before.y + 110, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const after = (await node.boundingBox())!;
  expect(after.x - before.x).toBeGreaterThan(50);
  expect(after.y - before.y).toBeGreaterThan(50);
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved');

  // A click on a port handle opens nothing either (it starts or ends a connection).
  await page
    .locator('.react-flow__handle[data-nodeid="approve"][data-handleid="out"]')
    .click({ force: true });
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // A click without a drag opens the editor: named, modal, focus on its heading.
  await node.click({ position: { x: 60, y: 12 } });
  const dialog = page.getByRole('dialog', { name: 'Edit wait approve' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  expect(await dialog.evaluate((d) => d.matches(':modal'))).toBe(true);
  await expect(dialog.getByRole('heading', { name: 'Edit wait approve' })).toBeFocused();
  // The page behind is inert (Publish cannot take focus), and a click on the backdrop closes the
  // editor (edits are saved as they are made); focus goes back to the node.
  const publishFocusable = () =>
    page.getByRole('button', { name: 'Publish' }).evaluate((button) => {
      (button as HTMLButtonElement).focus();
      return document.activeElement === button;
    });
  expect(await publishFocusable()).toBe(false);
  await page.mouse.click(20, 400);
  await expect(dialog).toHaveCount(0);
  await expect(node).toBeFocused();
  expect(await publishFocusable()).toBe(true);
});

test('keyboard: Enter opens, Tab stays inside, Delete edits text only, Esc closes back to the node', async ({
  page,
  request,
}) => {
  const loopId = await createLoop(request, approvalLoop('qa modal keys'));
  await page.goto(`/app/loops/${loopId}/edit`);
  const node = card(page, 'approve');
  await node.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Edit wait approve' });
  await expect(dialog).toBeVisible();
  // Enter did not also press a control inside the dialog.
  await expect(dialog.getByRole('heading', { name: 'Edit wait approve' })).toBeFocused();

  // Shift+Tab from the top wraps to the last control, Tab from it back to the first.
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Done' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByLabel('Node id')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByLabel('Label')).toBeFocused();

  // Delete and Backspace in a field edit its text; on a button they do nothing (WP-D2 D19).
  await page.keyboard.press('End');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Delete');
  await expect(dialog.getByLabel('Label')).toHaveValue('Approv');
  await dialog.getByRole('button', { name: 'Done' }).focus();
  await page.keyboard.press('Delete');
  await page.keyboard.press('Backspace');
  await expect(dialog).toBeVisible();
  await expect(card(page, 'approve')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(node).toBeFocused();
  await expect(node.getByText('Approv', { exact: true })).toBeVisible();

  // Delete node in the editor removes it and closes the editor; focus goes to the canvas.
  await page.keyboard.press('Enter');
  await page.getByRole('dialog').getByRole('button', { name: 'Delete node' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(card(page, 'approve')).toHaveCount(0);
  await expect(page.getByTestId('canvas')).toBeFocused();
});

test('below 768 px the node editor is a full-width sheet along the bottom edge', async ({
  page,
  request,
}) => {
  const loopId = await createLoop(request, approvalLoop('qa modal sheet'));
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 767, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`/app/loops/${loopId}/edit`);
    // The canvas is narrow here (#41): open the node from the keyboard.
    await card(page, 'start').focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Edit trigger start' });
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBe(0);
    expect(Math.round(box.width)).toBe(viewport.width);
    expect(Math.round(box.y + box.height)).toBe(viewport.height);
    await closeNode(page);
  }
  // At 768 px and wider it is a centred dialog.
  await page.setViewportSize({ width: 1024, height: 768 });
  await card(page, 'start').focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Edit trigger start' });
  await expect(dialog).toBeVisible();
  const box = (await dialog.boundingBox())!;
  expect(box.x).toBeGreaterThan(100);
  expect(box.y).toBeGreaterThan(10);
});

test('the loop panel collapses and expands from Loop settings and is remembered', async ({
  page,
  request,
}) => {
  const loopId = await createLoop(request, approvalLoop('qa loop panel'));
  await page.goto(`/app/loops/${loopId}/edit`);
  const toggle = page.getByRole('button', { name: 'Loop settings' });
  // 1440 px wide: expanded, with the settings and the validation list.
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('qa loop panel');
  await expect(page.getByRole('region', { name: 'Validation' })).toContainText('Ready to publish');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByLabel('Name', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Show loop' })).toBeVisible();
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  await toggle.click();
  await expect(page.getByRole('heading', { name: 'Loop', exact: true })).toBeFocused();
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  // A fresh browser at 1024 px starts collapsed; storage that throws changes nothing visible.
  const narrow = await page
    .context()
    .browser()!
    .newContext({
      baseURL: process.env['GG_E2E_BASE_URL'] ?? '',
      viewport: { width: 1024, height: 768 },
    });
  await narrow.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
  });
  const small = await narrow.newPage();
  const errors: string[] = [];
  small.on('pageerror', (error) => errors.push(error.message));
  await small.goto(`/app/loops/${loopId}/edit`);
  const smallToggle = small.getByRole('button', { name: 'Loop settings' });
  await expect(smallToggle).toHaveAttribute('aria-expanded', 'false');
  await smallToggle.click();
  await expect(smallToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(small.getByLabel('Name', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  await narrow.close();
});

test('runs start from Runs: the editor links there, disabled with a reason until published', async ({
  page,
  request,
}) => {
  const draftId = await createLoop(request, inputLoop('qa runs draft'));
  await page.goto(`/app/loops/${draftId}/edit`);
  const disabled = page.getByRole('link', { name: 'Open in Runs' });
  await expect(disabled).toHaveAttribute('aria-disabled', 'true');
  await expect(disabled).toHaveAccessibleDescription(/Publish the loop first/);
  // Playwright will not click a disabled control on its own; a forced click does nothing either.
  await disabled.click({ force: true });
  await expect(page).toHaveURL(new RegExp(`/app/loops/${draftId}/edit$`));
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toHaveCount(0);

  // An unpublished loop's deep link explains itself.
  await page.goto(`/app/runs/new?loop=${draftId}`);
  await expect(page.getByText('“qa runs draft” has no published version')).toBeVisible();

  const loopId = await publishLoop(request, inputLoop('qa runs published'));
  await page.goto(`/app/loops/${loopId}/edit`);
  await page.getByRole('link', { name: 'Open in Runs' }).click();
  await expect(page).toHaveURL(new RegExp(`/app/runs/new\\?loop=${loopId}$`));
  // A reload keeps the loop chosen.
  await page.reload();
  await expect(page.getByLabel('Loop')).toHaveValue(loopId);
  await expect(page.getByLabel('Version')).toContainText('v1 (current)');

  // The input is checked against the trigger's schema before anything starts.
  await page.getByRole('button', { name: 'Start run' }).click();
  await expect(page.getByRole('alert')).toContainText('repo');
  await expect(page).toHaveURL(/\/app\/runs\/new\?loop=/);
  await page.getByLabel('repo').fill('graphgoblin');
  await page.getByRole('button', { name: 'Start run' }).click();
  await expect(page).toHaveURL(/\/app\/runs\/[0-9A-Z]{26}$/);
  await expect(page.getByText('Input requested')).toBeVisible();

  // Runs' own New run action, filtered to this loop, starts another one alongside.
  await page.goto(`/app/runs?loop=${loopId}`);
  await page.getByRole('link', { name: 'New run' }).click();
  await expect(page.getByLabel('Loop')).toHaveValue(loopId);
  await page.getByLabel('repo').fill('second');
  await page.getByRole('button', { name: 'Start run' }).click();
  await expect(page).toHaveURL(/\/app\/runs\/[0-9A-Z]{26}$/);
  const runs = (await (await request.get(`/runs?loopId=${loopId}`)).json()) as {
    items: { status: string }[];
  };
  expect(runs.items).toHaveLength(2);
});

test('a draft conflict is answered from inside an open node editor', async ({
  context,
  request,
}) => {
  const loopId = await createLoop(request, approvalLoop('qa modal conflict'));
  const a = await context.newPage();
  const b = await context.newPage();
  await a.goto(`/app/loops/${loopId}/edit`);
  await b.goto(`/app/loops/${loopId}/edit`);
  await expect(b.getByRole('heading', { name: 'qa modal conflict' })).toBeVisible();

  // Tab B opens a node; tab A saves first.
  const dialog = await openNode(b, 'approve');
  await a.getByLabel('Description').fill('from tab A');
  await expect(a.getByTestId('save-state')).toHaveText('All changes saved');

  // Tab B edits in the dialog: refused, and asked inside the dialog, where it can answer.
  await dialog.getByLabel('Label').fill('Approve in B');
  await expect(dialog.getByText('The draft changed on the server')).toBeVisible();
  await expect(b.getByTestId('save-state')).toHaveText('Draft changed elsewhere');
  await dialog.getByRole('button', { name: 'Reload server draft' }).click();
  await expect(b.getByRole('dialog')).toHaveCount(0);
  await expect(b.getByLabel('Description')).toHaveValue('from tab A');
  await expect(card(b, 'approve').getByText('Approve', { exact: true })).toBeVisible();
});
