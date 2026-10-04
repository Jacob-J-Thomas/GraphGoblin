import type * as ApiClient from '@graphgoblin/api-client';
import { GraphGoblinApiError, type SubscribeRunEventsOptions } from '@graphgoblin/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { event } from '../__fixtures__/fake-api.js';
import { ApiProvider, createAppClient } from '../api/context.js';
import { markApiReachable, markApiUnreachable, useReachability } from '../lib/reachability.js';
import { useRunEventStore } from './event-store.js';
import { EVENT_BATCH_MS, useRunEvents } from './useRunEvents.js';

const subscribe = vi.hoisted(() => vi.fn<typeof ApiClient.subscribeRunEvents>());
vi.mock('@graphgoblin/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  subscribeRunEvents: subscribe,
}));
const runId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
let queryClient: QueryClient;

beforeEach(() => {
  queryClient = new QueryClient();
  subscribe.mockReset();
  subscribe.mockImplementation(() => {
    let finish!: () => void;
    return {
      lastSeq: 0,
      done: new Promise<void>((resolve) => {
        finish = resolve;
      }),
      close: vi.fn(() => finish()),
    };
  });
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  useRunEventStore.getState().clear(runId);
  markApiReachable();
  vi.useRealTimers();
});

function mountStream() {
  const client = createAppClient('http://graphgoblin.test');
  return renderHook(() => useRunEvents(runId), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <ApiProvider client={client}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </ApiProvider>
    ),
  });
}
function options(index = 0): SubscribeRunEventsOptions {
  return subscribe.mock.calls[index]![0];
}

describe('run stream reachability', () => {
  it('reports transport failure while online and clears it on an accepted stream', () => {
    const view = mountStream();
    act(() => options().onError?.(new TypeError('Failed to fetch'), 1));
    expect(navigator.onLine).toBe(true);
    expect(useReachability.getState().apiReachable).toBe(false);
    act(() => options().onOpen?.());
    expect(useReachability.getState().apiReachable).toBe(true);
    expect(view.result.current.status).toBe('live');
  });

  it('restarts a stream in backoff on recovery with its cursor and cleans up', async () => {
    vi.useFakeTimers();
    const view = mountStream();
    await act(async () => {
      await options().onEvent(event(runId, 5, 'run.started', { attempt: 1 }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(EVENT_BATCH_MS);
    });
    act(() => options().onError?.(GraphGoblinApiError.network('refused'), 4));
    const old = subscribe.mock.results[0]!.value;
    await act(async () => {
      markApiReachable();
      await Promise.resolve();
    });
    expect(old.close).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(2);
    expect(options(1).after).toBe(5);
    expect(view.result.current.status).toBe('connecting');
    act(() => options(1).onOpen?.());
    expect(view.result.current.status).toBe('live');
    view.unmount();
    act(() => {
      markApiUnreachable();
      markApiReachable();
    });
    expect(subscribe).toHaveBeenCalledTimes(2);
  });

  it('does not report HTTP refusals or malformed event frames as transport failures', () => {
    mountStream();
    act(() => options().onError?.(new GraphGoblinApiError({ status: 500, code: 'REFUSED' }), 1));
    expect(useReachability.getState().apiReachable).toBe(true);
    act(() => options().onError?.(new Error('invalid event frame'), 0));
    expect(useReachability.getState().apiReachable).toBe(true);
  });
});
