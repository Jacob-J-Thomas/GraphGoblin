import {
  InferenceConfigSchema,
  LoopSettingsSchema,
  NodeConfigSchemas,
} from '@graphgoblin/contracts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { readinessMessage } from '@graphgoblin/domain';
import { FakeApi, problem } from '../../__fixtures__/fake-api.js';
import { renderWith as renderBase } from '../../__fixtures__/render.js';
import { openAdvanced } from '../../__fixtures__/advanced.js';
import { keys } from '../../api/queries.js';
import { LOOP_FIELD_CONTROLS, NODE_FIELD_CONTROLS } from '../../editor/field-controls.js';
import { SchemaForm } from '../SchemaForm.js';
import { CatalogWarningsContext } from './model.js';

/** Catalog controls are inference overrides under Advanced; exercise them as shown to authors. */
function renderWith(...args: Parameters<typeof renderBase>) {
  const result = renderBase(...args);
  if (screen.queryByRole('button', { name: /^Advanced/ })) openAdvanced();
  return result;
}

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
/** The field's own notice comes last in its description, after the schema help. */
const endsWith = (text: string) => new RegExp(`${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
const effort = () => screen.getByLabelText('Effort', { exact: true });
async function ready() {
  await waitFor(() => expect(model()).not.toHaveAttribute('aria-readonly'));
}

describe('catalog field controls', () => {
  it.each(['pending', 'failed', 'not-ready', 'signed-out'] as const)(
    'keeps a saved inherited Claude effort unverified and read-only while readiness is %s',
    async (state) => {
      const api = new FakeApi();
      api.catalog = [{ ...entry('claude-opus-5-5', true, 'claude'), efforts: ['low', 'xhigh'] }];
      api.preflight = [
        {
          harness: 'claude',
          state: state === 'not-ready' ? 'unknown' : state === 'signed-out' ? 'auth' : 'ready',
          ok: state !== 'not-ready',
          authenticated: state !== 'signed-out',
          problems: [],
          models: [
            {
              model: 'claude-opus-5-5',
              efforts: ['low', 'xhigh'],
            },
          ],
        },
      ];
      if (state === 'pending')
        api.override('GET /harness/preflight', () => new Promise<Response>(() => undefined));
      if (state === 'failed')
        api.override('GET /harness/preflight', () =>
          problem(503, 'FAILED', 'preflight unavailable'),
        );
      const change = vi.fn();
      renderWith(
        <SchemaForm
          schema={InferenceConfigSchema}
          value={{ harness: 'claude', effort: 'xhigh', prompt: { template: 'hello' } }}
          label="Inference"
          onChange={change}
          controls={NODE_FIELD_CONTROLS}
        />,
        '/',
        api,
      );
      const notice = {
        pending: 'Checking Claude readiness. Model choices are read-only until the check finishes.',
        failed:
          'Could not check Claude readiness. Model choices are read-only until a retry succeeds.',
        'not-ready':
          'Claude readiness: Unknown. Model choices are read-only until Claude is ready.',
        'signed-out':
          'Claude readiness: Sign-in needed. Model choices are read-only until Claude is ready.',
      }[state];
      await waitFor(() => expect(model()).toHaveAccessibleDescription(endsWith(notice)));
      // Only the first check is neutral; every known or failed lookup is a warning.
      expect(screen.getByText(notice).closest('p')).toHaveClass(
        state === 'pending' ? 'text-muted' : 'text-status-warn-fg',
      );
      expect(effort()).toHaveValue('xhigh');
      expect(effort()).toHaveAttribute('aria-readonly', 'true');
      expect(effort()).toHaveAccessibleDescription(endsWith(notice));
      expect(within(effort()).getByRole('option', { name: /^xhigh/ })).toBeInTheDocument();
      expect(effort()).not.toHaveAccessibleDescription(/not supported/);
      expect(screen.queryByText(/This effort is not supported/)).toBeNull();
      fireEvent.change(effort(), { target: { value: '' } });
      expect(effort()).toHaveValue('xhigh');
      expect(change).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, 'minimal'])(
    'bounds inherited Claude effort choices and preserves the saved value %s',
    async (savedEffort) => {
      const api = new FakeApi();
      api.settingsValues = {
        defaults: { byHarness: { claude: { model: 'claude-opus-5-5', effort: 'xhigh' } } },
      };
      const supportedEfforts = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
      api.catalog = [
        { ...entry('claude-opus-5-5', true, 'claude'), efforts: [...supportedEfforts] },
        { ...entry('claude-fable-5-1', true, 'claude'), efforts: [...supportedEfforts] },
        { ...entry('alpha'), efforts: [...supportedEfforts] },
      ];
      api.preflight = [
        {
          harness: 'claude',
          state: 'ready',
          ok: true,
          authenticated: true,
          authMethod: 'claude.ai',
          problems: [],
          models: [
            {
              model: 'claude-opus-5-5',
              efforts: [...supportedEfforts],
            },
            {
              model: 'claude-fable-5-1',
              efforts: [...supportedEfforts],
            },
          ],
        },
      ];
      const change = vi.fn();
      const user = userEvent.setup();
      renderWith(
        <SchemaForm
          schema={InferenceConfigSchema}
          value={{
            harness: 'claude',
            prompt: { template: 'hello' },
            ...(savedEffort === undefined ? {} : { effort: savedEffort }),
          }}
          label="Inference"
          onChange={change}
          controls={NODE_FIELD_CONTROLS}
        />,
        '/',
        api,
      );
      await ready();
      expect(model()).toHaveValue('');
      expect(effort()).toHaveValue(savedEffort ?? '');
      const options = within(effort()).getAllByRole<HTMLOptionElement>('option');
      expect(options.filter((option) => !option.disabled).map((option) => option.value)).toEqual([
        '',
        ...supportedEfforts,
      ]);
      if (savedEffort === 'minimal') {
        expect(
          within(effort()).getByRole('option', { name: /minimal.*not supported/ }),
        ).toBeDisabled();
        expect(effort()).toHaveAccessibleDescription(
          endsWith(
            'This effort is not supported by the selected model. The saved choice stays until you change it.',
          ),
        );
      } else {
        expect(within(effort()).queryByRole('option', { name: /^minimal$/ })).toBeNull();
      }
      expect(change).not.toHaveBeenCalled();
      await user.selectOptions(effort(), 'xhigh');
      await waitFor(() =>
        expect(change).toHaveBeenLastCalledWith(
          expect.objectContaining({ harness: 'claude', effort: 'xhigh' }),
          expect.objectContaining({ path: 'effort', kind: 'commit' }),
        ),
      );
      expect(change.mock.lastCall?.[0]).not.toHaveProperty('model');
    },
  );
  it('admits saved Fable and offers both supported Claude models', async () => {
    const api = new FakeApi();
    api.catalog = [
      entry('claude-opus-5-5', true, 'claude'),
      entry('claude-fable-5-1', true, 'claude'),
    ];
    api.preflight = [
      {
        harness: 'claude',
        state: 'ready',
        ok: true,
        authenticated: true,
        authMethod: 'claude.ai',
        problems: [],
        models: [
          {
            model: 'claude-opus-5-5',
            efforts: ['low', 'high'],
          },
          {
            model: 'claude-fable-5-1',
            efforts: ['low', 'high'],
          },
        ],
      },
    ];
    let latest: unknown;
    const user = userEvent.setup();
    renderWith(
      <SchemaForm
        schema={InferenceConfigSchema}
        value={{
          harness: 'claude',
          model: 'claude-fable-5-1',
          prompt: { template: 'hello' },
        }}
        label="Inference"
        onChange={(value) => {
          latest = value;
        }}
        controls={NODE_FIELD_CONTROLS}
      />,
      '/',
      api,
    );

    await waitFor(() => expect(model()).not.toHaveAttribute('aria-readonly'));
    expect(model()).toHaveValue('claude-fable-5-1');
    expect(model()).not.toHaveAccessibleDescription(/read-only|not listed|not in the catalog/);
    expect(within(model()).getByRole('option', { name: /claude-fable-5-1/ })).toBeEnabled();
    expect(within(model()).getByRole('option', { name: /claude-opus-5-5/ })).toBeEnabled();

    await user.selectOptions(model(), 'claude-opus-5-5');
    await waitFor(() =>
      expect(latest).toMatchObject({ harness: 'claude', model: 'claude-opus-5-5' }),
    );
  });

  it('changes Claude sandbox and approval only after an explicit supported policy selection', async () => {
    const api = new FakeApi();
    api.preflight = [
      {
        harness: 'claude',
        state: 'ready',
        ok: true,
        authenticated: true,
        authMethod: 'claude.ai',
        problems: [],
        supportedPolicies: [
          {
            sandbox: 'read-only',
            approval: 'never',
            permissionMode: 'dontAsk',
            tools: ['Read', 'Glob', 'Grep'],
            authMethod: 'claude.ai',
            boundary: 'builtin-tools',
            network: 'unconfined',
          },
          {
            sandbox: 'danger-full-access',
            approval: 'never',
            permissionMode: 'dontAsk',
            tools: ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash'],
            authMethod: 'claude.ai',
            boundary: 'unconfined',
            network: 'unconfined',
          },
        ],
      },
    ];
    let latest: unknown;
    const user = userEvent.setup();
    renderWith(
      <SchemaForm
        schema={InferenceConfigSchema}
        value={{
          harness: 'claude',
          prompt: { template: 'hello' },
          capabilities: { skills: ['keep'] },
          harnessOptions: {
            sandbox: 'workspace-write',
            approval: 'on-request',
            networkAccess: true,
            webSearch: false,
            configOverrides: { region: 'keep' },
          },
        }}
        label="Inference"
        onChange={(value) => {
          latest = value;
        }}
        controls={NODE_FIELD_CONTROLS}
      />,
      '/',
      api,
    );

    const policy = screen.getByLabelText('Sandbox and approval policy');
    await waitFor(() => expect(policy).not.toHaveAttribute('aria-readonly'));
    expect(policy).toHaveValue('unsupported');
    expect(within(policy).getAllByRole('option')).toHaveLength(3);
    expect(
      within(policy).getByRole('option', { name: /workspace-write.*unsupported; saved/ }),
    ).toBeDisabled();
    expect(latest).toBeUndefined();

    openAdvanced();
    const approval = screen.getByLabelText('Approval');
    expect(approval).toBeDisabled();
    expect(approval).toHaveValue('on-request');
    expect(
      within(approval).getByRole('option', { name: /on-request.*unsupported; saved/ }),
    ).toBeInTheDocument();

    await user.selectOptions(policy, '0');
    await waitFor(() =>
      expect(latest).toMatchObject({
        harness: 'claude',
        capabilities: { skills: ['keep'] },
        harnessOptions: {
          sandbox: 'read-only',
          approval: 'never',
          networkAccess: true,
          webSearch: false,
          configOverrides: { region: 'keep' },
        },
      }),
    );
    expect(approval).toHaveValue('never');
  });

  it('retains the same focused select while a pending catalog loads without writing values', async () => {
    const api = new FakeApi();
    api.catalog = [entry('alpha')];
    let resolveFetch: ((response: Response) => void) | undefined;
    api.override(
      'GET /model-catalog',
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const change = vi.fn();
    renderWith(
      <SchemaForm
        schema={InferenceConfigSchema}
        value={{ model: 'alpha', prompt: { template: 'hi' } }}
        label="Inference"
        onChange={change}
        controls={NODE_FIELD_CONTROLS}
      />,
      '/',
      api,
    );
    const focused = model();
    focused.focus();
    expect(focused).toHaveAttribute('aria-readonly', 'true');
    act(() => {
      resolveFetch?.(
        new Response(JSON.stringify({ items: api.catalog }), {
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    await ready();
    expect(model()).toBe(focused);
    expect(model()).toHaveFocus();
    expect(model()).toHaveValue('alpha');
    expect(change).not.toHaveBeenCalled();
  });

  it('derives an omitted harness from the sibling schema default', async () => {
    const api = new FakeApi();
    api.catalog = [entry('alpha', true, 'claude')];
    api.preflight.push({
      harness: 'claude',
      state: 'ready',
      ok: true,
      authenticated: true,
      problems: [],
      models: [
        {
          model: 'alpha',
          efforts: ['low', 'high'],
        },
      ],
    });
    renderWith(
      <SchemaForm
        schema={z.strictObject({
          ...InferenceConfigSchema.shape,
          harness: z.literal('claude').default('claude'),
        })}
        value={{ prompt: { template: 'hi' } }}
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
        .map((option) => option.getAttribute('value')),
    ).toEqual(['', 'alpha']);
  });

  it.each([
    ['missing', 'MODEL_NOT_IN_CATALOG', [entry('alpha')]],
    ['disabled', 'MODEL_DISABLED', [entry('disabled', false)]],
  ])(
    'shows one warning for a locally %s model instead of repeating the matching server warning',
    async (current, code, catalog) => {
      const api = new FakeApi();
      api.catalog = catalog;
      renderWith(
        <CatalogWarningsContext value={[{ path: 'model', code, message: 'Same server warning' }]}>
          <SchemaForm
            schema={InferenceConfigSchema}
            value={{ model: current, prompt: { template: 'hi' } }}
            label="Inference"
            onChange={vi.fn()}
            controls={NODE_FIELD_CONTROLS}
          />
        </CatalogWarningsContext>,
        '/',
        api,
      );
      await ready();
      expect(model()).not.toHaveAccessibleDescription(/Same server warning/);
      const notice = within(model().closest('[data-field]') as HTMLElement).getByRole('status');
      expect(notice).toHaveClass('text-status-warn-fg');
      expect(notice.querySelector('[data-icon="alert"]')).toBeInTheDocument();
    },
  );

  it('keeps server warnings when no catalog data is available', async () => {
    const api = new FakeApi();
    api.override('GET /model-catalog', () => problem(503, 'FAILED', 'catalog unavailable'));
    renderWith(
      <CatalogWarningsContext
        value={[{ path: 'model', code: 'MODEL_NOT_IN_CATALOG', message: 'Server warning' }]}
      >
        <SchemaForm
          schema={InferenceConfigSchema}
          value={{ model: 'missing', prompt: { template: 'hi' } }}
          label="Inference"
          onChange={vi.fn()}
          controls={NODE_FIELD_CONTROLS}
        />
      </CatalogWarningsContext>,
      '/',
      api,
    );
    await waitFor(() => expect(model()).toHaveAccessibleDescription(/Cannot load/));
    expect(model()).toHaveAccessibleDescription(/MODEL_NOT_IN_CATALOG: Server warning/);
    expect(model()).toHaveAttribute('aria-readonly', 'true');
    expect(screen.getByRole('button', { name: 'Retry model catalog' })).toBeEnabled();
  });

  it('uses Codex entries and sibling effort within the decision Codex group', async () => {
    const api = new FakeApi();
    api.catalog = [entry('alpha'), entry('hidden', false), entry('other', true, 'another')];
    const change = vi.fn();
    renderWith(
      <SchemaForm
        schema={NodeConfigSchemas.decision}
        value={{
          kind: 'llm',
          harness: 'codex',
          model: { mode: 'explicit', value: 'alpha' },
          effort: { mode: 'explicit', value: 'max' },
          context: {},
          instructions: 'q',
          routes: [
            {
              id: 'yes',
              label: 'Yes',
            },
            {
              id: 'no',
              label: 'No',
            },
          ],
        }}
        label="Decision"
        onChange={change}
        controls={NODE_FIELD_CONTROLS}
      />,
      '/',
      api,
    );
    const group = screen.getByRole('form', { name: 'Decision' });
    const model = within(group).getByLabelText('Model');
    const effort = within(group).getByLabelText('Effort');
    await waitFor(() => expect(model).not.toHaveAttribute('aria-readonly'));
    expect(model).toHaveValue('alpha');
    expect(within(model).getAllByRole('option')).toHaveLength(2);
    expect(effort).toHaveValue('max');
    expect(effort).toHaveAccessibleDescription(/not supported/);
    await userEvent.setup().selectOptions(effort, 'low');
    expect(change).toHaveBeenLastCalledWith(
      expect.objectContaining({
        model: { mode: 'explicit', value: 'alpha' },
        effort: { mode: 'explicit', value: 'low' },
      }),
      expect.objectContaining({ path: 'effort', kind: 'commit' }),
    );
  });
  it('shows an empty catalog with only the inherited choice and a Settings link', async () => {
    const { change, user } = setup({}, []);
    await ready();
    expect(
      within(model())
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['(loop default) (gpt-6-luna)']);
    expect(model()).toHaveAccessibleDescription(/No enabled models/);
    expect(within(effort()).getAllByRole('option')).toHaveLength(7);
    expect(change).not.toHaveBeenCalled();
    model().focus();
    await user.tab();
    expect(screen.getByRole('link', { name: 'Model catalog in Settings' })).toHaveFocus();
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
    ).toEqual(['Default (low)', 'low', 'high']);
    expect(effort()).toHaveValue('');
    await user.selectOptions(effort(), 'high');
    expect(change).toHaveBeenLastCalledWith(
      expect.objectContaining({ model: 'alpha', effort: 'high' }),
      expect.objectContaining({ path: 'effort', kind: 'commit' }),
    );
    await user.selectOptions(model(), '');
    expect(change.mock.lastCall?.[0]).not.toHaveProperty('model');
    expect(effort()).toHaveValue('high');
    expect(within(effort()).getAllByRole('option')).toHaveLength(7);
    await user.selectOptions(effort(), '');
    expect(change.mock.lastCall?.[0]).not.toHaveProperty('effort');
  });

  it.each([true, false])(
    'labels a retained model from Codex with Claude readiness %s',
    async (ready) => {
      const api = new FakeApi();
      api.catalog = [entry('gpt-6-astra'), entry('claude-opus-5-5', true, 'claude')];
      api.preflight.push({
        harness: 'claude',
        state: ready ? 'ready' : 'cli-incompatible',
        ok: ready,
        authenticated: true,
        problems: ready ? [] : [readinessMessage('claude', 'cli-incompatible')],
        models: [{ model: 'claude-opus-5-5', efforts: ['low', 'high'] }],
      });
      const change = vi.fn();
      renderWith(
        <SchemaForm
          schema={InferenceConfigSchema}
          value={{ harness: 'codex', model: 'gpt-6-astra', prompt: { template: 'Hi' } }}
          label="Inference"
          onChange={change}
          controls={NODE_FIELD_CONTROLS}
        />,
        '/',
        api,
      );
      await waitFor(() => expect(model()).not.toHaveAttribute('aria-readonly'));
      await userEvent.setup().click(screen.getByRole('radio', { name: 'claude' }));
      await waitFor(() =>
        expect(
          within(model()).getByRole('option', { name: /Saved model belongs to Codex/ }),
        ).toBeDisabled(),
      );
      expect(model()).toHaveValue('gpt-6-astra');
      expect(model()).toHaveAccessibleDescription(
        /Saved model belongs to Codex.*Choose a Claude model/,
      );
      if (ready) {
        await userEvent.setup().selectOptions(model(), 'claude-opus-5-5');
        expect(change.mock.lastCall?.[0]).toMatchObject({
          harness: 'claude',
          model: 'claude-opus-5-5',
        });
      } else {
        expect(model()).toHaveAccessibleDescription(
          endsWith(
            'Claude CLI lacks a required capability. Update the Claude CLI, then retry preflight. Model choices are read-only until Claude is ready. Saved model belongs to Codex. Choose a Claude model or an inherited default from this picker when the harness is ready.',
          ),
        );
        expect(screen.getByRole('button', { name: 'Retry Claude preflight' })).toBeEnabled();
        expect(screen.getByRole('link', { name: 'Model catalog in Settings' })).toBeInTheDocument();
      }
    },
  );

  it('filters many entries by the sibling harness and enabled state, watching harness changes', async () => {
    const api = new FakeApi();
    api.catalog = [
      entry('alpha'),
      entry('beta'),
      entry('hidden', false),
      entry('alpha', true, 'claude'),
      entry('other', true, 'claude'),
    ];
    api.preflight.push({
      harness: 'claude',
      state: 'ready',
      ok: true,
      authenticated: true,
      problems: [],
      models: ['alpha', 'other'].map((model) => ({
        model,
        efforts: ['low', 'high'],
      })),
    });
    renderWith(
      <SchemaForm
        schema={InferenceConfigSchema}
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
    await user.click(screen.getByRole('radio', { name: 'claude' }));
    await waitFor(() => expect(model()).not.toHaveAttribute('aria-readonly'));
    expect(model()).toHaveValue('beta');
    expect(model()).toHaveAccessibleDescription(
      /Saved model belongs to Codex.*Choose a Claude model/,
    );
    expect(
      within(model()).getByRole('option', { name: /Saved model belongs to Codex/ }),
    ).toBeDisabled();
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
      const sentence = marker === 'not in catalog' ? 'not in the catalog' : marker;
      expect(model()).toHaveAccessibleDescription(new RegExp(sentence));
      expect(within(model()).getByRole('option', { name: new RegExp(marker) })).toBeDisabled();
      expect(change).not.toHaveBeenCalled();
      await user.selectOptions(model(), 'alpha');
      expect(model()).not.toHaveAccessibleDescription(new RegExp(sentence));
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
    expect(model().tagName).toBe('SELECT');
    expect(model()).toHaveAttribute('aria-readonly', 'true');
    expect(model()).toHaveAccessibleDescription(/Loading the model catalog/);
    expect(screen.getByRole('button', { name: 'Retry model catalog' })).toBeDisabled();
    expect(screen.getAllByText(/Loading the model catalog/)).toHaveLength(1);
    expect(effort()).toHaveAccessibleDescription(/Loading the model catalog/);
    fireEvent.change(model(), { target: { value: '' } });
    fireEvent.change(effort(), { target: { value: '' } });
    expect(model()).toHaveValue('alpha');
    expect(effort()).toHaveValue('high');
    act(() => rejectFetch?.(new TypeError('Failed to fetch')));
    await waitFor(() =>
      expect(model()).toHaveAccessibleDescription(/Cannot load the model catalog/),
    );
    expect(effort()).toHaveValue('high');
    expect(effort()).toHaveAttribute('aria-readonly', 'true');
    expect(effort()).toHaveAccessibleDescription(/Cannot load the model catalog/);
    expect(screen.getAllByText(/Cannot load the model catalog/)).toHaveLength(1);
    api.override('GET /model-catalog', (call) => api.builtIn(call));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry model catalog' }));
    await ready();
    expect(model()).toHaveValue('alpha');
    expect(effort()).toHaveValue('high');
    expect(change).not.toHaveBeenCalled();
  });

  it('keeps cached choices editable and focused after a failed refresh, then recovers', async () => {
    const { api, queryClient, user, change } = setup({ model: 'alpha' });
    await ready();
    const focused = model();
    focused.focus();
    api.override('GET /model-catalog', () => problem(500, 'FAILED', 'catalog failed'));
    await act(() => queryClient.invalidateQueries({ queryKey: keys.catalog }));
    await waitFor(() => expect(model()).toHaveAccessibleDescription(/catalog may be out of date/));
    expect(model()).toBe(focused);
    expect(model()).toHaveFocus();
    expect(model()).not.toHaveAttribute('aria-readonly');
    expect(model()).toHaveValue('alpha');
    expect(effort()).toHaveAccessibleDescription(/catalog may be out of date/);
    expect(screen.getAllByText(/catalog may be out of date/)).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Retry model catalog' })).toBeEnabled();
    expect(change).not.toHaveBeenCalled();
    await user.selectOptions(effort(), 'high');
    expect(change).toHaveBeenLastCalledWith(
      expect.objectContaining({ model: 'alpha', effort: 'high' }),
      expect.objectContaining({ path: 'effort', kind: 'commit' }),
    );
    api.override('GET /model-catalog', (call) => api.builtIn(call));
    await act(() => queryClient.invalidateQueries({ queryKey: keys.catalog }));
    await ready();
    await waitFor(() => expect(model()).not.toHaveAccessibleDescription(/out of date/));
    expect(model()).toHaveValue('alpha');
    expect(effort()).toHaveValue('high');
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
    await waitFor(() => expect(model()).toHaveAccessibleDescription(/catalog may be out of date/));
    expect(model()).toHaveAccessibleDescription(/MODEL_DISABLED: Server warning for alpha/);
  });

  it.each(['owner', 'process'] as const)(
    'registers loop defaults with Codex choices and the inherited %s model',
    async (level) => {
      const api = new FakeApi();
      api.catalog = [entry('alpha'), entry('other', true, 'another')];
      if (level === 'owner')
        api.settingsValues = {
          defaults: { byHarness: { codex: { model: 'owner-model', effort: 'high' } } },
        };
      const change = vi.fn();
      renderWith(
        <SchemaForm
          schema={LoopSettingsSchema}
          value={{ defaults: { byHarness: { codex: { model: 'alpha' } } } }}
          label="Settings"
          onChange={change}
          controls={LOOP_FIELD_CONTROLS}
        />,
        '/',
        api,
      );
      await ready();
      await waitFor(() =>
        expect(
          within(model()).getByRole('option', {
            name: `(owner default) (${level === 'owner' ? 'owner-model' : 'gpt-6-luna'})`,
          }),
        ).toBeInTheDocument(),
      );
      expect(within(model()).getAllByRole('option')).toHaveLength(2);
      await userEvent.setup().selectOptions(model(), '');
      expect(change.mock.lastCall?.[0]).toMatchObject({
        defaults: { byHarness: { codex: {} } },
      });
      expect(within(effort()).getAllByRole('option')).toHaveLength(7);
    },
  );

  it('uses the validated byHarness record key for mixed loop default model and effort choices', async () => {
    const api = new FakeApi();
    api.catalog = [
      entry('alpha'),
      {
        ...entry('claude-opus-5-5', true, 'claude'),
        efforts: ['low', 'high', 'xhigh', 'max'],
      },
    ];
    api.preflight = [
      { harness: 'codex', state: 'ready', ok: true, authenticated: true, problems: [] },
      {
        harness: 'claude',
        state: 'ready',
        ok: true,
        version: '2.1.285',
        authenticated: true,
        authMethod: 'claude.ai',
        problems: [],
        supportedPolicies: [],
        models: [
          {
            model: 'claude-opus-5-5',
            efforts: ['low', 'high', 'xhigh', 'max'],
          },
        ],
      },
    ];
    const change = vi.fn();
    const { container } = renderWith(
      <SchemaForm
        schema={LoopSettingsSchema}
        value={{
          defaults: {
            byHarness: {
              codex: { model: 'alpha' },
              claude: { model: 'claude-opus-5-5' },
            },
          },
        }}
        label="Settings"
        onChange={change}
        controls={LOOP_FIELD_CONTROLS}
      />,
      '/',
      api,
    );
    const claudeModel = container.querySelector<HTMLSelectElement>(
      '[data-field="defaults.byHarness.claude.model"] select',
    )!;
    const codexModel = container.querySelector<HTMLSelectElement>(
      '[data-field="defaults.byHarness.codex.model"] select',
    )!;
    const claudeEffort = container.querySelector<HTMLSelectElement>(
      '[data-field="defaults.byHarness.claude.effort"] select',
    )!;
    const codexEffort = container.querySelector<HTMLSelectElement>(
      '[data-field="defaults.byHarness.codex.effort"] select',
    )!;
    await waitFor(() => expect(claudeModel).not.toHaveAttribute('aria-readonly'));
    expect(claudeModel).toHaveValue('claude-opus-5-5');
    expect(within(claudeModel).getByRole('option', { name: /claude-opus-5-5/ })).toBeEnabled();
    expect(within(claudeModel).queryByRole('option', { name: /alpha/ })).toBeNull();
    expect(within(codexModel).getByRole('option', { name: /alpha/ })).toBeEnabled();
    expect(within(codexModel).queryByRole('option', { name: /claude-opus-5-5/ })).toBeNull();
    expect(within(claudeEffort).getByRole('option', { name: 'xhigh' })).toBeInTheDocument();
    expect(within(codexEffort).queryByRole('option', { name: 'xhigh' })).toBeNull();
    expect(change).not.toHaveBeenCalled();
  });

  it('does not offer Claude model choices from static capabilities when CLI preflight is not ready', async () => {
    const api = new FakeApi();
    api.catalog = [entry('claude-opus-5-5', true, 'claude')];
    api.preflight = [
      {
        harness: 'claude',
        state: 'auth',
        ok: false,
        version: '2.1.285',
        authenticated: false,
        problems: [readinessMessage('claude', 'auth', 'Claude is not signed in.')],
        models: [
          {
            model: 'claude-opus-5-5',
            efforts: ['low', 'high'],
          },
        ],
      },
    ];
    renderWith(
      <SchemaForm
        schema={InferenceConfigSchema}
        value={{ harness: 'claude', prompt: { template: 'hello' } }}
        label="Inference"
        onChange={vi.fn()}
        controls={NODE_FIELD_CONTROLS}
      />,
      '/',
      api,
    );
    await waitFor(() => expect(model()).toHaveAttribute('aria-readonly', 'true'));
    expect(model()).toHaveAccessibleDescription(
      endsWith(
        'Claude is not signed in. Run claude auth login, then retry preflight. Model choices are read-only until Claude is ready.',
      ),
    );
    expect(within(model()).queryByRole('option', { name: /claude-opus-5-5/ })).toBeNull();
  });
});

it('keeps saved selection while cached lookup is pending or fails', async () => {
  const api = new FakeApi();
  api.catalog = [entry('alpha')];
  const change = vi.fn();
  const { queryClient } = renderWith(
    <SchemaForm
      schema={InferenceConfigSchema}
      value={{ model: 'saved-model', prompt: { template: 'hi' } }}
      label="Inference"
      onChange={change}
      controls={NODE_FIELD_CONTROLS}
    />,
    '/',
    api,
  );
  await ready();
  expect(model()).toHaveValue('saved-model');
  let finish!: (response: Response) => void;
  api.override(
    'GET /model-catalog',
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  let refresh!: Promise<void>;
  act(() => {
    refresh = queryClient.refetchQueries({ queryKey: keys.catalog });
  });
  await waitFor(() => expect(queryClient.isFetching({ queryKey: keys.catalog })).toBe(1));
  await waitFor(() =>
    expect(model()).toHaveAccessibleDescription(
      endsWith('Checking the model catalog. The saved choice stays until you change it.'),
    ),
  );
  expect(model()).toHaveValue('saved-model');
  await act(async () => {
    finish(problem(503, 'FAILED', 'Synthetic lookup failure'));
    await refresh;
  });
  expect(model()).toHaveValue('saved-model');
  await waitFor(() =>
    expect(model()).toHaveAccessibleDescription(
      endsWith(
        'Model support is unknown because the catalog lookup could not complete. The saved choice stays until you change it. The model catalog may be out of date. Cached choices are still available; retry to refresh them.',
      ),
    ),
  );
  expect(model()).not.toHaveAccessibleDescription(/not in the catalog/);
  expect(change).not.toHaveBeenCalled();
});

describe('readiness in the model picker', () => {
  const claudeReady = (models = ['claude-opus-5-5']): FakeApi['preflight'][number] => ({
    harness: 'claude',
    state: 'ready',
    ok: true,
    authenticated: true,
    authMethod: 'claude.ai',
    problems: [],
    models: models.map((name) => ({ model: name, efforts: ['low', 'high'] })),
  });
  function renderField(api: FakeApi, value: object) {
    return renderWith(
      <SchemaForm
        schema={InferenceConfigSchema}
        value={{ prompt: { template: 'hello' }, ...value }}
        label="Inference"
        onChange={vi.fn()}
        controls={NODE_FIELD_CONTROLS}
      />,
      '/',
      api,
    );
  }
  /** Hold the next preflight response until the test releases it. */
  function hold(api: FakeApi) {
    let finish!: (response: Response) => void;
    api.override(
      'GET /harness/preflight',
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    return (response: Response) => finish(response);
  }

  it('keeps a ready Claude field editable and labelled during a background recheck', async () => {
    const api = new FakeApi();
    api.catalog = [entry('claude-opus-5-5', true, 'claude')];
    api.preflight = [claudeReady()];
    const { queryClient } = renderField(api, { harness: 'claude', model: 'claude-opus-5-5' });
    await ready();
    const selected = () => within(model()).getByRole('option', { selected: true });
    expect(selected()).toHaveTextContent('Display claude-opus-5-5 (claude-opus-5-5)');
    const description = model().getAttribute('aria-describedby');
    const release = hold(api);
    let refresh!: Promise<void>;
    act(() => {
      // A window-focus refetch is this same background refetch of the shared query.
      refresh = queryClient.refetchQueries({ queryKey: keys.preflight });
    });
    await waitFor(() => expect(queryClient.isFetching({ queryKey: keys.preflight })).toBe(1));
    expect(model()).not.toHaveAttribute('aria-readonly');
    expect(selected()).toHaveTextContent('Display claude-opus-5-5 (claude-opus-5-5)');
    expect(model().getAttribute('aria-describedby')).toBe(description);
    expect(model()).not.toHaveAccessibleDescription(/Checking|read-only|saved/);
    expect(screen.queryByRole('button', { name: /^Retry .* preflight$/ })).toBeNull();
    await act(async () => {
      release(Response.json({ items: [claudeReady()] }));
      await refresh;
    });
    expect(model()).not.toHaveAttribute('aria-readonly');
  });

  it('labels a saved Claude model "(saved)" when readiness is known but not ready', async () => {
    const api = new FakeApi();
    api.catalog = [entry('claude-opus-5-5', true, 'claude')];
    api.preflight = [
      {
        ...claudeReady(),
        state: 'quota',
        ok: false,
        problems: [readinessMessage('claude', 'quota')],
      },
    ];
    renderField(api, { harness: 'claude', model: 'claude-opus-5-5' });
    await waitFor(() =>
      expect(model()).toHaveAccessibleDescription(
        endsWith(
          'Claude account usage limit reached. Wait for the usage limit to reset, then retry preflight. Model choices are read-only until Claude is ready.',
        ),
      ),
    );
    expect(model()).toHaveAttribute('aria-readonly', 'true');
    expect(within(model()).getByRole('option', { name: 'claude-opus-5-5 (saved)' })).toBeDisabled();
    expect(screen.queryByText(/readiness unknown|model availability/)).toBeNull();
    // A known failure is a warning, like the policy field's line.
    expect(screen.getByText(/until Claude is ready/).closest('p')).toHaveClass(
      'text-status-warn-fg',
    );
    expect(screen.getByRole('button', { name: 'Retry Claude preflight' })).toBeEnabled();
  });

  it('names a Claude catalog entry the adapter does not list', async () => {
    const api = new FakeApi();
    api.catalog = [
      entry('claude-opus-5-5', true, 'claude'),
      entry('claude-legacy', true, 'claude'),
    ];
    api.preflight = [claudeReady()];
    renderField(api, { harness: 'claude', model: 'claude-legacy' });
    await ready();
    expect(
      within(model()).getByRole('option', {
        name: 'Display claude-legacy (claude-legacy) (not listed by adapter)',
      }),
    ).toBeDisabled();
    expect(model()).toHaveAccessibleDescription(
      endsWith(
        'The Claude adapter does not list this model. The saved choice stays until you change it.',
      ),
    );
  });

  it('says when ready Claude offers no enabled listed model', async () => {
    const api = new FakeApi();
    api.catalog = [entry('claude-opus-5-5', false, 'claude')];
    api.preflight = [claudeReady()];
    renderField(api, { harness: 'claude' });
    await ready();
    expect(model()).toHaveAccessibleDescription(
      endsWith(
        'No enabled Claude model is listed by the adapter. Enable one in Settings or keep the inherited default.',
      ),
    );
  });

  it('says when ready Claude preflight lists no models', async () => {
    const api = new FakeApi();
    api.catalog = [entry('claude-opus-5-5', true, 'claude')];
    api.preflight = [
      { harness: 'claude', state: 'ready', ok: true, authenticated: true, problems: [] },
    ];
    renderField(api, { harness: 'claude' });
    await waitFor(() =>
      expect(model()).toHaveAccessibleDescription(
        endsWith('Claude preflight listed no models. Model choices are read-only.'),
      ),
    );
  });

  it('notes a known Codex failure with its own Retry button and keeps it while rechecking', async () => {
    const api = new FakeApi();
    api.catalog = [entry('alpha')];
    api.preflight = [
      {
        harness: 'codex',
        state: 'auth',
        ok: false,
        version: '0.160.0',
        authenticated: false,
        problems: [readinessMessage('codex', 'auth', 'Codex is not signed in.')],
      },
    ];
    const { queryClient } = renderField(api, { harness: 'codex', model: 'alpha' });
    const note = 'Codex is not signed in. Run codex login, then retry preflight.';
    await waitFor(() => expect(model()).toHaveAccessibleDescription(endsWith(note)));
    // Codex choices stay editable; the note is a warning, with Codex capitalised.
    expect(model()).not.toHaveAttribute('aria-readonly');
    expect(screen.getByText(note)).toHaveClass('text-status-warn-fg');
    expect(screen.queryByText(/codex CLI|Checking codex/)).toBeNull();
    const retry = screen.getByRole('button', { name: 'Retry Codex preflight' });
    expect(retry).toBeEnabled();

    const release = hold(api);
    await userEvent.setup().click(retry);
    await waitFor(() => expect(retry).toBeDisabled());
    expect(model()).toHaveAccessibleDescription(endsWith(note));
    await act(async () => {
      release(
        Response.json({
          items: [
            { harness: 'codex', state: 'ready', ok: true, authenticated: true, problems: [] },
          ],
        }),
      );
      await waitFor(() => expect(queryClient.isFetching({ queryKey: keys.preflight })).toBe(0));
    });
    await waitFor(() => expect(screen.queryByText(note)).toBeNull());
    expect(screen.queryByRole('button', { name: 'Retry Codex preflight' })).toBeNull();
  });

  it('shows no Codex note during the first check', async () => {
    const api = new FakeApi();
    api.catalog = [entry('alpha')];
    api.override('GET /harness/preflight', () => new Promise<Response>(() => undefined));
    renderField(api, { harness: 'codex', model: 'alpha' });
    await ready();
    expect(model()).not.toHaveAccessibleDescription(/codex/i);
    expect(screen.queryByRole('button', { name: 'Retry Codex preflight' })).toBeNull();
  });

  it('says when Codex readiness could not be checked', async () => {
    const api = new FakeApi();
    api.catalog = [entry('alpha')];
    api.override('GET /harness/preflight', () => problem(503, 'FAILED', 'down'));
    renderField(api, { harness: 'codex', model: 'alpha' });
    await waitFor(() =>
      expect(model()).toHaveAccessibleDescription(endsWith('Could not check Codex readiness.')),
    );
    expect(screen.getByRole('button', { name: 'Retry Codex preflight' })).toBeEnabled();
  });
});
