import { minimalLoop } from '@graphgoblin/contracts/testing';
import { onlineManager } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeApi } from '../__fixtures__/fake-api.js';
import { createAppClient } from '../api/context.js';
import { keys, useLoops } from '../api/queries.js';
import { createQueryClient, Providers } from '../app/bootstrap.js';
import { QueryState } from './status.js';

function LoopsState() {
  const query = useLoops();
  return (
    <QueryState query={query} what="Loops">
      {(loops) => <p>{loops.map((loop) => loop.name).join(', ')}</p>}
    </QueryState>
  );
}

function mountState(api: FakeApi) {
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({
    queries: { ...queryClient.getDefaultOptions().queries, retryDelay: 0 },
  });
  const view = render(
    <Providers
      client={createAppClient('http://graphgoblin.test', api.fetch)}
      queryClient={queryClient}
    >
      <LoopsState />
    </Providers>,
  );
  return { ...view, queryClient };
}

afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
});

describe('QueryState', () => {
  it('keeps Offline visible when a reconnect flap pauses a no-data retry', async () => {
    const api = new FakeApi();
    api.offline = true;
    const view = mountState(api);
    try {
      expect(await screen.findByText('Offline')).toBeInTheDocument();
      act(() => {
        window.dispatchEvent(new Event('online'));
        window.dispatchEvent(new Event('offline'));
      });
      await waitFor(() =>
        expect(view.queryClient.getQueryState(keys.loops)).toMatchObject({
          status: 'pending',
          fetchStatus: 'paused',
          data: undefined,
        }),
      );
      expect(screen.getByText('Offline')).toBeInTheDocument();
      expect(screen.getByText(/Loops needs the GraphGoblin API/)).toBeInTheDocument();
      expect(screen.queryByText(/Loading loops/)).not.toBeInTheDocument();
    } finally {
      view.unmount();
      view.queryClient.clear();
    }
  });

  it('shows Offline for a first fetch paused before it can start', () => {
    onlineManager.setOnline(false);
    const api = new FakeApi();
    const fetch = vi.spyOn(api, 'fetch');
    const view = mountState(api);
    try {
      expect(screen.getByText('Offline')).toBeInTheDocument();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      view.queryClient.clear();
    }
  });

  it('keeps loaded data visible when a background refetch pauses', async () => {
    const api = new FakeApi();
    const loop = api.addLoop({ ...minimalLoop(), name: 'cached loop' });
    const view = mountState(api);
    try {
      expect(await screen.findByText(loop.name)).toBeInTheDocument();
      act(() => {
        window.dispatchEvent(new Event('offline'));
        void view.queryClient.refetchQueries({ queryKey: keys.loops });
      });
      await waitFor(() =>
        expect(view.queryClient.getQueryState(keys.loops)?.fetchStatus).toBe('paused'),
      );
      expect(screen.getByText(loop.name)).toBeInTheDocument();
      expect(screen.queryByText('Offline')).not.toBeInTheDocument();
    } finally {
      view.unmount();
      view.queryClient.clear();
    }
  });
});
