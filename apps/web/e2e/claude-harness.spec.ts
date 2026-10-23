import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { control, expect, openAdvanced, openNode, test } from './fixtures.js';

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
  await openAdvanced(dialog);
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
  expect(authored.config.harness).toBe('claude');
  expect(authored.config).not.toHaveProperty('model');
  expect(authored.config).not.toHaveProperty('effort');
  await page.reload();
  const reopened = await openNode(page, 'infer');
  await openAdvanced(reopened);
  await expect(reopened.getByLabel('Model', { exact: true })).toHaveValue('');
  await expect(reopened.getByLabel('Effort', { exact: true })).toHaveValue('');
  await reopened.getByRole('button', { name: 'Done', exact: true }).click();

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

for (const [model, displayName, effort] of [
  ['claude-sonnet-5-5', 'Claude Sonnet 5.5', 'max'],
  ['claude-haiku-5-5', 'Claude Haiku 5.5', 'low'],
] as const) {
  test(`${displayName} selection and effort survive save and reopen and reach the adapter request`, async ({
    page,
    request,
  }) => {
    const instance = await claudeInstance(request);
    const created = await request.post(instance.url + '/loops', {
      data: { definition: inferenceLoop(displayName + ' picker', 'claude') },
    });
    expect(created.status(), await created.text()).toBe(201);
    const { loop } = (await created.json()) as { loop: { id: string } };

    await page.goto(instance.url + '/app/loops/' + loop.id + '/edit');
    const dialog = await openNode(page, 'infer');
    // Model and effort currently sit under Advanced; #205 owns their placement.
    await openAdvanced(dialog);
    const modelField = dialog.getByLabel('Model', { exact: true });
    await expect(modelField).not.toHaveAttribute('aria-readonly', 'true');
    await expect(
      modelField.getByRole('option', { name: `${displayName} (${model})` }),
    ).toBeEnabled();
    await modelField.selectOption(model);
    await expect(modelField).toHaveValue(model);
    const effortField = dialog.getByLabel('Effort', { exact: true });
    // Exactly the catalog's supported efforts for this model; minimal is never offered for Claude.
    await expect(effortField.locator('option')).toHaveText([
      '(inherited; the catalog suggests high)',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    await effortField.selectOption(effort);
    await expect(effortField).toHaveValue(effort);
    await dialog.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByText('Published version 1.')).toBeVisible();

    const saved = await request.get(instance.url + '/loops/' + loop.id);
    const current = (await saved.json()) as { current: { definition: unknown } };
    const authored = LoopDefinitionSchema.parse(current.current.definition).nodes.find(
      (node) => node.id === 'infer',
    );
    expect(authored?.config).toMatchObject({ harness: 'claude', model, effort });

    await page.reload();
    const reopened = await openNode(page, 'infer');
    await openAdvanced(reopened);
    await expect(reopened.getByLabel('Model', { exact: true })).toHaveValue(model);
    await expect(reopened.getByLabel('Effort', { exact: true })).toHaveValue(effort);
    await reopened.getByRole('button', { name: 'Done' }).click();

    await control(request, '/harness/script', {
      instanceId: instance.id,
      harness: 'claude',
      turns: [{ finalText: 'Synthetic Claude result.' }],
    });
    const started = await request.post(instance.url + '/loops/' + loop.id + '/runs', {
      data: { input: null },
    });
    expect(started.status()).toBe(202);
    const { run } = (await started.json()) as { run: { id: string } };
    await waitForTerminal(request, instance.url, run.id, 'succeeded');
    expect(
      await control(request, '/harness/requests', { instanceId: instance.id, harness: 'claude' }),
    ).toMatchObject({
      started: [
        {
          harness: 'claude',
          model,
          effort,
          options: { sandbox: 'read-only', approval: 'never' },
        },
      ],
    });

    // An unsupported effort for this model is refused at authoring and never reaches the adapter.
    const unsupported = inferenceLoop(displayName + ' unsupported', 'claude');
    const node = unsupported.nodes.find((item) => item.id === 'infer');
    if (!node || !('config' in node)) throw new Error('missing inference node');
    Object.assign(node.config, { model, effort: 'minimal' });
    for (const [method, url] of [
      ['post', instance.url + '/loops'],
      ['put', instance.url + '/loops/' + loop.id + '/draft'],
    ] as const) {
      const refused = await request[method](url, { data: { definition: unsupported } });
      expect(refused.status()).toBe(400);
      expect(await refused.text()).toContain('EFFORT_UNSUPPORTED');
    }
    expect(
      await control(request, '/harness/requests', { instanceId: instance.id, harness: 'claude' }),
    ).toMatchObject({ started: [{ model, effort }] });
  });
}

for (const ready of [false, true]) {
  test(`explicit harness switch on narrow editor with readiness ${ready}`, async ({
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
    await openAdvanced(dialog);
    const harness = dialog.getByRole('radio', { name: 'claude', exact: true });
    await harness.focus();
    await page.keyboard.press('Space');
    await expect(harness).toBeChecked();
    await expect(harness).toBeFocused();
    const model = dialog.getByLabel('Model', { exact: true });
    if (!ready) {
      await expect(model).toHaveValue('gpt-6-astra');
      await expect(model.locator('option:checked')).toHaveText(/Saved model belongs to Codex/);
      await expect(model.locator('option:checked')).toBeDisabled();
      await expect(model).toHaveAttribute('aria-readonly', 'true');
      await expect(
        dialog.getByRole('status').filter({
          hasText:
            'Claude is not signed in. Run claude auth login, then retry preflight. Model choices are read-only until Claude is ready.',
        }),
      ).toBeVisible();
      await control(request, '/harness/preflight', {
        instanceId: instance.id,
        harness: 'claude',
        state: 'ready',
      });
      await dialog.getByRole('button', { name: 'Retry Claude preflight' }).click();
    }
    await expect(model).not.toHaveAttribute('aria-readonly', 'true');
    if (!ready) {
      // Query recovery does not perform an authoring action. Switch explicitly again.
      await expect(model).toHaveValue('gpt-6-astra');
      await dialog.getByRole('radio', { name: 'codex', exact: true }).focus();
      await page.keyboard.press('Space');
      await harness.focus();
      await page.keyboard.press('Space');
    }
    await expect(model).toHaveValue('claude-opus-5-5');
    await expect(dialog.getByLabel('Effort', { exact: true })).toHaveValue('high');
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

test('a ready Claude model field stays editable while a focus refetch rechecks readiness', async ({
  page,
  request,
}) => {
  const instance = await claudeInstance(request);
  const definition = inferenceLoop('Focus recheck', 'claude');
  const node = definition.nodes.find((item) => item.id === 'infer');
  if (!node || !('config' in node)) throw new Error('missing inference node');
  Object.assign(node.config, { model: 'claude-opus-5-5' });
  const created = await request.post(instance.url + '/loops', { data: { definition } });
  expect(created.status(), await created.text()).toBe(201);
  const { loop } = (await created.json()) as { loop: { id: string } };
  let held = false;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let arrived!: () => void;
  const heldRequest = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  await page.route(instance.url + '/harness/preflight', async (route) => {
    if (held) {
      arrived();
      await pending;
    }
    await route.continue();
  });
  await page.goto(instance.url + '/app/loops/' + loop.id + '/edit');
  const dialog = await openNode(page, 'infer');
  await openAdvanced(dialog);
  const model = dialog.getByLabel('Model', { exact: true });
  await expect(model).toBeVisible();
  await expect(model).toHaveValue('claude-opus-5-5');
  await expect(model).not.toHaveAttribute('aria-readonly');
  const label = await model.locator('option:checked').textContent();
  expect(label).toMatch(/claude-opus-5-5/);

  held = true;
  // Window focus refetches stale queries (two-second stale time) on a hidden-to-visible change.
  await page.waitForTimeout(2100);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    Reflect.deleteProperty(document, 'visibilityState');
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
  });
  await heldRequest;
  await expect(model).not.toHaveAttribute('aria-readonly');
  await expect(model.locator('option:checked')).toHaveText(label ?? '');
  await expect(dialog.getByText(/Checking Claude readiness|readiness unknown/)).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Retry Claude preflight' })).toHaveCount(0);
  release();
  held = false;
  await expect(model).not.toHaveAttribute('aria-readonly');
  await expect(model).toHaveValue('claude-opus-5-5');
});

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
  const claudeStatus = preflight
    .getByRole('listitem')
    .filter({ has: page.locator('code').getByText('claude', { exact: true }) });
  await expect(claudeStatus.locator('[data-state]')).toHaveAttribute('data-state', 'auth');
  await expect(claudeStatus.locator('[data-state]')).toHaveText('Sign-in needed');
  await expect(
    claudeStatus.getByText(
      'Claude is not signed in. Run claude auth login, then retry preflight.',
      {
        exact: true,
      },
    ),
  ).toBeVisible();

  const support = claudeStatus.getByRole('list', { name: 'Claude model support' });
  const catalog = page.getByRole('region', { name: 'Model catalog' });
  for (const [model, displayName] of [
    ['claude-opus-5-5', 'Claude Opus 5.5'],
    ['claude-fable-5-1', 'Claude Fable 5.1'],
    ['claude-sonnet-5-5', 'Claude Sonnet 5.5'],
    ['claude-haiku-5-5', 'Claude Haiku 5.5'],
  ] as const) {
    const row = support.getByRole('listitem').filter({ hasText: model });
    await expect(row.getByText('listed by adapter', { exact: true })).toBeVisible();
    await expect(catalog.getByRole('switch', { name: 'Enable ' + displayName })).toBeChecked();
  }
  await expect(
    catalog.getByText('Enabled in catalog. Claude readiness: Sign-in needed.', { exact: true }),
  ).toHaveCount(4);

  const model = page.getByLabel('Default model (claude)', { exact: true });
  await expect(model).toBeVisible();
  await expect(model).toHaveAccessibleDescription(
    'Claude readiness: Sign-in needed. See Harness preflight below.',
  );
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
  const execution = (await (
    await request.get(instance.url + '/runs/' + run.id + '/events')
  ).json()) as {
    items: { type: string; visitId?: string; turnId?: string; submission?: string }[];
  };
  const turn = execution.items.find((event) => event.type === 'harness.turn');
  const acceptance = execution.items.find((event) => event.type === 'harness.submission');
  expect(turn?.visitId).toBeTruthy();
  expect(turn?.turnId).toBeTruthy();
  expect(acceptance).toMatchObject({
    visitId: turn!.visitId,
    turnId: turn!.turnId,
    submission: 'submitted',
  });
  const timeline = page.getByRole('list', { name: 'Timeline' });
  const turnRow = timeline.getByRole('button', { name: /harness\.turn/ });
  await turnRow.click();
  await expect(turnRow).toHaveAttribute('aria-current', 'true');
  const acceptanceRow = timeline.getByRole('button', { name: /harness\.submission/ });
  await acceptanceRow.click();
  await expect(acceptanceRow).toHaveAttribute('aria-current', 'true');
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

for (const ready of [false, true]) {
  test(`loaded saved incompatible model is retained without a switch, readiness ${ready}`, async ({
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
    const definition = inferenceLoop('Loaded incompatible');
    const inference = definition.nodes.find((node) => node.id === 'infer')!;
    Object.assign(inference.config, { model: 'gpt-6-astra', effort: 'high' });
    const created = await request.post(instance.url + '/loops', { data: { definition } });
    expect(created.status()).toBe(201);
    const { loop } = (await created.json()) as { loop: { id: string } };
    await page.route(`**/loops/${loop.id}`, async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as {
        draft?: { definition: unknown };
        current?: { definition: unknown };
      };
      const version = body.draft ?? body.current;
      if (!version) throw new Error('Missing loaded version fixture');
      const definition = LoopDefinitionSchema.parse(version.definition);
      const loaded = definition.nodes.find((node) => node.id === 'infer');
      if (loaded?.kind !== 'inference') throw new Error('Missing loaded inference fixture');
      loaded.config.harness = 'claude';
      version.definition = definition;
      await route.fulfill({ response, json: body });
    });
    await page.goto(instance.url + '/app/loops/' + loop.id + '/edit');
    const dialog = await openNode(page, 'infer');
    await openAdvanced(dialog);
    const model = dialog.getByLabel('Model', { exact: true });
    await expect(model).toHaveValue('gpt-6-astra');
    await expect(model.locator('option:checked')).toHaveText(/Saved model belongs to Codex/);
    await expect(model.locator('option:checked')).toBeDisabled();
  });
}
