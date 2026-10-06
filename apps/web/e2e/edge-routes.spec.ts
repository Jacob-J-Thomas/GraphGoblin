/**
 * #44 manual edge routes against the built app and an isolated in-memory API on an ephemeral port
 * (global-setup). GG_ROUTING_SCREENSHOTS=1 writes the owner-review images into docs/qa; normal runs
 * keep them in test-results.
 */
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { APIRequestContext, Locator, Page, TestInfo } from '@playwright/test';
import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import { expect, test } from './fixtures.js';

test.use({ trace: 'off' });

const qaDirectory = resolve('..', '..', 'docs', 'qa', '2026-10-05-issue-44-waypoints');

/**
 * start -> work runs straight behind `side`, and side -> done behind `work` (forward edges that
 * cross cards); work -> side and done's loop-back return to the left. Publishable and runnable.
 */
function crossingLoop(name = 'Manual routes'): LoopDefinitionInput {
  const note = {
    operations: [{ op: 'append-message' as const, role: 'note' as const, content: 'Note' }],
  };
  return {
    schemaVersion: 1,
    name,
    nodes: [
      {
        id: 'start',
        kind: 'trigger',
        label: 'Start',
        config: { subtype: 'manual' },
        ui: { x: 0, y: 100 },
      },
      { id: 'side', kind: 'mutate', label: 'Side', config: note, ui: { x: 320, y: 100 } },
      { id: 'work', kind: 'mutate', label: 'Work', config: note, ui: { x: 640, y: 100 } },
      {
        id: 'done',
        kind: 'exit',
        label: 'Done',
        config: { default: 'success', loopBack: { targetNodeId: 'work' } },
        ui: { x: 960, y: 100 },
      },
    ],
    edges: [
      { id: 'start-work', from: { node: 'start', port: 'out' }, to: { node: 'work' } },
      { id: 'work-side', from: { node: 'work', port: 'out' }, to: { node: 'side' } },
      { id: 'side-done', from: { node: 'side', port: 'out' }, to: { node: 'done' } },
      { id: 'return', from: { node: 'done', port: 'loopBack' }, to: { node: 'work' } },
    ],
  };
}

const edge = (page: Page, id: string) => page.locator(`.react-flow__edge[data-id="${id}"]`);
const path = (page: Page, id: string) => edge(page, id).locator('.react-flow__edge-path');
const segment = (page: Page, id: string, index: number) =>
  edge(page, id).locator(`.gg-route-handle[data-segment="${index}"]`);

async function openLoop(page: Page, id: string, theme = 'dark') {
  await page.addInitScript((value) => localStorage.setItem('graphgoblin-theme', value), theme);
  await page.goto(`/app/loops/${id}/edit`);
  await expect(page.locator('.react-flow__node')).toHaveCount(4);
  for (const name of ['Hide palette', 'Hide loop settings']) {
    const button = page.getByRole('button', { name, exact: true });
    if (await button.isVisible()) await button.click();
  }
  await page.getByRole('button', { name: 'Fit view' }).click();
  await expect(path(page, 'return')).toHaveAttribute('d', /^M.*Q/);
  await page.evaluate(() => document.fonts.ready);
}

async function createLoop(request: APIRequestContext, definition = crossingLoop()) {
  const response = await request.post('/loops', { data: { definition } });
  expect(response.status(), await response.text()).toBe(201);
  return ((await response.json()) as { loop: { id: string } }).loop.id;
}

async function draft(request: APIRequestContext, id: string) {
  const response = await request.get(`/loops/${id}`);
  return ((await response.json()) as { draft: { definition: LoopDefinitionInput } }).draft
    .definition;
}
const storedRoute = async (request: APIRequestContext, loopId: string, edgeId: string) =>
  (await draft(request, loopId)).edges.find((e) => e.id === edgeId)?.ui?.route;

/** Select an edge from the keyboard: focus its group and press Enter (xyflow's selection). */
async function select(page: Page, id: string) {
  await edge(page, id).focus();
  await page.keyboard.press('Enter');
  await expect(edge(page, id)).toHaveClass(/selected/);
}

/** Drag a segment handle by a screen offset with real pointer input. */
async function drag(page: Page, handle: Locator, dx: number, dy: number) {
  const box = (await handle.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 6 });
  await page.mouse.move(x + dx, y + dy, { steps: 6 });
  await page.mouse.up();
}

async function saved(page: Page) {
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
}

/** Card boxes a path's drawn points enter (sampled along the SVG path in screen space). */
function cardsCrossed(page: Page, id: string, ignore: string[]) {
  return path(page, id).evaluate((element, skip) => {
    const curve = element as SVGPathElement;
    const matrix = curve.getScreenCTM()!;
    const boxes = [...document.querySelectorAll('.react-flow__node')]
      .filter((node) => !skip.includes(node.getAttribute('data-id')!))
      .map((node) => [node.getAttribute('data-id'), node.getBoundingClientRect()] as const);
    const hits = new Set<string>();
    for (let at = 0; at <= curve.getTotalLength(); at += 3) {
      const p = curve.getPointAtLength(at).matrixTransform(matrix);
      for (const [cardId, b] of boxes)
        if (p.x > b.left + 1 && p.x < b.right - 1 && p.y > b.top + 1 && p.y < b.bottom - 1)
          hits.add(cardId!);
    }
    return [...hits];
  }, ignore);
}

const ratio = (a: string, b: string) => {
  const luminance = (value: string) => {
    const rgb = value
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map((n) => Number(n) / 255)
      .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
    return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
};

async function screenshot(page: Page, info: TestInfo, name: string) {
  const qa = process.env['GG_ROUTING_SCREENSHOTS'] === '1';
  const target = qa ? resolve(qaDirectory, `${name}.png`) : info.outputPath(`${name}.png`);
  if (qa) await mkdir(qaDirectory, { recursive: true });
  await page.screenshot({ path: target, animations: 'disabled' });
  await info.attach(name, { path: target, contentType: 'image/png' });
}

for (const theme of ['dark', 'light']) {
  test(`${theme}: reroute a forward edge and a loop-back by dragging segments; reload keeps them`, async ({
    page,
    request,
  }, info) => {
    const loopId = await createLoop(request);
    await openLoop(page, loopId, theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    // Today start -> work runs behind the side card.
    expect(await cardsCrossed(page, 'start-work', ['start', 'work'])).toEqual(['side']);
    await screenshot(page, info, `before-${theme}`);

    // Forward edge: pull its first stub down below the cards (the trunk still crosses `side`;
    // that is the author's in-between state, kept and drawn dotted), then move the trunk past it.
    await select(page, 'start-work');
    await expect(segment(page, 'start-work', 1)).toBeVisible();
    await drag(page, segment(page, 'start-work', 1), 0, 140);
    await saved(page);
    expect(await storedRoute(request, loopId, 'start-work')).toHaveLength(3);
    await expect(edge(page, 'start-work')).toHaveAttribute(
      'aria-label',
      /manual route, crosses a card/,
    );
    await expect(path(page, 'start-work')).toHaveClass(/gg-route-crossing/);
    const trunk = segment(page, 'start-work', 4);
    const card = (await page.getByTestId('node-side').boundingBox())!;
    const trunkBox = (await trunk.boundingBox())!;
    await drag(page, trunk, card.x + card.width + 30 - (trunkBox.x + trunkBox.width / 2), 0);
    await saved(page);
    expect(await cardsCrossed(page, 'start-work', ['start', 'work'])).toEqual([]);
    await expect(edge(page, 'start-work')).toHaveAttribute(
      'aria-label',
      'start out to work, manual route',
    );
    await expect(path(page, 'start-work')).not.toHaveClass(/gg-route-crossing/);
    await screenshot(page, info, `rerouted-forward-${theme}`);

    // Loop-back: drag its lane further down.
    await select(page, 'return');
    const lane = segment(page, 'return', 3);
    const before = await path(page, 'return').getAttribute('d');
    await drag(page, lane, 0, 70);
    await saved(page);
    await expect(path(page, 'return')).not.toHaveAttribute('d', before!);
    const route = (await storedRoute(request, loopId, 'return'))!;
    expect(route).toHaveLength(3);
    expect(await cardsCrossed(page, 'return', ['done', 'work'])).toEqual([]);

    // Handles: 24 px targets, the selected-edge stroke on the canvas (3:1), focus ring on focus.
    const dot = lane.locator('.gg-route-handle-dot');
    const look = await lane.evaluate((el) => {
      const flow = getComputedStyle(el.closest('.react-flow')!);
      const hit = el.querySelector('.gg-route-handle-hit')!.getBoundingClientRect();
      return {
        canvas: flow.backgroundColor,
        stroke: getComputedStyle(el.querySelector('.gg-route-handle-dot')!).stroke,
        size: Math.min(hit.width, hit.height),
      };
    });
    expect(look.size).toBeGreaterThanOrEqual(24);
    expect(ratio(look.stroke, look.canvas)).toBeGreaterThanOrEqual(3);
    await expect(dot).toBeVisible();
    await screenshot(page, info, `rerouted-loop-back-${theme}`);

    // Reload: both routes come back from the saved draft, drawn the same way.
    const drawn = {
      forward: await path(page, 'start-work').getAttribute('d'),
      back: await path(page, 'return').getAttribute('d'),
    };
    await page.reload();
    await expect(page.locator('.react-flow__node')).toHaveCount(4);
    await page.getByRole('button', { name: 'Fit view' }).click();
    await expect(path(page, 'start-work')).toHaveAttribute('d', drawn.forward!);
    await expect(path(page, 'return')).toHaveAttribute('d', drawn.back!);
    await expect(edge(page, 'return')).toHaveAttribute('aria-label', /manual route$/);
  });
}

test('keyboard: Tab reaches the handles, arrows nudge by grid steps, Escape returns to the edge', async ({
  page,
  request,
}) => {
  const loopId = await createLoop(request);
  await openLoop(page, loopId);
  await select(page, 'return');
  // Tab moves from the edge into its handles in segment order: stub, trunk, lane, trunk, stub.
  await page.keyboard.press('Tab');
  await expect(segment(page, 'return', 1)).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const lane = segment(page, 'return', 3);
  await expect(lane).toBeFocused();
  await expect(lane).toHaveAccessibleName('Route segment 3 of 5, horizontal');
  const ring = await lane
    .locator('.gg-route-handle-ring')
    .evaluate((el) => getComputedStyle(el).stroke);
  const canvas = await lane.evaluate(
    (el) => getComputedStyle(el.closest('.react-flow')!).backgroundColor,
  );
  expect(ratio(ring, canvas)).toBeGreaterThanOrEqual(3);
  const y = async () => (await storedRoute(request, loopId, 'return'))?.[1];
  await page.keyboard.press('ArrowDown');
  await saved(page);
  const first = (await y())!;
  expect(first % 22).toBe(0);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  await saved(page);
  expect(await y()).toBe(first + 22 * 6);
  // Focus stays on the moved handle; Left/Right do nothing to a horizontal segment.
  await expect(lane).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  // Delete, Backspace and Enter on a handle change nothing.
  for (const key of ['Delete', 'Backspace', 'Enter']) await page.keyboard.press(key);
  await expect(edge(page, 'return')).toHaveCount(1);
  await expect(page.getByTestId('canvas').locator('[aria-live="polite"]')).toContainText(
    'Segment at y',
  );
  await page.keyboard.press('Escape');
  await expect(edge(page, 'return')).toBeFocused();
  await expect(edge(page, 'return')).toHaveClass(/selected/);
  // One undo takes the whole run of nudges back; redo repeats it.
  await page.keyboard.press('Control+z');
  await saved(page);
  expect(await y()).toBeUndefined();
  await page.keyboard.press('Control+Shift+z');
  await saved(page);
  expect(await y()).toBe(first + 22 * 6);
  // Reset route: keyboard-reachable after the handles, and it focuses the edge again.
  await edge(page, 'return').focus();
  for (let i = 0; i < 6; i += 1) await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Reset route', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await saved(page);
  expect(await y()).toBeUndefined();
  await expect(edge(page, 'return')).toBeFocused();
  await expect(page.getByRole('button', { name: 'Reset route', exact: true })).toHaveCount(0);
});

test('moving a card onto a manual route takes it back to automatic, in the move’s undo step', async ({
  page,
  request,
}) => {
  const definition = crossingLoop();
  // A manual loop-back lane well below the cards.
  definition.edges.find((e) => e.id === 'return')!.ui = { route: [1176, 330, 600] };
  const loopId = await createLoop(request, definition);
  await openLoop(page, loopId);
  await expect(edge(page, 'return')).toHaveAttribute('aria-label', /manual route$/);
  const lane = (await path(page, 'return').boundingBox())!;
  // A move that keeps the route clear keeps it; its stubs follow the port.
  const done = page.getByTestId('node-done');
  let box = (await done.boundingBox())!;
  await page.mouse.move(box.x + 60, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + 42, { steps: 8 });
  await page.mouse.up();
  await saved(page);
  expect(await storedRoute(request, loopId, 'return')).toEqual([1176, 330, 600]);
  // Dragging `side` down onto the lane: while it is over the lane the edge shows its automatic
  // route; released there, the manual route is removed with the move.
  const side = page.getByTestId('node-side');
  box = (await side.boundingBox())!;
  await page.mouse.move(box.x + 60, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(lane.x + lane.width / 2, lane.y + lane.height - 10 + 12, { steps: 12 });
  await expect(edge(page, 'return')).toHaveAttribute('aria-label', /set aside under a moving card/);
  await page.mouse.up();
  await saved(page);
  expect(await storedRoute(request, loopId, 'return')).toBeUndefined();
  expect(await cardsCrossed(page, 'return', ['done', 'work'])).toEqual([]);
  await expect(page.getByRole('button', { name: 'Undo move side', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo move side', exact: true }).click();
  await saved(page);
  expect(await storedRoute(request, loopId, 'return')).toEqual([1176, 330, 600]);
});

test('an existing deliberate crossing keeps its route until a move introduces another crossed card', async ({
  page,
  request,
}) => {
  const definition = crossingLoop();
  definition.edges.find((e) => e.id === 'start-work')!.ui = { route: [400] };
  const loopId = await createLoop(request, definition);
  await openLoop(page, loopId);
  expect(await cardsCrossed(page, 'start-work', [])).toEqual(['side']);
  const zoom = await page
    .locator('.react-flow__viewport')
    .evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).a);
  const moveStart = async (dx: number) => {
    const box = (await page.getByTestId('node-start').boundingBox())!;
    await page.mouse.move(box.x + 60, box.y + 12);
    await page.mouse.down();
    await page.mouse.move(box.x + 60 + dx * zoom, box.y + 12, { steps: 12 });
  };
  await moveStart(-20);
  await page.mouse.up();
  await saved(page);
  expect(await storedRoute(request, loopId, 'start-work')).toEqual([400]);
  await page.getByRole('button', { name: 'Undo move start', exact: true }).click();
  await saved(page);
  await moveStart(300);
  await expect
    .poll(async () => (await cardsCrossed(page, 'start-work', [])).sort())
    .toEqual(['side', 'start']);
  await page.mouse.up();
  await saved(page);
  expect(await storedRoute(request, loopId, 'start-work')).toBeUndefined();
  await page.getByRole('button', { name: 'Undo move start', exact: true }).click();
  await saved(page);
  const restored = await draft(request, loopId);
  expect(restored.nodes.find((n) => n.id === 'start')!.ui).toEqual({ x: 0, y: 100 });
  expect(restored.edges.find((e) => e.id === 'start-work')!.ui?.route).toEqual([400]);
});

test('32 alternating first-stub splits preserve a saveable and publishable route at the limit', async ({
  page,
  request,
}) => {
  const definition = crossingLoop();
  definition.edges.find((e) => e.id === 'start-work')!.ui = { route: [400] };
  const loopId = await createLoop(request, definition);
  await openLoop(page, loopId);
  await select(page, 'start-work');
  for (let i = 0; i < 31; i += 1) {
    await segment(page, 'start-work', 1).focus();
    await page.keyboard.press(i % 2 ? 'ArrowUp' : 'ArrowDown');
    await expect(edge(page, 'start-work').locator('.gg-route-handle')).toHaveCount(5 + i * 2);
  }
  await saved(page);
  const valid = await storedRoute(request, loopId, 'start-work');
  expect(valid).toHaveLength(63);
  await segment(page, 'start-work', 1).focus();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByTestId('canvas').locator('[aria-live="polite"]')).toHaveText(
    'This route has as many segments as a route can hold',
  );
  await expect(segment(page, 'start-work', 1)).toBeFocused();
  await saved(page);
  expect(await storedRoute(request, loopId, 'start-work')).toEqual(valid);
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published version 1.')).toBeVisible();
});

test('routes survive export and import, publish pins them, and runs ignore them', async ({
  page,
  request,
}) => {
  const definition = crossingLoop('Routed run');
  definition.edges.find((e) => e.id === 'start-work')!.ui = { route: [212, 300, 570] };
  definition.edges.find((e) => e.id === 'return')!.ui = { route: [1176, 330, 600] };
  const loopId = await createLoop(request, definition);
  // Export the draft, import it as a new loop: the routes come back and are drawn.
  const exported = await (await request.get(`/loops/${loopId}/export?draft=true`)).json();
  expect(
    (exported as { loop: LoopDefinitionInput }).loop.edges.find((e) => e.id === 'return')?.ui,
  ).toEqual({ route: [1176, 330, 600] });
  const imported = await request.post('/loops/import', { data: exported });
  expect(imported.status()).toBe(201);
  const copy = ((await imported.json()) as { loop: { id: string } }).loop.id;
  expect(await storedRoute(request, copy, 'start-work')).toEqual([212, 300, 570]);
  await openLoop(page, copy);
  await expect(edge(page, 'start-work')).toHaveAttribute('aria-label', /manual route$/);
  expect(await cardsCrossed(page, 'start-work', ['start', 'work'])).toEqual([]);

  // Publish from the editor: the version pins the routes.
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published version 1.')).toBeVisible();
  const versions = (await (await request.get(`/loops/${copy}/versions`)).json()) as {
    items: { id: string; status: string }[];
  };
  const published = versions.items.find((v) => v.status === 'published')!;
  const version = (await (await request.get(`/loops/${copy}/versions/${published.id}`)).json()) as {
    definition: LoopDefinitionInput;
  };
  expect(version.definition.edges.find((e) => e.id === 'return')?.ui).toEqual({
    route: [1176, 330, 600],
  });
  // A run of the routed version behaves as any run: start, work, side, done.
  const started = await request.post(`/loops/${copy}/runs`, { data: {} });
  expect(started.status()).toBe(202);
  const runId = ((await started.json()) as { run: { id: string } }).run.id;
  await expect
    .poll(
      async () =>
        ((await (await request.get(`/runs/${runId}`)).json()) as { status: string }).status,
    )
    .toBe('succeeded');
});

test('selecting and deleting a rerouted edge, and undoing it, keeps its route', async ({
  page,
  request,
}) => {
  const definition = crossingLoop();
  definition.edges.find((e) => e.id === 'return')!.ui = { route: [1176, 330, 600] };
  const loopId = await createLoop(request, definition);
  await openLoop(page, loopId);
  await select(page, 'return');
  await page.keyboard.press('Delete');
  await expect(edge(page, 'return')).toHaveCount(0);
  await saved(page);
  expect((await draft(request, loopId)).edges.some((e) => e.id === 'return')).toBe(false);
  await page.keyboard.press('Control+z');
  await expect(edge(page, 'return')).toHaveCount(1);
  await saved(page);
  expect(await storedRoute(request, loopId, 'return')).toEqual([1176, 330, 600]);
});

test('forced colours keep the handles and their focus ring visible', async ({ page, request }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  const loopId = await createLoop(request);
  await openLoop(page, loopId);
  await select(page, 'return');
  await page.keyboard.press('Tab');
  const handle = segment(page, 'return', 1);
  await expect(handle).toBeFocused();
  const colors = await handle.evaluate((el) => ({
    dot: getComputedStyle(el.querySelector('.gg-route-handle-dot')!).stroke,
    fill: getComputedStyle(el.querySelector('.gg-route-handle-dot')!).fill,
    ring: getComputedStyle(el.querySelector('.gg-route-handle-ring')!).stroke,
    canvas: getComputedStyle(el.closest('.react-flow')!).backgroundColor,
  }));
  expect(ratio(colors.dot, colors.canvas)).toBeGreaterThanOrEqual(3);
  expect(colors.dot).not.toBe(colors.fill);
  expect(ratio(colors.ring, colors.canvas)).toBeGreaterThanOrEqual(3);
});
