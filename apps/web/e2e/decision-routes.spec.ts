import {
  DecisionConfigSchema,
  LoopDefinitionSchema,
  RunEventSchema,
  type DecisionConfig,
  type LoopDefinitionInput,
} from '@graphgoblin/contracts';
import type { APIRequestContext, Page } from '@playwright/test';
import { closeNode, control, expect, openNode, test } from './fixtures.js';

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

function primitiveLoop(
  name: string,
  config: DecisionConfig,
  routes: { id: string; label: string; target: string }[],
): LoopDefinitionInput {
  return {
    schemaVersion: 2,
    name,
    nodes: [
      {
        id: 'start',
        kind: 'trigger',
        label: 'Start',
        config: { subtype: 'manual' },
        ui: { x: 0, y: 80 },
      },
      { id: 'pick', kind: 'decision', label: 'Pick', config, ui: { x: 260, y: 80 } },
      {
        id: 'branch',
        kind: 'mutate',
        label: 'Branch',
        config: {
          operations: [{ op: 'append-message', role: 'assistant', content: 'Branch ran' }],
        },
        ui: { x: 520, y: 260 },
      },
      { id: 'done', kind: 'exit', label: 'Done', config: {}, ui: { x: 800, y: 80 } },
    ],
    edges: [
      { id: 'start-pick', from: { node: 'start', port: 'out' }, to: { node: 'pick' } },
      ...routes.map((route) => ({
        id: `${route.id}-edge`,
        from: { node: 'pick', port: route.id },
        to: { node: route.target },
      })),
      { id: 'branch-done', from: { node: 'branch', port: 'out' }, to: { node: 'done' } },
    ],
  };
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

test('switching Choice to Noul preserves side edges, then saves and runs the edited true route', async ({
  page,
  request,
}) => {
  const config = DecisionConfigSchema.parse({
    answer: {
      type: 'choice',
      options: [
        { id: 'true', label: 'True', criteria: 'The statement is true' },
        { id: 'false', label: 'False', criteria: 'The statement is false' },
      ],
    },
    evaluation: { kind: 'expression', jsonata: '"true"' },
    recordAlternatives: true,
  });
  const loopId = await openLoop(
    page,
    request,
    primitiveLoop('Noul routes', config, [
      { id: 'true', label: 'True', target: 'branch' },
      { id: 'false', label: 'False', target: 'done' },
    ]),
  );
  let dialog = await openNode(page, 'pick');
  await dialog
    .getByRole('radiogroup', { name: 'Answer type' })
    .getByText('Noul', { exact: true })
    .click();
  await expect(handle(page, 'pick', 'true')).toBeVisible();
  await expect(handle(page, 'pick', 'false')).toBeVisible();
  const trueId = dialog.locator('[data-field="answer.true.id"] input');
  await trueId.fill('affirm');
  await dialog.locator('[data-field="answer.true.label"] input').fill('Affirmative');
  await expect(handle(page, 'pick', 'affirm')).toBeVisible();
  await expect(dialog.getByRole('region', { name: 'Connections' })).toContainText(
    'Affirmative (affirm)',
  );
  await closeNode(page);

  const saved = await savedDraft(page, request, loopId);
  expect(saved.edges.find((item) => item.id === 'true-edge')?.from.port).toBe('affirm');
  expect(saved.edges.find((item) => item.id === 'true-edge')?.to.node).toBe('branch');
  await page.reload();
  await expect(handle(page, 'pick', 'affirm')).toBeVisible();
  await expect(page.getByTestId('node-pick')).toContainText('Affirmative');
  dialog = await openNode(page, 'pick');
  await expect(dialog.getByRole('radio', { name: 'Noul' })).toBeChecked();
  await expect(dialog.locator('[data-field="evaluation.jsonata"] [role="textbox"]')).toHaveText(
    'true',
  );
  await closeNode(page);

  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Published version 1.')).toBeVisible();
  await page.getByRole('link', { name: 'Open in Runs' }).first().click();
  await page.getByRole('button', { name: 'Start run' }).click();
  await expect(page.locator('[data-status="succeeded"]').first()).toBeVisible();
  const runId = page.url().split('/').at(-1)!;
  const body = (await (await request.get(`/runs/${runId}/events`)).json()) as { items: unknown };
  const events = RunEventSchema.array().parse(body.items);
  expect(events.find((item) => item.type === 'decision.made')).toMatchObject({
    answer: { type: 'noul', kind: 'expression', holds: true, confidence: null },
    portId: 'affirm',
    provenance: { kind: 'expression' },
  });
  const timeline = page.getByRole('list', { name: 'Timeline' });
  await timeline.getByRole('button', { name: /decision\.made/ }).click();
  await expect(page.getByRole('heading', { name: 'Evaluation details' })).toBeVisible();
  await expect(page.getByText('Side port').locator('xpath=following-sibling::dd[1]')).toHaveText(
    'affirm',
  );
});

test('Score bands expose fractional boundaries, validate malformed coverage, and connect by keyboard', async ({
  page,
  request,
}) => {
  const config = DecisionConfigSchema.parse({
    answer: {
      type: 'score',
      anchors: ['Does not meet', 'Partly meets', 'Fully meets'],
      bands: [
        { id: 'low', label: 'Low', min: 0, max: 0.5 },
        { id: 'middle', label: 'Middle', min: 0.5, max: 1.5 },
        { id: 'high', label: 'High', min: 1.5, max: 2 },
      ],
    },
    evaluation: {
      kind: 'classifier',
      model: 'jev',
      question: 'Score the input against the rubric.',
      context: { messages: 'last', includeLastOutput: true },
    },
    recordAlternatives: true,
  });
  const loopId = await openLoop(
    page,
    request,
    primitiveLoop('Score bands', config, [{ id: 'low', label: 'Low', target: 'branch' }]),
  );
  const dialog = await openNode(page, 'pick');
  const score = dialog.getByRole('radio', { name: 'Score' });
  await expect(score).toBeChecked();
  await expect(score).toHaveAccessibleDescription(
    /scores can fall between anchors.*stops just before.*never rounded/i,
  );
  const highLabel = dialog.locator('[data-field="answer.bands.2.label"] input');
  await highLabel.fill('Top score');
  await dialog.locator('[data-field="answer.bands.0.label"] input').fill('Minimum');
  const middleMax = dialog.locator('[data-field="answer.bands.1.max"] input');
  const malformedBandsError = dialog
    .getByRole('alert')
    .filter({ hasText: /bands must form nonempty contiguous intervals/ });
  await middleMax.fill('1.75');
  await expect(malformedBandsError).toBeVisible();
  await middleMax.fill('1.5');
  await expect(malformedBandsError).toHaveCount(0);

  const connections = dialog.getByRole('region', { name: 'Connections' });
  const output = dialog.getByLabel('Output', { exact: true });
  await output.focus();
  await expect(output.getByRole('option', { selected: true })).toHaveText('Middle (middle)');
  await page.keyboard.press('ArrowDown');
  await expect(output.getByRole('option', { selected: true })).toHaveText('Top score (high)');
  await page.keyboard.press('Enter');
  await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(connections).toContainText('Top score (high)');
  await closeNode(page);
  const saved = await savedDraft(page, request, loopId);
  expect(saved.edges.find((item) => item.id === 'low-edge')).toMatchObject({
    from: { node: 'pick', port: 'low' },
    to: { node: 'branch' },
  });
  expect(saved.edges.find((item) => item.from.port === 'high')?.to.node).toBe('branch');
  await page.reload();
  await expect(page.getByTestId('node-pick')).toContainText('Top score');
  await expect(page.getByTestId('node-pick')).toContainText('Minimum');
  await expect(handle(page, 'pick', 'high')).toBeVisible();
});

test('removing a connected option removes its edge in the same undo step', async ({
  page,
  request,
}) => {
  const definition = decisionLoop(3);
  const pick = definition.nodes.find((node) => node.kind === 'decision')!;
  if (pick.kind !== 'decision' || pick.config.answer.type !== 'choice')
    throw new Error('Expected the Choice fixture.');
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

test('the primitive-aware classifier picker preserves but marks an incompatible saved model', async ({
  page,
  request,
}) => {
  const app = await control(request, '/apps', { realClassifiers: true });
  const url = String(app['url']);
  const registered = await request.put(`${url}/classifier-models/choice-only`, {
    data: {
      displayName: 'Choice Only',
      providerModel: 'choice-only',
      endpoint: 'http://127.0.0.1:8008',
      primitives: ['noul'],
      provider: 'http',
    },
  });
  expect(registered.status()).toBe(200);
  expect(
    (
      await request.patch(`${url}/classifier-models/choice-only`, { data: { enabled: true } })
    ).status(),
  ).toBe(200);
  const config = DecisionConfigSchema.parse({
    answer: {
      type: 'noul',
      true: { id: 'true', label: 'True', criteria: 'True' },
      false: { id: 'false', label: 'False', criteria: 'False' },
    },
    evaluation: {
      kind: 'classifier',
      model: 'choice-only',
      question: 'Does it hold?',
      context: { messages: 'last', includeLastOutput: true },
    },
    recordAlternatives: true,
  });
  const created = await request.post(`${url}/loops`, {
    data: {
      definition: primitiveLoop('Noul classifier capability', config, [
        { id: 'true', label: 'True', target: 'branch' },
        { id: 'false', label: 'False', target: 'done' },
      ]),
    },
  });
  expect(created.status()).toBe(201);
  const { loop } = (await created.json()) as { loop: { id: string } };
  const loopId = loop.id;
  const changed = await request.put(`${url}/classifier-models/choice-only`, {
    data: {
      displayName: 'Choice Only',
      providerModel: 'choice-only',
      endpoint: 'http://127.0.0.1:8008',
      primitives: ['choice'],
      provider: 'http',
    },
  });
  expect(changed.status(), await changed.text()).toBe(200);
  await page.goto(`${url}/app/loops/${loopId}/edit`);
  const editor = await openNode(page, 'pick');
  const picker = editor.getByRole('combobox', { name: 'Model' });
  await expect(picker).toHaveValue('choice-only');
  await expect(picker).toHaveAccessibleDescription(/cannot answer Noul decisions/);
  await expect(
    picker.getByRole('option', { name: /Choice Only.*not Noul-capable/ }),
  ).toBeAttached();
  await expect(picker.getByRole('option', { name: /Jev \(jev\)/ })).toBeAttached();
  await expect(picker.getByRole('option', { name: /Choice Only/ })).toHaveCount(1);
});

test('a rejected Noul confidence result stays raw and visible without selecting a route', async ({
  page,
  request,
}) => {
  const app = await control(request, '/apps', { realClassifiers: true });
  const url = String(app['url']);
  const fake = await control(request, '/classifier/start');
  const endpoint = String(fake['endpoint']);
  const registered = await request.put(`${url}/classifier-models/noul-check`, {
    data: {
      displayName: 'Noul Check',
      providerModel: 'noul-check-latest',
      endpoint,
      primitives: ['noul'],
      provider: 'http',
    },
  });
  expect(registered.status()).toBe(200);
  expect(
    (
      await request.patch(`${url}/classifier-models/noul-check`, { data: { enabled: true } })
    ).status(),
  ).toBe(200);
  await control(request, '/classifier/respond-noul', { endpoint, trueProbability: 0.6 });
  const config = DecisionConfigSchema.parse({
    answer: {
      type: 'noul',
      true: { id: 'true', label: 'True', criteria: 'It holds' },
      false: { id: 'false', label: 'False', criteria: 'It does not hold' },
    },
    evaluation: {
      kind: 'classifier',
      model: 'noul-check',
      question: 'Does the claim hold?',
      minConfidence: 0.8,
      truthThreshold: 0.5,
      context: { messages: 'last', includeLastOutput: true },
    },
    recordAlternatives: true,
  });
  const created = await request.post(`${url}/loops`, {
    data: {
      definition: primitiveLoop('Noul confidence gate', config, [
        { id: 'true', label: 'True', target: 'branch' },
        { id: 'false', label: 'False', target: 'done' },
      ]),
    },
  });
  expect(created.status()).toBe(201);
  const { loop } = (await created.json()) as { loop: { id: string } };
  const published = await request.post(`${url}/loops/${loop.id}/publish`);
  expect(published.status(), await published.text()).toBe(200);
  const started = await request.post(`${url}/loops/${loop.id}/runs`, { data: {} });
  expect(started.status()).toBe(202);
  const { run } = (await started.json()) as { run: { id: string } };
  await expect
    .poll(
      async () =>
        ((await (await request.get(`${url}/runs/${run.id}`)).json()) as { status: string }).status,
    )
    .toBe('failed');
  const body = (await (await request.get(`${url}/runs/${run.id}/events`)).json()) as {
    items: unknown;
  };
  const events = RunEventSchema.array().parse(body.items);
  expect(events.some((item) => item.type === 'decision.made')).toBe(false);
  const failed = events.find((item) => item.type === 'run.failed');
  expect(failed).toMatchObject({
    failure: {
      code: 'EVALUATION_RESULT_REJECTED',
      details: {
        answer: {
          type: 'noul',
          kind: 'classifier',
          holds: true,
          trueProbability: 0.6,
          confidence: 0.6,
        },
        acceptance: { status: 'rejected', minConfidence: 0.8 },
      },
    },
  });

  await page.goto(`${url}/app/runs/${run.id}`);
  const timeline = page.getByRole('list', { name: 'Timeline' });
  await timeline.getByRole('button', { name: /run\.failed/ }).click();
  const rejection = page.getByRole('region', { name: 'Rejected classifier evaluation' });
  await expect(rejection).toContainText('No decision was accepted and no route was selected.');
  await expect(rejection).toContainText('Noul true');
  await expect(rejection).toContainText('True probability');
  await expect(rejection).toContainText('0.6');
  await expect(rejection).toContainText('Minimum confidence');
  await expect(rejection).toContainText('0.8');
});
