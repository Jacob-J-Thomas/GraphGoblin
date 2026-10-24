import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useNavigate } from 'react-router';
import { useIsMutating } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../app/App.js';
import { FakeApi, TS } from '../__fixtures__/fake-api.js';
import { renderApp, renderWith } from '../__fixtures__/render.js';

function event(id: string) {
  return {
    id,
    ownerId: 'local',
    type: 'chosen',
    payload: id,
    source: 'api',
    receivedAt: TS,
    runIds: [],
  };
}

// A browser Back control supplied through the router's public navigation interface.
function Back() {
  const navigate = useNavigate();
  const pending = useIsMutating();
  return (
    <>
      <button onClick={() => void navigate(-1)}>Back</button>
      <output data-testid="pending-refreshes">{pending}</output>
    </>
  );
}

function rowIds() {
  return screen.getAllByTestId(/^payload-/).map((node) => node.getAttribute('data-testid'));
}

async function refresh(user: ReturnType<typeof userEvent.setup>) {
  const button = screen.getByRole('button', { name: 'Refresh' });
  await waitFor(() => expect(button).toHaveAttribute('aria-busy', 'false'));
  await user.click(button);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Events refresh races (#240)', () => {
  it.each(['filter change', 'page unmount'] as const)(
    'drops Refresh A after %s, Back, Refresh B and paging',
    async (leave) => {
      const api = new FakeApi();
      const user = userEvent.setup();
      api.inbound = Array.from({ length: 201 }, (_, i) => event(`row-${200 - i}`));
      const path = '/events?type=chosen&before=2099-01-01T00%3A00%3A00.000Z&keep=reader';
      const view = renderWith(
        <>
          <App />
          <Back />
        </>,
        path,
        api,
      );
      let release: (() => void) | undefined;
      try {
        await user.click(await screen.findByRole('button', { name: 'Load more' }));
        await screen.findByTestId('payload-row-60');
        let hold = true;
        api.override('GET /events', (call) => {
          if (!hold || call.search.has('cursor') || call.search.has('limit'))
            return api.builtIn(call);
          hold = false;
          const response = api.builtIn(call);
          return new Promise<Response>((resolve) => {
            release = () => resolve(response);
          });
        });
        await refresh(user);
        await waitFor(() => expect(release).toBeDefined());
        if (leave === 'filter change') {
          await user.click(screen.getByRole('button', { name: 'Clear type filter' }));
          await waitFor(() =>
            expect(screen.getByTestId('location')).not.toHaveTextContent('type=chosen'),
          );
        } else {
          await user.click(screen.getByRole('link', { name: 'Runs' }));
          await screen.findByRole('heading', { name: 'Runs', level: 1 });
        }
        await user.click(screen.getByRole('button', { name: 'Back' }));
        await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(path));
        api.inbound.unshift({ ...event('winner'), receivedAt: '2098-01-01T00:00:00.000Z' });
        await refresh(user);
        await screen.findByTestId('payload-winner');
        await user.click(screen.getByRole('button', { name: 'Load more' }));
        await screen.findByTestId('payload-row-60');
        const winningRows = rowIds();
        expect(winningRows).toHaveLength(200);
        // The public hook renders after mutation/query notifications reach React. A cache
        // settlement callback alone runs before the page has received those notifications.
        await waitFor(() =>
          expect(screen.getByTestId('pending-refreshes')).toHaveTextContent(/^1$/),
        );
        await act(() => Promise.resolve(release?.()));
        await waitFor(() =>
          expect(screen.getByTestId('pending-refreshes')).toHaveTextContent(/^0$/),
        );
        expect(rowIds()).toEqual(winningRows);
        expect(screen.getByTestId('payload-winner')).toBeInTheDocument();
        expect(screen.getByTestId('location')).toHaveTextContent(path);
      } finally {
        release?.();
        view.unmount();
        view.queryClient.clear();
      }
    },
  );

  it.each([0, 99])(
    'updates a pending row at loaded index %i despite 501 tied head arrivals',
    async (index) => {
      const api = new FakeApi();
      const user = userEvent.setup();
      api.inbound = Array.from({ length: 101 }, (_, i) => event(`receipt-${i}`));
      const pending = api.inbound[index]!;
      api.inbound[index] = { ...pending, delivery: { state: 'pending', attempts: 0 } };
      const view = renderApp('/events?type=chosen', api);
      try {
        await screen.findByText('Pending admission');
        const before = rowIds();
        expect(before).toHaveLength(100);
        api.inbound[index] = { ...pending, delivery: { state: 'admitted', attempts: 0 } };
        api.inbound.unshift(...Array.from({ length: 501 }, (_, i) => event(`arrival-${i}`)));
        await act(async () => {
          await vi.advanceTimersByTimeAsync(2_000);
        });
        expect(await screen.findByText('Admitted', undefined, { timeout: 5_000 })).toBeVisible();
        expect(rowIds()).toEqual(before);
        const reads = api
          .callsTo('GET', '/events')
          .filter((call) => call.search.has('anchor')).length;
        await act(async () => {
          await vi.advanceTimersByTimeAsync(4_000);
        });
        expect(
          api.callsTo('GET', '/events').filter((call) => call.search.has('anchor')),
        ).toHaveLength(reads);
        await user.click(screen.getByRole('button', { name: 'Load more' }));
        await screen.findByTestId('payload-receipt-100');
        expect(rowIds()).toHaveLength(101);
        expect(new Set(rowIds()).size).toBe(101);
        const continuation = api
          .callsTo('GET', '/events')
          .filter((call) => call.search.has('cursor'))
          .at(-1)!;
        expect(continuation.search.get('cursor')).toBe('receipt-99');
      } finally {
        view.unmount();
        view.queryClient.clear();
      }
    },
  );
});
