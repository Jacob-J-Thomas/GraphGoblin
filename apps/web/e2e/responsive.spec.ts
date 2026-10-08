/**
 * Responsive review (#41): both stored themes, every page and transient state at four widths,
 * all nine node dialogs at 360/768 px, pointer and keyboard authoring at 768 px, coarse-pointer
 * targets (including disclosures, code fields, checkbox/radio labels, and port hit boxes), and
 * reflow at 200% zoom. Group related
 * states instead of creating a separate browser test for each matrix cell.
 */
import { writeFile } from 'node:fs/promises';
import type { Locator, Page } from '@playwright/test';
import { denseGraph } from '../src/__fixtures__/routing.js';
import {
  approvalLoop,
  closeNode,
  control,
  expect,
  openAdvanced,
  openItem,
  publishLoop,
  test,
} from './fixtures.js';

/** Actual screen boxes: pseudo-elements are outside xyflow's measured handle/card geometry. */
const portBoxes = (page: Page) =>
  page.locator('.react-flow__handle').evaluateAll((handles) => {
    const zoom = new DOMMatrix(
      getComputedStyle(document.querySelector('.react-flow__viewport')!).transform,
    ).a;
    return handles.map((handle) => {
      const hit = getComputedStyle(handle, '::after');
      const center = handle.getBoundingClientRect();
      const width = parseFloat(hit.width) * zoom;
      const height = parseFloat(hit.height) * zoom;
      return {
        node: handle.getAttribute('data-nodeid'),
        port: handle.getAttribute('data-handleid'),
        width,
        height,
        zoom,
        maxWidth: parseFloat(getComputedStyle(handle).getPropertyValue('--gg-port-max-width')),
        left: center.left + center.width / 2 - width / 2,
        right: center.left + center.width / 2 + width / 2,
        top: center.top + center.height / 2 - height / 2,
        bottom: center.top + center.height / 2 + height / 2,
      };
    });
  });

const canvasZoom = (page: Page) =>
  page
    .locator('.react-flow__viewport')
    .evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);

/** Real wheel input changes xyflow's viewport, not just the DOM transform. */
async function zoomTo(page: Page, zoom: number) {
  const current = await canvasZoom(page);
  const canvas = (await page.getByTestId('canvas').boundingBox())!;
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await page.mouse.wheel(0, Math.log2(current / zoom) / 0.002);
  await expect.poll(() => canvasZoom(page)).toBeCloseTo(zoom, 3);
  // ResizeObserver and React must have a chance to expose a geometry change after the transform.
  await page.evaluate(
    () =>
      new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
}

function expectDisjointPorts(ports: Awaited<ReturnType<typeof portBoxes>>) {
  for (let i = 0; i < ports.length; i++)
    for (const other of ports.slice(i + 1)) {
      const box = ports[i]!;
      const overlap =
        Math.min(box.right, other.right) - Math.max(box.left, other.left) > 0.05 &&
        Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top) > 0.05;
      expect(overlap, `${box.node}/${box.port} overlaps ${other.node}/${other.port}`).toBe(false);
    }
}

const WIDTHS = [
  { width: 360, height: 780 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
];

/** The actual page scroll width, compared to the CSS viewport (including at zoom). */
const scrollWidth = (page: Page) =>
  page.evaluate(() => ({
    scrollWidth: document.scrollingElement!.scrollWidth,
    innerWidth: window.innerWidth,
  }));
const pageOverflows = async (page: Page) => {
  const sizes = await scrollWidth(page);
  return sizes.scrollWidth > sizes.innerWidth;
};

/**
 * Check the viewport and each clipping ancestor, not just the window edge. Canvas content pans;
 * visually hidden radios are measured by their drawn labels. In a scoped state, scroll each
 * control into view first so intentionally scrolling dialog bodies can still be reached in full.
 */
async function cutOffControls(page: Page, scope?: Locator) {
  return (scope ?? page.locator('body')).evaluate((root, reveal) => {
    const failures: string[] = [];
    const controls = [
      ...root.querySelectorAll<HTMLElement>(
        'button, a[href], input:not([type=hidden]), select, textarea, [role=link]',
      ),
    ];
    for (const control of controls) {
      if (control.closest('.react-flow__node, .react-flow__edge, .react-flow__edgelabel-renderer'))
        continue;
      if (control instanceof HTMLInputElement && control.type === 'file') continue;
      const el =
        control instanceof HTMLInputElement && control.type === 'radio'
          ? (control.closest('label') ?? control)
          : control;
      let rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (
        rect.width <= 1 ||
        rect.height <= 1 ||
        style.visibility === 'hidden' ||
        style.opacity === '0'
      )
        continue;
      if (reveal) {
        el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
        rect = el.getBoundingClientRect();
      }
      let clipped = rect.left < -1 || rect.right > innerWidth + 1;
      if (reveal) clipped ||= rect.top < -1 || rect.bottom > innerHeight + 1;
      for (let parent = el.parentElement; parent; parent = parent.parentElement) {
        const css = getComputedStyle(parent);
        const box = parent.getBoundingClientRect();
        // Use the client box: borders and scrollbars cannot draw a control.
        const left = box.left + parent.clientLeft;
        const top = box.top + parent.clientTop;
        if (/^(auto|scroll|hidden|clip)$/.test(css.overflowX))
          clipped ||= rect.left < left - 1 || rect.right > left + parent.clientWidth + 1;
        if (reveal && /^(auto|scroll|hidden|clip)$/.test(css.overflowY))
          clipped ||= rect.top < top - 1 || rect.bottom > top + parent.clientHeight + 1;
      }
      if (clipped)
        failures.push(
          control.getAttribute('aria-label') ?? control.textContent?.trim() ?? control.tagName,
        );
    }
    return failures;
  }, Boolean(scope));
}

async function geometry(page: Page, state: string, scope?: Locator) {
  await page.evaluate(() => document.fonts.ready);
  expect(await cutOffControls(page, scope), `${state}: clipped controls`).toEqual([]);
  const sizes = await scrollWidth(page);
  if (scope) {
    const box = (await scope.boundingBox())!;
    expect(box.x, `${state}: container left`).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width, `${state}: container right`).toBeLessThanOrEqual(
      sizes.innerWidth + 1,
    );
  }
  expect(sizes.scrollWidth, `${state}: sideways page scroll`).toBeLessThanOrEqual(sizes.innerWidth);
  return { state, ...sizes };
}

const SETTINGS = [
  'Appearance',
  'Model catalog',
  'Classifier models',
  'Defaults',
  'Secrets',
  'API keys',
  "This browser's API key",
  'Harness preflight',
  'Install',
];

/** Real configurations exercise cron, code fields, collections, and nested options. */
async function seedDialogs(request: Parameters<typeof publishLoop>[0]) {
  const child = await publishLoop(request, approvalLoop('responsive child'));
  const configs = [
    ['trigger', { subtype: 'cron', expression: '30 7 * * 1' }],
    [
      'decision',
      {
        answer: {
          type: 'choice',
          options: [
            { id: 'yes', label: 'Continue', criteria: 'Continue the work' },
            { id: 'no', label: 'Stop', criteria: 'Stop the work' },
          ],
        },
        evaluation: { kind: 'expression', jsonata: '"yes"' },
        recordAlternatives: true,
      },
    ],
    ['inference', { prompt: { template: 'Summarise {{ lastMessage.content }}' } }],
    ['script', { command: 'node', args: ['script.js'] }],
    ['mutate', { operations: [{ op: 'append-message', role: 'note', content: 'Note' }] }],
    ['subloop', { loopRef: { loopId: child } }],
    ['wait', { mode: 'input', prompt: 'Approve?' }],
    ['heartbeat', { intervalSeconds: 60, maxBeats: 3 }],
    ['exit', {}],
  ] as const;
  const created = await request.post('/loops', {
    data: {
      definition: {
        schemaVersion: 3,
        name: 'responsive dialogs',
        nodes: configs.map(([kind, config], i) => ({
          id: kind,
          kind,
          label: kind,
          config,
          ui: { x: (i % 3) * 260, y: Math.floor(i / 3) * 200 },
        })),
        edges: [],
      },
    },
  });
  expect(created.status()).toBe(201);
  return {
    loopId: ((await created.json()) as { loop: { id: string } }).loop.id,
    kinds: configs.map(([kind]) => kind),
  };
}

for (const theme of ['dark', 'light'] as const) {
  test.describe(`responsive ${theme}`, () => {
    test.beforeEach(async ({ context }) => {
      await context.addInitScript(
        (choice) => localStorage.setItem('graphgoblin-theme', choice),
        theme,
      );
    });

    async function seed(request: Parameters<typeof publishLoop>[0]) {
      const loopId = await publishLoop(request, approvalLoop('responsive sweep'));
      const res = await request.post(`/loops/${loopId}/runs`, { data: {} });
      const runId = ((await res.json()) as { run: { id: string } }).run.id;
      await request.post('/events', { data: { type: 'issue.opened', payload: { number: 41 } } });
      return { loopId, runId };
    }

    test('the full published-with-changes state fits a stacked Loops row at 360 px', async ({
      page,
      request,
    }) => {
      const definition = approvalLoop(`responsive changed loop ${theme}`);
      const loopId = await publishLoop(request, definition);
      const edited = await request.put(`/loops/${loopId}/draft`, {
        data: { definition: { ...definition, description: 'Unpublished edit' } },
      });
      expect(edited.status()).toBe(200);
      await page.setViewportSize(WIDTHS[0]!);
      await page.goto('/app/loops');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const row = page.getByRole('row').filter({
        has: page.getByRole('link', { name: definition.name, exact: true }),
      });
      const state = row.getByText('published, unpublished changes', { exact: true });
      await expect(state).toBeVisible();
      await state.scrollIntoViewIfNeeded();
      await page.evaluate(() => document.fonts.ready);
      // Visibility and the DOM text alone miss ellipsis clipping. Measure the rendered text
      // against its own box, the badge, and every clipping ancestor up to the viewport.
      const clipped = await state.evaluate((el) => {
        if (el.scrollWidth > el.clientWidth) return true;
        const range = document.createRange();
        range.selectNodeContents(el);
        for (const rect of range.getClientRects()) {
          if (rect.left < 0 || rect.right > innerWidth) return true;
          for (let parent: Element | null = el; parent; parent = parent.parentElement) {
            const css = getComputedStyle(parent);
            const box = parent.getBoundingClientRect();
            const left = box.left + parent.clientLeft;
            const top = box.top + parent.clientTop;
            if (
              /^(auto|scroll|hidden|clip)$/.test(css.overflowX) &&
              (rect.left < left - 1 || rect.right > left + parent.clientWidth + 1)
            )
              return true;
            if (
              /^(auto|scroll|hidden|clip)$/.test(css.overflowY) &&
              (rect.top < top - 1 || rect.bottom > top + parent.clientHeight + 1)
            )
              return true;
          }
        }
        return false;
      });
      expect(clipped, `${theme}: full publish state is readable`).toBe(false);
      await geometry(page, 'Loops with unpublished changes');
    });

    test('screens and transient states fit at 360, 768, 1024, and 1440 px', async ({
      page,
      request,
    }, testInfo) => {
      // Four viewports, every Settings section, and real outage probes share this test.
      test.setTimeout(120_000);
      const { loopId, runId } = await seed(request);
      const keyed = await control(request, '/apps', { requireApiKey: true });
      const evidence: { theme: string; state: string; scrollWidth: number; innerWidth: number }[] =
        [];
      const measure = async (state: string, scope?: Locator) => {
        evidence.push({ theme, ...(await geometry(page, state, scope)) });
      };
      const screens = [
        ['Loops', '/app/loops', 'responsive sweep'],
        ['Editor', `/app/loops/${loopId}/edit`, 'Approve'],
        ['Runs', '/app/runs', 'responsive sweep'],
        ['New run', `/app/runs/new?loop=${loopId}`, 'Start run'],
        ['Run inspector', `/app/runs/${runId}`, 'Input requested'],
        ['Events', '/app/events', 'issue.opened'],
        ['Settings', '/app/settings', 'GPT-5.5'],
        ['404', '/app/nowhere', 'Page not found'],
      ] as const;
      for (const viewport of WIDTHS) {
        await page.setViewportSize(viewport);
        for (const [state, path, ready] of screens) {
          await page.goto(path);
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          await expect(page.getByText(ready).filter({ visible: true }).first()).toBeVisible();
          await measure(state);
          if (state === 'Settings') {
            for (const name of SETTINGS) {
              const section = page.getByRole('region', { name, exact: true });
              await expect(section).toBeVisible();
              await measure(`Settings: ${name}`, section);
            }
          }
        }

        await page.goto(`${String(keyed['url'])}/app/loops`);
        await expect(page.getByRole('heading', { name: 'API key required' })).toBeVisible();
        await measure('API key panel', page.getByRole('form', { name: 'Enter API key' }));

        // A real query transport failure creates probe demand; /healthz also fails during the outage.
        let probes = 0;
        await page.route(
          (url) => url.pathname === '/healthz',
          async (route) => {
            probes += 1;
            await route.abort('connectionrefused');
          },
        );
        await page.route(
          (url) => url.pathname === '/loops',
          (route) => route.abort('connectionrefused'),
        );
        await page.goto('/app/loops');
        const offline = page
          .getByRole('status')
          .filter({ hasText: 'Cannot reach the GraphGoblin API' });
        await expect(offline).toBeVisible();
        await expect.poll(() => probes).toBeGreaterThan(0);
        await measure('Offline banner (API outage)', offline);
        await page.unrouteAll({ behavior: 'wait' });

        await page.goto('/app/loops');
        await expect(page.getByText('responsive sweep').first()).toBeVisible();
        await expect.poll(() => page.evaluate(() => Boolean(window.graphgoblinPwa))).toBe(true);
        await page.evaluate(() => window.graphgoblinPwa!.simulateUpdate());
        const toast = page.getByRole('status').filter({ hasText: 'A new version is available' });
        await expect(toast).toBeVisible();
        await measure('Update toast', toast);

        // The same malformed Events test route used by screens.capture.ts exercises the real boundary.
        await page.route(
          (url) => url.pathname === '/events',
          (route) =>
            route.fulfill({
              json: {
                items: [
                  { id: 'broken', type: 'x', source: 'api', receivedAt: new Date().toISOString() },
                ],
              },
            }),
        );
        await page.goto('/app/events');
        const error = page.getByRole('alert').filter({ hasText: 'This screen failed to render' });
        await expect(error).toBeVisible();
        await measure('Error boundary', error);
        await page.unrouteAll({ behavior: 'wait' });
      }
      const path = testInfo.outputPath('scroll-widths.json');
      await writeFile(path, JSON.stringify(evidence, null, 2) + '\n');
      await testInfo.attach('scroll-widths', { path, contentType: 'application/json' });
      const table = [
        '| Screen / state | Theme | 360 px | 768 px | 1024 px | 1440 px |',
        '| --- | --- | --- | --- | --- | --- |',
        ...[...new Set(evidence.map((row) => row.state))].map((state) => {
          const cells = evidence
            .filter((row) => row.state === state)
            .map((row) => `${row.scrollWidth} / ${row.innerWidth}`);
          return `| ${state} | ${theme} | ${cells.join(' | ')} |`;
        }),
      ].join('\n');
      const markdown = testInfo.outputPath('scroll-widths.md');
      await writeFile(markdown, table + '\n');
      await testInfo.attach('scroll-width table', { path: markdown, contentType: 'text/markdown' });
    });

    test('all nine node dialogs fit their controls at 360 and 768 px', async ({
      page,
      request,
    }) => {
      const { loopId, kinds } = await seedDialogs(request);
      for (const viewport of WIDTHS.slice(0, 2)) {
        await page.setViewportSize(viewport);
        await page.goto(`/app/loops/${loopId}/edit`);
        for (const kind of kinds) {
          await page.locator(`.react-flow__node[data-id="${kind}"]`).focus();
          await page.keyboard.press('Enter');
          const dialog = page.getByRole('dialog', { name: `Edit ${kind} ${kind}` });
          await expect(dialog).toBeVisible();
          await geometry(page, `${kind} dialog at ${viewport.width}`, dialog);
          const advanced = dialog.getByRole('button', { name: /^Advanced\b/ });
          if (await advanced.count()) {
            await openAdvanced(dialog);
            await geometry(page, `${kind} advanced at ${viewport.width}`, dialog);
          }
          if (kind === 'mutate') {
            await openItem(dialog, 'Operations 1');
            await geometry(page, `mutate operation at ${viewport.width}`, dialog);
          }
          await page.keyboard.press('Escape');
          await expect(dialog).toHaveCount(0);
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

    test('a Settings form turns into one column of full-width fields at 360 px', async ({
      page,
    }) => {
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

    test('at 768 px keyboard authoring adds, edits, connects, validates, and publishes', async ({
      page,
      request,
    }) => {
      const definition = approvalLoop('responsive keyboard');
      const created = await request.post('/loops', {
        data: {
          definition: {
            ...definition,
            nodes: definition.nodes.filter((node) => node.id !== 'approve'),
            edges: [],
          },
        },
      });
      expect(created.status()).toBe(201);
      const loopId = ((await created.json()) as { loop: { id: string } }).loop.id;
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.goto(`/app/loops/${loopId}/edit`);
      await expect(page.getByRole('button', { name: 'Show palette' })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
      // Traverse the actual rail with Tab; all authoring below uses only keyboard events.
      await page.getByRole('button', { name: 'Publish', exact: true }).focus();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: 'Show palette' })).toBeFocused();
      for (let i = 0; i < 7; i += 1) await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: 'Add Wait node' })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('node-wait')).toBeVisible();
      const open = async (id: string) => {
        await page.locator(`.react-flow__node[data-id="${id}"]`).focus();
        await page.keyboard.press('Enter');
        await expect(page.getByRole('dialog')).toBeVisible();
        return page.getByRole('dialog');
      };
      let dialog = await open('wait');
      await dialog.getByLabel('Label', { exact: true }).focus();
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.type('Keyboard approval');
      await dialog.getByLabel('To', { exact: true }).focus();
      await page.keyboard.press('Home'); // Done is the first non-trigger target.
      await expect(dialog.getByLabel('To', { exact: true })).toHaveValue('done');
      await dialog.getByRole('button', { name: 'Connect', exact: true }).press('Enter');
      await expect(dialog.getByText('No outgoing edges.')).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('node-wait')).toContainText('Keyboard approval');
      dialog = await open('start');
      await dialog.getByLabel('To', { exact: true }).focus();
      await page.keyboard.press('End'); // Wait is the last target.
      await expect(dialog.getByLabel('To', { exact: true })).toHaveValue('wait');
      await dialog.getByRole('button', { name: 'Connect', exact: true }).press('Enter');
      await page.keyboard.press('Escape');
      await expect(page.locator('.react-flow__edge')).toHaveCount(2);
      await expect(page.getByText('Ready to publish')).toBeVisible();
      await geometry(page, 'keyboard editor');
      await page.getByRole('button', { name: 'Publish', exact: true }).press('Enter');
      await expect(page.getByText('Published version 1.')).toBeVisible();
    });

    /**
     * Visible buttons, fields, and links smaller than 44 px each way. A control that keeps a small
     * look counts by the touch box around it (`touch-target`, an absolute ::after).
     */
    const smallTargets = (page: Page) =>
      page.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLElement>(
            'button, a[href], [role=link], input:not([type=file]), select, summary, .cm-editor',
          ),
        ]
          .map((el) =>
            el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox')
              ? (el.closest('label') ?? el)
              : el,
          )
          .filter((el) => {
            if (el.closest('.react-flow__node, .react-flow__edge')) return false;
            const rect = el.getBoundingClientRect();
            return (
              rect.width > 1 && rect.height > 1 && getComputedStyle(el).visibility !== 'hidden'
            );
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
    }, testInfo) => {
      // This grouped test traverses six screens and nine dialogs, then closes its touch context.
      test.setTimeout(120_000);
      const { loopId, runId } = await seed(request);
      const context = await browser.newContext({
        baseURL: baseURL as string,
        viewport: { width: 768, height: 1024 },
        hasTouch: true,
        isMobile: true,
        serviceWorkers: 'block',
      });
      await context.addInitScript(
        (choice) => localStorage.setItem('graphgoblin-theme', choice),
        theme,
      );
      const page = await context.newPage();
      const measurements: { theme: string; target: string; width: number; height: number }[] = [];
      const measure = async (target: string, locator: Locator) => {
        await page.evaluate(() => document.fonts.ready);
        const box = (await locator.boundingBox())!;
        const row = {
          theme,
          target,
          width: Math.round(box.width * 100) / 100,
          height: Math.round(box.height * 100) / 100,
        };
        expect(box.width, `${target}: touch width`).toBeGreaterThanOrEqual(44);
        expect(box.height, `${target}: touch height`).toBeGreaterThanOrEqual(44);
        measurements.push(row);
        console.log(`touch ${theme}: ${target} ${row.width} x ${row.height} px`);
      };
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
          if (path === `/app/runs/${runId}`) {
            for (const name of ['Full thread JSON', /^Node progress/]) {
              const toggle = page.getByRole('button', { name });
              await measure(await toggle.innerText(), toggle);
              await expect(toggle).toHaveAttribute('aria-expanded', 'false');
              await toggle.tap();
              await expect(toggle).toHaveAttribute('aria-expanded', 'true');
              const panel = page.locator(`[id="${await toggle.getAttribute('aria-controls')}"]`);
              await expect(panel).toBeVisible();
              await toggle.tap();
              await expect(panel).toBeHidden();
            }
          }
        }
        // Exercise every node's radios and short choices, including inference's boolean "No".
        const { loopId: dialogs, kinds } = await seedDialogs(request);
        await page.goto(`/app/loops/${dialogs}/edit`);
        await expect(page.locator('.react-flow__node')).toHaveCount(kinds.length);
        // Fixed 44 px rows keep a 46 px pitch in flow coordinates at every fitted zoom.
        for (const width of [768, 360]) {
          await page.setViewportSize({ width, height: 1024 });
          await page.goto(`/app/loops/${dialogs}/edit`);
          await expect(page.locator('.react-flow__node')).toHaveCount(kinds.length);
          await page.evaluate(() => document.fonts.ready);
          await page.getByRole('button', { name: 'Fit view' }).click();
          await page.waitForTimeout(400); // Fit-view transition and initial card measurements.
          const ports = await portBoxes(page);
          expect(ports.length).toBeGreaterThan(0);
          for (const box of ports) {
            expect(box.width, `${width} px capped port width`).toBeCloseTo(
              Math.min(44 + 0.03125 * box.zoom, box.maxWidth * box.zoom),
              1,
            );
            expect(box.height, `${width} px port height`).toBeCloseTo(
              Math.min(44 + 0.03125 * box.zoom, 46 * box.zoom),
              1,
            );
          }
          expectDisjointPorts(ports);
          const uncapped = ports.find((box) => box.maxWidth > 88)!;
          measurements.push({
            theme,
            target: `Port hit box at ${width} px (fitted zoom ${uncapped.zoom.toFixed(4)}, no nearby card)`,
            width: Number(uncapped.width.toFixed(2)),
            height: Number(uncapped.height.toFixed(2)),
          });
          const spacing = await page.locator('.gg-node-ports').evaluateAll((groups) =>
            groups.flatMap((group) => {
              const rows = [...group.querySelectorAll('.gg-node-port')];
              return rows
                .slice(1)
                .map(
                  (row, i) =>
                    row.getBoundingClientRect().top - rows[i]!.getBoundingClientRect().top,
                );
            }),
          );
          expect(spacing.length).toBeGreaterThan(0);
          for (const distance of spacing)
            expect(distance / ports[0]!.zoom, `${width} px fixed output pitch`).toBeCloseTo(46, 1);
          console.log(
            `touch ${theme}: ${width} px fitted zoom ${uncapped.zoom.toFixed(4)}, uncapped ports ${uncapped.width.toFixed(2)} x ${uncapped.height.toFixed(2)} px, row spacing ${Math.min(...spacing).toFixed(2)} px`,
          );
        }
        await page.setViewportSize({ width: 768, height: 1024 });
        for (const kind of kinds) {
          await page.locator(`.react-flow__node[data-id="${kind}"]`).focus();
          await page.keyboard.press('Enter');
          const dialog = page.getByRole('dialog');
          await expect(dialog).toBeVisible();
          if (await dialog.getByRole('button', { name: /^Advanced\b/ }).count())
            await openAdvanced(dialog);
          if (kind === 'mutate') await openItem(dialog, 'Operations 1');
          expect(await smallTargets(page), `${kind} touch controls`).toEqual([]);
          for (const editor of await dialog.locator('.cm-editor').filter({ visible: true }).all()) {
            const content = editor.locator('.cm-content');
            await measure(`${kind}: ${await content.getAttribute('aria-label')}`, editor);
            expect((await content.boundingBox())!.height).toBeGreaterThanOrEqual(44);
          }
          if (kind === 'wait') {
            const checkbox = dialog.getByRole('checkbox', { name: 'ui', exact: true });
            await measure('wait: ui checkbox label', checkbox.locator('xpath=ancestor::label'));
            const checked = await checkbox.isChecked();
            await checkbox.locator('xpath=ancestor::label').tap();
            await expect(checkbox).toBeChecked({ checked: !checked });
          }
          if (kind === 'inference') {
            const short = dialog.getByRole('radio', { name: 'No', exact: true });
            expect(await short.count()).toBeGreaterThan(0);
            for (const radio of await short.all()) {
              const box = (await radio.locator('xpath=..').boundingBox())!;
              expect(box.width).toBeGreaterThanOrEqual(44);
              expect(box.height).toBeGreaterThanOrEqual(44);
              await radio.locator('xpath=..').tap();
              await expect(radio).toBeChecked();
            }
          }
          await page.keyboard.press('Escape');
          await expect(dialog).toHaveCount(0);
        }
        const path = testInfo.outputPath('touch-targets.json');
        await writeFile(path, JSON.stringify(measurements, null, 2) + '\n');
        await testInfo.attach('touch target sizes', { path, contentType: 'application/json' });
      } finally {
        await context.close();
      }
    });

    test('coarse-pointer zoom preserves card geometry, disjoint targets and the routing cache', async ({
      browser,
      baseURL,
      request,
    }, testInfo) => {
      test.setTimeout(90_000);
      const definition = {
        ...approvalLoop('touch zoom layout'),
        nodes: [
          {
            id: 'start',
            kind: 'trigger',
            label: 'Start',
            config: { subtype: 'manual' },
            ui: { x: -260, y: 0 },
          },
          {
            id: 'decide',
            kind: 'decision',
            label: 'Decide',
            config: {
              answer: {
                type: 'choice',
                options: [
                  { id: 'yes', label: 'Continue', criteria: 'Continue the work' },
                  { id: 'no', label: 'Stop', criteria: 'Stop the work' },
                  { id: 'later', label: 'Wait', criteria: 'Wait before continuing' },
                ],
              },
              evaluation: { kind: 'expression', jsonata: '"yes"' },
              recordAlternatives: true,
            },
            ui: { x: 0, y: 0 },
          },
          {
            id: 'peer',
            kind: 'wait',
            label: 'Peer',
            config: { mode: 'input', prompt: 'Approve?' },
            ui: { x: 260, y: 0 },
          },
          {
            id: 'done',
            kind: 'exit',
            label: 'Done',
            config: { loopBack: { targetNodeId: 'decide' } },
            ui: { x: 520, y: 0 },
          },
        ],
        edges: [
          { id: 'start-decide', from: { node: 'start', port: 'out' }, to: { node: 'decide' } },
          { id: 'decide-peer', from: { node: 'decide', port: 'yes' }, to: { node: 'peer' } },
          { id: 'peer-done', from: { node: 'peer', port: 'out' }, to: { node: 'done' } },
          { id: 'return', from: { node: 'done', port: 'loopBack' }, to: { node: 'decide' } },
        ],
      };
      const response = await request.post('/loops', { data: { definition } });
      expect(response.status(), await response.text()).toBe(201);
      const { loop } = (await response.json()) as { loop: { id: string } };
      const context = await browser.newContext({
        baseURL: baseURL as string,
        viewport: { width: 1440, height: 900 },
        hasTouch: true,
        isMobile: true,
        serviceWorkers: 'block',
      });
      await context.addInitScript(
        (choice) => localStorage.setItem('graphgoblin-theme', choice),
        theme,
      );
      const page = await context.newPage();
      try {
        await page.goto(`/app/loops/${loop.id}/edit`);
        await expect(page.locator('.react-flow__edge')).toHaveCount(4);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(500);
        const heights: number[] = [];
        const measurements = [];
        await page.evaluate(() => performance.clearMeasures('gg:backward-routing'));
        for (const zoom of [1, 0.784, 0.5, 1.2]) {
          await zoomTo(page, zoom);
          const height = await page
            .getByTestId('node-decide')
            .evaluate((el) => (el instanceof HTMLElement ? el.offsetHeight : 0));
          heights.push(height);
          const ports = await portBoxes(page);
          expectDisjointPorts(ports);
          const isolated = ports.find((box) => box.maxWidth > 88)!;
          expect(isolated.width).toBeGreaterThanOrEqual(44);
          expect(isolated.width).toBeLessThan(44.1);
          expect(isolated.height).toBeCloseTo(Math.min(44 + 0.03125 * zoom, 46 * zoom), 1);
          if (zoom >= 1) expect(isolated.height).toBeGreaterThanOrEqual(44);
          const adjacent = ports.find((box) => box.node === 'decide' && box.port === 'yes')!;
          expect(adjacent.maxWidth).toBeCloseTo(38, 1); // Half the 76 px gap at 260 px spacing.
          expect(adjacent.width).toBeCloseTo(Math.min(44 + 0.03125 * zoom, 38 * zoom), 1);
          const neighbor = await page.getByTestId('node-peer').boundingBox();
          const card = (await page.getByTestId('node-decide').boundingBox())!;
          expect(card.x + card.width).toBeLessThan(neighbor!.x);
          measurements.push({
            theme,
            zoom,
            cardHeight: height,
            isolatedTarget: { width: isolated.width, height: isolated.height },
            adjacentTarget: { width: adjacent.width, height: adjacent.height },
            routingMeasures: await page.evaluate(
              () => performance.getEntriesByName('gg:backward-routing').length,
            ),
          });
        }
        expect(heights).toEqual([232, 232, 232, 232]);
        expect(
          await page.evaluate(() => performance.getEntriesByName('gg:backward-routing')),
        ).toHaveLength(0);
        // The review's 300-node/eight-zoom reproduction: no geometry invalidation or routing work.
        const dense = denseGraph(300);
        const created = await request.post('/loops', { data: { definition: dense } });
        expect(created.status()).toBe(201);
        const { loop: large } = (await created.json()) as { loop: { id: string } };
        await page.goto(`/app/loops/${large.id}/edit`);
        await expect(page.locator('.react-flow__edge')).toHaveCount(600);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(500);
        await page.evaluate(() => performance.clearMeasures('gg:backward-routing'));
        for (const zoom of [0.6, 0.8, 1, 0.784, 0.5, 0.7, 0.9, 0.5]) await zoomTo(page, zoom);
        expect(
          await page.evaluate(() => performance.getEntriesByName('gg:backward-routing')),
        ).toHaveLength(0);
        const path = testInfo.outputPath('touch-zoom.json');
        await writeFile(
          path,
          JSON.stringify(
            { measurements, dense: { nodes: 300, edges: 600, zoomChanges: 8, routingMeasures: 0 } },
            null,
            2,
          ) + '\n',
        );
        await testInfo.attach('touch zoom layout and targets', {
          path,
          contentType: 'application/json',
        });
        console.log(
          `touch zoom ${theme}: ${JSON.stringify(measurements)}; 300 nodes, eight zoom changes, zero routing measures`,
        );
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
  });
}
