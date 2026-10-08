import { createHmac } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import { expect, openNode, test } from './fixtures.js';

interface DraftNode {
  id: string;
  kind: string;
  config: Record<string, unknown>;
}

interface DeliveryEvent {
  id: string;
  ownerId: string;
  type: string;
  payload: unknown;
  source: string;
  receivedAt: string;
  runIds: string[];
  delivery?: {
    state: 'filtered' | 'deduplicated' | 'pending' | 'admitted' | 'failed';
    attempts: number;
    nextAttemptAt?: string;
    failureCode?: string;
  };
}

function triggerLoop(name: string) {
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
      { id: 'done', kind: 'exit', label: 'Done', config: {}, ui: { x: 260, y: 80 } },
    ],
    edges: [{ id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'done' } }],
  };
}

async function createTriggerLoop(request: APIRequestContext, name: string): Promise<string> {
  const response = await request.post('/loops', { data: { definition: triggerLoop(name) } });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { loop: { id: string } }).loop.id;
}

async function triggerConfig(
  request: APIRequestContext,
  loopId: string,
): Promise<Record<string, unknown>> {
  const response = await request.get(`/loops/${loopId}`);
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as {
    draft: { definition: { nodes: DraftNode[] } };
  };
  const node = body.draft.definition.nodes.find((candidate) => candidate.id === 'start');
  if (!node || node.kind !== 'trigger') throw new Error('The saved start trigger is missing.');
  return node.config;
}

async function events(request: APIRequestContext): Promise<DeliveryEvent[]> {
  const response = await request.get('/events');
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { items: DeliveryEvent[] }).items;
}

function signBody(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

test('body-signed GitHub preset saves, admits a matching hook, and deduplicates a reused delivery key', async ({
  page,
  request,
}, testInfo) => {
  const marker = `preset-${testInfo.workerIndex}-${testInfo.repeatEachIndex}`;
  const loopId = await createTriggerLoop(request, `GitHub preset ${marker}`);
  const secretRef = `${marker}-signing-key`;
  const secretValue = `${marker}-synthetic-secret`;
  const patternMessages: string[] = [];
  page.on('console', (message) => {
    if (/pattern|regular expression/i.test(message.text())) patternMessages.push(message.text());
  });

  await page.goto(`/app/loops/${loopId}/edit`);
  const dialog = await openNode(page, 'start');
  const setup = dialog.getByRole('form', { name: 'GitHub preset setup' });
  await setup.getByLabel('Preset', { exact: true }).selectOption('issues-labeled');
  const invalidPatterns = await dialog.locator('input[pattern]').evaluateAll((inputs) =>
    inputs.flatMap((input) => {
      const pattern = input.getAttribute('pattern') ?? '';
      try {
        new RegExp(pattern, 'v');
        return [];
      } catch {
        return [pattern];
      }
    }),
  );
  expect(invalidPatterns).toEqual([]);
  await setup.getByLabel('Repository owner', { exact: true }).fill('octo-team');
  await setup.getByLabel('Repository', { exact: true }).fill('fixture-repo');
  await setup.getByLabel('Issue label', { exact: true }).fill('ready');
  await setup.getByLabel('Signing secret name', { exact: true }).fill(`${marker}-initial-secret`);
  await dialog.getByRole('button', { name: 'Apply GitHub preset' }).click();
  await expect(dialog.getByLabel('Subtype').locator('option:checked')).toHaveText('webhook (body)');
  await dialog.getByLabel('Secret ref').fill(secretRef);
  await expect(dialog.getByLabel('Replay window seconds')).toHaveCount(0);
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
  await expect
    .poll(() => triggerConfig(request, loopId))
    .toMatchObject({
      subtype: 'webhook',
      signature: { scheme: 'hmac-sha256-body', secretRef },
    });

  await page.reload();
  const restored = await openNode(page, 'start');
  await expect(restored.getByLabel('Subtype').locator('option:checked')).toHaveText(
    'webhook (body)',
  );
  await expect(restored.getByLabel('Secret ref')).toHaveValue(secretRef);
  await expect(restored.getByLabel('Replay window seconds')).toHaveCount(0);
  expect(patternMessages).toEqual([]);
  await restored.getByRole('button', { name: 'Done', exact: true }).click();

  expect(
    (
      await request.put(`/secrets/${secretRef}`, {
        data: { value: secretValue },
      })
    ).status(),
  ).toBe(200);
  expect((await request.post(`/loops/${loopId}/publish`)).status()).toBe(200);
  const endpointResponse = await request.get(`/loops/${loopId}/triggers`);
  expect(endpointResponse.ok()).toBe(true);
  const endpoints = (await endpointResponse.json()) as {
    webhooks: { id: string; path: string; signatureScheme: string }[];
  };
  const endpoint = endpoints.webhooks[0];
  if (!endpoint) throw new Error('Publishing the preset did not create a webhook endpoint.');
  expect(endpoint.signatureScheme).toBe('hmac-sha256-body');

  const deliveryKey = `${marker}-delivery`;
  const firstBody = JSON.stringify({
    action: 'labeled',
    repository: { full_name: 'octo-team/fixture-repo' },
    issue: { number: 17, title: `${marker} first body` },
    label: { name: 'ready' },
  });
  const send = (body: string) =>
    request.post(endpoint.path, {
      data: body,
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signBody(secretValue, body),
        'x-github-delivery': deliveryKey,
      },
    });

  const accepted = await send(firstBody);
  expect(accepted.status()).toBe(202);
  const secondBody = JSON.stringify({
    action: 'labeled',
    repository: { full_name: 'octo-team/fixture-repo' },
    issue: { number: 17, title: `${marker} updated body` },
    label: { name: 'ready' },
  });
  const duplicate = await send(secondBody);
  expect(duplicate.status()).toBe(409);
  expect(await duplicate.json()).toMatchObject({ code: 'DUPLICATE_KEY' });

  const source = `webhook:${endpoint.id}`;
  await expect
    .poll(async () =>
      (await events(request))
        .filter((event) => event.source === source)
        .map((event) => event.delivery?.state),
    )
    .toEqual(['deduplicated', 'admitted']);
  const recorded = (await events(request)).filter((event) => event.source === source);
  const admitted = recorded.find((event) => event.delivery?.state === 'admitted');
  const deduplicated = recorded.find((event) => event.delivery?.state === 'deduplicated');
  expect(admitted?.runIds).toHaveLength(1);
  expect(deduplicated?.runIds).toEqual([]);
  const runsResponse = await request.get(`/runs?loopId=${encodeURIComponent(loopId)}`);
  expect(runsResponse.ok()).toBe(true);
  expect(((await runsResponse.json()) as { items: unknown[] }).items).toHaveLength(1);

  await page.goto('/app/events');
  const rows = page.getByRole('row').filter({ hasText: marker });
  await expect(rows).toHaveCount(2);
  const admittedRow = rows.filter({ hasText: 'Admitted' });
  const deduplicatedRow = rows.filter({ hasText: 'Deduplicated' });
  await expect(admittedRow).toContainText('A run was admitted.');
  await expect(deduplicatedRow).toContainText(
    'A previously used key prevented a run; none was started.',
  );
  const runId = admitted!.runIds[0]!;
  const runLink = admittedRow.getByRole('link', { name: runId, exact: true });
  await expect(runLink).toHaveAttribute('href', `/app/runs/${runId}`);
  await runLink.click();
  await expect(page).toHaveURL(new RegExp(`/app/runs/${runId}$`));
  await expect(page.getByRole('heading', { name: new RegExp(`Run\\s+${runId}`) })).toBeVisible();
});

test('GitHub issue poll preset keeps bounded item settings editable and reloadable without running it', async ({
  page,
  request,
}, testInfo) => {
  const marker = `poll-${testInfo.workerIndex}-${testInfo.repeatEachIndex}`;
  const loopId = await createTriggerLoop(request, `GitHub poll ${marker}`);
  await page.goto(`/app/loops/${loopId}/edit`);
  const dialog = await openNode(page, 'start');
  const setup = dialog.getByRole('form', { name: 'GitHub preset setup' });
  await setup.getByLabel('Preset', { exact: true }).selectOption('issues-poll');
  await setup.getByLabel('Repository owner', { exact: true }).fill('octo-team');
  await setup.getByLabel('Repository', { exact: true }).fill('fixture-repo');
  await setup.getByLabel('Issue label', { exact: true }).fill('ready');
  await dialog.getByRole('button', { name: 'Apply GitHub preset' }).click();

  const items = dialog.locator('[data-field="items"]');
  await expect(items.getByLabel('Select')).toHaveText('probe.json');
  await expect(items.getByLabel('Max runs per poll')).toHaveValue('5');
  await expect(items.getByLabel('Max runs per poll')).toHaveAttribute('min', '1');
  await expect(items.getByLabel('Max runs per poll')).toHaveAttribute('max', '25');
  await expect(items.getByLabel('Per-item dedupe key')).toHaveText(
    '"octo-team/fixture-repo:issue:" & $string(item.number)',
  );
  await items.getByLabel('Max runs per poll').fill('25');
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
  await expect
    .poll(() => triggerConfig(request, loopId))
    .toMatchObject({
      subtype: 'poll',
      items: {
        select: 'probe.json',
        dedupeKey: '"octo-team/fixture-repo:issue:" & $string(item.number)',
        maxRunsPerPoll: 25,
      },
    });
  const saved = await triggerConfig(request, loopId);
  const probe = saved['probe'] as { command?: unknown; args?: unknown };
  expect(probe.command).toBe('node');
  expect(probe.args).toEqual(expect.arrayContaining(['-e', expect.any(String)]));

  await page.reload();
  const restored = await openNode(page, 'start');
  const restoredItems = restored.locator('[data-field="items"]');
  await expect(restoredItems.getByLabel('Max runs per poll')).toHaveValue('25');
  await expect(restoredItems.getByLabel('Per-item dedupe key')).toHaveText(
    '"octo-team/fixture-repo:issue:" & $string(item.number)',
  );
  await expect(restored.getByText('does not call GitHub from this editor')).toBeVisible();
});

test('Events exposes safe labels for all five webhook delivery dispositions', async ({ page }) => {
  const runId = '01J9GITHUBDELIVERYRUN0000000000';
  const base = {
    ownerId: 'local',
    type: 'webhook',
    source: 'webhook:e2e-receipt',
    receivedAt: '2026-10-07T12:00:00.000Z',
  };
  const fixtures: DeliveryEvent[] = [
    {
      ...base,
      id: 'pending-event',
      payload: { marker: 'pending-event' },
      runIds: [],
      delivery: { state: 'pending', attempts: 2, nextAttemptAt: '2026-10-07T12:05:00.000Z' },
    },
    {
      ...base,
      id: 'failed-event',
      payload: { marker: 'failed-event' },
      runIds: [],
      delivery: { state: 'failed', attempts: 4, failureCode: 'ADMISSION_UNAVAILABLE' },
    },
    {
      ...base,
      id: 'admitted-event',
      payload: { marker: 'admitted-event' },
      runIds: [runId],
      delivery: { state: 'admitted', attempts: 1 },
    },
    {
      ...base,
      id: 'deduplicated-event',
      payload: { marker: 'deduplicated-event' },
      runIds: [],
      delivery: { state: 'deduplicated', attempts: 0 },
    },
    {
      ...base,
      id: 'filtered-event',
      payload: { marker: 'filtered-event' },
      runIds: [],
      delivery: { state: 'filtered', attempts: 0 },
    },
  ];
  await page.route('**/events', async (route) => {
    if (route.request().method() !== 'GET' || new URL(route.request().url()).pathname !== '/events')
      return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: fixtures }),
    });
  });
  await page.goto('/app/events');

  const row = (id: string) => page.getByRole('row').filter({ hasText: id });
  await expect(row('pending-event')).toContainText('Pending admission');
  await expect(row('pending-event')).toContainText('Admission failures: 2');
  await expect(row('pending-event')).toContainText('Retry at');
  await expect(row('failed-event')).toContainText('Failure: ADMISSION_UNAVAILABLE');
  await expect(row('failed-event')).toContainText('Admission ended with a safe failure code.');
  await expect(row('admitted-event').getByRole('link', { name: runId })).toHaveAttribute(
    'href',
    `/app/runs/${runId}`,
  );
  await expect(row('deduplicated-event')).toContainText('none');
  await expect(row('filtered-event')).toContainText(
    'No run was started. This authenticated body stays consumed if you later change the filter.',
  );
});
