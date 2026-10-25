import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ResponseBody } from '@graphgoblin/api-client';
import { FakeApi, problem, runRecord } from '../__fixtures__/fake-api.js';
import { renderApp, renderWith } from '../__fixtures__/render.js';
import { ShutdownNotice } from './ShutdownNotice.js';

type State = ResponseBody<'/system/shutdown', 'get'>;
function state(phase: State['phase'] = 'awaiting-choice'): State {
  return {
    phase,
    controlToken: `fake-${phase}`,
    graceMs: 300000,
    activeRunIds: ['active-run'],
    unconfirmedRunIds: [],
    choices:
      phase === 'force-failed'
        ? ['force']
        : phase === 'draining' || phase === 'awaiting-choice'
          ? ['wait', 'force']
          : [],
  };
}
function fixture(initial = state()) {
  const api = new FakeApi();
  let current = initial;
  api.override('GET /system/shutdown', () => Response.json(current));
  const run = runRecord();
  run.pinned.name = 'Named loop';
  api.override('GET /runs/:id', () => Response.json(run));
  api.override('POST /system/shutdown', (call) => {
    current = state((call.body as { action: string }).action === 'wait' ? 'draining' : 'forcing');
    return Response.json(current, { status: 202 });
  });
  return {
    api,
    change: (next: State) => {
      current = next;
    },
  };
}

describe('gateway shutdown notice', () => {
  it('is absent while running and observes without sending actions', async () => {
    const { api } = fixture(state('running'));
    const view = renderWith(<ShutdownNotice />, '/', api);
    await waitFor(() => expect(api.callsTo('GET', '/system/shutdown')).toHaveLength(1));
    expect(screen.queryByRole('region', { name: 'Gateway shutdown' })).not.toBeInTheDocument();
    view.unmount();
    expect(api.callsTo('POST', '/system/shutdown')).toHaveLength(0);
  });

  it.each([
    ['draining', 'Gateway is draining'],
    ['awaiting-choice', 'Gateway is draining'],
    ['forcing', 'Gateway is force stopping'],
    ['drain-failed', 'Gateway drain failed'],
    ['force-failed', 'Force stop failed'],
    ['ready', 'Gateway is stopping'],
    ['stopped', 'Gateway stopped'],
    ['exiting', 'Gateway is exiting after failed cleanup'],
  ] as const)('explains phase %s', async (phase, title) => {
    const current = state(phase);
    if (phase.endsWith('failed')) current.error = 'Cleanup failed; ownership retained.';
    const { api } = fixture(current);
    renderWith(<ShutdownNotice />, '/', api);
    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
    if (!['ready', 'stopped', 'exiting'].includes(phase)) {
      expect(await screen.findByRole('link', { name: 'Named loop — active-run' })).toHaveAttribute(
        'href',
        '/runs/active-run',
      );
      expect(screen.getByText(/Independent starts are refused/)).toBeInTheDocument();
    }
    if (phase === 'awaiting-choice')
      expect(screen.getByText(/grace period elapsed/)).toBeInTheDocument();
    if (phase === 'force-failed')
      expect(screen.getByText(/store lock stays for reclamation/)).toBeInTheDocument();
    expect(api.callsTo('POST', '/system/shutdown')).toHaveLength(0);
  });

  it('keeps waiting once and shows the gateway phase without a local deadline', async () => {
    const user = userEvent.setup();
    const { api } = fixture();
    renderWith(<ShutdownNotice />, '/', api);
    await user.click(await screen.findByRole('button', { name: 'Keep waiting' }));
    expect(await screen.findByText(/Waiting never starts a browser countdown/)).toBeInTheDocument();
    expect(api.callsTo('POST', '/system/shutdown').map((call) => call.body)).toEqual([
      { action: 'wait' },
    ]);
  });

  it('requires confirmation naming interrupted work and uncertain effects; dismissal sends nothing', async () => {
    const user = userEvent.setup();
    const { api } = fixture();
    renderWith(<ShutdownNotice />, '/', api);
    await user.click(await screen.findByRole('button', { name: 'Force stop' }));
    const dialog = screen.getByRole('dialog');
    expect(
      await within(dialog).findByRole('link', { name: 'Named loop — active-run' }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/External effects may be uncertain/)).toBeInTheDocument();
    expect(api.callsTo('POST', '/system/shutdown')).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Go back' }));
    expect(api.callsTo('POST', '/system/shutdown')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Force stop' }));
    await user.click(screen.getByRole('button', { name: 'Confirm force stop' }));
    expect(
      await screen.findByRole('heading', { name: 'Gateway is force stopping' }),
    ).toBeInTheDocument();
    expect(api.callsTo('POST', '/system/shutdown').map((call) => call.body)).toEqual([
      { action: 'force' },
    ]);
    expect(
      api.callsTo('POST', '/system/shutdown')[0]?.headers.get('x-graphgoblin-shutdown-token'),
    ).toBe('fake-awaiting-choice');
  });

  it('requires fresh confirmation when another tab reports failed cleanup', async () => {
    const user = userEvent.setup();
    const { api, change } = fixture();
    const view = renderWith(<ShutdownNotice />, '/', api);
    await user.click(await screen.findByRole('button', { name: 'Force stop' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    change(state('force-failed'));
    await act(() => view.queryClient.invalidateQueries({ queryKey: ['gateway-shutdown'] }));
    await screen.findByRole('button', { name: 'Force exit' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.callsTo('POST', '/system/shutdown')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Force exit' }));
    await user.click(screen.getByRole('button', { name: 'Confirm force exit' }));
    expect(
      api.callsTo('POST', '/system/shutdown')[0]?.headers.get('x-graphgoblin-shutdown-token'),
    ).toBe('fake-force-failed');
  });

  it('requires fresh confirmation after a gateway incarnation change even in the same phase', async () => {
    const user = userEvent.setup();
    const { api, change } = fixture();
    const view = renderWith(<ShutdownNotice />, '/', api);
    await user.click(await screen.findByRole('button', { name: 'Force stop' }));
    change({ ...state(), controlToken: 'new-gateway-token' });
    await act(() => view.queryClient.invalidateQueries({ queryKey: ['gateway-shutdown'] }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.callsTo('POST', '/system/shutdown')).toHaveLength(0);
  });

  it('keeps keyboard focus on the notice after a sent choice, and on the page when the notice leaves', async () => {
    const user = userEvent.setup();
    const { api, change } = fixture();
    const view = renderWith(
      <>
        <h1>Loops</h1>
        <ShutdownNotice />
      </>,
      '/',
      api,
    );
    await user.click(await screen.findByRole('button', { name: 'Force stop' }));
    await user.click(screen.getByRole('button', { name: 'Confirm force stop' }));
    const forcing = await screen.findByRole('heading', { name: 'Gateway is force stopping' });
    expect(document.activeElement).toBe(forcing);
    change(state('draining'));
    await act(() => view.queryClient.invalidateQueries({ queryKey: ['gateway-shutdown'] }));
    await user.click(await screen.findByRole('button', { name: 'Keep waiting' }));
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: 'Gateway is draining' }),
    );
    // The gateway is running again: the notice leaves and focus goes to the page heading.
    change(state('running'));
    await act(() => view.queryClient.invalidateQueries({ queryKey: ['gateway-shutdown'] }));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Gateway shutdown' })).not.toBeInTheDocument(),
    );
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Loops' }));
  });

  it('keeps keyboard focus on the notice when a newer state replaces an open confirmation', async () => {
    const user = userEvent.setup();
    const { api, change } = fixture();
    const view = renderWith(<ShutdownNotice />, '/', api);
    await user.click(await screen.findByRole('button', { name: 'Force stop' }));
    change({ ...state('draining'), controlToken: 'after-another-wait' });
    await act(() => view.queryClient.invalidateQueries({ queryKey: ['gateway-shutdown'] }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: 'Gateway is draining' }),
    );
    // Ordinary dismissal still returns focus to the opener.
    await user.click(screen.getByRole('button', { name: 'Force stop' }));
    await user.click(screen.getByRole('button', { name: 'Go back' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Force stop' }));
  });

  it('refuses malformed shutdown snapshots rather than sending an unguarded choice', async () => {
    const { api } = fixture();
    const malformed: Partial<State> = state();
    delete malformed.controlToken;
    api.override('GET /system/shutdown', () => Response.json(malformed));
    renderWith(<ShutdownNotice />, '/', api);
    expect(
      await screen.findByRole('heading', { name: 'Cannot read gateway shutdown state' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Force stop' })).not.toBeInTheDocument();
  });

  it('offers a further confirmed force after failed cleanup and explains lock reclamation', async () => {
    const user = userEvent.setup();
    const { api } = fixture(state('force-failed'));
    api.override('POST /system/shutdown', () => Response.json(state('exiting'), { status: 202 }));
    renderWith(<ShutdownNotice />, '/', api);
    await user.click(await screen.findByRole('button', { name: 'Force exit' }));
    expect(
      within(screen.getByRole('dialog')).getByText(/lock stays for next-start reclamation/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm force exit' }));
    expect(
      await screen.findByRole('heading', { name: 'Gateway is exiting after failed cleanup' }),
    ).toBeInTheDocument();
  });

  it('shows 409 current state from a stale second tab without repeating the action', async () => {
    const user = userEvent.setup();
    const { api, change } = fixture();
    const a = renderWith(<ShutdownNotice />, '/', api);
    const b = renderWith(<ShutdownNotice />, '/', api);
    await within(a.container).findByRole('button', { name: 'Keep waiting' });
    await within(b.container).findByRole('button', { name: 'Keep waiting' });
    // Another control won the transition while this tab still displays its prior snapshot.
    change(state('forcing'));
    api.override('POST /system/shutdown', () => Response.json(state('forcing'), { status: 409 }));
    await user.click(within(b.container).getByRole('button', { name: 'Keep waiting' }));
    expect(
      await within(b.container).findByText(/Shutdown changed in another tab/),
    ).toBeInTheDocument();
    expect(
      within(b.container).getByRole('heading', { name: 'Gateway is force stopping' }),
    ).toBeInTheDocument();
    await act(() => a.queryClient.invalidateQueries({ queryKey: ['gateway-shutdown'] }));
    expect(
      await within(a.container).findByRole('heading', { name: 'Gateway is force stopping' }),
    ).toBeInTheDocument();
    expect(api.callsTo('POST', '/system/shutdown')).toHaveLength(1);
  });

  it('shows running truthfully when a stale choice meets a restarted gateway', async () => {
    const user = userEvent.setup();
    const { api, change } = fixture();
    renderWith(<ShutdownNotice />, '/', api);
    await screen.findByRole('button', { name: 'Keep waiting' });
    change(state('running'));
    api.override('POST /system/shutdown', () => Response.json(state('running'), { status: 409 }));
    await user.click(screen.getByRole('button', { name: 'Keep waiting' }));
    expect(await screen.findByRole('heading', { name: 'Gateway is running' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Force stop' })).not.toBeInTheDocument();
  });

  it('stops shutdown polling after connection closure and allows an explicit read to recover', async () => {
    const user = userEvent.setup();
    const { api } = fixture();
    const view = renderWith(<ShutdownNotice />, '/', api);
    await screen.findByRole('button', { name: 'Keep waiting' });
    api.override('GET /system/shutdown', () => {
      throw new TypeError('connection reset');
    });
    await act(() => view.queryClient.invalidateQueries({ queryKey: ['gateway-shutdown'] }));
    expect(
      await screen.findByRole('heading', { name: 'Gateway stopped or disconnected' }),
    ).toBeInTheDocument();
    const count = api.callsTo('GET', '/system/shutdown').length;
    await new Promise((done) => setTimeout(done, 2100));
    expect(api.callsTo('GET', '/system/shutdown')).toHaveLength(count);
    api.override('GET /system/shutdown', () => Response.json(state('running')));
    await user.click(screen.getByRole('button', { name: 'Check gateway state' }));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Gateway shutdown' })).not.toBeInTheDocument(),
    );
  });

  it('reports a stopped or disconnected gateway when a quick drain finishes between status polls', async () => {
    const { api } = fixture(state('running'));
    const view = renderWith(<ShutdownNotice />, '/', api);
    await waitFor(() =>
      expect(view.queryClient.getQueryData<State>(['gateway-shutdown'])?.phase).toBe('running'),
    );
    api.override('GET /system/shutdown', () => {
      throw new TypeError('listener already closed');
    });
    await act(() => view.queryClient.invalidateQueries({ queryKey: ['gateway-shutdown'] }));
    expect(
      await screen.findByRole('heading', { name: 'Gateway stopped or disconnected' }),
    ).toBeInTheDocument();
    expect(api.callsTo('POST', '/system/shutdown')).toHaveLength(0);
  });

  it('observes connection closure after readiness rather than staying at stopping forever', async () => {
    const { api } = fixture(state('ready'));
    renderWith(<ShutdownNotice />, '/', api);
    await screen.findByRole('heading', { name: 'Gateway is stopping' });
    api.override('GET /system/shutdown', () => {
      throw new TypeError('listener closed');
    });
    expect(
      await screen.findByRole(
        'heading',
        { name: 'Gateway stopped or disconnected' },
        { timeout: 4000 },
      ),
    ).toBeInTheDocument();
    expect(api.callsTo('POST', '/system/shutdown')).toHaveLength(0);
  });

  it('does not retry an action whose network outcome is unknown', async () => {
    const user = userEvent.setup();
    const { api } = fixture();
    api.override('POST /system/shutdown', () => {
      throw new TypeError('lost response');
    });
    renderWith(<ShutdownNotice />, '/', api);
    await user.click(await screen.findByRole('button', { name: 'Keep waiting' }));
    expect(await screen.findByText(/action outcome is unknown/)).toBeInTheDocument();
    expect(api.callsTo('POST', '/system/shutdown')).toHaveLength(1);
  });

  it('explains refused actions without claiming an unknown outcome', async () => {
    const user = userEvent.setup();
    const { api } = fixture();
    api.override('POST /system/shutdown', () => problem(403, 'FORBIDDEN'));
    renderWith(<ShutdownNotice />, '/', api);
    await user.click(await screen.findByRole('button', { name: 'Keep waiting' }));
    expect(await screen.findByText(/Actions require system:write permission/)).toBeInTheDocument();
    expect(api.callsTo('POST', '/system/shutdown')).toHaveLength(1);
  });

  it('stays absent for a key that cannot read shutdown state while the gateway runs', async () => {
    const { api } = fixture(state('running'));
    api.override('GET /system/shutdown', () => problem(403, 'FORBIDDEN'));
    renderWith(<ShutdownNotice />, '/', api);
    await waitFor(() => expect(api.callsTo('GET', '/system/shutdown')).toHaveLength(1));
    expect(screen.queryByRole('region', { name: 'Gateway shutdown' })).not.toBeInTheDocument();
  });

  it('shows read failures and retains identities when names cannot be read', async () => {
    const { api } = fixture(state('draining'));
    api.override('GET /runs/:id', () => problem(403, 'FORBIDDEN'));
    const view = renderWith(<ShutdownNotice />, '/', api);
    expect(await screen.findByRole('link', { name: 'active-run' })).toHaveAttribute(
      'href',
      '/runs/active-run',
    );
    api.override('GET /system/shutdown', () => problem(403, 'FORBIDDEN'));
    await act(() => view.queryClient.invalidateQueries({ queryKey: ['gateway-shutdown'] }));
    expect(
      await screen.findByRole('heading', { name: 'Cannot read gateway shutdown state' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Force stop' })).not.toBeInTheDocument();
  });

  it('explains empty work and unconfirmed identities', async () => {
    const current = state('draining');
    current.activeRunIds = [];
    const { api } = fixture(current);
    const view = renderWith(<ShutdownNotice />, '/', api);
    expect(await screen.findByText(/No active run identities reported/)).toBeInTheDocument();
    current.unconfirmedRunIds = ['unconfirmed-run'];
    await act(() => view.queryClient.invalidateQueries({ queryKey: ['gateway-shutdown'] }));
    expect(await screen.findByRole('link', { name: /unconfirmed-run/ })).toBeInTheDocument();
  });

  it('persists across app navigation and sends no action on navigation or unmount', async () => {
    const user = userEvent.setup();
    const { api } = fixture(state('draining'));
    const view = renderApp('/loops', api);
    await screen.findByRole('heading', { name: 'Gateway is draining' });
    await user.click(screen.getByRole('link', { name: 'Events' }));
    expect(screen.getByRole('heading', { name: 'Gateway is draining' })).toBeInTheDocument();
    view.unmount();
    expect(api.callsTo('POST', '/system/shutdown')).toHaveLength(0);
  });
});
