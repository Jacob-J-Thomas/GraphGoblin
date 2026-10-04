import { minimalLoop } from '@graphgoblin/contracts/testing';
import { GraphGoblinApiError } from '@graphgoblin/api-client';
import { onlineManager, type UseQueryResult } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeApi, problem } from '../__fixtures__/fake-api.js';
import { createQueryClient, Providers } from '../app/bootstrap.js';
import { isOfflineError } from '../lib/utils.js';
import { createAppClient } from './context.js';
import {
  useApiKeys,
  useInboundEvents,
  useLoop,
  useLoops,
  useModelCatalog,
  usePreflight,
  useRun,
  useRuns,
  useRunThread,
  useSecrets,
  useSettings,
} from './queries.js';

function mountQuery<T>(api: FakeApi, useRead: () => UseQueryResult<T>) {
  const fetch = vi.fn(api.fetch);
  const client = createAppClient('http://graphgoblin.test', fetch);
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({
    queries: { ...queryClient.getDefaultOptions().queries, retryDelay: 0 },
  });
  const view = renderHook(useRead, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <Providers client={client} queryClient={queryClient}>
        {children}
      </Providers>
    ),
  });
  return { ...view, fetch, queryClient };
}

function reconnect() {
  window.dispatchEvent(new Event('online'));
}

afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
});

describe('query reconnect', () => {
  it('recovers a cold offline Loops query on the online event without navigation', async () => {
    // A cold page gets no offline event: Query starts online despite navigator.onLine.
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    onlineManager.setOnline(true);
    const api = new FakeApi();
    const loop = api.addLoop(minimalLoop());
    api.offline = true;
    const view = mountQuery(api, useLoops);
    try {
      await waitFor(() => expect(view.result.current.isError).toBe(true));
      expect(isOfflineError(view.result.current.error)).toBe(true);
      expect(view.fetch).toHaveBeenCalledTimes(2);

      api.offline = false;
      online.mockReturnValue(true);
      act(reconnect);

      await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
      expect(view.result.current.data?.[0]?.id).toBe(loop.id);
      expect(view.fetch).toHaveBeenCalledTimes(3);
    } finally {
      view.unmount();
      view.queryClient.clear();
    }
  });

  const reads: {
    name: string;
    useRead: (loopId: string, runId: string) => UseQueryResult<unknown>;
  }[] = [
    { name: 'loop details', useRead: (loopId) => useLoop(loopId) },
    { name: 'Runs', useRead: () => useRuns() },
    { name: 'run inspector', useRead: (_loopId, runId) => useRun(runId) },
    { name: 'run thread', useRead: (_loopId, runId) => useRunThread(runId) },
    { name: 'Events', useRead: useInboundEvents },
    { name: 'Settings defaults', useRead: useSettings },
    { name: 'Settings models', useRead: useModelCatalog },
    { name: 'Settings secrets', useRead: useSecrets },
    { name: 'Settings API keys', useRead: useApiKeys },
    { name: 'Settings preflight', useRead: usePreflight },
  ];

  it.each(reads)('recovers the cold offline $name query', async ({ useRead }) => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    onlineManager.setOnline(true);
    const api = new FakeApi();
    const loop = api.addLoop(minimalLoop());
    const run = api.addRun({ loopId: loop.id, status: 'succeeded' });
    api.offline = true;
    const view = mountQuery(api, () => useRead(loop.id, run.id));
    try {
      await waitFor(() => expect(view.result.current.isError).toBe(true));
      expect(isOfflineError(view.result.current.error)).toBe(true);
      expect(view.fetch).toHaveBeenCalledTimes(2);
      api.offline = false;
      online.mockReturnValue(true);
      act(reconnect);
      await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
      expect(view.result.current.data).toBeDefined();
      expect(view.fetch).toHaveBeenCalledTimes(3);
    } finally {
      view.unmount();
      view.queryClient.clear();
    }
  });

  it.each([400, 401, 404, 500])('keeps HTTP %i failures at one retry', async (status) => {
    const api = new FakeApi();
    api.override('GET /loops', () => problem(status, 'REFUSED'));
    const view = mountQuery(api, useLoops);
    try {
      await waitFor(() => expect(view.result.current.isError).toBe(true));
      expect(view.result.current.error).toMatchObject({ status });
      expect(view.fetch).toHaveBeenCalledTimes(2);
      await act(async () => {
        reconnect();
        await Promise.resolve();
      });
      expect(view.result.current.isError).toBe(true);
      expect(view.result.current.fetchStatus).toBe('idle');
      expect(view.fetch).toHaveBeenCalledTimes(2);
    } finally {
      view.unmount();
      view.queryClient.clear();
    }
  });

  it('caps retries if reconnect still cannot reach the API, then recovers on the next event', async () => {
    const api = new FakeApi();
    api.offline = true;
    const view = mountQuery(api, useLoops);
    try {
      await waitFor(() => expect(view.result.current.isError).toBe(true));
      expect(view.fetch).toHaveBeenCalledTimes(2);
      act(reconnect);
      await waitFor(() => {
        expect(view.fetch).toHaveBeenCalledTimes(4);
        expect(view.result.current.fetchStatus).toBe('idle');
      });
      expect(view.result.current.isError).toBe(true);
      api.offline = false;
      act(reconnect);
      await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
      expect(view.fetch).toHaveBeenCalledTimes(5);
    } finally {
      view.unmount();
      view.queryClient.clear();
    }
  });

  it('does not refetch inactive failures or fresh successful queries, and removes its listener', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const api = new FakeApi();
    const view = mountQuery(api, useLoops);
    const inactive = vi.fn(() =>
      Promise.reject(GraphGoblinApiError.network(new TypeError('offline'))),
    );
    try {
      await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
      await expect(
        view.queryClient.fetchQuery({ queryKey: ['inactive'], queryFn: inactive }),
      ).rejects.toThrow();
      expect(inactive).toHaveBeenCalledTimes(2);
      await act(async () => {
        reconnect();
        await Promise.resolve();
      });
      expect(inactive).toHaveBeenCalledTimes(2);
      expect(view.fetch).toHaveBeenCalledTimes(1);
      const listener = add.mock.calls.find(
        ([name, , options]) => name === 'online' && options === undefined,
      )?.[1];
      expect(listener).toBeDefined();
      view.unmount();
      expect(remove).toHaveBeenCalledWith('online', listener);
    } finally {
      view.unmount();
      view.queryClient.clear();
    }
  });

  it('deduplicates recovery when Query also sees an offline-to-online transition', async () => {
    const api = new FakeApi();
    api.offline = true;
    const view = mountQuery(api, useLoops);
    try {
      await waitFor(() => expect(view.result.current.isError).toBe(true));
      act(() => {
        window.dispatchEvent(new Event('offline'));
      });
      expect(onlineManager.isOnline()).toBe(false);
      api.offline = false;
      act(reconnect);
      await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
      expect(view.fetch).toHaveBeenCalledTimes(3);
    } finally {
      view.unmount();
      view.queryClient.clear();
    }
  });
});
