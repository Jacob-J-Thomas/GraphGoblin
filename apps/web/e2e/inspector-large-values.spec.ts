import { RunRecordSchema } from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { approvalLoop, control, expect, test } from './fixtures.js';

/** One unbroken 20,000-character line: the shape that widened the inspector page (#380). */
const LONG = 'v'.repeat(20_000);
/** A wait prompt at most 10,000 characters long is what the run contract accepts. */
const PROMPT = 'v'.repeat(9_000);

function inferenceLoop(name: string, waitBeforeExit = false) {
  const source = minimalLoop();
  const nodes = [
    source.nodes[0]!,
    {
      id: 'work',
      kind: 'inference',
      label: 'Work',
      config: { prompt: { template: 'Produce one long single-line value.' } },
    },
    ...(waitBeforeExit
      ? [
          {
            id: 'approve',
            kind: 'wait',
            label: 'Approve',
            config: { mode: 'input', prompt: 'Approve?' },
          },
        ]
      : []),
    { ...source.nodes[1]!, config: { returns: 'outputs.work.value' } },
  ];
  return {
    ...source,
    name,
    nodes: nodes.map((node, index) => ({ ...node, ui: { x: index * 260, y: 80 } })),
    edges: nodes.slice(1).map((node, index) => ({
      id: `e${index + 1}`,
      from: { node: nodes[index]!.id, port: 'out' },
      to: { node: node.id },
    })),
  };
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`large values stay bounded and the page keeps its width at ${viewport.width} px (#259, #380)`, async ({
    page,
    request,
  }) => {
    const instance = await control(request, '/apps');
    const url = String(instance['url']);
    const instanceId = instance['instanceId'];
    const created = await request.post(url + '/loops', {
      data: { definition: inferenceLoop(`Large values ${viewport.width}`) },
    });
    expect(created.status(), await created.text()).toBe(201);
    const { loop } = (await created.json()) as { loop: { id: string } };
    expect((await request.post(url + '/loops/' + loop.id + '/publish')).status()).toBe(200);
    await control(request, '/harness/script', { instanceId, turns: [{ finalText: LONG }] });
    const started = await request.post(url + '/loops/' + loop.id + '/runs', {
      data: { input: {} },
    });
    expect(started.status()).toBe(202);
    const runId = RunRecordSchema.parse(((await started.json()) as { run: unknown }).run).id;
    await expect
      .poll(
        async () =>
          RunRecordSchema.parse(await (await request.get(url + '/runs/' + runId)).json()).status,
        { timeout: 30_000, intervals: [250, 500, 1000] },
      )
      .toBe('succeeded');

    await page.setViewportSize(viewport);
    await page.goto(url + '/app/runs/' + runId);

    // The result shows its first 4,096 characters (the opening quote and 4,095 of the value);
    // the whole value and an exact download are one click away.
    const result = page.getByTestId('run-result');
    await expect(result).toHaveText(/^"v{4095}…$/);
    await expect(
      page.getByText('Showing the first 4,096 characters of a larger value.', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download Result as JSON' })).toBeVisible();
    await page.getByRole('button', { name: 'Show all of Result' }).click();
    await expect(result).toHaveText(`"${LONG}"`);
    // Once it scrolls, the text is a named region the keyboard can reach.
    await expect(result).toHaveAttribute('role', 'region');
    await expect(result).toHaveAttribute('tabindex', '0');

    // The finished inference node's patch and the full thread carry the long value too, and the
    // progress drawer shows the harness items: with everything open, nothing widens the document.
    const timeline = page.getByRole('list', { name: 'Timeline' });
    await timeline.getByRole('button', { name: /node\.finished work\b/ }).click();
    const diff = page.getByRole('list', { name: 'Patch diff' });
    await expect(diff).toBeVisible();
    await expect(
      diff.getByText('Showing the first 1,024 characters of a larger value.').first(),
    ).toBeVisible();
    await page.getByText('Full thread JSON', { exact: true }).click();
    await expect(page.getByTestId('thread-json')).toHaveText(/…$/);
    await page.getByRole('button', { name: /^Node progress/ }).click();
    await expect(page.getByRole('button', { name: /^Node progress/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    const widths = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth,
      window: window.innerWidth,
    }));
    expect(widths.document).toBeLessThanOrEqual(widths.window);
  });

  test(`a long wait prompt stays bounded and keeps the page width at ${viewport.width} px (#259)`, async ({
    page,
    request,
  }) => {
    const instance = await control(request, '/apps');
    const url = String(instance['url']);
    const loopDefinition = approvalLoop(`Long prompt ${viewport.width}`);
    const wait = loopDefinition.nodes.find((node) => node.id === 'approve')!;
    wait.config = { mode: 'input', prompt: PROMPT };
    const created = await request.post(url + '/loops', { data: { definition: loopDefinition } });
    expect(created.status(), await created.text()).toBe(201);
    const { loop } = (await created.json()) as { loop: { id: string } };
    expect((await request.post(url + '/loops/' + loop.id + '/publish')).status()).toBe(200);
    const started = await request.post(url + '/loops/' + loop.id + '/runs', {
      data: { input: {} },
    });
    expect(started.status()).toBe(202);
    const runId = RunRecordSchema.parse(((await started.json()) as { run: unknown }).run).id;
    await expect
      .poll(
        async () =>
          RunRecordSchema.parse(await (await request.get(url + '/runs/' + runId)).json()).status,
        { timeout: 30_000, intervals: [250, 500, 1000] },
      )
      .toBe('waiting');

    await page.setViewportSize(viewport);
    await page.goto(url + '/app/runs/' + runId);
    const prompt = page.getByLabel('Prompt', { exact: true });
    await expect(prompt).toHaveText(/^v{4096}…$/);
    await expect(
      page.getByText('Showing the first 4,096 of 9,000 characters.', { exact: true }),
    ).toBeVisible();
    const before = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth,
      window: window.innerWidth,
    }));
    expect(before.document).toBeLessThanOrEqual(before.window);
    await page.getByRole('button', { name: 'Show all of Prompt' }).click();
    await expect(page.getByRole('region', { name: 'Prompt' })).toHaveText(PROMPT);
    const after = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth,
      window: window.innerWidth,
    }));
    expect(after.document).toBeLessThanOrEqual(after.window);
  });
}

test('the keyboard stays inside an expanded value that a live event replaces (#259)', async ({
  page,
  request,
}) => {
  const instance = await control(request, '/apps');
  const url = String(instance['url']);
  const instanceId = instance['instanceId'];
  const created = await request.post(url + '/loops', {
    data: { definition: inferenceLoop('Live replacement', true) },
  });
  expect(created.status(), await created.text()).toBe(201);
  const { loop } = (await created.json()) as { loop: { id: string } };
  expect((await request.post(url + '/loops/' + loop.id + '/publish')).status()).toBe(200);
  await control(request, '/harness/script', { instanceId, turns: [{ finalText: LONG }] });
  const started = await request.post(url + '/loops/' + loop.id + '/runs', { data: { input: {} } });
  expect(started.status()).toBe(202);
  const runId = RunRecordSchema.parse(((await started.json()) as { run: unknown }).run).id;
  const run = async () =>
    RunRecordSchema.parse(await (await request.get(url + '/runs/' + runId)).json());
  await expect
    .poll(async () => (await run()).status, { timeout: 30_000, intervals: [250, 500, 1000] })
    .toBe('waiting');

  await page.goto(url + '/app/runs/' + runId);
  // The thread at the wait carries the long value; read it whole, with the keyboard on it.
  await page.getByText('Full thread JSON', { exact: true }).click();
  await page.getByRole('button', { name: 'Show all of Full thread JSON' }).click();
  const region = page.getByRole('region', { name: 'Full thread JSON' });
  await region.focus();
  await expect(region).toBeFocused();

  // Input arrives from elsewhere: the run finishes, the thread at the latest event is a new
  // value, the region collapses, and the keyboard lands on its Show all, never on the body.
  const waiting = (await run()).waiting;
  expect(waiting).toBeDefined();
  const answered = await request.post(url + '/runs/' + runId + '/input', {
    data: { waitId: waiting!.waitId, input: { approved: true } },
  });
  expect(answered.status(), await answered.text()).toBe(200);
  await expect(
    page.getByRole('list', { name: 'Timeline' }).getByText('run.finished'),
  ).toBeVisible();
  const showAll = page.getByRole('button', { name: 'Show all of Full thread JSON' });
  await expect(showAll).toBeVisible();
  await expect(showAll).toBeFocused();
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
  // Tab moves on from the control; nothing is left focusable behind it.
  await page.keyboard.press('Tab');
  await expect(showAll).not.toBeFocused();
  await expect(page.getByTestId('thread-json')).not.toHaveAttribute('tabindex', /.*/);
});
