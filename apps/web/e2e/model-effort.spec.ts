import { LoopDefinitionSchema } from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { test, expect, control, openNode, closeNode } from './fixtures.js';

for (const kind of ['inference', 'llm'] as const) {
  for (const level of ['explicit', 'loop', 'Settings', 'ecosystem', 'process'] as const) {
    test(`${kind} ${level} effort survives editing, save, reload and adapter request`, async ({
      page,
      request,
    }) => {
      const instance = await control(request, '/apps', {
        env:
          level === 'process'
            ? {
                GG_DEFAULTS: JSON.stringify({
                  byHarness: { codex: { model: 'gpt-6.1-sol', effort: 'high' } },
                }),
              }
            : {},
      });
      const url = String(instance['url']);
      const instanceId = String(instance['instanceId']);
      const defaults = { byHarness: { codex: { model: 'gpt-6.1-sol', effort: 'high' } } };
      if (level === 'Settings')
        expect((await request.put(url + '/settings', { data: { defaults } })).status()).toBe(200);
      const source = minimalLoop();
      const definition = LoopDefinitionSchema.parse({
        ...source,
        name: `205 ${kind} ${level}`,
        settings: { ...source.settings, ...(level === 'loop' ? { defaults } : {}) },
        nodes: [
          source.nodes[0],
          {
            id: 'work',
            label: 'Work',
            kind: kind === 'inference' ? kind : 'decision',
            ui: { x: 260, y: 80 },
            config:
              kind === 'inference'
                ? { prompt: { template: 'Choose' } }
                : {
                    kind: 'llm',
                    harness: 'codex',
                    instructions: 'Choose',
                    model: { mode: 'inherit' },
                    effort: { mode: 'inherit' },
                    routes: [
                      { id: 'yes', label: 'Yes' },
                      { id: 'no', label: 'No' },
                    ],
                  },
          },
          source.nodes[1],
        ],
        edges: [
          { id: 'start-work', from: { node: 'start', port: 'out' }, to: { node: 'work' } },
          ...(kind === 'inference' ? ['out'] : ['yes', 'no']).map((port) => ({
            id: port,
            from: { node: 'work', port },
            to: { node: 'done' },
          })),
        ],
      });
      const created = await request.post(url + '/loops', { data: { definition } });
      expect(created.status()).toBe(201);
      const { loop } = (await created.json()) as { loop: { id: string } };
      await page.goto(url + `/app/loops/${loop.id}/edit`);
      const dialog = await openNode(page, 'work');
      const effort = dialog.getByLabel('Effort', { exact: true });
      const inherited = ['loop', 'Settings', 'process'].includes(level) ? 'high' : 'low';
      await expect(effort.locator('option').first()).toHaveText(`Default (${inherited})`);
      await expect(effort).toBeVisible();
      await expect(dialog.getByRole('group', { name: 'Effort', exact: true })).toHaveCount(0);
      // Exercise both transitions: Default must discard the explicit value rather than pin it.
      await effort.selectOption('high');
      if (level !== 'explicit') await effort.selectOption('');
      const expectedEffort = level === 'explicit' ? 'high' : inherited;
      const expectedModel = ['loop', 'Settings', 'process'].includes(level)
        ? 'gpt-6.1-sol'
        : 'gpt-6-luna';
      if (kind === 'llm')
        await expect(
          dialog.getByText(`Default model: ${expectedModel}`, { exact: true }),
        ).toBeVisible();
      else
        await expect(
          dialog.getByLabel('Model', { exact: true }).locator('option').first(),
        ).toHaveText(`(loop default) (${expectedModel})`);
      if (level === 'loop') {
        await effort.scrollIntoViewIfNeeded();
        await page.screenshot({ path: `../../docs/qa/2026-10-23-wp-f2b-205/after-${kind}.png` });
      }
      await closeNode(page);
      await page.getByRole('button', { name: 'Publish', exact: true }).click();
      await expect(page.getByText('Published version 1.')).toBeVisible();
      await page.reload();
      const reopened = await openNode(page, 'work');
      await expect(reopened.getByLabel('Effort', { exact: true })).toHaveValue(
        level === 'explicit' ? 'high' : '',
      );
      await closeNode(page);
      const saved = await request.get(url + `/loops/${loop.id}`);
      const data = (await saved.json()) as { current: { definition: unknown } };
      const config = LoopDefinitionSchema.parse(data.current.definition).nodes.find(
        (node) => node.id === 'work',
      )!.config;
      if (level === 'explicit')
        expect(config).toHaveProperty(
          'effort',
          kind === 'llm' ? { mode: 'explicit', value: 'high' } : 'high',
        );
      else if (kind === 'llm') expect(config).toHaveProperty('effort', { mode: 'inherit' });
      else expect(config).not.toHaveProperty('effort');
      expect(
        (await request.post(url + `/loops/${loop.id}/runs`, { data: { input: null } })).status(),
      ).toBe(202);
      await expect
        .poll(async () => {
          const result = await control(
            request,
            kind === 'llm' ? '/deciders/requests' : '/harness/requests',
            { instanceId },
          );
          return result[kind === 'llm' ? 'routes' : 'started'];
        })
        .toMatchObject([{ model: expectedModel, effort: expectedEffort }]);
    });
  }
}

test('classifier keeps Question, Model, Answer visible and has no effort', async ({
  page,
  request,
}) => {
  const source = minimalLoop();
  const created = await request.post('/loops', {
    data: {
      definition: {
        ...source,
        name: '205 classifier order',
        nodes: [
          source.nodes[0],
          {
            id: 'pick',
            kind: 'decision',
            label: 'Pick',
            ui: { x: 260, y: 80 },
            config: {
              kind: 'classifier',
              model: 'jev',
              question: 'Choose',
              answer: {
                type: 'choice',
                options: [
                  { id: 'yes', label: 'Yes', criteria: 'yes' },
                  { id: 'no', label: 'No', criteria: 'no' },
                ],
              },
            },
          },
          source.nodes[1],
        ],
        edges: [
          { id: 'start-pick', from: { node: 'start', port: 'out' }, to: { node: 'pick' } },
          ...['yes', 'no'].map((port) => ({
            id: port,
            from: { node: 'pick', port },
            to: { node: 'done' },
          })),
        ],
      },
    },
  });
  expect(created.status()).toBe(201);
  const { loop } = (await created.json()) as { loop: { id: string } };
  await page.goto(`/app/loops/${loop.id}/edit`);
  const dialog = await openNode(page, 'pick');
  const fields = dialog.locator('[data-field-scope="config"]');
  for (const name of ['question', 'model', 'answer'])
    await expect(fields.locator(`[data-field="${name}"]`).first()).toBeVisible();
  expect(
    await fields
      .locator('[data-field]')
      .evaluateAll((elements) => [
        ...new Set(
          elements
            .map((element) => element.getAttribute('data-field'))
            .filter((name) => ['question', 'model', 'answer'].includes(name ?? '')),
        ),
      ]),
  ).toEqual(['question', 'model', 'answer']);
  await expect(dialog.getByLabel('Effort', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: '../../docs/qa/2026-10-23-wp-f2b-205/after-classifier.png' });
});

test('a saved unsupported effort stays visible and is refused before the adapter', async ({
  page,
  request,
}) => {
  const instance = await control(request, '/apps');
  const url = String(instance['url']);
  const instanceId = String(instance['instanceId']);
  const entry = {
    instanceId,
    harness: 'codex',
    model: 'effort-limited',
    displayName: 'Limited',
    efforts: ['low', 'high'],
    defaultEffort: 'low',
    enabled: true,
    source: 'harness',
  };
  await control(request, '/catalog/upsert', entry);
  const source = minimalLoop();
  const created = await request.post(url + '/loops', {
    data: {
      definition: {
        ...source,
        name: '205 unsupported effort',
        nodes: [
          source.nodes[0],
          {
            id: 'work',
            kind: 'inference',
            label: 'Work',
            config: { model: entry.model, effort: 'high', prompt: { template: 'q' } },
            ui: { x: 260, y: 80 },
          },
          source.nodes[1],
        ],
        edges: [
          { id: 'start-work', from: { node: 'start', port: 'out' }, to: { node: 'work' } },
          { id: 'work-done', from: { node: 'work', port: 'out' }, to: { node: 'done' } },
        ],
      },
    },
  });
  expect(created.status()).toBe(201);
  const { loop } = (await created.json()) as { loop: { id: string } };
  expect((await request.post(url + `/loops/${loop.id}/publish`)).status()).toBe(200);
  await control(request, '/catalog/upsert', { ...entry, efforts: ['low'] });
  await page.goto(url + `/app/loops/${loop.id}/edit`);
  const dialog = await openNode(page, 'work');
  const effort = dialog.getByLabel('Effort', { exact: true });
  await expect(effort).toHaveValue('high');
  await expect(effort).toHaveAccessibleDescription(/not supported/);
  await expect(effort.locator('option:checked')).toHaveText('high (not supported by this model)');
  await closeNode(page);
  await page.reload();
  await expect((await openNode(page, 'work')).getByLabel('Effort', { exact: true })).toHaveValue(
    'high',
  );
  // Published runs are queued before execution-time model resolution; refusal happens before
  // the provider call, rather than at admission after a catalog capability change.
  const queued = await request.post(url + `/loops/${loop.id}/runs`, { data: { input: null } });
  expect(queued.status()).toBe(202);
  const { run } = (await queued.json()) as { run: { id: string } };
  await expect
    .poll(async () => {
      const response = await request.get(url + `/runs/${run.id}`);
      return (await response.json()) as unknown;
    })
    .toMatchObject({
      status: 'failed',
      failure: {
        code: 'EVALUATION_INVALID_CONFIGURATION',
        details: { code: 'EFFORT_UNSUPPORTED' },
      },
    });
  expect((await control(request, '/harness/requests', { instanceId }))['started']).toEqual([]);
});
