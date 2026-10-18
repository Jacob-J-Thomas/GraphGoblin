import { approvalLoop, closeNode, expect, openNode, showLoopPanel, test } from './fixtures.js';

for (const from of ['manual', 'event']) {
  test(`untouched UTC previews after ${from} to Cron`, async ({ page, request }) => {
    const definition = approvalLoop('Synthetic cron setup');
    const created = await request.post('/loops', {
      data: {
        definition: {
          ...definition,
          nodes: definition.nodes.map((n) =>
            from === 'event' && n.id === 'start'
              ? { ...n, config: { type: 'event', eventType: 'synthetic' } }
              : n,
          ),
        },
      },
    });
    expect(created.status()).toBe(201);
    const { loop } = (await created.json()) as { loop: { id: string } };
    await page.goto(`/app/loops/${loop.id}/edit`);
    const dialog = await openNode(page, 'start');
    await dialog.getByLabel('Trigger type').selectOption('cron');
    await dialog.getByLabel('Repeat').selectOption('daily');
    await expect(dialog.getByLabel('Timezone')).toHaveValue('UTC');
    await expect(dialog.locator('time')).toHaveCount(5);
    await expect(dialog).not.toContainText('graphgoblin:unset');
    await closeNode(page);
    await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
    const saved = await (await request.get(`/loops/${loop.id}`)).json();
    expect(saved.draft.definition.nodes[0].config.timezone).toBe('UTC');
  });
}

test('Fit View contains every rendered card of a synthetic 29-node graph between open panels', async ({
  page,
  request,
}) => {
  const base = approvalLoop('Synthetic long graph');
  const nodes = Array.from({ length: 29 }, (_, i) => ({
    id: `n${i}`,
    label: `Card ${i}`,
    kind: i === 0 ? 'trigger' : i === 28 ? 'exit' : 'wait',
    config: i === 0 ? { type: 'manual' } : i === 28 ? {} : { mode: 'duration', seconds: 1 },
    ui: { x: -602 + (i % 7) * 412, y: Math.floor(i / 7) * 180 },
  }));
  const edges = nodes
    .slice(1)
    .map((n, i) => ({ id: `e${i}`, from: { node: `n${i}`, port: 'out' }, to: { node: n.id } }));
  const created = await request.post('/loops', { data: { definition: { ...base, nodes, edges } } });
  expect(created.status()).toBe(201);
  const { loop } = (await created.json()) as { loop: { id: string } };
  await page.goto(`/app/loops/${loop.id}/edit`);
  await showLoopPanel(page);
  await expect(page.locator('.react-flow__node')).toHaveCount(29);
  await page.getByRole('button', { name: /zoom in/i }).click();
  await page.getByRole('button', { name: /fit view/i }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const canvas = document.querySelector('.react-flow')!.getBoundingClientRect();
        return [...document.querySelectorAll('.react-flow__node')].filter((card) => {
          const b = card.getBoundingClientRect();
          return (
            b.left < canvas.left - 1 ||
            b.right > canvas.right + 1 ||
            b.top < canvas.top - 1 ||
            b.bottom > canvas.bottom + 1
          );
        }).length;
      }),
    )
    .toBe(0);
  const canvas = await page.locator('.react-flow').boundingBox();
  expect(canvas!.x).toBeGreaterThan(0);
  expect(canvas!.x + canvas!.width).toBeLessThan(1440);
});
