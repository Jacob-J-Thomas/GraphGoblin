import {
  CURRENT_DEFINITION_FORMAT,
  LoopDefinitionSchema,
  RunEventSchema,
  RunRecordSchema,
  type LoopDefinitionInput,
} from '@graphgoblin/contracts';
import { closeNode, control, expect, openNode, test } from './fixtures.js';

for (const finalChoice of ['repeat', 'done'] as const) {
  test(`authors a gate and terminal exits; last pass chooses ${finalChoice}`, async ({
    page,
    request,
  }) => {
    const instance = await control(request, '/apps');
    const url = String(instance['url']);
    const instanceId = instance['instanceId'];
    const definition: LoopDefinitionInput = {
      schemaVersion: CURRENT_DEFINITION_FORMAT,
      name: `Gate ${finalChoice}`,
      settings: { maxNodeVisits: 10 },
      nodes: [
        {
          id: 'start',
          kind: 'trigger',
          label: 'Start',
          config: { subtype: 'manual' },
          ui: { x: 0, y: 80 },
        },
        {
          id: 'work',
          kind: 'inference',
          label: 'Work',
          config: { prompt: { template: 'Synthetic work pass {{ gates.gate.passes }}' } },
          ui: { x: 260, y: 80 },
        },
        {
          id: 'gate',
          kind: 'decision',
          label: 'Gate',
          config: {
            kind: 'expression',
            jsonata: '"repeat"',
            routes: [
              { id: 'repeat', label: 'Repeat' },
              { id: 'done', label: 'Done' },
            ],
          },
          ui: { x: 520, y: 80 },
        },
        {
          id: 'done',
          kind: 'exit',
          label: 'Success',
          config: { returns: 'outputs.work.value' },
          ui: { x: 800, y: 80 },
        },
        {
          id: 'exhausted',
          kind: 'exit',
          label: 'Exhausted',
          config: { returns: 'outputs.work.value' },
          ui: { x: 800, y: 320 },
        },
      ],
      edges: [
        { id: 'start-work', from: { node: 'start', port: 'out' }, to: { node: 'work' } },
        { id: 'work-gate', from: { node: 'work', port: 'out' }, to: { node: 'gate' } },
        { id: 'repeat-edge', from: { node: 'gate', port: 'repeat' }, to: { node: 'work' } },
        { id: 'done-edge', from: { node: 'gate', port: 'done' }, to: { node: 'done' } },
      ],
    };
    const created = await request.post(url + '/loops', { data: { definition } });
    expect(created.status()).toBe(201);
    const { loop } = (await created.json()) as { loop: { id: string } };
    await page.goto(url + '/app/loops/' + loop.id + '/edit');
    let dialog = await openNode(page, 'gate');
    await dialog
      .locator('[data-field="routes.0.repeat"]')
      .getByRole('switch', { name: 'Repeat route' })
      .click();
    await expect(dialog.getByLabel('Maximum passes', { exact: true })).toHaveAttribute(
      'aria-required',
      'true',
    );
    await dialog.getByLabel('Maximum passes', { exact: true }).fill('3');
    await dialog.getByLabel('Maximum run time (seconds)', { exact: true }).fill('60');
    await dialog
      .locator('[data-field="jsonata"] [role="textbox"]')
      .fill(finalChoice === 'repeat' ? '"repeat"' : 'gates.gate.passes >= 3 ? "done" : "repeat"');
    await expect(dialog.getByText(/Limit reached is taken/)).toBeVisible();
    const connect = dialog.getByRole('form', { name: 'Connect gate' });
    await connect.getByLabel('Output').selectOption('limit-reached');
    await connect.getByLabel('To').selectOption('exhausted');
    await connect.getByRole('button', { name: 'Connect', exact: true }).click();
    await closeNode(page);
    await expect(
      page.locator('.react-flow__handle[data-nodeid="gate"][data-handleid="limit-reached"]'),
    ).toHaveCount(1);
    dialog = await openNode(page, 'exhausted');
    await dialog.getByRole('radio', { name: 'Exhausted', exact: true }).click();
    await expect(dialog.getByRole('form', { name: 'Connect exhausted' })).toHaveCount(0);
    await closeNode(page);
    await expect(page.getByText('Ready to publish')).toBeVisible();
    await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
    await expect
      .poll(async () => {
        const response = await request.get(url + '/loops/' + loop.id);
        const body = (await response.json()) as { draft: { definition: unknown } };
        const saved = LoopDefinitionSchema.parse(body.draft.definition);
        const gate = saved.nodes.find((n) => n.id === 'gate');
        const exit = saved.nodes.find((n) => n.id === 'exhausted');
        return {
          gate: gate?.kind === 'decision' ? gate.config : undefined,
          exit: exit?.kind === 'exit' ? exit.config : undefined,
          limitTarget: saved.edges.find(
            (edge) => edge.from.node === 'gate' && edge.from.port === 'limit-reached',
          )?.to.node,
        };
      })
      .toMatchObject({
        gate: {
          maxPasses: 3,
          maxRunTimeSeconds: 60,
          routes: [{ id: 'repeat', repeat: true }, { id: 'done' }],
        },
        exit: { outcome: 'exhausted', returns: 'outputs.work.value' },
        limitTarget: 'exhausted',
      });
    await page.reload();
    dialog = await openNode(page, 'gate');
    await expect(dialog.getByLabel('Maximum passes', { exact: true })).toHaveValue('3');
    await expect(dialog.getByLabel('Maximum run time (seconds)', { exact: true })).toHaveValue(
      '60',
    );
    await closeNode(page);
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByText('Published version 1.')).toBeVisible();
    await control(request, '/harness/script', {
      instanceId,
      turns: Array.from({ length: 3 }, () => ({ text: 'synthetic work' })),
    });
    const started = await request.post(url + '/loops/' + loop.id + '/runs', {
      data: { input: {} },
    });
    expect(started.status()).toBe(202);
    const startedBody = (await started.json()) as { run: unknown };
    const runId = RunRecordSchema.parse(startedBody.run).id;
    await expect
      .poll(
        async () =>
          RunRecordSchema.parse(await (await request.get(url + '/runs/' + runId)).json()).status,
      )
      .toBe(finalChoice === 'repeat' ? 'exhausted' : 'succeeded');
    const eventsResponse = await request.get(url + '/runs/' + runId + '/events');
    const body = (await eventsResponse.json()) as { items: unknown[] };
    const decisions = RunEventSchema.array()
      .parse(body.items)
      .filter((e) => e.type === 'decision.made');
    expect(decisions.map((e) => e.gate?.previousPasses)).toEqual([1, 2, 3]);
    expect(decisions.map((e) => e.gate?.passes)).toEqual([2, 3, 3]);
    expect(decisions.at(-1)?.portId).toBe(finalChoice === 'repeat' ? 'limit-reached' : 'done');
    await page.goto(url + '/app/runs/' + runId);
    const timeline = page.getByRole('list', { name: 'Timeline' });
    await timeline.getByText('decision.made').first().click();
    await expect(
      page.getByText('Previous passes', { exact: true }).locator('xpath=following-sibling::dd[1]'),
    ).toHaveText('1');
    await expect(
      page.getByText('Current passes', { exact: true }).locator('xpath=following-sibling::dd[1]'),
    ).toHaveText('2');
    await timeline.getByText('decision.made').last().click();
    await expect(
      page.getByText('Previous passes', { exact: true }).locator('xpath=following-sibling::dd[1]'),
    ).toContainText('3');
    await expect(
      page.getByText('Current passes', { exact: true }).locator('xpath=following-sibling::dd[1]'),
    ).toContainText('3');
    await expect(
      page
        .getByText('Limit stopping repeat', { exact: true })
        .locator('xpath=following-sibling::dd[1]'),
    ).toContainText(finalChoice === 'repeat' ? 'Maximum passes' : 'None');
    await expect(page.getByTestId('run-result')).toContainText('synthetic work');
  });
}
