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
          config: { type: 'manual' },
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
    // The visible choice card covers its visually hidden radio, so choose it from the keyboard.
    const exhausted = dialog.getByRole('radio', { name: 'Exhausted', exact: true });
    await exhausted.focus();
    await page.keyboard.press('Space');
    await expect(exhausted).toBeChecked();
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
      turns: Array.from({ length: 3 }, () => ({ finalText: 'synthetic work' })),
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
    // Where a loop-back exit said "iteration 3 of 3", the run's top keeps the last gate's pass and
    // stopping limit beside the exit outcome; a returned value needs no configuration note (#129).
    await expect(
      page.getByText(
        finalChoice === 'repeat'
          ? 'Last gate decision: gate chose repeat on pass 3 of 3; maximum passes stopped the repeat, so it took Limit reached.'
          : 'Last gate decision: gate chose done on pass 3 of 3.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByTestId('exit-returns')).toHaveCount(0);
  });
}

/**
 * Exits that return nothing (#129, #258): while Returns is None, destinations receive nothing,
 * and an exit without destinations is a valid quiet exit. The editor says so before publishing,
 * and the finished run says it returned nothing by configuration, not by failure.
 */
for (const shape of ['suppressed', 'quiet'] as const) {
  test(`an exit that returns None is understandable: ${shape}`, async ({ page, request }) => {
    const instance = await control(request, '/apps');
    const url = String(instance['url']);
    const definition: LoopDefinitionInput = {
      schemaVersion: CURRENT_DEFINITION_FORMAT,
      name: `Returns none ${shape}`,
      nodes: [
        {
          id: 'start',
          kind: 'trigger',
          label: 'Start',
          config: { type: 'manual' },
          ui: { x: 0, y: 80 },
        },
        {
          id: 'done',
          kind: 'exit',
          label: 'Done',
          config: { returns: 'none', destinations: [{ kind: 'caller' }, { kind: 'log' }] },
          ui: { x: 300, y: 80 },
        },
      ],
      edges: [{ id: 'start-done', from: { node: 'start', port: 'out' }, to: { node: 'done' } }],
    };
    const created = await request.post(url + '/loops', { data: { definition } });
    expect(created.status()).toBe(201);
    const { loop } = (await created.json()) as { loop: { id: string } };
    await page.goto(url + '/app/loops/' + loop.id + '/edit');
    const dialog = await openNode(page, 'done');
    await expect(
      dialog.getByText(
        'No returned value. The run finishes without a result, and destinations receive nothing.',
      ),
    ).toBeVisible();
    const destinations = dialog.getByRole('group', { name: 'Destinations', exact: true });
    await expect(destinations).toHaveAccessibleDescription(
      'Returns is None, so these 2 destinations receive nothing. Choose a JSONata expression to deliver a value, or remove destinations for a quiet exit.',
    );
    if (shape === 'quiet') {
      for (const row of [2, 1])
        await destinations
          .getByRole('button', { name: `Remove destinations ${row}`, exact: true })
          .click();
      await expect(destinations).toHaveAccessibleDescription(
        'Quiet exit: nothing is returned or delivered. The run still finishes with its outcome.',
      );
    }
    await closeNode(page);
    await expect(page.getByText('Ready to publish')).toBeVisible();
    await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByText('Published version 1.')).toBeVisible();

    const started = await request.post(url + '/loops/' + loop.id + '/runs', {
      data: { input: {} },
    });
    expect(started.status()).toBe(202);
    const runId = RunRecordSchema.parse(((await started.json()) as { run: unknown }).run).id;
    await expect
      .poll(
        async () =>
          RunRecordSchema.parse(await (await request.get(url + '/runs/' + runId)).json()).status,
      )
      .toBe('succeeded');
    const run = RunRecordSchema.parse(await (await request.get(url + '/runs/' + runId)).json());
    expect(run.result).toBeUndefined();
    const events = RunEventSchema.array().parse(
      (
        (await (await request.get(url + '/runs/' + runId + '/events')).json()) as {
          items: unknown[];
        }
      ).items,
    );
    expect(events.filter((e) => e.type.startsWith('return.'))).toEqual([]);

    await page.goto(url + '/app/runs/' + runId);
    const reason =
      shape === 'quiet'
        ? 'Quiet exit: Returns is None and there are no destinations, so nothing was returned or delivered. This is the exit’s configuration, not a failure.'
        : 'No value was returned: Returns is None, so no destination received anything (caller, log from the exit). This is the exit’s configuration, not a failure.';
    await expect(page.getByTestId('exit-returns')).toHaveText(reason);
    await expect(page.getByTestId('run-result')).toHaveCount(0);
    await page.getByRole('list', { name: 'Timeline' }).getByText('exit.evaluated').click();
    await expect(page.getByText(/^Exit outcome:/)).toHaveText(
      `Exit outcome: success. This exit is terminal. ${reason}`,
    );
  });
}

/**
 * A chosen route's label can be 120 characters with no break opportunity. At 768 px the inspector
 * keeps its width and wraps the whole label inside the details, instead of widening the page and
 * squeezing the other detail rows (#129 review).
 */
test('a maximum-length route label wraps in the 768 px inspector', async ({ page, request }) => {
  const instance = await control(request, '/apps');
  const url = String(instance['url']);
  const longLabel = 'L'.repeat(120);
  const definition: LoopDefinitionInput = {
    schemaVersion: CURRENT_DEFINITION_FORMAT,
    name: 'Long route label',
    nodes: [
      { id: 'start', kind: 'trigger', label: 'Start', config: { type: 'manual' } },
      {
        id: 'pick',
        kind: 'decision',
        label: 'Pick',
        config: {
          kind: 'expression',
          jsonata: '"long"',
          routes: [
            { id: 'long', label: longLabel },
            { id: 'short', label: 'Short' },
          ],
        },
      },
      { id: 'done', kind: 'exit', label: 'Done', config: { returns: '"done"' } },
      { id: 'other', kind: 'exit', label: 'Other', config: {} },
    ],
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'pick' } },
      { id: 'e2', from: { node: 'pick', port: 'long' }, to: { node: 'done' } },
      { id: 'e3', from: { node: 'pick', port: 'short' }, to: { node: 'other' } },
    ],
  };
  const created = await request.post(url + '/loops', { data: { definition } });
  expect(created.status()).toBe(201);
  const { loop } = (await created.json()) as { loop: { id: string } };
  expect((await request.post(url + '/loops/' + loop.id + '/publish')).status()).toBe(200);
  const started = await request.post(url + '/loops/' + loop.id + '/runs', { data: { input: {} } });
  expect(started.status()).toBe(202);
  const runId = RunRecordSchema.parse(((await started.json()) as { run: unknown }).run).id;
  await expect
    .poll(
      async () =>
        RunRecordSchema.parse(await (await request.get(url + '/runs/' + runId)).json()).status,
    )
    .toBe('succeeded');

  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto(url + '/app/runs/' + runId);
  await page.getByRole('list', { name: 'Timeline' }).getByText('decision.made').click();
  const term = (name: string) =>
    page.getByText(name, { exact: true }).locator('xpath=following-sibling::dd[1]');
  const label = term('Label');
  await expect(label).toBeVisible();
  await expect(label).toHaveText(longLabel);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(768);
  const box = await label.boundingBox();
  if (!box) throw new Error('The label has no box.');
  expect(box.x + box.width).toBeLessThanOrEqual(768);
  // Wrapped, not clipped: the whole label is laid out on several lines inside the details.
  expect(await label.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(box.height).toBeGreaterThan(30);
  // The other rows keep readable widths: the selected port stays on one line.
  const port = await term('Selected port').boundingBox();
  if (!port) throw new Error('The selected port has no box.');
  expect(port.height).toBeLessThan(30);
});
