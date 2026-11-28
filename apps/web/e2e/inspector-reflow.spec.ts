import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { RunEventSchema, type RunEvent } from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import type { APIRequestContext, ElementHandle, Page, TestInfo } from '@playwright/test';
import { approvalLoop, control, expect, publishLoop, test, uniqueLoopName } from './fixtures.js';

/**
 * #563: the run inspector and the shared header reflow at narrow widths and enlarged text without
 * a sideways page scroll, hidden overflow, truncation or smaller text.
 *
 * "200% text" here is computed text enlargement, not browser zoom: the root font size is doubled
 * (`html { font-size: 200% }`), so every rem-sized length, text included, doubles while CSS pixel
 * breakpoints stay where they are. Each cell selects its own Timeline event and checks the exact
 * recorded event shown is that one.
 *
 * Geometry is written to each test's output directory. When this run's output directory ends in
 * `-candidate` and a sibling `-baseline` directory holds the same test's geometry (the same spec run
 * on the build before the change), layouts intended to be unchanged must match it within 0.5 px;
 * intended reflow is recorded as a difference, not compared.
 */

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

interface Overflow {
  where: string;
  text: string;
  rect: Box;
  bound: Box;
  reason: 'viewport' | 'box';
}

interface Metrics {
  viewport: { width: number; height: number };
  rootFontSize: number;
  scroll: { document: number; body: number; height: number };
  overflow: Overflow[];
  uncontained: { where: string; box: Box; text: Box }[];
  focusable: string[];
  boxes: Record<string, Box>;
  timeline: { scrollWidth: number; clientWidth: number; tabStops: number } | null;
  runId: { text: string; lines: number } | null;
}

interface Layout {
  width: number;
  text: 100 | 200;
  /** Unchanged layouts must match the baseline; intended reflow is only recorded. */
  intended: 'unchanged' | 'reflow';
}

const SEQUENCES = [10_593, 123_456, 123_456_789_012_345] as const;
// 1440 px with 200% text reflows too: on the build before #563 the run controls covered the run ID
// there (a double click on the ID was intercepted by them) and the status badge was cut short.
const MATRIX: Layout[] = [
  { width: 320, text: 100, intended: 'unchanged' },
  { width: 320, text: 200, intended: 'reflow' },
  { width: 1440, text: 100, intended: 'unchanged' },
  { width: 1440, text: 200, intended: 'reflow' },
];
const BREAKPOINTS: Layout[] = [
  { width: 639, text: 200, intended: 'reflow' },
  { width: 640, text: 200, intended: 'reflow' },
  { width: 768, text: 200, intended: 'reflow' },
];
const layoutName = ({ width, text }: Layout) => `${width}px-${text}pct`;

async function runStatus(request: APIRequestContext, runId: string, url = '') {
  const response = await request.get(`${url}/runs/${runId}`);
  return (await response.json()) as { status: string; finalizedAt?: string };
}

/**
 * A finished run of a published minimal loop, as the real API records it: on the shared gateway,
 * or on the instance at `url`.
 */
async function finishedRun(request: APIRequestContext, name: string, loopId?: string, url = '') {
  const id =
    loopId ?? (await publishLoop(request, { ...minimalLoop(), name: uniqueLoopName(name) }, url));
  const started = await request.post(`${url}/loops/${id}/runs`, { data: { input: null } });
  expect(started.status()).toBe(202);
  const { run } = (await started.json()) as { run: { id: string } };
  await expect.poll(async () => (await runStatus(request, run.id, url)).status).toBe('succeeded');
  await expect.poll(async () => (await runStatus(request, run.id, url)).finalizedAt).toBeTruthy();
  return run.id;
}

/** Contract-valid events whose sequences are the matrix's, with the longest event type or not. */
function fixtureEvents(runId: string, longest = false): RunEvent[] {
  const ts = new Date().toISOString();
  const third = longest
    ? {
        type: 'delivery.attempt_finished',
        delivery: {
          id: 'delivery-1',
          channel: { kind: 'webhook', url: 'https://example.invalid/hook' },
          status: 'delivered',
          attempts: 1,
          maxAttempts: 5,
          inFlight: false,
          acknowledgement: 'accepted',
          effectMayHaveHappened: true,
          acknowledgementUncertain: false,
        },
      }
    : { type: 'return.delivered', channel: { kind: 'log' } };
  return [
    { runId, seq: SEQUENCES[0], ts, type: 'run.started', attempt: 1 },
    {
      runId,
      seq: SEQUENCES[1],
      ts,
      type: 'iteration.incremented',
      from: 1,
      to: 2,
      targetNodeId: 'n',
    },
    { runId, seq: SEQUENCES[2], ts, ...third },
    {
      runId,
      seq: SEQUENCES[2] + 1,
      ts,
      type: 'run.finished',
      status: 'succeeded',
      outcome: 'success',
    },
  ].map((event) => RunEventSchema.parse(event));
}

/** Serve the run's history and live tail from `events` only, as the API's SSE frames would. */
async function serveEvents(page: Page, runId: string, events: RunEvent[]) {
  const last = events.at(-1)!.seq;
  await page.route(
    (url) => url.pathname === `/runs/${runId}/events`,
    async (route) => {
      const after = Number(new URL(route.request().url()).searchParams.get('after') ?? 0);
      const items = events.filter((item) => item.seq > after);
      if (route.request().headers()['accept'] === 'text/event-stream') {
        const frames = items
          .map((item) => `id: ${item.seq}\nevent: ${item.type}\ndata: ${JSON.stringify(item)}\n\n`)
          .join('');
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
          body: `${frames}event: stream.complete\ndata: ${JSON.stringify({ after: last })}\n\n`,
        });
      } else {
        await route.fulfill({
          json: { items, nextAfter: last, hasMore: false, olderCursor: null, newerCursor: null },
        });
      }
    },
  );
}

/** Two frames after the fonts have loaded: layout has settled. */
async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
}

const rootFontSize = (page: Page) =>
  page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));

/** Computed text enlargement (not zoom): rem-sized text doubles; CSS breakpoints do not move. */
async function setText(
  page: Page,
  text: 100 | 200,
  current: ElementHandle | undefined,
): Promise<ElementHandle | undefined> {
  if (current) {
    await current.evaluate((tag) => (tag as Element).remove());
    current = undefined;
  }
  const base = await rootFontSize(page);
  if (text === 200) {
    current = await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await expect.poll(() => rootFontSize(page)).toBe(base * 2);
  }
  await settle(page);
  return current;
}

/** Everything a cell checks and compares, measured in the page as it is now. */
function collect(page: Page, root?: string): Promise<Metrics> {
  return page.evaluate((rootSelector) => {
    const box = (r: DOMRect) => ({
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
    });
    const clean = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();
    const shown = (el: Element) => {
      const style = getComputedStyle(el);
      return style.visibility !== 'hidden' && el.getClientRects().length > 0;
    };
    const visuallyHidden = (el: Element | null) => {
      for (let e = el; e; e = e.parentElement) {
        const style = getComputedStyle(e);
        if (e.classList.contains('sr-only')) return true;
        if (style.clipPath !== 'none' || (style.clip !== 'auto' && style.clip !== '')) return true;
      }
      return false;
    };
    const describe = (el: Element) => {
      const parts: string[] = [];
      for (let e: Element | null = el, i = 0; e && e !== document.body && i < 4; i++) {
        const label = e.getAttribute('aria-label');
        parts.unshift(
          `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ''}${label ? `[${label}]` : ''}`,
        );
        e = e.parentElement;
      }
      return parts.join(' > ');
    };
    const width = document.documentElement.clientWidth;
    const scope = rootSelector ? document.querySelector(rootSelector) : document.body;
    if (!scope) throw new Error(`nothing matches ${rootSelector}`);

    // Text that leaves the viewport, or the box of the nearest non-inline element around it.
    // The only permitted sideways scroller is the named, focusable exact JSON view.
    const overflow: Overflow[] = [];
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || !clean(node.textContent) || visuallyHidden(parent)) continue;
      if (parent.closest('pre[role="region"][tabindex="0"][aria-label]')) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
      if (!rects.length) continue;
      let block: Element = parent;
      while (
        block.parentElement &&
        ['inline', 'contents'].includes(getComputedStyle(block).display)
      )
        block = block.parentElement;
      const bound = block.getBoundingClientRect();
      for (const rect of rects) {
        const reason =
          rect.left < -0.5 || rect.right > width + 0.5
            ? 'viewport'
            : rect.left < bound.left - 0.5 || rect.right > bound.right + 0.5
              ? 'box'
              : undefined;
        if (reason)
          overflow.push({
            where: describe(parent),
            text: clean(node.textContent).slice(0, 60),
            rect: box(rect),
            bound: box(bound),
            reason,
          });
      }
    }

    // Control text stays vertically inside its control.
    const uncontained: Metrics['uncontained'] = [];
    for (const control of scope.querySelectorAll('button, select, [role="button"]')) {
      if (!shown(control) || visuallyHidden(control)) continue;
      const outer = control.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(control);
      for (const rect of range.getClientRects()) {
        if (rect.width === 0 || rect.height === 0) continue;
        if (rect.top < outer.top - 0.5 || rect.bottom > outer.bottom + 0.5)
          uncontained.push({ where: describe(control), box: box(outer), text: box(rect) });
      }
    }

    // The keyboard's order: focusable, shown, outside inert content, in document order.
    const focusable = [
      ...scope.querySelectorAll<HTMLElement>(
        'a[href], button, input, select, textarea, summary, [tabindex]',
      ),
    ]
      .filter(
        (el) =>
          el.tabIndex >= 0 &&
          !(el as HTMLButtonElement).disabled &&
          !el.closest('[inert]') &&
          shown(el) &&
          !visuallyHidden(el),
      )
      .map((el) => {
        const labelled = (el as HTMLInputElement).labels?.[0]?.textContent;
        const name = clean(el.getAttribute('aria-label') ?? labelled ?? el.textContent);
        return `${el.tagName.toLowerCase()}:${name.replace(/[0-9A-HJKMNP-TV-Z]{26}/g, '<id>').slice(0, 80)}`;
      });

    const boxes: Record<string, Box> = {};
    const add = (key: string, el: Element | null | undefined) => {
      if (el && shown(el)) boxes[key] = box(el.getBoundingClientRect());
    };
    const shell = document.querySelector('header.hairline-accent');
    add('header', shell);
    add('logo', shell?.firstElementChild);
    add('menu', shell?.querySelector('button[aria-controls]'));
    const nav = document.querySelector('nav[aria-label="Main"]');
    add('nav', nav);
    for (const link of nav?.querySelectorAll('a') ?? [])
      add(`nav:${clean(link.textContent)}`, link);
    const h1 = document.querySelector('h1');
    add('h1', h1);
    const idSpan = h1?.querySelector('span.font-mono');
    add('run-id', idSpan);
    const runHeader = h1?.closest('header');
    add('run-header', runHeader);
    add('status', runHeader?.querySelector('[data-status], [data-status-updating]'));
    for (const button of runHeader?.querySelectorAll('button') ?? [])
      add(`control:${clean(button.textContent)}`, button);
    add('resume-reason', document.querySelector('[id^="resume-reason-"]'));
    for (const button of document.querySelectorAll('button')) {
      const name = clean(button.textContent);
      if (['Review delete-ready history', 'Withdraw delete-ready mark'].includes(name))
        add(`history:${name}`, button);
    }
    const list = document.querySelector('ol[aria-label="Timeline"]');
    add('timeline', list?.closest('section'));
    add('timeline-list', list);
    add('timeline-input', document.querySelector('form input[type="number"]'));

    let lines = 0;
    if (idSpan) {
      const tops = new Set<number>();
      const range = document.createRange();
      range.selectNodeContents(idSpan);
      for (const rect of range.getClientRects()) if (rect.width > 0) tops.add(Math.round(rect.top));
      lines = tops.size;
    }
    return {
      viewport: { width, height: document.documentElement.clientHeight },
      rootFontSize: parseFloat(getComputedStyle(document.documentElement).fontSize),
      scroll: {
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
        height: document.documentElement.scrollHeight,
      },
      overflow,
      uncontained,
      focusable,
      boxes,
      timeline:
        list instanceof HTMLElement
          ? {
              scrollWidth: list.scrollWidth,
              clientWidth: list.clientWidth,
              tabStops: list.querySelectorAll('button[tabindex="0"]').length,
            }
          : null,
      runId: idSpan ? { text: idSpan.textContent ?? '', lines } : null,
    };
  }, root);
}

/** `scrollTo(999, 0)` leaves the page where it was sideways. */
const sideways = (page: Page) =>
  page.evaluate(() => {
    window.scrollTo(999, window.scrollY);
    const x = window.scrollX;
    window.scrollTo(0, window.scrollY);
    return x;
  });

/** Focus every control in order; none may make the page scroll sideways. */
const sidewaysWhileFocusing = (page: Page) =>
  page.evaluate(() => {
    const moved: string[] = [];
    const controls = [
      ...document.querySelectorAll<HTMLElement>(
        'main a[href], body a[href], button, input, select, textarea, [tabindex]',
      ),
    ].filter((el) => el.tabIndex >= -1 && el.getClientRects().length > 0 && !el.closest('[inert]'));
    for (const control of new Set(controls)) {
      control.focus({ preventScroll: false });
      window.scrollTo(999, window.scrollY);
      if (window.scrollX !== 0)
        moved.push(
          `${control.tagName.toLowerCase()}:${(control.textContent ?? '').trim().slice(0, 40)}`,
        );
      window.scrollTo(0, window.scrollY);
    }
    (document.activeElement as HTMLElement | null)?.blur();
    return moved;
  });

/** Soft, so one cell records every containment failure it has rather than only the first. */
function expectContained(metrics: Metrics, where: string) {
  expect.soft(metrics.scroll.document, `${where}: document width`).toBe(metrics.viewport.width);
  expect
    .soft(metrics.scroll.body, `${where}: body width`)
    .toBeLessThanOrEqual(metrics.viewport.width);
  expect.soft(metrics.overflow, `${where}: text outside its box or the viewport`).toEqual([]);
  expect.soft(metrics.uncontained, `${where}: control text outside its control`).toEqual([]);
  if (metrics.timeline) {
    expect
      .soft(metrics.timeline.scrollWidth, `${where}: Timeline sideways range`)
      .toBeLessThanOrEqual(metrics.timeline.clientWidth);
    expect.soft(metrics.timeline.tabStops, `${where}: Timeline tab stops`).toBe(1);
  }
}

function baselineOf(info: TestInfo, file: string): string | undefined {
  const root = info.project.outputDir;
  if (!/-candidate$/.test(root)) return undefined;
  return join(root.replace(/-candidate$/, '-baseline'), relative(root, info.outputDir), file);
}

/** Records this run's cells, then holds unchanged cells to the baseline run of the same test. */
async function compareWithBaseline(
  info: TestInfo,
  cells: Record<string, { layout: Layout; metrics: Metrics }>,
) {
  const geometry = info.outputPath('geometry.json');
  await writeFile(geometry, JSON.stringify(cells, null, 2));
  await info.attach('geometry', { path: geometry, contentType: 'application/json' });
  const file = baselineOf(info, 'geometry.json');
  if (!file) return;
  expect(existsSync(file), `baseline geometry ${file}`).toBe(true);
  const baseline = JSON.parse(await readFile(file, 'utf8')) as typeof cells;
  const report: Record<string, unknown> = {};
  for (const [name, { layout, metrics }] of Object.entries(cells)) {
    const before = baseline[name]?.metrics;
    expect(before, `baseline cell ${name}`).toBeDefined();
    const differences: { key: string; before?: Box; after?: Box }[] = [];
    for (const key of new Set([...Object.keys(before!.boxes), ...Object.keys(metrics.boxes)])) {
      const a = before!.boxes[key];
      const b = metrics.boxes[key];
      const edges = ['left', 'top', 'right', 'bottom'] as const;
      if (!a || !b || edges.some((edge) => Math.abs(a[edge] - b[edge]) > 0.5))
        differences.push({ key, ...(a ? { before: a } : {}), ...(b ? { after: b } : {}) });
    }
    report[name] = {
      intended: layout.intended,
      differences,
      focusOrderUnchanged: JSON.stringify(before!.focusable) === JSON.stringify(metrics.focusable),
    };
  }
  const path = info.outputPath('baseline-comparison.json');
  await writeFile(path, JSON.stringify(report, null, 2));
  await info.attach('baseline comparison', { path, contentType: 'application/json' });
  for (const [name, { layout, metrics }] of Object.entries(cells)) {
    const before = baseline[name]!.metrics;
    expect
      .soft(metrics.focusable, `${name}: the keyboard's order and names`)
      .toEqual(before.focusable);
    if (layout.intended === 'unchanged')
      expect
        .soft((report[name] as { differences: unknown[] }).differences, `${name}: boxes`)
        .toEqual([]);
  }
}

/** Below 640 px: Menu opens a panel at the header's bottom edge; Escape closes it to Menu. */
async function checkMenu(page: Page, info: TestInfo, name: string) {
  const menu = page.getByRole('button', { name: 'Menu' });
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await expect(nav).toBeVisible();
  await settle(page);
  const placement = await page.evaluate(() => {
    const header = document.querySelector('header.hairline-accent')!.getBoundingClientRect();
    const panel = document.querySelector('nav[aria-label="Main"]')!.getBoundingClientRect();
    return { header: header.bottom, panel: panel.top, right: panel.right };
  });
  const open = await collect(page, 'header.hairline-accent');
  await page.screenshot({ path: info.outputPath(`${name}-menu-open.png`) });
  expect
    .soft(Math.abs(placement.panel - placement.header), `${name}: panel at header bottom`)
    .toBeLessThanOrEqual(0.5);
  expect.soft(open.overflow, `${name}: menu text`).toEqual([]);
  expect.soft(open.uncontained, `${name}: menu control text`).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(menu).toBeFocused();
  await expect(nav).toBeHidden();
  return placement;
}

/** The real Tab sequence from the first stop matches the order measured. */
async function checkTabOrder(page: Page, expected: string[], name: string) {
  const active = () =>
    page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return '';
      const labelled = (el as HTMLInputElement).labels?.[0]?.textContent;
      const label = (el.getAttribute('aria-label') ?? labelled ?? el.textContent ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      return `${el.tagName.toLowerCase()}:${label.replace(/[0-9A-HJKMNP-TV-Z]{26}/g, '<id>').slice(0, 80)}`;
    });
  // Start at the first stop the measurement found, then let the browser move focus.
  await page.evaluate(() => {
    const first = [
      ...document.querySelectorAll<HTMLElement>(
        'a[href], button, input, select, textarea, summary, [tabindex]',
      ),
    ].find(
      (el) =>
        el.tabIndex >= 0 &&
        !(el as HTMLButtonElement).disabled &&
        !el.closest('[inert]') &&
        el.getClientRects().length > 0,
    );
    first?.focus();
  });
  const count = Math.min(expected.length, 18);
  const seen = [await active()];
  for (let i = 1; i < count; i++) {
    await page.keyboard.press('Tab');
    seen.push(await active());
  }
  expect.soft(seen, `${name}: Tab order`).toEqual(expected.slice(0, count));
}

/** One Tab stop; Home, End and Page Down move within; Tab leaves; nothing scrolls sideways. */
async function checkTimelineKeys(page: Page, name: string) {
  const list = page.getByRole('list', { name: 'Timeline', exact: true });
  const rows = list.getByRole('button');
  await list.locator('button[tabindex="0"]').focus();
  for (const [key, target] of [
    ['Home', rows.first()],
    ['End', rows.last()],
    ['Home', rows.first()],
  ] as const) {
    await page.keyboard.press(key);
    await expect(target, `${name}: ${key}`).toBeFocused();
    expect(await sideways(page), `${name}: sideways after ${key}`).toBe(0);
  }
  await page.keyboard.press('PageDown');
  await expect(rows.last(), `${name}: PageDown`).toBeFocused();
  expect(await sideways(page), `${name}: sideways after PageDown`).toBe(0);
  await expect(list.locator('button[tabindex="0"]')).toHaveCount(1);
  await page.keyboard.press('Tab');
  expect(
    await list.evaluate((el) => el.contains(document.activeElement)),
    `${name}: Tab leaves the Timeline`,
  ).toBe(false);
}

/** Select `seq` in the Timeline and wait for its exact recorded event and thread. */
async function selectEvent(page: Page, seq: number) {
  const row = page.locator(`ol[aria-label="Timeline"] button[data-seq="${seq}"]`);
  await row.click();
  await expect(row).toHaveAttribute('aria-current', 'true');
  await expect(
    page.getByRole('button', { name: `Exact recorded event #${seq}`, exact: true }),
  ).toBeVisible();
  await expect(page.getByText(`Reading the thread at event ${seq}…`)).toHaveCount(0);
  // The selected event is this cell's, not another sequence's.
  await expect(page.getByRole('button', { name: /^Exact recorded event #/ })).toHaveText(
    `Exact recorded event #${seq}`,
  );
}

/** Shots of the whole page and of each part a reader uses. */
async function capture(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: info.outputPath(`${name}-full.png`), fullPage: true });
  await page
    .locator('header.hairline-accent')
    .screenshot({ path: info.outputPath(`${name}-header.png`) });
  const runHeader = page.locator('h1').locator('xpath=ancestor::header[1]');
  if (await runHeader.count())
    await runHeader.screenshot({ path: info.outputPath(`${name}-run-header.png`) });
  const history = page.getByRole('button', { name: 'Review delete-ready history' });
  if (await history.count())
    await history
      .locator('xpath=ancestor::div[2]')
      .screenshot({ path: info.outputPath(`${name}-history.png`) });
}

/** The Replay review: its text stays in the sheet, and Escape returns to its trigger. */
async function checkReplayDialog(page: Page, info: TestInfo, name: string) {
  const trigger = page.getByRole('button', { name: 'Replay...', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Replay as a new run' });
  await expect(dialog).toBeVisible();
  await settle(page);
  const metrics = await collect(page, 'dialog[open]');
  await page.screenshot({ path: info.outputPath(`${name}-dialog.png`) });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  return metrics;
}

async function openInspector(page: Page, runId: string, layout: Layout) {
  await page.setViewportSize({ width: layout.width, height: 900 });
  await page.goto(`/app/runs/${runId}`);
  await expect(page.getByRole('heading', { name: `Run ${runId}` })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: /^Timeline \(\d+ events, complete\)$/ }),
  ).toBeVisible();
}

for (const layout of MATRIX) {
  for (const seq of SEQUENCES) {
    test(`inspector at ${layoutName(layout)} with event #${seq} selected (#563)`, async ({
      page,
      request,
    }, info) => {
      const runId = await finishedRun(request, 'Reflow matrix');
      const events = fixtureEvents(runId);
      await serveEvents(page, runId, events);
      try {
        await openInspector(page, runId, layout);
        await expect(page.locator('ol[aria-label="Timeline"] button[data-seq]')).toHaveCount(
          events.length,
        );
        await setText(page, layout.text, undefined);
        await selectEvent(page, seq);
        await settle(page);
        const name = layoutName(layout);
        const metrics = await collect(page);
        await capture(page, info, name);
        await compareWithBaseline(info, { [name]: { layout, metrics } });

        expect(metrics.runId?.text).toBe(runId);
        expectContained(metrics, name);
        expect.soft(await sideways(page), `${name}: scrollTo(999, 0)`).toBe(0);
        // A double click selects exactly the whole run ID, however it wraps.
        await page.locator('h1 span.font-mono').dblclick();
        expect.soft(await page.evaluate(() => getSelection()?.toString())).toBe(runId);
        await page.evaluate(() => getSelection()?.removeAllRanges());
        if (layout.width < 640) await checkMenu(page, info, name);
        const dialog = await checkReplayDialog(page, info, name);
        expect.soft(dialog.overflow, `${name}: dialog text`).toEqual([]);
        expect.soft(dialog.uncontained, `${name}: dialog control text`).toEqual([]);
        await checkTabOrder(page, metrics.focusable, name);
        await checkTimelineKeys(page, name);
        expect
          .soft(await sidewaysWhileFocusing(page), `${name}: focus scrolls sideways`)
          .toEqual([]);
        // Still the same selection after every check.
        await expect(
          page.getByRole('button', { name: `Exact recorded event #${seq}`, exact: true }),
        ).toBeVisible();
      } finally {
        await page.unrouteAll({ behavior: 'ignoreErrors' });
      }
    });
  }
}

for (const layout of BREAKPOINTS) {
  test(`inspector at the ${layoutName(layout)} breakpoint (#563)`, async ({
    page,
    request,
  }, info) => {
    const runId = await finishedRun(request, 'Reflow breakpoint');
    const events = fixtureEvents(runId);
    const seq = SEQUENCES[2];
    await serveEvents(page, runId, events);
    try {
      await openInspector(page, runId, layout);
      await setText(page, layout.text, undefined);
      await selectEvent(page, seq);
      await settle(page);
      const name = layoutName(layout);
      const metrics = await collect(page);
      await capture(page, info, name);
      await compareWithBaseline(info, { [name]: { layout, metrics } });
      expectContained(metrics, name);
      expect.soft(await sideways(page), `${name}: scrollTo(999, 0)`).toBe(0);
      if (layout.width < 640) await checkMenu(page, info, name);
      else await expect(page.getByRole('button', { name: 'Menu' })).toBeHidden();
      const dialog = await checkReplayDialog(page, info, name);
      expect.soft(dialog.overflow, `${name}: dialog text`).toEqual([]);
      expect.soft(dialog.uncontained, `${name}: dialog control text`).toEqual([]);
      await checkTimelineKeys(page, name);
      expect.soft(await sidewaysWhileFocusing(page), `${name}: focus scrolls sideways`).toEqual([]);
    } finally {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
  });
}

const CONTROL_LAYOUTS: Layout[] = [
  { width: 1440, text: 100, intended: 'unchanged' },
  { width: 320, text: 200, intended: 'reflow' },
];

test('a replay run names its source in full at 1440 px and at 320 px with 200% text (#563)', async ({
  page,
  request,
}, info) => {
  const source = await finishedRun(request, 'Reflow replay source');
  const observed = (await (await request.get(`/runs/${source}`)).json()) as {
    recovery: { observedSeq: number };
  };
  const replay = await request.post(`/runs/${source}/replay`, {
    data: { nodeId: 'done', observedSeq: observed.recovery.observedSeq },
  });
  expect(replay.status()).toBe(202);
  const fork = ((await replay.json()) as { run: { id: string } }).run.id;
  await expect.poll(async () => (await runStatus(request, fork)).status).toBe('succeeded');
  const cells: Record<string, { layout: Layout; metrics: Metrics }> = {};
  for (const layout of CONTROL_LAYOUTS) {
    await page.setViewportSize({ width: layout.width, height: 900 });
    await page.goto(`/app/runs/${fork}`);
    await expect(page.getByRole('heading', { name: `Run ${fork}` })).toBeVisible();
    const origin = page.getByText(`Replay run ${fork} from`, { exact: false });
    await expect(origin).toContainText(source);
    const tag = await setText(page, layout.text, undefined);
    const name = layoutName(layout);
    cells[name] = { layout, metrics: await collect(page) };
    await capture(page, info, `replay-${name}`);
    await tag?.evaluate((element) => (element as Element).remove());
  }
  await compareWithBaseline(info, cells);
  for (const [name, { metrics }] of Object.entries(cells)) expectContained(metrics, name);
});

test('a child run links its parent at 1440 px and at 320 px with 200% text (#563)', async ({
  page,
  request,
}, info) => {
  const child = await publishLoop(request, {
    ...minimalLoop(),
    name: uniqueLoopName('Reflow child'),
  });
  const base = minimalLoop();
  const parentLoop = await publishLoop(request, {
    ...base,
    name: uniqueLoopName('Reflow parent'),
    nodes: [
      base.nodes[0]!,
      { id: 'sub', kind: 'subloop', label: 'Sub', config: { loopRef: { loopId: child } } },
      base.nodes[1]!,
    ],
    edges: [
      { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'sub' } },
      { id: 'b', from: { node: 'sub', port: 'out' }, to: { node: 'done' } },
    ],
  });
  const parent = await finishedRun(request, 'Reflow parent', parentLoop);
  const children = (await (await request.get(`/runs?parent=${parent}`)).json()) as {
    items: { id: string }[];
  };
  const childId = children.items[0]!.id;
  const cells: Record<string, { layout: Layout; metrics: Metrics }> = {};
  for (const layout of CONTROL_LAYOUTS) {
    await page.setViewportSize({ width: layout.width, height: 900 });
    await page.goto(`/app/runs/${childId}`);
    await expect(page.getByRole('heading', { name: `Run ${childId}` })).toBeVisible();
    const link = page.locator('h1').locator('xpath=ancestor::header[1]').getByRole('link', {
      name: 'parent run',
    });
    await expect(link).toHaveAttribute('href', `/app/runs/${parent}`);
    const tag = await setText(page, layout.text, undefined);
    const name = layoutName(layout);
    cells[name] = { layout, metrics: await collect(page) };
    await capture(page, info, `child-${name}`);
    await tag?.evaluate((element) => (element as Element).remove());
  }
  await compareWithBaseline(info, cells);
  for (const [name, { metrics }] of Object.entries(cells)) expectContained(metrics, name);
});

test('the longest contract event type stays whole in its row at 320 px with 200% text (#563)', async ({
  page,
  request,
}, info) => {
  const runId = await finishedRun(request, 'Reflow longest type');
  const events = fixtureEvents(runId, true);
  const longest = events[2]!;
  expect(longest.type).toBe('delivery.attempt_finished');
  await serveEvents(page, runId, events);
  try {
    const layout: Layout = { width: 320, text: 200, intended: 'reflow' };
    await openInspector(page, runId, layout);
    await setText(page, 200, undefined);
    await selectEvent(page, longest.seq);
    await settle(page);
    const metrics = await collect(page);
    const row = await page
      .locator(`ol[aria-label="Timeline"] button[data-seq="${longest.seq}"]`)
      .evaluate((button) => {
        const [seq, type] = [...button.children];
        const range = document.createRange();
        range.selectNodeContents(type!);
        const outer = button.getBoundingClientRect();
        return {
          seq: seq?.textContent,
          type: type?.textContent,
          typeWidth: type!.getBoundingClientRect().width,
          rowWidth: outer.width,
          inside: [...range.getClientRects()].every(
            (rect) => rect.left >= outer.left - 0.5 && rect.right <= outer.right + 0.5,
          ),
        };
      });
    await info.attach('longest type row', {
      body: JSON.stringify(row, null, 2),
      contentType: 'application/json',
    });
    await capture(page, info, 'longest-type-320px-200pct');
    await compareWithBaseline(info, { 'longest-320px-200pct': { layout, metrics } });
    expect(row.seq).toBe(`#${longest.seq}`);
    expect(row.type).toBe('delivery.attempt_finished');
    expect.soft(row.inside).toBe(true);
    expectContained(metrics, 'longest type');
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  }
});

/** A run of `approvalLoop` waiting for input at `approve`, with an input schema or without one. */
async function waitingRun(request: APIRequestContext, schema: boolean) {
  const base = approvalLoop(uniqueLoopName(schema ? 'Reflow waiting schema' : 'Reflow waiting'));
  const definition = schema
    ? {
        ...base,
        nodes: base.nodes.map((node) =>
          node.id === 'approve'
            ? {
                ...node,
                config: {
                  ...node.config,
                  inputSchema: {
                    type: 'object',
                    properties: { reason: { type: 'string', title: 'Reason' } },
                    required: ['reason'],
                  },
                },
              }
            : node,
        ),
      }
    : base;
  const loopId = await publishLoop(request, definition);
  const started = await request.post(`/loops/${loopId}/runs`, {
    data: { triggerNodeId: 'start', input: {} },
  });
  expect(started.status()).toBe(202);
  const { run } = (await started.json()) as { run: { id: string } };
  await expect.poll(async () => (await runStatus(request, run.id)).status).toBe('waiting');
  return run.id;
}

/** Every box inside the card stays inside the card's own box, sideways. */
const outsideCard = (page: Page, title: RegExp) =>
  page
    .getByRole('heading', { name: title })
    .locator('xpath=ancestor::section[1]')
    .evaluate((card) => {
      const bound = card.getBoundingClientRect();
      return (
        [...card.querySelectorAll('*')]
          // The named exact-JSON scroller may hold wider content; hidden text takes no room.
          .filter(
            (el) =>
              el.getClientRects().length > 0 &&
              !el.closest('.sr-only') &&
              !el.parentElement?.closest('pre[role="region"][tabindex="0"][aria-label]'),
          )
          .map((el) => ({ el, box: el.getBoundingClientRect() }))
          .filter(({ box }) => box.left < bound.left - 0.5 || box.right > bound.right + 0.5)
          .map(({ el, box }) => ({
            where: `${el.tagName.toLowerCase()}${el.getAttribute('aria-label') ? `[${el.getAttribute('aria-label')}]` : ''}`,
            left: box.left,
            right: box.right,
            card: { left: bound.left, right: bound.right },
          }))
      );
    });

for (const schema of [false, true]) {
  test(`a run waiting for input ${schema ? 'with' : 'without'} an input schema keeps its form inside its card at every width and text size (#563)`, async ({
    page,
    request,
  }, info) => {
    const runId = await waitingRun(request, schema);
    const cells: Record<string, { layout: Layout; metrics: Metrics }> = {};
    const strays: Record<string, unknown> = {};
    const sideways0: Record<string, number> = {};
    for (const layout of MATRIX) {
      await page.setViewportSize({ width: layout.width, height: 900 });
      await page.goto(`/app/runs/${runId}`);
      await expect(page.getByRole('heading', { name: `Run ${runId}` })).toBeVisible();
      await expect(page.getByRole('heading', { name: /Input requested/ })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Submit input', exact: true })).toBeVisible();
      // The Timeline's history and the event it shows have arrived: the page has settled.
      await expect(page.getByRole('heading', { name: /^Timeline \(\d+ events, / })).toBeVisible();
      await expect(
        page.locator('ol[aria-label="Timeline"] button[data-seq]').first(),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: /^Exact recorded event #\d+$/ })).toBeVisible();
      const tag = await setText(page, layout.text, undefined);
      const name = layoutName(layout);
      cells[name] = { layout, metrics: await collect(page) };
      strays[name] = await outsideCard(page, /Input requested/);
      sideways0[name] = await sideways(page);
      await capture(page, info, `waiting-${name}`);
      await page
        .getByRole('heading', { name: /Input requested/ })
        .locator('xpath=ancestor::section[1]')
        .screenshot({ path: info.outputPath(`waiting-${name}-card.png`) });
      await tag?.evaluate((element) => (element as Element).remove());
    }
    await info.attach('outside the input card', {
      body: JSON.stringify(strays, null, 2),
      contentType: 'application/json',
    });
    await compareWithBaseline(info, cells);
    for (const [name, { metrics }] of Object.entries(cells)) {
      expectContained(metrics, `waiting ${name}`);
      expect.soft(strays[name], `waiting ${name}: boxes outside the input card`).toEqual([]);
      expect.soft(sideways0[name], `waiting ${name}: scrollTo(999, 0)`).toBe(0);
    }
  });
}

test('the New run form keeps a one-line Start run at 100% text and wraps it inside the viewport with 200% text (#563)', async ({
  page,
  request,
}, info) => {
  const loopId = await publishLoop(request, {
    ...minimalLoop(),
    name: uniqueLoopName('Reflow new run'),
  });
  const notes: Record<string, unknown> = {};
  for (const layout of [...MATRIX, { width: 360, text: 200, intended: 'reflow' } as const]) {
    await page.setViewportSize({ width: layout.width, height: 900 });
    await page.goto(`/app/runs/new?loop=${loopId}`);
    const start = page.getByRole('button', { name: 'Start run', exact: true });
    await expect(start).toBeVisible();
    const tag = await setText(page, layout.text, undefined);
    const name = layoutName(layout);
    const form = await collect(page, 'form[aria-label="Start run"]');
    const box = (await start.boundingBox())!;
    const root = await rootFontSize(page);
    notes[name] = { button: box, documentWidth: (await collect(page)).scroll.document };
    await page.screenshot({ path: info.outputPath(`new-run-${name}.png`), fullPage: true });
    expect.soft(form.overflow, `${name}: form text`).toEqual([]);
    expect.soft(form.uncontained, `${name}: form control text`).toEqual([]);
    expect.soft(box.x, `${name}: Start run left`).toBeGreaterThanOrEqual(-0.5);
    expect
      .soft(box.x + box.width, `${name}: Start run right`)
      .toBeLessThanOrEqual(layout.width + 0.5);
    // At 100% the label fits: the button keeps its usual one-line height (2.25 rem).
    if (layout.text === 100)
      expect
        .soft(Math.abs(box.height - 2.25 * root), `${name}: Start run height`)
        .toBeLessThanOrEqual(0.5);
    await tag?.evaluate((element) => (element as Element).remove());
  }
  await info.attach('new run form', {
    body: JSON.stringify(notes, null, 2),
    contentType: 'application/json',
  });
});

test('the complete run ID is copied from a native selection at 320 px with 200% text (#563)', async ({
  page,
  context,
  request,
}) => {
  const runId = await finishedRun(request, 'Reflow copy');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openInspector(page, runId, { width: 320, text: 200, intended: 'reflow' });
  await setText(page, 200, undefined);
  const id = page.locator('h1 span.font-mono');
  await id.dblclick();
  expect(await page.evaluate(() => getSelection()?.toString())).toBe(runId);
  await page.keyboard.press('ControlOrMeta+C');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(runId);
});

/** The open dialog's footer actions, each with whether it stays inside the dialog sideways. */
const footerActions = (page: Page) =>
  page.evaluate(() => {
    const dialog = document.querySelector('dialog[open]');
    if (!dialog) throw new Error('no open dialog');
    const sheet = dialog.getBoundingClientRect();
    return [...dialog.querySelectorAll('footer button')].map((button) => {
      const r = button.getBoundingClientRect();
      return {
        name: (button.textContent ?? '').replace(/\s+/g, ' ').trim(),
        box: {
          left: r.left,
          top: r.top,
          right: r.right,
          bottom: r.bottom,
          width: r.width,
          height: r.height,
        },
        inside: r.left >= sheet.left - 0.5 && r.right <= sheet.right + 0.5,
      };
    });
  });

/** The inspector's delete-ready reviews and the confirmation each one ends with. */
const DELETE_READY = [
  {
    action: 'mark',
    trigger: 'Review delete-ready history',
    title: 'Mark selected history delete-ready?',
    confirm: 'Confirm delete-ready selection',
  },
  {
    action: 'withdraw',
    trigger: 'Withdraw delete-ready mark',
    title: 'Withdraw deletion approval?',
    confirm: 'Confirm withdrawal',
  },
] as const;

test('the delete-ready reviews keep Cancel and the confirmation inside the dialog, reachable by real clicks, at 320 px with 200% text (#563)', async ({
  page,
  request,
}, info) => {
  // An instance of its own: a confirmation marks real history delete-ready, which the shared
  // gateway's other specs must never see.
  const url = String((await control(request, '/apps'))['url']);
  const loopId = await publishLoop(
    request,
    { ...minimalLoop(), name: uniqueLoopName('Reflow delete-ready') },
    url,
  );
  const runId = await finishedRun(request, '', loopId, url);
  const approved = async () =>
    Boolean(
      ((await (await request.get(`${url}/runs/${runId}`)).json()) as { deletionApproval?: unknown })
        .deletionApproval,
    );
  const visit = async (layout: Layout) => {
    await page.setViewportSize({ width: layout.width, height: 900 });
    await page.goto(`${url}/app/runs/${runId}`);
    await expect(page.getByRole('heading', { name: `Run ${runId}` })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /^Timeline \(\d+ events, complete\)$/ }),
    ).toBeVisible();
    return setText(page, layout.text, undefined);
  };
  const review = async (choice: (typeof DELETE_READY)[number]) => {
    await page.getByRole('button', { name: choice.trigger, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: choice.title });
    await expect(dialog).toBeVisible();
    // The preview has arrived: the confirmation can act.
    await expect(dialog.getByRole('button', { name: choice.confirm, exact: true })).toBeEnabled();
    await settle(page);
    return dialog;
  };

  const cells: Record<string, { layout: Layout; metrics: Metrics }> = {};
  const footers: Record<string, Awaited<ReturnType<typeof footerActions>>> = {};
  for (const layout of CONTROL_LAYOUTS) {
    const tag = await visit(layout);
    for (const choice of DELETE_READY) {
      const dialog = await review(choice);
      const name = `${choice.action}-${layoutName(layout)}`;
      const metrics = await collect(page, 'dialog[open]');
      const actions = await footerActions(page);
      footers[name] = actions;
      // The footer's actions join the boxes held to the baseline where the layout is unchanged.
      const boxes = Object.fromEntries(
        actions.map((action) => [`footer:${action.name}`, action.box]),
      );
      cells[name] = { layout, metrics: { ...metrics, boxes: { ...metrics.boxes, ...boxes } } };
      await page.screenshot({ path: info.outputPath(`delete-ready-${name}.png`) });
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    }
    await tag?.evaluate((element) => (element as Element).remove());
  }
  await info.attach('delete-ready footers', {
    body: JSON.stringify(footers, null, 2),
    contentType: 'application/json',
  });
  await compareWithBaseline(info, cells);
  for (const choice of DELETE_READY) {
    for (const layout of CONTROL_LAYOUTS) {
      const name = `${choice.action}-${layoutName(layout)}`;
      expectContained(cells[name]!.metrics, name);
      const actions = footers[name]!;
      expect
        .soft(
          actions.map((action) => action.name),
          `${name}: footer actions`,
        )
        .toEqual(['Cancel', choice.confirm]);
      for (const action of actions)
        expect.soft(action.inside, `${name}: ${action.name} inside the dialog`).toBe(true);
    }
  }

  // Real clicks reach both actions at 320 px with 200% text: Cancel writes nothing, and the
  // confirmation applies the review.
  await visit({ width: 320, text: 200, intended: 'reflow' });
  for (const choice of DELETE_READY) {
    let dialog = await review(choice);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click({ timeout: 10_000 });
    await expect(dialog).toBeHidden();
    expect(await approved(), `${choice.action}: Cancel changes nothing`).toBe(
      choice.action === 'withdraw',
    );
    dialog = await review(choice);
    await dialog
      .getByRole('button', { name: choice.confirm, exact: true })
      .click({ timeout: 10_000 });
    await expect(dialog).toBeHidden();
    await expect
      .poll(approved, { message: `${choice.action}: ${choice.confirm} applies` })
      .toBe(choice.action === 'mark');
  }
});

/** The longest node ID a definition can hold (64 characters), with no break opportunity in it. */
const LONGEST_NODE_ID = `worker${'W'.repeat(58)}`;

/**
 * A run failed at `LONGEST_NODE_ID` because its inherited provider session is missing, as the
 * real API records it (the fake harness answers the second turn with HARNESS_SESSION_MISSING).
 */
async function missingSessionRun(request: APIRequestContext) {
  expect(LONGEST_NODE_ID).toHaveLength(64);
  const base = minimalLoop();
  const loopId = await publishLoop(request, {
    ...base,
    name: uniqueLoopName('Reflow missing session'),
    nodes: [
      base.nodes[0]!,
      { id: 'warm', kind: 'inference', label: 'Warm', config: { prompt: { template: 'Warm' } } },
      {
        id: LONGEST_NODE_ID,
        kind: 'inference',
        label: 'Worker',
        config: {
          session: { policy: 'resume-previous' },
          model: 'gpt-6-luna',
          effort: 'low',
          prompt: { template: 'Original task' },
        },
      },
      base.nodes[1]!,
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'warm' } },
      { id: 'e2', from: { node: 'warm', port: 'out' }, to: { node: LONGEST_NODE_ID } },
      { id: 'e3', from: { node: LONGEST_NODE_ID, port: 'out' }, to: { node: 'done' } },
    ],
  });
  await control(request, '/harness/script', {
    turns: [
      {},
      {
        announceSession: false,
        accepted: false,
        items: [],
        submission: 'session-missing',
        error: { code: 'HARNESS_SESSION_MISSING', message: 'Session removed from provider store' },
      },
    ],
  });
  const started = await request.post(`/loops/${loopId}/runs`, { data: {} });
  expect(started.status()).toBe(202);
  const { run } = (await started.json()) as { run: { id: string } };
  await expect.poll(async () => (await runStatus(request, run.id)).status).toBe('failed');
  return run.id;
}

test('Start fresh session wraps a 64-character node ID inside its label at 320 px with 200% text (#563)', async ({
  page,
  request,
}, info) => {
  const runId = await missingSessionRun(request);
  const layout: Layout = { width: 320, text: 200, intended: 'reflow' };
  await page.setViewportSize({ width: layout.width, height: 900 });
  await page.goto(`/app/runs/${runId}`);
  await expect(page.getByRole('heading', { name: `Run ${runId}` })).toBeVisible();
  await expect(page.getByText('Failed: HARNESS_SESSION_MISSING')).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Timeline \(\d+ events, / })).toBeVisible();
  // The accessible name is the whole label, node ID included.
  const choose = page.getByRole('button', {
    name: `Start fresh session for ${LONGEST_NODE_ID}`,
    exact: true,
  });
  await expect(choose).toBeEnabled();
  await setText(page, layout.text, undefined);
  const name = layoutName(layout);
  const metrics = await collect(page);
  const label = await choose.evaluate((button) => {
    const text = button.querySelector(':scope > span');
    const own = button.getBoundingClientRect();
    const container = button.parentElement!.getBoundingClientRect();
    return {
      text: text?.textContent,
      scrollWidth: text?.scrollWidth,
      clientWidth: text?.clientWidth,
      button: { left: own.left, right: own.right, height: own.height },
      container: { left: container.left, right: container.right },
      inside: own.left >= container.left - 0.5 && own.right <= container.right + 0.5,
    };
  });
  await info.attach('fresh session label', {
    body: JSON.stringify(label, null, 2),
    contentType: 'application/json',
  });
  await choose.screenshot({ path: info.outputPath(`missing-session-${name}-button.png`) });
  await capture(page, info, `missing-session-${name}`);
  await compareWithBaseline(info, { [`missing-session-${name}`]: { layout, metrics } });
  expect(label.text).toBe(`Start fresh session for ${LONGEST_NODE_ID}`);
  expect
    .soft(label.scrollWidth, `${name}: label scrollWidth`)
    .toBeLessThanOrEqual(label.clientWidth!);
  expect.soft(label.inside, `${name}: button inside its container`).toBe(true);
  expectContained(metrics, `missing session ${name}`);
  expect.soft(await sideways(page), `${name}: scrollTo(999, 0)`).toBe(0);
  // Nothing covers it: a real pointer would reach it (a trial click sends nothing).
  await choose.click({ trial: true, timeout: 10_000 });
});

/**
 * The shared header on every route that shows it. From 640 px with 200% text it reflows as well:
 * on the build before #563 its links reached 1068 px at 640 and 768 px on every route.
 */
const ROUTE_LAYOUTS: Layout[] = [
  { width: 1440, text: 100, intended: 'unchanged' },
  { width: 1440, text: 200, intended: 'unchanged' },
  { width: 320, text: 100, intended: 'unchanged' },
  { width: 320, text: 200, intended: 'reflow' },
  { width: 639, text: 200, intended: 'reflow' },
  { width: 640, text: 200, intended: 'reflow' },
  { width: 768, text: 200, intended: 'reflow' },
];

const ROUTES: {
  name: string;
  path: (ids: { loopId: string; loopName: string; runId: string }) => string;
  ready: (page: Page, ids: { loopId: string; loopName: string; runId: string }) => Promise<void>;
}[] = [
  {
    name: 'chat',
    path: () => '/app/chat',
    ready: (page) => expect(page.getByRole('link', { name: 'Devices' })).toBeVisible(),
  },
  {
    name: 'loops',
    path: () => '/app/loops',
    ready: (page) =>
      expect(page.getByRole('heading', { name: 'Loops', exact: true })).toBeVisible(),
  },
  {
    name: 'editor',
    path: ({ loopId }) => `/app/loops/${loopId}/edit`,
    ready: async (page, { loopName }) => {
      await expect(page.getByRole('heading', { name: loopName, exact: true })).toBeVisible();
      await expect(
        page.getByText(
          'The editor is available. Checking the server and this device before saving changes.',
          { exact: true },
        ),
      ).toBeHidden();
    },
  },
  {
    name: 'runs',
    path: () => '/app/runs',
    ready: (page) => expect(page.getByRole('heading', { name: 'Runs', exact: true })).toBeVisible(),
  },
  {
    name: 'events',
    path: () => '/app/events',
    ready: (page) => expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible(),
  },
  {
    name: 'settings',
    path: () => '/app/settings',
    ready: (page) =>
      expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible(),
  },
  {
    name: 'inspector',
    path: ({ runId }) => `/app/runs/${runId}`,
    ready: (page, { runId }) =>
      expect(page.getByRole('heading', { name: `Run ${runId}` })).toBeVisible(),
  },
];

for (const route of ROUTES) {
  test(`the shared header on ${route.name} keeps unaffected layouts and reflows below 640 px (#563)`, async ({
    page,
    request,
  }, info) => {
    const loopName = uniqueLoopName('Reflow route');
    const loopId = await publishLoop(request, { ...minimalLoop(), name: loopName });
    const runId = route.name === 'inspector' ? await finishedRun(request, '', loopId) : '';
    const ids = { loopId, loopName, runId };
    const cells: Record<string, { layout: Layout; metrics: Metrics }> = {};
    const notes: Record<string, unknown> = {};
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(route.path(ids));
    await route.ready(page, ids);
    let tag: ElementHandle | undefined;
    for (const layout of ROUTE_LAYOUTS) {
      await page.setViewportSize({ width: layout.width, height: 900 });
      tag = await setText(page, layout.text, tag);
      await route.ready(page, ids);
      await settle(page);
      const name = layoutName(layout);
      const metrics = await collect(page, 'header.hairline-accent');
      const whole = await collect(page);
      const history = Object.fromEntries(
        Object.entries(whole.boxes).filter(([key]) => key.startsWith('history:')),
      );
      // The inspector's history controls sit below its run header, which reflows at 1440 px with
      // 200% text (see MATRIX), so they move with it: that cell is recorded, not held unchanged.
      // The same shared header stays held unchanged there on every other route.
      const below =
        route.name === 'inspector' && layout.width === 1440 && layout.text === 200
          ? { ...layout, intended: 'reflow' as const }
          : layout;
      cells[name] = {
        layout: below,
        metrics: { ...metrics, boxes: { ...metrics.boxes, ...history } },
      };
      notes[name] = {
        documentWidth: whole.scroll.document,
        documentHeight: whole.scroll.height,
        viewportHeight: whole.viewport.height,
        header: metrics.boxes['header'],
      };
      await page.locator('header.hairline-accent').screenshot({
        path: info.outputPath(`${route.name}-${name}-header.png`),
      });
      if (layout.width < 640) {
        notes[`${name}-menu`] = await checkMenu(page, info, `${route.name}-${name}`);
      }
    }
    await info.attach('route notes', {
      body: JSON.stringify(notes, null, 2),
      contentType: 'application/json',
    });
    await compareWithBaseline(info, cells);
    for (const [name, { metrics }] of Object.entries(cells)) {
      expect.soft(metrics.overflow, `${route.name} ${name}: header text`).toEqual([]);
      expect.soft(metrics.uncontained, `${route.name} ${name}: header control text`).toEqual([]);
      const header = metrics.boxes['header']!;
      expect
        .soft(header.right, `${route.name} ${name}: header width`)
        .toBeLessThanOrEqual(metrics.viewport.width + 0.5);
    }
  });
}
