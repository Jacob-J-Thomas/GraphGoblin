import { EffortSchema, LoopDefinitionSchema, type HarnessId } from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { FakeApi, problem } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';

const models = {
  codex: ['gpt-6-luna', 'gpt-6-astra'],
  claude: ['claude-opus-5-5', 'claude-fable-5-1'],
} as const;
async function setup(from: HarnessId, scenario: string, oldEffort = 'minimal') {
  const api = new FakeApi();
  api.catalog = Object.entries(models).flatMap(([harness, entries]) =>
    entries.map((model) => ({
      harness,
      model,
      displayName: model,
      source: 'harness' as const,
      enabled: true,
      efforts: harness === 'claude' ? ['low', 'high'] : ['minimal', 'low', 'high'],
      defaultEffort: harness === 'claude' ? 'high' : 'low',
    })),
  );
  api.preflight = ['codex', 'claude'].map((harness) => ({
    harness,
    state: 'ready',
    ok: true,
    authenticated: true,
    problems: [],
    models: api.catalog
      .filter((entry) => entry.harness === harness)
      .map(({ model, efforts }) => ({
        model,
        efforts: efforts.map((effort) => EffortSchema.parse(effort)),
      })),
  }));
  const to: HarnessId = from === 'codex' ? 'claude' : 'codex';
  if (['owner', 'disabled', 'disabled-loop'].includes(scenario)) {
    api.settingsValues = {
      defaults: { byHarness: { [to]: { model: models[to][1], effort: 'high' } } },
    };
    if (scenario === 'disabled' || scenario === 'disabled-loop')
      api.catalog.find((entry) => entry.model === models[to][1])!.enabled = false;
  }
  if (scenario === 'blocked')
    api.catalog
      .filter((entry) => entry.harness === to)
      .forEach((entry) => {
        entry.enabled = false;
      });
  if (scenario === 'readiness') api.preflight.find((item) => item.harness === to)!.state = 'auth';
  if (scenario === 'invalid-defaults')
    api.settingsValues = { defaults: { byHarness: { [to]: { effort: 'invalid' } } } };
  if (scenario === 'no-effort')
    api.catalog
      .filter((entry) => entry.harness === to)
      .forEach((entry) => {
        entry.defaultEffort = 'medium';
      });
  const source = minimalLoop();
  const definition = LoopDefinitionSchema.parse({
    ...source,
    settings: {
      defaults: {
        byHarness: ['loop', 'owner', 'disabled-loop'].includes(scenario)
          ? { [to]: { model: models[to][0], effort: 'low' } }
          : {},
      },
    },
    nodes: [
      source.nodes[0],
      {
        id: 'infer',
        kind: 'inference',
        label: 'Infer',
        config: {
          harness: from,
          model: models[from][1],
          effort: oldEffort,
          prompt: { template: 'synthetic' },
          harnessOptions: { sandbox: 'read-only', approval: 'never' },
        },
      },
      source.nodes[1],
    ],
    edges: [
      { id: 'a', from: { node: 'start', port: 'out' }, to: { node: 'infer' } },
      { id: 'b', from: { node: 'infer', port: 'out' }, to: { node: 'done' } },
    ],
  });
  if (scenario === 'failed')
    api.override('GET /model-catalog', () => problem(503, 'FAILED', 'catalog unavailable'));
  if (scenario === 'settings-failed')
    api.override('GET /settings', () => problem(503, 'FAILED', 'settings unavailable'));
  const loop = api.addLoop(definition);
  const rendered = renderApp(`/loops/${loop.id}/edit`, api);
  fireEvent.click(await screen.findByTestId('node-infer'));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: /^Advanced/ }));
  if (scenario === 'failed') await within(dialog).findByText(/Cannot load the model catalog/);
  else
    await waitFor(() =>
      expect(within(dialog).getByLabelText('Model', { exact: true })).not.toHaveAttribute(
        'aria-readonly',
      ),
    );
  if (scenario !== 'settings-failed')
    await waitFor(() => expect(rendered.queryClient.getQueryData(['settings'])).toBeDefined());
  return { ...rendered, api, loop, dialog, to };
}

for (const from of ['codex', 'claude'] as const) {
  for (const scenario of ['owner', 'loop', 'absent', 'disabled', 'disabled-loop']) {
    it(`switches ${from} using ${scenario} defaults and saves the exact choice`, async () => {
      const { api, loop, dialog, to } = await setup(
        from,
        scenario,
        from === 'claude' ? 'max' : 'minimal',
      );
      fireEvent.click(within(dialog).getByRole('radio', { name: to }));
      const selected = scenario === 'owner' ? models[to][1] : models[to][0];
      await waitFor(() =>
        expect(within(dialog).getByLabelText('Model', { exact: true })).toHaveValue(selected),
      );
      const effort =
        scenario === 'owner' || scenario === 'disabled' || scenario === 'disabled-loop'
          ? 'high'
          : scenario === 'loop' || scenario === 'disabled-loop' || to === 'codex'
            ? 'low'
            : 'high';
      expect(within(dialog).getByLabelText('Effort', { exact: true })).toHaveValue(effort);
      fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
      await waitFor(() =>
        expect(
          api.calls.some(
            (call) =>
              call.method === 'PUT' &&
              call.path === `/loops/${loop.id}/draft` &&
              JSON.stringify(call.body).includes(selected),
          ),
        ).toBe(true),
      );
      fireEvent.click(screen.getByTestId('node-infer'));
      const reopened = screen.getByRole('dialog');
      fireEvent.click(within(reopened).getByRole('button', { name: /^Advanced/ }));
      expect(within(reopened).getByLabelText('Model', { exact: true })).toHaveValue(selected);
      expect(within(reopened).getByLabelText('Effort', { exact: true })).toHaveValue(effort);
      expect(api.catalog.find((entry) => entry.model === models[to][1])?.enabled).toBe(
        scenario !== 'disabled' && scenario !== 'disabled-loop',
      );
    });
  }
  it(`keeps ${from} authored values when catalog lookup fails`, async () => {
    const { dialog, to } = await setup(from, 'failed', 'high');
    fireEvent.click(within(dialog).getByRole('radio', { name: to }));
    expect(within(dialog).getByLabelText('Model', { exact: true })).toHaveValue(models[from][1]);
    expect(within(dialog).getByLabelText('Effort', { exact: true })).toHaveValue('high');
    await waitFor(() =>
      expect(within(dialog).getByLabelText('Model', { exact: true })).toHaveAccessibleDescription(
        /Cannot load the model catalog/,
      ),
    );
  });
}

it('preserves an effort supported by the new model', async () => {
  const { dialog } = await setup('codex', 'owner', 'low');
  fireEvent.click(within(dialog).getByRole('radio', { name: 'claude' }));
  await waitFor(() =>
    expect(within(dialog).getByLabelText('Model', { exact: true })).toHaveValue(models.claude[1]),
  );
  expect(within(dialog).getByLabelText('Effort', { exact: true })).toHaveValue('low');
});

for (const scenario of [
  'settings-failed',
  'blocked',
  'readiness',
  'invalid-defaults',
  'no-effort',
]) {
  it(`preserves authored values and explains a switch blocked by ${scenario}`, async () => {
    const { dialog, to } = await setup('codex', scenario);
    fireEvent.click(within(dialog).getByRole('radio', { name: to }));
    expect(within(dialog).getByLabelText('Model', { exact: true })).toHaveValue('gpt-6-astra');
    expect(within(dialog).getByLabelText('Effort', { exact: true })).toHaveValue('minimal');
    expect(
      within(dialog).getAllByText(/unchanged/i, { selector: '[role="status"]' }).length,
    ).toBeGreaterThan(0);
  });
}

it('does not apply cached choices after a failed catalog refetch or rewrite on recovery', async () => {
  const { api, queryClient, dialog } = await setup('codex', 'absent');
  api.override('GET /model-catalog', () => problem(503, 'FAILED', 'catalog unavailable'));
  await act(async () => {
    await queryClient.refetchQueries({ queryKey: ['model-catalog'] });
  });
  fireEvent.click(within(dialog).getByRole('radio', { name: 'claude' }));
  expect(within(dialog).getByLabelText('Model', { exact: true })).toHaveValue('gpt-6-astra');
  api.override(
    'GET /model-catalog',
    () =>
      new Response(JSON.stringify({ items: api.catalog }), {
        headers: { 'content-type': 'application/json' },
      }),
  );
  await act(async () => {
    await queryClient.refetchQueries({ queryKey: ['model-catalog'] });
  });
  expect(within(dialog).getByLabelText('Model', { exact: true })).toHaveValue('gpt-6-astra');
  expect(within(dialog).getByLabelText('Model', { exact: true })).toHaveAccessibleDescription(
    /Saved model belongs to Codex/,
  );
});
