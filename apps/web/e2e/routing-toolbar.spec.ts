/**
 * #479: the selected connection's toolbar stays inside the canvas pane after Fit view, against the
 * built app and an isolated in-memory API on an ephemeral port (global-setup, provider discovery
 * off). The graph is the native reproduction's topology: a Decision's loop-back whose lane runs
 * above the top card, so that after Fit with the side panels collapsed its label sits about 31 px
 * under the pane's top, where the row above the label was clipped.
 *
 * Geometry is the browser's own layout and hit testing (`getBoundingClientRect`,
 * `elementFromPoint`, no events fired); actions are trusted mouse clicks or CDP touch taps at the
 * measured centre. The numbers asserted are relationships (the 8 px inset, the 18 px gap to the
 * label's centre, the full 44 px coarse target), never the design's predicted centres; each case
 * writes what it measured to `geometry.json` beside its screenshots for review.
 */
import { writeFile } from 'node:fs/promises';
import type { APIRequestContext, Locator, Page, TestInfo } from '@playwright/test';
import { CURRENT_DEFINITION_FORMAT, type LoopDefinitionInput } from '@graphgoblin/contracts';
import { expect, test, uniqueLoopName } from './fixtures.js';

/** The reproduction's loop-back connection, from the Decision's repeat route to the top card. */
const EDGE = 'fit-repeat-edge';
/** The inset (px) the row keeps inside the pane, and its gap from the label's centre (#479). */
const INSET = 8;
const GAP = 18;
/** Layout rounding allowed in a measured relationship (px). */
const SLACK = 0.5;

type Theme = 'light' | 'dark';
type Placement = 'above' | 'below' | 'clamp' | 'off-pane';
interface Point {
  x: number;
  y: number;
}
interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}
/** What the browser lays out and hits for the selected connection's toolbar. */
interface Geometry {
  stage: string;
  placement: string | null;
  overflow: boolean;
  coversHandle: boolean;
  pane: Box;
  row: Box;
  remove: Box;
  /** The label pill's centre: the point the toolbar is placed from. */
  label: Point;
  /** Of a 9 x 7 grid over Remove connection, inset 4 px, the points that hit it. */
  hits: number;
  viewport: string | null;
}

/**
 * The native reproduction's graph (`NATIVE-479/browser-driver-02.js`): a Decision whose `decline`
 * route repeats back to the top-left card, with `route` as an optional manual route of that edge.
 */
function fitLoop(name: string, route?: number[]): LoopDefinitionInput {
  const note = {
    operations: [
      { op: 'append-message' as const, role: 'note' as const, content: 'Fixture topology' },
    ],
  };
  return {
    schemaVersion: CURRENT_DEFINITION_FORMAT,
    name,
    nodes: [
      {
        id: 'start',
        kind: 'trigger',
        label: 'Manual entry',
        config: { type: 'manual' },
        ui: { x: 0, y: 257 },
      },
      {
        id: 'subject',
        kind: 'decision',
        label: 'Topology subject',
        config: {
          kind: 'llm',
          harness: 'codex',
          instructions: 'Choose an available route.',
          model: { mode: 'inherit' },
          effort: { mode: 'inherit' },
          routes: [
            { id: 'accept', label: 'Take this route' },
            { id: 'decline', label: 'Use fallback', repeat: true },
          ],
          maxPasses: 3,
        },
        ui: { x: 345, y: 70 },
      },
      {
        id: 'done',
        kind: 'exit',
        label: 'Success terminal',
        config: { outcome: 'success', returns: '"first"' },
        ui: { x: 705, y: 35 },
      },
      {
        id: 'other',
        kind: 'exit',
        label: 'Failure terminal',
        config: { outcome: 'failure', returns: '"second"' },
        ui: { x: 705, y: 233 },
      },
      {
        id: 'spent',
        kind: 'exit',
        label: 'Exhausted terminal',
        config: { outcome: 'exhausted', returns: '"spent"' },
        ui: { x: 705, y: 425 },
      },
      {
        id: 'work',
        kind: 'mutate',
        label: 'Return to the gate',
        config: note,
        ui: { x: 25, y: 35 },
      },
      {
        id: 'work-more',
        kind: 'mutate',
        label: 'Alternate return',
        config: note,
        ui: { x: 25, y: 455 },
      },
      {
        id: 'spent-more',
        kind: 'exit',
        label: 'Alternate exhaustion',
        config: { outcome: 'exhausted', returns: '"alt spent"' },
        ui: { x: 705, y: 617 },
      },
    ],
    edges: [
      {
        id: 'control',
        from: { node: 'start', port: 'out' },
        to: { node: 'subject' },
        ui: { route: [250] },
      },
      { id: 'reenter', from: { node: 'work', port: 'out' }, to: { node: 'subject' } },
      { id: 'reenter-more', from: { node: 'work-more', port: 'out' }, to: { node: 'subject' } },
      {
        id: EDGE,
        from: { node: 'subject', port: 'decline' },
        to: { node: 'work' },
        ...(route ? { ui: { route } } : {}),
      },
      { id: 'fit-ordinary-edge', from: { node: 'subject', port: 'accept' }, to: { node: 'other' } },
      {
        id: 'fit-spent-edge',
        from: { node: 'subject', port: 'limit-reached' },
        to: { node: 'spent' },
      },
    ],
  };
}

const connectionOf = (page: Page) => page.locator(`.react-flow__edge[data-id="${EDGE}"]`);
const buttonIn = (connection: Locator, name: string) =>
  connection.getByRole('button', { name, exact: true });
const undoButton = (page: Page) => page.locator('button[data-history="undo"]');

async function createLoop(request: APIRequestContext, definition: LoopDefinitionInput) {
  const response = await request.post('/loops', { data: { definition } });
  expect(response.status(), await response.text()).toBe(201);
  return ((await response.json()) as { loop: { id: string } }).loop.id;
}

/** The server's stored draft, read through the public API. */
async function stored(request: APIRequestContext, loopId: string) {
  const response = await request.get(`/loops/${loopId}`);
  expect(response.status()).toBe(200);
  return ((await response.json()) as { draft: { definition: LoopDefinitionInput } }).draft
    .definition;
}

/** Every draft save the page sends from now on, with its conditional token. */
function draftWrites(page: Page, loopId: string) {
  const writes: { ifMatch: string | undefined; definition: LoopDefinitionInput }[] = [];
  page.on('request', (sent) => {
    if (sent.method() !== 'PUT' || new URL(sent.url()).pathname !== `/loops/${loopId}/draft`)
      return;
    writes.push({
      ifMatch: sent.headers()['if-match'],
      definition: (sent.postDataJSON() as { definition: LoopDefinitionInput }).definition,
    });
  });
  return writes;
}

const draftSaved = (page: Page, loopId: string) =>
  page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      new URL(response.url()).pathname === `/loops/${loopId}/draft`,
  );

/** Fonts loaded and the viewport unchanged for eight frames: a settled Fit, pan or zoom. */
async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.locator('.react-flow__viewport').evaluate(async (viewport) => {
    let last = viewport.getAttribute('style');
    for (let frame = 0, stable = 0; frame < 240; frame += 1) {
      await new Promise<number>((done) => requestAnimationFrame(done));
      const style = viewport.getAttribute('style');
      stable = style === last ? stable + 1 : 0;
      last = style;
      if (stable >= 8) return;
    }
    throw new Error('the viewport did not settle');
  });
}

async function openEditor(page: Page, loopId: string, name: string, theme: Theme) {
  await page.addInitScript((value) => localStorage.setItem('graphgoblin-theme', value), theme);
  await page.goto(`/app/loops/${loopId}/edit`);
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect(page.locator(`.react-flow__edge[data-id="${EDGE}"]`).first()).toBeAttached();
  await expect(
    page.getByText(
      'The editor is available. Checking the server and this device before saving changes.',
      { exact: true },
    ),
  ).toBeHidden();
  await settle(page);
}

async function collapsePanels(page: Page) {
  for (const name of ['Hide palette', 'Hide loop settings']) {
    const button = page.getByRole('button', { name, exact: true });
    if (await button.isVisible()) await button.click();
  }
}

/** The canvas's public Fit view control, then a settled viewport. */
async function fitView(page: Page) {
  await page.locator('.react-flow__controls-fitview').click();
  await settle(page);
}

/** Select the connection from the keyboard (focus without scrolling, then Enter). */
async function select(page: Page, connection = connectionOf(page)) {
  if (!(await connection.evaluate((element) => element.classList.contains('selected')))) {
    await connection.evaluate((element) => (element as SVGGElement).focus({ preventScroll: true }));
    await page.keyboard.press('Enter');
  }
  await expect(connection).toHaveClass(/selected/);
  const remove = buttonIn(connection, 'Remove connection');
  await expect(remove).toBeAttached();
  // A mouse pan's release leaves the controls briefly settling (#207); placement waits for ready.
  await expect(remove).not.toHaveAttribute('data-gesture');
}

async function deselect(page: Page, connection = connectionOf(page)) {
  await connection.evaluate((element) => (element as SVGGElement).focus({ preventScroll: true }));
  await page.keyboard.press('Escape');
  await expect(connection).not.toHaveClass(/selected/);
}

/** The toolbar's laid-out boxes, the label's centre, and how many probes hit Remove connection. */
async function measure(connection: Locator, stage: string): Promise<Geometry> {
  const geometry = await connection.evaluate((element) => {
    const box = (r: DOMRect) => ({
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
    });
    const row = element.querySelector<HTMLElement>('.gg-route-toolbar')!;
    const remove = [...row.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Remove connection',
    )!;
    const r = remove.getBoundingClientRect();
    const pill = element.querySelector('.react-flow__edge-textbg')!.getBoundingClientRect();
    let hits = 0;
    for (let j = 0; j < 7; j += 1)
      for (let i = 0; i < 9; i += 1) {
        const hit = document.elementFromPoint(
          r.left + 4 + ((r.width - 8) * i) / 8,
          r.top + 4 + ((r.height - 8) * j) / 6,
        );
        if (hit && remove.contains(hit)) hits += 1;
      }
    return {
      placement: row.getAttribute('data-placement'),
      overflow: row.hasAttribute('data-overflow'),
      coversHandle: row.hasAttribute('data-covers-handle'),
      pane: box(element.closest('.react-flow')!.getBoundingClientRect()),
      row: box(row.getBoundingClientRect()),
      remove: box(r),
      label: { x: pill.left + pill.width / 2, y: pill.top + pill.height / 2 },
      hits,
      viewport: document.querySelector('.react-flow__viewport')!.getAttribute('style'),
    };
  });
  return { stage, ...geometry };
}

const centreOf = (box: Box): Point => ({
  x: box.left + box.width / 2,
  y: box.top + box.height / 2,
});

/**
 * Remove connection is wholly inside the pane, at least 8 px from each side, and every probe of
 * it hits it; under a coarse pointer it is the full 44 px. No overflow or covered handle reported.
 */
function expectReachable(geometry: Geometry, coarse: boolean) {
  const { stage, pane, row, remove } = geometry;
  expect(geometry.hits, `${stage}: probes of Remove connection that hit it`).toBe(63);
  for (const [name, room] of [
    ['left', row.left - pane.left],
    ['top', row.top - pane.top],
    ['right', pane.right - row.right],
    ['bottom', pane.bottom - row.bottom],
  ] as const)
    expect(room, `${stage}: the row's ${name} inset in the pane`).toBeGreaterThanOrEqual(
      INSET - SLACK,
    );
  expect(remove.height, `${stage}: Remove connection's height`).toBeGreaterThanOrEqual(
    coarse ? 44 - 0.01 : 32 - 0.01,
  );
  expect(geometry.overflow, `${stage}: overflow reported`).toBe(false);
  expect(geometry.coversHandle, `${stage}: covered handle reported`).toBe(false);
}

/**
 * The row is beside its label: its bottom 18 px above the label's centre (Above, and off the pane
 * with the label), or its top 18 px below it (Below); centred over the label unless `shifted`.
 */
function expectBeside(geometry: Geometry, placement: Placement, shifted = false) {
  const { stage, row, label } = geometry;
  expect(geometry.placement, `${stage}: placement`).toBe(placement);
  if (placement === 'below')
    expect(Math.abs(row.top - (label.y + GAP)), `${stage}: row top - (label + 18)`).toBeLessThan(
      SLACK,
    );
  else
    expect(
      Math.abs(row.bottom - (label.y - GAP)),
      `${stage}: row bottom - (label - 18)`,
    ).toBeLessThan(SLACK);
  if (!shifted)
    expect(
      Math.abs((row.left + row.right) / 2 - label.x),
      `${stage}: row centre - label centre`,
    ).toBeLessThan(SLACK);
}

/** Record a stage's geometry and a screenshot in the case's output folder. */
async function record(page: Page, info: TestInfo, log: Geometry[], geometry: Geometry) {
  log.push(geometry);
  await page.screenshot({ path: info.outputPath(`${geometry.stage}.png`) });
  await writeFile(info.outputPath('geometry.json'), JSON.stringify(log, null, 2));
}

/**
 * A point of the empty pane (nothing but the pane hit there) from which a pan by `dy` px ends
 * inside the pane, for a mouse pan that starts on the background.
 */
async function emptyPanePoint(page: Page, dy: number): Promise<Point> {
  const point = await page.locator('.react-flow__pane').evaluate((pane, shift) => {
    const r = pane.getBoundingClientRect();
    for (const v of [0.6, 0.66, 0.72, 0.5, 0.45, 0.8, 0.35, 0.9, 0.25, 0.15])
      for (const h of [0.45, 0.5, 0.62, 0.7, 0.3, 0.81, 0.2]) {
        const x = r.left + r.width * h;
        const y = r.top + r.height * v;
        if (
          document.elementFromPoint(x, y) === pane &&
          y + shift > r.top + 2 &&
          y + shift < r.bottom - 2
        )
          return { x, y };
      }
    return null;
  }, dy);
  expect(point, 'an empty point of the pane').not.toBeNull();
  return point!;
}

/** A trusted mouse pan of the canvas by `dy` px, started on the empty pane. */
async function pan(page: Page, dy: number) {
  const start = await emptyPanePoint(page, dy);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x, start.y + dy / 2, { steps: 5 });
  await page.mouse.move(start.x, start.y + dy, { steps: 5 });
  await page.mouse.up();
  await settle(page);
}

/**
 * What the browser hits, with nothing selected and then with the connection selected, at the
 * empty points of the toolbar's frame (outside its controls) and at each port's centre outside
 * the controls; and whether each of its segment handles' centres hits that handle. The frame is
 * transparent to the pointer, so with the connection selected every such point hits what it hit
 * before, or the selected connection's own drawing (its line, label or handles, raised above the
 * cards with the selection since #207); never the frame.
 */
async function expectNothingIntercepted(page: Page, stage: string) {
  const connection = connectionOf(page);
  await select(page);
  const plan = await connection.evaluate((element) => {
    const pane = element.closest('.react-flow')!.getBoundingClientRect();
    const frame = element.querySelector('.gg-route-toolbar-frame')!.getBoundingClientRect();
    const controls = [...element.querySelectorAll('.gg-route-toolbar > *, .gg-route-note')].map(
      (control) => control.getBoundingClientRect(),
    );
    const near = (x: number, y: number) =>
      controls.some((c) => x > c.left - 1 && x < c.right + 1 && y > c.top - 1 && y < c.bottom + 1);
    const points: { x: number; y: number }[] = [];
    const left = Math.max(frame.left, pane.left) + 1;
    const right = Math.min(frame.right, pane.right) - 1;
    const top = Math.max(frame.top, pane.top) + 1;
    const bottom = Math.min(frame.bottom, pane.bottom) - 1;
    for (let j = 0; j <= 6; j += 1)
      for (let i = 0; i <= 20; i += 1) {
        const x = left + ((right - left) * i) / 20;
        const y = top + ((bottom - top) * j) / 6;
        if (!near(x, y)) points.push({ x, y });
      }
    const ports = [...document.querySelectorAll('.react-flow__handle')]
      .map((port) => {
        const r = port.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })
      .filter(
        ({ x, y }) =>
          x > pane.left && x < pane.right && y > pane.top && y < pane.bottom && !near(x, y),
      );
    return { points, ports };
  });
  const probe = (points: Point[], edgeId: string) =>
    page.evaluate(
      ({ list, id }) =>
        list.map(({ x, y }) => {
          const hit = document.elementFromPoint(x, y);
          if (!hit) return 'nothing';
          const owner = hit.closest('.react-flow__edge');
          if (owner?.getAttribute('data-id') === id && owner.classList.contains('selected'))
            return hit.closest('foreignObject') ? 'frame' : 'own';
          const classes = (hit.getAttribute('class') ?? '')
            .split(/\s+/)
            .filter((name) => name && name !== 'selected')
            .join('.');
          const node = hit.closest('.react-flow__node')?.getAttribute('data-id') ?? '';
          const port = hit.closest('.react-flow__handle')?.getAttribute('data-handleid') ?? '';
          const edge = owner?.getAttribute('data-id') ?? '';
          return `${hit.tagName}.${classes} node:${node} port:${port} edge:${edge}`;
        }),
      { list: points, id: edgeId },
    );
  const all = [...plan.points, ...plan.ports];
  await deselect(page);
  const before = await probe(all, EDGE);
  await select(page);
  const after = await probe(all, EDGE);
  expect(
    after.filter((hit) => hit === 'frame'),
    `${stage}: points the frame intercepts`,
  ).toEqual([]);
  const changed = all.filter((_, i) => after[i] !== 'own' && after[i] !== before[i]);
  expect(changed, `${stage}: points that hit something else once selected`).toEqual([]);
  expect(plan.ports.length, `${stage}: ports probed`).toBeGreaterThan(0);
  // Each segment handle's centre hits that handle.
  const handles = await connection.evaluate((element) =>
    [...element.querySelectorAll('.gg-route-handle')].map((handle) => {
      const r = handle.querySelector('.gg-route-handle-dot')!.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return hit?.closest('.gg-route-handle') === handle;
    }),
  );
  expect(handles.length, `${stage}: segment handles`).toBeGreaterThan(0);
  expect(handles, `${stage}: segment handle centres that hit their handle`).toEqual(
    handles.map(() => true),
  );
}

/**
 * The automatic route of the loop-back as its stored form (`x, y, x`): the corners of its drawn
 * path (the control points of its rounded corners) in canvas coordinates.
 */
async function automaticRoute(page: Page): Promise<[number, number, number]> {
  const d = await connectionOf(page).locator('.react-flow__edge-path').getAttribute('d');
  const number = '(-?\\d+(?:\\.\\d+)?(?:e[-+]?\\d+)?)';
  const corners = [...(d ?? '').matchAll(new RegExp(`Q\\s+${number}\\s+${number}`, 'g'))].map(
    (match) => ({ x: Number(match[1]), y: Number(match[2]) }),
  );
  // Out of the Decision, up, along the lane above the top card, down, and into the card.
  expect(corners, `the loop-back's corners in ${d}`).toHaveLength(4);
  return [corners[0]!.x, corners[1]!.y, corners[2]!.x];
}

/**
 * The acceptance action: one trusted click or tap at Remove connection's measured centre removes
 * only this connection with one conditional save, and one Undo saves once more and restores the
 * stored definition byte for byte; the connection is there after a reload.
 */
async function removeAndUndo(
  page: Page,
  request: APIRequestContext,
  loopId: string,
  geometry: Geometry,
  coarse: boolean,
) {
  const before = await stored(request, loopId);
  const writes = draftWrites(page, loopId);
  const at = centreOf(geometry.remove);
  const removed = draftSaved(page, loopId);
  if (coarse) await page.touchscreen.tap(at.x, at.y);
  else await page.mouse.click(at.x, at.y);
  expect((await removed).status()).toBe(200);
  await expect(connectionOf(page)).toHaveCount(0);
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
  expect(writes, 'saves of the removal').toHaveLength(1);
  expect(writes[0]!.ifMatch, 'the removal is a conditional save').toBeTruthy();
  const after = await stored(request, loopId);
  expect(after).toEqual({ ...before, edges: before.edges.filter((item) => item.id !== EDGE) });

  const undone = draftSaved(page, loopId);
  if (coarse) await undoButton(page).tap();
  else await undoButton(page).click();
  expect((await undone).status()).toBe(200);
  await expect(connectionOf(page)).toHaveCount(1);
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
  expect(writes, 'saves of the removal and its Undo').toHaveLength(2);
  expect(writes[1]!.ifMatch, 'the Undo is a conditional save').toBeTruthy();
  expect(JSON.stringify(await stored(request, loopId))).toBe(JSON.stringify(before));
  await page.reload();
  await expect(connectionOf(page)).toHaveCount(1);
}

test.describe('desktop 1280 x 900', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  for (const theme of ['light', 'dark'] as const) {
    test(`${theme}: after Fit with the panels collapsed Remove connection is below its label and wholly hittable; pans and zooms place it without a write; one click removes it and one Undo restores the draft (#479)`, async ({
      page,
      request,
    }, info) => {
      const name = uniqueLoopName('Toolbar fit');
      const loopId = await createLoop(request, fitLoop(name));
      await openEditor(page, loopId, name, theme);
      const writes = draftWrites(page, loopId);
      const connection = connectionOf(page);
      const log: Geometry[] = [];
      const stage = async (label: string) => {
        await select(page);
        const geometry = await measure(connection, `desktop-${theme}-${label}`);
        await record(page, info, log, geometry);
        return geometry;
      };

      // The opening and a public Fit with the panels open leave room above the label: unchanged.
      let geometry = await stage('opening');
      expectBeside(geometry, 'above');
      expectReachable(geometry, false);
      await fitView(page);
      geometry = await stage('default-fit');
      expectBeside(geometry, 'above');
      expectReachable(geometry, false);

      // The reproduced case: the label about 31 px under the pane's top. The row goes below it.
      await collapsePanels(page);
      await fitView(page);
      geometry = await stage('collapsed-panels-fit');
      expect(geometry.label.y - geometry.pane.top).toBeLessThan(GAP + 32 + INSET);
      expectBeside(geometry, 'below');
      expectReachable(geometry, false);
      await expectNothingIntercepted(page, `desktop-${theme}-collapsed-panels-fit`);
      // Escape on the button returns to the connection, which stays selected.
      await buttonIn(connection, 'Remove connection').evaluate((button) =>
        (button as HTMLButtonElement).focus({ preventScroll: true }),
      );
      await page.keyboard.press('Escape');
      await expect(connection).toBeFocused();
      await expect(connection).toHaveClass(/selected/);

      // An ordinary pan down gives the row room above the label again; the place before #479.
      await pan(page, 46);
      geometry = await stage('ordinary-pan');
      expectBeside(geometry, 'above');
      expectReachable(geometry, false);
      // A pan that takes the label off the pane's top: the row goes with it, above it, unclamped.
      await pan(page, -(geometry.label.y - geometry.pane.top + 40));
      geometry = await stage('label-off-pane');
      expect(geometry.label.y).toBeLessThan(geometry.pane.top);
      expectBeside(geometry, 'off-pane');
      expect(geometry.row.bottom).toBeLessThan(geometry.pane.top);
      // Zoomed out from the reproduced Fit: above, as before.
      await fitView(page);
      await page.locator('.react-flow__controls-zoomout').click();
      await settle(page);
      geometry = await stage('zoom');
      expectBeside(geometry, 'above');
      expectReachable(geometry, false);

      // Fit, flips, pans and a zoom wrote nothing and made no history.
      expect(writes, 'saves from camera moves').toHaveLength(0);
      await expect(undoButton(page)).toHaveAttribute('aria-disabled', 'true');

      // The acceptance click, with no pan or zoom after the reproduced Fit.
      await fitView(page);
      geometry = await stage('acceptance');
      expectBeside(geometry, 'below');
      expectReachable(geometry, false);
      expect(writes).toHaveLength(0);
      await removeAndUndo(page, request, loopId, geometry, false);
    });
  }

  test('Reset route below its label, over a card corner: three trusted presses reset once, each later press lands on the held Reset route, and one Undo restores the manual route (#479, #207)', async ({
    page,
    request,
  }, info) => {
    // The automatic loop-back's route, read from the browser, then a manual route 11 px lower:
    // its label is still near the pane's top after Fit, and the reset moves the label back up.
    const probeName = uniqueLoopName('Toolbar reset probe');
    await openEditor(page, await createLoop(request, fitLoop(probeName)), probeName, 'light');
    await collapsePanels(page);
    await fitView(page);
    const [right, lane, left] = await automaticRoute(page);
    const route = [right, lane + 11, left];
    const name = uniqueLoopName('Toolbar reset');
    const loopId = await createLoop(request, fitLoop(name, route));
    await openEditor(page, loopId, name, 'light');
    await collapsePanels(page);
    await fitView(page);
    const connection = connectionOf(page);
    const reset = buttonIn(connection, 'Reset route');
    const remove = buttonIn(connection, 'Remove connection');
    await select(page);
    await expect(reset).not.toHaveAttribute('aria-disabled');
    const geometry = await measure(connection, 'reset-held-before');
    const log: Geometry[] = [];
    await record(page, info, log, geometry);
    expectBeside(geometry, 'below');
    expectReachable(geometry, false);
    const box = (await reset.boundingBox())!;
    const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    // What is under that point with nothing selected (the card's corner, in this fixture).
    await deselect(page);
    const beneath = await page.evaluate(
      ({ x, y }) =>
        document.elementFromPoint(x, y)?.closest('.react-flow__node')?.getAttribute('data-id') ??
        null,
      at,
    );
    info.annotations.push({ type: 'card under Reset route', description: String(beneath) });
    await select(page);
    const held = await reset.elementHandle();
    const hitsHeld = () =>
      page.evaluate(
        ({ button, x, y }) => {
          const hit = document.elementFromPoint(x, y);
          return (
            !!button &&
            !!hit &&
            button.contains(hit) &&
            button.getAttribute('aria-disabled') === 'true'
          );
        },
        { button: held, ...at },
      );

    const writes = draftWrites(page, loopId);
    const saved = draftSaved(page, loopId);
    await page.mouse.click(at.x, at.y);
    expect((await saved).status()).toBe(200);
    await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
    await expect(connection).toBeFocused();
    expect(
      (await stored(request, loopId)).edges.find((item) => item.id === EDGE)?.ui,
    ).toBeUndefined();
    for (const press of ['second', 'third']) {
      // The automatic route has its label elsewhere; the held row stays, with Reset route in its
      // slot, unavailable, under the point the first press found.
      expect(
        await hitsHeld(),
        `before the ${press} press, the point hits the held Reset route`,
      ).toBe(true);
      await page.mouse.click(at.x, at.y);
      await expect(connection).toHaveClass(/selected/);
      // A press on the held button keeps focus there, as a browser's mousedown gives it.
      await expect(reset).toBeFocused();
    }
    await expect(remove).not.toBeFocused();
    await expect(connection).toHaveCount(1);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(writes, 'saves of three presses').toHaveLength(1);
    const after = await measure(connection, 'reset-held-after');
    await record(page, info, log, after);
    expect(after.row).toEqual(geometry.row);
    expect(after.label.y, 'the automatic label moved up').toBeLessThan(geometry.label.y - 5);

    // One history entry: one Undo brings the manual route back and leaves nothing to undo.
    const undone = draftSaved(page, loopId);
    await undoButton(page).click();
    expect((await undone).status()).toBe(200);
    await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
    await expect(undoButton(page)).toHaveAttribute('aria-disabled', 'true');
    expect((await stored(request, loopId)).edges.find((item) => item.id === EDGE)?.ui).toEqual({
      route,
    });
    expect(writes).toHaveLength(2);
  });

  test('a shared id’s note goes under controls below the label, inside the pane, and the unavailable Remove connection changes nothing (#479, #481)', async ({
    page,
    request,
  }, info) => {
    const name = uniqueLoopName('Toolbar shared id');
    const definition = fitLoop(name);
    // The lower card's connection into the Decision holds the loop-back's id too.
    definition.edges = definition.edges.map((item) =>
      item.id === 'reenter-more' ? { ...item, id: EDGE } : item,
    );
    const loopId = await createLoop(request, definition);
    await openEditor(page, loopId, name, 'dark');
    await collapsePanels(page);
    await fitView(page);
    const writes = draftWrites(page, loopId);
    // The canvas draws each holder of the id with the ends the id resolves to (#481), here the
    // loop-back's: the one drawn last is on top, so the pointer reaches its toolbar.
    await expect(connectionOf(page)).toHaveCount(2);
    const connection = connectionOf(page).last();
    await expect(connection).toHaveAttribute(
      'aria-label',
      /^subject Use fallback \(decline\) to work/,
    );
    await select(page, connection);
    const geometry = await measure(connection, 'shared-id');
    await record(page, info, [], geometry);
    expectBeside(geometry, 'below');
    expectReachable(geometry, false);
    const note = connection.locator('.gg-route-note');
    const remove = buttonIn(connection, 'Remove connection');
    await expect(note).toBeVisible();
    await expect(remove).toHaveAttribute('aria-disabled', 'true');
    await expect(remove).toHaveAttribute('aria-describedby', (await note.getAttribute('id'))!);
    const noteBox = (await note.boundingBox())!;
    expect(noteBox.y, 'the note under the controls').toBeGreaterThanOrEqual(geometry.row.bottom);
    expect(noteBox.x).toBeGreaterThanOrEqual(geometry.pane.left + INSET - SLACK);
    expect(noteBox.x + noteBox.width).toBeLessThanOrEqual(geometry.pane.right - INSET + SLACK);
    expect(noteBox.y + noteBox.height).toBeLessThanOrEqual(geometry.pane.bottom);
    // A trusted click on the unavailable button lands on it and changes nothing.
    const at = centreOf(geometry.remove);
    await page.mouse.click(at.x, at.y);
    await expect(remove).toBeFocused();
    await expect(connection).toHaveClass(/selected/);
    await expect(connectionOf(page)).toHaveCount(2);
    await expect(page.getByRole('status').filter({ hasText: 'Connection refused:' })).toHaveCount(
      0,
    );
    await page.keyboard.press('Escape');
    await expect(connection).toBeFocused();
    expect(writes).toHaveLength(0);
  });
});

test.describe('coarse pointer 1024 x 768', () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true });

  test('dark: the opening and both Fits keep the full 44 px Remove connection inside the pane; zoomed out it stays above; one tap removes it and one tap on Undo restores the draft (#479)', async ({
    page,
    request,
  }, info) => {
    const name = uniqueLoopName('Toolbar coarse');
    const loopId = await createLoop(request, fitLoop(name));
    await openEditor(page, loopId, name, 'dark');
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    const writes = draftWrites(page, loopId);
    const connection = connectionOf(page);
    const log: Geometry[] = [];
    const stage = async (label: string) => {
      await select(page);
      const geometry = await measure(connection, `coarse-dark-${label}`);
      await record(page, info, log, geometry);
      return geometry;
    };
    // Each of these lost part of the 44 px target above the label before #479.
    let geometry = await stage('opening');
    expectBeside(geometry, 'below');
    expectReachable(geometry, true);
    await fitView(page);
    geometry = await stage('default-fit');
    expectBeside(geometry, 'below');
    expectReachable(geometry, true);
    await collapsePanels(page);
    await fitView(page);
    geometry = await stage('collapsed-panels-fit');
    expectBeside(geometry, 'below');
    expectReachable(geometry, true);
    await expectNothingIntercepted(page, 'coarse-dark-collapsed-panels-fit');
    await page.locator('.react-flow__controls-zoomout').click();
    await settle(page);
    geometry = await stage('zoom');
    expectBeside(geometry, 'above');
    expectReachable(geometry, true);
    expect(writes, 'saves from camera moves').toHaveLength(0);
    await expect(undoButton(page)).toHaveAttribute('aria-disabled', 'true');

    await fitView(page);
    geometry = await stage('acceptance');
    expectBeside(geometry, 'below');
    expectReachable(geometry, true);
    await removeAndUndo(page, request, loopId, geometry, true);
  });
});

test.describe('narrow 390 x 844', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('light: the opening and Fit keep the row above the label where it was; one click removes and one Undo restores (#479)', async ({
    page,
    request,
  }, info) => {
    const name = uniqueLoopName('Toolbar 390');
    const loopId = await createLoop(request, fitLoop(name));
    await openEditor(page, loopId, name, 'light');
    const connection = connectionOf(page);
    const log: Geometry[] = [];
    await select(page);
    let geometry = await measure(connection, 'narrow-light-opening');
    await record(page, info, log, geometry);
    expectBeside(geometry, 'above');
    expectReachable(geometry, false);
    await fitView(page);
    await select(page);
    geometry = await measure(connection, 'narrow-light-fit');
    await record(page, info, log, geometry);
    expectBeside(geometry, 'above');
    expectReachable(geometry, false);
    await removeAndUndo(page, request, loopId, geometry, false);
  });
});

test.describe('narrow 320 x 800', () => {
  test.use({ viewport: { width: 320, height: 800 } });

  test('dark: the opening puts Remove connection below the label inside the pane; Crosses a card, Reset route and Remove connection wrap with Remove connection last (#479)', async ({
    page,
    request,
  }, info) => {
    const name = uniqueLoopName('Toolbar 320');
    const loopId = await createLoop(request, fitLoop(name));
    await openEditor(page, loopId, name, 'dark');
    const connection = connectionOf(page);
    const log: Geometry[] = [];
    await select(page);
    let geometry = await measure(connection, 'narrow320-dark-opening');
    await record(page, info, log, geometry);
    expectBeside(geometry, 'below');
    expectReachable(geometry, false);
    const [right, , left] = await automaticRoute(page);
    await removeAndUndo(page, request, loopId, geometry, false);

    // A manual lane through the top card: the toolbar says Crosses a card beside its two buttons.
    const crossingName = uniqueLoopName('Toolbar 320 crossing');
    const crossing = await createLoop(request, fitLoop(crossingName, [right, 65, left]));
    await openEditor(page, crossing, crossingName, 'dark');
    await select(page);
    const row = connection.locator('.gg-route-toolbar');
    await expect(row.locator(':scope > *')).toHaveText([
      'Crosses a card',
      'Reset route',
      'Remove connection',
    ]);
    geometry = await measure(connection, 'narrow320-dark-crossing');
    await record(page, info, log, geometry);
    expect(geometry.row.width, 'the row is no wider than the pane less its insets').toBeLessThan(
      geometry.pane.width - 2 * INSET + SLACK,
    );
    expectReachable(geometry, false);
    const lines = await row.evaluate((element) =>
      [...element.children].map((child) => {
        const r = child.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom };
      }),
    );
    const last = lines.at(-1)!;
    for (const other of lines.slice(0, -1))
      expect(last.top, 'Remove connection on a line after the others').toBeGreaterThanOrEqual(
        other.bottom,
      );
  });
});
