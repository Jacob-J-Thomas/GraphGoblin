import { CURRENT_DEFINITION_FORMAT } from '@graphgoblin/contracts';
import { expect, test } from './fixtures.js';

test('a squeezed forward label uses a bounded callout below surrounding cards', async ({
  page,
  request,
}, info) => {
  await page.addInitScript(() => {
    localStorage.setItem('graphgoblin-palette', 'collapsed');
    localStorage.setItem('graphgoblin-loop-panel', 'collapsed');
  });
  const definition = {
    schemaVersion: CURRENT_DEFINITION_FORMAT,
    name: 'S5 local label callout',
    nodes: [
      {
        id: 'start',
        kind: 'trigger',
        label: 'Start',
        config: { type: 'manual' },
        ui: { x: 100, y: 0 },
      },
      {
        id: 'work',
        kind: 'inference',
        label: 'Work',
        config: { prompt: { template: 'Hi' } },
        ui: { x: 100, y: 200 },
      },
      {
        id: 'check',
        kind: 'decision',
        label: 'Check',
        config: {
          kind: 'expression',
          jsonata: '"yes"',
          routes: [
            { id: 'yes', label: 'Yes' },
            { id: 'no', label: 'No' },
          ],
        },
        ui: { x: 0, y: 400 },
      },
      { id: 'done', kind: 'exit', label: 'Done', config: {}, ui: { x: 200, y: 400 } },
      { id: 'other', kind: 'exit', label: 'Other', config: {}, ui: { x: 520, y: 400 } },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'work' } },
      { id: 'e2', from: { node: 'work', port: 'out' }, to: { node: 'check' } },
      { id: 'yes', from: { node: 'check', port: 'yes' }, to: { node: 'done' } },
      { id: 'no', from: { node: 'check', port: 'no' }, to: { node: 'other' } },
    ],
  };
  const created = await request.post('/loops', { data: { definition } });
  expect(created.status(), await created.text()).toBe(201);
  const { loop } = (await created.json()) as { loop: { id: string } };
  await page.goto(`/app/loops/${loop.id}/edit`);
  await expect(page.locator('.react-flow__node')).toHaveCount(5);
  await page.evaluate(() => document.fonts.ready);
  const edge = page.locator('.react-flow__edge[data-id="yes"]');
  await expect(edge).toHaveClass(/react-flow__edge-smoothstep/);
  const leader = edge.locator('.gg-edge-label-leader');
  // A vertical SVG stroke has a zero-width layout box; check its painted stroke instead.
  await expect(leader).toBeAttached();
  expect(
    await leader.evaluate((element) => {
      const style = getComputedStyle(element);
      return (
        style.stroke !== 'none' &&
        Number.parseFloat(style.strokeWidth) > 0 &&
        style.visibility === 'visible'
      );
    }),
  ).toBe(true);
  const geometry = await leader.evaluate((element) => {
    const path = element as SVGPathElement;
    const length = path.getTotalLength();
    const matrix = path.getScreenCTM()!;
    const samples = Array.from({ length: Math.ceil(length) + 1 }, (_, i) => {
      const p = path.getPointAtLength(Math.min(length, i));
      return new DOMPoint(p.x, p.y).matrixTransform(matrix);
    });
    const cards = [...document.querySelectorAll('[data-testid^="node-"]')].map((card) =>
      card.getBoundingClientRect(),
    );
    return {
      length,
      crossesCard: samples.some((p) =>
        cards.some(
          (card) => p.x > card.left && p.x < card.right && p.y > card.top && p.y < card.bottom,
        ),
      ),
    };
  });
  expect(geometry.length).toBeLessThanOrEqual(96);
  expect(geometry.crossesCard).toBe(false);
  const pill = await edge.locator('.react-flow__edge-textbg').boundingBox();
  const cards = await page.locator('[data-testid^="node-"]').evaluateAll((nodes) =>
    nodes.map((n) => {
      const r = n.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    }),
  );
  for (const card of cards)
    expect(
      pill!.x < card.right &&
        pill!.x + pill!.width > card.left &&
        pill!.y < card.bottom &&
        pill!.y + pill!.height > card.top,
    ).toBe(false);
  await page.screenshot({ path: info.outputPath('local-callout.png') });
});
