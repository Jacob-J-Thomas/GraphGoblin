import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FakeApi, TS } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import { usePwaStore } from '../pwa/store.js';

describe('App shell', () => {
  it('redirects to loops and navigates between screens', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    api.inbound = [
      {
        id: 'e1',
        ownerId: 'local',
        type: 'build.done',
        payload: { ok: true },
        receivedAt: TS,
        dedupeKey: 'b1',
        source: 'webhook:ep1',
        runIds: ['01ARZ3NDEKTSV4RRFFQ69G5FAV'],
      },
      {
        id: 'e2',
        ownerId: 'local',
        type: 'ping',
        payload: null,
        receivedAt: TS,
        source: 'run:01ARZ3NDEKTSV4RRFFQ69G5FAW',
        runIds: [],
      },
      {
        id: 'e3',
        ownerId: 'local',
        type: 'pong',
        payload: 1,
        receivedAt: TS,
        source: 'api',
        runIds: [],
      },
    ];
    renderApp('/', api);
    expect(await screen.findByRole('heading', { name: 'Loops' })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Events' }));
    expect(await screen.findByText('build.done')).toBeInTheDocument();
    expect(screen.getByText('b1')).toBeInTheDocument();
    expect(screen.getByText('webhook delivery')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '01ARZ3NDEKTSV4RRFFQ69G5FAV' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'run 9G5FAW' })).toBeInTheDocument();
    expect(screen.getByText('api')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Runs' }));
    expect(await screen.findByRole('heading', { name: 'Runs' })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Settings' }));
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  });

  it('shows an empty events list and unknown pages', async () => {
    renderApp('/events');
    expect(await screen.findByText('No inbound events yet.')).toBeInTheDocument();
    renderApp('/nowhere');
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Loops' })).toHaveAttribute('href', '/loops');
  });

  it('shows an offline banner while the browser is offline', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderApp('/loops');
    expect(await screen.findByText('You are offline')).toBeInTheDocument();
    online.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(screen.queryByText('You are offline')).not.toBeInTheDocument());
  });

  it('distinguishes an unreachable API from browser offline and clears both on recovery', async () => {
    const api = new FakeApi();
    api.override('GET /healthz', () => new Response('ok'));
    api.offline = true;
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    renderApp('/loops', api);
    expect(await screen.findByText('Cannot reach the GraphGoblin API')).toBeInTheDocument();
    expect(screen.queryByText('You are offline')).not.toBeInTheDocument();
    online.mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(await screen.findByText('You are offline')).toBeInTheDocument();
    expect(screen.queryByText('Cannot reach the GraphGoblin API')).not.toBeInTheDocument();
    api.offline = false;
    online.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => {
      expect(screen.queryByText('Cannot reach the GraphGoblin API')).not.toBeInTheDocument();
      expect(screen.queryByText('You are offline')).not.toBeInTheDocument();
    });
  });

  it('shows the update toast and updates only after confirmation', async () => {
    const user = userEvent.setup();
    const apply = vi.fn();
    renderApp('/loops');
    expect(screen.queryByText('A new version is available')).not.toBeInTheDocument();
    act(() => usePwaStore.getState().promptUpdate(apply));
    expect(await screen.findByText('A new version is available')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByText('A new version is available')).not.toBeInTheDocument();
    expect(apply).not.toHaveBeenCalled();
    act(() => usePwaStore.getState().promptUpdate(apply));
    await user.click(await screen.findByRole('button', { name: 'Update' }));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('A new version is available')).not.toBeInTheDocument();
  });
});
