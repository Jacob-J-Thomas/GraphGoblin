// Real rendered geometry only. PREPARED / UNEXECUTED; no mocked bounding rectangles.
import { expect, test, type Page } from '@playwright/test';

export async function measureTimelineRow(page: Page, seq: number, eventType: string) {
  if (!Number.isSafeInteger(seq) || seq <= 0)
    throw new Error('Schema-valid positive safe sequence required');
  const row = page.locator(`[data-seq="${seq}"]`);
  await expect(row).toHaveCount(1);
  await row.scrollIntoViewIfNeeded();
  await expect(row).toBeVisible();
  const number = row.getByText(`#${seq}`, { exact: true });
  const type = row.getByText(eventType, { exact: true });
  await expect(number).toHaveCount(1);
  await expect(type).toHaveCount(1);
  await expect(number).toBeVisible();
  await expect(type).toBeVisible();
  const measure = async (part: typeof number) =>
    part.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const rects = [...range.getClientRects()]
        .filter((r) => r.width > 0 && r.height > 0)
        .map((r) => ({
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
          width: r.width,
          height: r.height,
        }));
      const clipping: string[] = [];
      for (let parent: Element | null = element; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        const box = parent.getBoundingClientRect();
        const left = box.left + parent.clientLeft;
        const top = box.top + parent.clientTop;
        if (
          /(hidden|clip|scroll|auto)/.test(style.overflowX) &&
          rects.some((r) => r.left < left - 1 || r.right > left + parent.clientWidth + 1)
        )
          clipping.push('horizontal');
        if (
          /(hidden|clip|scroll|auto)/.test(style.overflowY) &&
          rects.some((r) => r.top < top - 1 || r.bottom > top + parent.clientHeight + 1)
        )
          clipping.push('vertical');
      }
      return {
        text: element.textContent,
        rects,
        clipping,
        fontSize: parseFloat(getComputedStyle(element).fontSize),
      };
    });
  const numberMetrics = await measure(number);
  const typeMetrics = await measure(type);
  const overlaps = numberMetrics.rects
    .flatMap((a) =>
      typeMetrics.rects.map((b) => ({
        width: Math.min(a.right, b.right) - Math.max(a.left, b.left),
        height: Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top),
      })),
    )
    .filter((r) => r.width > 0.5 && r.height > 0.5);
  const viewport = await page.evaluate(() => {
    const raw = document.createRange();
    raw.selectNodeContents(document.body);
    const bounds = raw.getBoundingClientRect();
    const outside: {
      text: string;
      tag: string;
      id: string;
      classes: string;
      fontSize: string;
      left: number;
      right: number;
    }[] = [];
    let hiddenTextNodes = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const parent = node.parentElement;
      if (!parent || !node.textContent?.trim()) continue;
      if (
        parent.closest('script,style,[hidden],.sr-only') ||
        getComputedStyle(parent).visibility === 'hidden'
      ) {
        hiddenTextNodes++;
        continue;
      }
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        let left = rect.left;
        let right = rect.right;
        // Body-level ranges are measured before clipping. Qualify intentional contained
        // scrollers separately; the Timeline number/type clipping assertions remain strict.
        for (
          let ancestor: Element | null = parent;
          ancestor && ancestor !== document.body && ancestor !== document.documentElement;
          ancestor = ancestor.parentElement
        ) {
          if (/(hidden|clip|scroll|auto)/.test(getComputedStyle(ancestor).overflowX)) {
            const box = ancestor.getBoundingClientRect();
            left = Math.max(left, box.left + ancestor.clientLeft);
            right = Math.min(right, box.left + ancestor.clientLeft + ancestor.clientWidth);
          }
        }
        if (right > left && rect.height > 0 && (left < -1 || right > innerWidth + 1))
          outside.push({
            text: node.textContent.slice(0, 80),
            tag: parent.tagName,
            id: parent.id,
            classes: parent.className,
            fontSize: getComputedStyle(parent).fontSize,
            left,
            right,
          });
      }
    }
    return {
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
      rawBodyRange: { left: bounds.left, right: bounds.right, width: bounds.width },
      visibleTextOutsideViewport: outside,
      hiddenTextNodes,
      bodyRangeQualification:
        'Raw body range is before clipping and includes intentional sr-only/hidden text. Visible-node ranges exclude script/style/[hidden]/.sr-only/visibility:hidden and intersect contained horizontal overflow clips. Body/document scroll widths are asserted independently; Timeline number/type clipping is always asserted without that qualification. Vertical scrolling is allowed.',
    };
  });
  const measurement = {
    seq,
    eventType,
    number: numberMetrics,
    type: typeMetrics,
    viewport,
    overlaps,
  };
  const label = `geometry-${viewport.width}-${seq}-${Math.round(numberMetrics.fontSize)}`;
  await test
    .info()
    .attach(label, { body: JSON.stringify(measurement), contentType: 'application/json' });
  await test
    .info()
    .attach(label + '-render', { body: await page.screenshot(), contentType: 'image/png' });
  // Geometric failures still fail G1, but all12 admitted samples must be measured.
  // Setup/selector/schema checks above remain hard assertions.
  expect.soft(numberMetrics.rects.length).toBeGreaterThan(0);
  expect.soft(typeMetrics.rects.length).toBeGreaterThan(0);
  expect.soft(numberMetrics.clipping).toEqual([]);
  expect.soft(typeMetrics.clipping).toEqual([]);
  expect.soft(overlaps).toEqual([]);
  expect.soft(viewport.scrollWidth).toBeLessThanOrEqual(viewport.width + 1);
  expect.soft(viewport.bodyScrollWidth).toBeLessThanOrEqual(viewport.width + 1);
  expect.soft(viewport.visibleTextOutsideViewport).toEqual([]);
  return measurement;
}

/** Actual computed CSS enlargement of existing whole-page text. Not native zoom/device scale. */
export async function enlargeTimelineText(page: Page, factor: 2) {
  const changed = await page.locator('body').evaluateAll((rows, scale) => {
    const nodes = new Set<HTMLElement>();
    for (const row of rows) {
      if (row instanceof HTMLElement) nodes.add(row);
      for (const child of row.querySelectorAll('*'))
        if (child instanceof HTMLElement && !['SCRIPT', 'STYLE'].includes(child.tagName))
          nodes.add(child);
    }
    const baseline = [...nodes].map((element) => ({
      element,
      size: parseFloat(getComputedStyle(element).fontSize),
      inline: element.style.fontSize,
    }));
    for (const { element, size, inline } of baseline) {
      element.dataset['i5QaFontBefore'] = inline;
      element.dataset['i5QaFontComputedBefore'] = String(size);
      element.style.fontSize = `${size * scale}px`;
    }
    return baseline.length;
  }, factor);
  expect(changed).toBeGreaterThan(0);
  return async () => {
    await page.locator('[data-i5-qa-font-before]').evaluateAll((nodes) => {
      for (const node of nodes)
        if (node instanceof HTMLElement) {
          node.style.fontSize = node.dataset['i5QaFontBefore'] ?? '';
          delete node.dataset['i5QaFontBefore'];
          delete node.dataset['i5QaFontComputedBefore'];
        }
    });
  };
}

export function expectActualTextGrowth(
  normal: Awaited<ReturnType<typeof measureTimelineRow>>,
  enlarged: Awaited<ReturnType<typeof measureTimelineRow>>,
) {
  expect.soft(enlarged.number.fontSize).toBeGreaterThanOrEqual(normal.number.fontSize * 1.99);
  expect.soft(enlarged.type.fontSize).toBeGreaterThanOrEqual(normal.type.fontSize * 1.99);
  expect.soft(enlarged.seq).toBe(normal.seq);
  expect.soft(enlarged.eventType).toBe(normal.eventType);
}
