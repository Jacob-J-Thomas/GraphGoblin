import { readinessMessage } from '@graphgoblin/domain';
import { act, screen, waitFor, within } from '@testing-library/react';
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
