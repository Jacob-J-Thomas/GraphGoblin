import type * as ApiClient from '@graphgoblin/api-client';
import { GraphGoblinApiError, type SubscribeRunEventsOptions } from '@graphgoblin/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { event } from '../__fixtures__/fake-api.js';
import { ApiProvider, createAppClient } from '../api/context.js';
import {
  markApiReachable,
  markApiUnreachable,
  subscribeApiRecovery,
  useReachability,
} from '../lib/reachability.js';
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

function mountStream(client = createAppClient('http://graphgoblin.test')) {
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
  it('leaves an accepted clean close on the stream backoff without reporting an outage', () => {
    mountStream();
    const reads = vi.spyOn(queryClient, 'refetchQueries');
    act(() => {
      options().onOpen?.();
      options().onError?.(new Error('the event stream closed before the run finished'), 1);
    });
    expect(useReachability.getState().apiReachable).toBe(true);
    expect(reads).not.toHaveBeenCalled();
    act(() => {
      markApiUnreachable();
      markApiReachable();
    });
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it('restarts only if the last connection failure was a transport failure', async () => {
    mountStream();
    const reads = vi.spyOn(queryClient, 'refetchQueries').mockResolvedValue(undefined);
    act(() => options().onError?.(new TypeError('reader failed'), 1));
    act(() => options().onError?.(new Error('the event stream closed before the run finished'), 2));
    await act(async () => {
      markApiReachable();
      await Promise.resolve();
    });
    expect(reads).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it('re-arms an outage only when an event advances the cursor, not on acceptance or replay', async () => {
    vi.useFakeTimers();
    mountStream();
    const reads = vi.spyOn(queryClient, 'refetchQueries').mockResolvedValue(undefined);
    await act(async () => {
      await options().onEvent(event(runId, 5, 'run.started', { attempt: 1 }));
      await vi.advanceTimersByTimeAsync(EVENT_BATCH_MS);
    });
    act(() => options().onError?.(GraphGoblinApiError.network('refused'), 1));
    await act(async () => {
      markApiReachable();
      await Promise.resolve();
    });
    expect(subscribe).toHaveBeenCalledTimes(2);
    act(() => options(1).onOpen?.());
    await act(async () => {
      await options(1).onEvent(event(runId, 5, 'run.started', { attempt: 1 }));
    });
    act(() => options(1).onError?.(new TypeError('reader failed'), 2));
    expect(reads).toHaveBeenCalledTimes(1);
    expect(useReachability.getState().apiReachable).toBe(true);
    act(() => markApiReachable());
    expect(subscribe).toHaveBeenCalledTimes(2);
    await act(async () => {
      await options(1).onEvent(
        event(runId, 6, 'node.started', {
          nodeId: 'wait',
          attempt: 1,
          kind: 'wait',
          configHash: '0'.repeat(64),
        }),
      );
      await vi.advanceTimersByTimeAsync(EVENT_BATCH_MS);
    });
    act(() => options(1).onError?.(new TypeError('reader failed'), 3));
    expect(reads).toHaveBeenCalledTimes(2);
    await act(async () => {
      markApiReachable();
      await Promise.resolve();
    });
    expect(subscribe).toHaveBeenCalledTimes(3);
    expect(options(2).after).toBe(6);
  });

  it.each([0, 2_000])(
    'keeps real SSE retries bounded for clean closes after %i ms',
    async (closeMs) => {
      vi.useFakeTimers();
      const real = await vi.importActual<typeof ApiClient>('@graphgoblin/api-client');
      subscribe.mockImplementation(real.subscribeRunEvents);
      const fetch = vi.fn((request: Request) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let closed = false;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            const close = () => {
              if (closed) return;
              closed = true;
              clearTimeout(timer);
              request.signal.removeEventListener('abort', close);
              controller.close();
            };
            timer = setTimeout(close, closeMs);
            request.signal.addEventListener('abort', close, { once: true });
          },
          cancel() {
            closed = true;
            clearTimeout(timer);
          },
        });
        return Promise.resolve(
          new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
        );
      });
      const recovered = vi.fn();
      const unsubscribe = subscribeApiRecovery(recovered);
      const reads = vi.spyOn(queryClient, 'refetchQueries').mockImplementation(() => {
        // A healthy run read confirms recovery. Bound this fake so the broken loop can fail safely.
        if (reads.mock.calls.length <= 4) markApiReachable();
        return Promise.resolve();
      });
      const view = mountStream(createAppClient('http://graphgoblin.test', fetch));
      try {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(120_000);
        });
        expect(reads).not.toHaveBeenCalled();
        expect(recovered).not.toHaveBeenCalled();
        expect(subscribe).toHaveBeenCalledTimes(1);
        expect(fetch).toHaveBeenCalledTimes(9);
        expect(useReachability.getState().apiReachable).toBe(true);
      } finally {
        view.unmount();
        unsubscribe();
      }
    },
  );

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
