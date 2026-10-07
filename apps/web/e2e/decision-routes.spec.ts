import {
  LoopDefinitionSchema,
  RunEventSchema,
  type LoopDefinitionInput,
} from '@graphgoblin/contracts';
import type { APIRequestContext, Page } from '@playwright/test';
import { closeNode, expect, openNode, test } from './fixtures.js';

const handle = (page: Page, node: string, port: string) =>
  page.locator(`.react-flow__handle[data-nodeid="${node}"][data-handleid="${port}"]`);
const edge = (page: Page, id: string) => page.locator(`.react-flow__edge[data-id="${id}"]`);

function decisionLoop(optionCount = 2): LoopDefinitionInput {
  const ids = Array.from({ length: optionCount }, (_, index) =>
    index < 2 ? ['yes', 'no'][index]! : `route-${index + 1}`,
  );
  const options = ids.map((id, index) => ({
    id,
    label:
      index === 0
        ? 'Yes'
        : index === 1
          ? 'No'
          : index === optionCount - 1
            ? String(optionCount)
            : `Option ${index + 1}`,
    criteria: `Criterion ${index + 1}`,
  }));
  const nodes: LoopDefinitionInput['nodes'] = [
    {
      id: 'start',
      kind: 'trigger',
      label: 'Start',
      config: { subtype: 'manual' },
      ui: { x: 0, y: 80 },
    },
    {
      id: 'pick',
      kind: 'decision',
      label: 'Pick',
      config: {
        answer: { type: 'choice', options },
        evaluation: { kind: 'expression', jsonata: `"${ids[0]}"` },
        recordAlternatives: true,
      },
      ui: { x: 260, y: 80 },
    },
    {
      id: 'branch',
      kind: 'mutate',
      label: 'Branch',
      config: { operations: [{ op: 'append-message', role: 'assistant', content: 'Branch ran' }] },
      ui: { x: 520, y: 260 },
    },
    { id: 'done', kind: 'exit', label: 'Done', config: {}, ui: { x: 800, y: 80 } },
  ];
  const edges: LoopDefinitionInput['edges'] = [
    { id: 'start-pick', from: { node: 'start', port: 'out' }, to: { node: 'pick' } },
    ...ids
      .slice(0, 2)
      .map((id) => ({ id: `${id}-edge`, from: { node: 'pick', port: id }, to: { node: 'done' } })),
    { id: 'branch-done', from: { node: 'branch', port: 'out' }, to: { node: 'done' } },
  ];
  return { schemaVersion: 2, name: `Decision with ${optionCount} options`, nodes, edges };
}

async function openLoop(page: Page, request: APIRequestContext, definition = decisionLoop()) {
  const created = await request.post('/loops', { data: { definition } });
  expect(created.status(), await created.text()).toBe(201);
  const { loop } = (await created.json()) as { loop: { id: string } };
  await page.goto(`/app/loops/${loop.id}/edit`);
  await expect(page.getByTestId('node-pick')).toBeVisible();
  for (const name of ['Hide palette', 'Hide loop settings']) {
    const button = page.getByRole('button', { name, exact: true });
    if (await button.isVisible()) await button.click();
  }
  await page.getByRole('button', { name: 'Fit view' }).click();
  await page.evaluate(() => document.fonts.ready);
  return loop.id;
}

async function savedDraft(page: Page, request: APIRequestContext, loopId: string) {
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
  const body = (await (await request.get(`/loops/${loopId}`)).json()) as {
    draft: { definition: unknown };
  };
  return LoopDefinitionSchema.parse(body.draft.definition);
}

test('option IDs stay connected when numeric display labels change, save, and reload', async ({
  page,
  request,
}) => {
  const loopId = await openLoop(page, request);
  let dialog = await openNode(page, 'pick');
  const method = dialog.getByRole('radiogroup', { name: 'Evaluation method' });
  const classifier = method.getByRole('radio', { name: 'Classifier' });
  await classifier.focus();
  await page.keyboard.press('Space');
  await expect(classifier).toBeChecked();
  const expression = method.getByRole('radio', { name: 'Expression' });
  await expression.focus();
  await page.keyboard.press('Space');
  await expect(expression).toBeChecked();
  const jsonata = dialog.locator('[data-field="evaluation.jsonata"] [role="textbox"]');
  await jsonata.fill('"yes"');

  await dialog.getByRole('button', { name: 'Add options', exact: true }).click();
  await dialog.locator('[data-field="answer.options.2.id"] input').fill('route-3');
  await dialog.locator('[data-field="answer.options.2.label"] input').fill('7');
  await dialog
    .locator('[data-field="answer.options.2.criteria"] input')
    .fill('A numeric display label does not become a route port');
  await expect(handle(page, 'pick', 'route-3')).toBeVisible();
  const output = dialog.getByLabel('Output', { exact: true });
  await output.selectOption('route-3');
  await dialog.getByLabel('To', { exact: true }).selectOption('branch');
  await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
  const connections = dialog.getByRole('region', { name: 'Connections' });
  await expect(connections).toContainText('7 (route-3)');

  // A blank in-progress ID keeps ownership on the last valid port. Repairing the same row moves
  // that edge with it, and restoring the ID does not create or transfer another connection.
  const thirdId = dialog.locator('[data-field="answer.options.2.id"] input');
  await thirdId.fill('');
  await expect(connections).toContainText('route-3');
  await thirdId.fill('route-4');
  await expect(connections).toContainText('7 (route-4)');
  await expect(handle(page, 'pick', 'route-4')).toBeVisible();
  await thirdId.fill('route-3');
  await expect(connections).toContainText('7 (route-3)');
  await closeNode(page);

  const connected = (await savedDraft(page, request, loopId)).edges.find(
    (item) => item.from.port === 'route-3',
  )!;
  expect(connected.to.node).toBe('branch');
  await page.reload();
  await expect(handle(page, 'pick', 'route-3')).toBeVisible();
  await expect(page.getByTestId('node-pick')).toContainText('7');

  dialog = await openNode(page, 'pick');
  await dialog.locator('[data-field="answer.options.2.label"] input').fill('Reviewed');
  await closeNode(page);
  const afterLabelEdit = await savedDraft(page, request, loopId);
  expect(afterLabelEdit.edges.find((item) => item.id === connected.id)?.from.port).toBe('route-3');
  const decisionNode = afterLabelEdit.nodes.find((node) => node.id === 'pick');
  if (decisionNode?.kind !== 'decision') throw new Error('The saved decision node is missing.');
  expect(decisionNode.config.evaluation).toEqual({
    kind: 'expression',
    jsonata: '"yes"',
  });
  await expect(edge(page, connected.id)).toHaveAttribute(
    'aria-label',
    'pick Reviewed (route-3) to branch',
  );

  // Expression evaluation selects the stable ID and the route follows the matching edge.
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Published version 1.')).toBeVisible();
  await page.getByRole('link', { name: 'Open in Runs' }).first().click();
  await page.getByRole('button', { name: 'Start run' }).click();
  await expect(page.locator('[data-status="succeeded"]').first()).toBeVisible();
  const runId = page.url().split('/').at(-1)!;
  const events = (await (await request.get(`/runs/${runId}/events`)).json()) as { items: unknown };
  const parsed = RunEventSchema.array().parse(events.items);
  expect(parsed.find((item) => item.type === 'decision.made')).toMatchObject({
    answer: { optionId: 'yes' },
    portId: 'yes',
    provenance: { kind: 'expression' },
  });
});

test('keyboard connection reaches the eighth option by its ID while showing its numeric label', async ({
  page,
  request,
}) => {
  const loopId = await openLoop(page, request, decisionLoop(8));
  await expect(
    page.locator('.react-flow__handle[data-nodeid="pick"]:not([data-handleid="in"])'),
  ).toHaveCount(8);
  const dialog = await openNode(page, 'pick');
  const output = dialog.getByLabel('Output', { exact: true });
  await output.focus();
  for (let step = 0; step < 5; step += 1) await output.press('ArrowDown');
  await output.press('Enter');
  await expect(output).toHaveValue('route-8');
  await expect(output.getByRole('option', { selected: true })).toHaveText('8 (route-8)');
  const target = dialog.getByLabel('To', { exact: true });
  await target.focus();
  await target.press('Enter');
  await expect(target).toHaveValue('branch');
  const connect = dialog.getByRole('button', { name: 'Connect', exact: true });
  await connect.focus();
  await connect.press('Enter');
  await expect(dialog.getByRole('region', { name: 'Connections' })).toContainText('8 (route-8)');
  await closeNode(page);
  expect(
    (await savedDraft(page, request, loopId)).edges.find((item) => item.from.port === 'route-8')?.to
      .node,
  ).toBe('branch');
});

test('removing a connected option removes its edge in the same undo step', async ({
  page,
  request,
}) => {
  const definition = decisionLoop(3);
  const pick = definition.nodes.find((node) => node.kind === 'decision')!;
  pick.config.answer.options[2]!.label = 'Third';
  definition.edges.push({
    id: 'third-edge',
    from: { node: 'pick', port: 'route-3' },
    to: { node: 'branch' },
  });
  const loopId = await openLoop(page, request, definition);
  const dialog = await openNode(page, 'pick');
  await dialog.getByRole('button', { name: 'Remove options 1', exact: true }).click();
  await closeNode(page);
  await expect(edge(page, 'yes-edge')).toHaveCount(0);
  expect(
    (await savedDraft(page, request, loopId)).edges.some((item) => item.id === 'yes-edge'),
  ).toBe(false);
  await page.getByRole('button', { name: /^Undo / }).click();
  await expect(edge(page, 'yes-edge')).toHaveCount(1);
  await expect(handle(page, 'pick', 'yes')).toBeVisible();
  await page.getByRole('button', { name: /^Redo / }).click();
  await expect(edge(page, 'yes-edge')).toHaveCount(0);
});
