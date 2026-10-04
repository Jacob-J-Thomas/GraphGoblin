import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeApi, problem, TS } from '../../__fixtures__/fake-api.js';
import { renderApp } from '../../__fixtures__/render.js';
import { API_KEY_STORAGE, useApiKeyStore } from '../../api/api-key.js';
import { keys } from '../../api/queries.js';

const warning =
  'Revoking this key will sign this browser out and show the API key panel. Enter another valid key to continue.';
const storedWarning =
  'This browser still sends a stored API key. If this is that key, revoking it signs this browser out and shows the API key panel; Forget key in Settings also clears it.';
function seeded() {
  const api = new FakeApi();
  api.apiKeyList = ['A', 'B'].map((label) => ({
    id: label,
    ownerId: 'local',
    label,
    scopes: ['*'],
    createdAt: TS,
    current: label === 'A',
  }));
  return api;
}
function row(label: string) {
  return screen.getByRole('button', { name: `Revoke ${label}` }).closest('li')!;
}
function json(items: FakeApi['apiKeyList']) {
  return new Response(JSON.stringify({ items }), {
    headers: { 'content-type': 'application/json' },
  });
}
afterEach(() => {
  useApiKeyStore.setState({ key: undefined, rejected: false });
  localStorage.removeItem(API_KEY_STORAGE);
});

describe('current browser key in Settings', () => {
  it('marks A and revokes B without the browser warning or losing access', async () => {
    useApiKeyStore.getState().save('gg_A');
    const api = seeded();
    renderApp('/settings', api);
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Revoke A' });
    expect(within(row('A')).getByText('This browser')).toBeInTheDocument();
    expect(within(row('B')).queryByText('This browser')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Revoke B' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'Clients using this API key will get 401 immediately.',
    );
    expect(screen.getByRole('alertdialog')).not.toHaveTextContent(warning);
    expect(screen.getByRole('alertdialog')).not.toHaveTextContent(storedWarning);
    await user.click(screen.getByRole('button', { name: 'Confirm revoke B' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Revoke B' })).not.toBeInTheDocument(),
    );
    expect(within(row('A')).getByText('This browser')).toBeInTheDocument();
    expect(screen.queryByLabelText('API key', { selector: 'input' })).not.toBeInTheDocument();
    expect(useApiKeyStore.getState().rejected).toBe(false);
  });

  it('warns on A, closes after DELETE, and focuses the key panel on the rejected refresh', async () => {
    useApiKeyStore.getState().save('gg_A');
    const api = seeded();
    api.requiredKey = 'gg_A';
    api.override('DELETE /api-keys/:id', () => {
      api.requiredKey = 'gg_replacement';
      return new Response(null, { status: 204 });
    });
    renderApp('/settings', api);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Revoke A' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent(warning);
    expect(screen.getByRole('alertdialog')).not.toHaveTextContent(storedWarning);
    expect(screen.getByRole('button', { name: 'Keep' })).toHaveFocus();
    await user.tab();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByLabelText('API key')).toHaveFocus());
    expect(api.callsTo('DELETE', '/api-keys/A')).toHaveLength(1);
  });

  it.each([undefined, 'gg_stored'])(
    'shows the softer trusted-mode warning only when a key is stored, key=%s',
    async (key) => {
      useApiKeyStore.setState({ key });
      const api = seeded();
      api.apiKeyList = api.apiKeyList.map((item) => ({ ...item, current: false }));
      renderApp('/settings', api);
      const user = userEvent.setup();
      await screen.findByRole('button', { name: 'Revoke A' });
      for (const label of ['A', 'B']) {
        await user.click(screen.getByRole('button', { name: `Revoke ${label}` }));
        if (key) expect(screen.getByRole('alertdialog')).toHaveTextContent(storedWarning);
        else expect(screen.getByRole('alertdialog')).not.toHaveTextContent(storedWarning);
        await user.click(screen.getByRole('button', { name: 'Keep' }));
      }
      await user.click(screen.getByRole('button', { name: 'Revoke A' }));
      expect(screen.queryByText('This browser')).not.toBeInTheDocument();
      expect(screen.getByRole('alertdialog')).not.toHaveTextContent(warning);
      expect(screen.getByRole('alertdialog')).toHaveTextContent('401 immediately');
    },
  );

  it('recovers with Forget key after revoking the stored key in trusted mode', async () => {
    useApiKeyStore.getState().save('gg_A');
    const api = seeded();
    api.apiKeyList = api.apiKeyList.map((item) => ({ ...item, current: false }));
    let revoked = false;
    api.override('GET /api-keys', (call) =>
      revoked && call.headers.get('authorization') === 'Bearer gg_A'
        ? problem(401, 'UNAUTHORIZED', 'The presented key is revoked.')
        : json(api.apiKeyList),
    );
    api.override('DELETE /api-keys/:id', () => {
      revoked = true;
      api.apiKeyList[0]!.revokedAt = TS;
      return new Response(null, { status: 204 });
    });
    renderApp('/settings', api);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Revoke A' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent(storedWarning);
    expect(screen.getByRole('alertdialog')).not.toHaveTextContent(warning);
    await user.click(screen.getByRole('button', { name: 'Confirm revoke A' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByLabelText('API key')).toHaveFocus());
    await user.click(screen.getByRole('button', { name: 'Forget key' }));
    await screen.findByRole('button', { name: 'Revoke B' });
    expect(screen.queryByRole('heading', { name: 'API key required' })).not.toBeInTheDocument();
    expect(useApiKeyStore.getState().key).toBeUndefined();
  });

  it.each(['save', 'storage'] as const)(
    'refreshes the marker after %s without a token in a query key',
    async (change) => {
      useApiKeyStore.getState().save('gg_A');
      const api = seeded();
      api.override('GET /api-keys', (call) =>
        json(
          api.apiKeyList.map((item) => ({
            ...item,
            current: call.headers.get('authorization') === `Bearer gg_${item.id}`,
          })),
        ),
      );
      const view = renderApp('/settings', api);
      await screen.findByRole('button', { name: 'Revoke A' });
      expect(within(row('A')).getByText('This browser')).toBeInTheDocument();
      act(() => {
        if (change === 'save') useApiKeyStore.getState().save('gg_B');
        else {
          localStorage.setItem(API_KEY_STORAGE, 'gg_B');
          window.dispatchEvent(new StorageEvent('storage', { key: API_KEY_STORAGE }));
        }
      });
      await waitFor(() => expect(within(row('B')).getByText('This browser')).toBeInTheDocument());
      expect(within(row('A')).queryByText('This browser')).not.toBeInTheDocument();
      expect(view.queryClient.getQueryCache().find({ queryKey: keys.apiKeys })?.queryKey).toEqual([
        'api-keys',
      ]);
      expect(
        JSON.stringify(
          view.queryClient
            .getQueryCache()
            .getAll()
            .map((query) => query.queryKey),
        ),
      ).not.toMatch(/gg_A|gg_B/);
    },
  );

  it('describes the current key on its Revoke button for keyboard and screen-reader users', async () => {
    renderApp('/settings', seeded());
    const button = await screen.findByRole('button', { name: 'Revoke A' });
    expect(button).toHaveAccessibleDescription('This browser');
    expect(screen.getByRole('button', { name: 'Revoke B' })).not.toHaveAttribute(
      'aria-describedby',
    );
    button.focus();
    expect(button).toHaveFocus();
  });

  it('separates current and revoked badges on an already accepted list response', async () => {
    const api = seeded();
    api.apiKeyList[0]!.revokedAt = TS;
    renderApp('/settings', api);
    const badge = await screen.findByText('This browser');
    expect(badge.closest('li')).toHaveTextContent('revoked This browser');
    expect(screen.queryByRole('button', { name: 'Revoke A' })).not.toBeInTheDocument();
  });

  it('closes an open Revoke dialog when another tab changes the key and the list reloads', async () => {
    useApiKeyStore.getState().save('gg_A');
    const api = seeded();
    let finish!: () => void;
    const held = new Promise<void>((resolve) => {
      finish = resolve;
    });
    api.override('GET /api-keys', async (call) => {
      if (call.headers.get('authorization') === 'Bearer gg_B') await held;
      return json(
        api.apiKeyList.map((item) => ({
          ...item,
          current: call.headers.get('authorization') === `Bearer gg_${item.id}`,
        })),
      );
    });
    renderApp('/settings', api);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Revoke A' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    act(() => {
      localStorage.setItem(API_KEY_STORAGE, 'gg_B');
      window.dispatchEvent(new StorageEvent('storage', { key: API_KEY_STORAGE }));
    });
    try {
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
      expect(api.calls.filter((call) => call.method === 'DELETE')).toHaveLength(0);
      await act(async () => {
        finish();
        await held;
      });
      await waitFor(() => expect(within(row('B')).getByText('This browser')).toBeInTheDocument());
    } finally {
      await act(async () => {
        finish();
        await held;
      });
    }
  });

  it('ignores a late 401 from A after a storage event saves B, and aborts the old list query', async () => {
    useApiKeyStore.getState().save('gg_A');
    const api = seeded();
    let finish!: () => void;
    const held = new Promise<void>((resolve) => {
      finish = resolve;
    });
    // Deliberately answer even after cancellation to cover a transport that delivers a late 401.
    api.override('GET /api-keys', async (call) => {
      if (call.headers.get('authorization') === 'Bearer gg_A') {
        await held;
        return new Response(null, { status: 401 });
      }
      return json(api.apiKeyList.map((item) => ({ ...item, current: item.id === 'B' })));
    });
    const fetch = api.fetch;
    const requests: Request[] = [];
    api.fetch = vi.fn((request: Request) => {
      requests.push(request);
      return fetch(request);
    });
    renderApp('/settings', api);
    try {
      await waitFor(() => expect(api.callsTo('GET', '/api-keys')).toHaveLength(1));
      const oldRequest = requests.find((request) => new URL(request.url).pathname === '/api-keys')!;
      act(() => {
        localStorage.setItem(API_KEY_STORAGE, 'gg_B');
        window.dispatchEvent(new StorageEvent('storage', { key: API_KEY_STORAGE }));
      });
      await waitFor(() => expect(within(row('B')).getByText('This browser')).toBeInTheDocument());
      await act(async () => {
        finish();
        await held;
      });
      expect(useApiKeyStore.getState().rejected).toBe(false);
      expect(screen.queryByRole('heading', { name: 'API key required' })).not.toBeInTheDocument();
      expect(within(row('B')).getByText('This browser')).toBeInTheDocument();
      expect(oldRequest.signal.aborted).toBe(true);
    } finally {
      await act(async () => {
        finish();
        await held;
      });
    }
  });

  it('discards an old in-flight list when the stored key changes during initial loading', async () => {
    useApiKeyStore.getState().save('gg_A');
    const api = seeded();
    let finish!: () => void;
    const held = new Promise<void>((resolve) => {
      finish = resolve;
    });
    api.override('GET /api-keys', async (call) => {
      const items = api.apiKeyList.map((item) => ({
        ...item,
        current: call.headers.get('authorization') === `Bearer gg_${item.id}`,
      }));
      if (call.headers.get('authorization') === 'Bearer gg_A') await held;
      return json(items);
    });
    renderApp('/settings', api);
    try {
      await waitFor(() => expect(api.callsTo('GET', '/api-keys')).toHaveLength(1));
      act(() => useApiKeyStore.getState().save('gg_B'));
      await waitFor(() => expect(within(row('B')).getByText('This browser')).toBeInTheDocument());
      await act(() => Promise.resolve(finish()));
      expect(within(row('A')).queryByText('This browser')).not.toBeInTheDocument();
      expect(within(row('B')).getByText('This browser')).toBeInTheDocument();
    } finally {
      await act(() => Promise.resolve(finish()));
    }
  });
});
