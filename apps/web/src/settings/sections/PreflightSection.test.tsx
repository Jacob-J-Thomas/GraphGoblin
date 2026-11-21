import { onlineManager } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { HarnessReadinessStateSchema } from '@graphgoblin/contracts';
import { CODEX_PLUGIN_OBSERVABILITY_NOTICE, readinessMessage } from '@graphgoblin/domain';
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

function codex(state: keyof typeof LABELS): FakeApi['preflight'][number] {
  return {
    harness: 'codex',
    state,
    ok: state === 'ready',
    ...(state === 'cli-missing' ? {} : { version: '0.160.0' }),
    authenticated: state === 'ready',
    problems: state === 'ready' ? [] : [readinessMessage('codex', state)],
  };
}

function ollama(state: keyof typeof LABELS): FakeApi['preflight'][number] {
  return {
    harness: 'ollama',
    state,
    ok: state === 'ready',
    problems: state === 'ready' ? [] : [readinessMessage('ollama', state)],
  };
}

const region = () => screen.getByRole('region', { name: 'Harness preflight' });
const retry = () => within(region()).getByRole('button', { name: 'Retry preflight' });
/** A harness's own row, found by its name. */
const item = (harness: string) =>
  within(region())
    .getAllByRole('listitem')
    .find((row) => within(row).queryByText(harness, { selector: 'code' }));
const badge = (harness: string) => item(harness)?.querySelector('[data-state]');
/** Every element whose whole text is the shared Codex notice (its commands are inner code). */
const notices = (scope: HTMLElement) =>
  within(scope).queryAllByText(
    (_, element) =>
      element?.textContent === CODEX_PLUGIN_OBSERVABILITY_NOTICE &&
      ![...element.children].some(
        (child) => child.textContent === CODEX_PLUGIN_OBSERVABILITY_NOTICE,
      ),
  );
/** Every request the section made, in order. */
const requests = (api: FakeApi) => api.calls.map((call) => `${call.method} ${call.path}`);

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
      // The Codex plugin notice belongs to the Codex row only.
      expect(notices(region())).toHaveLength(0);
      expect(region()).not.toHaveTextContent(/plugin/i);
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
    const [notice, ...extra] = notices(region());
    expect(extra).toHaveLength(0);
    expect(item('codex')).toContainElement(notice!);
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
    // The notice stays with the result it describes.
    expect(notice).toBeVisible();
    expect(item('codex')).toContainElement(notice!);
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
    // With no current Codex result there is no Codex row, so no notice either.
    expect(notices(region())).toHaveLength(0);
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
    expect(notices(region())).toHaveLength(0);
  });

  it('shows the loading text alone and disables Retry during the first check', async () => {
    const api = new FakeApi();
    api.override('GET /harness/preflight', () => new Promise<Response>(() => undefined));
    renderWith(<PreflightSection />, '/', api);
    expect(await within(region()).findByText('Loading preflight…')).toBeVisible();
    expect(retry()).toBeDisabled();
    expect(within(region()).getByRole('status')).toHaveTextContent('');
    expect(within(region()).queryByText('Checking…')).toBeNull();
    // No Codex result yet, so no Codex notice.
    expect(notices(region())).toHaveLength(0);
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
      // The last Codex result keeps its notice.
      expect(notices(item('codex')!)).toHaveLength(1);
      expect(retry()).toBeEnabled();
    } finally {
      onlineManager.setOnline(true);
    }
  });
});

describe('Codex plugin scope notice', () => {
  const NOT_READY = HarnessReadinessStateSchema.options.filter((state) => state !== 'ready');

  it('shows the shared notice under a Ready Codex badge as a quiet note, not a problem', async () => {
    const api = new FakeApi();
    api.preflight = [codex('ready')];
    renderWith(<PreflightSection />, '/', api);
    expect(await within(region()).findByText('Ready')).toBeVisible();
    const row = item('codex')!;
    expect(badge('codex')).toHaveAttribute('data-state', 'ready');
    expect(badge('codex')).toHaveClass('bg-status-good-bg');

    const [notice, ...extra] = notices(region());
    expect(extra).toHaveLength(0);
    expect(notice).toBeVisible();
    expect(row).toContainElement(notice!);
    // The exact shared words, with the two inventory commands set as code.
    expect(notice!.textContent).toBe(CODEX_PLUGIN_OBSERVABILITY_NOTICE);
    expect([...notice!.querySelectorAll('code')].map((code) => code.textContent)).toEqual([
      'codex plugin list --json',
      'codex mcp list --json',
    ]);
    // Muted information: not a problem list, an alert, another live region or hidden text.
    expect(notice).toHaveClass('text-muted');
    expect(
      notice!.closest('.text-status-bad-fg, .text-status-warn-fg, .sr-only, [aria-hidden]'),
    ).toBeNull();
    expect(within(row).queryByRole('list')).toBeNull();
    expect(within(region()).queryByRole('alert')).toBeNull();
    expect(within(region()).getAllByRole('status')).toHaveLength(1);
    expect(retry()).toBeEnabled();
    expect(requests(api)).toEqual(['GET /harness/preflight']);
  });

  it.each(NOT_READY)(
    'keeps the %s badge and its problem first, with the notice after the problem list',
    async (state) => {
      const api = new FakeApi();
      api.preflight = [codex(state)];
      renderWith(<PreflightSection />, '/', api);
      const shown = (await within(region()).findByText(LABELS[state])).closest('[data-state]');
      expect(shown).toHaveAttribute('data-state', state);
      expect(shown).toHaveClass(`bg-status-${TONES[state]}-bg`);
      const row = item('codex')!;
      const problem = within(row).getByText(readinessMessage('codex', state));
      expect(problem).toBeVisible();
      const list = problem.closest('ul')!;
      expect(list).toHaveClass(
        TONES[state] === 'bad' ? 'text-status-bad-fg' : 'text-status-warn-fg',
      );
      // The list holds the server's problem only; the notice is never added to it.
      expect(within(list).getAllByRole('listitem')).toHaveLength(1);
      expect(list).not.toHaveTextContent(/plugin/i);

      const [notice, ...extra] = notices(region());
      expect(extra).toHaveLength(0);
      expect(notice).toBeVisible();
      expect(row).toContainElement(notice!);
      expect(list).not.toContainElement(notice!);
      expect(list.compareDocumentPosition(notice!) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
      expect(retry()).toBeEnabled();
    },
  );

  it('belongs to the Codex row alone, and is absent when no Codex result is listed', async () => {
    const api = new FakeApi();
    api.preflight = [
      codex('ready'),
      claude('ready'),
      ollama('ready'),
      { harness: 'other', state: 'unknown', ok: false, problems: ['not logged in'] },
    ];
    const first = renderWith(<PreflightSection />, '/', api);
    await waitFor(() => expect(item('other')).toBeDefined());
    const [notice, ...extra] = notices(region());
    expect(extra).toHaveLength(0);
    expect(item('codex')).toContainElement(notice!);
    for (const [harness, state] of [
      ['claude', 'ready'],
      ['ollama', 'ready'],
      ['other', 'unknown'],
    ] as const) {
      const row = item(harness)!;
      expect(badge(harness)).toHaveAttribute('data-state', state);
      expect(notices(row)).toHaveLength(0);
      expect(row).not.toHaveTextContent(/plugin/i);
    }
    first.unmount();

    const withoutCodex = new FakeApi();
    withoutCodex.preflight = [claude('auth'), ollama('transport')];
    renderWith(<PreflightSection />, '/', withoutCodex);
    expect(await within(region()).findByText('Sign-in needed')).toBeVisible();
    expect(within(region()).getByText('Connection failed')).toBeVisible();
    expect(notices(region())).toHaveLength(0);
    expect(region()).not.toHaveTextContent(/plugin/i);
  });

  it('adds no request: Retry refetches the same preflight once and the notice stays with Codex', async () => {
    const api = new FakeApi();
    api.preflight = [codex('ready')];
    renderWith(<PreflightSection />, '/', api);
    expect(await within(region()).findByText('Ready')).toBeVisible();
    expect(notices(region())).toHaveLength(1);
    expect(requests(api)).toEqual(['GET /harness/preflight']);

    let finish!: (response: Response) => void;
    api.override(
      'GET /harness/preflight',
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    await userEvent.setup().click(retry());
    await waitFor(() => expect(requests(api)).toHaveLength(2));
    const status = within(region()).getByRole('status');
    expect(status).toHaveTextContent('Rechecking…');
    expect(retry()).toBeDisabled();
    expect(badge('codex')).toHaveAttribute('data-state', 'ready');
    expect(notices(item('codex')!)).toHaveLength(1);

    // A sign-in failure found by the recheck is shown in full, with the notice still after it.
    await act(async () => {
      finish(Response.json({ items: [codex('auth')] }));
      await Promise.resolve();
    });
    expect(await within(region()).findByText('Sign-in needed')).toBeVisible();
    expect(within(item('codex')!).getByText(readinessMessage('codex', 'auth'))).toBeVisible();
    expect(notices(item('codex')!)).toHaveLength(1);
    expect(status).toHaveTextContent('');
    expect(retry()).toBeEnabled();
    expect(requests(api)).toEqual(['GET /harness/preflight', 'GET /harness/preflight']);
  });
});
