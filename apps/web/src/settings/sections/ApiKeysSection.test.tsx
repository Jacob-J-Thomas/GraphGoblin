import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeApi, TS } from '../../__fixtures__/fake-api.js';
import { renderApp } from '../../__fixtures__/render.js';
import { API_KEY_STORAGE, useApiKeyStore } from '../../api/api-key.js';
import { keys } from '../../api/queries.js';

const warning =
  'Revoking this key will sign this browser out and show the API key panel. Enter another valid key to continue.';
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
    expect(screen.getByRole('button', { name: 'Keep' })).toHaveFocus();
    await user.tab();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByLabelText('API key')).toHaveFocus());
    expect(api.callsTo('DELETE', '/api-keys/A')).toHaveLength(1);
  });

  it.each([undefined, 'gg_stored'])(
    'shows no marker or browser warning in trusted mode with key=%s',
    async (key) => {
      useApiKeyStore.setState({ key });
      const api = seeded();
      api.apiKeyList = api.apiKeyList.map((item) => ({ ...item, current: false }));
      renderApp('/settings', api);
      await userEvent.setup().click(await screen.findByRole('button', { name: 'Revoke A' }));
      expect(screen.queryByText('This browser')).not.toBeInTheDocument();
      expect(screen.getByRole('alertdialog')).not.toHaveTextContent(warning);
      expect(screen.getByRole('alertdialog')).toHaveTextContent('401 immediately');
    },
  );

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
