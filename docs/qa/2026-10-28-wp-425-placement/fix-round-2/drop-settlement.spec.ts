/** One-off public-measure diagnostic; the default editor suite is unchanged. */
import { denseGraph } from '../../../../apps/web/src/__fixtures__/routing.js';
import { expect, test } from '../../../../apps/web/e2e/fixtures.js';

test.use({ trace: 'off' });
test('300-card drop settles labels once', async ({ page, request }) => {
  await page.addInitScript(() => {
    localStorage.setItem('graphgoblin-palette', 'collapsed');
    localStorage.setItem('graphgoblin-loop-panel', 'collapsed');
  });
  const response = await request.post('/loops', { data: { definition: denseGraph(300) } });
  expect(response.status(), await response.text()).toBe(201);
  const { loop } = (await response.json()) as { loop: { id: string } };
  await page.goto(`/app/loops/${loop.id}/edit`);
  await expect(page.locator('.react-flow__edge')).toHaveCount(600);
  await page.evaluate(() => document.fonts.ready);
  await page.locator('.react-flow__viewport').evaluate(async (viewport) => {
    let previous = viewport.getAttribute('style');
    let since = performance.now();
    await new Promise<void>((done) => {
      const frame = () => {
        const current = viewport.getAttribute('style');
        if (current !== previous) {
          previous = current;
          since = performance.now();
        }
        if (performance.now() - since >= 220) done();
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  });
  const card = page.locator('.react-flow__node[data-id="n144"]');
  await card.click({ trial: true });
  const box = (await card.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + 8;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 24, y + 16, { steps: 8 });
  await expect(card).toHaveClass(/\bdragging\b/);
  await page.evaluate(() => {
    const samples: { routingMs: number; labelMs: number }[] = [];
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const measure = entry as PerformanceMeasure;
        if (measure.name === 'gg:backward-routing') samples.push(measure.detail);
      }
    });
    observer.observe({ type: 'measure' });
    Object.assign(window, { gg425Drop: { observer, samples } });
  });
  await page.mouse.up();
  await expect(card).not.toHaveClass(/\bdragging\b/);
  await expect(page.getByRole('button', { name: /^Undo move / })).toBeEnabled();
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
  const samples = await page.evaluate(async () => {
    await new Promise<void>((done) =>
      requestAnimationFrame(() => requestAnimationFrame(() => done())),
    );
    const { observer, samples } = (
      window as typeof window & {
        gg425Drop: {
          observer: PerformanceObserver;
          samples: { routingMs: number; labelMs: number }[];
        };
      }
    ).gg425Drop;
    observer.disconnect();
    return samples;
  });
  console.log(`Post-drop samples: ${JSON.stringify(samples)}`);
  expect(samples.filter((sample) => sample.routingMs === 0)).toHaveLength(1);
});
