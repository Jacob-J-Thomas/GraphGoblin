import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { control, expect, openNode, test } from './fixtures.js';

const baseClaudeConfig = {
  harness: 'claude',
  session: { policy: 'fresh' },
  prompt: { template: 'Return the synthetic Claude E2E result.' },
  harnessOptions: { sandbox: 'read-only', approval: 'never' },
};

function inferenceLoop(name: string, harness = 'codex') {
  const source = minimalLoop();
  return {
    ...source,
    name,
    nodes: [
      source.nodes[0]!,
      {
        id: 'infer',
        kind: 'inference',
        label: 'Infer',
        config: {
          ...baseClaudeConfig,
          harness,
          prompt: { template: 'Return the synthetic Claude E2E result.' },
        },
      },
      source.nodes[1]!,
    ].map((node, index) => ({ ...node, ui: { x: index * 260, y: 80 } })),
    edges: [
      { id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'infer' } },
      { id: 'e2', from: { node: 'infer', port: 'out' }, to: { node: 'done' } },
    ],
  };
}

async function claudeInstance(request: Parameters<typeof control>[0]) {
  const created = await control(request, '/apps', { claude: true });
  return {
    id: String(created['instanceId']),
    url: String(created['url']),
  };
}

async function publishAt(
  request: Parameters<typeof control>[0],
  url: string,
  definition: unknown,
): Promise<string> {
  const created = await request.post(url + '/loops', { data: { definition } });
  expect(created.status(), await created.text()).toBe(201);
  const { loop } = (await created.json()) as { loop: { id: string } };
  const published = await request.post(url + '/loops/' + loop.id + '/publish');
  expect(published.status()).toBe(200);
  return loop.id;
}

async function waitForTerminal(
  request: Parameters<typeof control>[0],
  url: string,
  runId: string,
  status: 'succeeded' | 'failed' | 'cancelled',
) {
  await expect
    .poll(
      async () => {
        const response = await request.get(url + '/runs/' + runId);
        const run = (await response.json()) as { status: string };
        return run.status;
      },
      { timeout: 30_000, intervals: [250, 500, 1000] },
    )
    .toBe(status);
}

test('Claude inference selection stays family-specific through publish and run', async ({
  page,
  request,
}) => {
  const instance = await claudeInstance(request);
  const settings = await request.put(instance.url + '/settings', {
    data: {
      defaults: {
        byHarness: {
          codex: { model: 'gpt-6-luna', effort: 'low' },
          claude: { model: 'claude-opus-5-5', effort: 'xhigh' },
        },
      },
    },
  });
  expect(settings.status()).toBe(200);

  const created = await request.post(instance.url + '/loops', {
    data: { definition: inferenceLoop('Claude family picker') },
  });
  expect(created.status()).toBe(201);
  const { loop } = (await created.json()) as { loop: { id: string } };

  await page.goto(instance.url + '/app/loops/' + loop.id + '/edit');
  const dialog = await openNode(page, 'infer');
  const claude = dialog.getByRole('radio', { name: 'claude', exact: true });
  await claude.focus();
  await page.keyboard.press('Space');
  await expect(claude).toBeChecked();
  await expect(dialog.getByLabel('Model', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('Effort', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('Sandbox and approval policy', { exact: true })).toHaveValue('0');
  await dialog.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Published version 1.')).toBeVisible();
  const saved = await request.get(instance.url + '/loops/' + loop.id);
  const current = (await saved.json()) as { current: { definition: unknown } };
  const authored = LoopDefinitionSchema.parse(current.current.definition).nodes.find(
    (node) => node.id === 'infer',
  );
  expect(authored?.kind).toBe('inference');
  if (authored?.kind !== 'inference') throw new Error('expected an inference node');
  expect(authored.config).toMatchObject({ harness: 'claude' });
  expect(authored.config).not.toHaveProperty('model');
  expect(authored.config).not.toHaveProperty('effort');

  await control(request, '/harness/script', {
    instanceId: instance.id,
    harness: 'claude',
    turns: [{ finalText: 'Synthetic Claude result.' }],
  });
  const before = (await control(request, '/harness/requests', {
    instanceId: instance.id,
    harness: 'claude',
  })) as { started: { model?: string; effort?: string; options: unknown }[] };
  await page.getByRole('link', { name: 'Open in Runs' }).first().click();
  await page.getByRole('button', { name: 'Start run', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/runs\/[0-9A-Z]{26}$/);
  const runId = new URL(page.url()).pathname.split('/').at(-1)!;
  await waitForTerminal(request, instance.url, runId, 'succeeded');

  await expect
    .poll(async () => {
      const result = (await control(request, '/harness/requests', {
        instanceId: instance.id,
        harness: 'claude',
      })) as typeof before;
      return result.started.slice(before.started.length);
    })
    .toMatchObject([
      {
        harness: 'claude',
        model: 'claude-opus-5-5',
        effort: 'xhigh',
        options: { sandbox: 'read-only', approval: 'never' },
      },
    ]);
  await expect(page.locator('[data-status="succeeded"]').first()).toBeVisible();
});

for (const ready of [false, true]) {
  test(`saved Codex model stays labelled on narrow Claude editor with readiness ${ready}`, async ({
    page,
    request,
  }) => {
    const instance = await claudeInstance(request);
    if (!ready)
      await control(request, '/harness/preflight', {
        instanceId: instance.id,
        harness: 'claude',
        state: 'not-ready',
      });
    const definition = inferenceLoop('Retained model');
    const node = definition.nodes.find((item) => item.id === 'infer');
    if (!node || !('config' in node)) throw new Error('missing inference node');
    Object.assign(node.config, {
      model: 'gpt-6-astra',
      effort: 'high',
      harnessOptions: { sandbox: 'workspace-write', approval: 'never' },
    });
    const created = await request.post(instance.url + '/loops', { data: { definition } });
    expect(created.status(), await created.text()).toBe(201);
    const { loop } = (await created.json()) as { loop: { id: string } };
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(instance.url + '/app/loops/' + loop.id + '/edit');
    const dialog = await openNode(page, 'infer');
    const harness = dialog.getByRole('radio', { name: 'claude', exact: true });
    await harness.focus();
    await page.keyboard.press('Space');
    await expect(harness).toBeChecked();
    await expect(harness).toBeFocused();
    const model = dialog.getByLabel('Model', { exact: true });
    await expect(model).toHaveValue('gpt-6-astra');
    await expect(model.locator('option:checked')).toHaveText(/Saved model belongs to Codex/);
    await expect(model.locator('option:checked')).toBeDisabled();
    if (!ready) {
      await expect(model).toHaveAttribute('aria-readonly', 'true');
      await expect(
        dialog
          .getByRole('status')
          .filter({ hasText: 'Claude CLI preflight is not ready; model choices' }),
      ).toBeVisible();
      await control(request, '/harness/preflight', {
        instanceId: instance.id,
        harness: 'claude',
        state: 'ready',
      });
      await dialog.getByRole('button', { name: 'Retry Claude preflight' }).click();
    }
    await expect(model).not.toHaveAttribute('aria-readonly', 'true');
    await model.selectOption('claude-fable-5-1');
    await expect(model).toHaveValue('claude-fable-5-1');
    await expect(dialog.getByLabel('Sandbox and approval policy', { exact: true })).toHaveValue(
      '0',
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
}

test('Settings separates Claude adapter support from CLI readiness and supports Fable', async ({
  page,
  request,
}) => {
  const instance = await claudeInstance(request);
  const controlUrl = String(process.env['GG_E2E_CONTROL_URL']);
  const preflightControl = await request.post(controlUrl + '/harness/preflight', {
    data: { instanceId: instance.id, harness: 'claude', state: 'not-ready' },
  });
  expect(preflightControl.status(), await preflightControl.text()).toBe(200);

  const unknown = await request.post(controlUrl + '/harness/requests', {
    data: { instanceId: 'not-an-e2e-instance', harness: 'claude' },
  });
  expect(unknown.status()).toBe(400);
  expect(await unknown.json()).toMatchObject({
    error: expect.stringContaining('unknown E2E instance'),
  });
  const wrongFamily = await request.post(controlUrl + '/harness/requests', {
    data: { instanceId: instance.id, harness: 'future-harness' },
  });
  expect(wrongFamily.status()).toBe(400);
  expect(await wrongFamily.json()).toMatchObject({
    error: expect.stringContaining('unknown E2E harness'),
  });

  const preflightResponse = await request.get(instance.url + '/harness/preflight');
  expect(preflightResponse.status(), await preflightResponse.text()).toBe(200);

  await page.goto(instance.url + '/app/settings');
  const preflight = page.getByRole('region', { name: 'Harness preflight' });
  const claudeStatus = preflight.getByRole('listitem').filter({ hasText: 'claude' });
  await expect(claudeStatus.getByText('not ready', { exact: true })).toBeVisible();
  await expect(claudeStatus.getByText('Claude CLI is not signed in.')).toBeVisible();

  const support = claudeStatus.getByRole('list', { name: 'Claude model support' });
  const opus = support.getByRole('listitem').filter({ hasText: 'claude-opus-5-5' });
  const fable = support.getByRole('listitem').filter({ hasText: 'claude-fable-5-1' });
  await expect(opus.getByText('supported by adapter')).toBeVisible();
  await expect(fable.getByText('supported by adapter')).toBeVisible();
  const catalog = page.getByRole('region', { name: 'Model catalog' });
  await expect(catalog.getByRole('switch', { name: 'Enable Claude Fable 5.1' })).toBeChecked();
  await expect(catalog.getByText(/Enabled in catalog; Claude harness not ready/)).toHaveCount(2);

  const model = page.getByLabel('Default model (claude)', { exact: true });
  await expect(model).toBeVisible();
  await expect(model.getByRole('option', { name: /Claude Opus 5\.5/ })).toHaveCount(0);
  await expect(model.getByRole('option', { name: /Fable/ })).toHaveCount(0);
});

test('Claude settings stay pending through refresh and preserve the Codex defaults', async ({
  page,
  request,
}) => {
  const instance = await claudeInstance(request);
  let holdNextGet = false;
  let release!: () => void;
  let announceHeld!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const heldRequest = new Promise<void>((resolve) => {
    announceHeld = resolve;
  });
  await page.route(instance.url + '/settings', async (route) => {
    if (route.request().method() === 'GET' && holdNextGet) {
      holdNextGet = false;
      announceHeld();
      await held;
    }
    await route.continue();
  });

  try {
    await page.goto(instance.url + '/app/settings');
    const claudeModel = page.getByLabel('Default model (claude)', { exact: true });
    const codexEffort = page.getByLabel('Default effort', { exact: true });
    await expect(claudeModel).toBeVisible();
    await expect(codexEffort).toBeVisible();

    holdNextGet = true;
    const saveClaude = page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' && response.url() === instance.url + '/settings',
    );
    await claudeModel.selectOption('claude-opus-5-5');
    expect((await saveClaude).status()).toBe(200);
    await heldRequest;
    await expect(claudeModel).toBeDisabled();
    await expect(codexEffort).toBeDisabled();

    release();
    await expect(claudeModel).toHaveValue('claude-opus-5-5');
    await expect(codexEffort).toBeEnabled();

    const saveCodex = page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' && response.url() === instance.url + '/settings',
    );
    await codexEffort.selectOption('high');
    expect((await saveCodex).status()).toBe(200);
    await expect(codexEffort).toHaveValue('high');

    expect(await (await request.get(instance.url + '/settings')).json()).toMatchObject({
      defaults: {
        byHarness: {
          claude: { model: 'claude-opus-5-5' },
          codex: { effort: 'high' },
        },
      },
    });
  } finally {
    release();
    await page.unroute(instance.url + '/settings');
  }
});

test('Claude inspector shows requested effort and policy artifact, and preserves unconfirmed termination failure', async ({
  page,
  request,
}) => {
  const instance = await claudeInstance(request);
  const defaults = await request.put(instance.url + '/settings', {
    data: {
      defaults: {
        byHarness: { claude: { model: 'claude-opus-5-5', effort: 'xhigh' } },
      },
    },
  });
  expect(defaults.status()).toBe(200);
  const loopId = await publishAt(
    request,
    instance.url,
    inferenceLoop('Claude inspector', 'claude'),
  );
  const policyDetail = {
    requestedModel: 'claude-opus-5-5',
    requestedEffort: 'xhigh',
    effectiveEffort: null,
    sandbox: 'read-only',
    approval: 'never',
    boundary: 'builtin-tools',
    network: 'unconfined',
  };
  await control(request, '/harness/script', {
    instanceId: instance.id,
    harness: 'claude',
    turns: [
      {
        finalText: 'Synthetic transcript with policy evidence.',
        items: [
          {
            id: 'claude-policy',
            type: 'other',
            summary: 'Claude policy',
            detail: policyDetail,
          },
          { id: 'answer', type: 'message', summary: 'Synthetic final answer.' },
        ],
      },
    ],
  });
  const start = await request.post(instance.url + '/loops/' + loopId + '/runs', {
    data: { input: null },
  });
  expect(start.status()).toBe(202);
  const { run } = (await start.json()) as { run: { id: string } };
  await waitForTerminal(request, instance.url, run.id, 'succeeded');
  const thread = (await (
    await request.get(instance.url + '/runs/' + run.id + '/thread')
  ).json()) as { artifacts: { id: string; kind: string }[] };
  const transcript = thread.artifacts.find((artifact) => artifact.kind === 'transcript');
  expect(transcript).toBeDefined();
  const downloaded = await request.get(
    instance.url + '/runs/' + run.id + '/artifacts/' + transcript!.id,
  );
  expect(downloaded.headers()['content-type']).toContain('application/json');
  expect(JSON.parse(await downloaded.text()) as unknown).toEqual([
    {
      id: 'claude-policy',
      type: 'other',
      summary: 'Claude policy',
      detail: policyDetail,
    },
    { id: 'answer', type: 'message', summary: 'Synthetic final answer.' },
  ]);

  await page.goto(instance.url + '/app/runs/' + run.id);
  const progress = page.getByRole('button', { name: /Node progress/ });
  await progress.click();
  await expect(
    page.getByRole('listitem').filter({
      hasText:
        'claude session fresh; model claude-opus-5-5; requested effort xhigh; effective effort not reported',
    }),
  ).toBeVisible();

  await control(request, '/harness/termination', {
    instanceId: instance.id,
    harness: 'claude',
    mode: 'unconfirmed',
  });
  const failedLoop = await publishAt(
    request,
    instance.url,
    inferenceLoop('Claude unconfirmed stop', 'claude'),
  );
  const failedStart = await request.post(instance.url + '/loops/' + failedLoop + '/runs', {
    data: { input: null },
  });
  expect(failedStart.status()).toBe(202);
  const { run: failedRun } = (await failedStart.json()) as { run: { id: string } };
  await expect
    .poll(async () => {
      const eventsResponse = await request.get(instance.url + '/runs/' + failedRun.id + '/events');
      const events = (await eventsResponse.json()) as { items: { type: string }[] };
      return events.items.some((event) => event.type === 'harness.session');
    })
    .toBe(true);
  await page.goto(instance.url + '/app/runs/' + failedRun.id);
  await page.getByRole('button', { name: 'Cancel run' }).click();
  await waitForTerminal(request, instance.url, failedRun.id, 'failed');
  const failed = (await (await request.get(instance.url + '/runs/' + failedRun.id)).json()) as {
    failure?: { code: string; resumable: boolean };
  };
  expect(failed.failure).toMatchObject({
    code: 'HARNESS_TERMINATION_UNCONFIRMED',
    resumable: false,
  });
  const resume = await request.post(instance.url + '/runs/' + failedRun.id + '/resume');
  expect(resume.status()).not.toBe(200);
  await expect(
    page.getByText('Failed: HARNESS_TERMINATION_UNCONFIRMED', { exact: true }),
  ).toBeVisible();

  await control(request, '/harness/termination', {
    instanceId: instance.id,
    harness: 'claude',
    mode: 'confirmed',
  });
  await control(request, '/harness/script', {
    instanceId: instance.id,
    harness: 'claude',
    turns: [{ delayMs: 30_000, finalText: 'Cancelled synthetic result.' }],
  });
  const cancelLoop = await publishAt(
    request,
    instance.url,
    inferenceLoop('Claude confirmed cancel', 'claude'),
  );
  const cancelStart = await request.post(instance.url + '/loops/' + cancelLoop + '/runs', {
    data: { input: null },
  });
  expect(cancelStart.status()).toBe(202);
  const { run: cancelRun } = (await cancelStart.json()) as { run: { id: string } };
  await expect
    .poll(async () => {
      const eventsResponse = await request.get(instance.url + '/runs/' + cancelRun.id + '/events');
      const events = (await eventsResponse.json()) as { items: { type: string }[] };
      return events.items.some((event) => event.type === 'harness.session');
    })
    .toBe(true);
  await page.goto(instance.url + '/app/runs/' + cancelRun.id);
  await page.getByRole('button', { name: 'Cancel run' }).click();
  await waitForTerminal(request, instance.url, cancelRun.id, 'cancelled');
  await expect(page.locator('[data-status="cancelled"]').first()).toBeVisible();
});
