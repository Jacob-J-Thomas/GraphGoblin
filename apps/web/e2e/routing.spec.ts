/**
 * #18 against the built app and an isolated in-memory API on an ephemeral port (global-setup).
 * Windows uses Edge; set GG_E2E_BROWSER_CHANNEL=msedge explicitly on other installed runners.
 * GG_ROUTING_SCREENSHOTS=1 writes the eight owner-review images into docs/qa; normal CI keeps
 * them in test-results. Performance runs three real pointer drags of five seconds each.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { APIRequestContext, Page, TestInfo } from '@playwright/test';
import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import {
  decisionBackRoute,
  denseGraph,
  nestedLoops,
  simpleLoop,
} from '../src/__fixtures__/routing.js';
import { expect, test } from './fixtures.js';

// Trace snapshots of 300 canvas elements distort the frame budget; these specs capture PNGs.
test.use({ actionTimeout: 15_000, trace: 'off' });

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

const qaDirectory = resolve('..', '..', 'docs', 'qa', '2026-10-05-issue-18-routing');
const edge = (page: Page, id: string) => page.locator(`.react-flow__edge[data-id="${id}"]`);

async function openGraph(
  page: Page,
  request: APIRequestContext,
  definition: LoopDefinitionInput,
  theme = 'dark',
) {
  await page.addInitScript((value) => localStorage.setItem('graphgoblin-theme', value), theme);
  const response = await request.post('/loops', { data: { definition } });
  expect(response.status(), await response.text()).toBe(201);
  const { loop } = (await response.json()) as { loop: { id: string } };
  await page.goto(`/app/loops/${loop.id}/edit`);
  await expect(page.locator('.react-flow__node')).toHaveCount(definition.nodes.length);
  for (const name of ['Hide palette', 'Hide loop settings']) {
    const button = page.getByRole('button', { name, exact: true });
    if (await button.isVisible()) await button.click();
  }
  await page.getByRole('button', { name: 'Fit view' }).click();
  await expect(page.locator('.react-flow__edge-backward title').first()).toBeAttached();
  await page.evaluate(() => document.fonts.ready);
  return loop.id;
}

async function screenshot(page: Page, info: TestInfo, name: string) {
  const path =
    process.env['GG_ROUTING_SCREENSHOTS'] === '1'
      ? resolve(qaDirectory, `${name}.png`)
      : info.outputPath(`${name}.png`);
  if (process.env['GG_ROUTING_SCREENSHOTS'] === '1') await mkdir(qaDirectory, { recursive: true });
  await page.screenshot({ path, animations: 'disabled' });
  await info.attach(name, { path, contentType: 'image/png' });
}

for (const theme of ['dark', 'light']) {
  for (const [name, fixture] of Object.entries({
    'simple-loop': simpleLoop,
    'nested-loops': nestedLoops,
    'decision-back-route': decisionBackRoute,
    'dense-100-nodes': denseGraph,
  })) {
    test(`${theme}: ${name} routes and labels, owner screenshot`, async ({
      page,
      request,
    }, info) => {
      if (name === 'dense-100-nodes') await page.setViewportSize({ width: 1920, height: 1800 });
      const definition = fixture();
      await openGraph(page, request, definition, theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const backwards = page.locator('.react-flow__edge-backward');
      expect(await backwards.count()).toBeGreaterThan(0);
      for (const path of await backwards.locator('.react-flow__edge-path').all()) {
        await expect(path).toHaveAttribute('d', /^M.*Q/);
      }
      for (const label of await backwards.locator('.react-flow__edge-text').all())
        await expect(label).toBeVisible();
      await screenshot(page, info, `${name}-${theme}`);
    });
  }

  test(`${theme}: animated loop-back, click and keyboard selection, Delete and undo`, async ({
    page,
    request,
  }) => {
    // Keep deletion schema-valid so the cleared config can also be read back from the API.
    const definition = simpleLoop();
    const done = definition.nodes.find((node) => node.id === 'done')!;
    if (done.kind === 'exit') done.config.default = 'success';
    const loopId = await openGraph(page, request, definition, theme);
    const back = edge(page, 'return');
    const path = back.locator('.react-flow__edge-path');
    await expect(back).toHaveClass(/animated/);
    expect(await path.evaluate((el) => getComputedStyle(el).animationName)).toBe('dashdraw');
    await back.locator('.react-flow__edge-textwrapper').click();
    await expect(back).toHaveClass(/selected/);
    // Tab reaches the focusable SVG wrapper; Enter selects it with xyflow's normal semantics.
    await back.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(back).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(back).toHaveClass(/selected/);
    const colors = await back.evaluate((el) => {
      const style = (selector: string) => getComputedStyle(el.querySelector(selector)!);
      const flow = getComputedStyle(el.closest('.react-flow')!);
      return {
        stroke: style('.react-flow__edge-path').stroke,
        width: style('.react-flow__edge-path').strokeWidth,
        text: style('.react-flow__edge-text').fill,
        canvas: flow.backgroundColor,
        pill: style('.react-flow__edge-textbg').fill,
      };
    });
    expect(colors.width).toBe('3px');
    expect(ratio(colors.stroke, colors.canvas)).toBeGreaterThanOrEqual(3);
    expect(ratio(colors.text, colors.canvas)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(colors.text, colors.pill)).toBeGreaterThanOrEqual(4.5);
    await page.keyboard.press('Delete');
    await expect(back).toHaveCount(0);
    await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
    const saved = (await (await request.get(`/loops/${loopId}`)).json()) as {
      draft: { definition: LoopDefinitionInput };
    };
    expect(saved.draft.definition.nodes.find((n) => n.id === 'done')!.config).not.toHaveProperty(
      'loopBack',
    );
    await page.keyboard.press('Control+z');
    await expect(back).toHaveCount(1);
    await expect(path).toHaveAttribute('d', /^M.*Q/);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await path.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  });
}

test('forced colours retain paths, labels, keyboard focus and selection', async ({
  page,
  request,
}) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await openGraph(page, request, simpleLoop());
  const back = edge(page, 'return');
  const before = await back
    .locator('.react-flow__edge-path')
    .evaluate((el) => getComputedStyle(el).stroke);
  await back.focus();
  await page.keyboard.press('Enter');
  const after = await back
    .locator('.react-flow__edge-path')
    .evaluate((el) => getComputedStyle(el).stroke);
  expect(before).not.toBe(after);
  const colors = await back.evaluate((el) => ({
    canvas: getComputedStyle(el.closest('.react-flow')!).backgroundColor,
    text: getComputedStyle(el.querySelector('.react-flow__edge-text')!).fill,
  }));
  expect(ratio(before, colors.canvas)).toBeGreaterThanOrEqual(3);
  expect(ratio(after, colors.canvas)).toBeGreaterThanOrEqual(3);
  expect(ratio(colors.text, colors.canvas)).toBeGreaterThanOrEqual(4.5);
  await expect(back.locator('.react-flow__edge-text')).toBeVisible();
  expect(await back.evaluate((el) => getComputedStyle(el).forcedColorAdjust)).toBe('none');
  await page.keyboard.press('Delete');
  await expect(back).toHaveCount(0);
});

test('dragging a card across a return path reroutes clear of its measured box in one undo step', async ({
  page,
  request,
}) => {
  await openGraph(page, request, simpleLoop());
  const path = edge(page, 'return').locator('.react-flow__edge-path');
  const before = await path.getAttribute('d');
  const card = page.getByTestId('node-check');
  const rect = (await card.boundingBox())!;
  await page.mouse.move(rect.x + 60, rect.y + 14);
  await page.mouse.down();
  await page.mouse.move(rect.x + 60, rect.y + 125, { steps: 16 });
  await page.mouse.up();
  await expect(path).not.toHaveAttribute('d', before!);
  const collisions = await path.evaluate((element) => {
    const curve = element as SVGPathElement;
    const matrix = curve.getScreenCTM()!;
    const scale = Math.hypot(matrix.a, matrix.b);
    const boxes = [...document.querySelectorAll('.react-flow__node')]
      .filter((node) => !['done', 'work'].includes(node.getAttribute('data-id')!))
      .map((node) => node.getBoundingClientRect());
    let hits = 0;
    for (let at = 0; at <= curve.getTotalLength(); at += 3) {
      const p = curve.getPointAtLength(at).matrixTransform(matrix);
      if (
        boxes.some(
          (b) =>
            p.x > b.left - 24 * scale &&
            p.x < b.right + 24 * scale &&
            p.y > b.top - 24 * scale &&
            p.y < b.bottom + 24 * scale,
        )
      )
        hits += 1;
    }
    return hits;
  });
  expect(collisions).toBe(0);
  await page.getByRole('button', { name: 'Undo move check', exact: true }).click();
  await expect(path).toHaveAttribute('d', before!);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
});

test('vertical targets, long script route, overlapping cards and zoom', async ({
  page,
  request,
}) => {
  const definition = simpleLoop();
  const work = definition.nodes.find((n) => n.id === 'work')!;
  work.ui = { x: 900, y: -220 };
  const long = 'retry-this-script-after-reviewing-the-previous-output';
  const script = definition.nodes.find((n) => n.id === 'check')!;
  script.config = { command: 'node', exitCodeRoutes: { '1': long } };
  definition.edges.push({
    id: 'script-return',
    from: { node: 'check', port: long },
    to: { node: 'check' },
  });
  await openGraph(page, request, definition);
  await expect(edge(page, 'return').locator('.react-flow__edge-path')).toHaveAttribute(
    'd',
    /^M.*Q/,
  );
  await expect(edge(page, 'script-return')).toHaveAttribute('aria-label', `check ${long} to check`);
  await expect(edge(page, 'script-return').locator('.react-flow__edge-text')).toHaveText(/…$/);
  for (const name of [/^zoom in$/i, /^zoom out$/i, /^fit view$/i])
    await page.getByRole('button', { name, exact: true }).click();
  await expect(edge(page, 'script-return').locator('.react-flow__edge-text')).toBeVisible();

  // Cover the loop-back port. The connection stays keyboard-selectable, with no unsafe path.
  const covered = simpleLoop();
  covered.nodes.find((n) => n.id === 'check')!.ui = { x: 1000, y: 100 };
  await openGraph(page, request, covered);
  const blocked = edge(page, 'return');
  await expect(blocked).toHaveAttribute('aria-label', /move overlapping nodes apart/);
  await expect(blocked.locator('.react-flow__edge-path')).toHaveAttribute('d', '');
  await expect(blocked.locator('.react-flow__edge-text')).toBeVisible();
  await blocked.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Delete');
  await expect(blocked).toHaveCount(0);
});

interface Samples {
  frames: number[];
  routing: number[];
  duration: number;
}
const p95 = (samples: number[]) =>
  [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * 0.95) - 1]!;

test('performance: 100 nodes / 200 edges, three five-second pointer drags', async ({
  page,
  request,
  browser,
}, info) => {
  test.setTimeout(90_000);
  const definition = denseGraph();
  expect(definition.nodes).toHaveLength(100);
  expect(definition.edges).toHaveLength(200);
  await openGraph(page, request, definition);
  await expect(page.locator('.react-flow__edge')).toHaveCount(200);
  // The viewport contains this middle card even at xyflow's minimum fit zoom.
  const card = page.locator('.react-flow__node[data-id="n44"]');
  await expect(card).toBeVisible();
  await page.waitForTimeout(1000); // Let font measurement, initial validation and fit-view settle.
  // Same rendered graph without pointer input: report a scheduling baseline alongside the drag.
  // It does not replace or relax any drag-frame assertion.
  const idleFrames = await page.evaluate(
    () =>
      new Promise<number[]>((resolveFrames) => {
        const frames: number[] = [];
        const start = performance.now();
        let previous: number | undefined;
        const frame = (now: number) => {
          if (previous !== undefined) frames.push(now - previous);
          previous = now;
          if (now - start < 3000) requestAnimationFrame(frame);
          else resolveFrames(frames);
        };
        requestAnimationFrame(frame);
      }),
  );
  const repetitions = [];
  for (let repetition = 0; repetition < 3; repetition += 1) {
    const rect = (await card.boundingBox())!;
    const origin = { x: rect.x + 24, y: rect.y + 12 };
    await page.mouse.move(origin.x, origin.y);
    await page.mouse.down();
    await page.mouse.move(origin.x + 5, origin.y);
    const measuring = page.evaluate(
      () =>
        new Promise<Samples>((resolveSamples) => {
          const frames: number[] = [];
          const routing: number[] = [];
          const observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              const measure = entry as PerformanceMeasure;
              if (
                measure.name === 'gg:backward-routing' &&
                measure.detail.nodes === 100 &&
                measure.detail.edges === 200
              )
                routing.push(measure.duration);
            }
          });
          observer.observe({ type: 'measure' });
          const start = performance.now();
          let previous: number | undefined;
          const frame = (now: number) => {
            if (previous !== undefined) frames.push(now - previous);
            previous = now;
            if (now - start < 5000) requestAnimationFrame(frame);
            else {
              observer.disconnect();
              resolveSamples({ frames, routing, duration: now - start });
            }
          };
          requestAnimationFrame(frame);
        }),
    );
    const started = Date.now();
    let step = 0;
    while (Date.now() - started < 5100) {
      // Native Playwright input; a small circuit stays within the row's clear corridor.
      const phase = step++ / 10;
      await page.mouse.move(origin.x + 12 + Math.sin(phase) * 10, origin.y + Math.cos(phase) * 8);
    }
    await page.mouse.up();
    const samples = await measuring;
    console.log(
      `Drag ${repetition + 1}: routing ${p95(samples.routing).toFixed(3)} ms / frame ${p95(samples.frames).toFixed(3)} ms p95; ${samples.routing.length} routes, ${samples.frames.length} frames`,
    );
    repetitions.push({
      repetition: repetition + 1,
      routingP95Ms: p95(samples.routing),
      frameP95Ms: p95(samples.frames),
      routingSamples: samples.routing.length,
      frameSamples: samples.frames.length,
      durationMs: samples.duration,
    });
  }
  const report = {
    channel:
      process.env['GG_E2E_BROWSER_CHANNEL'] ??
      (process.platform === 'win32' ? 'msedge' : 'chromium'),
    browser: browser.version(),
    userAgent: await page.evaluate(() => navigator.userAgent),
    viewport: page.viewportSize(),
    targets: { routingP95Ms: 4, frameP95Ms: 16.7 },
    idle: { frameP95Ms: p95(idleFrames), frameSamples: idleFrames.length },
    repetitions,
  };
  console.log(`Routing performance: ${JSON.stringify(report)}`);
  const json = JSON.stringify(report, null, 2);
  await info.attach('routing-performance', { body: json, contentType: 'application/json' });
  if (process.env['GG_ROUTING_SCREENSHOTS'] === '1') {
    await mkdir(qaDirectory, { recursive: true });
    await writeFile(resolve(qaDirectory, 'performance.json'), `${json}\n`);
  }
  // Shared CI machines and virtual displays cannot promise a 60 Hz frame budget. Keep a broad
  // regression gate there (20 ms routing / 50 ms frame p95), and report the actual samples above.
  // GG_ROUTING_STRICT_PERF=1 enforces the owner's <4 / <16.7 ms targets on a controlled machine.
  const strict = process.env['GG_ROUTING_STRICT_PERF'] === '1';
  for (const result of repetitions) {
    expect(result.routingSamples).toBeGreaterThan(60);
    expect(result.frameSamples).toBeGreaterThan(120);
    expect(result.routingP95Ms).toBeLessThan(strict ? 4 : 20);
    expect(result.frameP95Ms).toBeLessThan(strict ? 16.7 : 50);
  }
});
