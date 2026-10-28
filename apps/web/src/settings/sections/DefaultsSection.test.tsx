import { readinessMessage } from '@graphgoblin/domain';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FakeApi, problem } from '../../__fixtures__/fake-api.js';
import { renderWith } from '../../__fixtures__/render.js';
import { keys } from '../../api/queries.js';
import { DefaultsSection } from './DefaultsSection.js';

const opus: FakeApi['catalog'][number] = {
  harness: 'claude',
  source: 'harness',
  model: 'claude-opus-5-5',
  displayName: 'Claude Opus 5.5',
  efforts: ['low', 'high'],
  defaultEffort: 'high',
  enabled: true,
};
const luna: FakeApi['catalog'][number] = {
  harness: 'codex',
  source: 'harness',
  model: 'gpt-6-luna',
  displayName: 'Luna',
  efforts: ['low', 'high'],
  defaultEffort: 'low',
  enabled: true,
};
const codexReady: FakeApi['preflight'][number] = {
  harness: 'codex',
  state: 'ready',
  ok: true,
  authenticated: true,
  problems: [],
};
const claudeReady: FakeApi['preflight'][number] = {
  harness: 'claude',
  state: 'ready',
  ok: true,
  authenticated: true,
  authMethod: 'claude.ai',
  problems: [],
  models: [{ model: 'claude-opus-5-5', efforts: ['low', 'high'] }],
};

function setup(byHarness: Record<string, { model?: string }>) {
  const api = new FakeApi();
  api.catalog = [luna, opus];
  api.preflight = [codexReady, claudeReady];
  api.settingsValues = { defaults: { byHarness } };
  return api;
}
const claudeModel = () => screen.getByLabelText('Default model (claude)');
const codexModel = () => screen.getByLabelText('Default model');

describe('Defaults readiness lines', () => {
  it('treats Codex like Claude: one short line for a known failure, the full problem stays in preflight', async () => {
    const api = setup({ codex: { model: 'gpt-6-luna' } });
    api.preflight = [
      {
        ...codexReady,
        state: 'auth',
        ok: false,
        authenticated: false,
        problems: [readinessMessage('codex', 'auth')],
      },
      claudeReady,
    ];
    renderWith(<DefaultsSection />, '/', api);
    await waitFor(() =>
      expect(codexModel()).toHaveAccessibleDescription(
        'Codex readiness: Sign-in needed. See Harness preflight below.',
      ),
    );
    // Codex choices are not gated by readiness; the saved model keeps its plain label.
    expect(codexModel()).toHaveValue('gpt-6-luna');
    expect(within(codexModel()).getByRole('option', { name: 'Luna' })).toBeEnabled();
    expect(screen.queryByText(/codex login/)).toBeNull();
    expect(claudeModel()).not.toHaveAttribute('aria-describedby');
  });

  it('labels a saved Claude default "(saved)" and states the reason in the help line', async () => {
    const api = setup({ claude: { model: 'claude-opus-5-5' } });
    api.preflight = [
      codexReady,
      {
        ...claudeReady,
        state: 'cli-incompatible',
        ok: false,
        problems: [readinessMessage('claude', 'cli-incompatible')],
      },
    ];
    renderWith(<DefaultsSection />, '/', api);
    await waitFor(() =>
      expect(claudeModel()).toHaveAccessibleDescription(
        'Claude readiness: CLI update needed. See Harness preflight below.',
      ),
    );
    expect(claudeModel()).toHaveValue('claude-opus-5-5');
    expect(
      within(claudeModel()).getByRole('option', { name: 'Claude Opus 5.5 (saved)' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/readiness unknown/)).toBeNull();
  });

  it('says "Checking…" during the first catalog load and names a failed load', async () => {
    const api = setup({ codex: { model: 'gpt-6-luna' } });
    let finish!: (response: Response) => void;
    api.override(
      'GET /model-catalog',
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    renderWith(<DefaultsSection />, '/', api);
    await waitFor(() => expect(codexModel()).toHaveAccessibleDescription('Checking…'));
    expect(screen.getByText('Checking…')).toHaveClass('text-muted');
    expect(within(codexModel()).getByRole('option', { name: 'gpt-6-luna (saved)' })).toBeVisible();
    expect(screen.queryByText(/Model catalog unknown/)).toBeNull();
    await act(async () => {
      finish(problem(503, 'FAILED', 'down'));
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(codexModel()).toHaveAccessibleDescription(
        'Could not load the model catalog. The saved default stays until you change it.',
      ),
    );
  });

  it('says Claude is being checked only when a saved model waits on it', async () => {
    const api = setup({ claude: { model: 'claude-opus-5-5' } });
    api.override('GET /harness/preflight', () => new Promise<Response>(() => undefined));
    renderWith(<DefaultsSection />, '/', api);
    await waitFor(() =>
      expect(claudeModel()).toHaveAccessibleDescription('Claude readiness: Checking…'),
    );
    expect(codexModel()).not.toHaveAttribute('aria-describedby');
  });

  it('keeps Claude choices through a background recheck', async () => {
    const api = setup({});
    const { queryClient } = renderWith(<DefaultsSection />, '/', api);
    await waitFor(() =>
      expect(within(claudeModel()).getByRole('option', { name: 'Claude Opus 5.5' })).toBeEnabled(),
    );
    api.override('GET /harness/preflight', () => new Promise<Response>(() => undefined));
    act(() => {
      void queryClient.refetchQueries({ queryKey: keys.preflight });
    });
    await waitFor(() => expect(queryClient.isFetching({ queryKey: keys.preflight })).toBe(1));
    expect(within(claudeModel()).getByRole('option', { name: 'Claude Opus 5.5' })).toBeEnabled();
    expect(claudeModel()).not.toHaveAttribute('aria-describedby');
  });

  it('names a saved Claude default the adapter does not list', async () => {
    const api = setup({ claude: { model: 'claude-legacy' } });
    api.catalog = [luna, opus, { ...opus, model: 'claude-legacy', displayName: 'Legacy' }];
    renderWith(<DefaultsSection />, '/', api);
    await waitFor(() =>
      expect(claudeModel()).toHaveAccessibleDescription(
        'Not listed by the Claude adapter. Choose another default.',
      ),
    );
    expect(within(claudeModel()).getByRole('option', { name: 'Legacy (saved)' })).toBeVisible();
  });
});

describe('Codex default effort follows the model it applies to (#205, PR #426 QA D-1, O-2)', () => {
  const noneToMax = ['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
  const lunaFull: FakeApi['catalog'][number] = { ...luna, efforts: [...noneToMax] };
  const gpt55: FakeApi['catalog'][number] = {
    ...luna,
    model: 'gpt-5.5',
    displayName: 'GPT-5.5',
    efforts: ['low', 'medium', 'high', 'xhigh'],
  };
  const codexEffort = () => screen.getByLabelText('Default effort');
  const offered = () =>
    within(codexEffort())
      .getAllByRole('option')
      .map((option) => (option as HTMLOptionElement).value);
  function codexOnly(byHarness: Record<string, { model?: string; effort?: string }> = {}) {
    const api = new FakeApi();
    api.catalog = [lunaFull, gpt55];
    api.preflight = [codexReady];
    api.settingsValues = Object.keys(byHarness).length ? { defaults: { byHarness } } : {};
    return api;
  }
  const refusal = (code: string, path: string) =>
    problem(400, 'EVALUATION_INVALID_CONFIGURATION', 'invalid harness defaults', [
      {
        level: 'owner',
        harness: 'codex',
        resolution: { status: 'invalid', code, path, message: 'refused' },
      },
    ]);

  it('offers the server default model efforts with no model selected, none first as no reasoning', async () => {
    renderWith(<DefaultsSection />, '/', codexOnly());
    await waitFor(() => expect(offered()).toEqual(['', ...noneToMax]));
    expect(within(codexEffort()).getByRole('option', { name: 'none (no reasoning)' })).toHaveValue(
      'none',
    );
  });

  it('offers only the efforts every model shares while the server default model is unknown', async () => {
    const api = codexOnly();
    api.override(
      'GET /system/model-defaults',
      () =>
        new Response(JSON.stringify({ byHarness: {} }), {
          headers: { 'content-type': 'application/json' },
        }),
    );
    renderWith(<DefaultsSection />, '/', api);
    await waitFor(() => expect(offered()).toEqual(['', 'low', 'medium', 'high', 'xhigh']));
  });

  it.each([{ model: 'gpt-5.5' }, {}])(
    'explains a stored none default its model does not offer (%j)',
    async (model) => {
      const api = codexOnly({ codex: { ...model, effort: 'none' } });
      // Without a model here, the effort applies to the server default model.
      api.override(
        'GET /system/model-defaults',
        () =>
          new Response(JSON.stringify({ byHarness: { codex: { model: 'gpt-5.5' } } }), {
            headers: { 'content-type': 'application/json' },
          }),
      );
      renderWith(<DefaultsSection />, '/', api);
      const message =
        'Effort none is not supported by GPT-5.5. Choose a supported effort or Default.';
      await waitFor(() => expect(codexEffort()).toHaveAccessibleDescription(message));
      expect(codexEffort()).toHaveValue('none');
      expect(
        within(codexEffort()).getByRole('option', {
          name: 'none (not supported by this model)',
        }),
      ).toBeDisabled();
      expect(screen.getByText(message)).toHaveClass('text-status-warn-fg');
    },
  );

  it('names an effort the server refuses on its field instead of a generic footer', async () => {
    const user = userEvent.setup();
    const api = codexOnly({ codex: { model: 'gpt-6-luna' } });
    api.override('PUT /settings', () => refusal('EFFORT_UNSUPPORTED', 'effort'));
    renderWith(<DefaultsSection />, '/', api);
    await waitFor(() => expect(offered()).toEqual(['', ...noneToMax]));
    await user.selectOptions(codexEffort(), 'max');
    const message =
      'Not saved. Effort max is not supported by Luna. Choose a supported effort or Default.';
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(codexEffort()).toHaveAccessibleDescription(message);
    expect(codexEffort()).toHaveValue('');
    expect(screen.queryByText(/invalid harness defaults/)).toBeNull();
  });

  it('names the server default model when no model is selected', async () => {
    const user = userEvent.setup();
    const api = codexOnly();
    api.override('PUT /settings', () => refusal('EFFORT_UNSUPPORTED', 'effort'));
    renderWith(<DefaultsSection />, '/', api);
    await waitFor(() => expect(offered()).toEqual(['', ...noneToMax]));
    await user.selectOptions(codexEffort(), 'xhigh');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Not saved. Effort xhigh is not supported by Luna. Choose a supported effort or Default.',
    );
  });

  it('keeps the generic footer for any other refusal', async () => {
    const user = userEvent.setup();
    const api = codexOnly({ codex: { model: 'gpt-6-luna' } });
    api.override('PUT /settings', () => refusal('MODEL_NOT_IN_CATALOG', 'model'));
    renderWith(<DefaultsSection />, '/', api);
    await waitFor(() => expect(offered()).toEqual(['', ...noneToMax]));
    await user.selectOptions(codexEffort(), 'high');
    expect(await screen.findByText(/invalid harness defaults/)).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
