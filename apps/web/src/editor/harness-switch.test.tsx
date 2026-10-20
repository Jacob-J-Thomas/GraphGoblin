import { EffortSchema, LoopDefinitionSchema, type HarnessId } from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { FakeApi, problem } from '../__fixtures__/fake-api.js';
import { useEditorStore } from './store.js';
import { renderApp } from '../__fixtures__/render.js';

const models = {
  codex: ['gpt-6-luna', 'gpt-6-astra'],
  claude: ['claude-opus-5-5', 'claude-fable-5-1'],
} as const;
async function setup(
  from: HarnessId,
  scenario: string,
  oldEffort = 'minimal',
  prepare?: (api: FakeApi) => void,
) {
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
  if (['owner', 'disabled', 'disabled-loop', 'loop-over-owner'].includes(scenario)) {
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
  if (scenario === 'loop-over-owner')
    api.settingsValues = {
      defaults: { byHarness: { [to]: { model: models[to][0], effort: 'high' } } },
    };
  const source = minimalLoop();
  const definition = LoopDefinitionSchema.parse({
    ...source,
    settings: {
      defaults: {
        byHarness: ['loop', 'disabled-loop', 'loop-over-owner'].includes(scenario)
          ? { [to]: { model: models[to][1], effort: 'low' } }
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
          ...(scenario === 'inherited' ? {} : { model: models[from][1], effort: oldEffort }),
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
  prepare?.(api);
  const loop = api.addLoop(definition);
  const rendered = renderApp(`/loops/${loop.id}/edit`, api);
  fireEvent.click(await screen.findByTestId('node-infer'));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: /^Advanced/ }));
  return { ...rendered, api, loop, dialog, to };
}

for (const from of ['codex', 'claude'] as const) {
  for (const scenario of [
    'owner',
    'loop',
    'loop-over-owner',
    'absent',
    'disabled',
    'disabled-loop',
  ]) {
    it(`switches ${from} using ${scenario} defaults and saves the exact choice`, async () => {
      const { api, loop, dialog, to } = await setup(
        from,
        scenario,
        from === 'claude' ? 'max' : 'minimal',
      );
      fireEvent.click(within(dialog).getByRole('radio', { name: to }));
      const selected = ['owner', 'loop', 'loop-over-owner'].includes(scenario)
        ? models[to][1]
        : models[to][0];
      await waitFor(() =>
        expect(within(dialog).getByLabelText('Model', { exact: true })).toHaveValue(selected),
      );
      const effort =
        scenario === 'owner' || scenario === 'disabled'
          ? 'high'
          : ['loop', 'loop-over-owner', 'disabled-loop'].includes(scenario) || to === 'codex'
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
    await waitFor(() =>
      expect(
        within(dialog).getAllByText(/unchanged/i, { selector: '[role="status"]' }).length,
      ).toBeGreaterThan(0),
    );
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

for (const from of ['codex', 'claude'] as const) {
  it(`keeps ${from} inheritance when switching without waiting for any lookups`, async () => {
    const { dialog, to, queryClient } = await setup(from, 'inherited', undefined, (api) => {
      api.override('GET /settings', () => new Promise<Response>(() => {}));
      api.override('GET /harness/preflight', () => new Promise<Response>(() => {}));
    });
    fireEvent.click(within(dialog).getByRole('radio', { name: to }));
    await waitFor(() => expect(within(dialog).getByRole('radio', { name: to })).toBeChecked());
    expect(within(dialog).getByLabelText('Model', { exact: true })).toHaveValue('');
    expect(within(dialog).getByLabelText('Effort', { exact: true })).toHaveValue('');
    expect(queryClient.getQueryData(['settings'])).toBeUndefined();
  });
}

it('waits for the first Settings and preflight loads before authoring an early switch', async () => {
  let settings!: (response: Response) => void;
  let preflight!: (response: Response) => void;
  const { api, dialog, to } = await setup('codex', 'owner', 'minimal', (api) => {
    api.override(
      'GET /settings',
      () =>
        new Promise<Response>((resolve) => {
          settings = resolve;
        }),
    );
    api.override(
      'GET /harness/preflight',
      () =>
        new Promise<Response>((resolve) => {
          preflight = resolve;
        }),
    );
  });
  fireEvent.click(within(dialog).getByRole('radio', { name: to }));
  expect(within(dialog).getByText(/Waiting for the first/)).toBeVisible();
  expect(within(dialog).getByRole('radio', { name: 'codex' })).toBeChecked();
  act(() => {
    settings(Response.json(api.settingsValues));
    preflight(Response.json({ items: api.preflight }));
  });
  await waitFor(() =>
    expect(within(dialog).getByLabelText('Model', { exact: true })).toHaveValue(models.claude[1]),
  );
  expect(within(dialog).getByLabelText('Effort', { exact: true })).toHaveValue('high');
  expect(within(dialog).queryByText(/Retry.*switch harness again/)).not.toBeInTheDocument();
});

for (const from of ['codex', 'claude'] as const) {
  it(`keeps ${from} inheritance after successful lookups, saves and reopens it`, async () => {
    const { dialog, to, queryClient, api, loop } = await setup(from, 'inherited');
    await waitFor(() => expect(queryClient.getQueryData(['preflight'])).toBeDefined());
    fireEvent.click(within(dialog).getByRole('radio', { name: to }));
    await waitFor(() => expect(within(dialog).getByRole('radio', { name: to })).toBeChecked());
    expect(within(dialog).getByLabelText('Model', { exact: true })).toHaveValue('');
    expect(within(dialog).getByLabelText('Effort', { exact: true })).toHaveValue('');
    const config = useEditorStore
      .getState()
      .definition?.nodes.find((node) => node.id === 'infer')?.config;
    expect(config).not.toHaveProperty('model');
    expect(config).not.toHaveProperty('effort');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() =>
      expect(
        api.calls.some((call) => call.method === 'PUT' && call.path === `/loops/${loop.id}/draft`),
      ).toBe(true),
    );
    fireEvent.click(screen.getByTestId('node-infer'));
    const reopened = screen.getByRole('dialog');
    fireEvent.click(within(reopened).getByRole('button', { name: /^Advanced/ }));
    expect(within(reopened).getByLabelText('Model', { exact: true })).toHaveValue('');
    expect(within(reopened).getByLabelText('Effort', { exact: true })).toHaveValue('');
  });
}

it('keeps the failed catalog settled during a switch and removes its notice on Undo', async () => {
  const { api, dialog, queryClient } = await setup('codex', 'failed');
  await waitFor(() => expect(queryClient.getQueryState(['model-catalog'])?.status).toBe('error'));
  const before = api.calls.filter((call) => call.path === '/model-catalog').length;
  fireEvent.click(within(dialog).getByRole('radio', { name: 'claude' }));
  await within(dialog).findByText(/Validation is unavailable while the catalog/);
  expect(api.calls.filter((call) => call.path === '/model-catalog')).toHaveLength(before);
  expect(within(dialog).getByLabelText('Model', { exact: true })).toHaveAccessibleDescription(
    /Cannot load the model catalog/,
  );
  const harnessField = within(dialog)
    .getByRole('radiogroup', { name: /Harness/ })
    .closest('[data-field]');
  expect(harnessField).toHaveTextContent(/Validation is unavailable/);
  expect(harnessField?.querySelector('svg')).not.toBeNull();
  act(() => useEditorStore.getState().undo());
  expect(
    within(dialog).queryByText(/Validation is unavailable while the catalog/),
  ).not.toBeInTheDocument();
});

it('opening trigger and exit dialogs does not start additional harness lookups', async () => {
  const { dialog, api, queryClient } = await setup('codex', 'absent');
  await waitFor(() => expect(queryClient.isFetching()).toBe(0));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
  for (const id of ['start', 'done']) {
    const before = api.calls.filter((call) =>
      ['/settings', '/harness/preflight', '/model-catalog'].includes(call.path),
    ).length;
    fireEvent.click(screen.getByTestId(`node-${id}`));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Done' }));
    expect(
      api.calls.filter((call) =>
        ['/settings', '/harness/preflight', '/model-catalog'].includes(call.path),
      ),
    ).toHaveLength(before);
  }
});
