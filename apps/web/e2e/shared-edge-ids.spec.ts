import {
  CURRENT_DEFINITION_FORMAT,
  LoopDefinitionSchema,
  type LoopDefinitionInput,
} from '@graphgoblin/contracts';
import type { APIRequestContext, Page } from '@playwright/test';
import { closeNode, connectOnCanvas, expect, openNode, test, uniqueLoopName } from './fixtures.js';

/**
 * #481 through the built app and the real API. The API admits a current-format draft whose
 * `start → pick` connection and the connection of `pick`'s `ship` route both use `e1`, each with a
 * manual route; validation reports `DUPLICATE_EDGE_ID`. The unrelated `stop-edge` has a manual route
 * of its own, which every edit and repair here must keep.
 */
function sharedIdLoop(): LoopDefinitionInput {
  return {
    schemaVersion: CURRENT_DEFINITION_FORMAT,
    // Every spec shares the gateway, where one owner cannot repeat a name (#209).
    name: uniqueLoopName('Shared edge id'),
    nodes: [
      {
        id: 'start',
        kind: 'trigger',
        label: 'Start',
        config: { type: 'manual' },
        ui: { x: 0, y: 80 },
      },
      {
        id: 'pick',
        kind: 'decision',
        label: 'Pick',
        config: {
          kind: 'expression',
          jsonata: '"ship"',
          routes: [
            { id: 'ship', label: 'Ship' },
            { id: 'review', label: 'Review' },
            { id: 'stop', label: 'Stop' },
          ],
        },
        ui: { x: 300, y: 80 },
      },
      { id: 'done', kind: 'exit', label: 'Done', config: {}, ui: { x: 700, y: 0 } },
      { id: 'later', kind: 'exit', label: 'Later', config: {}, ui: { x: 700, y: 360 } },
    ],
    edges: [
      {
        id: 'e1',
        from: { node: 'start', port: 'out' },
        to: { node: 'pick' },
        ui: { route: [250] },
      },
      {
        id: 'e1',
        from: { node: 'pick', port: 'ship' },
        to: { node: 'done' },
        ui: { route: [600, 20, 650] },
      },
      { id: 'review-edge', from: { node: 'pick', port: 'review' }, to: { node: 'later' } },
      {
        id: 'stop-edge',
        from: { node: 'pick', port: 'stop' },
        to: { node: 'later' },
        ui: { route: [620] },
      },
    ],
  };
}

const GUIDANCE =
  'More than one connection uses the ID "e1", so the editor cannot tell which one you mean. To repair it, remove a Decision route one of them starts from (its review should list just that connection), add the route back and draw its connection again, until one keeps the ID. Otherwise, or without a pointer, correct the ID with PUT /loops/{id}/draft.';

/** Edges by their stored ends and layout, with the input port's default spelled out. */
const topology = (edges: LoopDefinitionInput['edges']) =>
  edges.map((item) => ({
    id: item.id,
    from: item.from,
    to: { node: item.to.node, port: item.to.port ?? 'in' },
    ui: item.ui ?? null,
  }));

async function openLoop(page: Page, request: APIRequestContext, definition: LoopDefinitionInput) {
  const created = await request.post('/loops', { data: { definition } });
  expect(created.status(), await created.text()).toBe(201);
  const { loop } = (await created.json()) as { loop: { id: string } };
  await page.goto(`/app/loops/${loop.id}/edit`);
  await expect(page.getByTestId('node-pick')).toBeVisible();
  for (const name of ['Hide palette', 'Hide loop settings']) {
    const button = page.getByRole('button', { name, exact: true });
    if (await button.isVisible()) await button.click();
  }
  await page.getByRole('button', { name: 'Fit view' }).click();
  await expect(
    page.getByText(
      'The editor is available. Checking the server and this device before saving changes.',
      { exact: true },
    ),
  ).toBeHidden();
  return loop.id;
}

/** The server's draft as stored and its token, without waiting for the editor. */
async function serverDraft(request: APIRequestContext, loopId: string) {
  const body = (await (await request.get(`/loops/${loopId}`)).json()) as {
    draft: { definition: LoopDefinitionInput };
    draftToken: string;
  };
  return { definition: body.draft.definition, token: body.draftToken };
}

/** The server's draft once the editor says every change is saved. */
async function savedDraft(page: Page, request: APIRequestContext, loopId: string) {
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
  return LoopDefinitionSchema.parse((await serverDraft(request, loopId)).definition);
}

/** Every draft save the page sends from now on, by its body. */
function draftPuts(page: Page, loopId: string) {
  const puts: LoopDefinitionInput[] = [];
  page.on('request', (sent) => {
    if (sent.method() !== 'PUT' || !sent.url().endsWith(`/loops/${loopId}/draft`)) return;
    puts.push((sent.postDataJSON() as { definition: LoopDefinitionInput }).definition);
  });
  return puts;
}

interface DeviceCopy {
  definition: LoopDefinitionInput;
  decisionRoutes?: Record<string, { rows: { id?: string; edgeIds: string[] }[] }>;
  synced: boolean;
}

/** This device's IndexedDB copy of the loop, read only. */
async function deviceCopy(page: Page, loopId: string) {
  return page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open('graphgoblin', 2);
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error ?? new Error('IndexedDB open failed'));
    });
    try {
      return await new Promise<unknown>((resolve, reject) => {
        const read = db.transaction('drafts', 'readonly').objectStore('drafts').get(id);
        read.onsuccess = () => resolve(read.result);
        read.onerror = () => reject(read.error ?? new Error('IndexedDB read failed'));
      });
    } finally {
      db.close();
    }
  }, loopId) as Promise<DeviceCopy | undefined>;
}

/** The server's publication checks of the stored draft: the codes of its issues. */
const issueCodes = async (request: APIRequestContext, loopId: string) => {
  const { definition } = await serverDraft(request, loopId);
  const validated = await request.post(`/loops/${loopId}/validate`, { data: { definition } });
  expect(validated.status(), await validated.text()).toBe(200);
  const body = (await validated.json()) as { issues: { code: string }[] };
  return body.issues.map((issue) => issue.code);
};

/** What the browser hits at a point: the connection it belongs to, and the button, if any. */
const hitAt = (page: Page, at: { x: number; y: number }) =>
  page.evaluate(({ x, y }) => {
    const hit = document.elementFromPoint(x, y);
    return {
      edge: hit?.closest('.react-flow__edge')?.getAttribute('data-id') ?? null,
      button: hit?.closest('button')?.textContent?.trim() ?? null,
    };
  }, at);

/** A point of connection `id`'s line that the browser hits as that line, nearest its middle. */
async function linePoint(page: Page, id: string) {
  const point = await page
    .locator(`.react-flow__edge[data-id="${id}"] .react-flow__edge-interaction`)
    .last()
    .evaluate((line, edgeId) => {
      const curve = line as SVGPathElement;
      const matrix = curve.getScreenCTM();
      if (!matrix) return null;
      const total = curve.getTotalLength();
      const steps = 200;
      const order = Array.from({ length: steps - 1 }, (_, i) => i + 1).sort(
        (a, b) => Math.abs(a - steps / 2) - Math.abs(b - steps / 2),
      );
      for (const step of order) {
        const at = curve.getPointAtLength((total * step) / steps).matrixTransform(matrix);
        const hit = document.elementFromPoint(at.x, at.y);
        if (
          hit?.classList.contains('react-flow__edge-interaction') &&
          hit.closest('.react-flow__edge')?.getAttribute('data-id') === edgeId
        )
          return { x: at.x, y: at.y };
      }
      return null;
    }, id);
  expect(point, `a point of ${id}'s line that the browser hits`).not.toBeNull();
  return point!;
}

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (a: Box, b: Box) =>
  a.x >= b.x - 0.5 &&
  a.y >= b.y - 0.5 &&
  a.x + a.width <= b.x + b.width + 0.5 &&
  a.y + a.height <= b.y + b.height + 0.5;

test('an unrelated edit keeps both records of a shared edge id; the draft saves and Publish refuses it (#481)', async ({
  page,
  request,
}) => {
  const definition = sharedIdLoop();
  const loopId = await openLoop(page, request, definition);
  // The API admitted the draft as authored.
  expect(topology((await serverDraft(request, loopId)).definition.edges)).toEqual(
    topology(definition.edges),
  );

  // An unrelated edit through the page: drag the Later card with the mouse.
  const card = page.getByTestId('node-later').locator(':scope > div:has([data-kind])');
  const box = (await card.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 8 });
  await page.mouse.up();

  // The draft saves although validation reports the shared id; every edge is as authored.
  const saved = await savedDraft(page, request, loopId);
  expect(saved.nodes.find((node) => node.id === 'later')!.ui).not.toEqual({ x: 700, y: 360 });
  expect(topology(saved.edges)).toEqual(topology(definition.edges));
  await expect.poll(async () => (await deviceCopy(page, loopId))?.synced).toBe(true);
  expect(topology((await deviceCopy(page, loopId))!.definition.edges)).toEqual(
    topology(definition.edges),
  );

  // Loop issues report it, and the server refuses to publish it.
  await page.getByRole('button', { name: /^\d+ errors?\b/ }).click();
  await expect(page.getByRole('dialog', { name: 'Loop issues' })).toContainText(
    'duplicate edge id "e1"',
  );
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Publish failed' })).toContainText(
    'duplicate edge id "e1"',
  );
  expect(topology((await serverDraft(request, loopId)).definition.edges)).toEqual(
    topology(definition.edges),
  );

  // Opened again from this device and the server, both records are still as authored.
  await page.reload();
  await expect(page.getByTestId('node-pick')).toBeVisible();
  await page.getByRole('button', { name: 'Fit view' }).click();
  const moved = page.getByTestId('node-done').locator(':scope > div:has([data-kind])');
  const doneBox = (await moved.boundingBox())!;
  await page.mouse.move(doneBox.x + doneBox.width / 2, doneBox.y + doneBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(doneBox.x + doneBox.width / 2, doneBox.y + doneBox.height / 2 + 30, {
    steps: 6,
  });
  await page.mouse.up();
  const again = await savedDraft(page, request, loopId);
  expect(again.nodes.find((node) => node.id === 'done')!.ui).not.toEqual({ x: 700, y: 0 });
  expect(topology(again.edges)).toEqual(topology(definition.edges));
  expect(await issueCodes(request, loopId)).toContain('DUPLICATE_EDGE_ID');
});

test('a shared id shows why and how to repair it as soon as its connection is selected, and its controls change nothing (#481)', async ({
  page,
  request,
}) => {
  const definition = sharedIdLoop();
  const loopId = await openLoop(page, request, definition);
  const before = await serverDraft(request, loopId);
  const puts = draftPuts(page, loopId);
  const notice = page.getByRole('status').filter({ hasText: 'Connection refused:' });
  const notes = page.locator('.gg-route-note');
  const connection = page.locator('.react-flow__edge[data-id="e1"]').first();
  const note = connection.locator('.gg-route-note');
  const reset = connection.getByRole('button', { name: 'Reset route', exact: true });
  const remove = connection.getByRole('button', { name: 'Remove connection', exact: true });

  // Cold: nothing selected, no notice and no note.
  await expect(notice).toHaveCount(0);
  await expect(notes).toHaveCount(0);

  // One pointer click on the line selects it, and its toolbar says why at once, with the repair.
  const at = await linePoint(page, 'e1');
  await page.mouse.click(at.x, at.y);
  await expect(connection).toHaveClass(/selected/);
  await expect(note).toBeVisible();
  await expect(note).toHaveText(GUIDANCE);
  await expect(notice).toHaveCount(0);
  for (const button of [reset, remove]) {
    await expect(button).toBeVisible();
    // Not natively disabled, so it keeps focus and its hit target; Playwright counts the
    // aria-disabled state as disabled.
    await expect(button).not.toHaveAttribute('disabled');
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(button).not.toHaveAttribute('title');
    await expect(button).toHaveAccessibleDescription(GUIDANCE);
  }
  // The note is inside the canvas and clear of the controls it explains.
  const canvasBox = (await page.getByTestId('canvas').boundingBox())!;
  const noteBox = (await note.boundingBox())!;
  const resetBox = (await reset.boundingBox())!;
  const removeBox = (await remove.boundingBox())!;
  expect(inside(noteBox, canvasBox), 'the note inside the canvas').toBe(true);
  expect(overlaps(noteBox, resetBox) || overlaps(noteBox, removeBox)).toBe(false);
  await page.screenshot({ path: test.info().outputPath('shared-id-note-pointer.png') });

  // A pointer click and a double click on each control land on it and change nothing: no notice
  // moves the canvas, and the connection stays selected with its note.
  for (const [box, name] of [
    [resetBox, 'Reset route'],
    [removeBox, 'Remove connection'],
  ] as const) {
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    expect(await hitAt(page, centre)).toEqual({ edge: 'e1', button: name });
    await page.mouse.click(centre.x, centre.y);
    await page.mouse.dblclick(centre.x, centre.y);
    expect(await hitAt(page, centre)).toEqual({ edge: 'e1', button: name });
  }
  await expect(notice).toHaveCount(0);
  await expect(connection).toHaveClass(/selected/);
  await expect(note).toHaveText(GUIDANCE);

  // The keyboard reaches the same controls and reason: from the connection, Tab passes its
  // segment handles, then Reset route and Remove connection. Their keys stay on them.
  await connection.focus();
  const handles = connection.getByRole('button', { name: /^Route segment/ });
  const count = await handles.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i += 1) {
    await page.keyboard.press('Tab');
    await expect(handles.nth(i)).toBeFocused();
    await expect(handles.nth(i)).toHaveAttribute('aria-disabled', 'true');
    await expect(handles.nth(i)).toHaveAccessibleDescription(GUIDANCE);
  }
  await page.keyboard.press('Tab');
  await expect(reset).toBeFocused();
  for (const key of ['Enter', ' ']) await page.keyboard.press(key);
  await page.keyboard.press('Tab');
  await expect(remove).toBeFocused();
  for (const key of ['Enter', ' ', 'Delete', 'Backspace']) await page.keyboard.press(key);
  await expect(remove).toBeFocused();
  await expect(notice).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(connection).toBeFocused();

  // Delete from the connection, and a nudge on one of its segment handles, show the same text in
  // the notice.
  await page.keyboard.press('Delete');
  await expect(notice).toHaveText(`Connection refused: ${GUIDANCE}`);
  const handle = handles.first();
  const vertical = (await handle.getAttribute('aria-label'))!.endsWith('vertical');
  await handle.focus();
  await page.keyboard.press(vertical ? 'ArrowRight' : 'ArrowDown');
  await expect(notice).toHaveText(`Connection refused: ${GUIDANCE}`);
  await expect(note).toHaveText(GUIDANCE);
  await page.screenshot({ path: test.info().outputPath('shared-id-refused.png') });

  // Nothing changed: no undo step, no save, the same server draft.
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await page.waitForTimeout(1_500);
  expect(puts).toEqual([]);
  expect(await serverDraft(request, loopId)).toEqual(before);
});

test('a unique connection beside a shared id keeps its ordinary controls; removing it keeps every other record and route (#481)', async ({
  page,
  request,
}) => {
  const definition = sharedIdLoop();
  const loopId = await openLoop(page, request, definition);
  const connection = page.locator('.react-flow__edge[data-id="review-edge"]');
  const at = await linePoint(page, 'review-edge');
  await page.mouse.click(at.x, at.y);
  await expect(connection).toHaveClass(/selected/);
  await expect(page.locator('.gg-route-note')).toHaveCount(0);
  const remove = connection.getByRole('button', { name: 'Remove connection', exact: true });
  await expect(remove).toBeEnabled();
  await expect(remove).not.toHaveAttribute('aria-disabled');
  await expect(remove).not.toHaveAttribute('aria-describedby');
  await remove.click();
  await expect(connection).toHaveCount(0);
  const removed = await savedDraft(page, request, loopId);
  // Both `e1` records and `stop-edge` keep their ends and manual routes exactly.
  expect(topology(removed.edges)).toEqual(
    topology(definition.edges.filter((item) => item.id !== 'review-edge')),
  );
  await page.locator('button[data-history="undo"]').click();
  await expect(connection).toHaveCount(1);
  const restored = await savedDraft(page, request, loopId);
  expect(topology(restored.edges)).toEqual(topology(definition.edges));
});

test('the note of a shared id stays inside a narrow canvas, clear of the controls (#481)', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const definition = sharedIdLoop();
  const loopId = await openLoop(page, request, definition);
  const before = await serverDraft(request, loopId);
  const connection = page.locator('.react-flow__edge[data-id="e1"]').first();
  await connection.focus();
  await page.keyboard.press('Enter');
  const note = connection.locator('.gg-route-note');
  await expect(note).toHaveText(GUIDANCE);
  const canvasBox = (await page.getByTestId('canvas').boundingBox())!;
  const noteBox = (await note.boundingBox())!;
  expect(canvasBox.width).toBeLessThanOrEqual(390);
  expect(inside(noteBox, canvasBox), 'the note inside the canvas').toBe(true);
  for (const name of ['Reset route', 'Remove connection']) {
    const button = connection.getByRole('button', { name, exact: true });
    await expect(button).toHaveAccessibleDescription(GUIDANCE);
    expect(overlaps(noteBox, (await button.boundingBox())!)).toBe(false);
  }
  await page.screenshot({ path: test.info().outputPath('shared-id-note-narrow.png') });
  expect(await serverDraft(request, loopId)).toEqual(before);
});

test('correcting the id with the API draft save, as the note offers, repairs a shared id and keeps every route (#481)', async ({
  page,
  request,
}) => {
  const definition = sharedIdLoop();
  const loopId = await openLoop(page, request, definition);
  // The draft and its token from GET /loops/{id}; one of the connections gets an unused id.
  const { definition: stored, token } = await serverDraft(request, loopId);
  const corrected: LoopDefinitionInput = {
    ...stored,
    edges: stored.edges.map((item, index) => (index === 0 ? { ...item, id: 'start-pick' } : item)),
  };
  const saved = await request.put(`/loops/${loopId}/draft`, {
    data: { definition: corrected },
    headers: { 'If-Match': `"${token}"` },
  });
  expect(saved.status(), await saved.text()).toBe(200);
  expect(await issueCodes(request, loopId)).toEqual([]);

  // Opened again, the editor has the corrected draft: `e1` names one connection, with no note.
  await page.reload();
  await expect(page.getByTestId('node-pick')).toBeVisible();
  const connection = page.locator('.react-flow__edge[data-id="e1"]');
  await expect(connection).toHaveCount(1);
  await connection.focus();
  await page.keyboard.press('Enter');
  await expect(connection).toHaveClass(/selected/);
  await expect(page.locator('.gg-route-note')).toHaveCount(0);
  await expect(
    connection.getByRole('button', { name: 'Remove connection', exact: true }),
  ).not.toHaveAttribute('aria-disabled');
  // Every record keeps its ends and manual route; only the one id changed.
  const draft = LoopDefinitionSchema.parse((await serverDraft(request, loopId)).definition);
  expect(topology(draft.edges)).toEqual(topology(corrected.edges));
  expect(topology(draft.edges).map((item) => item.ui)).toEqual(
    topology(definition.edges).map((item) => item.ui),
  );
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText(/Published version 1\./)).toBeVisible();
});

test('removing the Decision route repairs a shared id: its review names only its own connection, and the route drawn again publishes (#481)', async ({
  page,
  request,
}) => {
  const definition = sharedIdLoop();
  const loopId = await openLoop(page, request, definition);

  let dialog = await openNode(page, 'pick');
  await dialog.getByRole('button', { name: 'Remove routes 1', exact: true }).click();
  const review = dialog.getByRole('region', { name: 'Remove connected route?' });
  await expect(review).toContainText('Connection ship → done (e1)');
  await expect(review).not.toContainText('Connection out → pick (e1)');
  await dialog.getByRole('button', { name: 'Confirm change', exact: true }).click();
  await closeNode(page);
  const removed = await savedDraft(page, request, loopId);
  // `start → pick` keeps its record exactly, manual route included.
  expect(topology(removed.edges)).toEqual(
    topology([definition.edges[0]!, definition.edges[2]!, definition.edges[3]!]),
  );
  expect(await issueCodes(request, loopId)).not.toContain('DUPLICATE_EDGE_ID');

  // Add the route back and draw its connection again: it gets an id of its own.
  dialog = await openNode(page, 'pick');
  await dialog.getByRole('button', { name: 'Add routes', exact: true }).click();
  await dialog.locator('[data-field="routes.2.id"] input').fill('ship');
  await dialog.locator('[data-field="routes.2.label"] input').fill('Ship');
  await closeNode(page);
  await connectOnCanvas(page, 'pick', 'ship', 'done');
  const repaired = await savedDraft(page, request, loopId);
  const drawn = repaired.edges.find(
    (item) => item.from.node === 'pick' && item.from.port === 'ship',
  )!;
  expect(drawn.id).not.toBe('e1');
  expect(drawn.to.node).toBe('done');
  expect(topology(repaired.edges.filter((item) => item !== drawn))).toEqual(
    topology([definition.edges[0]!, definition.edges[2]!, definition.edges[3]!]),
  );
  expect(await issueCodes(request, loopId)).toEqual([]);

  // `e1` names one connection again: Reset route acts on it, and the draft publishes.
  const connection = page.locator('.react-flow__edge[data-id="e1"]');
  await expect(connection).toHaveCount(1);
  await connection.focus();
  await page.keyboard.press('Enter');
  await expect(connection).toHaveClass(/selected/);
  await expect(page.locator('.gg-route-note')).toHaveCount(0);
  await page.getByRole('button', { name: 'Reset route', exact: true }).click();
  const reset = await savedDraft(page, request, loopId);
  expect(reset.edges.find((item) => item.id === 'e1')).toEqual({
    id: 'e1',
    from: { node: 'start', port: 'out' },
    to: { node: 'pick', port: 'in' },
  });
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText(/Published version 1\./)).toBeVisible();
});
