import { minimalLoop } from '@graphgoblin/contracts/testing';
import { expect, openNode, publishLoop, showLoopPanel, test } from './fixtures.js';

test('shows Harness on inference nodes only', async ({ page, request }) => {
  const source = minimalLoop();
  const loopId = await publishLoop(request, {
    ...source,
    name: 'node-harness',
    nodes: [
      source.nodes[0],
      { id: 'infer', kind: 'inference', label: 'Infer', config: { prompt: { template: 'Hello' } } },
      source.nodes[1],
    ].map((node, index) => ({ ...node, ui: { x: index * 260, y: 80 } })),
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'infer' } },
      { id: 'e2', from: { node: 'infer', port: 'out' }, to: { node: 'done' } },
    ],
  });
  await page.goto(`/app/loops/${loopId}/edit`);
  await showLoopPanel(page);
  const form = page.getByRole('form', { name: 'Loop settings form', exact: true });
  await expect(form).toBeVisible();
  await expect(form.getByLabel('Harness', { exact: true })).toHaveCount(0);
  const dialog = await openNode(page, 'infer');
  await expect(
    dialog.getByRole('radiogroup', { name: 'Harness' }).getByRole('radio', { name: 'codex' }),
  ).toBeChecked();
});
