import { screen, waitFor } from '@testing-library/react';
import { QueryClient, type QueryObserverOptions } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { renderWith } from '../__fixtures__/render.js';
import { FakeApi } from '../__fixtures__/fake-api.js';
import { ollamaConnectionKey, refreshOllamaState, useOllamaConnection } from './ollama.js';
import { keys } from './queries.js';

function Probe() {
  const query = useOllamaConnection();
  return <output>{query.data?.discovery.state ?? 'loading'}</output>;
}

describe('Ollama discovery observation', () => {
  it('reads the gateway snapshot without starting a discovery', async () => {
    const api = new FakeApi();
    const { queryClient } = renderWith(<Probe />, '/', api);
    await screen.findByText('idle');
    expect(api.calls.filter((call) => call.path === '/model-catalog/refresh')).toHaveLength(0);
    const query = queryClient.getQueryCache().find({ queryKey: ollamaConnectionKey, exact: true });
    expect(query).toBeDefined();
    const interval = (query?.options as QueryObserverOptions | undefined)?.refetchInterval;
    expect(typeof interval).toBe('function');
    if (!query || typeof interval !== 'function') throw new Error('missing observation interval');
    expect(interval(query)).toBe(30_000);
    queryClient.setQueryData(ollamaConnectionKey, {
      ...api.ollamaConnection,
      discovery: { state: 'refreshing' },
    });
    expect(interval(query)).toBe(5_000);
  });

  it('replaces an older connection response, then refreshes catalog and readiness', async () => {
    const api = new FakeApi();
    const { queryClient } = renderWith(<Probe />, '/', api);
    await screen.findByText('idle');
    api.ollamaConnection = {
      connection: { enabled: true, baseUrl: 'http://models.test', revision: 2 },
      discovery: { state: 'ready' },
    };
    await refreshOllamaState(queryClient, api.ollamaConnection);
    await screen.findByText('ready');
    expect(queryClient.getQueryData(ollamaConnectionKey)).toEqual(api.ollamaConnection);
    expect(api.calls.filter((call) => call.path === '/harness/ollama/connection')).toHaveLength(2);
  });

  it('refreshes after a manual discovery without replacing connection state', async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await refreshOllamaState(client);
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.preflight, exact: true }),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ollamaConnectionKey, exact: true });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.catalog });
  });
});
