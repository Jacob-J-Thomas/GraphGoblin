import { onlineManager } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { HarnessReadinessStateSchema } from '@graphgoblin/contracts';
import { readinessMessage } from '@graphgoblin/domain';
import { FakeApi, problem } from '../../__fixtures__/fake-api.js';
import { renderWith } from '../../__fixtures__/render.js';
import { keys } from '../../api/queries.js';
import { PreflightSection } from './PreflightSection.js';

const LABELS = {
  ready: 'Ready',
  unknown: 'Unknown',
  'cli-missing': 'CLI not found',
  'cli-incompatible': 'CLI update needed',
  auth: 'Sign-in needed',
  quota: 'Usage limit',
  transport: 'Connection failed',
} as const;
const TONES = {
  ready: 'good',
  unknown: 'warn',
  'cli-missing': 'bad',
  'cli-incompatible': 'bad',
  auth: 'bad',
  quota: 'warn',
  transport: 'warn',
} as const;

function claude(state: keyof typeof LABELS): FakeApi['preflight'][number] {
  return {
    harness: 'claude',
    state,
    ok: state === 'ready',
    authenticated: state === 'ready',
    ...(state === 'ready' ? { authMethod: 'claude.ai' as const } : {}),
    problems: state === 'ready' ? [] : [readinessMessage('claude', state)],
    models: [{ model: 'claude-opus-5-5', efforts: ['high'] }],
  };
}

const region = () => screen.getByRole('region', { name: 'Harness preflight' });
const retry = () => within(region()).getByRole('button', { name: 'Retry preflight' });
const badge = (harness: string) =>
  within(region())
    .getAllByRole('listitem')
    .find((item) => within(item).queryByText(harness, { selector: 'code' }))
    ?.querySelector('[data-state]');

describe('readiness state display', () => {
  it.each(HarnessReadinessStateSchema.options)(
    'labels %s on its badge without implying model access',
    async (state) => {
      const api = new FakeApi();
      api.preflight = [claude(state)];
      renderWith(<PreflightSection />, '/', api);
      const label = await within(region()).findByText(LABELS[state]);
      const shown = label.closest('[data-state]');
      expect(shown).toHaveAttribute('data-state', state);
      expect(shown).toHaveClass(`bg-status-${TONES[state]}-bg`);
      // The enum value itself is never the visible text.
      expect(within(region()).queryByText(state)).toBeNull();
      const listed = screen.getByText('listed by adapter');
      expect(listed.closest('.rounded-full')).toHaveClass('bg-status-neutral-bg');
      expect(screen.getByText(/do not confirm account access/)).toBeInTheDocument();
      expect(screen.queryByText(/supported by adapter|model unavailable/)).toBeNull();
      if (state === 'ready') expect(screen.getByText('Signed in with Claude.ai.')).toBeVisible();
      else
        expect(screen.getByText(readinessMessage('claude', state)).closest('ul')).toHaveClass(
          TONES[state] === 'bad' ? 'text-status-bad-fg' : 'text-status-warn-fg',
        );
    },
  );

  it('keeps the last result while rechecking, then shows the error view and recovers on retry', async () => {
    const api = new FakeApi();
    api.preflight = [
      {
        harness: 'codex',
        state: 'ready',
        ok: true,
        version: '0.160.0',
        authenticated: true,
        problems: [],
      },
      claude('auth'),
    ];
    const { queryClient } = renderWith(<PreflightSection />, '/', api);
    expect(await within(region()).findByText('Sign-in needed')).toBeVisible();
    expect(within(region()).getByText('v0.160.0')).toBeVisible();
    expect(retry()).toBeEnabled();
    const status = within(region()).getByRole('status');
    expect(status).toHaveTextContent('');

    let finish!: (response: Response) => void;
    api.override(
      'GET /harness/preflight',
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    let refresh!: Promise<void>;
    act(() => {
      // A window-focus refetch is an ordinary background refetch of the same query.
      refresh = queryClient.refetchQueries({ queryKey: keys.preflight });
    });
    await waitFor(() => expect(status).toHaveTextContent('Rechecking…'));
    expect(status).toHaveClass('text-muted');
    expect(retry()).toBeDisabled();
    // Badges do not flip to checking during a recheck.
    expect(badge('codex')).toHaveAttribute('data-state', 'ready');
    expect(badge('claude')).toHaveAttribute('data-state', 'auth');
    expect(within(region()).queryByText('Checking…')).toBeNull();
    // The removed duplicate paragraphs never appear.
    expect(screen.queryByText(/Checking harness readiness|Harness readiness unknown/)).toBeNull();

    await act(async () => {
      finish(problem(503, 'FAILED', 'Temporary failure'));
      await refresh;
    });
    // A failed request replaces the list with one error view; no stale badge remains.
    expect(await within(region()).findByText('Could not load preflight')).toBeVisible();
    expect(within(region()).getByText('Temporary failure (FAILED)')).toBeVisible();
    expect(within(region()).queryByText('Ready')).toBeNull();
    expect(within(region()).queryByText('Sign-in needed')).toBeNull();
    expect(status).toHaveTextContent('');
    expect(retry()).toBeEnabled();

    api.override('GET /harness/preflight', () =>
      Promise.resolve(Response.json({ items: [claude('ready')] })),
    );
    const before = api.calls.filter((call) => call.path === '/harness/preflight').length;
    await userEvent.setup().click(retry());
    expect(await within(region()).findByText('Ready')).toBeVisible();
    expect(api.calls.filter((call) => call.path === '/harness/preflight')).toHaveLength(before + 1);
    expect(within(region()).queryByText('Could not load preflight')).toBeNull();
  });

  it('shows the loading text alone and disables Retry during the first check', async () => {
    const api = new FakeApi();
    api.override('GET /harness/preflight', () => new Promise<Response>(() => undefined));
    renderWith(<PreflightSection />, '/', api);
    expect(await within(region()).findByText('Loading preflight…')).toBeVisible();
    expect(retry()).toBeDisabled();
    expect(within(region()).getByRole('status')).toHaveTextContent('');
    expect(within(region()).queryByText('Checking…')).toBeNull();
  });

  it('keeps the last result while offline and says so', async () => {
    const api = new FakeApi();
    const { queryClient } = renderWith(<PreflightSection />, '/', api);
    expect(await within(region()).findByText('Ready')).toBeVisible();
    try {
      act(() => {
        window.dispatchEvent(new Event('offline'));
      });
      act(() => {
        void queryClient.refetchQueries({ queryKey: keys.preflight });
      });
      expect(await within(region()).findByText('Offline; showing the last check.')).toBeVisible();
      expect(badge('codex')).toHaveAttribute('data-state', 'ready');
      expect(retry()).toBeEnabled();
    } finally {
      onlineManager.setOnline(true);
    }
  });
});
