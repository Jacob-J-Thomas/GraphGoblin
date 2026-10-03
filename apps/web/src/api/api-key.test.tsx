import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeApi } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import { API_KEY_STORAGE, useApiKeyStore } from './api-key.js';

afterEach(() => useApiKeyStore.setState({ key: undefined, rejected: false }));

describe('API key entry', () => {
  it('asks for a key on a 401, sends the stored key, and lets Settings forget it', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    api.requiredKey = 'gg_good';
    api.addLoop({
      schemaVersion: 1,
      name: 'guarded loop',
      nodes: [
        { id: 'start', kind: 'trigger', label: 'Start', config: { subtype: 'manual' } },
        { id: 'done', kind: 'exit', label: 'Done', config: {} },
      ],
      edges: [{ id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'done' } }],
    });
    const view = renderApp('/loops', api);

    expect(await screen.findByText('API key required')).toBeInTheDocument();
    expect(screen.getByText(/requires an API key/)).toBeInTheDocument();

    await user.type(screen.getByLabelText('API key'), 'gg_wrong');
    await user.click(screen.getByRole('button', { name: 'Use key' }));
    expect(await screen.findByText(/refused the key stored in this browser/)).toBeInTheDocument();
    expect(localStorage.getItem(API_KEY_STORAGE)).toBe('gg_wrong');

    await user.type(screen.getByLabelText('API key'), '  gg_good ');
    await user.click(screen.getByRole('button', { name: 'Use key' }));
    expect(await screen.findByText('guarded loop')).toBeInTheDocument();
    expect(screen.queryByText('API key required')).toBeNull();
    expect(api.calls.at(-1)?.headers.get('authorization')).toBe('Bearer gg_good');
    view.unmount();

    renderApp('/settings', api);
    await user.click(await screen.findByRole('button', { name: 'Forget key' }));
    expect(localStorage.getItem(API_KEY_STORAGE)).toBeNull();
    await waitFor(() => expect(screen.getByText(/No key is stored/)).toBeInTheDocument());
  });

  it('reads a key stored by an earlier session', async () => {
    localStorage.setItem(API_KEY_STORAGE, 'gg_saved');
    vi.resetModules();
    const { useApiKeyStore: fresh } = await import('./api-key.js');
    expect(fresh.getState().key).toBe('gg_saved');
  });
});
