import { LoopDefinitionSchema, NodeConfigSchemas } from '@graphgoblin/contracts';
import { minimalLoop } from '@graphgoblin/contracts/testing';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { it, expect, vi } from 'vitest';
import { FakeApi, problem } from '../__fixtures__/fake-api.js';
import { renderApp, renderWith } from '../__fixtures__/render.js';
import { keys } from '../api/queries.js';
import { SchemaForm } from '../forms/SchemaForm.js';
import { DefaultsSection } from '../settings/sections/DefaultsSection.js';
import { NODE_FIELD_CONTROLS } from './field-controls.js';

const inheritedNode = { prompt: { template: 'q' } };
const defaults = (model = 'gpt-6-luna', effort = 'low') => ({
  byHarness: { codex: { model, effort } },
});
function form(value: unknown = inheritedNode, change = vi.fn()) {
  return (
    <SchemaForm
      schema={NodeConfigSchemas.inference}
      value={value}
      onChange={change}
      label="Inference"
      controls={NODE_FIELD_CONTROLS}
    />
  );
}
async function expectDefault(effort: string) {
  await waitFor(() =>
    expect(
      within(screen.getByLabelText('Effort', { exact: true })).getByRole('option', {
        name: `Default (${effort})`,
      }),
    ).toBeInTheDocument(),
  );
}

it.each(['owner', 'process'] as const)('refreshes %s defaults on window focus', async (level) => {
  const api = new FakeApi();
  let process = defaults();
  api.override('GET /system/model-defaults', () => Response.json(process));
  renderWith(form(), '/', api);
  await expectDefault('low');
  if (level === 'owner') api.settingsValues = { defaults: defaults('gpt-6.1-sol', 'high') };
  else process = defaults('gpt-6.1-sol', 'high');
  act(() => {
    window.dispatchEvent(new Event('focus'));
  });
  await expectDefault('high');
  expect(
    within(screen.getByLabelText('Model')).getByRole('option', {
      name: '(loop default) (gpt-6.1-sol)',
    }),
  ).toBeInTheDocument();
});

it('refreshes defaults when the tab becomes visible', async () => {
  const api = new FakeApi();
  renderWith(form(), '/', api);
  await expectDefault('low');
  api.settingsValues = { defaults: defaults('gpt-6.1-sol', 'high') };
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expectDefault('low');
  visibility.mockReturnValue('visible');
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expectDefault('high');
  visibility.mockRestore();
});

it.each(['initial', 'background'] as const)(
  'focus replaces an older %s Settings request instead of accepting its stale result',
  async (state) => {
    const api = new FakeApi();
    let release!: (response: Response) => void;
    const held = new Promise<Response>((resolve) => {
      release = resolve;
    });
    if (state === 'initial') api.override('GET /settings', () => held);
    const change = vi.fn();
    const { queryClient } = renderWith(form(inheritedNode, change), '/', api);
    if (state === 'background') {
      await expectDefault('low');
      api.override('GET /settings', () => held);
      act(() => {
        void queryClient.invalidateQueries({ queryKey: keys.settings });
      });
    }
    await waitFor(() =>
      expect(
        api.calls.filter((call) => call.method === 'GET' && call.path === '/settings'),
      ).toHaveLength(state === 'initial' ? 1 : 2),
    );
    api.override('GET /settings', () =>
      Response.json({ defaults: defaults('gpt-6.1-sol', 'high') }),
    );
    act(() => {
      window.dispatchEvent(new Event('focus'));
      release(Response.json({}));
    });
    await expectDefault('high');
    expect(change).not.toHaveBeenCalled();
  },
);

it.each(['owner', 'process'] as const)(
  'refreshes fresh cached %s defaults when a node dialog opens',
  async (level) => {
    const api = new FakeApi();
    let process = defaults();
    api.override('GET /system/model-defaults', () => Response.json(process));
    const source = minimalLoop();
    const loop = api.addLoop(
      LoopDefinitionSchema.parse({
        ...source,
        nodes: [
          ...source.nodes,
          { id: 'work', kind: 'inference', label: 'Work', config: inheritedNode },
        ],
      }),
    );
    const { queryClient } = renderApp(`/loops/${loop.id}/edit`, api);
    queryClient.setQueryDefaults(keys.settings, { staleTime: Infinity });
    queryClient.setQueryDefaults(keys.modelDefaults, { staleTime: Infinity });
    fireEvent.click(await screen.findByTestId('node-work'));
    await expectDefault('low');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    if (level === 'owner') api.settingsValues = { defaults: defaults('gpt-6.1-sol', 'high') };
    else process = defaults('gpt-6.1-sol', 'high');
    fireEvent.click(screen.getByTestId('node-work'));
    await expectDefault('high');
  },
);

it('refreshes process defaults immediately after a same-tab Settings save', async () => {
  const api = new FakeApi();
  api.catalog = [
    {
      harness: 'codex',
      model: 'chosen',
      displayName: 'Chosen',
      efforts: ['low', 'high'],
      defaultEffort: 'low',
      enabled: true,
      source: 'harness',
    },
  ];
  let process = defaults();
  api.override('GET /system/model-defaults', () => Response.json(process));
  renderWith(
    <>
      <DefaultsSection />
      {form()}
    </>,
    '/',
    api,
  );
  await expectDefault('low');
  process = defaults('gpt-6-luna', 'high');
  fireEvent.change(screen.getByLabelText('Default model', { exact: true }), {
    target: { value: 'chosen' },
  });
  await waitFor(() =>
    expect(api.settingsValues).toHaveProperty('defaults.byHarness.codex.model', 'chosen'),
  );
  await expectDefault('high');
});

it.each(['pending', 'failed'] as const)(
  'does not claim a concrete effort while the catalog is %s',
  async (state) => {
    const api = new FakeApi();
    api.override('GET /model-catalog', () =>
      state === 'pending'
        ? new Promise<Response>(() => undefined)
        : problem(503, 'FAILED', 'catalog unavailable'),
    );
    const change = vi.fn();
    const { queryClient } = renderWith(form(inheritedNode, change), '/', api);
    await waitFor(() => expect(queryClient.getQueryData(keys.modelDefaults)).toEqual(defaults()));
    await waitFor(() => expect(queryClient.getQueryData(keys.settings)).toBeDefined());
    await waitFor(() =>
      expect(
        within(screen.getByLabelText('Effort')).getByRole('option', {
          name: state === 'pending' ? /Default.*checking/ : 'Default (unavailable)',
        }),
      ).toBeInTheDocument(),
    );
    expect(change).not.toHaveBeenCalled();
  },
);

it('uses one LLM model dropdown with an accessible inherited identity and preserves selection shapes', async () => {
  const api = new FakeApi();
  api.catalog = [
    {
      harness: 'codex',
      model: 'chosen',
      displayName: 'Chosen',
      efforts: ['low'],
      defaultEffort: 'low',
      enabled: true,
      source: 'harness',
    },
  ];
  const change = vi.fn();
  renderWith(
    <SchemaForm
      schema={NodeConfigSchemas.decision}
      value={{
        kind: 'llm',
        harness: 'codex',
        instructions: 'q',
        model: { mode: 'inherit' },
        effort: { mode: 'inherit' },
        routes: [
          { id: 'yes', label: 'Yes' },
          { id: 'no', label: 'No' },
        ],
      }}
      onChange={change}
      label="Decision"
      controls={NODE_FIELD_CONTROLS}
    />,
    '/',
    api,
  );
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveAccessibleDescription(
      /Default model: gpt-6-luna/,
    ),
  );
  const model = screen.getByRole('combobox', { name: 'Model' });
  expect(screen.queryByRole('combobox', { name: 'Mode' })).not.toBeInTheDocument();
  expect(within(model).getByRole('option', { name: 'Default (gpt-6-luna)' })).toBeInTheDocument();
  fireEvent.change(model, { target: { value: 'chosen' } });
  await waitFor(() =>
    expect(change.mock.lastCall?.[0]).toHaveProperty('model', {
      mode: 'explicit',
      value: 'chosen',
    }),
  );
  fireEvent.change(model, { target: { value: '' } });
  await waitFor(() =>
    expect(change.mock.lastCall?.[0]).toHaveProperty('model', { mode: 'inherit' }),
  );
});

it.each(['owner', 'process'] as const)(
  'stops vouching for cached %s defaults when a refresh fails, until one succeeds',
  async (level) => {
    const api = new FakeApi();
    let failing = false;
    let process = defaults();
    api.override('GET /system/model-defaults', () =>
      failing && level === 'process'
        ? problem(503, 'FAILED', 'defaults unavailable')
        : Response.json(process),
    );
    const settings = () =>
      failing && level === 'owner'
        ? problem(503, 'FAILED', 'settings unavailable')
        : Response.json(api.settingsValues);
    api.override('GET /settings', settings);
    const change = vi.fn();
    renderWith(form(inheritedNode, change), '/', api);
    await expectDefault('low');
    // The defaults change elsewhere, and this tab's next read of them fails.
    if (level === 'owner') api.settingsValues = { defaults: defaults('gpt-6.1-sol', 'high') };
    else process = defaults('gpt-6.1-sol', 'high');
    failing = true;
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await expectDefault('unavailable');
    expect(screen.getByLabelText('Effort')).toHaveAccessibleDescription(
      /Default effort: unavailable/,
    );
    expect(screen.getByLabelText('Model')).not.toHaveAccessibleDescription(/gpt-6-luna/);
    failing = false;
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await expectDefault('high');
    expect(screen.getByLabelText('Model')).toHaveAccessibleDescription(
      /Default model: gpt-6.1-sol/,
    );
    expect(change).not.toHaveBeenCalled();
  },
);

it('describes inherited model identity and unsupported inherited effort on the controls', async () => {
  const api = new FakeApi();
  api.catalog = [
    {
      harness: 'codex',
      model: 'gpt-6-luna',
      displayName: 'Luna',
      efforts: ['high'],
      defaultEffort: 'high',
      enabled: true,
      source: 'harness',
    },
  ];
  renderWith(form(), '/', api);
  await waitFor(() =>
    expect(
      within(screen.getByLabelText('Effort')).getByRole('option', {
        name: 'Default (low) (not supported by this model)',
      }),
    ).toBeInTheDocument(),
  );
  expect
    .soft(screen.getByLabelText('Model'))
    .toHaveAccessibleDescription(/Default model: gpt-6-luna/);
  expect
    .soft(screen.getByLabelText('Effort'))
    .toHaveAccessibleDescription(/Default effort: low.*not supported by this model/i);
});
