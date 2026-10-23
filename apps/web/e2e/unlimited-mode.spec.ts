import { approvalLoop, closeNode, expect, openNode, showLoopPanel, test } from './fixtures.js';

test('visible defaults and explicit unlimited persist; inspector shows the pin', async ({
  page,
  request,
}) => {
  const created = await request.post('/loops', {
    data: { definition: approvalLoop('WP-F3 limits') },
  });
  expect(created.status()).toBe(201);
  const { loop, draft } = (await created.json()) as { loop: { id: string }; draft: { id: string } };
  await page.goto(`/app/loops/${loop.id}/edit`);
  await showLoopPanel(page);
  await expect(page.getByRole('spinbutton', { name: 'Maximum node visits' })).toHaveValue('10');
  await expect(page.getByRole('combobox', { name: 'Run deadline seconds mode' })).toHaveValue(
    'unlimited',
  );
  await expect(page.getByText(/No deadline; set one/)).toBeVisible();
  await page.getByRole('combobox', { name: 'Run deadline seconds mode' }).selectOption('limited');
  await expect(page.getByRole('spinbutton', { name: 'Run deadline seconds' })).toHaveValue('3600');
  await page.getByRole('spinbutton', { name: 'Run deadline seconds' }).fill('');
  await page.getByRole('spinbutton', { name: 'Run deadline seconds' }).fill('5');
  await expect
    .poll(async () => {
      const response = await request.get(`/loops/${loop.id}`);
      const body = (await response.json()) as {
        draft: { definition: { settings: { runDeadlineSeconds: number | null } } };
      };
      return body.draft.definition.settings.runDeadlineSeconds;
    })
    .toBe(5);
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      response.url().endsWith(`/loops/${loop.id}/draft`) &&
      response.ok(),
  );
  await page.getByRole('combobox', { name: 'Maximum node visits mode' }).selectOption('unlimited');
  await saved;
  const savedDeadline = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      response.url().endsWith(`/loops/${loop.id}/draft`) &&
      response.ok(),
  );
  await page.getByRole('combobox', { name: 'Run deadline seconds mode' }).selectOption('unlimited');
  await savedDeadline;
  await page.reload();
  await showLoopPanel(page);
  await expect(page.getByRole('combobox', { name: 'Maximum node visits mode' })).toHaveValue(
    'unlimited',
  );
  await expect(page.getByRole('combobox', { name: 'Run deadline seconds mode' })).toHaveValue(
    'unlimited',
  );
  const started = await request.post(`/loops/${loop.id}/runs`, {
    data: { allowDraft: true, versionId: draft.id },
  });
  expect(started.status()).toBe(202);
  const { run } = (await started.json()) as { run: { id: string } };
  await page.goto(`/app/runs/${run.id}`);
  await expect(page.getByText('Maximum node visits: Unlimited. Run deadline: none.')).toBeVisible();
  await request.post(`/runs/${run.id}/cancel`, { data: {} });
  await page.goto('/app/settings');
  await expect(
    page.getByText(/Maximum node visits: 10. No run deadline unless the loop sets one/),
  ).toBeVisible();
});

test('a repeat gate persists Unlimited passes through the node editor', async ({
  page,
  request,
}) => {
  const definition = approvalLoop('WP-F3 unlimited gate');
  const created = await request.post('/loops', {
    data: {
      definition: {
        ...definition,
        nodes: [
          definition.nodes[0],
          {
            id: 'pick',
            kind: 'decision',
            label: 'Pick',
            ui: { x: 260, y: 80 },
            config: {
              kind: 'expression',
              jsonata: '"done"',
              maxPasses: 3,
              routes: [
                { id: 'again', label: 'Again', repeat: true },
                { id: 'done', label: 'Done' },
              ],
            },
          },
          definition.nodes[2],
        ],
        edges: [
          { id: 'start-pick', from: { node: 'start', port: 'out' }, to: { node: 'pick' } },
          { id: 'again', from: { node: 'pick', port: 'again' }, to: { node: 'pick' } },
          { id: 'done', from: { node: 'pick', port: 'done' }, to: { node: 'done' } },
          { id: 'limit', from: { node: 'pick', port: 'limit-reached' }, to: { node: 'done' } },
        ],
      },
    },
  });
  expect(created.status()).toBe(201);
  const { loop } = (await created.json()) as { loop: { id: string } };
  await page.goto(`/app/loops/${loop.id}/edit`);
  await openNode(page, 'pick');
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      response.url().endsWith(`/loops/${loop.id}/draft`) &&
      response.ok(),
  );
  await page.getByRole('combobox', { name: 'Maximum passes mode' }).selectOption('unlimited');
  await saved;
  await closeNode(page);
  await page.reload();
  await openNode(page, 'pick');
  await expect(page.getByRole('combobox', { name: 'Maximum passes mode' })).toHaveValue(
    'unlimited',
  );
  await expect(page.getByText(/this guardrail will not stop execution/)).toBeVisible();
});
