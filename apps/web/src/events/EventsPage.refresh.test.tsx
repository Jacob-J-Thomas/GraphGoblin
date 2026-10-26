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

async function refreshEvents(user: ReturnType<typeof userEvent.setup>) {
  const button = screen.getByRole('button', { name: 'Refresh' });
  await waitFor(() => {
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute('aria-disabled', 'true');
  });
  await user.click(button);
}

async function checkForNewEvents() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_000);
  });
}

// Drive the polling cadence explicitly; user input and async rendering keep real timers.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Events manual refresh (#240)', () => {
  it('announces arrivals on an older page without replacing rows, then refreshes and pages with filters intact', async () => {
    const api = new FakeApi();
    const user = userEvent.setup();
    api.inbound = Array.from({ length: 101 }, (_, i) => event(`event-${100 - i}`));
    api.inbound[0] = { ...api.inbound[0]!, delivery: { state: 'pending', attempts: 0 } };
    const path = '/events?type=chosen&before=2099-01-01T00%3A00%3A00.000Z';
    const view = renderApp(path, api);
    await user.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('All events loaded.')).toBeInTheDocument();
    const oldRow = screen.getByTestId('payload-event-0');
    oldRow.focus();
    api.inbound.unshift(event('new-arrival'), event('excluded', 'other'));
    await checkForNewEvents();
    expect(
      await screen.findByText('New events available', undefined, { timeout: 5_000 }),
    ).toBeVisible();
    expect(oldRow).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(102);
    expect(screen.queryByTestId('payload-new-arrival')).not.toBeInTheDocument();
    // Focus/reconnect cannot replace the reading snapshot either.
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(oldRow).toBeInTheDocument();
    await refreshEvents(user);
    expect(await screen.findByTestId('payload-new-arrival')).toBeVisible();
    expect(screen.queryByTestId('payload-event-0')).not.toBeInTheDocument();
    expect(screen.queryByTestId('payload-excluded')).not.toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(path);
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByTestId('payload-event-0')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(103);
    expect(await screen.findByText('All events loaded.')).toBeInTheDocument();
    const calls = api.callsTo('GET', '/events');
    expect(calls.every((call) => call.search.get('type') === 'chosen')).toBe(true);
    expect(calls.every((call) => call.search.get('before') === '2099-01-01T00:00:00.000Z')).toBe(
      true,
    );
    // A pending-receipt refresh or a newest-event probe may be the last request overall.
    const continuations = calls.filter((call) => call.search.has('cursor'));
    expect(continuations.at(-1)!.search.get('cursor')).toBe('event-2');
    view.unmount();
    view.queryClient.clear();
  });

  it('keeps the first page stable until Refresh and retains existing pending-receipt updates', async () => {
    const api = new FakeApi();
    const user = userEvent.setup();
    api.inbound = [{ ...event('receipt'), delivery: { state: 'pending', attempts: 0 } }];
    const view = renderApp('/events', api);
    expect(await screen.findByText('Pending admission')).toBeVisible();
    api.inbound = [
      event('new-arrival'),
      { ...event('receipt'), delivery: { state: 'admitted', attempts: 0 } },
    ];
    await checkForNewEvents();
    expect(await screen.findByText('Admitted', undefined, { timeout: 5_000 })).toBeVisible();
    expect(screen.queryByTestId('payload-new-arrival')).not.toBeInTheDocument();
    expect(
      await screen.findByText('New events available', undefined, { timeout: 5_000 }),
    ).toBeVisible();
    await refreshEvents(user);
    expect(await screen.findByTestId('payload-new-arrival')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('New events available')).not.toBeInTheDocument());
    view.unmount();
    view.queryClient.clear();
  });

  it('shows an empty filtered result and refreshes it without losing the filter', async () => {
    const api = new FakeApi();
    const user = userEvent.setup();
    api.inbound = [event('excluded', 'other')];
    const view = renderApp('/events?type=chosen', api);
    expect(await screen.findByText('No inbound events match these filters.')).toBeVisible();
    api.inbound.unshift(event('new-arrival'));
    await checkForNewEvents();
    expect(
      await screen.findByText('New events available', undefined, { timeout: 5_000 }),
    ).toBeVisible();
    expect(screen.queryByTestId('payload-new-arrival')).not.toBeInTheDocument();
    await refreshEvents(user);
    expect(await screen.findByTestId('payload-new-arrival')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/events?type=chosen');
    view.unmount();
    view.queryClient.clear();
  });

  it('retains history when an availability check fails and lets the reader refresh', async () => {
    const api = new FakeApi();
    const user = userEvent.setup();
    api.inbound = [event('loaded')];
    api.override('GET /events', (call) =>
      call.search.get('limit') === '1'
        ? new Response(JSON.stringify({ code: 'INTERNAL_ERROR', detail: 'Unavailable' }), {
            status: 500,
            headers: { 'content-type': 'application/json' },
          })
        : api.builtIn(call),
    );
    const view = renderApp('/events', api);
    expect(await screen.findByTestId('payload-loaded')).toBeInTheDocument();
    expect(
      await screen.findByText('Could not check for new events. Refresh to try again.'),
    ).toBeVisible();
    expect(screen.getByTestId('payload-loaded')).toBeInTheDocument();
    api.inbound.unshift(event('new-arrival'));
    await refreshEvents(user);
    expect(await screen.findByTestId('payload-new-arrival')).toBeInTheDocument();
    view.unmount();
    view.queryClient.clear();
  });
});
