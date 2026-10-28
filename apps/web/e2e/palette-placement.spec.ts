import { CURRENT_DEFINITION_FORMAT } from '@graphgoblin/contracts';
import { resolve } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { closeNode, expect, openNode, test } from './fixtures.js';

async function fit(page: Page) {
  await settleViewport(page);
  await page.getByRole('button', { name: 'Fit view' }).click();
  await settleViewport(page);
  await page.evaluate(() => document.fonts.ready);
}

async function settleViewport(page: Page) {
  // Palette pans take 200ms. Wait for a stable viewport before targeting a card by its box.
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
}

async function connect(dialog: Locator, port: string, target: string) {
  await dialog.getByLabel('Output', { exact: true }).selectOption(port);
  await dialog.getByLabel('To', { exact: true }).selectOption(target);
  await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
}

async function intersections(elements: Locator) {
  return elements.evaluateAll((items) => {
    const boxes = items.map((item) => ({
      name: item.getAttribute('data-testid') ?? item.textContent,
      box: item.getBoundingClientRect(),
    }));
    return boxes.flatMap((a, i) =>
      boxes
        .slice(i + 1)
        .flatMap((b) =>
          a.box.left < b.box.right &&
          a.box.right > b.box.left &&
          a.box.top < b.box.bottom &&
          a.box.bottom > b.box.top
            ? [`${a.name} / ${b.name}`]
            : [],
        ),
    );
  });
}

test('palette authoring clears a three-output Decision and keeps converging labels apart', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const created = await request.post('/loops', {
    data: {
      definition: {
        schemaVersion: CURRENT_DEFINITION_FORMAT,
        name: 'F2 palette placement',
        nodes: [
          { id: 'seed', kind: 'trigger', label: 'Seed', config: { type: 'manual' } },
          { id: 'seed-exit', kind: 'exit', label: 'Seed exit', config: {}, ui: { x: 300, y: 0 } },
        ],
        edges: [
          { id: 'seed-edge', from: { node: 'seed', port: 'out' }, to: { node: 'seed-exit' } },
        ],
      },
    },
  });
  expect(created.status()).toBe(201);
  const { loop } = (await created.json()) as { loop: { id: string } };
  await page.goto(`/app/loops/${loop.id}/edit`);
  for (const id of ['seed', 'seed-exit']) {
    const node = page.locator(`.react-flow__node[data-id="${id}"]`);
    await node.press(' ');
    await node.press('Delete');
    await expect(node).toHaveCount(0);
  }
  for (const kind of ['Trigger', 'Inference', 'Decision']) {
    await page.getByRole('button', { name: `Add ${kind} node`, exact: true }).click();
    await expect(page.getByTestId(`node-${kind.toLowerCase()}`)).toBeVisible();
  }
  await fit(page);
  let dialog = await openNode(page, 'decision');
  await dialog.locator('[data-field="routes.0.id"] input').fill('again');
  await dialog.locator('[data-field="routes.0.label"] input').fill('Again');
  await dialog.locator('[data-field="routes.1.id"] input').fill('finish');
  await dialog.locator('[data-field="routes.1.label"] input').fill('Finish');
  await dialog.locator('[data-field="routes.0.repeat"]').getByRole('switch').click();
  await dialog.locator('[data-field="maxPasses"] input').fill('2');
  await closeNode(page);
  await expect(page.getByTestId('node-decision').locator('.source')).toHaveCount(3);
  // The growing Decision is already committed before adding the next card.
  for (const kind of ['Wait', 'Exit']) {
    await page.getByRole('button', { name: `Add ${kind} node`, exact: true }).click();
    await expect(page.getByTestId(`node-${kind.toLowerCase()}`)).toBeVisible();
    await settleViewport(page);
    await expect(page.getByTestId(`node-${kind.toLowerCase()}`)).toBeInViewport();
  }
  // Arrange the exit to the right as in F2: both Decision outputs use forward paths.
  for (const name of ['Hide palette', 'Hide loop settings']) {
    const button = page.getByRole('button', { name, exact: true });
    if (await button.isVisible()) await button.click();
  }
  await fit(page);
  const exitHeader = await page
    .getByTestId('node-exit')
    .locator(':scope > div:has([data-kind])')
    .boundingBox();
  const canvas = await page.getByTestId('canvas').boundingBox();
  await page.mouse.move(
    exitHeader!.x + exitHeader!.width / 2,
    exitHeader!.y + exitHeader!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(canvas!.x + canvas!.width - 220, canvas!.y + 200, { steps: 15 });
  await page.mouse.up();
  for (const [node, connections] of [
    ['trigger', [['out', 'inference']]],
    ['inference', [['out', 'decision']]],
    [
      'decision',
      [
        ['again', 'wait'],
        ['finish', 'exit'],
        ['limit-reached', 'exit'],
      ],
    ],
    ['wait', [['out', 'inference']]],
  ] as const) {
    await fit(page);
    dialog = await openNode(page, node);
    for (const [port, target] of connections) await connect(dialog, port, target);
    await closeNode(page);
  }
  for (const name of ['Hide palette', 'Hide loop settings']) {
    const button = page.getByRole('button', { name, exact: true });
    if (await button.isVisible()) await button.click();
  }
  await fit(page);
  await page.getByRole('button', { name: 'Zoom Out', exact: true }).click();
  await settleViewport(page);
  await expect(page.locator('.react-flow__edge')).toHaveCount(6);
  await expect(page.locator('.react-flow__edge-text').filter({ hasText: 'Finish' })).toBeVisible();
  await expect(
    page.locator('.react-flow__edge-text').filter({ hasText: 'Limit reached' }),
  ).toBeVisible();
  // Persist the same viewport on both baseline and fix; no providers are invoked.
  const screenshot =
    process.env['GG_425_EVIDENCE'] === '1'
      ? resolve(
          '../../docs/qa/2026-10-28-wp-425-placement',
          process.env['GG_425_BASELINE'] === '1' ? 'before-main.png' : 'after.png',
        )
      : testInfo.outputPath('canvas.png');
  await page.screenshot({ path: screenshot });
  await testInfo.attach('canvas', { path: screenshot, contentType: 'image/png' });
  expect.soft(await intersections(page.locator('[data-testid^="node-"]'))).toEqual([]);
  expect.soft(await intersections(page.locator('.react-flow__edge-textwrapper'))).toEqual([]);
});
