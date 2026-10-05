/**
 * #18 against the built app and an isolated in-memory API on an ephemeral port (global-setup).
 * Windows uses Edge; set GG_E2E_BROWSER_CHANNEL=msedge explicitly on other installed runners.
 * GG_ROUTING_SCREENSHOTS=1 writes the owner-review images into docs/qa; normal CI keeps
 * them in test-results. Performance runs three real pointer drags of five seconds each.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { APIRequestContext, Page, TestInfo } from '@playwright/test';
import type { LoopDefinitionInput } from '@graphgoblin/contracts';
import {
  decisionBackRoute,
  denseGraph,
  forwardLoopBack,
  nestedLoops,
  simpleLoop,
  sixReturnDecision,
  tightGap,
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
    'six-return-decision': sixReturnDecision,
    'eight-pixel-gap': tightGap,
    'forward-loop-back-detour': forwardLoopBack,
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
      const collisions = await backwards
        .locator('.react-flow__edge-textbg')
        .evaluateAll((elements) => {
          const labels = elements.map((el) => el.getBoundingClientRect());
          const cards = [...document.querySelectorAll('.react-flow__node')].map((el) =>
            el.getBoundingClientRect(),
          );
          let hits = 0;
          for (const [i, a] of labels.entries())
            for (const b of [...labels.slice(0, i), ...cards])
              if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top)
                hits += 1;
          return hits;
        });
      expect(collisions).toBe(0);
      if (name === 'six-return-decision') await expect(backwards).toHaveCount(6);
      if (name === 'eight-pixel-gap') {
        const source = (await page.getByTestId('node-done').boundingBox())!;
        const neighbour = (await page.getByTestId('node-check').boundingBox())!;
        const scale = source.width / 184;
        expect((neighbour.x - source.x - source.width) / scale).toBeCloseTo(8, 1);
        const pill = (await edge(page, 'return')
          .locator('.react-flow__edge-textbg')
          .boundingBox())!;
        expect(pill.y > source.y + source.height || pill.y + pill.height < source.y).toBe(true);
      }
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
    pill: getComputedStyle(el.querySelector('.react-flow__edge-textbg')!).fill,
  }));
  expect(ratio(before, colors.canvas)).toBeGreaterThanOrEqual(3);
  expect(ratio(after, colors.canvas)).toBeGreaterThanOrEqual(3);
  expect(ratio(colors.text, colors.pill)).toBeGreaterThanOrEqual(4.5);
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
  await expect(blocked).toHaveAttribute('aria-label', /Port covered by a card/);
  await expect(blocked.locator('.react-flow__edge-path')).toHaveAttribute('d', '');
  await expect(blocked.locator('.react-flow__edge-text')).toBeVisible();
  // toBeVisible ignores occlusion, and cards paint over edges: the warning pill must clear every
  // card's box, and the topmost element at its centre must be the pill itself.
  const pill = (await blocked.locator('.react-flow__edge-textbg').boundingBox())!;
  for (const card of await page.locator('.react-flow__node').all()) {
    const box = (await card.boundingBox())!;
    expect(
      pill.x < box.x + box.width &&
        pill.x + pill.width > box.x &&
        pill.y < box.y + box.height &&
        pill.y + pill.height > box.y,
      JSON.stringify({ pill, box }),
    ).toBe(false);
  }
  expect(
    await page.evaluate(
      ({ x, y }) =>
        !!document.elementFromPoint(x, y)?.closest('.react-flow__edge[data-id="return"]'),
      { x: pill.x + pill.width / 2, y: pill.y + pill.height / 2 },
    ),
  ).toBe(true);
  await blocked.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Delete');
  await expect(blocked).toHaveCount(0);
});

/** Observe both painted frames and intermediate DOM states, not just the eventual path. */
function watchReturnPath(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ frames: number; missingFrames: number; missingStates: number }>(
        (resolveSample) => {
          const selector = '.react-flow__edge[data-id="return"] .react-flow__edge-path';
          const original = document.querySelector(selector)!;
          let frames = 0;
          let missingFrames = 0;
          let missingStates = 0;
          let active = true;
          const missing = () => !document.querySelector(selector)?.getAttribute('d');
          const observer = new MutationObserver((records) => {
            if (
              missing() ||
              records.some(
                (r) =>
                  (r.target === original && r.type === 'attributes' && r.oldValue === '') ||
                  [...r.removedNodes].some((n) => n === original || n.contains(original)),
              )
            )
              missingStates += 1;
          });
          observer.observe(document.querySelector('.react-flow')!, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['d'],
            attributeOldValue: true,
          });
          const sample = () => {
            frames += 1;
            if (missing()) missingFrames += 1;
            if (active) requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
          document.addEventListener(
            'routing-sample-stop',
            () => {
              active = false;
              observer.disconnect();
              resolveSample({ frames, missingFrames, missingStates });
            },
            { once: true },
          );
        },
      ),
  );
}

test('no missing path frames while dragging past a neighbour through 8 px gaps', async ({
  page,
  request,
}) => {
  const definition = simpleLoop();
  definition.nodes.find((n) => n.id === 'done')!.ui = { x: 400, y: 100 };
  definition.nodes.find((n) => n.id === 'check')!.ui = { x: 700, y: 100 };
  definition.nodes.find((n) => n.id === 'work')!.ui = { x: 100, y: 100 };
  definition.nodes.find((n) => n.id === 'start')!.ui = { x: -200, y: 100 };
  await openGraph(page, request, definition);
  const card = (await page.getByTestId('node-done').boundingBox())!;
  const neighbour = (await page.getByTestId('node-check').boundingBox())!;
  const scale = card.width / 184;
  const origin = { x: card.x + 20 * scale, y: card.y + 14 * scale };
  const left = neighbour.x - card.width - 8 * scale + 20 * scale;
  const right = neighbour.x + neighbour.width + 8 * scale + 20 * scale;
  const above = neighbour.y - card.height - 8 * scale + 14 * scale;
  const watching = watchReturnPath(page);
  await page.mouse.move(origin.x, origin.y);
  await page.mouse.down();
  for (const [x, y] of [
    [left, origin.y],
    [left, above],
    [right, above],
    [right, origin.y],
  ])
    await page.mouse.move(x!, y!, { steps: 32 });
  await page.mouse.up();
  await page.evaluate(() => document.dispatchEvent(new Event('routing-sample-stop')));
  const sample = await watching;
  expect(sample.frames).toBeGreaterThan(30);
  expect(sample.missingFrames).toBe(0);
  expect(sample.missingStates).toBe(0);
  await expect(edge(page, 'return').locator('.react-flow__edge-path')).toHaveAttribute('d', /^M/);
});

test('adding a card and undoing its deletion never erase an existing backward path', async ({
  page,
  request,
}) => {
  await openGraph(page, request, simpleLoop());
  const watching = watchReturnPath(page);
  await page.getByRole('button', { name: 'Add Wait node', exact: true }).click();
  await page.getByTestId('node-wait').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete node', exact: true }).click();
  await expect(page.getByTestId('node-wait')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo delete wait', exact: true }).click();
  await expect(page.getByTestId('node-wait')).toBeVisible();
  await page.evaluate(
    () =>
      new Promise<void>((resolveFrame) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame())),
      ),
  );
  await page.evaluate(() => document.dispatchEvent(new Event('routing-sample-stop')));
  const sample = await watching;
  expect(sample.frames).toBeGreaterThan(10);
  expect(sample.missingFrames).toBe(0);
  expect(sample.missingStates).toBe(0);
});

interface Samples {
  frames: number[];
  routing: number[];
  duration: number;
  rerouted: number[];
}
const p95 = (samples: number[]) =>
  [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * 0.95) - 1]!;

for (const count of [100, 300])
  test(`performance: ${count} nodes / ${count * 2} edges, three five-second pointer drags`, async ({
    page,
    request,
    browser,
  }, info) => {
    test.setTimeout(90_000);
    const definition = denseGraph(count);
    expect(definition.nodes).toHaveLength(count);
    expect(definition.edges).toHaveLength(count * 2);
    await openGraph(page, request, definition);
    await expect(page.locator('.react-flow__edge')).toHaveCount(count * 2);
    // The viewport contains this middle card even at xyflow's minimum fit zoom.
    const card = page.locator(`.react-flow__node[data-id="n${Math.floor(count / 20) * 10 - 6}"]`);
    await expect(card).toBeVisible();
    await page.waitForTimeout(1000); // Let font measurement, initial validation and fit-view settle.
    // Same rendered graph without pointer input: report a scheduling baseline alongside the drag.
    // The gate compares drag p95 against this measured idle p95, not a nominal refresh rate.
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
    const profile =
      process.env['GG_ROUTING_PROFILE'] === '1'
        ? await page.context().newCDPSession(page)
        : undefined;
    if (profile) {
      await profile.send('Profiler.enable');
      await profile.send('Profiler.start');
    }
    const repetitions = [];
    for (let repetition = 0; repetition < 3; repetition += 1) {
      const rect = (await card.boundingBox())!;
      const origin = { x: rect.x + 24, y: rect.y + 12 };
      await page.mouse.move(origin.x, origin.y);
      await page.mouse.down();
      await page.mouse.move(origin.x + 5, origin.y);
      const measuring = page.evaluate(
        (count) =>
          new Promise<Samples>((resolveSamples) => {
            const frames: number[] = [];
            const routing: number[] = [];
            const rerouted: number[] = [];
            const observer = new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) {
                const measure = entry as PerformanceMeasure;
                if (
                  measure.name === 'gg:backward-routing' &&
                  measure.detail.nodes === count &&
                  measure.detail.edges === count * 2
                ) {
                  routing.push(measure.duration);
                  rerouted.push(measure.detail.rerouted);
                }
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
                resolveSamples({ frames, routing, rerouted, duration: now - start });
              }
            };
            requestAnimationFrame(frame);
          }),
        count,
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
        `${count} nodes, drag ${repetition + 1}: routing ${p95(samples.routing).toFixed(3)} ms / frame ${p95(samples.frames).toFixed(3)} ms p95; ${samples.routing.length} routes, ${samples.frames.length} frames`,
      );
      repetitions.push({
        repetition: repetition + 1,
        routingP95Ms: p95(samples.routing),
        frameP95Ms: p95(samples.frames),
        addedFrameP95Ms: p95(samples.frames) - p95(idleFrames),
        reroutedEdgesP95: p95(samples.rerouted),
        routingSamples: samples.routing.length,
        frameSamples: samples.frames.length,
        durationMs: samples.duration,
      });
    }
    if (profile) {
      const result = await profile.send('Profiler.stop');
      await writeFile(info.outputPath('drag.cpuprofile'), JSON.stringify(result.profile));
      await profile.detach();
    }
    // A single drag can spike on the shared two-core runner. Keep the same 8 ms bound
    // everywhere, applying it to the median of the three independently reported drag p95s.
    const medianRoutingP95Ms = [...repetitions].sort((a, b) => a.routingP95Ms - b.routingP95Ms)[1]!
      .routingP95Ms;
    const report = {
      nodes: count,
      edges: count * 2,
      repeat: info.repeatEachIndex + 1,
      channel:
        process.env['GG_E2E_BROWSER_CHANNEL'] ??
        (process.platform === 'win32' ? 'msedge' : 'chromium'),
      browser: browser.version(),
      userAgent: await page.evaluate(() => navigator.userAgent),
      viewport: page.viewportSize(),
      targets: { medianRoutingP95Ms: 8, perDragRoutingP95Ms: 16, addedFrameP95Ms: 4 },
      medianRoutingP95Ms,
      idle: { frameP95Ms: p95(idleFrames), frameSamples: idleFrames.length },
      repetitions,
    };
    console.log(`Routing performance: ${JSON.stringify(report)}`);
    const json = JSON.stringify(report, null, 2);
    await info.attach('routing-performance', { body: json, contentType: 'application/json' });
    const reportDirectory =
      process.env['GG_ROUTING_REPORT_DIR'] ??
      (process.env['GG_ROUTING_SCREENSHOTS'] === '1'
        ? qaDirectory
        : info.outputPath('measurements'));
    await mkdir(reportDirectory, { recursive: true });
    await writeFile(
      resolve(
        reportDirectory,
        `performance-review-${count}-repeat-${info.repeatEachIndex + 1}.json`,
      ),
      json + '\n',
    );
    // The median routing bound (<8 ms for the entire cache miss) always applies. The added frame p95
    // (<4 ms over the same graph's idle baseline, meaningful at 60/100/120 Hz) is enforced only
    // under GG_ROUTING_STRICT_PERF, which the routing-perf workflow sets: on a developer machine
    // running other suites, frame time measures the machine, not the router, and is recorded
    // in the report for the hand-off instead.
    const strictPerf = process.env['GG_ROUTING_STRICT_PERF'] === '1';
    expect(medianRoutingP95Ms).toBeLessThan(8);
    for (const result of repetitions) {
      // A loose ceiling beside the median: no single drag may spike far past it.
      expect(result.routingP95Ms).toBeLessThan(16);
      expect(result.routingSamples).toBeGreaterThan(60);
      expect(result.frameSamples).toBeGreaterThan(120);
      expect(result.reroutedEdgesP95).toBeGreaterThan(0);
      if (strictPerf) expect(result.addedFrameP95Ms).toBeLessThan(4);
    }
  });
