import { InferenceConfigSchema, LoopSettingsSchema } from '@graphgoblin/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { FakeApi, problem } from '../../__fixtures__/fake-api.js';
import { renderWith } from '../../__fixtures__/render.js';
import { keys } from '../../api/queries.js';
import { NODE_FIELD_CONTROLS } from '../../editor/field-controls.js';
import { NODE_FORM_SCHEMAS } from '../../editor/form-schemas.js';
import { SchemaForm } from '../SchemaForm.js';
import { CatalogWarningsContext, EffortField, LoopModelField } from './model.js';

const entry = (model: string, enabled = true, harness = 'codex'): FakeApi['catalog'][number] => ({
  model,
  harness,
  enabled,
  displayName: `Display ${model}`,
  efforts: ['low', 'high'],
  defaultEffort: 'low',
  source: 'harness',
});

function setup(value: object = {}, catalog = [entry('alpha')]) {
  const api = new FakeApi();
  api.catalog = catalog;
  const change = vi.fn();
  const rendered = renderWith(
    <SchemaForm
      schema={InferenceConfigSchema}
      value={{ prompt: { template: 'hello' }, ...value }}
      label="Inference"
      onChange={change}
      controls={NODE_FIELD_CONTROLS}
    />,
    '/',
    api,
  );
  return { ...rendered, change, user: userEvent.setup() };
}

const model = () => screen.getByLabelText('Model', { exact: true });
const effort = () => screen.getByLabelText('Effort', { exact: true });
async function ready() {
  await waitFor(() => expect(model().tagName).toBe('SELECT'));
}

describe('catalog field controls', () => {
  it('uses Codex entries and sibling effort within the decision Codex group', async () => {
    const api = new FakeApi();
    api.catalog = [entry('alpha'), entry('hidden', false), entry('other', true, 'another')];
    const change = vi.fn();
    renderWith(
      <SchemaForm
        schema={NODE_FORM_SCHEMAS.decision}
        value={{
          routes: [
            { label: 'yes', description: '' },
            { label: 'no', description: '' },
          ],
          question: 'q',
          strategy: ['codex'],
          codex: { model: 'alpha', effort: 'max' },
        }}
        label="Decision"
        onChange={change}
        controls={NODE_FIELD_CONTROLS}
      />,
      '/',
      api,
    );
    const group = screen.getByRole('group', { name: 'Codex' });
    await waitFor(() => expect(within(group).getByLabelText('Model').tagName).toBe('SELECT'));
    const model = within(group).getByLabelText('Model');
    const effort = within(group).getByLabelText('Effort');
    expect(model).toHaveValue('alpha');
    expect(within(model).getAllByRole('option')).toHaveLength(2);
    expect(effort).toHaveValue('max');
    expect(effort).toHaveAccessibleDescription(/not supported/);
    await userEvent.setup().selectOptions(effort, 'low');
    expect(change).toHaveBeenLastCalledWith(
      expect.objectContaining({ codex: { model: 'alpha', effort: 'low' } }),
    );
  });
  it('shows an empty catalog with only the inherited choice and a Settings link', async () => {
    const { change, user } = setup({}, []);
    await ready();
    expect(
      within(model())
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['(loop default)']);
    expect(model()).toHaveAccessibleDescription(/No enabled models/);
    expect(within(effort()).getAllByRole('option')).toHaveLength(7);
    expect(change).not.toHaveBeenCalled();
    await user.click(screen.getByRole('link', { name: 'Model catalog in Settings' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/settings');
  });

  it('selects one entry by display name and id, restricts effort, and clears back to unset', async () => {
    const { user, change } = setup();
    await ready();
    await user.selectOptions(model(), 'alpha');
    expect(
      within(model()).getByRole('option', { name: 'Display alpha (alpha)' }),
    ).toBeInTheDocument();
    expect(
      within(effort())
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['(inherited effort; catalog default: low)', 'low', 'high']);
    expect(effort()).toHaveValue('');
    await user.selectOptions(effort(), 'high');
    expect(change).toHaveBeenLastCalledWith(
      expect.objectContaining({ model: 'alpha', effort: 'high' }),
    );
    await user.selectOptions(model(), '');
    expect(change.mock.lastCall?.[0]).not.toHaveProperty('model');
    expect(effort()).toHaveValue('high');
    expect(within(effort()).getAllByRole('option')).toHaveLength(7);
    await user.selectOptions(effort(), '');
    expect(change.mock.lastCall?.[0]).not.toHaveProperty('effort');
  });

  it('filters many entries by the sibling harness and enabled state, watching harness changes', async () => {
    // The contract currently permits only Codex; this form exercises the renderer's sibling binding.
    const schema = InferenceConfigSchema.extend({
      harness: z.enum(['codex', 'another']).default('codex'),
    });
    const api = new FakeApi();
    api.catalog = [
      entry('alpha'),
      entry('beta'),
      entry('hidden', false),
      entry('alpha', true, 'another'),
      entry('other', true, 'another'),
    ];
    renderWith(
      <SchemaForm
        schema={schema}
        value={{ harness: 'codex', model: 'beta', prompt: { template: 'hi' } }}
        label="Inference"
        onChange={vi.fn()}
        controls={NODE_FIELD_CONTROLS}
      />,
      '/',
      api,
    );
    await ready();
    expect(
      within(model())
        .getAllByRole('option')
        .map((o) => o.getAttribute('value')),
    ).toEqual(['', 'alpha', 'beta']);
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: 'another' }));
    expect(model()).toHaveValue('beta');
    expect(model()).toHaveAccessibleDescription(/not in catalog/);
    expect(
      within(model())
        .getAllByRole('option')
        .map((o) => o.getAttribute('value')),
    ).toEqual(['', 'beta', 'alpha', 'other']);
  });

  it.each([
    ['unknown', [entry('alpha')], 'not in catalog'],
    ['disabled', [entry('disabled', false), entry('alpha')], 'disabled in the catalog'],
  ])(
    'keeps a %s model selected and warned without changing the form',
    async (current, catalog, marker) => {
      const { change, user } = setup({ model: current }, catalog);
      await ready();
      expect(model()).toHaveValue(current);
      expect(model()).toHaveAccessibleDescription(new RegExp(marker));
      expect(within(model()).getByRole('option', { name: new RegExp(marker) })).toBeDisabled();
      expect(change).not.toHaveBeenCalled();
      await user.selectOptions(model(), 'alpha');
      expect(model()).not.toHaveAccessibleDescription(new RegExp(marker));
      expect(
        within(model()).queryByRole('option', { name: new RegExp(marker) }),
      ).not.toBeInTheDocument();
    },
  );

  it('keeps an unsupported effort across model changes and updates after catalog refresh', async () => {
    const { user, change, api, queryClient } = setup({ model: 'alpha', effort: 'max' }, [
      entry('alpha'),
      { ...entry('beta'), efforts: ['medium'], defaultEffort: 'medium' },
    ]);
    await ready();
    expect(effort()).toHaveValue('max');
    expect(effort()).toHaveAccessibleDescription(/not supported/);
    expect(change).not.toHaveBeenCalled();
    await user.selectOptions(model(), 'beta');
    expect(effort()).toHaveValue('max');
    expect(
      within(effort())
        .getAllByRole('option')
        .map((o) => o.getAttribute('value')),
    ).toEqual(['', 'max', 'medium']);
    api.catalog[1] = { ...entry('beta'), efforts: ['max'], defaultEffort: 'max' };
    await act(() => queryClient.invalidateQueries({ queryKey: keys.catalog }));
    await waitFor(() => expect(effort()).not.toHaveAccessibleDescription(/not supported/));
    expect(effort()).toHaveValue('max');
    await user.selectOptions(effort(), '');
    expect(change.mock.lastCall?.[0]).not.toHaveProperty('effort');
  });

  it('shows pending and failed fetches as read-only, then retries without changing saved values', async () => {
    const api = new FakeApi();
    api.catalog = [entry('alpha')];
    let rejectFetch: ((reason?: unknown) => void) | undefined;
    api.override(
      'GET /model-catalog',
      () =>
        new Promise<Response>((_resolve, reject) => {
          rejectFetch = reject;
        }),
    );
    const change = vi.fn();
    renderWith(
      <SchemaForm
        schema={InferenceConfigSchema}
        value={{ model: 'alpha', effort: 'high', prompt: { template: 'hi' } }}
        label="Inference"
        onChange={change}
        controls={NODE_FIELD_CONTROLS}
      />,
      '/',
      api,
    );
    expect(model()).toHaveValue('alpha');
    expect(model()).toHaveAttribute('readonly');
    expect(model()).toHaveAccessibleDescription(/Loading the model catalog/);
    expect(screen.getAllByRole('button', { name: 'Retry model catalog' })[0]).toBeDisabled();
    act(() => rejectFetch?.(new TypeError('Failed to fetch')));
    await waitFor(() =>
      expect(model()).toHaveAccessibleDescription(/Cannot load the model catalog/),
    );
    expect(effort()).toHaveValue('high');
    expect(effort()).toHaveAttribute('readonly');
    api.override('GET /model-catalog', (call) => api.builtIn(call));
    await userEvent
      .setup()
      .click(screen.getAllByRole('button', { name: 'Retry model catalog' })[0]!);
    await ready();
    expect(model()).toHaveValue('alpha');
    expect(effort()).toHaveValue('high');
    expect(change).not.toHaveBeenCalled();
  });

  it('protects cached choices after a failed refresh and recovers automatically', async () => {
    const { api, queryClient } = setup({});
    await ready();
    api.override('GET /model-catalog', () => problem(500, 'FAILED', 'catalog failed'));
    await act(() => queryClient.invalidateQueries({ queryKey: keys.catalog }));
    await waitFor(() => expect(model()).toHaveAttribute('readonly'));
    expect(model()).toHaveValue('(loop default)');
    api.override('GET /model-catalog', (call) => api.builtIn(call));
    await act(() => queryClient.invalidateQueries({ queryKey: keys.catalog }));
    await ready();
    expect(model()).toHaveValue('');
  });

  it('shows validation catalog warnings only at their exact field paths', async () => {
    const api = new FakeApi();
    api.catalog = [entry('alpha')];
    const { queryClient } = renderWith(
      <CatalogWarningsContext
        value={[
          { path: 'model', code: 'MODEL_DISABLED', message: 'Server warning for alpha' },
          { path: 'model', code: 'OTHER', message: 'Unrelated code' },
          { path: 'codex.model', code: 'MODEL_NOT_IN_CATALOG', message: 'Other path' },
        ]}
      >
        <SchemaForm
          schema={InferenceConfigSchema}
          value={{ model: 'alpha', prompt: { template: 'hi' } }}
          label="Inference"
          onChange={vi.fn()}
          controls={NODE_FIELD_CONTROLS}
        />
      </CatalogWarningsContext>,
      '/',
      api,
    );
    await ready();
    expect(model()).toHaveAccessibleDescription(/MODEL_DISABLED: Server warning for alpha/);
    expect(model()).not.toHaveAccessibleDescription(/Other path|Unrelated code/);
    expect(model()).not.toHaveAttribute('aria-invalid');
    api.override('GET /model-catalog', () => problem(503, 'FAILED', 'catalog unavailable'));
    await act(() => queryClient.invalidateQueries({ queryKey: keys.catalog }));
    await waitFor(() => expect(model()).toHaveAttribute('readonly'));
    expect(model()).toHaveAccessibleDescription(/Cannot load the model catalog/);
    expect(model()).toHaveAccessibleDescription(/MODEL_DISABLED: Server warning for alpha/);
  });

  it('registers loop defaults with Codex choices and an owner-default unset value', async () => {
    const api = new FakeApi();
    api.catalog = [entry('alpha'), entry('other', true, 'another')];
    const change = vi.fn();
    renderWith(
      <SchemaForm
        schema={LoopSettingsSchema}
        value={{ defaults: { model: 'alpha' } }}
        label="Settings"
        onChange={change}
        controls={{ model: LoopModelField, effort: EffortField }}
      />,
      '/',
      api,
    );
    await ready();
    expect(within(model()).getByRole('option', { name: '(owner default)' })).toBeInTheDocument();
    expect(within(model()).getAllByRole('option')).toHaveLength(2);
    await userEvent.setup().selectOptions(model(), '');
    expect(change.mock.lastCall?.[0]).toMatchObject({ defaults: {} });
    expect(within(effort()).getAllByRole('option')).toHaveLength(7);
  });
});
