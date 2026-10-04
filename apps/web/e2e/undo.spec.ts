/**
 * Regression specs for #17, undo and redo in the loop editor, against the built app in a real
 * browser: the shortcuts on each platform, the toolbar buttons, native text undo inside fields and
 * CodeMirror, a pointer drag as one step, deletion and rename, the draft saves an undo makes, a
 * draft conflict, and the 100-step limit.
 */
import type { APIRequestContext, Page, Request } from '@playwright/test';
import { approvalLoop, expect, openNode, showLoopPanel, test } from './fixtures.js';

async function createLoop(request: APIRequestContext, definition: unknown): Promise<string> {
  const created = await request.post('/loops', { data: { definition } });
  expect(created.status()).toBe(201);
  return ((await created.json()) as { loop: { id: string } }).loop.id;
}

interface Definition {
  name: string;
  description?: string;
  nodes: { id: string; label: string; config: Record<string, unknown> }[];
  edges: { from: { node: string; port: string }; to: { node: string } }[];
}

async function serverDraft(request: APIRequestContext, loopId: string) {
  const body = (await (await request.get(`/loops/${loopId}`)).json()) as {
    draft: { definition: Definition };
    draftToken: string;
  };
  return body;
}

const card = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
const undoButton = (page: Page) => page.getByRole('button', { name: /^Undo/ });
const redoButton = (page: Page) => page.getByRole('button', { name: /^Redo/ });

/** Every draft save the page sends, in order. */
function draftSaves(page: Page, loopId: string): Request[] {
  const saves: Request[] = [];
  page.on('request', (request) => {
    if (request.method() === 'PUT' && request.url().endsWith(`/loops/${loopId}/draft`))
      saves.push(request);
  });
  return saves;
}

/** The approval loop, with the exit looping back to the wait node. */
function loopBackLoop(name: string) {
  const loop = approvalLoop(name);
  return {
    ...loop,
    nodes: loop.nodes.map((node) =>
      node.id === 'done'
        ? {
            ...node,
            config: {
              criteria: [{ when: 'max-iterations', value: 3 }],
              default: 'loop-back',
              loopBack: { targetNodeId: 'approve' },
            },
          }
        : node,
    ),
    edges: [
      ...loop.edges,
      { id: 'e3', from: { node: 'done', port: 'loopBack' }, to: { node: 'approve' } },
    ],
  };
}

test('undo and redo from the toolbar and the keys, saved like any edit', async ({
  page,
  request,
}) => {
  const loopId = await createLoop(request, approvalLoop('qa undo basics'));
  const saves = draftSaves(page, loopId);
  await page.goto(`/app/loops/${loopId}/edit`);
  await expect(card(page, 'approve')).toBeVisible();
  const undo = undoButton(page);
  const redo = redoButton(page);
  await expect(undo).toHaveAccessibleName('Undo');
  await expect(undo).toHaveAttribute('aria-disabled', 'true');
  await expect(undo).toHaveAttribute('aria-keyshortcuts', 'Control+Z');
  await expect(redo).toHaveAttribute('aria-keyshortcuts', 'Control+Shift+Z Control+Y');

  // A fresh loop has nothing to undo: the keys change and save nothing.
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(900);
  expect(saves).toHaveLength(0);
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved');

  // Add a node; undo it from the toolbar; the keys work with focus on the toolbar too.
  await page.getByRole('button', { name: 'Add Wait node' }).click();
  await expect(card(page, 'wait')).toBeVisible();
  await expect(undo).toHaveAccessibleName('Undo add wait');
  await expect(undo).toHaveAttribute('title', 'Undo add wait');
  await undo.click();
  await expect(card(page, 'wait')).toHaveCount(0);
  await expect(undo).toHaveAttribute('aria-disabled', 'true');
  await expect(redo).toHaveAccessibleName('Redo add wait');
  await expect(undo).toBeFocused();
  await page.keyboard.press('Control+Shift+z');
  await expect(card(page, 'wait')).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(card(page, 'wait')).toHaveCount(0);
  await page.keyboard.press('Control+y');
  await expect(card(page, 'wait')).toBeVisible();

  // Keyboard operable with a visible focus ring.
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(undo).toBeFocused();
  expect(await undo.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
  await page.keyboard.press('Enter');
  await expect(card(page, 'wait')).toHaveCount(0);

  // The undo is saved with If-Match, and the server draft is the restored definition.
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
  const last = saves.at(-1)!;
  expect(last.headers()['if-match']).toMatch(/^".+"$/);
  expect((last.postDataJSON() as { definition: Definition }).definition.nodes).toHaveLength(3);
  const { draft } = await serverDraft(request, loopId);
  expect(draft.definition.nodes.map((n) => n.id)).toEqual(['start', 'approve', 'done']);

  // A new edit after an undo leaves nothing to redo.
  await expect(redo).toHaveAccessibleName('Redo add wait');
  await page.getByRole('button', { name: 'Add Exit node' }).click();
  await expect(redo).toHaveAccessibleName('Redo');
  await expect(redo).toHaveAttribute('aria-disabled', 'true');
});

test('each pointer drag undoes and redoes in one step', async ({ page, request }) => {
  const loopId = await createLoop(request, approvalLoop('qa undo drag'));
  await page.goto(`/app/loops/${loopId}/edit`);
  const node = card(page, 'approve');
  await expect(node).toBeVisible();
  const at = async () => {
    const box = (await node.boundingBox())!;
    return { x: Math.round(box.x), y: Math.round(box.y) };
  };
  const before = await at();
  await page.mouse.move(before.x + 60, before.y + 12);
  await page.mouse.down();
  await page.mouse.move(before.x + 100, before.y + 50, { steps: 6 });
  await page.mouse.move(before.x + 160, before.y + 110, { steps: 6 });
  await page.mouse.up();
  const first = await at();
  expect(first.x - before.x).toBeGreaterThan(50);
  await expect(undoButton(page)).toHaveAccessibleName('Undo move approve');
  // A second drag of the same node straight after: a step of its own.
  await page.mouse.move(first.x + 60, first.y + 12);
  await page.mouse.down();
  await page.mouse.move(first.x + 120, first.y + 12, { steps: 6 });
  await page.mouse.up();
  const second = await at();
  expect(second.x - first.x).toBeGreaterThan(30);

  await page.keyboard.press('Control+z');
  await expect.poll(at).toEqual(first);
  await page.keyboard.press('Control+z');
  await expect.poll(at).toEqual(before);
  // Each drag was one step.
  await expect(undoButton(page)).toHaveAccessibleName('Undo');
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(at).toEqual(first);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(at).toEqual(second);
});

test('inside a text field or CodeMirror the keys undo only that field’s text', async ({
  page,
  request,
}) => {
  const loopId = await createLoop(request, approvalLoop('qa undo native'));
  await page.goto(`/app/loops/${loopId}/edit`);
  // A change on the canvas first, which an editor-level undo would take back.
  await page.getByRole('button', { name: 'Add Wait node' }).click();
  await expect(card(page, 'wait')).toBeVisible();

  const dialog = await openNode(page, 'approve');
  const label = dialog.getByLabel('Label');
  await label.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' now');
  await expect(label).toHaveValue('Approve now');
  // The browser's own undo takes back the typing (how much per press is the browser's choice:
  // the word, or the word and the space), and the canvas keeps the added node.
  await page.keyboard.press('Control+z');
  await expect(label).toHaveValue(/^Approve ?$/);
  await expect(card(page, 'wait')).toHaveCount(1);
  await expect(card(page, 'approve').getByText('Approve now')).toHaveCount(0);

  const prompt = dialog.locator('[data-field="prompt"] .cm-content');
  await prompt.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' Really?');
  await expect(prompt).toHaveText('Approve? Really?');
  await page.keyboard.press('Control+z');
  await expect(prompt).toHaveText('Approve?');
  await expect(card(page, 'wait')).toHaveCount(1);
});

test('typing a label, then Ctrl+Z outside the field, restores the label in one step', async ({
  page,
  request,
}) => {
  const loopId = await createLoop(request, approvalLoop('qa undo label'));
  await page.goto(`/app/loops/${loopId}/edit`);
  const dialog = await openNode(page, 'approve');
  const label = dialog.getByLabel('Label');
  await label.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('hello');
  await expect(card(page, 'approve').getByText('hello', { exact: true })).toBeVisible();
  // Leave the field for a control that is not one: the editor's undo takes over.
  await dialog.getByRole('button', { name: 'Done' }).focus();
  await expect(undoButton(page)).toHaveAccessibleName('Undo edit label of approve');
  await page.keyboard.press('Control+z');
  await expect(label).toHaveValue('Approve');
  await expect(card(page, 'approve').getByText('Approve', { exact: true })).toBeVisible();
  await expect(undoButton(page)).toHaveAccessibleName('Undo');
  await page.keyboard.press('Control+Shift+z');
  await expect(label).toHaveValue('hello');
  await expect(dialog.getByRole('button', { name: 'Done' })).toBeFocused();

  // Unparsed JSON typed into a field goes with its step; focus stays in the field, whose form
  // remounted with the restored value.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const start = await openNode(page, 'start');
  await start.locator('[data-field="inputSchema"] .cm-content').click();
  await page.keyboard.type('{"type": ');
  const discard = start.getByRole('button', { name: 'Discard text' });
  await discard.focus();
  await page.keyboard.press('Control+z');
  await expect(start.getByRole('button', { name: 'Discard text' })).toHaveCount(0);
  await expect(start.locator('[data-field="inputSchema"] .cm-content')).toBeFocused();
  await expect(start.locator('[data-field="inputSchema"] .cm-content')).not.toContainText('type');
  await start.getByRole('button', { name: 'Done' }).focus();
  await page.keyboard.press('Control+Shift+z');
  // CodeMirror closed the brace as it was typed.
  await expect(start.locator('[data-field="inputSchema"] .cm-content')).toHaveText('{"type": }');
  await expect(start.getByRole('button', { name: '1 issue on start' })).toBeVisible();
});

test('undoing a delete restores the node, its edges, and the exit’s loop-back; a rename undoes too', async ({
  page,
  request,
}) => {
  const loopId = await createLoop(request, loopBackLoop('qa undo delete'));
  await page.goto(`/app/loops/${loopId}/edit`);
  await expect(page.locator('.react-flow__edge')).toHaveCount(3);
  let dialog = await openNode(page, 'approve');
  await dialog.getByRole('button', { name: 'Delete node' }).click();
  await expect(card(page, 'approve')).toHaveCount(0);
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  await expect(page.getByTestId('canvas')).toBeFocused();
  await expect(undoButton(page)).toHaveAccessibleName('Undo delete approve');

  await page.keyboard.press('Control+z');
  await expect(card(page, 'approve')).toBeVisible();
  await expect(page.locator('.react-flow__edge')).toHaveCount(3);
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
  let { draft } = await serverDraft(request, loopId);
  expect(draft.definition.nodes.find((n) => n.id === 'done')!.config['loopBack']).toEqual({
    targetNodeId: 'approve',
  });
  expect(draft.definition.edges).toHaveLength(3);

  // Rename the node the edges and the loop-back use, then undo it from inside its editor.
  dialog = await openNode(page, 'approve');
  const id = dialog.getByLabel('Node id');
  await id.fill('review');
  await id.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Edit wait review' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).focus();
  await expect(undoButton(page)).toHaveAccessibleName('Undo rename approve to review');
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('dialog', { name: 'Edit wait approve' })).toBeVisible();
  await expect(dialog.getByLabel('Node id')).toHaveValue('approve');
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
  ({ draft } = await serverDraft(request, loopId));
  expect(draft.definition.nodes.map((n) => n.id)).toEqual(['start', 'approve', 'done']);
  expect(draft.definition.edges.filter((e) => e.to.node === 'approve')).toHaveLength(2);
  expect(draft.definition.nodes.find((n) => n.id === 'done')!.config['loopBack']).toEqual({
    targetNodeId: 'approve',
  });
});

test('an undo after another client saved meets the conflict; a reload clears the history', async ({
  page,
  request,
}) => {
  const loopId = await createLoop(request, approvalLoop('qa undo conflict'));
  const saves = draftSaves(page, loopId);
  await page.goto(`/app/loops/${loopId}/edit`);
  await page.getByRole('button', { name: 'Add Wait node' }).click();
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved');

  // Another client saves the draft on top of this tab's save.
  const detail = await serverDraft(request, loopId);
  const elsewhere = await request.put(`/loops/${loopId}/draft`, {
    data: { definition: { ...detail.draft.definition, description: 'from elsewhere' } },
    headers: { 'If-Match': `"${detail.draftToken}"` },
  });
  expect(elsewhere.status()).toBe(200);

  await page.getByTestId('canvas').focus();
  await page.keyboard.press('Control+z');
  await expect(card(page, 'wait')).toHaveCount(0);
  await expect(page.getByText('The draft changed on the server')).toBeVisible();
  await expect(page.getByTestId('save-state')).toHaveText('Draft changed elsewhere');
  const refused = saves.length;
  // Autosave has stopped: a redo stays on this device.
  await page.keyboard.press('Control+y');
  await expect(card(page, 'wait')).toBeVisible();
  await page.waitForTimeout(1200);
  expect(saves).toHaveLength(refused);
  expect((await serverDraft(request, loopId)).draft.definition.description).toBe('from elsewhere');

  // Reloading the server draft starts the history afresh.
  await page.getByRole('button', { name: 'Reload server draft' }).click();
  await expect(page.getByText('The draft changed on the server')).toBeHidden();
  await expect(undoButton(page)).toHaveAccessibleName('Undo');
  await expect(undoButton(page)).toHaveAttribute('aria-disabled', 'true');
  await showLoopPanel(page);
  await expect(page.getByLabel('Description')).toHaveValue('from elsewhere');
  await page.getByTestId('canvas').focus();
  await page.keyboard.press('Control+z');
  await expect(card(page, 'wait')).toBeVisible();
  await expect(page.getByLabel('Description')).toHaveValue('from elsewhere');
});

test('on Apple platforms the keys are Cmd+Z and Cmd+Shift+Z', async ({ page, request }) => {
  const loopId = await createLoop(request, approvalLoop('qa undo mac'));
  const context = await page
    .context()
    .browser()!
    .newContext({
      baseURL: process.env['GG_E2E_BASE_URL'] ?? '',
      viewport: { width: 1440, height: 900 },
    });
  await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'MacIntel' });
    Object.defineProperty(Navigator.prototype, 'userAgentData', {
      configurable: true,
      get: () => ({ platform: 'macOS' }),
    });
  });
  const mac = await context.newPage();
  await mac.goto(`/app/loops/${loopId}/edit`);
  const undo = undoButton(mac);
  await expect(undo).toHaveAttribute('aria-keyshortcuts', 'Meta+Z');
  await expect(redoButton(mac)).toHaveAttribute('aria-keyshortcuts', 'Meta+Shift+Z');
  await mac.getByRole('button', { name: 'Add Wait node' }).click();
  await expect(card(mac, 'wait')).toBeVisible();
  // Ctrl+Z is not the shortcut here.
  await mac.keyboard.press('Control+z');
  await expect(card(mac, 'wait')).toBeVisible();
  await mac.keyboard.press('Meta+z');
  await expect(card(mac, 'wait')).toHaveCount(0);
  await mac.keyboard.press('Meta+Shift+z');
  await expect(card(mac, 'wait')).toBeVisible();
  await context.close();
});

test('keeps the last 100 steps: 101 edits and 101 undos leave the first edit', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const loopId = await createLoop(request, approvalLoop('qa undo limit'));
  await page.goto(`/app/loops/${loopId}/edit`);
  await showLoopPanel(page);
  const name = page.getByLabel('Name', { exact: true });
  const description = page.getByLabel('Description');
  // Alternating fields: every edit is a step of its own.
  for (let i = 1; i <= 101; i += 1) await (i % 2 === 1 ? name : description).fill(`edit ${i}`);
  await expect(name).toHaveValue('edit 101');
  await page.getByRole('heading', { name: 'Loop', exact: true }).focus();
  for (let i = 0; i < 101; i += 1) await page.keyboard.press('Control+z');
  await expect(name).toHaveValue('edit 1');
  await expect(description).toHaveValue('');
  await expect(undoButton(page)).toHaveAccessibleName('Undo');
  await expect(page.getByRole('heading', { name: 'Loop', exact: true })).toBeFocused();
});
