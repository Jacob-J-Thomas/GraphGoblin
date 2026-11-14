import { CURRENT_DEFINITION_FORMAT } from '@graphgoblin/contracts';
import {
  DecisionConfigSchema,
  LoopDefinitionSchema,
  RunEventSchema,
  type DecisionConfig,
  type LoopDefinitionInput,
} from '@graphgoblin/contracts';
import type { APIRequestContext, Page } from '@playwright/test';
import {
  closeNode,
  connectOnCanvas,
  control,
  expect,
  openNode,
  test,
  uniqueLoopName,
} from './fixtures.js';
import { checkAnswerTypeHelp } from './answer-type-help.js';

const handle = (page: Page, node: string, port: string) =>
  page.locator(`.react-flow__handle[data-nodeid="${node}"][data-handleid="${port}"]`);
const edge = (page: Page, id: string) => page.locator(`.react-flow__edge[data-id="${id}"]`);

function decisionLoop(optionCount = 2): LoopDefinitionInput {
  const ids = Array.from({ length: optionCount }, (_, index) =>
    index < 2 ? ['yes', 'no'][index]! : `route-${index + 1}`,
  );
  const options = ids.map((id, index) => ({
    id,
    label:
      index === 0
        ? 'Yes'
        : index === 1
          ? 'No'
          : index === optionCount - 1
            ? String(optionCount)
            : `Option ${index + 1}`,
    criteria: `Criterion ${index + 1}`,
  }));
  const nodes: LoopDefinitionInput['nodes'] = [
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
        jsonata: `"${ids[0]}"`,
        routes: options.map(({ id, label }) => ({ id, label })),
      },
      ui: { x: 260, y: 80 },
    },
    {
      id: 'branch',
      kind: 'mutate',
      label: 'Branch',
      config: { operations: [{ op: 'append-message', role: 'assistant', content: 'Branch ran' }] },
      ui: { x: 520, y: 260 },
    },
    { id: 'done', kind: 'exit', label: 'Done', config: {}, ui: { x: 800, y: 80 } },
  ];
  const edges: LoopDefinitionInput['edges'] = [
    { id: 'start-pick', from: { node: 'start', port: 'out' }, to: { node: 'pick' } },
    ...ids
      .slice(0, 2)
      .map((id) => ({ id: `${id}-edge`, from: { node: 'pick', port: id }, to: { node: 'done' } })),
    { id: 'branch-done', from: { node: 'branch', port: 'out' }, to: { node: 'done' } },
  ];
  return {
    schemaVersion: CURRENT_DEFINITION_FORMAT,
    // Tests repeat this on the shared gateway, where one owner cannot repeat a name (#209).
    name: uniqueLoopName(`Decision with ${optionCount} options`),
    nodes,
    edges,
  };
}

function primitiveLoop(
  name: string,
  config: DecisionConfig,
  routes: { id: string; label: string; target: string }[],
): LoopDefinitionInput {
  return {
    schemaVersion: CURRENT_DEFINITION_FORMAT,
    name,
    nodes: [
      {
        id: 'start',
        kind: 'trigger',
        label: 'Start',
        config: { type: 'manual' },
        ui: { x: 0, y: 80 },
      },
      { id: 'pick', kind: 'decision', label: 'Pick', config, ui: { x: 260, y: 80 } },
      {
        id: 'branch',
        kind: 'mutate',
        label: 'Branch',
        config: {
          operations: [{ op: 'append-message', role: 'assistant', content: 'Branch ran' }],
        },
        ui: { x: 520, y: 260 },
      },
      { id: 'done', kind: 'exit', label: 'Done', config: {}, ui: { x: 800, y: 80 } },
    ],
    edges: [
      { id: 'start-pick', from: { node: 'start', port: 'out' }, to: { node: 'pick' } },
      ...routes.map((route) => ({
        id: `${route.id}-edge`,
        from: { node: 'pick', port: route.id },
        to: { node: route.target },
      })),
      { id: 'branch-done', from: { node: 'branch', port: 'out' }, to: { node: 'done' } },
    ],
  };
}

async function openLoop(page: Page, request: APIRequestContext, definition = decisionLoop()) {
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
  await page.evaluate(() => document.fonts.ready);
  return loop.id;
}

async function savedDraft(page: Page, request: APIRequestContext, loopId: string) {
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
  const body = (await (await request.get(`/loops/${loopId}`)).json()) as {
    draft: { definition: unknown };
  };
  return LoopDefinitionSchema.parse(body.draft.definition);
}

/** The server's draft as stored and its token, without waiting for the editor. */
async function serverDraft(request: APIRequestContext, loopId: string) {
  const body = (await (await request.get(`/loops/${loopId}`)).json()) as {
    draft: { definition: LoopDefinitionInput };
    draftToken: string;
  };
  return { definition: body.draft.definition, token: body.draftToken };
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
  /** The editor's device-only route ownership (rows in authored order, with their edges). */
  decisionRoutes?: Record<string, { rows: { id?: string; edgeIds: string[] }[] }>;
  synced: boolean;
  baseToken?: string;
}

/** This device's IndexedDB copy of the loop, read only, without upgrading the editor's database. */
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

/** The device copy once `ready` holds for it (the mirror is written after each edit). */
async function deviceCopyWhen(page: Page, loopId: string, ready: (copy: DeviceCopy) => boolean) {
  await expect
    .poll(async () => {
      const copy = await deviceCopy(page, loopId);
      return copy !== undefined && ready(copy);
    })
    .toBe(true);
  return (await deviceCopy(page, loopId))!;
}

const pickRoutes = (definition: LoopDefinitionInput) =>
  (
    definition.nodes.find((node) => node.id === 'pick')!.config as {
      routes: { id: string; label: string }[];
    }
  ).routes;

/** Edges by their stored ends and layout, with the input port's default spelled out. */
const topology = (edges: LoopDefinitionInput['edges']) =>
  edges.map((item) => ({
    id: item.id,
    from: item.from,
    to: { node: item.to.node, port: item.to.port ?? 'in' },
    ui: item.ui ?? null,
  }));

/**
 * The device copy while the third route's ID is blank: invalid, so it stays on this device with the
 * saved token as its base. It keeps the saved topology exactly, `edgeId` included on its last valid
 * port, and the blank third row still owns that edge.
 */
function expectHeldBlank(
  copy: DeviceCopy,
  saved: { definition: LoopDefinitionInput; token: string },
  edgeId: string,
) {
  expect(copy.synced).toBe(false);
  expect(copy.baseToken).toBe(saved.token);
  expect(pickRoutes(copy.definition)).toEqual(
    pickRoutes(saved.definition).map((route, index) =>
      index === 2 ? { ...route, id: '' } : route,
    ),
  );
  expect(topology(copy.definition.edges)).toEqual(topology(saved.definition.edges));
  expect(copy.definition.edges.find((item) => item.id === edgeId)).toMatchObject({
    from: { node: 'pick', port: 'route-3' },
    to: { node: 'branch' },
  });
  const rows = copy.decisionRoutes?.['pick']?.rows ?? [];
  expect(rows.map((row) => row.id)).toEqual(['yes', 'no', '']);
  expect(rows.map((row) => row.edgeIds.includes(edgeId))).toEqual([false, false, true]);
  expect(rows[2]!.edgeIds).toEqual([edgeId]);
}

for (const hasTouch of [true, false]) {
  test.describe(`decision answer help with ${hasTouch ? 'touch' : 'mouse'}`, () => {
    test.use({ hasTouch });
    for (const theme of ['dark', 'light']) {
      test(`compact help works in ${theme} at desktop and narrow widths`, async ({
        page,
        request,
      }) => {
        await page.addInitScript(
          (theme) => localStorage.setItem('graphgoblin-theme', theme),
          theme,
        );
        await openLoop(page, request);
        const dialog = await openNode(page, 'pick');
        await dialog
          .getByRole('radiogroup', { name: 'Decision kind' })
          .getByText('classifier', { exact: true })
          .click();
        await dialog.getByRole('button', { name: 'Confirm change', exact: true }).click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        for (const width of hasTouch ? [1440, 360] : [1440]) {
          await page.setViewportSize({ width, height: 900 });
          await checkAnswerTypeHelp(
            page,
            dialog,
            test.info().outputPath(`decision-help-${theme}-${width}.png`),
            hasTouch,
          );
        }
        const group = dialog.getByRole('radiogroup', { name: 'Answer type' });
        await group.getByRole('radio', { name: 'Choice', exact: true }).focus();
        await page.keyboard.press('ArrowRight');
        await dialog.getByRole('button', { name: 'Confirm change', exact: true }).click();
        await expect(group.getByRole('radio', { name: 'Noul', exact: true })).toBeChecked();
        await expect(group.getByRole('radio', { name: 'Noul', exact: true })).toBeFocused();
      });
    }
  });
}

test('kind changes preview losses, cancel, undo, retain edges and reload; Noul never truncates routes', async ({
  page,
  request,
}) => {
  const loopId = await openLoop(page, request, decisionLoop(3));
  let dialog = await openNode(page, 'pick');
  await dialog
    .getByRole('radiogroup', { name: 'Decision kind' })
    .getByText('llm', { exact: true })
    .click();
  await expect(dialog.getByRole('region', { name: 'Change decision kind?' })).toContainText(
    'JSONata source',
  );
  await dialog.getByRole('button', { name: 'Cancel change', exact: true }).click();
  await expect(dialog.getByRole('radio', { name: 'expression', exact: true })).toBeChecked();
  await expect(dialog.locator('[data-field="jsonata"] [role="textbox"]')).toHaveText('"yes"');
  await dialog
    .getByRole('radiogroup', { name: 'Decision kind' })
    .getByText('llm', { exact: true })
    .click();
  await dialog.getByRole('button', { name: 'Confirm change', exact: true }).click();
  await expect(dialog.locator('[data-field="instructions"] [role="textbox"]')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(edge(page, 'yes-edge')).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await expect(dialog.getByRole('radio', { name: 'expression', exact: true })).toBeChecked();
  await page.keyboard.press('Control+Shift+z');
  await expect(dialog.getByRole('radio', { name: 'llm', exact: true })).toBeChecked();
  await dialog
    .locator('[data-field="instructions"] [role="textbox"]')
    .fill('Choose Yes when complete; otherwise No or the third route.');
  await dialog.getByRole('button', { name: 'Move routes 1 down', exact: true }).click();
  await closeNode(page);
  const saved = await savedDraft(page, request, loopId);
  const decision = saved.nodes.find((node) => node.id === 'pick');
  expect(decision?.config).toMatchObject({
    kind: 'llm',
    routes: [{ id: 'no' }, { id: 'yes' }, { id: 'route-3' }],
  });
  expect(saved.edges.find((item) => item.id === 'yes-edge')?.from.port).toBe('yes');
  await page.reload();
  dialog = await openNode(page, 'pick');
  await expect(dialog.getByRole('radio', { name: 'llm', exact: true })).toBeChecked();
  await dialog
    .getByRole('radiogroup', { name: 'Decision kind' })
    .getByText('classifier', { exact: true })
    .click();
  await dialog.getByRole('button', { name: 'Confirm change', exact: true }).click();
  await expect(dialog.getByRole('combobox', { name: 'Model', exact: true })).toHaveValue('');
  await dialog
    .getByRole('radiogroup', { name: 'Answer type' })
    .getByText('Noul', { exact: true })
    .click();
  await expect(
    dialog.getByRole('region', { name: 'Change classifier answer type?' }),
  ).toContainText('exactly two routes');
  await expect(dialog.getByRole('button', { name: 'Confirm change', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Cancel change', exact: true }).click();
  await expect(dialog.locator('[data-field="answer.options"] [data-collection-row]')).toHaveCount(
    3,
  );
  await expect(edge(page, 'yes-edge')).toHaveCount(1);
});

test('option IDs stay connected when numeric display labels change, save, and reload', async ({
  page,
  request,
}) => {
  const loopId = await openLoop(page, request);
  let dialog = await openNode(page, 'pick');
  const jsonata = dialog.locator('[data-field="jsonata"] [role="textbox"]');
  await jsonata.fill('"yes"');

  await dialog.getByRole('button', { name: 'Add routes', exact: true }).click();
  await dialog.locator('[data-field="routes.2.id"] input').fill('route-3');
  await dialog.locator('[data-field="routes.2.label"] input').fill('7');

  await expect(handle(page, 'pick', 'route-3')).toBeVisible();
  // The editor has no connection controls (#207): close it, draw the new route's output on the
  // canvas, and read the connection from the canvas and the saved draft from here on.
  await closeNode(page);
  await connectOnCanvas(page, 'pick', 'route-3', 'branch');
  const connected = (await savedDraft(page, request, loopId)).edges.find(
    (item) => item.from.port === 'route-3',
  )!;
  expect(connected.to.node).toBe('branch');
  await expect(edge(page, connected.id)).toHaveAttribute(
    'aria-label',
    'pick 7 (route-3) to branch',
  );
  const saved = await serverDraft(request, loopId);
  const puts = draftPuts(page, loopId);
  await openNode(page, 'pick');

  // A blank in-progress ID is invalid: no handle stands in for it, so the canvas draws neither the
  // row's output nor its edge, and the draft stays on this device. There the blank row keeps
  // ownership of the same edge on its last valid port, the saved topology is exact, and nothing
  // invalid is sent; a reload of the device copy keeps all of it (#207).
  const thirdId = dialog.locator('[data-field="routes.2.id"] input');
  await thirdId.fill('');
  await expect(page.getByTestId('save-state')).toHaveText('Saved on this device only');
  await expect(handle(page, 'pick', 'route-3')).toHaveCount(0);
  await expect(edge(page, connected.id)).toHaveCount(0);
  const blank = await deviceCopyWhen(
    page,
    loopId,
    (copy) => pickRoutes(copy.definition)[2]?.id === '',
  );
  expectHeldBlank(blank, saved, connected.id);
  await page.reload();
  await openNode(page, 'pick');
  await expect(thirdId).toHaveValue('');
  await expect(page.getByTestId('save-state')).toHaveText('Saved on this device only');
  const reloaded = (await deviceCopy(page, loopId))!;
  expectHeldBlank(reloaded, saved, connected.id);
  expect(reloaded.definition).toEqual(blank.definition);
  expect(reloaded.decisionRoutes).toEqual(blank.decisionRoutes);
  expect(puts).toEqual([]);
  expect(await serverDraft(request, loopId)).toEqual(saved);

  // Repairing the same row moves that same edge to the new ID's real handle and saves it; restoring
  // the old ID moves it back, without creating or transferring another connection.
  await thirdId.fill('route-4');
  await expect(handle(page, 'pick', 'route-4')).toBeVisible();
  await expect(edge(page, connected.id)).toHaveAttribute(
    'aria-label',
    'pick 7 (route-4) to branch',
  );
  const repaired = await savedDraft(page, request, loopId);
  expect(
    repaired.edges
      .filter((item) => item.from.node === 'pick' && item.to.node === 'branch')
      .map((item) => [item.id, item.from.port]),
  ).toEqual([[connected.id, 'route-4']]);
  expect(topology(repaired.edges)).toEqual(
    topology(saved.definition.edges).map((item) =>
      item.id === connected.id ? { ...item, from: { node: 'pick', port: 'route-4' } } : item,
    ),
  );
  // No save ever carried the blank ID.
  expect(puts.length).toBeGreaterThan(0);
  expect(puts.every((sent) => pickRoutes(sent).every((route) => route.id !== ''))).toBe(true);
  await thirdId.fill('route-3');
  await expect(edge(page, connected.id)).toHaveAttribute(
    'aria-label',
    'pick 7 (route-3) to branch',
  );
  await closeNode(page);

  const restored = await savedDraft(page, request, loopId);
  const settled = restored.edges.filter((item) => item.from.port === 'route-3');
  expect(settled.map((item) => [item.id, item.to.node])).toEqual([[connected.id, 'branch']]);
  // The saved topology is exactly what it was before the blank ID.
  expect(topology(restored.edges)).toEqual(topology(saved.definition.edges));
  await page.reload();
  await expect(handle(page, 'pick', 'route-3')).toBeVisible();
  await expect(page.getByTestId('node-pick')).toContainText('7');

  dialog = await openNode(page, 'pick');
  await dialog.locator('[data-field="routes.2.label"] input').fill('Reviewed');
  await closeNode(page);
  const afterLabelEdit = await savedDraft(page, request, loopId);
  expect(afterLabelEdit.edges.find((item) => item.id === connected.id)?.from.port).toBe('route-3');
  const decisionNode = afterLabelEdit.nodes.find((node) => node.id === 'pick');
  if (decisionNode?.kind !== 'decision') throw new Error('The saved decision node is missing.');
  expect(decisionNode.config).toMatchObject({
    kind: 'expression',
    jsonata: '"yes"',
  });
  await expect(edge(page, connected.id)).toHaveAttribute(
    'aria-label',
    'pick Reviewed (route-3) to branch',
  );

  // Expression evaluation selects the stable ID and the route follows the matching edge.
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Published version 1.')).toBeVisible();
  await page.getByRole('link', { name: 'Open in Runs' }).first().click();
  await page.getByRole('button', { name: 'Start run' }).click();
  await expect(page.locator('[data-status="succeeded"]').first()).toBeVisible();
  const runId = page.url().split('/').at(-1)!;
  const events = (await (await request.get(`/runs/${runId}/events`)).json()) as { items: unknown };
  const parsed = RunEventSchema.array().parse(events.items);
  expect(parsed.find((item) => item.type === 'decision.made')).toMatchObject({
    portId: 'yes',
    provenance: { kind: 'expression' },
    observation: {
      kind: 'route',
      routeId: 'yes',
      confidence: null,
      reasoning: null,
    },
  });
});

test('Loop issues remove the edge a blank route ID owns, and one Undo restores the whole draft', async ({
  page,
  request,
}) => {
  const loopId = await openLoop(page, request);
  let dialog = await openNode(page, 'pick');
  await dialog.getByRole('button', { name: 'Add routes', exact: true }).click();
  await dialog.locator('[data-field="routes.2.id"] input').fill('route-3');
  await dialog.locator('[data-field="routes.2.label"] input').fill('7');
  await expect(handle(page, 'pick', 'route-3')).toBeVisible();
  await closeNode(page);
  await connectOnCanvas(page, 'pick', 'route-3', 'branch');
  const connected = (await savedDraft(page, request, loopId)).edges.find(
    (item) => item.from.port === 'route-3',
  )!;
  expect(connected.to.node).toBe('branch');
  const saved = await serverDraft(request, loopId);
  const puts = draftPuts(page, loopId);

  // Blank the ID and leave the dialog: the edge is stored but not drawn.
  dialog = await openNode(page, 'pick');
  await dialog.locator('[data-field="routes.2.id"] input').fill('');
  await closeNode(page);
  await expect(page.getByTestId('save-state')).toHaveText('Saved on this device only');
  await expect(edge(page, connected.id)).toHaveCount(0);
  const blank = await deviceCopyWhen(
    page,
    loopId,
    (copy) => pickRoutes(copy.definition)[2]?.id === '',
  );
  expectHeldBlank(blank, saved, connected.id);

  // Loop issues list it by its stored ends, with the one Remove in the popover (#207).
  await page.getByRole('button', { name: /^\d+ errors?\b/ }).click();
  const issues = page.getByRole('dialog', { name: 'Loop issues' });
  const group = issues.getByRole('group', { name: 'Connections the canvas cannot draw' });
  await expect(group.getByRole('listitem')).toHaveCount(1);
  await expect(group.getByRole('listitem')).toContainText(
    `${connected.id} from pick output route-3 to branch`,
  );
  await expect(issues.getByRole('button', { name: /^Remove edge/ })).toHaveCount(1);
  await group.getByRole('button', { name: `Remove edge ${connected.id}`, exact: true }).click();
  await expect(issues).toHaveCount(0);

  // Exactly that edge goes, as one undo step, still only on this device; the blank row owns none.
  const removed = await deviceCopyWhen(
    page,
    loopId,
    (copy) => !copy.definition.edges.some((item) => item.id === connected.id),
  );
  expect(removed.definition).toEqual({
    ...blank.definition,
    edges: blank.definition.edges.filter((item) => item.id !== connected.id),
  });
  expect(removed.decisionRoutes?.['pick']?.rows.map((row) => [row.id, row.edgeIds])).toEqual(
    blank.decisionRoutes?.['pick']?.rows.map((row, index) => [
      row.id,
      index === 2 ? [] : row.edgeIds,
    ]),
  );
  expect(removed).toMatchObject({ synced: false, baseToken: saved.token });
  await expect(page.getByTestId('save-state')).toHaveText('Saved on this device only');

  // One Undo restores the whole draft, the edge and its ownership included.
  await page
    .getByRole('button', { name: 'Undo remove edge pick route-3 to branch', exact: true })
    .click();
  const undone = await deviceCopyWhen(page, loopId, (copy) =>
    copy.definition.edges.some((item) => item.id === connected.id),
  );
  expect(undone.definition).toEqual(blank.definition);
  expect(undone.decisionRoutes).toEqual(blank.decisionRoutes);
  expect(undone).toMatchObject({ synced: false, baseToken: saved.token });
  expect(puts).toEqual([]);
  expect(await serverDraft(request, loopId)).toEqual(saved);

  // Repairing the ID draws the same edge again on its real handle and saves the saved topology.
  dialog = await openNode(page, 'pick');
  await dialog.locator('[data-field="routes.2.id"] input').fill('route-3');
  await expect(edge(page, connected.id)).toHaveAttribute(
    'aria-label',
    'pick 7 (route-3) to branch',
  );
  await closeNode(page);
  expect(topology((await savedDraft(page, request, loopId)).edges)).toEqual(
    topology(saved.definition.edges),
  );
});

// The keyboard cannot create a connection since #207 (ADR-0076): the node editor's Connect form,
// which this test drove from the keyboard, was removed.
test('pointer connection reaches the eighth option by its ID while showing its numeric label', async ({
  page,
  request,
}) => {
  const loopId = await openLoop(page, request, decisionLoop(8));
  await expect(
    page.locator('.react-flow__handle[data-nodeid="pick"]:not([data-handleid="in"])'),
  ).toHaveCount(8);
  await expect(handle(page, 'pick', 'route-8')).toBeVisible();
  await connectOnCanvas(page, 'pick', 'route-8', 'branch');
  const connected = (await savedDraft(page, request, loopId)).edges.find(
    (item) => item.from.port === 'route-8',
  );
  expect(connected?.to.node).toBe('branch');
  // The canvas names it by the numeric label and the stable ID.
  await expect(edge(page, connected!.id)).toHaveAttribute(
    'aria-label',
    'pick 8 (route-8) to branch',
  );
  // The editor shows neither a Connections list nor a Connect form for the node.
  const dialog = await openNode(page, 'pick');
  await expect(dialog.getByRole('region', { name: 'Connections' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Connect', exact: true })).toHaveCount(0);
});

test('expression true/false routes preserve edges, then save and run the edited route', async ({
  page,
  request,
}) => {
  const config = DecisionConfigSchema.parse({
    kind: 'expression',
    jsonata: '"true"',
    routes: [
      {
        id: 'true',
        label: 'True',
      },
      {
        id: 'false',
        label: 'False',
      },
    ],
  });
  const loopId = await openLoop(
    page,
    request,
    primitiveLoop('Noul routes', config, [
      { id: 'true', label: 'True', target: 'branch' },
      { id: 'false', label: 'False', target: 'done' },
    ]),
  );
  let dialog = await openNode(page, 'pick');

  await expect(handle(page, 'pick', 'true')).toBeVisible();
  await expect(handle(page, 'pick', 'false')).toBeVisible();
  const trueId = dialog.locator('[data-field="routes.0.id"] input');
  await trueId.fill('affirm');
  await dialog.locator('[data-field="routes.0.label"] input').fill('Affirmative');
  await expect(handle(page, 'pick', 'affirm')).toBeVisible();
  // The existing connection follows the renamed ID and label; the canvas names it by both.
  await expect(edge(page, 'true-edge')).toHaveAttribute(
    'aria-label',
    'pick Affirmative (affirm) to branch',
  );
  await closeNode(page);

  const saved = await savedDraft(page, request, loopId);
  expect(saved.edges.find((item) => item.id === 'true-edge')?.from.port).toBe('affirm');
  expect(saved.edges.find((item) => item.id === 'true-edge')?.to.node).toBe('branch');
  await page.reload();
  await expect(handle(page, 'pick', 'affirm')).toBeVisible();
  await expect(page.getByTestId('node-pick')).toContainText('Affirmative');
  dialog = await openNode(page, 'pick');
  await expect(dialog.getByRole('radio', { name: 'expression' })).toBeChecked();
  await dialog.locator('[data-field="jsonata"] [role="textbox"]').fill('"affirm"');
  await closeNode(page);

  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Published version 1.')).toBeVisible();
  await page.getByRole('link', { name: 'Open in Runs' }).first().click();
  await page.getByRole('button', { name: 'Start run' }).click();
  await expect(page.locator('[data-status="succeeded"]').first()).toBeVisible();
  const runId = page.url().split('/').at(-1)!;
  const body = (await (await request.get(`/runs/${runId}/events`)).json()) as { items: unknown };
  const events = RunEventSchema.array().parse(body.items);
  expect(events.find((item) => item.type === 'decision.made')).toMatchObject({
    portId: 'affirm',
    provenance: { kind: 'expression' },
    observation: {
      kind: 'route',
      routeId: 'affirm',
      confidence: null,
      reasoning: null,
    },
  });
  const timeline = page.getByRole('list', { name: 'Timeline' });
  await timeline.getByRole('button', { name: /decision\.made/ }).click();
  await expect(page.getByRole('heading', { name: 'Evaluation details' })).toBeVisible();
  await expect(
    page.getByText('Selected port').locator('xpath=following-sibling::dd[1]'),
  ).toHaveText('affirm');
});

test('Score bands expose fractional boundaries, validate malformed coverage, and connect on the canvas', async ({
  page,
  request,
}) => {
  const config = DecisionConfigSchema.parse({
    recordAlternatives: true,
    kind: 'classifier',
    model: 'jev',
    question: 'Score the input against the rubric.',
    context: { messages: 'last', includeLastOutput: true },
    answer: {
      type: 'score',
      anchors: ['Does not meet', 'Partly meets', 'Fully meets'],
      bands: [
        { id: 'low', label: 'Low', min: 0, max: 0.5 },
        { id: 'middle', label: 'Middle', min: 0.5, max: 1.5 },
        { id: 'high', label: 'High', min: 1.5, max: 2 },
      ],
    },
  });
  const loopId = await openLoop(
    page,
    request,
    primitiveLoop('Score bands', config, [{ id: 'low', label: 'Low', target: 'branch' }]),
  );
  const dialog = await openNode(page, 'pick');
  const score = dialog.getByRole('radio', { name: 'Score' });
  await expect(score).toBeChecked();
  await expect(score).toHaveAccessibleDescription(
    /scores can fall between anchors.*stops just before.*never rounded/i,
  );
  const highLabel = dialog.locator('[data-field="answer.bands.2.label"] input');
  await highLabel.fill('Top score');
  await dialog.locator('[data-field="answer.bands.0.label"] input').fill('Minimum');
  const middleMax = dialog.locator('[data-field="answer.bands.1.max"] input');
  const malformedBandsError = dialog
    .getByRole('alert')
    .filter({ hasText: /bands must form nonempty contiguous intervals/ });
  await middleMax.fill('1.75');
  await expect(malformedBandsError).toBeVisible();
  await middleMax.fill('1.5');
  await expect(malformedBandsError).toHaveCount(0);

  // The editor has no connection controls (#207): close it and draw the band's output on the canvas.
  await closeNode(page);
  await connectOnCanvas(page, 'pick', 'high', 'branch');
  const drawn = (await savedDraft(page, request, loopId)).edges.find(
    (item) => item.from.port === 'high',
  );
  await expect(edge(page, drawn!.id)).toHaveAttribute(
    'aria-label',
    'pick Top score (high) to branch',
  );
  const saved = await savedDraft(page, request, loopId);
  expect(saved.edges.find((item) => item.id === 'low-edge')).toMatchObject({
    from: { node: 'pick', port: 'low' },
    to: { node: 'branch' },
  });
  expect(saved.edges.find((item) => item.from.port === 'high')?.to.node).toBe('branch');
  await page.reload();
  await expect(page.getByTestId('node-pick')).toContainText('Top score');
  await expect(page.getByTestId('node-pick')).toContainText('Minimum');
  await expect(handle(page, 'pick', 'high')).toBeVisible();
});

test('removing a connected option removes its edge in the same undo step', async ({
  page,
  request,
}) => {
  const definition = decisionLoop(3);
  const pick = definition.nodes.find((node) => node.kind === 'decision')!;
  if (pick.kind !== 'decision' || pick.config.kind !== 'expression')
    throw new Error('Expected the Choice fixture.');
  pick.config.routes[2]!.label = 'Third';
  definition.edges.push({
    id: 'third-edge',
    from: { node: 'pick', port: 'route-3' },
    to: { node: 'branch' },
  });
  const loopId = await openLoop(page, request, definition);
  const dialog = await openNode(page, 'pick');
  await dialog.getByRole('button', { name: 'Remove routes 1', exact: true }).click();
  await expect(dialog.getByRole('region', { name: 'Remove connected route?' })).toContainText(
    'yes-edge',
  );
  await expect(edge(page, 'yes-edge')).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Confirm change', exact: true }).click();
  await closeNode(page);
  await expect(edge(page, 'yes-edge')).toHaveCount(0);
  expect(
    (await savedDraft(page, request, loopId)).edges.some((item) => item.id === 'yes-edge'),
  ).toBe(false);
  await page.getByRole('button', { name: /^Undo / }).click();
  await expect(edge(page, 'yes-edge')).toHaveCount(1);
  await expect(handle(page, 'pick', 'yes')).toBeVisible();
  await page.getByRole('button', { name: /^Redo / }).click();
  await expect(edge(page, 'yes-edge')).toHaveCount(0);
});

test('the primitive-aware classifier picker preserves but marks an incompatible saved model', async ({
  page,
  request,
}) => {
  const app = await control(request, '/apps', { realClassifiers: true });
  const url = String(app['url']);
  const registered = await request.put(`${url}/classifier-models/choice-only`, {
    data: {
      displayName: 'Choice Only',
      providerModel: 'choice-only',
      endpoint: 'http://127.0.0.1:8008',
      primitives: ['noul'],
      provider: 'http',
    },
  });
  expect(registered.status()).toBe(200);
  expect(
    (
      await request.patch(`${url}/classifier-models/choice-only`, { data: { enabled: true } })
    ).status(),
  ).toBe(200);
  const config = DecisionConfigSchema.parse({
    recordAlternatives: true,
    kind: 'classifier',
    model: 'choice-only',
    question: 'Does it hold?',
    context: { messages: 'last', includeLastOutput: true },
    answer: {
      type: 'noul',
      true: { id: 'true', label: 'True', criteria: 'True' },
      false: { id: 'false', label: 'False', criteria: 'False' },
    },
  });
  const created = await request.post(`${url}/loops`, {
    data: {
      definition: primitiveLoop('Noul classifier capability', config, [
        { id: 'true', label: 'True', target: 'branch' },
        { id: 'false', label: 'False', target: 'done' },
      ]),
    },
  });
  expect(created.status()).toBe(201);
  const { loop } = (await created.json()) as { loop: { id: string } };
  const loopId = loop.id;
  const changed = await request.put(`${url}/classifier-models/choice-only`, {
    data: {
      displayName: 'Choice Only',
      providerModel: 'choice-only',
      endpoint: 'http://127.0.0.1:8008',
      primitives: ['choice'],
      provider: 'http',
    },
  });
  expect(changed.status(), await changed.text()).toBe(200);
  await page.goto(`${url}/app/loops/${loopId}/edit`);
  const editor = await openNode(page, 'pick');
  const picker = editor.getByRole('combobox', { name: 'Model' });
  await expect(picker).toHaveValue('choice-only');
  await expect(picker).toHaveAccessibleDescription(/cannot answer Noul decisions/);
  await expect(
    picker.getByRole('option', { name: /Choice Only.*not Noul-capable/ }),
  ).toBeAttached();
  await expect(picker.getByRole('option', { name: /Jev \(jev\)/ })).toBeAttached();
  await expect(picker.getByRole('option', { name: /Choice Only/ })).toHaveCount(1);
});

test('a rejected Noul confidence result stays raw and visible without selecting a route', async ({
  page,
  request,
}) => {
  const app = await control(request, '/apps', { realClassifiers: true });
  const url = String(app['url']);
  const fake = await control(request, '/classifier/start');
  const endpoint = String(fake['endpoint']);
  const registered = await request.put(`${url}/classifier-models/noul-check`, {
    data: {
      displayName: 'Noul Check',
      providerModel: 'noul-check-latest',
      endpoint,
      primitives: ['noul'],
      provider: 'http',
    },
  });
  expect(registered.status()).toBe(200);
  expect(
    (
      await request.patch(`${url}/classifier-models/noul-check`, { data: { enabled: true } })
    ).status(),
  ).toBe(200);
  await control(request, '/classifier/respond-noul', { endpoint, trueProbability: 0.6 });
  const config = DecisionConfigSchema.parse({
    recordAlternatives: true,
    kind: 'classifier',
    model: 'noul-check',
    question: 'Does the claim hold?',
    minConfidence: 0.8,
    truthThreshold: 0.5,
    context: { messages: 'last', includeLastOutput: true },
    answer: {
      type: 'noul',
      true: { id: 'true', label: 'True', criteria: 'It holds' },
      false: { id: 'false', label: 'False', criteria: 'It does not hold' },
    },
  });
  const created = await request.post(`${url}/loops`, {
    data: {
      definition: primitiveLoop('Noul confidence gate', config, [
        { id: 'true', label: 'True', target: 'branch' },
        { id: 'false', label: 'False', target: 'done' },
      ]),
    },
  });
  expect(created.status()).toBe(201);
  const { loop } = (await created.json()) as { loop: { id: string } };
  const published = await request.post(`${url}/loops/${loop.id}/publish`);
  expect(published.status(), await published.text()).toBe(200);
  const started = await request.post(`${url}/loops/${loop.id}/runs`, { data: {} });
  expect(started.status()).toBe(202);
  const { run } = (await started.json()) as { run: { id: string } };
  await expect
    .poll(
      async () =>
        ((await (await request.get(`${url}/runs/${run.id}`)).json()) as { status: string }).status,
    )
    .toBe('failed');
  const body = (await (await request.get(`${url}/runs/${run.id}/events`)).json()) as {
    items: unknown;
  };
  const events = RunEventSchema.array().parse(body.items);
  expect(events.some((item) => item.type === 'decision.made')).toBe(false);
  const failed = events.find((item) => item.type === 'run.failed');
  expect(failed).toMatchObject({
    failure: {
      code: 'EVALUATION_RESULT_REJECTED',
      details: {
        acceptance: { status: 'rejected', minConfidence: 0.8 },
        observation: {
          kind: 'classifier',
          answer: {
            type: 'noul',
            holds: true,
            trueProbability: 0.6,
            confidence: 0.6,
          },
        },
      },
    },
  });

  await page.goto(`${url}/app/runs/${run.id}`);
  const timeline = page.getByRole('list', { name: 'Timeline' });
  await timeline.getByRole('button', { name: /run\.failed/ }).click();
  const rejection = page.getByRole('region', { name: 'Rejected classifier evaluation' });
  await expect(rejection).toContainText('No decision was accepted and no route was selected.');
  await expect(rejection).toContainText('Noul true');
  await expect(rejection).toContainText('True probability');
  await expect(rejection).toContainText('60%');
  await expect(rejection).toContainText('Minimum confidence');
  await expect(rejection).toContainText('80%');
});
