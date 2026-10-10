import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { event, FakeApi } from '../__fixtures__/fake-api.js';
import { renderApp } from '../__fixtures__/render.js';
import { API_KEY_STORAGE, syncApiKeyAcrossTabs, useApiKeyStore } from './api-key.js';

afterEach(() => useApiKeyStore.setState({ key: undefined, rejected: false }));

describe('API key entry', () => {
  it('review: focuses the key input when access is rejected without stealing it on later renders', async () => {
    const api = new FakeApi();
    renderApp('/settings', api);
    const field = await screen.findByLabelText('Label');
    field.focus();
    act(() => useApiKeyStore.getState().markRejected());
    const key = screen.getByLabelText('API key');
    await waitFor(() => expect(key).toHaveFocus());
    field.focus();
    act(() => useApiKeyStore.getState().markRejected());
    expect(field).toHaveFocus();
  });

  it('waits for an open modal to release focus before focusing the rejected-key input', async () => {
    renderApp('/settings', new FakeApi());
    await screen.findByLabelText('Label');
    const modal = document.createElement('dialog');
    document.body.append(modal);
    modal.showModal();
    modal.tabIndex = -1;
    modal.focus();
    act(() => useApiKeyStore.getState().markRejected());
    try {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      expect(modal).toHaveFocus();
      modal.close();
      await waitFor(() => expect(screen.getByLabelText('API key')).toHaveFocus());
    } finally {
      modal.remove();
    }
  });
  it('asks for a key on a 401, sends the stored key, and lets Settings forget it', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    api.requiredKey = 'gg_good';
    api.addLoop({
      schemaVersion: 3,
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

  it('restarts a run inspector stream that a 401 ended once a key is entered', async () => {
    const user = userEvent.setup();
    const api = new FakeApi();
    api.requiredKey = 'gg_good';
    const run = api.addRun();
    api.pushEvent(run.id, event(run.id, 1, 'run.queued', {}));
    api.pushEvent(run.id, event(run.id, 2, 'run.started', { attempt: 1 }));
    renderApp(`/runs/${run.id}`, api);
    expect(await screen.findByText('API key required')).toBeInTheDocument();
    await user.type(screen.getByLabelText('API key', { selector: 'input' }), 'gg_good');
    await user.click(screen.getByRole('button', { name: 'Use key' }));
    expect(await screen.findByText(/Timeline \(2 events, live\)/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: `Run ${run.id}` })).toBeInTheDocument();
  });

  it('follows a key forgotten or entered in another tab', () => {
    const stop = syncApiKeyAcrossTabs();
    useApiKeyStore.getState().save('gg_shared');
    localStorage.removeItem(API_KEY_STORAGE);
    window.dispatchEvent(new StorageEvent('storage', { key: API_KEY_STORAGE }));
    expect(useApiKeyStore.getState().key).toBeUndefined();
    localStorage.setItem(API_KEY_STORAGE, 'gg_other');
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' }));
    expect(useApiKeyStore.getState().key).toBeUndefined();
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    expect(useApiKeyStore.getState().key).toBe('gg_other');
    stop();
    localStorage.removeItem(API_KEY_STORAGE);
    window.dispatchEvent(new StorageEvent('storage', { key: API_KEY_STORAGE }));
    expect(useApiKeyStore.getState().key).toBe('gg_other');
  });

  it('reads a key stored by an earlier session', async () => {
    localStorage.setItem(API_KEY_STORAGE, 'gg_saved');
    vi.resetModules();
    const { useApiKeyStore: fresh } = await import('./api-key.js');
    expect(fresh.getState().key).toBe('gg_saved');
  });
});
