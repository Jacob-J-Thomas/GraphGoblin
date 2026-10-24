import { minimalLoop } from '@graphgoblin/contracts/testing';
import { LoopDefinitionSchema, NodeConfigSchemas } from '@graphgoblin/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { FakeApi } from '../__fixtures__/fake-api.js';
import { renderApp, renderWith } from '../__fixtures__/render.js';
import { SchemaForm } from '../forms/SchemaForm.js';
import { NodeOutputsContext } from '../forms/EarlierNodeOutputs.js';
import { NODE_FIELD_CONTROLS } from './field-controls.js';
import { vi } from 'vitest';
import { problem } from '../__fixtures__/fake-api.js';

it('renders an unknown harness without inventing inherited defaults', async () => {
  const change = vi.fn();
  renderWith(
    <SchemaForm
      schema={NodeConfigSchemas.inference}
      value={{ harness: 'unknown-harness', prompt: { template: 'q' } }}
      onChange={change}
      label="Node"
      controls={NODE_FIELD_CONTROLS}
    />,
    '/',
    new FakeApi(),
  );
  await waitFor(() =>
    expect(
      within(screen.getByLabelText('Effort')).getByRole('option', {
        name: 'Default (unavailable)',
      }),
    ).toBeInTheDocument(),
  );
  expect(
    within(screen.getByLabelText('Model')).getByRole('option', { name: '(loop default)' }),
  ).toBeInTheDocument();
  expect(change).not.toHaveBeenCalled();
});

it.each(['loading', 'failed', 'invalid-owner'] as const)(
  'does not invent a default when defaults are %s',
  async (state) => {
    const api = new FakeApi();
    if (state === 'loading')
      api.override('GET /settings', () => new Promise<Response>(() => undefined));
    if (state === 'failed')
      api.override('GET /system/model-defaults', () => problem(503, 'FAILED', 'unavailable'));
    if (state === 'invalid-owner') api.settingsValues = { defaults: { invalid: true } };
    const change = vi.fn();
    renderWith(
      <SchemaForm
        schema={NodeConfigSchemas.inference}
        value={{ prompt: { template: 'q' } }}
        onChange={change}
        label="Node"
        controls={NODE_FIELD_CONTROLS}
      />,
      '/',
      api,
    );
    const effort = screen.getByLabelText('Effort');
    await waitFor(() =>
      expect(
        within(effort).getByRole('option', {
          name: state === 'loading' ? /Default.*checking/ : 'Default (unavailable)',
        }),
      ).toBeInTheDocument(),
    );
    expect(change).not.toHaveBeenCalled();
  },
);

it('intersects an explicit Claude model with adapter efforts and marks an unsupported inherited default', async () => {
  const api = new FakeApi();
  api.catalog = [
    {
      harness: 'claude',
      model: 'claude-opus-5-5',
      displayName: 'Opus',
      efforts: ['low', 'high'],
      defaultEffort: 'low',
      enabled: true,
      source: 'harness',
    },
  ];
  api.settingsValues = {
    defaults: { byHarness: { claude: { model: 'claude-opus-5-5', effort: 'high' } } },
  };
  api.preflight = [
    {
      harness: 'claude',
      state: 'ready',
      ok: true,
      authenticated: true,
      problems: [],
      models: [{ model: 'claude-opus-5-5', efforts: ['low'] }],
    },
  ];
  const change = vi.fn();
  renderWith(
    <SchemaForm
      schema={NodeConfigSchemas.inference}
      value={{
        harness: 'claude',
        model: 'claude-opus-5-5',
        effort: 'high',
        prompt: { template: 'q' },
      }}
      onChange={change}
      label="Node"
      controls={NODE_FIELD_CONTROLS}
    />,
    '/',
    api,
  );
  const effort = screen.getByLabelText('Effort');
  await waitFor(() => expect(effort).toHaveAccessibleDescription(/not supported/));
  expect(
    within(effort).getByRole('option', { name: 'high (not supported by this model)' }),
  ).toBeDisabled();
  expect(
    within(effort)
      .getAllByRole('option')
      .map((option) => option.textContent),
  ).toEqual(['Default (high)', 'high (not supported by this model)', 'low']);
  fireEvent.change(effort, { target: { value: '' } });
  await waitFor(() =>
    expect(
      within(effort).getByRole('option', { name: 'Default (high) (not supported by this model)' }),
    ).toBeInTheDocument(),
  );
  expect(change.mock.lastCall?.[0]).not.toHaveProperty('effort');
});

it.each(['inference', 'llm'] as const)(
  '%s exposes model and one effort dropdown before Advanced',
  async (kind) => {
    const api = new FakeApi();
    const source = minimalLoop();
    const config =
      kind === 'inference'
        ? { prompt: { template: 'Choose' } }
        : {
            kind,
            instructions: 'Choose',
            harness: 'codex',
            model: { mode: 'inherit' },
            effort: { mode: 'inherit' },
            routes: [
              { id: 'yes', label: 'Yes' },
              { id: 'no', label: 'No' },
            ],
          };
    const loop = api.addLoop(
      LoopDefinitionSchema.parse({
        ...source,
        nodes: [
          ...source.nodes,
          { id: 'work', label: 'Work', kind: kind === 'llm' ? 'decision' : kind, config },
        ],
      }),
    );
    renderApp(`/loops/${loop.id}/edit`, api);
    fireEvent.click(await screen.findByTestId('node-work'));
    const dialog = screen.getByRole('dialog');
    await waitFor(() =>
      expect(within(dialog).getByLabelText('Effort', { exact: true })).toBeVisible(),
    );
    expect(within(dialog).queryByRole('group', { name: 'Effort' })).toBeNull();
    expect(within(dialog).getAllByRole('combobox', { name: 'Effort' })).toHaveLength(1);
  },
);

for (const kind of ['inference', 'llm'] as const) {
  it.each(['loop', 'Settings', 'process'] as const)(
    `${kind} resolves %s defaults and stores one explicit or inherited effort`,
    async (level) => {
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
      const defaults = { byHarness: { codex: { model: 'chosen', effort: 'high' as const } } };
      api.settingsValues = level === 'Settings' ? { defaults } : {};
      api.override('GET /system/model-defaults', () =>
        Response.json(
          level === 'process'
            ? defaults
            : { byHarness: { codex: { model: 'chosen', effort: 'low' } } },
        ),
      );
      const definition = minimalLoop();
      if (level === 'loop') definition.settings = { ...definition.settings, defaults };
      const change = vi.fn();
      const value =
        kind === 'inference'
          ? { prompt: { template: 'q' } }
          : {
              kind: 'llm',
              harness: 'codex',
              instructions: 'q',
              model: { mode: 'inherit' },
              effort: { mode: 'inherit' },
              routes: [
                { id: 'yes', label: 'Yes' },
                { id: 'no', label: 'No' },
              ],
            };
      renderWith(
        <NodeOutputsContext value={{ definition, node: definition.nodes[0]! }}>
          <SchemaForm
            schema={NodeConfigSchemas[kind === 'llm' ? 'decision' : kind]}
            value={value}
            onChange={change}
            label="Test node"
            controls={NODE_FIELD_CONTROLS}
          />
        </NodeOutputsContext>,
        '/',
        api,
      );
      const effort = screen.getByLabelText('Effort', { exact: true });
      await waitFor(() =>
        expect(within(effort).getByRole('option', { name: 'Default (high)' })).toBeInTheDocument(),
      );
      expect(
        within(effort)
          .getAllByRole('option')
          .map((o) => o.textContent),
      ).toEqual(['Default (high)', 'low', 'high']);
      expect(change).not.toHaveBeenCalled();
      if (kind === 'llm')
        expect(screen.getByLabelText('Model')).toHaveAccessibleDescription(/Default model: chosen/);
      else
        expect(
          within(screen.getByLabelText('Model')).getByRole('option', {
            name: '(loop default) (chosen)',
          }),
        ).toBeInTheDocument();
      fireEvent.change(effort, { target: { value: 'low' } });
      await waitFor(() =>
        expect(change.mock.lastCall?.[0]).toHaveProperty(
          'effort',
          kind === 'llm' ? { mode: 'explicit', value: 'low' } : 'low',
        ),
      );
      fireEvent.change(effort, { target: { value: '' } });
      await waitFor(() =>
        kind === 'llm'
          ? expect(change.mock.lastCall?.[0]).toHaveProperty('effort', { mode: 'inherit' })
          : expect(change.mock.lastCall?.[0]).not.toHaveProperty('effort'),
      );
    },
  );
}
