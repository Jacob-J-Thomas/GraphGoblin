import userEvent from '@testing-library/user-event';
import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeApi, TS } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';

function event(id: string, type = 'chosen') {
  return {
    id,
    ownerId: 'local',
    type,
    payload: id,
    receivedAt: id === 'new-arrival' ? '2098-01-01T00:00:00.000Z' : TS,
    source: 'api',
    runIds: [],
  };
}

async function poll() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_000);
  });
}

async function refresh(user: ReturnType<typeof userEvent.setup>) {
  const button = screen.getByRole('button', { name: 'Refresh' });
  await waitFor(() => {
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute('aria-disabled', 'true');
  });
  await user.click(button);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Events refresh recovery and orientation (#240)', () => {
  it('keeps a late Refresh response scoped to the filters it started with', async () => {
    const api = new FakeApi();
    const user = userEvent.setup();
    api.inbound = [event('chosen-row'), event('other-row', 'other')];
    const view = renderApp('/events?type=chosen', api);
    let complete: (() => void) | undefined;
    try {
      await screen.findByTestId('payload-chosen-row');
      api.override('GET /events', (call) => {
        if (call.search.get('type') !== 'chosen' || call.search.get('limit') === '1')
          return api.builtIn(call);
        return new Promise<Response>((resolve) => {
          complete = () => resolve(api.builtIn(call));
        });
      });
      await refresh(user);
      expect(await screen.findByText('Refreshing events…')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Clear type filter' }));
      expect(await screen.findByTestId('payload-other-row')).toBeInTheDocument();
      await act(() => Promise.resolve(complete?.()));
      expect(screen.getByTestId('payload-other-row')).toBeInTheDocument();
      expect(screen.getByTestId('location')).toHaveTextContent('/events');
      expect(screen.queryByText('Showing the newest events.')).not.toBeInTheDocument();
    } finally {
      complete?.();
      view.unmount();
      view.queryClient.clear();
    }
  });

  it('keeps both loaded pages during a Refresh and after failure, then commits a successful newest page', async () => {
    const api = new FakeApi();
    const user = userEvent.setup();
    api.inbound = Array.from({ length: 201 }, (_, i) => event(`event-${200 - i}`));
    api.inbound[0] = { ...api.inbound[0]!, delivery: { state: 'pending', attempts: 0 } };
    const path = '/events?type=chosen&before=2099-01-01T00%3A00%3A00.000Z';
    const view = renderApp(path, api);
    let resolveRead: ((response: Response) => void) | undefined;
    let rejectRead: ((reason: Error) => void) | undefined;
    const held = new Promise<Response>((resolve, reject) => {
      resolveRead = resolve;
      rejectRead = reject;
    });
    try {
      await user.click(await screen.findByRole('button', { name: 'Load more' }));
      const oldRow = await screen.findByTestId('payload-event-60', undefined, { timeout: 5_000 });
      expect(screen.getAllByRole('row')).toHaveLength(201);
      let hold = true;
      let fail = true;
      api.override('GET /events', (call) => {
        if (call.search.get('limit') === '1') return api.builtIn(call);
        if (hold) {
          hold = false;
          return held;
        }
        if (fail) throw new TypeError('Failed to fetch');
        return api.builtIn(call);
      });
      await refresh(user);
      await waitFor(() => expect(hold).toBe(false));
      expect(oldRow).toBeInTheDocument();
      expect(screen.getAllByRole('row')).toHaveLength(201);
      expect(screen.getByTestId('location')).toHaveTextContent(path);
      rejectRead?.(new TypeError('Failed to fetch'));
      expect(await screen.findByText(/Refresh failed/)).toBeVisible();
      expect(oldRow).toBeInTheDocument();
      // Pending-receipt polling may also fail; it must retain the same reading snapshot.
      await poll();
      expect(oldRow).toBeInTheDocument();
      expect(screen.getAllByRole('row')).toHaveLength(201);
      fail = false;
      api.inbound.unshift(event('new-arrival'));
      await refresh(user);
      expect(await screen.findByTestId('payload-new-arrival')).toBeInTheDocument();
      expect(screen.getAllByRole('row')).toHaveLength(101);
      expect(screen.queryByTestId('payload-event-60')).not.toBeInTheDocument();
      expect(screen.queryByText(/Refresh failed/)).not.toBeInTheDocument();
      expect(screen.getByTestId('location')).toHaveTextContent(path);
      await user.click(screen.getByRole('button', { name: 'Load more' }));
      expect(await screen.findByTestId('payload-event-60')).toBeInTheDocument();
      expect(screen.getAllByRole('row')).toHaveLength(201);
    } finally {
      resolveRead?.(Response.json({ items: [], nextCursor: null }));
      view.unmount();
      view.queryClient.clear();
    }
  });

  it('clears each filter with the keyboard, preserves other parameters and returns focus to Refresh', async () => {
    const api = new FakeApi();
    const user = userEvent.setup();
    api.inbound = [event('chosen-row'), event('other-row', 'other')];
    const before = '2099-01-01T00%3A00%3A00.000Z';
    const view = renderApp(`/events?type=chosen&before=${before}&keep=reader`, api);
    try {
      await screen.findByTestId('payload-chosen-row');
      const button = screen.getByRole('button', { name: 'Refresh' });
      const typeClear = screen.getByRole('button', { name: 'Clear type filter' });
      button.focus();
      await user.tab();
      expect(typeClear).toHaveFocus();
      await user.keyboard('{Enter}');
      expect(await screen.findByTestId('payload-other-row')).toBeInTheDocument();
      expect(screen.getByTestId('location')).toHaveTextContent(
        `/events?before=${before}&keep=reader`,
      );
      expect(button).toHaveFocus();
      expect(screen.queryByRole('button', { name: 'Clear type filter' })).not.toBeInTheDocument();
      await user.tab();
      expect(screen.getByRole('button', { name: 'Clear before filter' })).toHaveFocus();
      await user.keyboard('{Enter}');
      await waitFor(() =>
        expect(screen.getByTestId('location')).toHaveTextContent('/events?keep=reader'),
      );
      expect(button).toHaveFocus();
      expect(screen.queryByRole('button', { name: 'Clear before filter' })).not.toBeInTheDocument();
    } finally {
      view.unmount();
      view.queryClient.clear();
    }
  });

  it('announces that a successful Refresh is showing the newest events in the existing live region', async () => {
    const api = new FakeApi();
    const user = userEvent.setup();
    api.inbound = [event('loaded')];
    const view = renderApp('/events', api);
    try {
      await screen.findByTestId('payload-loaded');
      await refresh(user);
      const message = await screen.findByText('Showing the newest events.');
      expect(message.closest('[role="status"]')).toBeInTheDocument();
    } finally {
      view.unmount();
      view.queryClient.clear();
    }
  });

  it('reports a failed check alongside an existing arrival notice and clears only the failure on recovery', async () => {
    const api = new FakeApi();
    api.inbound = [event('loaded')];
    let fail = false;
    api.override('GET /events', (call) => {
      if (fail && call.search.get('limit') === '1') throw new TypeError('Failed to fetch');
      return api.builtIn(call);
    });
    const view = renderApp('/events', api);
    try {
      await screen.findByTestId('payload-loaded');
      api.inbound.unshift(event('new-arrival'));
      await poll();
      const notice = await screen.findByText('New events available', undefined, { timeout: 5_000 });
      const region = notice.closest('[role="status"]');
      fail = true;
      await poll();
      await waitFor(() => expect(region).toHaveTextContent('Could not check for new events'), {
        timeout: 5_000,
      });
      expect(region).toHaveTextContent('New events available');
      expect(screen.getByTestId('payload-loaded')).toBeInTheDocument();
      expect(screen.queryByTestId('payload-new-arrival')).not.toBeInTheDocument();
      fail = false;
      await poll();
      await waitFor(() => expect(region).not.toHaveTextContent('Could not check for new events'));
      expect(region).toHaveTextContent('New events available');
    } finally {
      view.unmount();
      view.queryClient.clear();
    }
  });
});
