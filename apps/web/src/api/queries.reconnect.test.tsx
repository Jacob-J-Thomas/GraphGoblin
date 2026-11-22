import { minimalLoop } from '@graphgoblin/contracts/testing';
import { GraphGoblinApiError } from '@graphgoblin/api-client';
import {
  onlineManager,
  useQuery,
  type QueryFunctionContext,
  type UseQueryResult,
} from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { event, FakeApi, problem } from '../__fixtures__/fake-api.js';
import { useRunHeaderStatus } from '../runs/useRunHeaderStatus.js';
import { createQueryClient, Providers } from '../app/bootstrap.js';
import { isOfflineError } from '../lib/utils.js';
import { createAppClient } from './context.js';
import {
  keys,
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

function mountQuery<T>(api: FakeApi, useRead: () => T, queryClient = createQueryClient()) {
  const fetch = vi.fn(api.fetch);
  const client = createAppClient('http://graphgoblin.test', fetch);
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
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('query reconnect', () => {
  it('recovers a cold offline Loops query on the online event without navigation', async () => {
    // A cold page gets no offline event, so Query's manager still assumes online.
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
    { name: 'Loops', useRead: () => useLoops() },
    { name: 'loop details', useRead: (loopId) => useLoop(loopId) },
    { name: 'Runs', useRead: () => useRuns() },
    { name: 'run inspector', useRead: (_loopId, runId) => useRun(runId) },
    { name: 'run thread', useRead: (_loopId, runId) => useRunThread(runId) },
    { name: 'Events', useRead: () => useInboundEvents() },
    { name: 'Settings defaults', useRead: useSettings },
    { name: 'Settings models', useRead: useModelCatalog },
    { name: 'Settings secrets', useRead: useSecrets },
    { name: 'Settings API keys', useRead: useApiKeys },
    { name: 'Settings preflight', useRead: usePreflight },
  ];

  it.each(reads)(
    'recovers $name when the API returns with the browser still online',
    async ({ useRead }) => {
      vi.useFakeTimers();
      const api = new FakeApi();
      const loop = api.addLoop(minimalLoop());
      const run = api.addRun({ loopId: loop.id, status: 'succeeded' });
      api.override('GET /healthz', () => new Response('ok'));
      api.offline = true;
      const view = mountQuery(api, () => useRead(loop.id, run.id));
      try {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(20);
        });
        expect(view.result.current.isError).toBe(true);
        expect(view.fetch).toHaveBeenCalledTimes(2);
        api.offline = false;
        await act(async () => {
          await vi.advanceTimersByTimeAsync(2_000);
        });
        expect(view.result.current.isSuccess).toBe(true);
        expect(view.result.current.data).toBeDefined();
        expect(view.fetch.mock.calls.some(([request]) => request.url.endsWith('/healthz'))).toBe(
          true,
        );
      } finally {
        view.unmount();
        view.queryClient.clear();
      }
    },
  );

  it.each(reads)('recovers the cold offline $name query', async ({ name, useRead }) => {
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
      act(reconnect);
      await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
      expect(view.result.current.data).toBeDefined();
      const availabilityChecks = view.fetch.mock.calls.filter(([request]) => {
        const url = new URL(request.url);
        return url.pathname === '/events' && url.searchParams.get('limit') === '1';
      });
      // Initial failure plus its retry, then exactly one recovered history read. Events
      // starts its separate availability check only after that successful initial load.
      expect(availabilityChecks).toHaveLength(name === 'Events' ? 1 : 0);
      expect(view.fetch.mock.calls.length - availabilityChecks.length).toBe(3);
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
    // Install Query's own listeners before observing the provider's registration.
    const queryClient = createQueryClient();
    queryClient.mount();
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const api = new FakeApi();
    const view = mountQuery(api, useLoops, queryClient);
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
      const registrations = add.mock.calls.filter(([name]) => name === 'online');
      expect(registrations).toHaveLength(1);
      const listener = registrations[0]![1];
      view.unmount();
      expect(remove).toHaveBeenCalledWith('online', listener);
    } finally {
      view.unmount();
      queryClient.unmount();
      view.queryClient.clear();
    }
  });

  it('recovers after Query observes an offline-to-online transition', async () => {
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

  it('keeps a cached-data fetch in flight on reconnect without cancelling or starting another request', async () => {
    let finish!: (value: string) => void;
    const response = new Promise<string>((resolve) => {
      finish = resolve;
    });
    let next = () => Promise.resolve('cached');
    const cancelled = vi.fn();
    const request = vi.fn(({ signal }: QueryFunctionContext) => {
      signal.addEventListener('abort', cancelled);
      return next();
    });
    const view = mountQuery(new FakeApi(), () =>
      useQuery({ queryKey: ['in-flight'], queryFn: request, notifyOnChangeProps: 'all' }),
    );
    try {
      await waitFor(() => expect(view.result.current.data).toBe('cached'));
      next = () => Promise.reject(GraphGoblinApiError.network(new TypeError('offline')));
      await act(async () => {
        await view.result.current.refetch();
      });
      await waitFor(() => expect(view.result.current.error).toBeInstanceOf(GraphGoblinApiError));
      expect(view.result.current.data).toBe('cached');

      // A failed background refresh retains its data and error while the next fetch is running.
      next = () => response;
      request.mockClear();
      let pending!: ReturnType<typeof view.result.current.refetch>;
      act(() => {
        pending = view.result.current.refetch();
      });
      await waitFor(() => expect(view.result.current.fetchStatus).toBe('fetching'));
      const signal = request.mock.calls[0]![0].signal;
      await act(async () => {
        reconnect();
        await Promise.resolve();
      });
      expect(signal.aborted).toBe(false);
      expect(cancelled).not.toHaveBeenCalled();
      expect(request).toHaveBeenCalledTimes(1);

      await act(async () => {
        finish('refreshed');
        await pending;
      });
      await waitFor(() => expect(view.result.current.data).toBe('refreshed'));
      expect(view.result.current.isSuccess).toBe(true);
      expect(request).toHaveBeenCalledTimes(1);
    } finally {
      finish('refreshed');
      view.unmount();
      view.queryClient.clear();
    }
  });
});

describe('run query header receipts (#386)', () => {
  function mountRun(api: FakeApi, runId: string) {
    return mountQuery(api, () => ({ query: useRun(runId), header: useRunHeaderStatus(runId) }));
  }

  it('verifies only a position returned by its own successful matching run read', async () => {
    const api = new FakeApi();
    const run = api.addRun({ status: 'running', lastEventSeq: 2 });
    const view = mountRun(api, run.id);
    try {
      await waitFor(() => expect(view.result.current.query.isSuccess).toBe(true));
      expect(view.result.current.header.status(run)).toEqual({ kind: 'record', status: 'running' });
      const newer = { ...view.result.current.query.data!, lastEventSeq: 5 };
      act(() => {
        view.queryClient.setQueryData(keys.run(run.id), newer);
      });
      expect(view.result.current.header.status(newer)).toEqual({ kind: 'updating' });
      api.runs.set(run.id, { ...run, lastEventSeq: 5 });
      await act(async () => {
        await view.result.current.query.refetch();
      });
      expect(view.result.current.header.status(newer)).toEqual({
        kind: 'record',
        status: 'running',
      });
    } finally {
      view.unmount();
      view.queryClient.clear();
    }
  });

  it('does not verify a successful response for a different run', async () => {
    const api = new FakeApi();
    const requested = api.addRun({ status: 'running', lastEventSeq: 2 });
    const foreign = api.addRun({ status: 'failed', lastEventSeq: 3 });
    api.override('GET /runs/:id', () => Response.json(foreign));
    const view = mountRun(api, requested.id);
    try {
      await waitFor(() => expect(view.result.current.query.isSuccess).toBe(true));
      expect(view.result.current.query.data?.id).toBe(foreign.id);
      expect(view.result.current.header.status(foreign)).toEqual({ kind: 'updating' });
      expect(view.result.current.header.registry.snapshot(requested.id)?.receipts).toEqual([]);
    } finally {
      view.unmount();
      view.queryClient.clear();
    }
  });

  it.each([200, 404])(
    'ignores a late HTTP %i response after the run read is cancelled',
    async (status) => {
      const api = new FakeApi();
      const run = api.addRun({ status: 'running', lastEventSeq: 2 });
      const view = mountRun(api, run.id);
      let release!: (response: Response) => void;
      const response = new Promise<Response>((resolve) => {
        release = resolve;
      });
      try {
        await waitFor(() => expect(view.result.current.query.isSuccess).toBe(true));
        const before = view.result.current.header.registry.snapshot(run.id);
        let signal: AbortSignal | undefined;
        api.override('GET /runs/:id', (call) => {
          signal = call.signal;
          return response;
        });
        let pending!: ReturnType<typeof view.result.current.query.refetch>;
        act(() => {
          pending = view.result.current.query.refetch();
        });
        await waitFor(() => expect(signal).toBeDefined());
        await act(async () => {
          await view.queryClient.cancelQueries({ queryKey: keys.run(run.id), exact: true });
          await pending;
        });
        expect(signal?.aborted).toBe(true);
        await act(async () => {
          release(
            status === 404
              ? problem(404, 'RUN_NOT_FOUND')
              : Response.json({ ...run, lastEventSeq: 9 }),
          );
          await response;
        });
        expect(view.result.current.header.registry.snapshot(run.id)).toBe(before);
        expect(view.result.current.header.status(run)).toEqual({
          kind: 'record',
          status: 'running',
        });
        expect(view.result.current.header.status({ status: 'running', lastEventSeq: 9 })).toEqual({
          kind: 'updating',
        });
      } finally {
        release(problem(404, 'RUN_NOT_FOUND'));
        view.unmount();
        view.queryClient.clear();
      }
    },
  );

  it.each([404, 500])(
    'handles HTTP %i without treating other read failures as definitive deletion',
    async (status) => {
      const api = new FakeApi();
      const run = api.addRun({ status: 'running', lastEventSeq: 2 });
      const view = mountRun(api, run.id);
      try {
        await waitFor(() => expect(view.result.current.query.isSuccess).toBe(true));
        const registry = view.result.current.header.registry;
        act(() => registry.events(registry.lease(run.id), [event(run.id, 3, 'run.cancelled', {})]));
        expect(view.result.current.header.status(run)).toEqual({
          kind: 'event',
          status: 'cancelled',
          seq: 3,
        });
        api.override('GET /runs/:id', () => problem(status, 'REFUSED'));
        await act(async () => {
          await view.result.current.query.refetch();
        });
        await waitFor(() => expect(view.result.current.query.error).toMatchObject({ status }));
        if (status === 404) {
          expect(registry.snapshot(run.id)).toBeUndefined();
          expect(view.result.current.header.status(run)).toEqual({ kind: 'updating' });
        } else {
          expect(view.result.current.header.status(run)).toEqual({
            kind: 'event',
            status: 'cancelled',
            seq: 3,
          });
        }
      } finally {
        view.unmount();
        view.queryClient.clear();
      }
    },
  );
});
