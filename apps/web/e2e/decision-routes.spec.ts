import {
  LoopDefinitionSchema,
  RunEventSchema,
  type LoopDefinitionInput,
} from '@graphgoblin/contracts';
import type { APIRequestContext, Page } from '@playwright/test';
import { closeNode, control, expect, openNode, test } from './fixtures.js';

const handle = (page: Page, node: string, port: string) =>
  page.locator(`.react-flow__handle[data-nodeid="${node}"][data-handleid="${port}"]`);
const edge = (page: Page, id: string) => page.locator(`.react-flow__edge[data-id="${id}"]`);

function decisionLoop(): LoopDefinitionInput {
  return {
    schemaVersion: 1,
    name: 'Dynamic decision routes',
    nodes: [
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
          routes: [
            { label: 'yes', description: 'First' },
            { label: 'no', description: 'Second' },
          ],
          question: 'Which branch?',
          strategy: ['jev'],
        },
        ui: { x: 260, y: 80 },
      },
      {
        id: 'branch',
        kind: 'mutate',
        label: 'Third branch',
        config: {
          operations: [{ op: 'append-message', role: 'assistant', content: 'Third branch ran' }],
        },
        ui: { x: 520, y: 260 },
      },
      { id: 'done', kind: 'exit', label: 'Done', config: {}, ui: { x: 800, y: 80 } },
    ],
    edges: [
      { id: 'start-pick', from: { node: 'start', port: 'out' }, to: { node: 'pick' } },
      { id: 'yes-edge', from: { node: 'pick', port: 'yes' }, to: { node: 'done' } },
      { id: 'no-edge', from: { node: 'pick', port: 'no' }, to: { node: 'done' } },
      { id: 'branch-edge', from: { node: 'branch', port: 'out' }, to: { node: 'done' } },
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

test('add, drag-connect, rename, remove, publish and run the new decision branch without reloading', async ({
  page,
  request,
}) => {
  const loopId = await openLoop(page, request);
  let dialog = await openNode(page, 'pick');
  await dialog.getByRole('button', { name: 'Add routes', exact: true }).click();
  await dialog.locator('[data-field="routes.2.label"]').getByRole('textbox').fill('third');
  await dialog.locator('[data-field="routes.2.description"]').getByRole('textbox').fill('Third');
  // The new output is offered by Connections while the dialog is still open.
  await expect(
    dialog.getByLabel('Output').getByRole('option', { name: 'third', exact: true }),
  ).toBeAttached();
  await closeNode(page);
  await handle(page, 'pick', 'third').dragTo(handle(page, 'branch', 'in'));
  const connected = (await savedDraft(page, request, loopId)).edges.find(
    (e) => e.from.node === 'pick' && e.from.port === 'third',
  )!;
  expect(connected.to.node).toBe('branch');

  dialog = await openNode(page, 'pick');
  await dialog.locator('[data-field="routes.2.label"]').getByRole('textbox').fill('other');
  await expect(dialog.getByRole('region', { name: 'Connections' })).toContainText('other');
  await closeNode(page);
  await expect(edge(page, connected.id)).toHaveAttribute('aria-label', 'pick other to branch');
  expect(
    (await savedDraft(page, request, loopId)).edges.find((e) => e.id === connected.id)?.from.port,
  ).toBe('other');

  dialog = await openNode(page, 'pick');
  await dialog.getByRole('button', { name: 'Remove routes 1', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Remove edge yes-edge' })).toHaveCount(0);
  await closeNode(page);
  await expect(edge(page, 'yes-edge')).toHaveCount(0);
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Published version 1.')).toBeVisible();
  await control(request, '/deciders/route', { label: 'other' });
  try {
    await page.getByRole('link', { name: 'Open in Runs' }).first().click();
    await page.getByRole('button', { name: 'Start run' }).click();
    await expect(page.locator('[data-status="succeeded"]').first()).toBeVisible();
    await expect(page.getByLabel('Messages')).toContainText('Third branch ran');
    const runId = page.url().split('/').at(-1)!;
    const events = (await (await request.get(`/runs/${runId}/events`)).json()) as {
      items: unknown;
    };
    const parsed = RunEventSchema.array().parse(events.items);
    expect(parsed.find((e) => e.type === 'decision.made')).toMatchObject({
      route: 'other',
      strategy: 'jev',
    });
    expect(parsed.some((e) => e.type === 'node.finished' && e.nodeId === 'branch')).toBe(true);
  } finally {
    await control(request, '/deciders/route');
  }
});

test('a same-height free route rename is drag-connectable immediately and through Connections', async ({
  page,
  request,
}) => {
  const definition = decisionLoop();
  definition.edges = definition.edges.filter((e) => e.id !== 'no-edge');
  const loopId = await openLoop(page, request, definition);
  const before = await page.getByTestId('node-pick').boundingBox();
  let dialog = await openNode(page, 'pick');
  await dialog.locator('[data-field="routes.1.label"]').getByRole('textbox').fill('go');
  await closeNode(page);
  expect((await page.getByTestId('node-pick').boundingBox())!.height).toBe(before!.height);
  await handle(page, 'pick', 'go').dragTo(handle(page, 'branch', 'in'));
  const connected = (await savedDraft(page, request, loopId)).edges.find(
    (e) => e.from.port === 'go',
  );
  expect(connected?.to.node).toBe('branch');
  dialog = await openNode(page, 'pick');
  await dialog.getByRole('button', { name: `Remove edge ${connected!.id}` }).click();
  await dialog.locator('[data-field="routes.1.label"]').getByRole('textbox').fill('on');
  await dialog.getByLabel('Output', { exact: true }).selectOption('on');
  await dialog.getByLabel('To', { exact: true }).selectOption('branch');
  await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
  await closeNode(page);
  expect(
    (await savedDraft(page, request, loopId)).edges.find((e) => e.from.port === 'on')?.to.node,
  ).toBe('branch');
});

test('removing a connected route removes its edge in the same undo step', async ({
  page,
  request,
}) => {
  const definition = decisionLoop();
  const pick = definition.nodes.find((n) => n.kind === 'decision')!;
  pick.config.routes.push({ label: 'third', description: 'Third' });
  definition.edges.push({
    id: 'third-branch',
    from: { node: 'pick', port: 'third' },
    to: { node: 'branch' },
  });
  const loopId = await openLoop(page, request, definition);
  const dialog = await openNode(page, 'pick');
  await dialog.getByRole('button', { name: 'Remove routes 1', exact: true }).click();
  await closeNode(page);
  await expect(edge(page, 'yes-edge')).toHaveCount(0);
  expect((await savedDraft(page, request, loopId)).edges.some((e) => e.id === 'yes-edge')).toBe(
    false,
  );
  await page.getByRole('button', { name: /^Undo / }).click();
  await expect(edge(page, 'yes-edge')).toHaveCount(1);
  await expect(handle(page, 'pick', 'yes')).toBeVisible();
  await page.getByRole('button', { name: /^Redo / }).click();
  await expect(edge(page, 'yes-edge')).toHaveCount(0);
});
